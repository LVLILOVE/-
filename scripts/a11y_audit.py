# -*- coding: utf-8 -*-
"""
UI/UX 设计文档 · 无障碍对比度实测脚本（WCAG 2.1 AA）

**直接解析前端实际生效的 `web/src/theme/tokens.css`**（不再是脚本内硬编码的副本），
把设计令牌（oklch 色彩空间）还原为 sRGB，按 WCAG 2.1 相对亮度公式实算对比度，
输出「实测值 / 门槛 / 判定」。深浅双主题、含 on-color / on-soft 前景色与激活态染色。

链路：tokens.css -> oklch -> oklab -> 线性 sRGB -> gamma 编码 -> 相对亮度 -> 对比度

用法：
  python scripts/a11y_audit.py            # 审计（留存为文档证据，退出码 0 = 全通过）
  python scripts/a11y_audit.py --solve    # 反解：达标所需的 oklch L

⚠️ 令牌来源为何必须是前端文件：见下方第 2 节的说明。**改令牌请改
   `prototype/assets/app.css` 后重跑 `scripts/verify_tokens.py --write`**，
   本脚本与前端读的是同一个产物，不会出现「审计通过但线上不达标」。
"""
import math
import re
import sys
from pathlib import Path

# ==========================================================================
# 1. 色彩换算
# ==========================================================================

def _oklab_to_linear(L, a, b):
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)


def _gamma(c):
    c = min(max(c, 0.0), 1.0)
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def lin(L, C, h):
    """oklch -> 线性 sRGB"""
    return _oklab_to_linear(L, C * math.cos(math.radians(h)), C * math.sin(math.radians(h)))


def rgb(L, C, h):
    return tuple(round(min(max(v, 0.0), 1.0) * 255) for v in (_gamma(x) for x in lin(L, C, h)))


def hexs(t):
    """接受 (L,C,h) 或 线性 rgb"""
    return "#{:02x}{:02x}{:02x}".format(*rgb(*t)) if len(t) == 3 and t[0] <= 1 \
        else "#{:02x}{:02x}{:02x}".format(*[round(min(max(v, 0), 1) * 255) for v in t])


