"""`metrics` 表数据访问（`DB-T05`）。

与 `tasks` 一对一（`task_id` 唯一）。🔒 纯 CRUD。

🔒 本模块不得 `import algo`。
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.metric import Metric

__all__ = [
    "get_by_task",
    "create",
    "list_recent",
    "list_by_task_ids",
    "avg_mape_recent",
    "count_by_task",
    "delete_by_task",
]


def get_by_task(db: Session, task_id: int) -> Metric | None:
    """按任务取指标（一对一）。"""
    stmt = select(Metric).where(Metric.task_id == task_id)
    return db.execute(stmt).scalars().first()


def create(db: Session, *, task_id: int, **fields) -> Metric:
    """写入指标行。字段由调用方（`services/predict_service.py`）按 `metrics` 列名提供。"""
    row = Metric(task_id=task_id, **fields)
    db.add(row)
    db.flush()
    return row


def list_recent(db: Session, limit: int = 20) -> list[Metric]:
    """最近 N 条指标（看板 MAPE 走势，`API-22`）。"""
    stmt = select(Metric).order_by(Metric.created_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())


def list_by_task_ids(db: Session, task_ids: list[int]) -> list[Metric]:
    """一次取回一批任务的指标（看板 MAPE 走势，`API-22`）。

    🔒 存在的理由是**避免 N+1**：看板要展示最近 20 个任务的折线，
    逐个调`get_by_task` 就是 20 次查询；这里一条 `IN (...)` 搞定。
    ⚠️ 返回顺序**不保证**与 `task_ids` 一致 —— 调用方需自己按 id 建字典
       再按自己的顺序输出（`admin_service._mape_trend` 就是这么做的）。
    """
    if not task_ids:
        return []
    stmt = select(Metric).where(Metric.task_id.in_(task_ids))
    return list(db.execute(stmt).scalars().all())


def count_by_task(db: Session, task_id: int) -> int:
    """按任务计数（管理端硬删除前统计级联行数，`API-27`）。

    ⚠️ `metrics` 与 `tasks` 是一对一，理论上恒为 0 或 1。
       **仍然要查**：万一是历史脏数据或未来支持多轮评测，这个数字就是
       「这一下删掉了几行」的准确回执 —— 不可逆操作必须有回执。
    """
    stmt = select(func.count()).select_from(Metric).where(Metric.task_id == task_id)
    return int(db.execute(stmt).scalar_one())


def avg_mape_recent(db: Session, days: int = 30) -> float | None:
    """近 N 天加权 MAPE 均值（仅统计有值的行）。

    ⚠️ 这是**看板用的粗略趋势值**，不是验收指标——验收指标是逐任务的口径
       （见数据库设计文档 §11.2），不可互相替代。
    """
    stmt = select(func.avg(Metric.mape)).where(
        Metric.mape.is_not(None),
        Metric.created_at >= func.datetime("now", f"-{int(days)} days", "localtime"),
    )
    val = db.execute(stmt).scalar_one_or_none()
    return round(float(val), 2) if val is not None else None


def delete_by_task(db: Session, task_id: int) -> int:
    return db.query(Metric).filter(Metric.task_id == task_id).delete(
        synchronize_session=False
    )
