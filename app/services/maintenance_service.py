"""
=============================================================================
维护任务（§3.8 数据清理策略）
-----------------------------------------------------------------------------
版本     : V1.0（EP-4 提前落地 —— 技术文档 §3.8 只给了策略，未挂到任何阶段；
           但 `JT-11`「错误明细 TTL 1 小时」是 `EP-4` 的交付内容，
           没有清理实现的话这条 TTL 只是一句空话）
依据文档 : 《开发技术文档 V1.0》§3.8（数据清理策略）、`DB-12`（清理任务的实现约束）、
           §10.6（运维手册的清理章节）
           《数据库设计文档 V1.0》§9.2（删除优先软删除）、`DB-12`
-----------------------------------------------------------------------------
三类清理对象与 TTL
-----------------------------------------------------------------------------
| 对象 | 位置 | TTL | 依据 |
|---|---|---|---|
| 错误明细临时文件 | `data/exports/tmp/` | **1 小时** | `JT-11` |
| 正式导出产物 | `data/exports/`（**不含** `tmp/`） | 7 天 | `NFR-REL-05` / `export_ttl_days` |
| 游客数据（`user_id = 0`） | `datasets` / `tasks` / `predictions` / `metrics` / `data/uploads/u0/` | **24 小时** | `JT-10` |

🔒 `DB-12` 的三条硬约束（清理是**唯一的全局跨用户操作**，最容易变成隔离漏洞）
-----------------------------------------------------------------------------
1. **只按时间与路径前缀判断，不按业务字段** —— 本模块的每个查询都只带
   `created_at` 与 `user_id = 0`（游客是唯一允许跨用户处理的身份），
   不存在任何「按商品名 / 文件名 / 备注筛选」的入口。
2. **删除游客数据时必须同时清 `data/uploads/u0/`** —— 否则会留下无主 CSV
   把磁盘慢慢撑满（`NFR-SEC-04`）。
3. **清理日志不得输出其他用户的数据内容** —— 只记计数与对象类型，
   `file_name`（用户原始文件名）**不写日志**（`NFR-SEC-05` 最小暴露）。

⚠️ 为什么先删 `tasks` 再删 `datasets`
    `tasks.dataset_id → datasets.id` 是 **`ON DELETE RESTRICT`**（`FK-03` / `DB-D5`），
    顺序反了会直接抛外键错误。`predictions` / `metrics` 对 `tasks` 是 `CASCADE`，
    删任务即随之清空，无需单独处理。
=============================================================================
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import config as app_config
from app.core.db import EXPORT_DIR, EXPORT_TMP_DIR, UPLOAD_DIR
from app.dao import oplog_dao
from app.models.user import GUEST_USER_ID

logger = logging.getLogger(__name__)
settings = app_config.settings

__all__ = ["CleanupReport", "cleanup_exports", "cleanup_guest_data", "cleanup_all"]

_DT_FMT = "%Y-%m-%d %H:%M:%S"


@dataclass
class CleanupReport:
    """一次清理的结果（只含计数与路径前缀，不含任何用户数据内容）。"""

    tmp_error_files: int = 0
    export_files: int = 0
    guest_datasets: int = 0
    guest_tasks: int = 0
    guest_files: int = 0
    skipped: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "tmp_error_files": self.tmp_error_files,
            "export_files": self.export_files,
            "guest_datasets": self.guest_datasets,
            "guest_tasks": self.guest_tasks,
            "guest_files": self.guest_files,
            "skipped": list(self.skipped),
        }


def _unlink(path: Path) -> bool:
    try:
        path.unlink(missing_ok=True)
        return True
    except OSError as exc:  # pragma: no cover - 平台相关
        logger.warning("清理失败（文件被占用？）: %s (%s)", path, exc)
        return False


def _older_than(path: Path, cutoff_ts: float) -> bool:
    try:
        return path.stat().st_mtime < cutoff_ts
    except OSError:  # pragma: no cover
        return False


def cleanup_exports(
    report: CleanupReport | None = None, *, now: datetime | None = None
) -> CleanupReport:
    """清理导出产物：`tmp/` 按 `JT-11`（1 小时），其余按 `export_ttl_days`（7 天）。

    ⚠️ `tmp/` 与正式产物**必须分开判定**（`API-11-2`）：把 1 小时的临时文件
       混进 7 天的口径里，临时文件会被当正式产物多留 6 天 23 小时，
       磁盘被临时明细挤占 —— 这正是 `JT-11` 要求分目录的原因。

    ⚠️ 返回值就是传入的 `report`（原地累加后回传）。三者签名一致：
       `cleanup_exports` / `cleanup_guest_data` / `cleanup_all` 都**返回报告对象**，
       调用方无需先自己 new 一个 —— 早期版本写成了「返回 None」，
       调用处 `rep = cleanup_exports(CleanupReport())` 会拿到 `None` 再炸在属性上。
    """
    if report is None:
        report = CleanupReport()
    now = now or datetime.now()
    now = now or datetime.now()

    if EXPORT_TMP_DIR.exists():
        cutoff = (now - timedelta(seconds=settings.export_tmp_ttl_seconds)).timestamp()
        for item in EXPORT_TMP_DIR.glob("dataset_*.csv"):
            if _older_than(item, cutoff) and _unlink(item):
                report.tmp_error_files += 1

    if EXPORT_DIR.exists():
        cutoff = (now - timedelta(days=settings.export_ttl_days)).timestamp()
        for item in EXPORT_DIR.rglob("*"):
            if not item.is_file():
                continue
            # 🔒 不碰 tmp/ —— 它有自己的 TTL 口径
            if EXPORT_TMP_DIR in item.parents:
                continue
            if _older_than(item, cutoff) and _unlink(item):
                report.export_files += 1

    return report


def cleanup_guest_data(
    db: Session,
    report: CleanupReport | None = None,
    *,
    now: datetime | None = None,
) -> CleanupReport:
    """清理超过 `guest_data_ttl_hours` 的游客数据（`JT-10`）。

    ⚠️ 顺序不可调换：先 `tasks` 再 `datasets`。
       `tasks.dataset_id → datasets.id` 是 `RESTRICT`（`FK-03`），
       反过来会抛外键错误且**整个批次都清不掉**。

    ⚠️ 文件清理在**库删除之后**：先查出仍被引用的落盘名会必然包含这些
       即将被删的行，导致一个文件都清不掉。先删库行，再按「现在还活着的」
       集合过滤，才留得住未到 TTL 的游客文件。
    """
    if report is None:
        report = CleanupReport()
    now = now or datetime.now()
    cutoff = (now - timedelta(hours=settings.guest_data_ttl_hours)).strftime(_DT_FMT)

    # ① 先取「即将被清掉的行」及其落盘名 —— 必须在 DELETE 之前取，
    #    删完就查不到了（这正是文件清理曾经失败的原因）。
    doomed = db.execute(
        text(
            "SELECT id, stored_name FROM datasets "
            "WHERE user_id = :uid AND created_at < :cutoff"
        ),
        {"uid": GUEST_USER_ID, "cutoff": cutoff},
    ).fetchall()

    # ② 游客任务（predictions / metrics 随 CASCADE 一并清掉）
    deleted_tasks = db.execute(
        text(
            "DELETE FROM tasks WHERE user_id = :uid AND created_at < :cutoff"
        ),
        {"uid": GUEST_USER_ID, "cutoff": cutoff},
    ).rowcount
    report.guest_tasks = max(deleted_tasks, 0)

    # ③ 游客数据集（此时已无 tasks 引用，不再触发 RESTRICT）
    deleted_datasets = db.execute(
        text(
            "DELETE FROM datasets WHERE user_id = :uid AND created_at < :cutoff"
        ),
        {"uid": GUEST_USER_ID, "cutoff": cutoff},
    ).rowcount
    report.guest_datasets = max(deleted_datasets, 0)

    # ④ 🔒 无主 CSV（DB-12 第 2 条：清库不清文件 = 磁盘照样被撑满）
    #    ⚠️ 判定依据必须是「库行已过期」而不是文件 mtime：
    #       落盘时间与 created_at 在生产中同步，但一旦有人做数据修复、
    #       或文件被 touch 过，mtime 就不再可信 —— 用库行反查才是唯一真源。
    guest_dir = UPLOAD_DIR / f"u{GUEST_USER_ID}"
    if guest_dir.exists():
        for _, stored_name in doomed:
            if stored_name and _unlink(guest_dir / str(stored_name)):
                report.guest_files += 1

        # ⑤ 补充扫描：历史遗留的无主文件（库行早已不在，只剩磁盘垃圾）。
        #    只删「按 TTL 判过期」且「当前无任何存活行引用」的，避免误伤。
        alive = {
            str(r[0])
            for r in db.execute(
                text(
                    "SELECT stored_name FROM datasets "
                    "WHERE user_id = :uid AND status = 1"
                ),
                {"uid": GUEST_USER_ID},
            ).fetchall()
        }
        cutoff_ts = (now - timedelta(hours=settings.guest_data_ttl_hours)).timestamp()
        for item in guest_dir.glob("*.csv"):
            if item.name in alive:
                report.skipped.append(f"uploads/u0/{item.name}（仍被引用）")
                continue
            if item.name in {str(r[1]) for r in doomed}:
                continue  # ④ 已处理并计数
            if _older_than(item, cutoff_ts) and _unlink(item):
                report.guest_files += 1

    if report.guest_tasks or report.guest_datasets or report.guest_files:
        # 🔒 只记计数与对象类型：不写 file_name（NFR-SEC-05 最小暴露）
        oplog_dao.record(
            db,
            action="delete",
            user_id=None,
            target_id="guest_cleanup",
            detail=(
                f"sub=ttl_cleanup;tasks={report.guest_tasks};"
                f"datasets={report.guest_datasets};files={report.guest_files};"
                f"ttl_hours={settings.guest_data_ttl_hours}"
            ),
        )

    return report


def cleanup_all(db: Session | None = None, *, now: datetime | None = None) -> CleanupReport:
    """跑完三类清理。`db` 为 None 时只做文件级清理。"""
    report = CleanupReport()
    cleanup_exports(report, now=now)
    if db is not None:
        cleanup_guest_data(db, report, now=now)
    return report
