"""`predictions` 预测结果表 ORM 实体（`DB-T04`）。

对应 `code/db/schema.sql` 的 `T04` 段。

🔒 一行 = 一条序列的一个预测日。示例规模 113 序列 × 14 天 = 1,582 行，
   故写入必须**批量 INSERT**，禁止逐行 commit（`NFR-REL-04`）。

🔒 **库列序**（`SELECT` 投影顺序）由 `EXPORT_COLUMNS` 固定，与联合唯一索引的
   列序 `(task_id, warehouse_id, sku_id, forecast_date)` **故意不同** ——
   索引列序为查询优化服务，投影列序为结果装配的可读性服务。

🔴 **不要把 `EXPORT_COLUMNS` 当成导出文件的表头**（`EP-9` 契约一致性审查
   发现的「注释与实现不符」）：
     导出 CSV / XLSX 的表头是 `app/services/result_service.py::EXPORT_HEADER`，
     列名**刻意不同** —— `date` / `forecast_sales` / `actual_sales` / `error`，
     而不是本文件里的 `forecast_date` / `predicted_value` / `actual_value`。
   两者都是 7 列、都挂 `FR-VIS-05`，但一个是**库列名**、一个是**业务表头**；
   混用会把 `forecast_date` 这类实现术语泄漏给业务方（`result_service.py:70`
   起有详细理由）。原注释写「导出列序由 EXPORT_COLUMNS 固定」，是错的。
"""
from __future__ import annotations

from sqlalchemy import INTEGER, REAL, TEXT, CheckConstraint, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# 建模范式层级（决定置信度；主指标只算 L1）
LEVEL_L1 = "L1"
LEVEL_L2 = "L2"
LEVEL_L3 = "L3"

# 库列序 / `SELECT` 投影序（**不是**导出文件表头，见文件头 🔴 说明）
EXPORT_COLUMNS = (
    "sku_id",
    "warehouse_id",
    "forecast_date",
    "predicted_value",
    "actual_value",
    "baseline_value",
    "granularity_level",
)


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (
        CheckConstraint(
            "granularity_level IN ('L1', 'L2', 'L3')",
            name="ck_predictions_level",
        ),
        # 联合唯一：同一任务内 (仓库, 商品, 日期) 不得重复（幂等重跑）
        Index(
            "ux_predictions_key",
            "task_id",
            "warehouse_id",
            "sku_id",
            "forecast_date",
            unique=True,
        ),
        # 结果页按序列聚合 + 导出排序
        Index("ix_predictions_task_sku", "task_id", "sku_id", "warehouse_id"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(INTEGER, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        INTEGER, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    sku_id: Mapped[str] = mapped_column(TEXT, nullable=False)
    warehouse_id: Mapped[str] = mapped_column(TEXT, nullable=False)
    forecast_date: Mapped[str] = mapped_column(TEXT, nullable=False)
    predicted_value: Mapped[float] = mapped_column(REAL, nullable=False)
    # 回测时的真值；在线预测时为 NULL（未来尚未发生）
    actual_value: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    baseline_value: Mapped[float | None] = mapped_column(
        REAL, nullable=True, default=None
    )
    granularity_level: Mapped[str] = mapped_column(TEXT, nullable=False)
    lower_bound: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    upper_bound: Mapped[float | None] = mapped_column(REAL, nullable=True, default=None)
    created_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return (
            f"<Prediction task_id={self.task_id} "
            f"{self.warehouse_id}/{self.sku_id}@{self.forecast_date}>"
        )
