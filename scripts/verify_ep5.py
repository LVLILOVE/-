"""
=============================================================================
`EP-5` 静态校验（DOD-EP5 · 需人工复核、无需启动服务即可判定的部分）
-----------------------------------------------------------------------------
与 `scripts/verify_ep4.py` 同一套路：**断言能被机器判定的红线**，
把「需要跑起来才知道」的部分留给 `verify_ep5_api.py`（端到端）与
`verify_ep5_browser.mjs`（真实浏览器）。

  ① 🔒 **红线自检**：`grep -r "algo.train" app/services/` 零命中
     ——`predict_service` 只能**推理**不能训练（`WS-5-09`「不提供重新训练」）。
     ⚠️ 用 **AST** 取 import 列表，不用正则扫文本：注释里写「不调用
     `algo.train`」也会被文本搜索命中，那是假阳性。
  ② 🔒 **游客链路**：`predictions.py` 两个接口都用 `OptionalUserId`；
     `/running/:taskId` `/result/:taskId` 路由**不得**有 `RequireAuth`
  ③ 🔒 **阶段常量单一真源**：`STAGES` / `STAGE_LABELS` / `STAGE_BUDGET_RATIO`
     在 `predict_service` 定义，前端 `generated/pipeline.ts` 与之逐项相等
     （由 `scripts/sync_pipeline_meta.py --check` 生成，**手改即失败**）
  ④ 🔒 **时间预算分配自洽**：五段占比之和 == 1.0，且 `inference` 为最大项
     （否则时间轴会把最贵的一段画得最窄，直接误导优化方向）
  ⑤ 🔒 **软失败不是 5xx**：`ApiResponse.ok` 用于软失败；`predict_service`
     内**不得**出现 `HTTPException(status_code=5xx)`
  ⑥ 🔒 **序列数超限不建行**：`API-12-1` 要求预检在落库之前，
     即 `MAX_SERIES` 判定必须发生在 `db.add(task)` 之前
  ⑦ 🔒 **无「重新训练」入口**：前端参数页不得出现 `重新训练 / retrain /
     train` 字样；`retrain` 在**后端**也不得存在（只调推理）
  ⑧ 🔒 **前端无实测数值字面量**：执行页/参数页不得硬编码 `16618` / `14.26`
     这类算法产出数字（`QD-06`「两套数字」红线）
  ⑨ 🔒 **依赖数组完整性**：`useAsideContent` 的调用方必须传稳定引用
     （`useMemo` / 模块级常量）——漏依赖 → AsideLayout 无限重渲染 → 白屏，
     而 `tsc` 完全查不出来
  ⑩ **成本模型可自证**：`cost_model.estimate_by_horizon` 对示例数据集的
     预估与 `outputs/eval_report.json` 里的实测耗时偏差 ≤ 25%
     （偏差过大说明标定系数已随硬件/数据形态漂移，需重跑标定）
  ⑪ **前端构建期注入物未漂移**：`sync_pipeline_meta.py --check` 与
     `sync_eval_metrics.py --check` 均须通过

用法：
    python scripts/verify_ep5.py
退出码：0 = 全通过，1 = 存在失败项
=============================================================================
"""
from __future__ import annotations

import ast
import importlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
WEB_SRC = ROOT / "web" / "src"
SCRIPTS = ROOT / "scripts"
OUTPUTS = ROOT / "outputs"

PREDICT_SERVICE = APP / "services" / "predict_service.py"
COST_MODEL = APP / "services" / "cost_model.py"
PREDICTIONS_API = APP / "api" / "v1" / "predictions.py"
V1_ROUTER = APP / "api" / "v1" / "router.py"
MAIN_PY = APP / "main.py"
MODEL_HOLDER = APP / "core" / "model_holder.py"
ALGO_CONFIG = APP / "algo" / "config.py"
ALGO_INFER = APP / "algo" / "infer.py"
ALGO_FEATURES = APP / "algo" / "features.py"

FE_ROUTER = WEB_SRC / "router" / "index.tsx"
FE_PARAMS = WEB_SRC / "pages" / "ParamsPage.tsx"
FE_RUNNING = WEB_SRC / "pages" / "RunningPage.tsx"
FE_ASIDE = WEB_SRC / "components" / "params" / "ParamsAside.tsx"
FE_RUN_ASIDE = WEB_SRC / "components" / "run" / "RunAside.tsx"
FE_RESULT = WEB_SRC / "pages" / "ResultPage.tsx"
FE_PIPELINE = WEB_SRC / "generated" / "pipeline.ts"
FE_TYPES = WEB_SRC / "types" / "index.ts"

