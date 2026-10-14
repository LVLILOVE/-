#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
=============================================================================
`WS-10-08` RAG 语料库抽取与自检
-----------------------------------------------------------------------------
依据文档 : 《项目任务书 V1.0.0》§5.2
             「RAG 语料库：根据提供的 skill.md 生成的语料库，
               以及用于构建 RAG 助手的提示词」
           《电商销量预测系统_RAG语料库与提示词_V1.0.md》（本脚本的数据源）
-----------------------------------------------------------------------------
产出：
  `outputs/电商销量预测系统_rag_corpus.json`   —— 结构化语料（数组）
  `outputs/电商销量预测系统_rag_corpus.jsonl`  —— 每行一块（流式/向量化入库更友好）
  `outputs/_rag_corpus_summary.txt`            —— 人读摘要（主题分布 / 块数）

🔒 单一数据源（本项目的一贯做法）
-----------------------------------------------------------------------------
语料块**只写在一个地方** —— `docs/…RAG语料库与提示词_V1.0.md`。
本脚本从该 Markdown 里按约定格式抽取，**不维护第二份副本**。
若在两个地方各写一份，早晚会漂移成「文档说的是 A、RAG 答的是 B」。

Markdown 中的语料块格式约定（🔒 改格式必须同步改本脚本）：

    ### `RC-ALGO-02` 五条必须保持的算法设计铁律

    - **主题**：算法
    - **出处**：项目实践（`app/algo/features.py`、`train.py`）
    - **标签**：`铁律` `残差` `序列切分`

    正文……

抽取规则：
  · 标题行匹配：三个井号 + 反引号包裹的 `RC-<主题>-<序号>` + 标题文本；
  · 紧随其后的 `- **主题**：` / `- **出处**：` / `- **标签**：` 三行是元数据；
  · 从元数据之后的第一个空行起，到下一个 `###` 或 `---` 或 `## ` 之前为正文；
  · 标签按反引号切分。

运行
-----------------------------------------------------------------------------
    <deploy python> scripts/build_rag_corpus.py
    <deploy python> scripts/build_rag_corpus.py --check   # 只自检，不写文件
=============================================================================
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "电商销量预测系统_RAG语料库与提示词_V1.0.md"
OUT_JSON = ROOT / "outputs" / "电商销量预测系统_rag_corpus.json"
OUT_JSONL = ROOT / "outputs" / "电商销量预测系统_rag_corpus.jsonl"
OUT_SUMMARY = ROOT / "outputs" / "_rag_corpus_summary.txt"

# 🔒 主题白名单：新增主题必须同时改这里与文档 —— 防止「顺手起了个新分类」
TOPIC_WHITELIST = {
    "项目概览", "架构与部署", "算法", "数据与指标口径",
    "数据库", "接口与契约", "安全与权限", "性能与容量", "踩坑与排错",
}

CHUNK_HEAD = re.compile(r"^###\s+`(?P<id>RC-[A-Z]+-\d{2})`\s+(?P<title>.+?)\s*$")
META = re.compile(r"^-\s+\*\*(?P<key>主题|出处|标签)\*\*：\s*(?P<value>.*)$")
# 正文的终止边界：下一个语料块标题、任意 ≤2 级标题、或独立分隔线
BODY_STOP = re.compile(r"^(###\s+`RC-|#{1,2}\s|---\s*$)")


