"""`operation_logs` 表数据访问（`DB-T07`）。

🔒 纯 CRUD。写入函数**不抛异常**由调用方（`services`）决定；但按 `FR-SYS-03`
   审计要求，业务主流程失败也必须留下痕迹，故提供 `record()` 统一入口。

🔒 本模块不得 `import algo`。
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.operation_log import (
    ACTION_ADMIN,
    ALL_ACTIONS,
    RESULT_FAIL,
    RESULT_SUCCESS,
    OperationLog,
)

__all__ = [
    "ACTION_ADMIN",
    "ALL_ACTIONS",
    "RESULT_SUCCESS",
    "RESULT_FAIL",
    "record",
    "list_paged",
    "count",
    "count_by_action",
]


def record(
    db: Session,
    *,
    action: str,
    result: str = RESULT_SUCCESS,
    user_id: int | None = None,
    target_id: str | int | None = None,
    detail: str | None = None,
    ip: str | None = None,
) -> OperationLog:
    """写入一条操作日志。

    :param user_id: **可为 0（游客）或 None（完全未登录）**。注意取值域是
                    「≥ 0 或 NULL」，不是「≥ 1 或 NULL」——游客操作同样要留痕。
    :param detail:  管理端子动作的承载字段（`action='admin'` 时），
                    形如 `sub=user_disable;target_user=3;by=1`。
    """
    row = OperationLog(
        user_id=user_id,
        action=action,
        target_id=None if target_id is None else str(target_id),
        result=result,
        detail=detail,
        ip=ip,
    )
    db.add(row)
    db.flush()
    return row


def list_paged(
    db: Session,
    *,
    page: int = 1,
    size: int = 20,
    action: str | None = None,
    result: str | None = None,
    user_id: int | None = None,
    start: str | None = None,
    end: str | None = None,
) -> list[OperationLog]:
    """操作日志查询（管理端 `API-30`）。"""
    stmt = select(OperationLog)
    if action:
        stmt = stmt.where(OperationLog.action == action)
    if result:
        stmt = stmt.where(OperationLog.result == result)
    if user_id is not None:
        stmt = stmt.where(OperationLog.user_id == user_id)
    if start:
        stmt = stmt.where(OperationLog.created_at >= start)
    if end:
        stmt = stmt.where(OperationLog.created_at <= end)
    stmt = (
        stmt.order_by(OperationLog.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    return list(db.execute(stmt).scalars().all())


def count(
    db: Session,
    *,
    action: str | None = None,
    result: str | None = None,
    user_id: int | None = None,
) -> int:
    stmt = select(func.count()).select_from(OperationLog)
    if action:
        stmt = stmt.where(OperationLog.action == action)
    if result:
        stmt = stmt.where(OperationLog.result == result)
    if user_id is not None:
        stmt = stmt.where(OperationLog.user_id == user_id)
    return int(db.execute(stmt).scalar_one())


def count_by_action(db: Session, *, since: str | None = None) -> dict[str, int]:
    """按动作分组计数（看板）。"""
    stmt = select(OperationLog.action, func.count()).group_by(OperationLog.action)
    if since:
        stmt = stmt.where(OperationLog.created_at >= since)
    return {a: n for a, n in db.execute(stmt).all()}
