"""`predictions` 表数据访问（`DB-T04`）。

🔒 纯 CRUD。本表是本项目**唯一的高基数表**（示例规模 1,582 行 / 任务，
   上限约 300 万行），因此写入必须批量（`WS`-级要求见 `FR-*` 与 `NFR-REL-04`）。

🔒 本模块不得 `import algo`。
"""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.models.prediction import (
    EXPORT_COLUMNS,
    LEVEL_L1,
    LEVEL_L2,
    LEVEL_L3,
    Prediction,
)

__all__ = [
    "LEVEL_L1",
    "LEVEL_L2",
    "LEVEL_L3",
    "EXPORT_COLUMNS",
    "SORTABLE_COLUMNS",
    "bulk_insert",
    "list_by_task",
    "list_paged",
    "list_sorted_paged",
    "count_by_task",
    "count_filtered",
    "count_by_level",
    "delete_by_task",
    "distinct_series_by_level",
    "iter_all_for_export",
]


# 🔒 `API-15` 排序列白名单（`FR-VIS-03`「支持按任意列排序」的落地边界）。
#
# ⚠️ **为什么必须有白名单，而不能把 `sort_by` 直接拼进 `order_by()`**：
#    `sort_by` 来自查询串，是外部可控输入。`order_by(getattr(Prediction, sort_by))`
#    看似方便，但 `sort_by=__tablename__` 或 `sort_by=task_id` 就会改变语义，
#    更危险的是拼字符串写法下 `"id; DROP TABLE predictions--"` 直接构成注入。
#    SQLAlchemy 的属性访问形式确实不吃注入，但**白名单还能顺带挡住
#    「排序列不存在 → 500」这类用户可触发的错误**：非法值一律退回默认列，
#    由服务层按需提示，而不是抛 SQLAlchemy 的 AttributeError。
SORTABLE_COLUMNS: dict[str, object] = {
    "sku_id": Prediction.sku_id,
    "warehouse_id": Prediction.warehouse_id,
    "forecast_date": Prediction.forecast_date,
    "predicted_value": Prediction.predicted_value,
    "actual_value": Prediction.actual_value,
    "error": Prediction.predicted_value,   # 语义别名，见 sort_rows 注释
    "granularity_level": Prediction.granularity_level,
}
DEFAULT_SORT = "sku_id"


def bulk_insert(db: Session, rows: Iterable[dict]) -> int:
    """批量写入预测明细。

    🔒 必须使用 `bulk_insert_mappings`（SQLAlchemy 会合并为多值 INSERT），
       **禁止**逐行 `db.add()` + `commit()` —— 1,582 行逐行提交在 WAL 下会
       产生 1,582 次 fsync，端到端 60s 硬指标会被直接击穿（`NFR-REL-04`）。
    """
    payload = list(rows)
    if not payload:
        return 0
    db.bulk_insert_mappings(Prediction, payload)
    return len(payload)


def list_by_task(
    db: Session, task_id: int, *, limit: int | None = None, offset: int = 0
) -> list[Prediction]:
    """按任务取明细（结果页 / 导出）。排序与 `EXPORT_COLUMNS` 的前三列一致。"""
    stmt = (
        select(Prediction)
        .where(Prediction.task_id == task_id)
        .order_by(Prediction.sku_id, Prediction.warehouse_id, Prediction.forecast_date)
    )
    if limit:
        stmt = stmt.limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def list_paged(
    db: Session, task_id: int, *, page: int = 1, size: int = 50
) -> list[Prediction]:
    """结果明细分页（`FR-VIS-03`）。"""
    return list_by_task(db, task_id, limit=size, offset=(page - 1) * size)


def _filtered(
    task_id: int, *, level: str | None = None, keyword: str | None = None
) -> Select:
    """明细过滤条件（分级 + 模糊搜索）。

    🔒 `keyword` 走 `like` 且参数化绑定（`%kw%`），**不做**字符串拼接 ——
       商品 ID / 仓库名均由用户上传，允许 `%` / `_` 通配符不影响安全性，
       但必须保证 SQL 本身不可拼。
    """
    stmt = select(Prediction).where(Prediction.task_id == task_id)
    if level:
        stmt = stmt.where(Prediction.granularity_level == level)
    kw = (keyword or "").strip()
    if kw:
        like = f"%{kw}%"
        stmt = stmt.where(
            or_(
                Prediction.sku_id.like(like),
                Prediction.warehouse_id.like(like),
            )
        )
    return stmt