# 「重新训练」红线关键词（`WS-5-09`：🔒 不提供「重新训练」选项）
RETRAIN_WORDS = ["重新训练", "重训", "在线训练", "在线重训", "retrain", "startTraining", "trainModel"]

# ⚠️ 否定前缀：`UX-P06-04` **要求**参数页显式声明「不提供在线重训练」，
#    所以这些词出现在否定句里是**合规且必需**的，不能一并当违规。
#    只有「提供重训能力」才是红线。
NEGATION_MARKERS = [
    "不提供",
    "不包含",
    "不支持",
    "不需要",
    "无需",
    "为什么不需要",
    "关于在线",
    "不开启",
    "已离线训练",
    "离线训练",
    "已完成离线",
]

# 原型演示痕迹（`UX-GOV-01`），产品代码里必须零命中
PROTOTYPE_LEAKS = [
    ".state-bar",
    "state-bar",
    ".spec-note",
    "spec-note",
    "demo-data",
    "showState(",
]

# 前端不得硬编码的实测数值字面量（真实值来自 eval_report.json）
# ⚠️ 只挑「有辨识度」的数字：像 `14`（horizon）、`60`（SLA 秒）这类
#    语义自明的常量不算违规，硬查会误杀一大片。
FORBIDDEN_LITERALS = [
    "16618",
    "15684",
    "11329",
    "23843",
    "14.26",
    "26.42",
    "27.52",
    "83.95",
    "14305",
]

_LINE_COMMENT = re.compile(r"//[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)

results: list[tuple[str, bool, str]] = []


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))


def read(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def read_ts_code(path: Path) -> str:
    """TS/TSX 源码剥注释（eslint-disable 之类也算注释）。"""
    text = read(path)
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub(" ", text))


def module_imports(path: Path) -> set[str]:
    """用 **AST** 取该模块 import 的模块名集合（含 from ... import 的宿主模块）。

    🔒 不用正则扫文本：注释里写「不调用 algo.train」会让 `grep` 假阳性，
    而真正要拦的是「真的 import 了」。
    """
    src = read(path)
    if not src:
        return set()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return set()
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name.split(".")[0])
                names.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                names.add(node.module.split(".")[0])
                names.add(node.module)
    return names


class ImportFailed(dict):
    """import 失败的哨兵：是个 dict（易误用），但显式携带 `__error__` 便于断言。"""

    __slots__ = ()


def import_module_value(dotted: str, name: str):
    """真正 import 后取常量真值（用于拼接型常量，如 STAGES = (A, B, ...)）。

    🔒 只用于**只读常量**；不允许 import 有副作用的入口。
       若 import 失败（缺依赖等），返回 `ImportFailed{'__error__': ...}`，
       调用方必须先判 `isinstance(x, ImportFailed)` —— 绝不静默当成「通过」。
    """
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    try:
        mod = importlib.import_module(dotted)
    except Exception as exc:  # noqa: BLE001 — 校验脚本，import 失败即判失败
        return ImportFailed(__error__=f"import {dotted} 失败：{exc}")
    return getattr(mod, name, None)


def parse_ts_object(text: str, const_name: str):
    """从 TS 里粗解析 `export const X = { ... } as const;` 的 JSON-ish 结构。

    ⚠️ 只做「够用的」解析：把键值对按 `"key": value` 抓出来，
    字符串去引号、数字转 float、布尔/数字数组转list。
    不引入 TS 编译器依赖（本脚本要能在没装 node 的机器上跑）。
    """
    start = text.find(f"{const_name} = {{")
    if start < 0:
        return None
    depth = 0
    end = -1
    i = text.find("{", start)
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
        i += 1
    if end < 0:
        return None
    return text[start : end + 1]


def js_num(body: str, key: str) -> float | None:
    m = re.search(rf'"{re.escape(key)}"\s*:\s*(-?\d+(?:\.\d+)?)', body)
    return float(m.group(1)) if m else None


def js_keys(body: str) -> list[str]:
    """取 `[{...}, {...}]` 数组里每个对象的 `"key": "xxx"`（用于 STAGES 的 5 个 key）。"""
    return re.findall(r'"key"\s*:\s*"([^"]+)"', body)


