"""`events` 表数据访问（`DB-T08`）。

🔒 纯 CRUD。埋点写入**失败不得抛异常**（PRD §5.1）——由 `services` 层决定吞掉，
   本层只提供 `record()`；同时提供 `record_safe()` 供调用方在 try 内使用。

🔒 本模块不得 `import algo`。
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.event import Event

logger = logging.getLogger(__name__)

__all__ = ["record", "record_safe", "count_by_name", "count_all", "list_recent"]


def record(
    db: Session,
    *,
    event_name: str,
    user_id: int | None = None,
    task_id: int | None = None,
    properties: dict | None = None,
) -> Event:
    """写入一条埋点。`properties` 为 dict，落库前 `json.dumps`。"""
    row = Event(
        event_name=event_name,
        user_id=user_id,
        task_id=task_id,
        properties=json.dumps(properties, ensure_ascii=False) if properties else None,
    )
    db.add(row)
    db.flush()
    return row


def record_safe(db: Session, **kwargs) -> Event | None:
    """埋点写入的容错版本：**任何异常都吞掉，只记日志**。

    `FR-SYS-03` / PRD §5.1：埋点失败不得阻塞主流程。故调用方应优先使用本函数。
    """
    try:
        return record(db, **kwargs)
    except Exception:  # pragma: no cover - 防御性分支
        logger.warning("埋点写入失败（已忽略）event_name=%s", kwargs.get("event_name"))
        return None


def count_by_name(db: Session, *, since: str | None = None) -> dict[str, int]:
    """按事件名分组计数（看板「埋点概览」`API-22`）。"""
    stmt = select(Event.event_name, func.count()).group_by(Event.event_name)
    if since:
        stmt = stmt.where(Event.created_at >= since)
    return {name: n for name, n in db.execute(stmt).all()}


def count_all(db: Session) -> int:
    return int(db.execute(select(func.count()).select_from(Event)).scalar_one())


def list_recent(db: Session, limit: int = 50) -> list[Event]:
    stmt = select(Event).order_by(Event.created_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())
