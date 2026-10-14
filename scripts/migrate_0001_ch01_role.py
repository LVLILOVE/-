"""CH-01 数据库迁移：`users.role` 列 + `operation_logs.action` 扩为 8 类 + 管理员种子账号。

用法：
    python scripts/migrate_0001_ch01_role.py [--db data/app.db] [--no-backup]

依据：
    《项目开发实施方案 V1.0》§5.3（数据库变更，⏱️ 已实测验证）
    《数据库设计文档 V1.0》§8.6 / §8.7（管理员种子账号与迁移铁律）

满足 §5.3.4 的四条硬要求：
    ① 幂等（重复执行不报错）
    ② 迁移前自动备份 data/app.db（`VACUUM INTO`，§9.5）
    ③ 执行后 `PRAGMA user_version = 1`
    ④ 输出前后列数对比（120 → 121）

🔒 为什么 `operation_logs` 要重建表：
    SQLite **不支持修改已有列的 CHECK 约束**。`action` 的取值集要从 7 类扩到 8 类，
    只能走官方「表重建」流程（建新表 → 拷贝数据 → 删旧表 → 改名 → 重建索引）。
    本期库中尚无生产数据，重建成本为零；脚本仍实现完整流程，以便后续环境复用。

退出码 0 表示迁移完成或已是最新版本。
"""
from __future__ import annotations

import argparse
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "app.db"
BACKUP_DIR = ROOT / "data" / "backups"
SCHEMA_SQL = ROOT / "code" / "db" / "schema.sql"
SEED_SQL = ROOT / "code" / "db" / "seed.sql"

TARGET_VERSION = 1

# ---------------------------------------------------------------- SQL 片段
SQL_ADD_ROLE = (
    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' "
    "CHECK (role IN ('user', 'admin'));"
)

SQL_CREATE_OPLOGS_NEW = """
CREATE TABLE operation_logs__new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER DEFAULT NULL,
    action      TEXT    NOT NULL
                CHECK (action IN ('login', 'register', 'logout', 'upload',
                                  'predict', 'export', 'delete', 'admin')),
    target_id   TEXT    DEFAULT NULL,
    result      TEXT    NOT NULL DEFAULT 'success'
                CHECK (result IN ('success', 'fail')),
    detail      TEXT    DEFAULT NULL,
    ip          TEXT    DEFAULT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

SQL_ADMIN_SEED = """
INSERT OR IGNORE INTO users (email, password_hash, nickname, status, role)
VALUES (
    'admin@salesforecast.cn',
    '$2b$12$gHPiHYW9yCdlRjs8Ux2eme.EdryDZ44V9HbgR3.49dPAohfUmFLzS',
    '系统管理员', 1, 'admin'
);
"""

TABLES = (
    "users", "datasets", "tasks", "predictions",
    "metrics", "model_registry", "operation_logs", "events",
)


# ---------------------------------------------------------------- 工具函数
def column_count(con: sqlite3.Connection) -> dict[str, int]:
    """逐表列数（用于输出 120 → 121 的前后对比）。"""
    out: dict[str, int] = {}
    for t in TABLES:
        try:
            out[t] = len(con.execute(f"PRAGMA table_info({t})").fetchall())
        except sqlite3.Error:
            out[t] = 0
    return out


def has_column(con: sqlite3.Connection, table: str, column: str) -> bool:
    cols = [r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()]
    return column in cols


def action_check_values(con: sqlite3.Connection) -> list[str]:
    """从 operation_logs 的建表语句里解析出 action 的允许取值。

    ⚠️ 必须先剥掉 `--` 行注释再匹配：DDL 里 `action TEXT NOT NULL` 与
       `CHECK (action IN (...))` 之间夹着说明文字，直接正则会把行注释当成
       语法的一部分而匹配失败（曾导致误报「0 类」）。
    """
    row = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='operation_logs'"
    ).fetchone()
    if not row or not row[0]:
        return []
    sql = re.sub(r"--[^\n]*", "", row[0])          # 剥行注释
    sql = re.sub(r"\s+", " ", sql)                 # 归一化空白
    m = re.search(
        r"action TEXT NOT NULL CHECK \(\s*action IN \((.*?)\)\s*\)", sql, re.S | re.I
    )
    if not m:
        return []
    return re.findall(r"'([^']+)'", m.group(1))


def backup_db(db_path: Path) -> Path:
    """迁移前备份（`VACUUM INTO`，§9.5 / `DB-23`）。失败时退化为文件复制。"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = BACKUP_DIR / f"{db_path.stem}.v0.{stamp}.db.bak"
    con = sqlite3.connect(db_path)
    try:
        con.execute("VACUUM INTO ?", (str(dest),))
    except sqlite3.Error:
        con.close()
        shutil.copy2(db_path, dest)
        return dest
    finally:
        con.close()
    return dest


def user_version(con: sqlite3.Connection) -> int:
    return int(con.execute("PRAGMA user_version").fetchone()[0])


