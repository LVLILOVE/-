"""校验《数据库设计文档 V1.0》§5 收录的 SQL 与 code/db/schema.sql 是否一致。

用法：
    python scripts/verify_doc_sql.py

做两件事：
  1) 提取文档 §5 章节内的全部 ```sql 代码块，按顺序拼接，
     与 code/db/schema.sql 归一化（去空行、去行尾空白）后逐行比对。
  2) 比对文档 §4 数据字典的字段名集合与 schema.sql 中实际列名集合。

退出码 0 表示一致。若不一致，以 code/db/schema.sql 为准。
"""
from __future__ import annotations

import difflib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "电商销量预测系统_数据库设计文档_V1.0.md"
SCHEMA = ROOT / "code" / "db" / "schema.sql"


def norm(text: str) -> list[str]:
    """归一化：去空行、去行尾空白。返回行列表。"""
    out = []
    for line in text.split("\n"):
        s = line.rstrip()
        if s.strip():
            out.append(s)
    return out


def extract_section(text: str, start_pat: str, end_pat: str) -> str:
    m1 = re.search(start_pat, text, re.M)
    if not m1:
        raise SystemExit(f"[FAIL] 找不到章节起始：{start_pat}")
    m2 = re.search(end_pat, text[m1.end():], re.M)
    if not m2:
        raise SystemExit(f"[FAIL] 找不到章节结束：{end_pat}")
    return text[m1.end(): m1.end() + m2.start()]


def sql_blocks(section: str) -> list[str]:
    return re.findall(r"```sql\n(.*?)```", section, re.S)


def schema_columns(sql: str) -> dict[str, list[str]]:
    """从 DDL 提取每张表的列名。"""
    result: dict[str, list[str]] = {}
    skip = ("FOREIGN", "PRIMARY", "UNIQUE", "CHECK", "CONSTRAINT")
    for name, body in re.findall(
        r"CREATE TABLE IF NOT EXISTS (\w+)\s*\((.*?)\n\);", sql, re.S
    ):
        cols = []
        for line in body.split("\n"):
            s = line.strip()
            if not s or s.startswith("--") or s.upper().startswith(skip):
                continue
            m = re.match(r"(\w+)\s+(INTEGER|TEXT|REAL|BLOB|NUMERIC)", s)
            if m:
                cols.append(m.group(1))
        result[name] = cols
    return result


def main() -> int:
    if not DOC.exists():
        print(f"[FAIL] 找不到文档：{DOC}")
        return 1
    if not SCHEMA.exists():
        print(f"[FAIL] 找不到 DDL：{SCHEMA}")
        return 1

    doc_text = DOC.read_text(encoding="utf-8")
    schema_text = SCHEMA.read_text(encoding="utf-8")

    ok = True
    print("=" * 70)
    print("文档 §5 SQL 与 code/db/schema.sql 一致性校验")
    print("=" * 70)

    # ---------------- 1) SQL 全文比对 ----------------
    sec5 = extract_section(doc_text, r"^## 5\. 建表 SQL", r"^## 6\.")
    blocks = sql_blocks(sec5)
    joined = norm("\n".join(blocks))
    source = norm(schema_text)

    print(f"文档 §5 提取到 SQL 代码块 {len(blocks)} 个，归一化后 {len(joined)} 行")
    print(f"schema.sql 归一化后 {len(source)} 行")

    if joined == source:
        print("[ OK ] 两者逐行完全一致")
    else:
        ok = False
        print("[FAIL] 存在差异：")
        diff = list(
            difflib.unified_diff(source, joined, "schema.sql", "doc §5", lineterm="", n=1)
        )
        for line in diff[:60]:
            print("   " + line)
        if len(diff) > 60:
            print(f"   ...（共 {len(diff)} 行差异，已截断）")

    # ---------------- 2) 数据字典字段名比对（逐表） ----------------
    print()
    print("-" * 70)
    print("§4 数据字典字段名 与 schema.sql 列名 逐表比对")
    print("-" * 70)

    sec4 = extract_section(doc_text, r"^## 4\. 数据字典", r"^## 5\.")
    # §4.0 为阅读说明，§4.1~§4.8 依次对应 schema.sql 中表的定义顺序
    parts = re.split(r"^### 4\.\d+[^\n]*$", sec4, flags=re.M)[2:]
    tables = schema_columns(schema_text)

    if len(parts) != len(tables):
        ok = False
        print(f"[FAIL] 文档 §4 数据小节数 {len(parts)} 与表数 {len(tables)} 不匹配")
    else:
        for (tname, cols), sec in zip(tables.items(), parts):
            doc_cols: list[str] = []
            for line in sec.split("\n"):
                m = re.match(r"^\|\s*`([a-z_][a-z0-9_]*)`\s*\|\s*([^|]*)\|", line)
                if not m:
                    continue
                # 跳过「数据字典完整性核对」表：其第二列是纯数字（列数）
                if re.fullmatch(r"\d+", m.group(2).strip()):
                    continue
                doc_cols.append(m.group(1))
            miss = [c for c in cols if c not in doc_cols]
            extra = [c for c in doc_cols if c not in cols]
            if miss or extra:
                ok = False
                print(f"[FAIL] {tname:18s} 缺 {miss} ／ 多 {extra}")
            else:
                print(f"[ OK ] {tname:18s} {len(cols):3d} 列 · 字典齐全")

    # ---------------- 3) 逐表列数核对 ----------------
    print()
    print("-" * 70)
    print("逐表列数")
    print("-" * 70)
    total = 0
    for name, cols in tables.items():
        total += len(cols)
        print(f"  {name:18s} {len(cols):3d} 列")
    print(f"  {'合计':18s} {total:3d} 列")

    print()
    print("=" * 70)
    print("结论：全部一致" if ok else "结论：存在不一致（以 code/db/schema.sql 为准）")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
