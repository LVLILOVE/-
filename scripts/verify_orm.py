"""校验 ORM 实体与 `code/db/schema.sql` 是否一一对应，并执行架构红线自检。

用法：
    python scripts/verify_orm.py

做四件事（全部为可复现断言，非人工目视）：
  1) 表集合一致：8 个 ORM 实体 ↔ schema.sql 的 8 张表；
  2) 逐表列名 / 类型族（INTEGER·TEXT·REAL）/ 可空性一致；
  3) 索引名集合一致（显式索引 + 部分唯一索引）；
  4) 🔒 红线自检：
       · `app/models/` 不得出现 `DateTime`（时间字段统一 TEXT，NFR-COMP-04）
       · `app/dao/` 与 `app/models/` 不得 `import algo`（架构红线 4）
       · `app/dao/` 不得 `import fastapi`（分层单向：dao 不应感知 Web 层）

退出码 0 表示全部通过。
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "code" / "db" / "schema.sql"

sys.path.insert(0, str(ROOT))

SKIP_COLS = ("FOREIGN", "PRIMARY", "UNIQUE", "CHECK", "CONSTRAINT")


def schema_tables(sql: str) -> dict[str, dict[str, tuple[str, bool]]]:
    """从 DDL 提取 {表: {列: (类型, 可空)}}。"""
    out: dict[str, dict[str, tuple[str, bool]]] = {}
    for name, body in re.findall(
        r"CREATE TABLE IF NOT EXISTS (\w+)\s*\((.*?)\n\);", sql, re.S
    ):
        cols: dict[str, tuple[str, bool]] = {}
        for line in body.split("\n"):
            s = line.strip()
            if not s or s.startswith("--") or s.upper().startswith(SKIP_COLS):
                continue
            m = re.match(r"(\w+)\s+(INTEGER|TEXT|REAL|BLOB|NUMERIC)\b(.*)$", s)
            if not m:
                continue
            col, typ, rest = m.group(1), m.group(2), m.group(3)
            # 主键与 NOT NULL 的判定：PRIMARY KEY 隐含 NOT NULL
            not_null = bool(re.search(r"\bNOT\s+NULL\b", rest, re.I)) or bool(
                re.search(r"\bPRIMARY\s+KEY\b", rest, re.I)
            )
            cols[col] = (typ, not_null)
        out[name] = cols
    return out


def schema_indexes(sql: str) -> set[str]:
    names = set(re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF NOT EXISTS\s+(\w+)", sql, re.I))
    return names


def main() -> int:
    ok = True

    print("=" * 72)
    print("ORM 实体 ↔ code/db/schema.sql 一致性校验")
    print("=" * 72)

    from app.core.db import Base

    import app.models  # noqa: F401  触发实体注册

    sql = SCHEMA.read_text(encoding="utf-8")
    ddl = schema_tables(sql)

    orm_tables = {t.name: t for t in Base.metadata.sorted_tables}

    # ---------------- 1) 表集合 ----------------
    print()
    print("-" * 72)
    print("1) 表集合")
    print("-" * 72)
    miss = sorted(set(ddl) - set(orm_tables))
    extra = sorted(set(orm_tables) - set(ddl))
    if miss or extra:
        ok = False
        print(f"[FAIL] DDL 有而 ORM 无：{miss}")
        print(f"[FAIL] ORM 有而 DDL 无：{extra}")
    else:
        print(f"[ OK ] 表集合一致（{len(ddl)} 张）：{', '.join(sorted(ddl))}")

    # ---------------- 2) 逐表列名 / 类型 / 可空 ----------------
    print()
    print("-" * 72)
    print("2) 逐表列名 · 类型族 · 可空性")
    print("-" * 72)
    total_cols = 0
    for tname in sorted(ddl):
        if tname not in orm_tables:
            continue
        table = orm_tables[tname]
        orm_cols = {c.name: c for c in table.columns}
        ddl_cols = ddl[tname]
        total_cols += len(ddl_cols)

        name_miss = [c for c in ddl_cols if c not in orm_cols]
        name_extra = [c for c in orm_cols if c not in ddl_cols]
        type_bad: list[str] = []
        null_bad: list[str] = []

        for col, (typ, not_null) in ddl_cols.items():
            oc = orm_cols.get(col)
            if oc is None:
                continue
            orm_type = oc.type.__class__.__name__.upper()
            if orm_type != typ:
                type_bad.append(f"{col}:{orm_type}≠{typ}")
            # ORM 的 nullable 与 DDL 相反量：DDL not_null=True → ORM nullable=False
            if bool(oc.nullable) == not_null:
                null_bad.append(f"{col}:nullable={oc.nullable}")

        if name_miss or name_extra or type_bad or null_bad:
            ok = False
            print(f"[FAIL] {tname:18s} 缺列={name_miss} 多列={name_extra}")
            if type_bad:
                print(f"        类型不符：{type_bad}")
            if null_bad:
                print(f"        可空性不符：{null_bad}")
        else:
            print(f"[ OK ] {tname:18s} {len(ddl_cols):3d} 列 · 名称/类型/可空 全部一致")

    print(f"\n  {'合计':18s} {total_cols:3d} 列")

    # ---------------- 3) 索引名 ----------------
    print()
    print("-" * 72)
    print("3) 索 引")
    print("-" * 72)
    ddl_ix = schema_indexes(sql)
    orm_ix = {ix.name for t in Base.metadata.tables.values() for ix in t.indexes}
    ix_miss = sorted(ddl_ix - orm_ix)
    ix_extra = sorted(orm_ix - ddl_ix)
    if ix_miss or ix_extra:
        ok = False
        print(f"[FAIL] DDL 有而 ORM 无：{ix_miss}")
        print(f"[FAIL] ORM 有而 DDL 无：{ix_extra}")
    else:
        print(f"[ OK ] 显式索引集合一致（{len(ddl_ix)} 个）：{', '.join(sorted(ddl_ix))}")

    # ---------------- 4) 红线自检 ----------------
    print()
    print("-" * 72)
    print("4) 🔒 架 构 红 线")
    print("-" * 72)

    models_dir = ROOT / "app" / "models"
    dao_dir = ROOT / "app" / "dao"

    # 用 AST 而非正则：文档字符串里出现「DateTime」「import algo」这类
    # 说明文字时，正则会把注释当代码而误报（已验证踩过）。
    def scan(directory: Path) -> dict[str, tuple[set[str], set[str]]]:
        """返回 {相对路径: (导入的模块/名字集合, 被引用的名字集合)}。"""
        result: dict[str, tuple[set[str], set[str]]] = {}
        for py in sorted(directory.rglob("*.py")):
            tree = ast.parse(py.read_text(encoding="utf-8"), filename=str(py))
            imported: set[str] = set()
            used: set[str] = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for a in node.names:
                        imported.add(a.name)
                        imported.add(a.name.split(".")[0])
                elif isinstance(node, ast.ImportFrom):
                    mod = node.module or ""
                    imported.add(mod)
                    for a in node.names:
                        imported.add(a.name)
                        imported.add(f"{mod}.{a.name}")
                elif isinstance(node, ast.Name):
                    used.add(node.id)
                elif isinstance(node, ast.Attribute):
                    root = node
                    while isinstance(root, ast.Attribute):
                        root = root.value
                    if isinstance(root, ast.Name):
                        used.add(root.id)
            result[str(py.relative_to(ROOT))] = (imported, used)
        return result

    scanned = {**scan(models_dir), **scan(dao_dir)}

    # 4.1 app/models 不得出现 DateTime（导入或引用都算）
    bad_dt = [
        p for p, (imp, used) in scanned.items()
        if p.replace("\\", "/").startswith("app/models/")
        and ("DateTime" in imp or "sqlalchemy.DateTime" in imp or "DateTime" in used)
    ]
    if bad_dt:
        ok = False
        print(f"[FAIL] app/models 出现 DateTime（应为 TEXT）：{bad_dt}")
    else:
        print("[ OK ] app/models 无 DateTime（时间字段统一 TEXT · NFR-COMP-04）")

    # 4.2 app/dao 与 app/models 不得 import algo
    bad_algo = [
        p for p, (imp, _) in scanned.items()
        if any(m == "algo" or m.startswith("algo.") or m.startswith("app.algo")
               for m in imp)
    ]
    if bad_algo:
        ok = False
        print(f"[FAIL] dao/models 出现 import algo（架构红线 4）：{bad_algo}")
    else:
        print("[ OK ] app/dao 与 app/models 均未 import algo（架构红线 4）")

    # 4.3 app/dao 不得 import fastapi
    bad_fa = [
        p for p, (imp, _) in scanned.items()
        if p.replace("\\", "/").startswith("app/dao/")
        and any(m == "fastapi" or m.startswith("fastapi.") for m in imp)
    ]
    if bad_fa:
        ok = False
        print(f"[FAIL] dao 出现 import fastapi（分层应单向）：{bad_fa}")
    else:
        print("[ OK ] app/dao 未 import fastapi（分层单向 api → services → dao → models）")

    print()
    print("=" * 72)
    print("结论：全部通过" if ok else "结论：存在未通过项")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
