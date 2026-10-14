"""`datasets` 数据集表 ORM 实体（`DB-T02`）。

对应 `code/db/schema.sql` 的 `T02` 段。本表只存**元信息与统计摘要**，
原始 CSV 保留在文件系统（`FR-SYS-08`）。
"""
from __future__ import annotations

from sqlalchemy import INTEGER, TEXT, CheckConstraint, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# datasets.status 取值域（`DB-08` 软删除语义，注意不是 0/1）
STATUS_ACTIVE = 1
STATUS_INVALID = -1


class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (
        CheckConstraint("is_sample IN (0, 1)", name="ck_datasets_is_sample"),
        CheckConstraint("status IN (1, -1)", name="ck_datasets_status"),
        Index("ix_datasets_user", "user_id", text("created_at DESC")),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(INTEGER, primary_key=True, autoincrement=True)
    # 归属用户；0 = 游客哨兵（FR-USR-08）
    user_id: Mapped[int] = mapped_column(
        INTEGER, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    file_name: Mapped[str] = mapped_column(TEXT, nullable=False)
    stored_name: Mapped[str] = mapped_column(TEXT, nullable=False)
    file_path: Mapped[str] = mapped_column(TEXT, nullable=False)
    file_size: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    row_count: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    sku_count: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    warehouse_count: Mapped[int | None] = mapped_column(
        INTEGER, nullable=True, default=None
    )
    valid_series_count: Mapped[int | None] = mapped_column(
        INTEGER, nullable=True, default=None
    )
    date_start: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    date_end: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    gap_filled: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("0")
    )
    gap_count: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("0")
    )
    is_sample: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("0")
    )
    status: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("1")
    )
    created_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )
    updated_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<Dataset id={self.id} user_id={self.user_id} name={self.file_name!r}>"
