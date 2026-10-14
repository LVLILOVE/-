"""`metrics` 任务指标表 ORM 实体（`DB-T05`）。

对应 `code/db/schema.sql` 的 `T05` 段。与 `tasks` **一对一**（`task_id` 唯一）。

⚠️ 指标口径（📌 已确认，见数据库设计文档 §11.2 与开发方案附录 C）：
    · 主指标 = **销量加权 MAPE**（Σ|e| / Σ|y|，即 WAPE），不是逐序列 MAPE 的算术平均
    · 基线 = **移动平均**，且必须与模型在**同预测点、同序列集合**上计算
    · 分组指标 L1/L2 必须分开统计，**不得混算后宣称达标**

⚠️ `baseline_mape` 是**预留列恒 NULL**（`TD-DB-04`）：`app/algo/metrics.py`
   目前只产出 `baseline_mae` / `baseline_rmse`，不产出 `baseline_mape`。
"""
from __future__ import annotations

from sqlalchemy import INTEGER, REAL, TEXT, CheckConstraint, ForeignKey, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# 硬指标阈值（PRD §3.4.3）
THRESHOLD_MAPE = 20.0          # 加权 MAPE <= 20%
THRESHOLD_IMPROVE_PCT = 15.0   # 相对移动平均基线降低 >= 15%
THRESHOLD_PASS_RATE = 60.0     # 达标序列占比 >= 60%


class Metric(Base):
    __tablename__ = "metrics"
    __table_args__ = (
        CheckConstraint(
            "is_over_threshold IN (0, 1)", name="ck_metrics_over_threshold"
        ),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(INTEGER, primary_key=True, autoincrement=True)
    # 一对一：UNIQUE
    task_id: Mapped[int] = mapped_column(
        INTEGER,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    # ---- 主指标（加权口径） ----
    mape: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    mae: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    rmse: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    # ---- 移动平均基线 ----
    # ⚠️ 预留列恒 NULL，见模块 docstring（TD-DB-04）
    baseline_mape: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    baseline_mae: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    baseline_rmse: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    # ---- 相对基线提升幅度 ----
    mae_improve_pct: Mapped[float | None] = mapped_column(
        REAL, nullable=True, default=None
    )
    rmse_improve_pct: Mapped[float | None] = mapped_column(
        REAL, nullable=True, default=None
    )
    # ---- 达标序列占比 ----
    series_evaluated: Mapped[int | None] = mapped_column(
        INTEGER, nullable=True, default=None
    )
    series_passed: Mapped[int | None] = mapped_column(
        INTEGER, nullable=True, default=None
    )
    series_pass_rate: Mapped[float | None] = mapped_column(
        REAL, nullable=True, default=None
    )
    # ---- 分组指标（L1 / L2 分开） ----
    l1_mape: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    # ⚠️ L2 可能为 NaN，序列化时必须转 null（API-14-2 / TQ-16）
    l2_mape: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    # ---- 判定与披露 ----
    is_over_threshold: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("0")
    )
    eval_note: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    distribution_json: Mapped[str | None] = mapped_column(
        TEXT, nullable=True, default=None
    )
    timing_json: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    created_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<Metric task_id={self.task_id} mape={self.mape}>"
