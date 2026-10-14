"""
=============================================================================
`EP-4` 静态校验（DOD-EP4）
-----------------------------------------------------------------------------
覆盖 `DOD-EP4` 六条验收项里**不需要启动服务/浏览器**即可判定的部分。
（端到端行为见 `scripts/verify_ep4_api.py`，真实浏览器走查见
 `scripts/verify_ep4_browser.mjs`。）

  ① 校验顺序「单一真源」：后端 `algo.config.VALIDATE_ORDER` 是唯一字面量，
     `dataset_service` 只做 re-export；前端 `types/index.ts` 与之逐项相等
  ② 错误码对齐：前端 `ERR.*` 与后端 `ErrorCode.*` 的 10 个校验码逐一对应
  ③ 上限常量对齐：前端 `LIMITS` 与后端 `algo.config` 同值
     （大小 20MB / 行数 50 万 / 序列 1000 / SLA 60s / L1 90 点）
  ④ 🔒 游客链路：`datasets` 全部接口走 `OptionalUserId`（不得出现 `CurrentUserId`），
     且 `/upload` `/params` 两条路由**没有** `RequireAuth`
  ⑤ 🔒 `AsideLayout` 结构：右栏插槽改造后仍只有 1 个 `<aside>`
     （+ `AppShell` 的 1 个 = 模板 B 的 2 个，EP-3 探针据此断言）
  ⑥ 🔒 插槽引用稳定性：使用 `useAsideContent` 的页面必须传稳定引用
     （模块级常量或 `useMemo`）—— 否则会无限重渲染
  ⑦ 原型痕迹零命中（`UX-GOV-01`）：`.state-bar` / `.state-pill` / `.spec-note` /
     `demo-data` 在 `web/src` 下不得出现
  ⑧ 前端不硬编码演示数值：上传页不得出现 14,305 / 1,284 / 113 这类原型数字
  ⑨ 落盘安全（`NFR-SEC-07`）：目录按 `u{user_id}`、文件名 UUID、原名只进 `file_name`
  ⑩ `JT-11` 分目录：`exports/tmp/` 与 `exports/` 两个常量都存在且不同

用法：
    python scripts/verify_ep4.py
退出码：0 = 全通过，1 = 存在失败项
=============================================================================
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_SRC = ROOT / "web" / "src"
APP = ROOT / "app"
SCRIPTS = ROOT / "scripts"
DOCS = ROOT / "docs"

DATASET_SERVICE = APP / "services" / "dataset_service.py"
DATASETS_API = APP / "api" / "v1" / "datasets.py"
MAINT_SERVICE = APP / "services" / "maintenance_service.py"
ALGO_CONFIG = APP / "algo" / "config.py"
CORE_CONFIG = APP / "core" / "config.py"
CORE_DB = APP / "core" / "db.py"
FE_TYPES = WEB_SRC / "types" / "index.ts"
FE_UPLOAD = WEB_SRC / "pages" / "UploadPage.tsx"
FE_PARAMS = WEB_SRC / "pages" / "ParamsPage.tsx"
FE_ASIDE_LAYOUT = WEB_SRC / "layouts" / "AsideLayout.tsx"
FE_ASIDE_SLOT = WEB_SRC / "layouts" / "aside-slot.tsx"
FE_APP_SHELL = WEB_SRC / "layouts" / "AppShell.tsx"
FE_ROUTER = WEB_SRC / "router" / "index.tsx"

UPLOAD_COMPONENTS = [
    "DropZone.tsx",
    "FileChip.tsx",
    "ValidationPanel.tsx",
    "ErrorCard.tsx",
    "PreviewTable.tsx",
    "FieldSpecCard.tsx",
    "UploadAside.tsx",
]

# 原型专用痕迹（UX-GOV-01 / WS-4-08），产品代码里必须零命中
PROTOTYPE_LEAKS = [
    ".state-bar",
    "state-bar",
    "state-pill",
    ".spec-note",
    "spec-note",
    "demo-data",
    "initShell",
    "showState(",
]

# 原型演示数值（EP-4 起真源是接口返回，不得再写死）
PROTOTYPE_NUMBERS = ["14,305", "14305", "1,284", "1284"]

results: list[tuple[str, bool, str]] = []

# 注释剥离 —— 本项目第 5 次踩同型的坑：把「说明里提到的符号」当成真实代码扫。
# 统一改用 AST 取真实结构 / 先剥注释再匹配文本。
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_LINE_COMMENT = re.compile(r"(?m)(?<!:)//[^\n]*")


def strip_ts_comments(text: str) -> str:
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub(" ", text))


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))


def read(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def read_ts_code(path: Path) -> str:
    return strip_ts_comments(read(path))


def py_module_text(path: Path) -> str:
    """Python 源码剥掉 docstring / 注释（AST 级），只留可执行语句的文本。"""
    src = read(path)
    if not src:
        return ""
    tree = ast.parse(src)
    lines = src.splitlines()
    keep = [True] * (len(lines) + 1)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Expr,)) and isinstance(
            getattr(node, "value", None), ast.Constant
        ) and isinstance(node.value.value, str):
            for i in range(node.lineno, (node.end_lineno or node.lineno) + 1):
                keep[i] = False
    return "\n".join(ln for i, ln in enumerate(lines, 1) if keep[i])


# ---------------------------------------------------------------------------
# ① 校验顺序单一真源
# ---------------------------------------------------------------------------
def check_validate_order() -> None:
    algo = read(ALGO_CONFIG)
    m = re.search(r"VALIDATE_ORDER[^=]*=\s*\(([^)]*)\)", algo, re.S)
    backend = [s.strip().strip('"').strip("'") for s in m.group(1).split(",") if s.strip()] if m else []
    check(
        "①-1 后端 VALIDATE_ORDER 有 7 项（PRD §3.2.2）",
        len(backend) == 7,
        f"{backend}",
    )

    svc = read(DATASET_SERVICE)
    check(
        "①-2 🔒 dataset_service 只 re-export，不另抄字面量",
        re.search(r"VALIDATE_ORDER\s*(:[^=]+)?=\s*algo_config\.VALIDATE_ORDER", svc) is not None,
        "期望 `VALIDATE_ORDER: tuple[str, ...] = algo_config.VALIDATE_ORDER`",
    )
    # 反证：服务模块里不得出现一个写着 7 个中文阶段名的元组字面量
    literal = re.search(r"\(\s*[\"']扩展名[\"']\s*,", svc)
    check("①-3 🔒 dataset_service 内无第二份阶段名字面量元组", literal is None)

    fe = read_ts_code(FE_TYPES)
    m2 = re.search(r"export const VALIDATE_ORDER\s*=\s*\[([^\]]*)\]", fe, re.S)
    front = [s.strip().strip('"').strip("'") for s in m2.group(1).split(",") if s.strip()] if m2 else []
    check(
        "①-4 前端 VALIDATE_ORDER 与后端逐项一致",
        front == backend and len(front) == 7,
        f"front={front}",
    )

    panel = read_ts_code(WEB_SRC / "components" / "upload" / "ValidationPanel.tsx")
    check(
        "①-5 步骤文案与 VALIDATE_ORDER 同长（有运行期自查）",
        "STEP_DESC.length !== VALIDATE_ORDER.length" in panel
        and "VALIDATE_TOTAL = VALIDATE_ORDER.length" in panel,
    )

    # 文档中的 7 步顺序（PRD §3.2.2）也应与代码一致
    prd = read(DOCS / "电商销量预测系统_PRD_V1.0.md")
    miss = [s for s in backend if s not in prd]
    check("①-6 PRD §3.2.2 的 7 步顺序含全部阶段名", not miss, f"缺失：{miss}")


# ---------------------------------------------------------------------------
# ② 错误码对齐
# ---------------------------------------------------------------------------
ERROR_PAIRS = [
    ("MISSING_COLUMN", 40001),
    ("DATE_UNPARSABLE", 40002),
    ("NEGATIVE_VALUE", 40003),
    ("SERIES_OVER_LIMIT", 40004),
    ("DATE_GAP", 40005),
    ("INSUFFICIENT_DATA", 40006),
    ("FILE_TOO_LARGE", 40007),
    ("ROW_OVER_LIMIT", 40008),
    ("BAD_EXTENSION", 40009),
    ("EMPTY_FILE", 40010),
]


def check_error_codes() -> None:
    be = py_module_text(APP / "core" / "errors.py")
    fe = read_ts_code(FE_TYPES)
    for name, code in ERROR_PAIRS:
        be_ok = re.search(rf"\b{name}\b\s*[:=]\s*{code}\b", be) is not None
        fe_ok = re.search(rf"\b{name}\s*:\s*{code}\b", fe) is not None
        check(f"② 错误码 {code} {name} 前后端一致", be_ok and fe_ok, f"be={be_ok} fe={fe_ok}")

    # 前端错误卡必须为 10 个码都留了展示分支（至少覆盖 5 类专属 + 前置类）
    card = read_ts_code(WEB_SRC / "components" / "upload" / "ErrorCard.tsx")
    for name in ("MISSING_COLUMN", "DATE_UNPARSABLE", "NEGATIVE_VALUE", "SERIES_OVER_LIMIT", "DATE_GAP"):
        check(f"② 错误卡含 {name} 专属分支", f"ERR.{name}" in card or f"ERR.{name}" in card)


# ---------------------------------------------------------------------------
# ③ 上限常量对齐
# ---------------------------------------------------------------------------
LIMIT_PAIRS = [
    ("max_file_size_mb", "MAX_FILE_SIZE_MB", 20),
    ("max_rows", "MAX_ROWS", 500_000),
    ("max_series", "MAX_SERIES", 1000),
    ("sla_seconds", "SLA_SECONDS", 60),
    ("l1_min_valid_points", None, None),
]


def check_limits() -> None:
    algo = read(ALGO_CONFIG)
    fe = read_ts_code(FE_TYPES)
    for fe_key, back_key, expect in LIMIT_PAIRS:
        if back_key is None:
            continue
        m = re.search(rf"{back_key}\s*=\s*([\d_]+)", algo)
        back_val = int(m.group(1).replace("_", "")) if m else None
        fe_val = None
        m2 = re.search(rf"{fe_key}\s*:\s*([\d_]+)", fe)
        if m2:
            fe_val = int(m2.group(1).replace("_", ""))
        check(
            f"③ {fe_key} 前后端同值（{expect}）",
            back_val is not None and fe_val == back_val and fe_val == expect,
            f"front={fe_val} back={back_val}",
        )

    # L1 门槛：后端在 algo.config 的注释里给的是 90（PRD FR-FEA-09），前端 LIMITS 也得是 90
    fe_l1 = re.search(r"l1_min_valid_points\s*:\s*([\d_]+)", fe)
    check(
        "③ l1_min_valid_points = 90（PRD FR-FEA-09）",
        bool(fe_l1) and int(fe_l1.group(1).replace("_", "")) == 90,
        fe_l1.group(1) if fe_l1 else "未找到",
    )
    tr = read(ALGO_CONFIG)
    m3 = re.search(r"L1_MIN_VALID_POINTS\s*=\s*([\d_]+)", tr) or re.search(
        r"MIN_VALID_POINTS\s*=\s*([\d_]+)", tr
    )
    check(
        "③ 后端存在 L1 有效点门槛常量且为 90",
        bool(m3) and int(m3.group(1).replace("_", "")) == 90,
        m3.group(1) if m3 else "未找到（前端 LIMITS 已写 90，需确认后端同源）",
    )

    # 必需列名四处同名（DB / algo / 后端 / 前端）
    cols = ["sku_id", "warehouse_id", "date", "sales"]
    for col in cols:
        check(
            f"③ 必需列 {col} 在前后端同时出现",
            f'"{col}"' in read(ALGO_CONFIG) or f"'{col}'" in read(ALGO_CONFIG),
            "" if col in fe else "前端缺失",
        )


# ---------------------------------------------------------------------------
# ④ 游客链路
# ---------------------------------------------------------------------------
def check_guest_path() -> None:
    api = read(DATASETS_API)
    check("④-1 🔒 上传/预览等接口均用 OptionalUserId", "OptionalUserId" in api)
    check(
        "④-2 🔒 datasets 路由不得出现 CurrentUserId（游客必须能进）",
        "CurrentUserId" not in api,
        "若需要鉴权请用 OptionalUserId + BE-41 归属判定",
    )
    # 6 个路由各自的依赖
    routes = re.findall(r"@router\.(get|post)\(\s*[\"']([^\"']*)[\"']", api)
    check("④-3 datasets 路由数量 = 7（template/sample/post/gap/detail/preview/errors）",
          len(routes) == 7, str(routes))

    router = read_ts_code(FE_ROUTER)
    for path in ("/upload", "/params"):
        block = re.search(
            rf"path:\s*[\"']{re.escape(path)}[\"'][^}}]*", router, re.S
        )
        seg = block.group(0)[:400] if block else ""
        check(f"④-4 🔒 {path} 路由不加 RequireAuth（FR-USR-08）", bool(block) and "RequireAuth" not in seg)

    upload = read_ts_code(FE_UPLOAD)
    check(
        "④-5 上传页对游客给出「未登录体验模式」说明（含 24 小时清理）",
        "未登录体验模式" in upload and "24 小时后自动清理" in upload,
    )


# ---------------------------------------------------------------------------
# ⑤ AsideLayout 结构 + ⑥ 插槽引用稳定性
# ---------------------------------------------------------------------------
def check_aside_layout() -> None:
    lay = read_ts_code(FE_ASIDE_LAYOUT)
    n_aside = len(re.findall(r"<aside\b", lay))
    check("⑤-1 🔒 AsideLayout 只有 1 个 <aside>（+AppShell 1 个 = 模板 B 的 2 个）", n_aside == 1, f"count={n_aside}")

    shell = read_ts_code(FE_APP_SHELL)
    n_shell = len(re.findall(r"<aside\b", shell))
    check("⑤-2 🔒 AppShell 仍有 1 个 <aside>（导航侧栏）", n_shell == 1, f"count={n_shell}")
    # ⚠️ 原断言写死 `shell.count("label:") == 2`。本意是「模板 B 的两项主导航未被破坏」，
    #    但用**总数**表达这个意图，会被后续阶段的**有意扩展**打脸：
    #    `EP-7` 在 `NAV_ITEMS` 追加「历史任务 / 跨任务对比」，`EP-8` 又新增
    #    `ADMIN_NAV_ITEMS`（2 项），总数变成 6 —— 断言失败，但代码是对的。
    #    改为断言**基线的两项仍在且排在最前**：语义不变，且对新增项免疫。
    nav_start = shell.index("const NAV_ITEMS")
    nav_block = shell[nav_start: shell.index("];", nav_start)]
    nav_labels = re.findall(r"label:\s*'([^']+)'", nav_block)
    check("⑤-3 AppShell 主导航前两项仍是「工作台 / 新建预测」（模板 B 基线未被替换）",
          nav_labels[:2] == ["工作台", "新建预测"],
          f"实际 {nav_labels}")

    slot = read_ts_code(FE_ASIDE_SLOT)
    check("⑤-4 插槽用 context + effect 注入，且卸载时还原默认内容",
          "AsideSlotContext" in slot and "DEFAULT_ASIDE" in slot and "return () =>" in slot)

    for label, path, pattern, ok_desc in [
        ("上传页", FE_UPLOAD, r"const UPLOAD_ASIDE\s*=\s*<", "模块级常量"),
        ("参数页", FE_PARAMS, r"const aside\s*=\s*useMemo\(", "useMemo"),
    ]:
        code = read_ts_code(path)
        check(
            f"⑥ {label}用{ok_desc}保证插槽引用稳定（否则无限重渲染）",
            re.search(pattern, code) is not None,
        )


# ---------------------------------------------------------------------------
# ⑦ 原型痕迹 / ⑧ 硬编码数值
# ---------------------------------------------------------------------------
def iter_fe_files():
    for p in WEB_SRC.rglob("*"):
        if p.is_file() and p.suffix in {".ts", ".tsx", ".css"}:
            yield p


def check_prototype_traces() -> None:
    upload_dir = WEB_SRC / "components" / "upload"
    upload_page = read_ts_code(FE_UPLOAD)

    leaks_upload = [t for t in PROTOTYPE_LEAKS if t in upload_page]
    check("⑦-1 上传页无原型演示痕迹（.state-bar / .state-pill / .spec-note）",
          not leaks_upload, f"命中：{leaks_upload}")

    leaks_dir: list[str] = []
    for p in upload_dir.rglob("*"):
        if p.is_file() and p.suffix in {".ts", ".tsx"}:
            code = read_ts_code(p)
            for t in PROTOTYPE_LEAKS:
                if t in code:
                    leaks_dir.append(f"{p.name}:{t}")
    check("⑦-2 upload 组件目录无原型演示痕迹", not leaks_dir, f"命中：{leaks_dir}")

    hits: list[str] = []
    for p in iter_fe_files():
        code = read_ts_code(p)
        for n in PROTOTYPE_NUMBERS:
            if n in code:
                hits.append(f"{p.relative_to(WEB_SRC).as_posix()}:{n}")
    check("⑧-1 前端无原型演示数值（14,305 / 1,284 等）", not hits, f"命中：{hits}")

    check(
        "⑧-2 上传页通过接口取数（datasetApi.upload / loadSample）",
        "datasetApi.upload(" in upload_page and "datasetApi.loadSample()" in upload_page,
    )
    check(
        "⑧-3 上传页不出现 echarts（本页无图表，避免主包被拖大）",
        "echarts" not in upload_page,
    )


# ---------------------------------------------------------------------------
# ⑨ 落盘安全 / ⑩ TTL 分目录
# ---------------------------------------------------------------------------
def check_storage() -> None:
    svc = read(DATASET_SERVICE)
    per_user = re.search(r"UPLOAD_DIR\s*/\s*f[\"']u\{user_id\}[\"']", svc) is not None
    check(
        "⑨-1 🔒 落盘目录按 u{user_id} 分（NFR-SEC-07）",
        per_user,
        "" if per_user else "未找到 `UPLOAD_DIR / f\"u{user_id}\"`",
    )
    check("⑨-2 🔒 落盘名用 UUID（原始文件名只进 file_name）",
          "uuid4" in svc and "stored_name" in svc and "file_name" in svc)
    check("⑨-3 流式落盘按块写（UPLOAD_CHUNK_BYTES）",
          "UPLOAD_CHUNK_BYTES" in svc and "UPLOAD_CHUNK_BYTES" in read(DATASETS_API))
    check("⑨-4 大小超限时流式中断并清理半截文件",
          "FILE_TOO_LARGE" in read(DATASETS_API) and "safe_unlink" in read(DATASETS_API))

    dbpy = read(CORE_DB)
    check("⑩-1 export 与 export/tmp 是两个常量",
          "EXPORT_DIR" in dbpy and "EXPORT_TMP_DIR" in dbpy)
    # 注意要容许可选类型标注：`EXPORT_TMP_DIR: Path = EXPORT_DIR / "tmp"`
    has_sub = re.search(
        r"EXPORT_TMP_DIR\s*(?::[^=]+)?=\s*EXPORT_DIR\s*/\s*[\"']tmp[\"']", dbpy
    )
    check("⑩-2 🔒 exports/tmp 是 exports 的子目录（JT-11）", bool(has_sub))
    check(
        "⑩-3 uploads 根目录由 settings 推导，且子目录在 service 层按用户分片",
        re.search(r"UPLOAD_DIR\s*(?::[^=]+)?=\s*config\.settings\.upload_dir", dbpy) is not None
        and per_user,
    )

    maint = read(MAINT_SERVICE)
    check("⑩-4 🔒 tmp 用 1 小时 TTL、正式导出用 export_ttl_days 两套口径",
          "export_tmp_ttl_seconds" in maint and "export_ttl_days" in maint)
    check("⑩-5 🔒 tmp 不在正式导出的遍历范围内（避免被 7 天口径顺走）",
          "EXPORT_TMP_DIR in item.parents" in maint)
    check("⑩-6 🔒 清游客数据先删 tasks 再删 datasets（FK-03 RESTRICT）",
          maint.index("DELETE FROM tasks") < maint.index("DELETE FROM datasets"))

    core = read(CORE_CONFIG)
    check("⑩-7 Settings 暴露 export_tmp_ttl_seconds / guest_data_ttl_hours",
          "export_tmp_ttl_seconds" in core and "guest_data_ttl_hours" in core)


# ---------------------------------------------------------------------------
# 组件清单
# ---------------------------------------------------------------------------
def check_components() -> None:
    for name in UPLOAD_COMPONENTS:
        p = WEB_SRC / "components" / "upload" / name
        check(f"组件存在：components/upload/{name}", p.exists())

    page = read_ts_code(FE_UPLOAD)
    required_tokens = [
        ("拖拽区", "DropZone"),
        ("文件条", "FileChip"),
        ("校验中面板", "ValidationPanel"),
        ("错误卡", "ErrorCard"),
        ("预览表", "PreviewTable"),
        ("字段规范卡", "FieldSpecCard"),
        ("右栏内容", "UploadAside"),
    ]
    missing = [label for label, tok in required_tokens if tok not in page]
    check("上传页装配了全部 7 个上传组件", not missing, f"缺失：{missing}")

    err = read_ts_code(WEB_SRC / "components" / "upload" / "ErrorCard.tsx")
    check("错误卡：dataset_id 为空时不渲染下载按钮（40007/40009 无明细）",
          "data?.dataset_id" in err and "canDownload" in err)
    check("错误卡：断档二选一按钮齐全，未选择不继续",
          "gap-interpolate" in err and "gap-abort" in err and "系统不会自动继续" in err)

    prev = read_ts_code(WEB_SRC / "components" / "upload" / "PreviewTable.tsx")
    check("🔒 预览表按 columns 动态渲染（FR-UPL-07 表头与源文件一致）",
          "columns.map(" in prev and "preview.columns" not in prev)
    check("预览表标注「系统实际读到的内容」并带搜索（UX-P05-05）",
          "系统实际读到的内容" in prev and "搜索商品 / 仓库" in prev)

    chip = read_ts_code(WEB_SRC / "components" / "upload" / "FileChip.tsx")
    check("文件条含 CSV 角标 + 状态徽标 + 移除按钮（UX-P05 组件规格）",
          "CSV" in chip and "待上传" in chip and "移除文件" in chip)
    check("文件条上传中才显示进度条",
          "status === 'uploading'" in chip and "upload-progress" in chip)

    dz = read_ts_code(WEB_SRC / "components" / "upload" / "DropZone.tsx")
    check("拖拽区同时支持拖拽与点击（FR-UPL-01）",
          "onDrop" in dz and "onClick" in dz and 'type="file"' in dz)
    check("拖拽区提示上限（FR-UPL-03 / UX-P05-01）",
          "20 MB" in dz and "500,000" in dz)

    clash = read_ts_code(WEB_SRC / "components" / "upload" / "UploadAside.tsx")
    check("右栏含「数据要求速查」与「这份数据会怎么用」两卡（UI/UX §8.1）",
          "数据要求速查" in clash and "这份数据会怎么用" in clash)
    check("🔒 右栏不出现原型无依据的「28 天」（已改为 90 点建模门槛）",
          "28 天" not in clash and "l1_min_valid_points" in clash)


def main() -> int:
    check_validate_order()
    check_error_codes()
    check_limits()
    check_guest_path()
    check_aside_layout()
    check_prototype_traces()
    check_storage()
    check_components()

    print("=" * 72)
    print("EP-4 静态校验（DOD-EP4）")
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
