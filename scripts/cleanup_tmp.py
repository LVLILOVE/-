"""
=============================================================================
§3.8 数据清理（运维入口）
-----------------------------------------------------------------------------
用法（在工作区根目录执行）：

    # 只清理文件（错误明细 1 小时 / 正式导出 7 天），不动数据库
    C:\\ProgramData\\anaconda3\\envs\\deploy\\python.exe scripts/cleanup_tmp.py

    # 一并清理过期游客数据（user_id = 0，TTL 24 小时）
    C:\\ProgramData\\anaconda3\\envs\\deploy\\python.exe scripts/cleanup_tmp.py --with-guest

    # 演练：只报告将要删除什么，不实际删除
    C:\\ProgramData\\anaconda3\\envs\\deploy\\python.exe scripts/cleanup_tmp.py --dry-run

⚠️ **不接业务 HTTP 服务**：本脚本直接读写同一个 SQLite 库与 `data/` 目录，
   应在服务停止或低峰期执行；`PRAGMA journal_mode=WAL` 下并发读写是安全的，
   但游客数据清理会 `DELETE` 多张表，仍建议避开预测高峰。

🔒 `DB-12`：清理是**唯一的全局跨用户操作**，本脚本的三条自保线 ——
   ① 只按 `created_at` 与路径前缀判断，无任何业务字段入口；
   ② 删游客数据时同时清 `data/uploads/u0/`（否则留下无主 CSV）；
   ③ 输出只含计数与路径前缀，不打印任何用户数据内容。
=============================================================================
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.core import config as app_config          # noqa: E402
from app.core.db import SessionLocal, init_db       # noqa: E402
from app.services import maintenance_service        # noqa: E402

settings = app_config.settings


def main() -> int:
    parser = argparse.ArgumentParser(description="§3.8 数据清理")
    parser.add_argument("--with-guest", action="store_true",
                        help="同时清理过期游客数据（user_id = 0，TTL 24 小时）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只报告将要删除什么，不实际删除")
    args = parser.parse_args()

    # 幂等建库建目录（DEP-7），避免在干净的机器上第一次跑就报目录不存在
    init_db(run_seed=False)

    print("=" * 66)
    print("数据清理（技术文档 §3.8）")
    print("=" * 66)
    print(f"库           : {settings.db_path}")
    print(f"错误明细 TTL : {settings.export_tmp_ttl_seconds} 秒"
          f"（{settings.export_tmp_ttl_seconds / 3600:.1f} 小时）")
    print(f"正式导出 TTL : {settings.export_ttl_days} 天")
    if args.with_guest:
        print(f"游客数据 TTL : {settings.guest_data_ttl_hours} 小时")
    print("")

    if args.dry_run:
        print("[dry-run] 以下为「将要删除」的统计，未实际删除任何文件或记录")
        # dry-run 复用同一套判定逻辑：把 TTL 调到 0 会误伤新文件，
        # 故这里只做「存在性」盘点，不宣称具体条数，避免给出误导性数字。
        from app.core.db import EXPORT_DIR, EXPORT_TMP_DIR, UPLOAD_DIR

        tmp_files = list(EXPORT_TMP_DIR.glob("dataset_*.csv")) if EXPORT_TMP_DIR.exists() else []
        export_files = (
            [p for p in EXPORT_DIR.rglob("*")
             if p.is_file() and EXPORT_TMP_DIR not in p.parents]
            if EXPORT_DIR.exists() else []
        )
        print(f"  错误明细临时文件 : 现存 {len(tmp_files)} 个（候选）")
        print(f"  正式导出产物     : 现存 {len(export_files)} 个（仅 > {settings.export_ttl_days} 天的会被删）")
        if args.with_guest:
            guest_dir = UPLOAD_DIR / "u0"
            guest_files = list(guest_dir.glob("*.csv")) if guest_dir.exists() else []
            print(f"  游客上传文件     : 现存 {len(guest_files)} 个（仅 > "
                  f"{settings.guest_data_ttl_hours} 小时且未被引用的会被删）")
        print("")
        print("结论：dry-run 未做任何修改")
        return 0

    db = SessionLocal()
    try:
        report = maintenance_service.cleanup_all(db if args.with_guest else None)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"[FAIL] 清理过程出错，已回滚数据库改动：{exc}")
        return 1
    finally:
        db.close()

    print("清理结果：")
    print(f"  错误明细临时文件（> 1 小时）      : {report.tmp_error_files}")
    print(f"  正式导出产物（> {settings.export_ttl_days} 天）          : {report.export_files}")
    if args.with_guest:
        print(f"  游客任务（> {settings.guest_data_ttl_hours} 小时）            : {report.guest_tasks}")
        print(f"  游客数据集（> {settings.guest_data_ttl_hours} 小时）          : {report.guest_datasets}")
        print(f"  游客无主上传文件                 : {report.guest_files}")
    if report.skipped:
        print("")
        print(f"跳过 {len(report.skipped)} 项（仍被数据库引用的游客文件）：")
        for item in report.skipped[:10]:
            print(f"  - {item}")
    print("")
    print("结论：清理完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