# ---------------------------------------------------------------- 迁移主体
def apply_ch01(con: sqlite3.Connection) -> list[str]:
    """执行 CH-01 的三项变更，返回已完成的动作说明列表。"""
    done: list[str] = []

    # ---- 变更一：users.role ----
    if has_column(con, "users", "role"):
        done.append("users.role 已存在，跳过")
    else:
        con.executescript(SQL_ADD_ROLE)
        done.append("users.role 已新增（DEFAULT 'user' + CHECK）")

    # ---- 变更二：operation_logs.action 7 类 → 8 类（需重建表） ----
    vals = action_check_values(con)
    if "admin" in vals:
        done.append(f"operation_logs.action 已是 {len(vals)} 类，跳过")
    else:
        # 按 SQLite 官方表重建流程。重建期间关闭外键检查（无表引用本表，安全）。
        con.execute("PRAGMA foreign_keys = OFF")
        con.executescript(
            SQL_CREATE_OPLOGS_NEW
            + """
            INSERT INTO operation_logs__new
                (id, user_id, action, target_id, result, detail, ip, created_at)
            SELECT id, user_id, action, target_id, result, detail, ip, created_at
            FROM operation_logs;

            DROP TABLE operation_logs;
            ALTER TABLE operation_logs__new RENAME TO operation_logs;

            CREATE INDEX IF NOT EXISTS ix_oplogs_user_time
                ON operation_logs (user_id, created_at DESC);
            """
        )
        con.execute("PRAGMA foreign_keys = ON")
        done.append(
            f"operation_logs.action 已由 {len(vals)} 类重建为 8 类"
            f"（+admin，走官方表重建流程）"
        )

    # ---- 变更三：管理员种子账号 ----
    cur = con.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
    if cur.fetchone()[0]:
        done.append("管理员种子账号已存在，跳过")
    else:
        con.executescript(SQL_ADMIN_SEED)
        done.append("管理员种子账号已插入（admin@salesforecast.cn）")

    return done


def main() -> int:
    ap = argparse.ArgumentParser(description="CH-01 数据库迁移（幂等）")
    ap.add_argument("--db", default=str(DEFAULT_DB), help="数据库路径，默认 data/app.db")
    ap.add_argument("--no-backup", action="store_true", help="跳过备份（仅用于临时验证）")
    args = ap.parse_args()

    db_path = Path(args.db)
    print("=" * 72)
    print("CH-01 迁移：users.role + operation_logs.action(8 类) + 管理员种子账号")
    print("=" * 72)
    print(f"目标库   : {db_path}")

    # 库不存在：直接用最新 schema 建库（此时不存在「迁移」，只有「初始化」）
    if not db_path.exists():
        print("[INFO] 目标库不存在，改为执行初始化（schema.sql + seed.sql）")
        db_path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(db_path)
        try:
            con.executescript(SCHEMA_SQL.read_text(encoding="utf-8"))
            con.executescript(SEED_SQL.read_text(encoding="utf-8"))
            con.execute(f"PRAGMA user_version = {TARGET_VERSION}")
            con.commit()
            print(f"[ OK ] 初始化完成，user_version = {TARGET_VERSION}")
        finally:
            con.close()
        return 0

    # ---- 备份 ----
    if args.no_backup:
        print("[WARN] 已跳过备份（--no-backup）")
    else:
        dest = backup_db(db_path)
        print(f"[ OK ] 迁移前备份：{dest.relative_to(ROOT)}"
              f"（{dest.stat().st_size:,} B）")

    con = sqlite3.connect(db_path)
    try:
        before = column_count(con)
        v0 = user_version(con)
        print(f"迁移前列数 : {sum(before.values())} 列  ·  user_version = {v0}")

        done = apply_ch01(con)
        con.execute(f"PRAGMA user_version = {TARGET_VERSION}")
        con.commit()

        # 顺手把库调到 WAL（BE-12；journal_mode 是持久化设置，一次即可）。
        # 若被其他连接占用则静默放弃——应用的 connect 事件每次都会重设。
        try:
            con.execute("PRAGMA journal_mode=WAL").fetchone()
        except sqlite3.Error:
            pass

        after = column_count(con)
        print()
        for item in done:
            print(f"  · {item}")
        print()
        print(f"迁移后列数 : {sum(after.values())} 列  ·  user_version = "
              f"{user_version(con)}")
        for t in TABLES:
            if before[t] != after[t]:
                print(f"  {t:18s} {before[t]:3d} → {after[t]:3d}")

        # ---- 迁移后自检 ----
        ok = True
        vals = action_check_values(con)
        if vals == ["login", "register", "logout", "upload", "predict",
                    "export", "delete", "admin"]:
            print(f"[ OK ] action 取值集 = {vals}")
        else:
            ok = False
            print(f"[FAIL] action 取值集异常：{vals}")

        # 非法 role 必须被拒
        try:
            con.execute(
                "INSERT INTO users(email, password_hash, role) "
                "VALUES('__probe__@x.com','h','bogus')"
            )
            con.rollback()
            ok = False
            print("[FAIL] role='bogus' 竟然写入成功 —— CHECK 失效")
        except sqlite3.IntegrityError:
            con.rollback()
            print("[ OK ] role='bogus' 被 CHECK 拒绝")

        # 非法 action 必须被拒
        try:
            con.execute(
                "INSERT INTO operation_logs(action) VALUES('bogus')"
            )
            con.rollback()
            ok = False
            print("[FAIL] action='bogus' 竟然写入成功 —— CHECK 失效")
        except sqlite3.IntegrityError:
            con.rollback()
            print("[ OK ] action='bogus' 被 CHECK 拒绝")

        # 哨兵与管理员角色
        roles = dict(con.execute("SELECT email, role FROM users").fetchall())
        guest = roles.get("__guest__@local.invalid")
        admin = roles.get("admin@salesforecast.cn")
        if guest == "user" and admin == "admin":
            print(f"[ OK ] 哨兵 role={guest!r} · 管理员 role={admin!r}")
        else:
            ok = False
            print(f"[FAIL] 角色异常：哨兵={guest!r} 管理员={admin!r}")

        # journal_mode 应为 WAL
        mode = con.execute("PRAGMA journal_mode").fetchone()[0]
        print(f"[INFO] journal_mode = {mode}")
    finally:
        con.close()

    print("=" * 72)
    print("结论：迁移完成（可重复执行）" if ok else "结论：迁移存在问题")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