def parse_chunks(text: str) -> list[dict]:
    lines = text.splitlines()
    chunks: list[dict] = []
    i = 0
    while i < len(lines):
        m = CHUNK_HEAD.match(lines[i])
        if not m:
            i += 1
            continue
        cid, title = m.group("id"), m.group("title").strip()
        meta: dict[str, str] = {}
        i += 1
        # ---- 元数据区：紧贴标题之后的**连续三条** `- **key**：` ----
        # ⚠️ 必须"连续性"判定，不能"扫到下一个标题为止"——
        #    后者会把正文一并当元数据吃掉（本脚本第一版就踩了这个坑：
        #    正文长度全变成 0，而自检恰好把它检出来了 —— 这正是"断言要有用"的价值）。
        while i < len(lines):
            mm = META.match(lines[i])
            if mm:
                meta[mm.group("key")] = mm.group("value").strip()
                i += 1
            elif lines[i].strip() == "":
                # 允许元数据之间夹空行，但只在还没读完三条时继续
                j = i
                while j < len(lines) and lines[j].strip() == "":
                    j += 1
                if j < len(lines) and META.match(lines[j]) and len(meta) < 3:
                    i = j
                else:
                    break
            else:
                break
        # ---- 正文区：到下一个块/标题/分隔线为止 ----
        body: list[str] = []
        while i < len(lines) and not BODY_STOP.match(lines[i]):
            body.append(lines[i])
            i += 1
        text_body = "\n".join(body).strip()
        tags = re.findall(r"`([^`]+)`", meta.get("标签", ""))
        chunks.append({
            "id": cid,
            "title": title,
            "topic": meta.get("主题", ""),
            "source": meta.get("出处", ""),
            "tags": tags,
            "text": f"{title}\n\n{text_body}",
            "chars": len(text_body),
        })
    return chunks


def validate(chunks: list[dict]) -> list[str]:
    errs: list[str] = []
    if len(chunks) < 40:
        errs.append(f"块数不足：{len(chunks)} < 40")
    ids = [c["id"] for c in chunks]
    dup = [k for k, v in Counter(ids).items() if v > 1]
    if dup:
        errs.append(f"id 重复：{dup}")
    for c in chunks:
        if not re.fullmatch(r"RC-[A-Z]+-\d{2}", c["id"]):
            errs.append(f"{c['id']} id 格式不符 RC-<主题>-<序号>")
        if c["topic"] not in TOPIC_WHITELIST:
            errs.append(f"{c['id']} 主题不在白名单：{c['topic']!r}")
        if not c["source"]:
            errs.append(f"{c['id']} 缺「出处」（无法溯源）")
        if not c["tags"]:
            errs.append(f"{c['id']} 缺「标签」（影响混合检索召回）")
        if not 80 <= c["chars"] <= 2000:
            errs.append(f"{c['id']} 正文长度 {c['chars']} 越界（期望 80–2000）")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只自检，不写文件")
    args = ap.parse_args()

    if not SRC.is_file():
        print(f"[FAIL] 语料源不存在：{SRC}")
        return 1

    chunks = parse_chunks(SRC.read_text(encoding="utf-8"))
    print(f"从 {SRC.name} 抽到 {len(chunks)} 个语料块")

    by_topic = Counter(c["topic"] for c in chunks)
    for t in sorted(by_topic):
        print(f"  · {t:<10} {by_topic[t]:>2} 块")

    errs = validate(chunks)
    if errs:
        print()
        for e in errs:
            print(f"[FAIL] {e}")
        return 1
    print("\n[ OK ] 自检通过：id 唯一 / 元数据齐备 / 主题合规 / 长度合规")

    if args.check:
        print("（--check 模式，未写出文件）")
        return 0

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = [{k: v for k, v in c.items() if k != "chars"} for c in chunks]
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    with OUT_JSONL.open("w", encoding="utf-8") as f:
        for c in payload:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")

    lines = [
        "=" * 74,
        "电商销量预测系统 —— RAG 语料库摘要",
        "=" * 74,
        f"数据源    : {SRC.relative_to(ROOT)}",
        f"语料块数  : {len(chunks)}",
        f"正文总字数: {sum(c['chars'] for c in chunks):,}",
        "",
        "主题分布：",
    ]
    lines += [f"  {t:<12} {by_topic[t]:>2}" for t in sorted(by_topic)]
    lines += ["", "块清单："]
    lines += [f"  {c['id']:<14} [{c['topic']}] {c['title']}" for c in chunks]
    lines.append("")
    OUT_SUMMARY.write_text("\n".join(lines), encoding="utf-8")

    print(f"\n[OK] {OUT_JSON.relative_to(ROOT)}")
    print(f"[OK] {OUT_JSONL.relative_to(ROOT)}")
    print(f"[OK] {OUT_SUMMARY.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