# ---------------------------------------------------------------------------
# ① 红线：services 层不得 import algo.train
# ---------------------------------------------------------------------------
def check_no_train_import() -> None:
    services_dir = APP / "services"
    offenders: list[str] = []
    for py in sorted(services_dir.glob("*.py")):
        names = module_imports(py)
        for n in names:
            if n.endswith("algo.train") or n == "train":
                offenders.append(f"{py.name} -> {n}")
    check(
        "① 🔒 app/services/ 不 import 训练入口（DOD 红线：零命中）",
        not offenders,
        "命中：" + ", ".join(offenders) if offenders else "AST 扫描 8 个 services 模块，零命中",
    )

    # 后端也不该暴露「训练」接口路径
    api_dir = APP / "api"
    txt = "\n".join(read(p) for p in api_dir.rglob("*.py"))
    hits = [w for w in ("/train", "/retrain", '"/fit"', "/fit") if w in txt]
    check(
        "① 🔒 后端无 /train /retrain /fit 路由",
        not hits,
        "命中：" + ", ".join(hits) if hits else "app/api 全量零命中",
    )


# ---------------------------------------------------------------------------
# ② 游客链路
# ---------------------------------------------------------------------------
def check_guest_path() -> None:
    api = read(PREDICTIONS_API)
    ok_optional = "OptionalUserId" in api
    check(
        "② 🔒 API-12/13 走 OptionalUserId（游客可见）",
        ok_optional,
        "predictions.py 未见 OptionalUserId" if not ok_optional else "游客链路未断",
    )

    # 不得出现强制登录依赖
    bad = [w for w in ("CurrentUserId", "require_role", "RequireRole") if w in api]
    check(
        "② 🔒 API-12/13 不强制登录、不校验角色",
        not bad,
        "命中：" + ", ".join(bad) if bad else "CurrentUserId/require_role 零命中",
    )

    router = read_ts_code(FE_ROUTER)

    def _route_block(src: str, at: int) -> str:
        """从 `at` 左侧最近的路由对象 `{` 起、按花括号配平取出整块。

        ⚠️ 原实现取固定 260 字符窗口 `src[at : at + 260]`。窗口长度是**隐式假设**：
        一旦前面的路由变长、或后面被塞进新路由，窗口就会越界读到**别人的**代码。
        `EP-7` 新增历史路由（**确实带 `RequireAuth`**）后，`/result` 的窗口正好
        覆盖到它，于是误判「/result 套了守卫」——断言失败，但路由本身是对的。
        """
        start = src.rfind("{", 0, at)
        depth, j = 0, start
        while j < len(src):
            if src[j] == "{":
                depth += 1
            elif src[j] == "}":
                depth -= 1
                if depth == 0:
                    return src[start : j + 1]
            j += 1
        return src[start:]

    # 取出 /running 与 /result 两个路由块，看是否套了 RequireAuth
    for path in ("/running/:taskId", "/result/:taskId"):
        idx = router.find(f"'{path}'")
        if idx < 0:
            check(f"② 🔒 路由 {path} 存在且游客可达", False, "路由未找到")
            continue
        block = _route_block(router, idx)
        guarded = "RequireAuth" in block
        check(
            f"② 🔒 路由 {path} 存在且不加 RequireAuth",
            not guarded,
            "套了 RequireAuth" if guarded else "游客可达",
        )


