"""
=============================================================================
`EP-3` 静态校验（DOD-EP3）
-----------------------------------------------------------------------------
覆盖 5 条验收项中**可在不启动浏览器的情况下**判定的部分：

  ① 🔒 首页硬指标与 outputs/eval_report.json 同源
       - 两个 JSON 深度相等（构建期注入未过期）
       - web/src/generated/metrics.ts 内**不含任何实测数值字面量**
       - metrics.ts 确实 import 了 ./eval_report.json
  ② 原型痕迹清理：`.state-bar` / `.spec-note` / `.diff-note` / 原型演示指标常量
       在 web/src 下**零命中**；`README.html` 未被迁移
  ③ 🔒 免责声明单点定义 + 4 个模板全部挂载 + 文案不可折叠
  ④ 首页四区块标记齐全 + 首屏含"一分钟"（UX-P01-01）
  ⑤ 数据集元信息与差异对照表的出处可追溯

用法：
    python scripts/verify_ep3.py
退出码：0 = 全通过，1 = 存在失败项
=============================================================================
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_SRC = ROOT / "web" / "src"
EVAL_SRC = ROOT / "outputs" / "eval_report.json"
EVAL_DST = WEB_SRC / "generated" / "eval_report.json"
METRICS_TS = WEB_SRC / "generated" / "metrics.ts"
FOOTER_TSX = WEB_SRC / "components" / "SiteFooter.tsx"
HOME_TSX = WEB_SRC / "pages" / "HomePage.tsx"

# 必须挂载全局页脚的布局/外壳（模板 A/B 共用 AppShell）
FOOTER_HOSTS = [
    WEB_SRC / "layouts" / "MarketingLayout.tsx",  # 模板 D
    WEB_SRC / "layouts" / "AuthLayout.tsx",  # 模板 C
    WEB_SRC / "layouts" / "AppShell.tsx",  # 模板 A + B
]

# 原型专用痕迹（UX-GOV-01 / WS-3-06），在产品代码里必须零命中
PROTOTYPE_LEAKS = [".state-bar", "state-bar", ".spec-note", "spec-note", ".diff-note", "diff-note"]
# 原型内嵌演示指标常量的名字（不再是产品侧真源）
LEGACY_CONST = "REAL_" + "EVAL"  # 拼接写法：避免本文件自身被"痕迹扫描"误伤

DISCLAIMER_KEY = "不构成任何经营决策依据"
DISCLAIMER_TAIL = "不作其他用途"

results: list[tuple[str, bool, str]] = []

# 注释剥离器 —— 本文件所有「痕迹/字面量」扫描都必须先剥注释再扫。
# 教训（EP-1 已踩过一次）：直接把文档字符串里的说明文字当代码扫，
# 会出现「为了说明『已移除 X』而在注释里写 X，反而被判违规」的荒谬误报。
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_LINE_COMMENT = re.compile(r"(?m)(?<!:)//[^\n]*")


def strip_comments(text: str) -> str:
    """剥掉 TS/TSX/CSS 注释，只留下真实代码。"""
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub(" ", text))


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))


def read(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def read_code(path: Path) -> str:
    """读取并剥注释后的代码文本。"""
    return strip_comments(read(path))


def iter_src_files() -> list[Path]:
    return [p for p in WEB_SRC.rglob("*") if p.is_file() and p.suffix in {".ts", ".tsx", ".css"}]


# ---------------------------------------------------------------- ① 指标同源
def check_metrics() -> None:
    if not EVAL_SRC.exists():
        check("①-1 eval_report.json 存在", False, f"缺少 {EVAL_SRC.relative_to(ROOT)}")
        return
    check("①-1 eval_report.json 存在", True, str(EVAL_SRC.relative_to(ROOT)))

    src_obj = json.loads(EVAL_SRC.read_text(encoding="utf-8"))
    if not EVAL_DST.exists():
        check("①-2 前端注入件存在", False, f"缺少 {EVAL_DST.relative_to(ROOT)}，请跑 sync_eval_metrics.py")
        return
    dst_obj = json.loads(EVAL_DST.read_text(encoding="utf-8"))
    same = dst_obj == src_obj
    check(
        "①-2 注入件与算法产出逐项一致",
        same,
        "深度相等" if same else "不一致！请重跑 python scripts/sync_eval_metrics.py",
    )

    ts_code = read_code(METRICS_TS)
    ts = read(METRICS_TS)
    if not ts:
        check("①-3 metrics.ts 存在", False, "缺少 web/src/generated/metrics.ts")
        return
    check("①-3 metrics.ts 存在", True, f"{len(ts)} 字节")

    imported = bool(re.search(r"from\s+['\"]\./eval_report\.json['\"]", ts_code))
    check("①-4 metrics.ts 确实 import 了注入件", imported, "./eval_report.json")

    # 所有「不该被手写」的数值：verdict.checks 的 2 位小数、metrics 的每个字段、timing 的整数
    forbidden: set[str] = set()
    for c in src_obj.get("verdict", {}).get("checks", []):
        forbidden.add(f"{float(c['value']):.2f}")
        forbidden.add(f"{float(c['value']):.4f}")
    for v in src_obj.get("metrics", {}).values():
        if isinstance(v, (int, float)):
            forbidden.add(f"{float(v):.2f}")
    for v in src_obj.get("coverage", {}).values():
        if isinstance(v, float):
            forbidden.add(f"{float(v):.2f}")
    for v in src_obj.get("timing_ms", {}).values():
        if isinstance(v, int):
            forbidden.add(str(v))

    hits = []
    for lit in sorted(forbidden):
        # 独立数字 token 匹配（前后不能再跟数字），避免 "1.32" 命中 "11.321"
        if re.search(rf"(?<![\d.]){re.escape(lit)}(?![\d])", ts_code):
            hits.append(lit)
    check(
        "①-5 🔒 metrics.ts 内无实测数值字面量（已剥注释）",
        not hits,
        "未发现硬编码" if not hits else f"发现硬编码数值：{', '.join(hits)}",
    )

    # 透明化：把所有出现的浮点字面量列出来供人工复核
    floats = sorted(set(re.findall(r"(?<![\w.])(\d+\.\d+)(?![\w])", ts_code)))
    check(
        "①-6 metrics.ts 浮点字面量清单",
        True,
        f"{floats if floats else '（无）'}（仅 toFixed 精度参数等非指标值）",
    )


# ------------------------------------------------------------ ② 原型痕迹清理
def check_prototype_traces() -> None:
    files = iter_src_files()
    offenders: list[str] = []
    for p in files:
        code = read_code(p)  # ← 剥注释：说明「已移除 X」的注释不算违规
        for token in PROTOTYPE_LEAKS + [LEGACY_CONST]:
            if token in code:
                offenders.append(f"{p.relative_to(WEB_SRC)} → {token}")
    check(
        "②-1 🔒 原型痕迹零命中（.state-bar/.spec-note/.diff-note/演示指标常量）",
        not offenders,
        "零命中（已剥注释）" if not offenders else f"{len(offenders)} 处：{offenders[:5]}",
    )

    readme = [p for p in WEB_SRC.rglob("*") if p.name.lower() == "readme.html"]
    check("②-2 原型 README.html 未迁移", not readme, "未发现" if not readme else str(readme))

    # 演示账号信息块（EP-2 红线，EP-3 一并回归）
    demo = [
        p.name
        for p in files
        if any(t in read_code(p) for t in (".demo-accounts", "wanglin@shop-demo", "demo1234"))
    ]
    check("②-3 演示账号痕迹零命中（EP-2 红线回归）", not demo, "零命中（已剥注释）" if not demo else str(demo))


# ------------------------------------------------- ③ 免责声明（FR-SYS-05 🔒）
def check_disclaimer() -> None:
    footer = read(FOOTER_TSX)
    if not footer:
        check("③-1 SiteFooter 存在", False, "缺少 web/src/components/SiteFooter.tsx")
        return
    check("③-1 SiteFooter 存在", True, "单点定义免责声明")

    check(
        "③-2 🔒 免责声明文案完整（UX-CMP-02 原文）",
        DISCLAIMER_KEY in footer and DISCLAIMER_TAIL in footer,
        "关键句齐全",
    )

    hosts_ok: list[str] = []
    hosts_bad: list[str] = []
    for p in FOOTER_HOSTS:
        t = read(p)
        if "SiteFooter" in t and re.search(r"<SiteFooter\b", t):
            hosts_ok.append(p.name)
        else:
            hosts_bad.append(p.name)
    check(
        "③-3 🔒 4 个模板均挂载全局页脚（D=Marketing / C=Auth / A+B=AppShell）",
        not hosts_bad,
        f"已挂载：{', '.join(hosts_ok)}" if not hosts_bad else f"缺失：{', '.join(hosts_bad)}",
    )

    # 文案只有一处定义：其他文件不得再出现同一句话（防两份文案漂移）
    dupes = []
    for p in iter_src_files():
        if p.resolve() == FOOTER_TSX.resolve():
            continue
        if DISCLAIMER_KEY in read_code(p):
            dupes.append(p.name)
    check(
        "③-4 免责声明文案单点定义（无第二份拷件）",
        not dupes,
        "仅 SiteFooter.tsx" if not dupes else f"重复定义：{dupes}",
    )

    # 不可折叠：不得出现折叠控件或高度截断。
    # 只扫**代码**（剥注释），且用精确 token —— `aria-hidden` 是无障碍属性，
    # 不是「折叠」，不能用裸 "hidden" 去扫（会误报）。
    fold_tokens = ["<details", "<summary", "maxHeight", "max-height", "Collapse", "collapsible"]
    fold_code = read_code(FOOTER_TSX)
    fold_hits = [t for t in fold_tokens if t in fold_code]
    check(
        "③-5 🔒 免责声明不可折叠 / 不截断（静态）",
        not fold_hits,
        "无折叠控件与高度截断" if not fold_hits else f"发现：{fold_hits}",
    )


# ------------------------------------------------------------- ④ 首页四区块
def check_home_blocks() -> None:
    home = read(HOME_TSX)
    if not home:
        check("④-1 HomePage 存在", False, "缺少 web/src/pages/HomePage.tsx")
        return

    blocks = {
        "① 首屏 hero": "hero-facts" in home and "HeroChart" in home,
        "② 核心能力": "feat-grid" in home and "feat-req" in home,
        "③ 使用流程": "steps" in home and "step-n" in home,
        "④ 基准数据集": "dataset-card" in home and "DATASET_FIELDS" in home,
    }
    for name, ok in blocks.items():
        check(f"④ 首页区块 {name}", ok)

    check(
        "④-5 🔒 硬指标披露条 `.eval-metrics`（含 data-metric / data-value 校验钩子）",
        "eval-metrics" in home and "data-metric" in home and "data-value" in home,
        "钩子齐全",
    )
    check(
        "④-6 UX-P01-01 首屏主标题含「一分钟」",
        "一分钟" in home,
        "已包含",
    )
    check(
        "④-7 UX-P01-02 四个事实数字取自 PRD_TARGETS",
        "PRD_TARGETS" in home and "metricDisplay(" in home,
        "目标值 + 实测值并排",
    )
    check(
        "④-8 UX-P01-03 差异对照结论列为「以 PRD 为准」",
        "以 PRD 为准" in home,
        "已标注",
    )
    check(
        "④-9 数据集字段表覆盖 6 个字段（FR-FEA-10 对接）",
        len(re.findall(r"\{ field: '", read(WEB_SRC / "generated" / "metrics.ts"))) == 6,
        "6 字段",
    )


# ------------------------------------------------------------------ ④b 全局组件
def check_globals() -> None:
    comps = {
        "ErrorBoundary": WEB_SRC / "components" / "ErrorBoundary.tsx",
        "EmptyState": WEB_SRC / "components" / "EmptyState.tsx",
        "Skeleton": WEB_SRC / "components" / "Skeleton.tsx",
        "NoticeBar": WEB_SRC / "components" / "NoticeBar.tsx",
    }
    missing = [n for n, p in comps.items() if not p.exists()]
    check(
        "④b-1 WS-3-04 全局基础组件齐全（错误边界/空态/骨架屏/提示条）",
        not missing,
        f"{len(comps)} 个组件" if not missing else f"缺失：{missing}",
    )

    app = read(WEB_SRC / "App.tsx")
    check("④b-2 错误边界已接入路由根", "<ErrorBoundary>" in app, "App.tsx 已包裹")

    sk = read(comps["Skeleton"])
    check(
        "④b-3 骨架屏含图表/表格/卡片/文本四型",
        all(k in sk for k in ("SkeletonChart", "SkeletonTable", "SkeletonCard", "SkeletonText")),
        "四型齐全",
    )

    toggle = read(WEB_SRC / "components" / "ThemeToggle.tsx")
    check(
        "④b-4 WS-3-05 主题切换含持久化与无障碍属性",
        "aria-pressed" in toggle and "aria-label" in toggle and "useThemeStore" in toggle,
        "aria + store 落盘",
    )

    ech = read(WEB_SRC / "components" / "EChart.tsx")
    check(
        "④b-5 🔒 ECharts 主题随切换重绘（registerTheme + dispose + 重新 init）",
        all(k in ech for k in ("dispose()", "ECHARTS_THEME", "registerTheme(", "buildEchartsTheme()"))
        and "renderer: 'svg'" in ech,
        "registerTheme→init→setOption→dispose，SVG 渲染器",
    )

    # 依赖方向守卫：echarts 只能被图表组件引入。
    # 若被 store / 主题模块引入，echarts 会被静态打进主包、无法懒加载，
    # 且会重新引入「store 初始化早于 CSS 注入 → 色板取空」的时序坑。
    heavy_importers = []
    for p in iter_src_files():
        if p.resolve() == (WEB_SRC / "components" / "EChart.tsx").resolve():
            continue
        if re.search(r"^\s*import\s+(\*\s+as\s+\w+\s+from\s+)?['\"]echarts['\"]", read_code(p), re.M):
            heavy_importers.append(p.relative_to(WEB_SRC).as_posix())
    check(
        "④b-6 🔒 echarts 仅由图表组件引入（保证可懒加载 + 色板时序正确）",
        not heavy_importers,
        "唯一引入点 components/EChart.tsx" if not heavy_importers else f"额外引入：{heavy_importers}",
    )


def main() -> int:
    check_metrics()
    check_prototype_traces()
    check_disclaimer()
    check_home_blocks()
    check_globals()

    print("=" * 72)
    print("EP-3 静态校验（DOD-EP3）")
    print("=" * 72)
    failed = 0
    for name, ok, detail in results:
        tag = "[ OK ]" if ok else "[FAIL]"
        if not ok:
            failed += 1
        print(f"{tag} {name}" + (f"  —— {detail}" if detail else ""))
    print("-" * 72)
    print(f"通过 {len(results) - failed} 项，失败 {failed} 项")
    print("结论：" + ("全部通过" if failed == 0 else "存在失败项，请修复后重跑"))
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
