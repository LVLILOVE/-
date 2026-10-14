"""
=============================================================================
设计令牌移植与校验（DOD-EP0）
-----------------------------------------------------------------------------
作用：
  1. 从 prototype/assets/app.css 原样提取 `:root` 与 `html.dark` 两个令牌块，
     写入 web/src/theme/tokens.css（🔒 oklch() 不改写为 hex）。
  2. 校验：tokens.css 中 `oklch(` 出现次数 ≥ 56，且 `#` 十六进制色值 0 个。

用法：
    python scripts/verify_tokens.py            # 只校验（CI / 交付前）
    python scripts/verify_tokens.py --write    # 重新提取并覆盖 tokens.css
=============================================================================
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "prototype" / "assets" / "app.css"
DST = ROOT / "web" / "src" / "theme" / "tokens.css"

HEADER = """/* ==========================================================================
   设计令牌（自动生成，勿手改）—— 来源 prototype/assets/app.css 的
   :root 与 html.dark 两个令牌块，原样移植。颜色一律 oklch()，禁止改写为 hex。
   如需调整令牌，请修改 app.css 后重跑 scripts/verify_tokens.py --write。
   ========================================================================== */
"""


def _extract_block(text: str, selector: str) -> str:
    """提取形如 `selector { ... }` 的块（块内无嵌套花括号）。"""
    start = text.find(selector + " {")
    if start == -1:
        raise SystemExit(f"未在 app.css 中找到块：{selector} {{")
    brace_open = text.find("{", start)
    depth = 0
    i = brace_open
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
        i += 1
    raise SystemExit(f"块 {selector} {{ 未闭合")


def extract_tokens(src: Path) -> str:
    text = src.read_text(encoding="utf-8")
    root_block = _extract_block(text, ":root")
    dark_block = _extract_block(text, "html.dark")
    return HEADER + "\n" + root_block + "\n\n" + dark_block + "\n"


def verify(dst: Path) -> tuple[int, int]:
    text = dst.read_text(encoding="utf-8")
    oklch_count = len(re.findall(r"oklch\(", text))
    hex_count = len(re.findall(r"#[0-9a-fA-F]{3,8}\b", text))
    return oklch_count, hex_count


def main() -> int:
    write = "--write" in sys.argv
    if write or not DST.exists():
        DST.parent.mkdir(parents=True, exist_ok=True)
        DST.write_text(extract_tokens(SRC), encoding="utf-8")
        print(f"[write] 已生成 {DST}")

    oklch_count, hex_count = verify(DST)
    print(f"tokens.css 校验：oklch( = {oklch_count} 处，hex(#) = {hex_count} 处")
    ok = oklch_count >= 56 and hex_count == 0
    if not ok:
        print("❌ 校验失败：")
        if oklch_count < 56:
            print(f"   oklch( 出现次数 {oklch_count} < 56")
        if hex_count > 0:
            print(f"   出现 {hex_count} 处十六进制色值，违反「禁止改写为 hex」")
        return 1
    print("✅ 通过：oklch 保留且 ≥ 56，无 hex 色值")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