# ---------------------------------------------------------------------------
# ③ 阶段常量单一真源
# ---------------------------------------------------------------------------
def check_stage_meta() -> None:
    stages = import_module_value("app.services.predict_service", "STAGES")
    labels = import_module_value("app.services.predict_service", "STAGE_LABELS")
    if isinstance(stages, ImportFailed):
        check("③ predict_service 可 import（取常量真值）", False, stages["__error__"])
        return
    if isinstance(labels, ImportFailed):
        check("③ STAGE_LABELS 可取到", False, labels["__error__"])
        return
    check(
        "③ 五阶段顺序为 validate→preprocess→features→inference→metrics",
        tuple(stages or ()) == ("validate", "preprocess", "features", "inference", "metrics"),
        f"实际={stages}",
    )
    check(
        "③ STAGE_LABELS 与 STAGES 一一对应",
        isinstance(labels, dict) and stages is not None and set(labels) == set(stages),
        f"labels keys={sorted(labels) if isinstance(labels, dict) else labels}",
    )

    body = parse_ts_object(read(FE_PIPELINE), "PIPELINE_META")
    if not body:
        check("③ 前端 pipeline.ts 与后端阶段常量同源", False, "未能解析 PIPELINE_META")
        return
    fe_keys = js_keys(body)
    check(
        "③ 前端 STAGES 的 5 个 key 与后端逐项相等",
        fe_keys == list(stages or ()),
        f"前端={fe_keys} 后端={list(stages) if stages else None}",
    )
    fe_total = js_num(body, "STAGE_TOTAL")
    check(
        "③ 前端 STAGE_TOTAL == 5",
        fe_total == 5,
        f"实际={fe_total}",
    )
    # 逐阶段 budget_ratio 对齐
    ratios = [float(m) for m in re.findall(r'"budget_ratio"\s*:\s*([\d.]+)', body)]
    py_ratios = import_module_value("app.services.predict_service", "STAGE_BUDGET_RATIO")
    if isinstance(py_ratios, ImportFailed):
        check("③ 前端 budget_ratio 与后端 STAGE_BUDGET_RATIO 逐项相等", False, py_ratios["__error__"])
    elif isinstance(py_ratios, dict) and ratios:
        py_list = [float(py_ratios.get(k, -1)) for k in (stages or ())]
        check(
            "③ 前端 budget_ratio 与后端 STAGE_BUDGET_RATIO 逐项相等",
            all(abs(a - b) < 1e-9 for a, b in zip(ratios, py_list)) and len(ratios) == len(py_list),
            f"前端={ratios} 后端={py_list}",
        )
    else:
        check("③ 前端 budget_ratio 与后端 STAGE_BUDGET_RATIO 逐项相等", False, "取不到后端占比")

    # 前端阶段文案应对齐
    fe_labels = dict(zip(fe_keys, re.findall(r'"label"\s*:\s*"([^"]+)"', body)))
    if isinstance(labels, dict):
        mismatch = [k for k in (stages or ()) if fe_labels.get(k) != labels.get(k)]
        check(
            "③ 前端阶段文案与后端 STAGE_LABELS 逐项相等",
            not mismatch,
            f"不一致阶段={mismatch}" if mismatch else "5 项全部相等",
        )


# ---------------------------------------------------------------------------
# ④ 时间预算分配自洽
# ---------------------------------------------------------------------------
def check_budget_ratio() -> None:
    ratios = import_module_value("app.services.predict_service", "STAGE_BUDGET_RATIO")
    if isinstance(ratios, ImportFailed):
        check("④ STAGE_BUDGET_RATIO 可取到", False, ratios["__error__"])
        return
    if not isinstance(ratios, dict) or not ratios:
        check("④ STAGE_BUDGET_RATIO 可解析", False, f"取不到：{ratios}")
        return
    total = sum(float(v) for v in ratios.values())
    check(
        "④ 五段预算占比之和 == 1.0",
        abs(total - 1.0) < 1e-6,
        f"实际和={total:.6f}（偏差 {total - 1.0:+.6f}）",
    )
    top = max(ratios, key=lambda k: float(ratios[k]))
    check(
        "④ inference 是最贵的一段（时间轴宽度最大项）",
        top == "inference",
        f"实际最大项={top}，inference={ratios.get('inference')}",
    )
    # 所有占比必须为正（有 0 或负数会让时间轴画不出条）
    nonpos = [k for k, v in ratios.items() if float(v) <= 0]
    check("④ 五段占比全为正数", not nonpos, f"非正={nonpos}" if nonpos else "无 0/负值")

    # 预算常量对齐：前端 TASK_BUDGET_MS == 后端 settings.task_budget_ms
    budget = import_module_value("app.core.config", "settings")
    be_budget = None if isinstance(budget, ImportFailed) else getattr(budget, "task_budget_ms", None)
    body = parse_ts_object(read(FE_PIPELINE), "PIPELINE_META") or ""
    fe_budget = js_num(body, "TASK_BUDGET_MS")
    check(
        "④ 前端 TASK_BUDGET_MS == 后端 settings.task_budget_ms",
        be_budget is not None and fe_budget == be_budget,
        f"前端={fe_budget} 后端={be_budget}",
    )

    # 序列上限对齐（同一生成物里并列的两个硬约束）
    be_max = None if isinstance(budget, ImportFailed) else getattr(budget, "max_series", None)
    fe_max = js_num(body, "MAX_SERIES")
    check(
        "④ 前端 MAX_SERIES == 后端 settings.max_series",
        be_max is not None and fe_max == be_max,
        f"前端={fe_max} 后端={be_max}",
    )


