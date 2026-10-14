"""`events` 埋点事件表 ORM 实体（`DB-T08`）。

对应 `code/db/schema.sql` 的 `T08` 段。

📌 独立于 `operation_logs`：前者面向**指标分析**（可归档），后者面向**排障审计**
   （须长期保留）。`event_name` **刻意不加 CHECK**，以便快速增减事件而不改表。

🔒 写入失败仅记日志、不抛异常（PRD §5.1 埋点实现要求），不得阻塞主流程。
"""
from __future__ import annotations

from sqlalchemy import INTEGER, TEXT, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_name_time", "event_name", text("created_at DESC")),
        Index("ix_events_task", "task_id"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(INTEGER, primary_key=True, autoincrement=True)
    # 如 EV-PRED-02 -> prediction_complete
    event_name: Mapped[str] = mapped_column(TEXT, nullable=False)
    # 未登录为 0，系统触发为 NULL
    user_id: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    task_id: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    # JSON 字符串
    properties: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    created_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<Event id={self.id} name={self.event_name!r}>"
