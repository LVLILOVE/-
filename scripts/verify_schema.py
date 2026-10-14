"""校验 code/db/schema.sql 可实际执行，并检查对象是否齐备。

用法：
    python scripts/verify_schema.py

在内存库中执行建表脚本，执行成功后打印表 / 索引 / 触发器 / 视图清单，
并逐项核对《开发技术文档 V1.0》第 3 章声明的对象是否齐备。
退出码 0 表示全部通过。
"""
from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "code" / "db" / "schema.sql"

# 第 3 章声明应存在的对象
EXPECT_TABLES = [
    "users", "datasets", "tasks", "predictions",
    "metrics", "model_registry", "operation_logs", "events",
]
EXPECT_VIEWS = ["v_task_summary"]
EXPECT_TRIGGERS = ["trg_users_updated", "trg_datasets_updated", "trg_tasks_updated"]


def main() -> int:
    if not SCHEMA.exists():
        print(f"[FAIL] 找不到建表脚本：{SCHEMA}")
        return 1

    sql = SCHEMA.read_text(encoding="utf-8")
    con = sqlite3.connect(":memory:")

    try:
        con.executescript(sql)
    except sqlite3.Error as exc:
        print(f"[FAIL] 建表脚本执行失败：{exc}")
        return 1

    ok = True

    def rows(kind: str) -> list[str]:
        cur = con.execute(
            "SELECT name FROM sqlite_master WHERE type=? ORDER BY name", (kind,)
        )
        return [r[0] for r in cur.fetchall()]

    tables = rows("table")
    indexes = rows("index")
    triggers = rows("trigger")
    views = rows("view")

    print("=" * 62)
    print("schema.sql 执行结果")
    print("=" * 62)
    print(f"表      : {len([t for t in tables if not t.startswith('sqlite_')])} 张")
    print(f"索引    : {len(indexes)} 个")
    print(f"触发器  : {len(triggers)} 个")
    print(f"视图    : {len(views)} 个")

    for label, expect, actual in (
        ("表", EXPECT_TABLES, tables),
        ("视图", EXPECT_VIEWS, views),
        ("触发器", EXPECT_TRIGGERS, triggers),
    ):
        missing = [n for n in expect if n not in actual]
        if missing:
            ok = False
            print(f"[FAIL] 缺少{label}：{missing}")
        else:
            print(f"[ OK ] {label}齐备（{len(expect)} 项）")

    # 幂等性：重复执行不应报错（全部使用 IF NOT EXISTS）
    try:
        con.executescript(sql)
        print("[ OK ] 脚本可重复执行（幂等）")
    except sqlite3.Error as exc:
        ok = False
        print(f"[FAIL] 脚本不幂等，二次执行报错：{exc}")

    # 关键约束抽查：predictions 联合唯一索引应生效
    cur = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='ux_predictions_key'"
    )
    row = cur.fetchone()
    if row and "UNIQUE" in row[0].upper():
        print("[ OK ] predictions 联合唯一索引存在且为 UNIQUE")
    else:
        ok = False
        print("[FAIL] predictions 联合唯一索引缺失或非 UNIQUE")

    # model_registry 的部分唯一索引（保证仅一个启用版本）
    cur = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='ux_model_active'"
    )
    row = cur.fetchone()
    if row and "WHERE is_active = 1" in row[0]:
        print("[ OK ] model_registry 启用版本唯一索引存在（部分索引）")
    else:
        ok = False
        print("[FAIL] model_registry 启用版本唯一索引缺失")

    # 外键检查：tasks.dataset_id 应引用 datasets
    fk = con.execute("PRAGMA foreign_key_list(tasks)").fetchall()
    refs = {r[2] for r in fk}
    if {"users", "datasets"} <= refs:
        print(f"[ OK ] tasks 外键指向正确：{sorted(refs)}")
    else:
        ok = False
        print(f"[FAIL] tasks 外键不完整：{sorted(refs)}")

    # 统计 CHECK 约束数量，作为「约束密度」的客观证据
    check_count = len(re.findall(r"CHECK\s*\(", sql, re.IGNORECASE))
    print(f"[INFO] CHECK 约束共 {check_count} 处")
    print(f"[INFO] 脚本行数 {len(sql.splitlines())} 行，字符 {len(sql)}")

    # -------------------------------------------------------------------------
    # 游客态（JT-10 / FR-USR-08）：user_id = 0 必须可落库，非法 user_id 必须被拒
    # -------------------------------------------------------------------------
    print("-" * 62)
    print("游客哨兵与外键完整性实测（JT-10）")
    print("-" * 62)

    con.execute("PRAGMA foreign_keys = ON")  # 显式重申，避免驱动默认关闭

    # 1) 哨兵行存在，且密码串非法（不可登录）
    row = con.execute(
        "SELECT id, email, password_hash, nickname FROM users WHERE id = 0"
    ).fetchone()
    if row and row[0] == 0:
        print(f"[ OK ] 游客哨兵存在：id=0, email={row[1]!r}, nickname={row[3]!r}")
        if row[2] == "!":
            print("[ OK ] 哨兵 password_hash 为 '!'，非 bcrypt 串 → 永远无法通过校验")
        else:
            ok = False
            print(f"[FAIL] 哨兵 password_hash 应为 '!'，实际 {row[2]!r}")
    else:
        ok = False
        print("[FAIL] users 表中缺少 id = 0 的游客哨兵行")

    # 2) 游客数据集可写入（证明 NOT NULL + FK 的组合不再阻断游客态）
    try:
        cur = con.execute(
            "INSERT INTO datasets (user_id, file_name, stored_name, file_path) "
            "VALUES (0, 'guest.csv', 'g_uuid.csv', 'uploads/u0/g_uuid.csv')"
        )
        guest_dataset_id = cur.lastrowid
        print(f"[ OK ] 游客数据集写入成功：datasets.id={guest_dataset_id}, user_id=0")
    except sqlite3.Error as exc:
        ok = False
        guest_dataset_id = None
        print(f"[FAIL] 游客数据集写入被拒（FR-USR-08 将无法实现）：{exc}")

    # 3) 游客任务可写入（dataset_id 指向游客数据集）
    if guest_dataset_id is not None:
        try:
            cur = con.execute(
                "INSERT INTO tasks (user_id, dataset_id, horizon, model_version) "
                "VALUES (0, ?, 14, 'lstm_v1')",
                (guest_dataset_id,),
            )
            print(f"[ OK ] 游客任务写入成功：tasks.id={cur.lastrowid}, user_id=0")
        except sqlite3.Error as exc:
            ok = False
            print(f"[FAIL] 游客任务写入被拒：{exc}")

    # 4) 非法 user_id 必须被外键拒绝（证明哨兵是「开的口子」而非「拆掉的墙」）
    try:
        con.execute(
            "INSERT INTO datasets (user_id, file_name, stored_name, file_path) "
            "VALUES (99999, 'bad.csv', 'b.csv', 'uploads/u99999/b.csv')"
        )
        ok = False
        print("[FAIL] user_id=99999 竟然写入成功 —— 外键约束失效！")
    except sqlite3.IntegrityError as exc:
        print(f"[ OK ] 非法 user_id=99999 被外键拒绝：{exc}")

    # 5) 哨兵不干扰自增分配：正常注册的 id 必须从 1 开始
    ids = []
    for i in range(3):
        cur = con.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, 'h')",
            (f"u{i}@example.com",),
        )
        ids.append(cur.lastrowid)
    if ids == [1, 2, 3]:
        print(f"[ OK ] 哨兵不干扰自增：正常注册 id 从 1 开始 {ids}")
    else:
        ok = False
        print(f"[FAIL] 自增分配异常：{ids}（期望 [1, 2, 3]）")

    # 6) 游客哨兵不可被级联删除后留下孤儿数据（ON DELETE CASCADE 语义）
    n_orphan = con.execute(
        "SELECT COUNT(*) FROM datasets d "
        "LEFT JOIN users u ON u.id = d.user_id WHERE u.id IS NULL"
    ).fetchone()[0]
    if n_orphan == 0:
        print("[ OK ] 无孤儿数据集（user_id 均有对应用户或哨兵）")
    else:
        ok = False
        print(f"[FAIL] 存在 {n_orphan} 条孤儿数据集")

    # 7) token_version（TQ-1 决议 / FR-USR-07）：默认 1，改密自增即可撤回旧 Token
    tv = con.execute("SELECT token_version FROM users WHERE id = 0").fetchone()[0]
    if tv == 1:
        print("[ OK ] token_version 默认值为 1（哨兵行）")
    else:
        ok = False
        print(f"[FAIL] token_version 默认值应为 1，实际 {tv}")

    con.execute("UPDATE users SET token_version = token_version + 1 WHERE id = 1")
    tv2 = con.execute("SELECT token_version FROM users WHERE id = 1").fetchone()[0]
    if tv2 == 2:
        print("[ OK ] 改密自增生效：users.id=1 的 token_version 1 → 2（旧 Token 立即失效）")
    else:
        ok = False
        print(f"[FAIL] token_version 自增失败，实际 {tv2}")

    # 8) CHECK 约束：token_version 不得低于 1
    #    若允许置 0，任何「旧 Token 校验」都会因 0 != 0 之外的原因变得不可推理
    try:
        con.execute("UPDATE users SET token_version = 0 WHERE id = 2")
        ok = False
        print("[FAIL] token_version=0 竟然写入成功 —— CHECK 约束失效！")
    except sqlite3.IntegrityError as exc:
        print(f"[ OK ] token_version=0 被 CHECK 约束拒绝：{exc}")

    con.rollback()  # 丢弃本次实测写入，保持库干净

    # -------------------------------------------------------------------------
    # CH-01 回归：users.role 列 与 operation_logs.action 8 类
    # （依据《项目开发实施方案 V1.0》§5.3；这组断言是 DOD-EP1 的必查项）
    # -------------------------------------------------------------------------
    print("-" * 62)
    print("CH-01 变更回归（users.role / operation_logs.action）")
    print("-" * 62)

    # 1) role 列存在，且位置紧随 status 之后（DDL 契约）
    cols = [r[1] for r in con.execute("PRAGMA table_info(users)").fetchall()]
    if "role" in cols and cols.index("role") == cols.index("status") + 1:
        print(f"[ OK ] users.role 存在且紧随 status（第 {cols.index('role') + 1} 列）")
    else:
        ok = False
        print(f"[FAIL] users.role 缺失或位置不符：{cols}")

    # 2) 新建用户默认 role = 'user'；显式 admin 可写入
    cur = con.execute(
        "INSERT INTO users(email, password_hash) VALUES('role_probe@x.com','h')"
    )
    probe_id = cur.lastrowid
    default_role = con.execute(
        "SELECT role FROM users WHERE id=?", (probe_id,)
    ).fetchone()[0]
    if default_role == "user":
        print("[ OK ] 新建用户默认 role='user'（游客哨兵同此路径，不会意外升格）")
    else:
        ok = False
        print(f"[FAIL] role 默认值应为 'user'，实际 {default_role!r}")

    try:
        con.execute("UPDATE users SET role='admin' WHERE id=?", (probe_id,))
        print("[ OK ] role='admin' 可写入")
    except sqlite3.IntegrityError as exc:
        ok = False
        print(f"[FAIL] role='admin' 被拒（管理端将无法授权）：{exc}")

    # 3) 非法 role 必须被 CHECK 拒绝
    try:
        con.execute("UPDATE users SET role='bogus' WHERE id=?", (probe_id,))
        ok = False
        print("[FAIL] role='bogus' 竟然写入成功 —— CHECK 约束失效！")
    except sqlite3.IntegrityError as exc:
        print(f"[ OK ] role='bogus' 被 CHECK 拒绝：{exc}")

    # 4) action 接受 'admin'，拒绝未知值
    try:
        con.execute(
            "INSERT INTO operation_logs(user_id, action, result, detail) "
            "VALUES(0, 'admin', 'success', 'sub=user_disable;target_user=3;by=1')"
        )
        print("[ OK ] operation_logs.action='admin' 被接受（管理端审计可落库）")
    except sqlite3.IntegrityError as exc:
        ok = False
        print(f"[FAIL] action='admin' 被拒 —— 管理端操作将无审计：{exc}")

    try:
        con.execute("INSERT INTO operation_logs(action) VALUES('bogus')")
        ok = False
        print("[FAIL] action='bogus' 竟然写入成功 —— CHECK 约束失效！")
    except sqlite3.IntegrityError as exc:
        print(f"[ OK ] action='bogus' 被 CHECK 拒绝：{exc}")

    con.rollback()

    # -------------------------------------------------------------------------
    # 种子数据回归（schema.sql + seed.sql 同跑）：管理员种子账号与哨兵角色
    # -------------------------------------------------------------------------
    print("-" * 62)
    print("种子数据回归（管理员账号 / 哨兵角色）")
    print("-" * 62)

    con2 = sqlite3.connect(":memory:")
    try:
        con2.executescript(sql)
        seed_path = SCHEMA.parent / "seed.sql"
        if seed_path.exists():
            con2.executescript(seed_path.read_text(encoding="utf-8"))
        else:
            ok = False
            print(f"[FAIL] 找不到 seed.sql：{seed_path}")

        rows = dict(
            con2.execute("SELECT email, role FROM users").fetchall()
        )
        guest_role = rows.get("__guest__@local.invalid")
        admin_role = rows.get("admin@salesforecast.cn")

        if guest_role == "user":
            print("[ OK ] 游客哨兵 role='user'")
        else:
            ok = False
            print(f"[FAIL] 哨兵 role 应为 'user'，实际 {guest_role!r}")

        if admin_role == "admin":
            print("[ OK ] 管理员种子账号存在且 role='admin'（admin@salesforecast.cn）")
        else:
            ok = False
            print(f"[FAIL] 管理员种子账号缺失或角色错误：{admin_role!r}")

        # 种子邮箱不得是 RFC 2606 保留域（否则 EmailStr 会先拒掉登录请求）
        admin_email = "admin@salesforecast.cn"
        reserved = (".invalid", ".local", ".test", ".example")
        if admin_email.endswith(reserved):
            ok = False
            print(f"[FAIL] 管理员邮箱使用保留域，EmailStr 将拒绝登录：{admin_email}")
        else:
            print(f"[ OK ] 管理员邮箱非保留域：{admin_email}")

        # seed.sql 幂等：二次执行不报错
        try:
            con2.executescript(seed_path.read_text(encoding="utf-8"))
            print("[ OK ] seed.sql 可重复执行（幂等）")
        except sqlite3.Error as exc:
            ok = False
            print(f"[FAIL] seed.sql 不幂等：{exc}")

        n_admin = con2.execute(
            "SELECT COUNT(*) FROM users WHERE role='admin'"
        ).fetchone()[0]
        if n_admin == 1:
            print("[ OK ] 重复执行后管理员仍为 1 个（未被重复插入）")
        else:
            ok = False
            print(f"[FAIL] 管理员账号数量异常：{n_admin}")
    finally:
        con2.close()

    con.close()
    print("=" * 62)
    print("结论：全部通过" if ok else "结论：存在未通过项")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