def rel_lum(lrgb):
    r, g, b = (min(max(v, 0.0), 1.0) for v in lrgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_lin(a, b):
    l1, l2 = rel_lum(a), rel_lum(b)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def over(fg, alpha, bg):
    return tuple(fg[i] * alpha + bg[i] * (1 - alpha) for i in range(3))


# ==========================================================================
# 2. 令牌来源：**直接解析前端实际生效的 `tokens.css`**
# ==========================================================================
# 🔒 **为什么不在这里抄一份常量表**：
#    本脚本早先的版本把令牌硬编码成 Python 字典（注释写着「与 app.css 一一对应」）。
#    代价是 —— **前端改了令牌，审计不会跟着变**，脚本会继续拿过期数值给出「通过」，
#    而且不报任何错。这类「审计与实现脱钩」比不审计更危险：它给出虚假的安全感。
#
#    现在改为解析 `web/src/theme/tokens.css`（由 `verify_tokens.py` 从
#    `prototype/assets/app.css` 生成，是前端**唯一实际生效**的令牌文件），
#    审计结论从此与线上渲染同源。
#
#    📌 这次改动当场就抓到一个真实缺陷：`prototype/assets/app.css` 里的
#    `html.dark .badge-*` 前景色 override **从未迁移到前端**（`verify_tokens.py`
#    只搬运 `:root` 与 `html.dark` 两个**令牌块**，不含组件规则 `.badge-*`），
#    而前端 badge 改用 `--success` 等语义色绘制 —— 深色主题下实测仅
#    3.62 / 3.07 / 3.52，不足 AA 4.5:1。已通过新增 `--on-*-soft` 令牌修复。

ROOT = Path(__file__).resolve().parents[1]
TOKENS_CSS = ROOT / "web" / "src" / "theme" / "tokens.css"

# 审计覆盖面：这些令牌必须能从 tokens.css 解析到。
# ⚠️ 缺任何一个都**直接报错**而不是静默跳过 —— 静默跳过会让某项审计凭空消失，
#    表现为「项数变少但全绿」，正是最难发现的那类假通过。
REQUIRED = (
    "bg", "bg-subtle", "surface", "surface-2",
    "border", "border-strong", "border-field",
    "text", "text-2", "text-3",
    "primary", "success", "warning", "danger", "info",
    "on-primary", "on-success", "on-danger",
    "on-primary-soft", "on-success-soft", "on-warning-soft",
    "on-danger-soft", "on-info-soft",
    "c1", "c2", "c3", "c4", "c5",
)

# `--name: oklch(L C H)` 或 `oklch(L C H / alpha)`；H 允许写成 `var(--brand-h)`
_RULE = re.compile(
    r"--([a-z0-9-]+)\s*:\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+"
    r"(var\(--brand-h\)|[0-9.]+)\s*(?:/\s*([0-9.]+)\s*)?\)"
)


def _block(css: str, selector: str) -> str:
    """取出 `selector { ... }` 的内容（按花括号配平）。"""
    at = css.index(selector + " {")
    i = css.index("{", at)
    depth = 0
    for j in range(i, len(css)):
        if css[j] == "{":
            depth += 1
        elif css[j] == "}":
            depth -= 1
            if depth == 0:
                return css[i + 1:j]
    raise ValueError(f"`{selector}` 块未闭合")


def parse_tokens(path: Path):
    """tokens.css → (浅色令牌, 深色令牌, 浅色 soft 透明度, 深色 soft 透明度)。"""
    css = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
    m = re.search(r"--brand-h\s*:\s*([0-9.]+)", css)
    if not m:
        raise SystemExit(f"tokens.css 缺少 `--brand-h`：{path}")
    brand_h = float(m.group(1))

    def one(selector: str):
        solid, soft = {}, {}
        for name, L, C, H, alpha in _RULE.findall(_block(css, selector)):
            hue = brand_h if H.startswith("var") else float(H)
            # ⚠️ `findall` 对「存在但未参与匹配」的组返回 `''` 而**不是** `None`，
            #    所以这里判空串；用 `is not None` 会把无 alpha 的令牌也当成 soft。
            if alpha != "":
                # 只有 `--{k}-soft` 是「语义色的低透明度底」。
                # 🔴 **后缀判据不能省**：`--primary-ring` 同样带 alpha，若只按「有 alpha」
                #    就进软色表，`name[:-5]` 会把 `-ring` 截掉得到 `primary`，
                #    从而把主色底的不透明度**覆盖**成 0.35 —— 曾实际发生，
                #    直接导致 `--primary` on `--primary-soft` 被误判为 2.10:1。
                if name.endswith("-soft"):
                    soft[name[: -len("-soft")]] = float(alpha)
            else:
                solid[name] = (float(L), float(C), hue)
        return solid, soft

    l_solid, l_soft = one(":root")
    d_solid, d_soft = one("html.dark")
    for label, table in ((":root", l_solid), ("html.dark", d_solid)):
        missing = [k for k in REQUIRED if k not in table]
        if missing:
            raise SystemExit(f"tokens.css 的 `{label}` 缺令牌：{missing}")
    return l_solid, d_solid, l_soft, d_soft


LIGHT, DARK, SOFT, SOFT_DARK = parse_tokens(TOKENS_CSS)
WHITE = (1.0, 1.0, 1.0)


def audit(T, label):
    rows = []

    def bg_of(name):
        return lin(*T[name])

    def soft_over(tok, base):
        a = (SOFT_DARK if T is DARK else SOFT)[tok]
        return over(lin(*T[tok]), a, bg_of(base))

    def chk(name, fg, bg, need, note="", waive=False):
        rows.append((name, contrast_lin(fg, bg), need, note, waive))

    # ---- 正文 / 辅助文字（AA 4.5） ----
    for base in ("surface", "bg", "surface-2", "bg-subtle"):
        for txt, nm in (("text", "--text"), ("text-2", "--text-2"), ("text-3", "--text-3")):
            chk(f"{nm} on --{base}", lin(*T[txt]), bg_of(base), 4.5,
                "辅助文字/占位符" if txt == "text-3" else "")

    # ---- 语义色作为正文（日志流 / 表单错误） ----
    for k in ("primary", "success", "warning", "danger"):
        chk(f"--{k} 作正文 on --bg-subtle", lin(*T[k]), bg_of("bg-subtle"), 4.5, "日志流/错误提示")
    chk("--danger 作正文 on --surface", lin(*T["danger"]), bg_of("surface"), 4.5, "字段错误提示")

    # ---- 主色作链接/激活文字（含所在底色） ----
    for base in ("surface", "bg", "surface-2", "bg-subtle"):
        chk(f"--primary 作文字 on --{base}", lin(*T["primary"]), bg_of(base), 4.5, "链接/激活态")
    chk("--primary 作文字 on --primary-soft/surface", lin(*T["primary"]), soft_over("primary", "surface"), 4.5, "激活行/选中项")
    chk("--primary 作文字 on --primary-soft/bg-subtle", lin(*T["primary"]), soft_over("primary", "bg-subtle"), 4.5, "侧栏激活项")

    # ---- 警示/提示面板正文（soft 底） ----
    for k in ("success", "warning", "danger", "info"):
        chk(f"--text on --{k}-soft", lin(*T["text"]), soft_over(k, "surface"), 4.5, "alert 正文")
    chk("--text-2 on --warning-soft", lin(*T["text-2"]), soft_over("warning", "surface"), 4.5, "免责声明正文")

    # ---- on-color：实色填充之上的前景色 ----
    for k, onk in (("primary", "on-primary"), ("success", "on-success"), ("danger", "on-danger")):
        chk(f"--{onk} on --{k}（实色填充）", lin(*T[onk]), lin(*T[k]), 4.5, "按钮/阶段图标/徽标计数")
    chk("--on-primary on --border-field（开关旋钮）", lin(*T["on-primary"]), lin(*T["border-field"]), 3.0, "开关未选中态")

    # ---- 徽标 / 状态标文字（soft 底之上）----
    # 🔒 按**前端的真实写法**审计：`background: var(--{k}-soft)` + `color: var(--on-{k}-soft)`
    #    （见 StepBadges / StageList / HistoryPage 状态徽标 / MetricPanels verdict-chip）。
    #    若这里沿用 `--{k}`，测的就是一个「前端并不存在的配色」—— 测过也没意义，
    #    且会漏掉深色主题下真实的对比度不足（这正是本脚本接前端后抓到的缺陷）。
    for k in ("primary", "success", "warning", "danger", "info"):
        chk(f"badge-{k} 字（on-{k}-soft on {k}-soft）",
            lin(*T[f"on-{k}-soft"]), soft_over(k, "surface"), 4.5)

    # ---- 语义色作图标（SC 1.4.11，3:1） ----
    for k in ("primary", "success", "warning", "danger", "info"):
        chk(f"--{k} 作图标 on --surface", lin(*T[k]), bg_of("surface"), 3.0, "alert/日志图标")

    # ---- 图表色（3:1） ----
    for k in ("c1", "c2", "c3", "c4", "c5"):
        chk(f"--{k} 作图形 on --surface", lin(*T[k]), bg_of("surface"), 3.0, "图表线/柱")
    chk("--c1 作图形 on --surface-2", lin(*T["c1"]), bg_of("surface-2"), 3.0, "表格内联数值条")

    # ---- 组件边界（SC 1.4.11，3:1） ----
    chk("--border-field vs --surface-2", lin(*T["border-field"]), bg_of("surface-2"), 3.0, "表单/次级按钮/开关描边")
    chk("--border-field vs --surface", lin(*T["border-field"]), bg_of("surface"), 3.0, "次级按钮描边")
    chk("--border-strong vs --surface", lin(*T["border-strong"]), bg_of("surface"), 3.0,
        "仅剩装饰性分隔线", waive=True)
    chk("--border vs --surface", lin(*T["border"]), bg_of("surface"), 3.0, "卡片描边（填充+阴影识别）", waive=True)

    # ---- 进度环 ----
    chk("进度环 --success vs --surface-2", lin(*T["success"]), bg_of("surface-2"), 3.0)

    w = max(len(n) for n, *_ in rows)
    print("\n" + "=" * 82)
    print(f"  {label}")
    print("=" * 82)
    fail = waive = 0
    for name, c, need, note, wv in rows:
        ok = c >= need - 1e-9
        tag = "PASS" if ok else ("豁免" if wv else "FAIL")
        if not ok:
            if wv:
                waive += 1
            else:
                fail += 1
        print(f"  [{tag}] {name:<{w}} {c:5.2f}:1 (需 {need})"
              + (f"  <- {note}" if note and not ok else ""))
    print("-" * 82)
    print(f"  合计 {len(rows)} 项：PASS {len(rows)-fail-waive}，FAIL {fail}，豁免 {waive}")
    return fail


# ==========================================================================
# 3. 反解：达标所需 L
# ==========================================================================

def solve_L(C, h, base_bg, target, direction):
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        ok = contrast_lin(lin(mid, C, h), base_bg) >= target
        if direction < 0:      # L 越小对比越高
            lo, hi = (mid, hi) if ok else (lo, mid)
        else:                  # L 越大对比越高
            lo, hi = (lo, mid) if ok else (mid, hi)
    L = lo if direction < 0 else hi
    return L, contrast_lin(lin(L, C, h), base_bg)


def do_solve():
    def block(title, tasks, T):
        print("\n" + "=" * 82)
        print(f"  {title}")
        print("=" * 82)
        for tok, target, bgname, d, note in tasks:
            _, C, h = T[tok]
            bg = WHITE if bgname == "WHITE" else lin(*T[bgname])
            L, got = solve_L(C, h, bg, target, d)
            Lr = round(L, 3)
            print(f"  --{tok:<16} C={C:<5} h={h:<6.0f} 目标 {target}:1 vs {bgname}")
            print(f"      L≈{Lr:<6} -> {hexs((Lr, C, h))}   实得 "
                  f"{contrast_lin(lin(Lr, C, h), bg):.2f}:1   [{note}]")

    # ⚠️ C / h 一律从 tokens.css 解析结果取（不再写死常量），
    #    这样「反解出的建议 L」与当前令牌是同一套色度，可直接照抄。
    block("浅色主题 · 达标所需 oklch L 反解（C / h 取当前令牌，保持不变）", [
        ("text-3",       4.5, "bg-subtle", -1, "辅助文字，最深浅底"),
        ("primary",      4.5, "bg-subtle", -1, "白字于按钮 / 链接文字"),
        ("success",      4.5, "WHITE",     -1, "白字于实色（阶段序号）"),
        ("danger",       4.5, "WHITE",     -1, "白字于实色（危险按钮）"),
        ("warning",      4.5, "bg-subtle", -1, "日志警示文字"),
        ("info",         4.5, "WHITE",     -1, "与徽标字一致"),
        ("border-field", 3.0, "surface-2", -1, "表单/次级按钮描边"),
        ("c2",           3.0, "surface",   -1, "图表色"),
        ("c3",           3.0, "surface",   -1, "图表色"),
    ], LIGHT)

    block("深色主题 · 达标所需 oklch L 反解", [
        ("text-3",       4.5, "surface-2", +1, "辅助文字，最亮深底"),
        ("primary",      4.5, "surface",   +1, "链接/激活文字"),
        ("border-field", 3.0, "surface-2", +1, "表单/次级按钮描边"),
    ], DARK)


if __name__ == "__main__":
    if "--solve" in sys.argv:
        do_solve()
    else:
        f = audit(LIGHT, "浅色主题（:root）")
        f += audit(DARK, "深色主题（html.dark）")
        print("\n" + "#" * 82)
        print(f"  深浅双主题合计 FAIL {f} 项")
        print("#" * 82)
        sys.exit(0 if f == 0 else 1)