def list_sorted_paged(
    db: Session,
    task_id: int,
    *,
    page: int = 1,
    size: int = 20,
    sort_by: str = DEFAULT_SORT,
    order: str = "asc",
    level: str | None = None,
    keyword: str | None = None,
) -> list[Prediction]:
    """按任意列排序 + 分页取明细（`API-15` / `FR-VIS-03`）。

    ⚠️ **分页必须与过滤共用同一个 `stmt`**（见 `_filtered`）：
       若 count 走未过滤的全集、分页走过滤后的子集，`total` 会虚高，
       前端翻到最后一页会出现空白页 —— 这类「最后一页空白」是分页接口的
       经典缺陷，且只有带过滤条件时才复现，最容易漏测。
    """
    stmt = _filtered(task_id, level=level, keyword=keyword)
    column = SORTABLE_COLUMNS.get(sort_by, Prediction.sku_id)
    stmt = stmt.order_by(
        column.desc() if order == "desc" else column.asc(),
        # 🔒 追加稳定的次级排序键：否则同一 sku 的多行在 SQLite 下顺序不定，
        #    翻页时会出现「某行在第 1 页末尾又在第 2 页开头」的重复/遗漏。
        Prediction.forecast_date.asc(),
        Prediction.id.asc(),
    )
    stmt = stmt.limit(size).offset((page - 1) * size)
    return list(db.execute(stmt).scalars().all())


def count_filtered(
    db: Session, task_id: int, *, level: str | None = None, keyword: str | None = None
) -> int:
    """与 `list_sorted_paged` **同条件**的总数（`total`）。"""
    stmt = _filtered(task_id, level=level, keyword=keyword).with_only_columns(
        func.count()
    )
    return int(db.execute(stmt).scalar_one())


def iter_all_for_export(
    db: Session, task_id: int, *, chunk: int = 2000
) -> Iterable[Prediction]:
    """按导出列序迭代全量明细（`API-16`）。

    🔒 **不返回 list**：上限 300 万行（`DB-T04`），一次性物化会把进程内存打满。
       这里用 `yield_per` 分批取，CSV 边生成边写出，内存占用与数据量无关。
    """
    stmt = (
        select(Prediction)
        .where(Prediction.task_id == task_id)
        .order_by(
            Prediction.sku_id,
            Prediction.warehouse_id,
            Prediction.forecast_date,
        )
    )
    yield from db.execute(stmt.execution_options(yield_per=chunk)).scalars()


def count_by_task(db: Session, task_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(Prediction)
        .where(Prediction.task_id == task_id)
    )
    return int(db.execute(stmt).scalar_one())


def count_by_level(db: Session, task_id: int) -> dict[str, int]:
    """按 L1/L2/L3 统计（覆盖率披露 `FR-VIS-07`）。"""
    stmt = (
        select(Prediction.granularity_level, func.count())
        .where(Prediction.task_id == task_id)
        .group_by(Prediction.granularity_level)
    )
    got = {lvl: n for lvl, n in db.execute(stmt).all()}
    return {lvl: got.get(lvl, 0) for lvl in (LEVEL_L1, LEVEL_L2, LEVEL_L3)}


def distinct_series_by_level(db: Session, task_id: int, level: str) -> set[tuple[str, str]]:
    """某层级下的去重序列集合 `(sku_id, warehouse_id)`。

    用于「覆盖率 = 层级序列数 / 总序列数」，也用于校验冗余计数列是否与明细一致。
    """
    stmt = (
        select(Prediction.sku_id, Prediction.warehouse_id)
        .where(
            Prediction.task_id == task_id,
            Prediction.granularity_level == level,
        )
        .distinct()
    )
    return {(sku, wh) for sku, wh in db.execute(stmt).all()}


def delete_by_task(db: Session, task_id: int) -> int:
    """按任务清理明细（管理端硬删除前的手工清理；正常路径由外键 CASCADE 完成）。"""
    return (
        db.query(Prediction)
        .filter(Prediction.task_id == task_id)
        .delete(synchronize_session=False)
    )
