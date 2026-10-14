"""校验文档引用的 FR-*/NFR-* 编号是否与 PRD V1.0 一致。

用法：
    python scripts/verify_doc_refs.py

背景（本脚本的由来）：
    数据库设计文档初版沿用了**一套与 PRD 不一致的旧编号**——例如把
    `FR-MOD-01` 标为「创建预测任务」，而 PRD 中它是「数据按时间 8:1:1 切分」；
    又自造了 PRD 中并不存在的 `NFR-DEP-*`。这类「编号漂移」肉眼极难发现
    （编号看着都对得上，语义却错了），故固化为自动校验。

做四件事：
    1) 提取 PRD §3/§4 中真实存在的全部 FR-*/NFR-* 编号；
    2) 提取**全部受管文档**引用的编号，报告**悬空引用**（文档有、PRD 无）；
    3) 核对数据库设计文档 §11.1 追溯矩阵的条数与 PRD 功能需求总量是否自洽；
    4) 单独报告「已知新增编号」（如 FR-ADM-*，属 CH-01 管理端增量，待回写 PRD），
       不计入失败——这类编号**必须**在文档中带【待补充】标注。

受管文档（新增文档请追加到 EXTRA_DOCS）：
    - 数据库设计文档 V1.0（含 §11.1 矩阵专项核对）
    - 项目开发实施方案 V1.0
    - 开发技术文档 / UIUX 设计文档 / 测试报告 V1.0
    - 部署运维手册 / 项目说明 / AI 协作教程 / RAG 语料库与提示词 / 演示脚本 V1.0
      （EP-10 WS-10-08 起纳入：交付文档全量受管）
    - 项目文件总览与交付清单 V1.0（工作区整理时新增）

退出码 0 表示无「非预期」悬空引用。语义一致性仍需人工比对（本脚本只保证编号存在）。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRD = ROOT / "docs" / "电商销量预测系统_PRD_V1.0.md"
DOC = ROOT / "docs" / "电商销量预测系统_数据库设计文档_V1.0.md"

# 追加受管的文档（只做悬空引用检查，不做 §11.1 矩阵专项核对）
# EP-10（WS-10-08 文档收敛）：受管范围扩到**全部交付文档**，
# 使「改了 PRD 编号但漏改下游文档」在 CI 里就能被检出。
EXTRA_DOCS = [
    ROOT / "docs" / "电商销量预测系统_项目开发实施方案_V1.0.md",
    ROOT / "docs" / "电商销量预测系统_开发技术文档_V1.0.md",
    ROOT / "docs" / "电商销量预测系统_UIUX设计文档_V1.0.md",
    ROOT / "docs" / "电商销量预测系统_测试报告_V1.0.md",
    ROOT / "docs" / "电商销量预测系统_部署运维手册_V1.0.md",
    ROOT / "docs" / "电商销量预测系统_项目说明_V1.0.md",
    ROOT / "docs" / "电商销量预测系统_AI协作教程_V1.0.md",
    ROOT / "docs" / "电商销量预测系统_RAG语料库与提示词_V1.0.md",
    ROOT / "docs" / "电商销量预测系统_演示脚本_V1.0.md",
    ROOT / "docs" / "电商销量预测系统_项目文件总览与交付清单_V1.0.md",
]

# 已知新增编号：属 CH-01（管理端增量），PRD 尚未定义，允许暂时悬空。
# 约束：这些编号在文档中必须带【待补充】标注（下方 check_doc 会校验）。
KNOWN_PENDING_PREFIXES = ("FR-ADM-",)

# 已退役编号：曾在原型 / 旧稿中出现、现已纠正为 PRD 编号。
# 允许被**引用说明**（保留审计留痕），不计入悬空；但同一文档必须出现修正语，
# 否则仍判失败 —— 避免「退役登记」被用来掩盖真正的编号漂移。
RETIRED_CODES = {
    "FR-HIS-07": "EP-10 WS-10-08 修正为 FR-HIS-04（跨任务曲线/指标对比）",
    "FR-HIS-08": "EP-10 WS-10-08 修正为 FR-HIS-04 附注（数据文件不可比警告）",
}
RETIRE_ACK_WORDS = ("已", "修正", "纠正", "退役", "对齐")

CODE_RE = re.compile(r"(?:FR|NFR)-[A-Z]+-\d{2}")
# 矩阵行形如 | `FR-XXX-nn` 描述 | 落库位置 | 列 |，或 | `FR-XXX-nn` | 描述 | ... |
ROW_RE = re.compile(r"^\|\s*`((?:FR|NFR)-[A-Z]+-\d{2})`[^|]*\|")

FUNC_PREFIXES = ("USR", "UPL", "FEA", "MOD", "VIS", "HIS", "SYS")


def main() -> int:
    if not (PRD.exists() and DOC.exists()):
        print("[FAIL] 找不到 PRD 或数据库设计文档")
        return 1

    prd = PRD.read_text(encoding="utf-8")
    doc = DOC.read_text(encoding="utf-8")

    valid = set(CODE_RE.findall(prd))
    used = set(CODE_RE.findall(doc))
    dangling = sorted(c for c in used if c not in valid)

    print("=" * 70)
    print("数据库设计文档 · FR/NFR 编号引用校验")
    print("=" * 70)
    print(f"PRD 中真实存在的编号 : {len(valid)} 个")
    print(f"本文档引用的编号     : {len(used)} 个")

    ok = True

    print()
    print("-" * 70)
    print("1) 悬空引用（本文档有、PRD 无）")
    print("-" * 70)
    if dangling:
        ok = False
        for c in dangling:
            i = doc.find(c)
            ctx = doc[max(0, i - 50): i + 30].replace("\n", " ")
            print(f"  [FAIL] {c}  ...{ctx}...")
    else:
        print("  [ OK ] 无悬空引用")

    print()
    print("-" * 70)
    print("2) §11.1 追溯矩阵 vs PRD 功能需求总量")
    print("-" * 70)
    sec = doc[doc.find("### 11.1"): doc.find("### 11.2")]
    rows = [m.group(1) for line in sec.split("\n") if (m := ROW_RE.match(line))]
    func_rows = [c for c in rows if c.split("-")[1] in FUNC_PREFIXES]
    prd_func = {c for c in valid if c.split("-")[1] in FUNC_PREFIXES}
    print(f"  PRD 功能需求（FR-USR/UPL/FEA/MOD/VIS/HIS/SYS 去重）: {len(prd_func)} 条")
    print(f"  §11.1 矩阵中带表/列落点的条目                    : {len(func_rows)} 条")
    if len(func_rows) > len(prd_func):
        ok = False
        print("  [FAIL] 矩阵条目数多于 PRD 功能需求总量")
    else:
        print("  [ OK ] 矩阵条目数不超过 PRD 功能需求总量")

    print()
    print("-" * 70)
    print("3) 逐模块覆盖对照")
    print("-" * 70)
    for p in FUNC_PREFIXES:
        total = sum(1 for c in prd_func if c.startswith(f"FR-{p}-"))
        mapped = sum(1 for c in func_rows if c.startswith(f"FR-{p}-"))
        print(f"  FR-{p:4s}  PRD {total:3d} 条 · 矩阵 {mapped:3d} 条 · 差 {total - mapped:3d} 条（不落库）")

    print()
    print("-" * 70)
    print("4) 其余受管文档的悬空引用")
    print("-" * 70)
    scanned = 0
    for extra in EXTRA_DOCS:
        if not extra.exists():
            print(f"  [SKIP] {extra.name}（文件不存在）")
            continue
        scanned += 1
        text = extra.read_text(encoding="utf-8")
        used_x = set(CODE_RE.findall(text))
        dangle_x = sorted(c for c in used_x if c not in valid)
        pending = [c for c in dangle_x if c.startswith(KNOWN_PENDING_PREFIXES)]
        retired = [c for c in dangle_x if c in RETIRED_CODES]
        real_dangle = [
            c for c in dangle_x
            if not c.startswith(KNOWN_PENDING_PREFIXES) and c not in RETIRED_CODES
        ]

        print(f"  · {extra.name}")
        print(f"      引用 {len(used_x)} 个编号")
        if real_dangle:
            ok = False
            for c in real_dangle:
                i = text.find(c)
                ctx = text[max(0, i - 50): i + 30].replace("\n", " ")
                print(f"      [FAIL] 悬空 {c}  ...{ctx}...")
        else:
            print("      [ OK ] 无非预期悬空引用")

        if retired:
            # 已退役编号必须带修正说明，否则仍判失败
            acked = all(w in text for w in RETIRE_ACK_WORDS[:2]) or "退役" in text
            if acked:
                for c in retired:
                    print(f"      [ OK ] 已退役编号 {c}（{RETIRED_CODES[c]}）")
            else:
                ok = False
                print(f"      [FAIL] 出现已退役编号 {retired}，但文档未写明修正说明")

        if pending:
            # 已知新增编号必须带【待补充】标注，否则也判失败
            if "待补充" in text:
                print(f"      [ OK ] 已知新增编号 {pending}（CH-01 管理端，已标注【待补充】）")
            else:
                ok = False
                print(f"      [FAIL] 已知新增编号 {pending} 但文档未标注【待补充】")
    if scanned == 0:
        print("  （无受管附加文档）")

    print()
    print("=" * 70)
    print("结论：编号引用无悬空" if ok else "结论：存在悬空引用或计数不自洽（需修正）")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
