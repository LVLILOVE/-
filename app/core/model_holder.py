"""
=============================================================================
模型单例持有器（`EP-5` · `WS-5-03` / `BE-06` / `BE-15` / `BE-25`）
-----------------------------------------------------------------------------
版本     : V1.0（EP-5）
依据文档 : 《开发技术文档 V1.0》§4.7.5（模型单例持有）、§4.1.1（启动自检清单）
           《项目开发实施方案 V1.0》`WS-5-03`
-----------------------------------------------------------------------------
解决什么问题
-----------------------------------------------------------------------------
单次推理只要 ~21 ms，但**首次加载**权重要读文件 + 重建 `state_dict` + 建计算图，
耗时数秒（`BE-15`）。若不预加载，第一个用户会遭遇明显卡顿，而且这段延迟会被
计入 `task.duration_ms`，污染性能指标 —— 于是「谁先点谁倒霉」还会变成
「性能数据不可信」。故在 `lifespan` 启动阶段一次性加载并在进程内持有。

三条硬约束（缺一不可）
-----------------------------------------------------------------------------
🔒 `BE-06` **配置漂移必须启动失败**
   `.env` 的 `ACTIVE_MODEL` 与 `model_registry.is_active = 1` 的版本号必须一致。
   不一致时若容错放行，服务能起来、能预测，但**加载的是另一个版本的权重** ——
   这类「静默故障」在答辩演示时最难解释。故：不一致 → 抛错 → 启动失败。

🔒 `BE-25` **`eval()` 与 `no_grad()` 二者都要**
   缺 `eval()`：dropout 在推理期生效，同一输入两次调用结果不同（预测随机漂移）；
   缺 `no_grad()`：会构建计算图，显存翻倍（本机 2 GB 显存上有 OOM 风险）。
   本模块负责 `eval()`；`no_grad()` 由 `algo.infer` 内部包裹（离线/在线同源）。

🔒 **禁止在导入期拉起 torch**
   本模块位于 `core/`（基础设施层），会被 `app.main` 直接 import。
   若在模块级 `import torch`，则任何 `import app.core.model_holder` 都会付出
   数秒的 torch 导入开销，并让 `scripts/verify_*.py` 这类静态校验脚本
   无谓地依赖深度学习栈。故 torch 与 `algo` 全部**延迟到函数内**导入。

职责边界（`BE-04`）：本模块只负责「模型的加载 / 持有 / 清空」，
   **不含**任何任务编排逻辑（那是 `services/predict_service.py`）。
   允许 import `dao`（`core/` 属基础设施层，`BE-04` 明确允许）。
=============================================================================
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.orm import Session

from app.core import config
from app.core.db import SessionLocal
from app.core.errors import BizError, ErrorCode

logger = logging.getLogger(__name__)

__all__ = [
    "ModelHandle",
    "ModelHolder",
    "holder",
    "load_active_model",
    "reload_active_model",
    "assert_ready",
    "get_handle",
]

settings = config.settings


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@dataclass
class ModelHandle:
    """一份已加载的模型及其元信息。

    `window` 刻意从**权重的 meta** 取、而不是从 `algo.config.WINDOW_SIZE` 取：
    训练时的窗口长度是那次训练的事实，config 只是默认值。若二者不一致，
    应当以权重为准（否则构造出的输入张量形状与网络期望不符，报形状错误）；
    本模块在加载时会把二者不一致的情况打成告警。
    """

    version: str
    model: object                       # torch.nn.Module（避免模块级 import torch）
    meta: dict = field(default_factory=dict)
    feat_names: tuple[str, ...] = ()
    window: int = 21
    hidden_size: int = 48
    num_layers: int = 2
    param_count: int = 0
    device: str = "cpu"
    file_path: str = ""
    fallback_device: str = "cpu"         # GPU OOM 时切到的设备
    loaded_at: str = field(default_factory=_now)

    @property
    def name(self) -> str:
        """用于日志与前端展示的可读名（`cuda` / `cpu`）。"""
        return self.device


class ModelHolder:
    """进程级单例。`EP-8` 切换模型版本时会调用 `load()` 覆盖当前句柄。"""

    def __init__(self) -> None:
        self._handle: ModelHandle | None = None

    # ---------------------------------------------------------------- 读
    @property
    def loaded(self) -> bool:
        """`BE-06` 的判定入口：未加载时预测接口返回 `40404`，而不是 500。"""
        return self._handle is not None

    @property
    def handle(self) -> ModelHandle | None:
        return self._handle

    @property
    def version(self) -> str | None:
        return self._handle.version if self._handle else None

    @property
    def device(self) -> str:
        return self._handle.device if self._handle else "cpu"

    # ---------------------------------------------------------------- 写
    def load(self, handle: ModelHandle) -> None:
        old = self._handle
        self._handle = handle
        if old is not None:
            logger.info("模型句柄已替换 %s → %s", old.version, handle.version)

    def clear(self) -> None:
        """释放句柄（`lifespan` 关闭路径）。

        ⚠️ 刻意**不**主动 `torch.cuda.empty_cache()`：
           进程即将退出，清显存没有收益；而在测试进程里反复 clear/load 时
           反而会与还在引用的张量竞争。交给 GC 更省事。
        """
        self._handle = None


holder = ModelHolder()


# =============================================================================
# 加载
# =============================================================================
def _resolve_version(db: Session, expect_version: str) -> tuple[str, str, dict]:
    """取「配置 + 数据库」两侧都认可的启用版本（`BE-06`）。

    返回 `(version, file_path, registry_row_as_dict)`。

    三种失败都被显式区分，因为它们对应的**处置动作完全不同**：
      · 库里没有启用记录  → 未执行 `seed.sql`，去初始化数据库
      · 库里有多个启用记录 → 索引被破坏（`ux_model_active` 应保证唯一）
      · 版本号与配置不符   → 配置漂移，改 `.env` 或改库
    把三者混成一句「模型加载失败」会让运维无法判断该动哪一边。
    """
    from app.dao import model_dao

    rows = model_dao.list_all(db)
    actives = [r for r in rows if int(r.is_active) == 1]

    if not actives:
        raise RuntimeError(
            "model_registry 中没有 is_active=1 的启用版本。"
            "请先执行 code/db/seed.sql 注册模型（BE-06 / 启动自检）。"
        )
    if len(actives) > 1:
        raise RuntimeError(
            "model_registry 中存在 %d 条启用记录，违反唯一索引 ux_model_active。"
            "请检查数据库是否被手工改写。" % len(actives)
        )

    row = actives[0]
    if row.version != expect_version:
        raise RuntimeError(
            f"配置漂移（BE-06）：.env 的 ACTIVE_MODEL={expect_version!r}，"
            f"而数据库启用版本为 {row.version!r}。"
            f"请将二者改为一致后重启（服务拒绝加载与配置不符的权重，"
            f"避免「服务正常但模型版本错误」的静默故障）。"
        )
    return row.version, row.file_path, {
        "window_size": int(row.window_size),
        "hidden_size": int(row.hidden_size),
        "num_layers": int(row.num_layers),
        "param_count": row.param_count,
        "is_active": 1,
    }


def load_active_model(
    db: Session | None = None, *, require: bool = True
) -> ModelHandle | None:
    """启动时调用，把启用版本加载进单例（`BE-06` / `BE-15`）。

    `require=False` 用于**离线脚本与静态校验**：它们可能在一个尚未放置权重
    的临时库上运行，此时缺模型不应让整个进程起不来（由调用方决定是否降级）。

    ⚠️ 失败语义：`require=True` 时**抛异常**，由 `lifespan` 传播导致启动失败。
       这是刻意的（§4.1.1 启动自检清单）：「服务起来了但功能是坏的」比
       「服务起不来」更难排查 —— 前者要等到用户点预测才暴露。
    """
    own = db is None
    session = db or SessionLocal()
    try:
        version, file_path, reg = _resolve_version(session, settings.active_model)
        return _do_load(version, file_path, reg)
    except Exception:
        if require:
            raise
        logger.warning("模型未加载（require=False，降级继续）", exc_info=True)
        return None
    finally:
        if own:
            session.close()


def _do_load(version: str, file_path: str, reg: dict) -> ModelHandle:
    """真正的加载：读权重 → 校验元信息 → `eval()` → 放进单例。"""
    from pathlib import Path

    from app.algo import infer as algo_infer
    from app.algo import preprocess

    p = Path(file_path)
    abs_path = p if p.is_absolute() else settings.base_dir / p
    if not abs_path.exists():
        raise RuntimeError(
            f"模型权重文件不存在：{file_path}。"
            f"请先运行 python scripts/train_and_register.py --demo 生成权重。"
        )

    device = preprocess.resolve_device(settings.torch_device)
    model, meta = algo_infer.load_bundle(str(abs_path), device=device)

    # 🔒 BE-25：缺 eval() 会让 dropout 在推理期生效 → 同一输入两次结果不同。
    #    load_bundle 内部已经 eval() 过一次，这里再显式调用一次是**故意重复**：
    #    它让「必须在推理前 eval」这条约束在持有器的代码里可见，
    #    而不是藏在一个别处改一下就会消失的实现细节里。
    model.eval()

    n_params = _count_params(model)
    if reg.get("param_count") is not None and int(reg["param_count"]) != n_params:
        # ⚠️ 只告警不失败：允许「有意换了权重但没更新注册表」。
        #    与 BE-06 的版本号校验不同 —— 版本号是**身份**，参数量只是**体征**。
        logger.warning(
            "模型参数量与 model_registry 记录不一致：注册表 %s，实际 %s。"
            "可能是手工替换了权重文件。",
            reg["param_count"], n_params,
        )

    configured_window = settings_window()
    window = int(meta.get("window", configured_window) or configured_window)
    if window != configured_window:
        logger.warning(
            "权重窗口长度 %s 与 algo.config.WINDOW_SIZE=%s 不一致，以权重为准。",
            window, configured_window,
        )
    hidden = int(meta.get("hidden_size", reg.get("hidden_size") or 48))
    layers = int(meta.get("num_layers", reg.get("num_layers") or 2))

    handle = ModelHandle(
        version=version,
        model=model,
        meta=dict(meta),
        feat_names=tuple(meta.get("feat_names") or ()),
        window=window,
        hidden_size=hidden,
        num_layers=layers,
        param_count=n_params,
        device=device,
        file_path=str(abs_path),
    )
    holder.load(handle)
    logger.info(
        "模型已加载 version=%s device=%s params=%s window=%s file=%s",
        handle.version, handle.device, handle.param_count, handle.window, file_path,
    )
    return handle


def settings_window() -> int:
    """`algo.config.WINDOW_SIZE` 的延迟读取（避免模块级 import algo）。"""
    from app.algo import config as algo_config

    return int(algo_config.WINDOW_SIZE)


def _count_params(model: object) -> int:
    try:
        return int(sum(p.numel() for p in model.parameters() if p.requires_grad))
    except AttributeError:  # pragma: no cover - 非 torch 对象的兜底
        return 0


def reload_active_model(db: Session | None = None) -> ModelHandle | None:
    """重新加载（`EP-8` 管理端切换版本后调用）。

    ⚠️ 与 `load_active_model` 的唯一区别是**先清空**：
       否则 `_resolve_version` 抛错时会留下旧句柄，出现
       「数据库说启用了 v2、进程实际还在用 v1」—— 正是 `BE-06` 要防的那件事。
    """
    holder.clear()
    return load_active_model(db, require=True)


def assert_ready() -> ModelHandle:
    """取模型句柄；未就绪时抛 `40404`（而不是让 `None` 一路传到算法层报 500）。

    `API-12` 在「序列数预检」之后、创建任务之前调用本函数：
    若把这一步放得太晚，会在库里留下一批「模型没就绪」的失败任务。
    """
    handle = holder.handle
    if handle is None:
        raise BizError(
            ErrorCode.MODEL_NOT_READY,
            "模型尚未就绪，无法执行预测。请联系管理员检查模型注册状态",
            {"suggestion": "启动日志中应有「模型已加载」记录；若缺失请检查 model_registry 的启用版本"},
        )
    return handle


def get_handle() -> ModelHandle | None:
    """只读访问（`/health` 探测用，不抛错）。"""
    return holder.handle


# 显式引用，避免 linter 因「仅 re-export」而报未使用
_ = (get_handle, ModelHandle, ModelHolder)