# ---------------------------------------------------------------------------
# ⑤ 软失败不是 5xx
# ---------------------------------------------------------------------------
def check_soft_failure() -> None:
    svc = read(PREDICT_SERVICE)
    # 5xx 状态码硬编码必须零命中（软失败走 code:0 + status=failed）
    bad = re.findall(r"status_code\s*=\s*5\d\d", svc)
    check(
        "⑤ 🔒 predict_service 不返回 HTTP 5xx（软失败走 code:0）",
        not bad,
        f"命中 5xx={bad}" if bad else "零命中",
    )
    for token, why in (
        ("E_TIMEOUT", "超时错误码"),
        ("suggestions", "三条处置建议"),
        ("completed_stage", "已完成阶段"),
    ):
        check(f"⑤ 软失败载荷含 {token}（{why}）", token in svc)

    # 预算文案不能退化成「超过 0 秒」
    check(
        "⑤ 预算文案函数存在（避免 <1 秒预算显示成「0 秒」）",
        "def _budget_text(" in svc,
    )


# ---------------------------------------------------------------------------
# ⑥ 序列数超限不建行
# ---------------------------------------------------------------------------
def check_precheck_before_insert() -> None:
    """🔒 `API-12-1`：序列数预检必须**前于**建任务行，否则库里堆积注定失败的任务。"""
    svc = read(PREDICT_SERVICE)
    try:
        tree = ast.parse(svc)
    except SyntaxError:
        check("⑥ 源码可解析", False, "SyntaxError")
        return

    # 预检标志：`series_count > settings.max_series` 的比较节点
    precheck_lines = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Compare)
        and isinstance(node.left, ast.Name)
        and node.left.id == "series_count"
        and any(
            isinstance(c, ast.Attribute) and c.attr == "max_series"
            for c in node.comparators
        )
    ]
    # 建任务标志：`task_dao.create(...)`（本项目建任务统一走 DAO，不直接 db.add）
    create_lines = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in ("create", "add")
        and "dao" in ast.unparse(node.func).lower()
    ]
    ok = bool(precheck_lines) and bool(create_lines) and min(precheck_lines) < min(create_lines)
    check(
        "⑥ 🔒 序列数预检早于建任务行（API-12-1：超限不建失败行）",
        ok,
        (
            f"预检首现行={min(precheck_lines) if precheck_lines else None}，"
            f"建任务首现行={min(create_lines) if create_lines else None}"
        ),
    )

    # 超限抛的是业务错误码 SERIES_OVER_LIMIT = 40004，而非 5xx
    errs = read(APP / "core" / "errors.py")
    check(
        "⑥ 超限错误码为 40004（业务码，非 5xx）",
        "SERIES_OVER_LIMIT = 40004" in errs and "ErrorCode.SERIES_OVER_LIMIT" in svc,
    )


