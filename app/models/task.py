"""`tasks` 预测任务表 ORM 实体（`DB-T03`）。

对应 `code/db/schema.sql` 的 `T03` 段。状态机见数据库设计文档 §3.3：
`created → running → succeeded | failed`（`FIG-06`）。
"""
from __future__ import annotations

from sqlalchemy import INTEGER, TEXT, CheckConstraint, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# 任务状态机
STATUS_CREATED = "created"
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"

# 粒度（本期固定主粒度）
GRANULARITY_WAREHOUSE_SKU = "warehouse_sku"

# 允许的预测步长
ALLOWED_HORIZONS = (7, 14, 30)


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "granularity IN ('warehouse_sku')", name="ck_tasks_granularity"
        ),
        CheckConstraint("horizon IN (7, 14, 30)", name="ck_tasks_horizon"),
        CheckConstraint("use_holiday_feature IN (0, 1)", name="ck_tasks_holiday"),
        CheckConstraint(
            "status IN ('created', 'running', 'succeeded', 'failed')",
            name="ck_tasks_status",
        ),
        CheckConstraint("is_deleted IN (0, 1)", name="ck_tasks_is_deleted"),
        Index("ix_tasks_user_list", "user_id", "is_deleted", text("created_at DESC")),
        Index("ix_tasks_status", "status"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(INTEGER, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        INTEGER, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # RESTRICT：数据集被任务引用时不得删除（实测生效）
    dataset_id: Mapped[int] = mapped_column(
        INTEGER, ForeignKey("datasets.id", ondelete="RESTRICT"), nullable=False
    )
    task_name: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    granularity: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("'warehouse_sku'")
    )
    horizon: Mapped[int] = mapped_column(INTEGER, nullable=False)
    use_holiday_feature: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("1")
    )
    status: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("'created'")
    )
    error_code: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    error_msg: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    completed_stage: Mapped[str | None] = mapped_column(
        TEXT, nullable=True, default=None
    )
    # 必填：在线无「本次训练的模型」（Q6 纯预训练推理）
    model_version: Mapped[str] = mapped_column(TEXT, nullable=False)
    device: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    device_fallback: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("0")
    )
    series_total: Mapped[int | None] = mapped_column(
        INTEGER, nullable=True, default=None
    )
    l1_count: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    l2_count: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    l3_count: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    duration_ms: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    started_at: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    finished_at: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    # 软删除（FR-HIS-05）；管理端为硬删除（CH-01）
    is_deleted: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("0")
    )
    created_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )
    updated_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<Task id={self.id} status={self.status!r} horizon={self.horizon}>"
