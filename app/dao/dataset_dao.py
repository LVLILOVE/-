"""`datasets` 表数据访问（`DB-T02`）。

🔒 纯 CRUD。所有查询**必须**携带 `user_id` 过滤（`NFR-SEC-02` 隔离红线）——
   唯一例外是 `count_all()`，仅供 `admin.py` 使用（`CH-01`）。

🔒 本模块不得 `import algo`。
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.dataset import STATUS_ACTIVE, Dataset

__all__ = [
    "STATUS_ACTIVE",
    "get_by_id",
    "get_owned",
    "get_sample_for_user",
    "create",
    "update_stats",
    "set_status",
    "list_by_user",
    "count_by_user",
    "count_all",
]


def get_by_id(db: Session, dataset_id: int) -> Dataset | None:
    """按主键取（内部使用；对外请用 `get_owned`）。"""
    return db.get(Dataset, dataset_id)


def get_owned(db: Session, dataset_id: int, user_id: int) -> Dataset | None:
    """取「属于该用户」的数据集。**隔离红线落实点。**"""
    stmt = select(Dataset).where(
        Dataset.id == dataset_id, Dataset.user_id == user_id
    )
    return db.execute(stmt).scalars().first()


def get_sample_for_user(db: Session, user_id: int) -> Dataset | None:
    """取该用户已存在的内置示例数据集（`FR-UPL-02` 惰性创建 + 幂等）。"""
    stmt = select(Dataset).where(
        Dataset.user_id == user_id,
        Dataset.is_sample == 1,
        Dataset.status == STATUS_ACTIVE,
    )
    return db.execute(stmt).scalars().first()


def create(
    db: Session,
    *,
    user_id: int,
    file_name: str,
    stored_name: str,
    file_path: str,
    file_size: int | None = None,
    is_sample: int = 0,
) -> Dataset:
    """插入数据集元信息并 flush。"""
    row = Dataset(
        user_id=user_id,
        file_name=file_name,
        stored_name=stored_name,
        file_path=file_path,
        file_size=file_size,
        is_sample=is_sample,
    )
    db.add(row)
    db.flush()
    return row


def update_stats(
    db: Session,
    dataset_id: int,
    *,
    row_count: int | None = None,
    sku_count: int | None = None,
    warehouse_count: int | None = None,
    valid_series_count: int | None = None,
    date_start: str | None = None,
    date_end: str | None = None,
    gap_filled: int | None = None,
    gap_count: int | None = None,
) -> int:
    """回填解析统计结果（上传校验完成后写入）。"""
    values: dict = {}
    for col, val in (
        ("row_count", row_count),
        ("sku_count", sku_count),
        ("warehouse_count", warehouse_count),
        ("valid_series_count", valid_series_count),
        ("date_start", date_start),
        ("date_end", date_end),
        ("gap_filled", gap_filled),
        ("gap_count", gap_count),
    ):
        if val is not None:
            values[col] = val
    if not values:
        return 0
    return (
        db.query(Dataset)
        .filter(Dataset.id == dataset_id)
        .update(values, synchronize_session=False)
    )


def set_status(db: Session, dataset_id: int, status: int) -> int:
    """置 `1` 可用 / `-1` 已失效。"""
    return (
        db.query(Dataset)
        .filter(Dataset.id == dataset_id)
        .update({Dataset.status: status}, synchronize_session=False)
    )


def list_by_user(
    db: Session, user_id: int, *, limit: int | None = None
) -> list[Dataset]:
    """按用户列出数据集，按创建时间倒序（命中 `IX-02`）。"""
    stmt = (
        select(Dataset)
        .where(Dataset.user_id == user_id, Dataset.status == STATUS_ACTIVE)
        .order_by(Dataset.created_at.desc())
    )
    if limit:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())


def count_by_user(db: Session, user_id: int) -> int:
    stmt = select(func.count()).select_from(Dataset).where(Dataset.user_id == user_id)
    return int(db.execute(stmt).scalar_one())


def count_all(db: Session) -> int:
    """全量计数（管理端看板 `API-22`）。**隔离红线例外，仅 admin.py 可调用。**"""
    return int(db.execute(select(func.count()).select_from(Dataset)).scalar_one())
