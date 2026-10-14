"""`model_registry` 模型版本表 ORM 实体（`DB-T06`）。

对应 `code/db/schema.sql` 的 `T06` 段。在线推理完全依赖本表取权重，
故 `is_active = 1` 的记录必须存在且唯一。

🔒 部分唯一索引 `ux_model_active ON model_registry (is_active) WHERE is_active = 1`
   保证「全局有且仅有一个启用版本」。因此切换版本时**必须在同一事务内先降后升**
   （`BE-ADM-02`）：先 `UPDATE ... SET is_active=0 WHERE is_active=1`，
   再 `UPDATE ... SET is_active=1 WHERE version=?`。顺序颠倒或分两次提交都会
   撞 `UNIQUE constraint failed: model_registry.is_active`（实测）。
"""
from __future__ import annotations

from sqlalchemy import INTEGER, REAL, TEXT, CheckConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ModelRegistry(Base):
    __tablename__ = "model_registry"
    __table_args__ = (
        CheckConstraint("is_active IN (0, 1)", name="ck_model_registry_is_active"),
        # 部分唯一索引：保证有且仅有一个启用版本
        Index(
            "ux_model_active",
            "is_active",
            unique=True,
            sqlite_where=text("is_active = 1"),
        ),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(INTEGER, primary_key=True, autoincrement=True)
    version: Mapped[str] = mapped_column(TEXT, nullable=False, unique=True)
    file_path: Mapped[str] = mapped_column(TEXT, nullable=False)
    # ---- 超参数（与 app/algo/config.py 生产配置一致） ----
    window_size: Mapped[int] = mapped_column(INTEGER, nullable=False)
    hidden_size: Mapped[int] = mapped_column(INTEGER, nullable=False)
    num_layers: Mapped[int] = mapped_column(INTEGER, nullable=False)
    dropout: Mapped[float] = mapped_column(REAL, nullable=False)
    learning_rate: Mapped[float] = mapped_column(REAL, nullable=False)
    batch_size: Mapped[int] = mapped_column(INTEGER, nullable=False)
    # ---- 训练上下文 ----
    train_data_range: Mapped[str | None] = mapped_column(
        TEXT, nullable=True, default=None
    )
    train_row_count: Mapped[int | None] = mapped_column(
        INTEGER, nullable=True, default=None
    )
    series_count: Mapped[int | None] = mapped_column(
        INTEGER, nullable=True, default=None
    )
    # ---- 验证集指标（加权口径） ----
    val_mae: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    val_rmse: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    val_mape: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    # ---- 环境与资源 ----
    device: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    peak_memory_mb: Mapped[float | None] = mapped_column(
        REAL, nullable=True, default=None
    )
    param_count: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    # ---- 状态 ----
    is_active: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("0")
    )
    trained_at: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    created_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<ModelRegistry version={self.version!r} active={self.is_active}>"
