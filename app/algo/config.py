"""配置常量 —— 全部取自 PRD / 开发方案附录 C 的已确认决策，**不得在代码里另起炉灶**。

修改任何一项都必须同步 PRD 与开发方案，否则视为偏离需求。
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ---------------------------------------------------------------- 数据契约
# PRD §3.2：CSV 字段强制契约（列名不可改）
COL_SKU = "sku_id"
COL_WAREHOUSE = "warehouse_id"
COL_DATE = "date"
COL_SALES = "sales"

REQUIRED_COLUMNS: tuple[str, ...] = (COL_SKU, COL_WAREHOUSE, COL_DATE, COL_SALES)

# PRD §3.2：校验顺序**不可调整**（越靠前的越快失败，用户体验越好）
VALIDATE_ORDER: tuple[str, ...] = (
    "扩展名", "大小/行数", "表头完整性", "日期可解析性", "销量非负", "时间连续性", "序列数上限",
)

MAX_FILE_SIZE_MB = 20
MAX_ROWS = 500_000
MAX_SERIES = 1000

# ---------------------------------------------------------------- 分级阈值
# 附录 C-2 / PRD FR-MOD-05：有效历史长度达到该值才允许进 LSTM
L1_MIN_VALID_POINTS = 90

# ---------------------------------------------------------------- 硬指标
# PRD §3.4.3
WEIGHTED_MAPE_LIMIT = 20.0        # 🔒 加权 MAPE ≤ 20%
BASELINE_IMPROVE_LIMIT = 15.0     # 🔒 相对移动平均基线降低 ≥ 15%
SERIES_PASS_RATE_TARGET = 60.0    # 🔒 达标序列占比 ≥ 60%
SERIES_MAPE_THRESHOLD = 20.0      # 单序列「达标」的判定阈值

# ---------------------------------------------------------------- 模型默认
# ⚠️ 训练目标恒为「归一化残差 (y - ŷ_base)/σ」，见 features.target_mode（防压平，实测关键）
#    原因：直接回归 y/σ 时，模型在多步递归中会向序列均值收缩，
#    预测值波动只有真值的 26%（scripts/diag_bias.py 实测），
#    导致 MAE 改善远低于 RMSE 改善、达标序列占比上不去。
#    改学残差后模型只需输出"相对基线的偏移量"，不必重建绝对水平。
HIDDEN_SIZE = 48
NUM_LAYERS = 2
WINDOW_SIZE = 21
DROPOUT = 0.1
BATCH_SIZE = 128
LR = 1e-3
MAX_EPOCHS = 120
PATIENCE = 20             # 早停耐心值
LR_DECAY_GAMMA = 0.5      # 学习率衰减
LR_DECAY_STEP = 30
GRAD_CLIP = 1.0

# 移动平均基线：用与模型**同一测试段、同一序列集合**的历史均值外推
BASELINE_WINDOW = 7

# 退化序列阈值：σ 小于这个值的序列几乎恒定，不参与训练。
# 理由：残差要除以 σ，σ≈0 会把噪声放大成 10~15 倍的伪信号，
# 在池化损失里权重压倒性地大，把模型整体带偏（实测确实存在 σ=0.03 的全零序列）。
# 这类序列用移动平均已是最优解，不需要模型。
MIN_USABLE_SIGMA = 0.5

# 网格搜索（离线调参用；受 1 分钟 SLA 约束，只在离线跑）
GRID_HIDDEN = (16, 32, 64)
GRID_LAYERS = (1, 2)
GRID_WINDOW = (7, 14, 21)

# ---------------------------------------------------------------- 在线预算
SLA_SECONDS = 60

# 允许的预测步长（PRD FR-MOD-02 的三档）。
# 单一定义在此，`schemas.ALLOWED_HORIZONS`、`predict_service._ALLOWED_HORIZONS`
# 与 `services.cost_model.estimate_by_horizon` 都引用它 —— 步长档位是
# 「参数页选项 / 后端校验 / 耗时预估」三处共同的物理量，各写一遍必然漂移。
HORIZONS: tuple[int, ...] = (7, 14, 30)


@dataclass
class TaskConfig:
    """一次预测任务的运行参数（在线从请求构造，离线从 CLI 构造）。"""

    horizon: int = 7                       # 预测步长，仅允许 7 / 14 / 30
    window: int = WINDOW_SIZE
    use_holiday: bool = True
    model_version: str = "lstm_v1"
    granularity: str = "warehouse_sku"     # 📌 已固定，不提供其他选项
    device: str = "auto"                   # auto | cuda | cpu

    def __post_init__(self) -> None:
        if self.horizon not in HORIZONS:
            raise ValueError(f"horizon 只允许 {' / '.join(map(str, HORIZONS))}，收到 {self.horizon}")
        if self.granularity != "warehouse_sku":
            raise ValueError("预测粒度已固定为 warehouse_sku（附录 C-2）")


@dataclass
class LevelCounts:
    """三级覆盖计数（写入 task.l1_count / l2_count / l3_count）。"""

    L1: int = 0
    L2: int = 0
    L3: int = 0

    @property
    def total(self) -> int:
        return self.L1 + self.L2 + self.L3

    def as_dict(self) -> dict[str, int]:
        return {"L1": self.L1, "L2": self.L2, "L3": self.L3, "total": self.total}


@dataclass
class Metrics:
    """任务级评估指标（写入 metrics 表）。字段名与 PRD §3.4.3 一致。"""

    weighted_mape: float = float("nan")
    weighted_mae: float = float("nan")
    weighted_rmse: float = float("nan")
    baseline_mae: float = float("nan")
    baseline_rmse: float = float("nan")
    mae_improve_pct: float = float("nan")
    rmse_improve_pct: float = float("nan")
    series_evaluated: int = 0
    series_passed: int = 0
    series_pass_rate: float = float("nan")
    l1_mape: float = float("nan")
    l2_mape: float = float("nan")
    levels: LevelCounts = field(default_factory=LevelCounts)

    @property
    def mape_ok(self) -> bool:
        return self.weighted_mape <= WEIGHTED_MAPE_LIMIT

    @property
    def baseline_ok(self) -> bool:
        return (self.mae_improve_pct >= BASELINE_IMPROVE_LIMIT
                and self.rmse_improve_pct >= BASELINE_IMPROVE_LIMIT)

    @property
    def pass_rate_ok(self) -> bool:
        return self.series_pass_rate >= SERIES_PASS_RATE_TARGET

    @property
    def all_ok(self) -> bool:
        return self.mape_ok and self.baseline_ok and self.pass_rate_ok