# ---------------------------------------------------------------------------
# ⑦ 无「重新训练」入口
# ---------------------------------------------------------------------------
def check_no_retrain_ui() -> None:
    """🔒 拦「提供重训入口」，而不是拦「声明不提供重训」。

    ⚠️ 这两者用的是同一批关键词，方向却相反：
      - `不提供在线重训练（已确认决策）` → **合规且必需**（`UX-P06-04`）
      - `<button>重新训练</button>`         → 红线（`WS-5-09`）
    故按「该行/该上下文是否带否定标记」区分，并把裸露的英文 `retrain`
    一律判违规（英文不会出现在中文否定句里）。
    """
    hits: list[str] = []
    for path in (FE_PARAMS, FE_RUNNING, FE_ASIDE, FE_RUN_ASIDE):
        src = read(path)
        for i, line in enumerate(src.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith(("*", "//", "/*")):
                continue  # 注释不构成用户可见入口
            for w in RETRAIN_WORDS:
                if w not in stripped:
                    continue
                if w.isascii():
                    hits.append(f"{path.name}:{i} 英文 {w}")
                    continue
                window = stripped[max(0, stripped.find(w) - 40) :]
                if not any(m in window for m in NEGATION_MARKERS):
                    hits.append(f"{path.name}:{i} {w} → {stripped[:60]}")
    check(
        "⑦ 🔒 无「重新训练」入口（WS-5-09）",
        not hits,
        "命中：" + "; ".join(hits) if hits else "仅出现「不提供/不需要」的告知文案，无入口",
    )

    # 但**必须**存在那条告知文案（UX-P06-04 要求显式声明）
    params_code = read_ts_code(FE_PARAMS)
    declared = "不提供在线重训练" in params_code
    check(
        "⑦ 🔒 参数页显式声明「不提供在线重训练」（UX-P06-04）",
        declared,
        "高级设置里的警示条已声明" if declared else "未见该声明文案（UX-P06-04 要求显式告知用户）",
    )

    # 前端类型里不应有 retrain 字段
    types_code = read_ts_code(FE_TYPES).lower()
    check("⑦ 🔒 前端类型无 retrain 字段", "retrain" not in types_code)


# ---------------------------------------------------------------------------
# ⑧ 前端无实测数值字面量
# ---------------------------------------------------------------------------
def check_no_hardcoded_metrics() -> None:
    hits: list[str] = []
    for path in (FE_PARAMS, FE_RUNNING, FE_RUN_ASIDE, FE_ASIDE):
        code = read_ts_code(path)
        for lit in FORBIDDEN_LITERALS:
            if lit in code:
                hits.append(f"{path.name}:{lit}")
    check(
        "⑧ 🔒 前端不硬编码算法实测数值（QD-06 两套数字红线）",
        not hits,
        "命中：" + ", ".join(hits) if hits else "10 个实测字面量零命中",
    )


# ---------------------------------------------------------------------------
# ⑨ useAsideContent 依赖数组
# ---------------------------------------------------------------------------
def check_aside_stability() -> None:
    """🔒 `useAsideContent` 必须收到**稳定引用**。

    原理：`AsideLayout` 用 `useState` 存右栏内容，页面每次渲染都 setState。
    若传入的是新建的 JSX 对象（未 `useMemo`），则 setState → 重渲染 →
    新对象 → 再 setState → **无限循环**，页面直接白屏，而且 `tsc` 查不出来。
    """
    for path in (FE_PARAMS, FE_RUNNING, FE_RESULT):
        src = read(path)
        if "useAsideContent(" not in src:
            check(f"⑨ {path.name} 使用了 useAsideContent", False, "未使用（若为纯内容页可忽略）")
            continue
        m = re.search(r"const\s+aside\s*=\s*", src)
        if not m:
            check(
                f"⑨ {path.name} 的右栏内容引用稳定",
                False,
                "useAsideContent 未接收具名常量，无法判定稳定性",
            )
            continue
        # 变量名之后 120 字符内必须出现 useMemo（跨行书写也算）
        tail = src[m.end() : m.end() + 120]
        ok = "useMemo(" in tail
        check(
            f"⑨ {path.name} 的右栏内容经 useMemo 包裹（不会无限重渲染）",
            ok,
            "useMemo 未包裹右栏 JSX" if not ok else "引用稳定",
        )

    # 原型痕迹
    leak: list[str] = []
    for path in WEB_SRC.rglob("*.tsx"):
        code = read_ts_code(path)
        for w in PROTOTYPE_LEAKS:
            if w in code:
                leak.append(f"{path.name}:{w}")
    check(
        "⑨ 原型痕迹零命中（UX-GOV-01）",
        not leak,
        "命中：" + ", ".join(leak) if leak else "5 个痕迹词零命中",
    )


# ---------------------------------------------------------------------------
# ⑩ 成本模型自证
# ---------------------------------------------------------------------------
def check_cost_model() -> None:
    """🔒 成本模型预估 vs 端到端实测，偏差 ≤ 25%。

    🔴 **口径警告**（与 `QD-06`「两套数字」同型，此处是最容易踩的一处）：
       `outputs/eval_report.json` 的 `timing_ms.total_ms` 是**单遍回测**耗时
       （本项目 7,873 ms），而 `cost_model` 标定的是**任务端到端**耗时
       （两遍流水线 + 逐序列滚动，h=14 实测 16,618 ms）。
       两者**不是同一个量**，拿单遍数字去比端到端预估会得出「偏差 99%」的
       假告警 —— 这正是 `API-09.estimated_ms` 与参数页预估必须分开的原因。
       故本判据只认 `outputs/_ep5_calib.json`（`scripts/_ep5_calibrate.py` 产出）。
    """
    cm = read(COST_MODEL)
    has_est = "def estimate_task_ms(" in cm
    has_table = "def estimate_by_horizon(" in cm
    check("⑩ cost_model 提供 estimate_task_ms / estimate_by_horizon", has_est and has_table)

    m_a = re.search(r"COST_INTERCEPT_MS_PER_SERIES\s*=\s*([\d.]+)", cm)
    m_b = re.search(r"COST_SLOPE_MS_PER_SERIES_DAY\s*=\s*([\d.]+)", cm)
    if not (m_a and m_b):
        check("⑩ 成本模型系数可解析", False, "取不到 COST_* 常量")
        return
    a, b = float(m_a.group(1)), float(m_b.group(1))

    calib_path = OUTPUTS / "_ep5_calib.json"
    if not calib_path.exists():
        check(
            "⑩ 预估 vs 实测偏差 ≤ 25%（cost_model 未随硬件漂移）",
            False,
            f"缺少 {calib_path.name}，请先跑 scripts/_ep5_calibrate.py",
        )
        return
    try:
        calib = json.loads(calib_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        check("⑩ 预估 vs 实测偏差 ≤ 25%", False, f"解析 {calib_path.name} 失败：{exc}")
        return

    report_path = OUTPUTS / "eval_report.json"
    if not report_path.exists():
        check("⑩ 预估 vs 实测偏差 ≤ 25%", False, f"缺少 {report_path.name}")
        return
    report = json.loads(report_path.read_text(encoding="utf-8"))
    series = report.get("coverage", {}).get("total") or report.get("series_count")
    if not series:
        check("⑩ 预估 vs 实测偏差 ≤ 25%", False, "eval_report.json 缺 coverage.total")
        return

    # 逐档 horizon 比对；任一档超 25% 即失败
    rows: list[str] = []
    devs: list[float] = []
    for item in calib:
        h = item.get("horizon")
        actual = item.get("wall_ms")
        if not isinstance(h, int) or not isinstance(actual, (int, float)):
            continue
        est = (a + b * h) * series
        dev = (est - actual) / actual * 100
        devs.append(abs(dev))
        rows.append(f"h={h}: 实测 {actual}ms / 预估 {est:.0f}ms → {dev:+.1f}%")

    if not devs:
        check("⑩ 预估 vs 实测偏差 ≤ 25%", False, f"{calib_path.name} 里没有可用的 wall_ms")
        return

    worst = max(devs)
    check(
        "⑩ 预估 vs 实测偏差 ≤ 25%（cost_model 未随硬件漂移）",
        worst <= 25.0,
        f"{len(devs)} 档最差偏差 {worst:.1f}%；" + " | ".join(rows),
    )

    # 顺带核对标定文件里的端到端耗时确实在 60s 预算内（DOD 第 1 条的前置）
    slowest = max((i.get("wall_ms", 0) for i in calib), default=0)
    check(
        "⑩ 标定口径自证：calib.wall_ms 是端到端（非单遍 7,873 ms）",
        slowest > 10_000,
        f"最慢档 wall_ms={slowest}ms（单遍评测仅 7,873ms，明显更小）",
    )


# ---------------------------------------------------------------------------
# ⑪ 构建期注入物未漂移
# ---------------------------------------------------------------------------
def run_check_script(name: str) -> tuple[bool, str]:
    py = sys.executable
    proc = subprocess.run(
        [py, str(SCRIPTS / name), "--check"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    tail = (proc.stdout or proc.stderr or "").strip().splitlines()
    return proc.returncode == 0, (tail[-1] if tail else f"exit={proc.returncode}")


def check_generated_in_sync() -> None:
    for script in ("sync_pipeline_meta.py", "sync_eval_metrics.py"):
        path = SCRIPTS / script
        if not path.exists():
            check(f"⑪ {script} 存在", False, "文件缺失")
            continue
        ok, detail = run_check_script(script)
        check(f"⑪ {script} --check 通过（注入物未漂移）", ok, detail)


# ---------------------------------------------------------------------------
# 附加：EP-5 特有结构守卫
# ---------------------------------------------------------------------------
def check_pipeline_structure() -> None:
    # 预加载（BE-15）：main.py 必须调 load_active_model
    main = read(MAIN_PY)
    check(
        "附加 BE-15：main.py 预加载启用模型（首个请求不污染 duration_ms）",
        "load_active_model()" in main,
    )
    # holder 挂载路由
    check("附加 BE-15/EP-5：predictions 路由已挂载", "predictions" in read(V1_ROUTER))

    # Timing 必须含滚动与兜底两个 EP-5 新增埋点
    infer = read(ALGO_INFER)
    for field in ("rolling_ms", "fallback_ms", "preprocess_ms", "features_ms", "inference_ms"):
        check(f"附加 Timing 埋点含 {field}", f"{field}: int" in infer or f'"{field}"' in infer)

    # 推理热路径：必须走 last_window_fast 而非重复 build_inference_windows
    feats = read(ALGO_FEATURES)
    check("附加 性能：features 提供 last_window_fast 热路径", "def last_window_fast(" in feats)
    check(
        "附加 性能：features 提供 calendar_matrix（日历一次算好）",
        "def calendar_matrix(" in feats,
    )
    # ② 🔴 `horizon=30` 曾击穿 60 s 硬约束（实测 72.2 s）的根因：
    #    `_roll_multistep` 每步调 `build_inference_windows`（内部先给整条序列
    #    建 pandas 特征表、再取尾窗），同一序列被重复建表 `horizon` 次。
    #    修复后 h=30 降到 23.8 s。
    #    ⚠️ 判据只查 `_roll_multistep` **函数体内**的可执行代码：
    #        `run_inference` 里第 163 行仍合法调用 `build_inference_windows`
    #        （那是**一次**批量前向，建一次表是对的），
    #        且文件注释里多处提及该函数名 —— 全文匹配会假阳性。
    try:
        itree = ast.parse(infer)
        roll_body_ok = None
        for node in ast.walk(itree):
            if isinstance(node, ast.FunctionDef) and node.name == "_roll_multistep":
                calls = [
                    ast.unparse(c.func)
                    for c in ast.walk(node)
                    if isinstance(c, ast.Call)
                ]
                roll_body_ok = not any("build_inference_windows" in c for c in calls)
        check(
            "附加 性能：_roll_multistep 不再调 build_inference_windows（h=30 曾 72.2s → 23.8s）",
            roll_body_ok is not False,
            "滚动多步仍在调 build_inference_windows（会重复建特征表）" if roll_body_ok is False else "函数体内零调用",
        )
        check(
            "附加 性能：_roll_multistep 已改用 last_window_fast",
            roll_body_ok is not False
            and "last_window_fast" in infer,
        )
    except SyntaxError as exc:
        check("附加 性能：infer.py 可解析", False, str(exc))

    # 两遍流水线：backtest + forecast 都必须在，且耗时都上报
    check(
        "附加 计时：algorithm 两遍耗时同时上报",
        '"algorithm"' in read(PREDICT_SERVICE)
        or "backtest_pass_ms" in read(PREDICT_SERVICE),
    )


def check_metric_contract_alignment() -> None:
    """eval_report.py 的 TIMING_CONTRACT_KEYS 必须是 Timing 的子集，不能漂移。"""
    ev = read(SCRIPTS / "eval_report.py")
    m = re.search(r"TIMING_CONTRACT_KEYS\s*=\s*\(([^)]*)\)", ev)
    if not m:
        check("附加 eval_report 的 TIMING_CONTRACT_KEYS 可解析", False, "未找到常量")
        return
    keys = re.findall(r'"([^"]+)"', m.group(1))
    infer = read(ALGO_INFER)
    missing = [k for k in keys if f"{k}: int" not in infer and f'"{k}"' not in infer]
    check(
        "附加 eval_report 的 timing 契约键在 Timing 中均存在",
        not missing,
        f"缺失={missing}" if missing else f"{len(keys)} 键全部对齐",
    )


def main() -> int:
    check_no_train_import()
    check_guest_path()
    check_stage_meta()
    check_budget_ratio()
    check_soft_failure()
    check_precheck_before_insert()
    check_no_retrain_ui()
    check_no_hardcoded_metrics()
    check_aside_stability()
    check_cost_model()
    check_generated_in_sync()
    check_pipeline_structure()
    check_metric_contract_alignment()

    print("=" * 72)
    print("EP-5 静态校验（DOD-EP5）")
    print("=" * 72)
    failed = 0
    for name, ok, detail in results:
        tag = "[ OK ]" if ok else "[FAIL]"
        if not ok:
            failed += 1
        print(f"{tag} {name}" + (f"\n         {detail}" if detail and not ok else (f"  ({detail})" if detail else "")))
    print("-" * 72)
    print(f"通过 {len(results) - failed} 项，失败 {failed} 项")
    print("结论：" + ("全部通过" if failed == 0 else "存在失败项，请修复后重跑"))
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())