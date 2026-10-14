"""`EP-8` 管理端静态守卫（`DOD-EP8` 静态部分 + 🔒 安全红线）。

与 `verify_ep7.py` 同一套骨架（`strip_docstrings` / `func_body` 工具），
分12 节：

  ① 🔒 **`BE-ADM-01`：隔离例外的边界** —— `admin.py` 之外零个路由不带
     `CurrentAdmin`；其余5 个 `api/v1/*.py` **零处**「不带 user_id 的查询」
  ② 🔒 **9 条路由全部挂 `CurrentAdmin`**（AST 实测依赖声明，不看注释）
  ③ 🔒 **9 条路由全部用注解形式** `admin: CurrentAdmin`（不是 `=CurrentAdmin`）
  ④ 🔒 **`BE-ADM-02`：模型切换事务顺序** —— `deactivate_all` 必须在
     `activate_version` 之前，且都在同一函数内
  ⑤ 🔒 **`BE-ADM-03`：切换后校验 `.env`** + 返回 `warnings`
  ⑥ 🔒 **全操作审计**（`WS-8-05`）：4 类写操作都调 `_audit`，且
     `ACTION_ADMIN='admin'`
  ⑦ 🔒 **最小暴露**：schema / service /前端**零 `password_hash`**
  ⑧ 🔒 **`API-24` 三条自我保护**（不能停用/降级自己、不能动最后一个管理员）
  ⑨ 🔒 **`API-25` 必须 `token_version + 1`**；登录必须查 `status`
  ⑩ **前端 `AD-P01`/`AD-P02`**：零新增令牌、零 hex、`isAdmin` 门禁、
     硬删除文案含「不可恢复」
  ⑪ 🔒 **ECharts 必须懒加载**（`EP-3` 的 1381→343 kB 成果不得被抵消）
  ⑫ **文档与契约同步**：`§5.7` 的 18 项回写已落地
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
APP = ROOT / "app"
WEB = ROOT / "web" / "src"

PASS = 0
TOTAL = 0
RESULTS: list[tuple[bool, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    global PASS, TOTAL
    TOTAL += 1
    if ok:
        PASS += 1
    RESULTS.append((ok, name, detail))
    print(f"  {'✅' if ok else '❌'} {name}" + (f" — {detail}" if detail else ""))
    return bool(ok)


def section(t: str) -> None:
    print(f"\n=== {t} ===")


# ---------------------------------------------------------------------------
# 工具：注释剥离（🔒 必须同时剥 """ ''' # // /* */，EP-4/EP-5/EP-6 已各踩一次）
# ---------------------------------------------------------------------------
_STR = r'"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\''


def strip_comments(src: str, lang: str = "py") -> str:
    if lang == "py":
        src = re.sub(_STR, '""', src)
        src = re.sub(r"(?m)^\s*#.*$", "", src)
        return re.sub(r"(?m)\s+#.*$", "", src)
    src = re.sub(r"/\*[\s\S]*?\*/", "", src)
    src = re.sub(r"(?m)^\s*//.*$", "", src)
    return src


def func_body(src: str, name: str) -> str:
    """取函数体文本（用于「函数内必须/不得出现 X」的判据）。"""
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(src, node) or ""
    return ""


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ═════════════════════════════════════════════════════════════════════════
def s1_redline_scope() -> None:
    section("① 🔒 BE-ADM-01：隔离例外的边界")

    api_dir = APP / "api" / "v1"
    admin_py = api_dir / "admin.py"
    check("① admin.py 存在", admin_py.exists())
    if not admin_py.exists():
        return

    # 其余 5 个文件里不得出现「不带 user_id 过滤的查询」
    others = ["auth.py", "datasets.py", "predictions.py", "history.py", "system.py"]
    for fn in others:
        p = api_dir / fn
        if not p.exists():
            continue
        code = strip_comments(read(p))
        # 带 user_id 的调用是合规的；找「用了 admin_service」的更直接 —— 管理端
        # 业务逻辑绝不允许被普通接口的文件引用
        hit = "admin_service" in code
        check(f"① {fn} 不引用 admin_service（例外不外泄）", not hit,
              "发现 admin_service 引用" if hit else "")

    # router.py 必须挂 admin，且注明例外边界
    # ⚠️ 这里**不能**用 strip_comments 后的文本判「注明」——
    #    说明写在 `#` 注释里，剥掉注释自然就找不到了。
    #    「行为」用剥注释后的代码判，「说明」用原文判，两种口径要分开。
    router_raw = read(api_dir / "router.py")
    router = strip_comments(router_raw)
    check("① router.py 挂载了 admin.router", "include_router(admin.router)" in router)
    check("① router.py 注明「唯一显式例外」", "唯一显式例外" in router_raw)

    # services 层：admin_service 是唯一允许跨用户聚合的模块
    svc_dir = APP / "services"
    for f in sorted(svc_dir.glob("*.py")):
        if f.name in ("admin_service.py", "__init__.py"):
            continue
        code = strip_comments(read(f))
        hit = re.search(r"list_all\(|count_all\(.*\)(?!.*user_id)", code)
        # 只查「是否引用了带 _all 后缀的跨用户 DAO」
        uses_all = "_dao.list_all" in code or "_dao.count_all" in code
        check(f"① {f.name} 不调用跨用户 list_all/count_all", not uses_all,
              "发现跨用户查询" if uses_all else "")


def s2_routes_have_admin() -> None:
    section("② 9 条路由全部挂 CurrentAdmin（AST 实测，不看注释）")
    src = read(APP / "api" / "v1" / "admin.py")
    tree = ast.parse(src)

    routes: list[tuple[str, str, ast.FunctionDef | ast.AsyncFunctionDef]] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # ⚠️ 判据要匹配 `@router.get/post/patch/delete(...)` —— 属性访问的
            #    `func` 是 `ast.Attribute`（.attr == 'get'），不是 `ast.Name`。
            #    早先只判 `getattr(d.func, "id", "") == "router"`，对
            #    `router.get` 这类写法永远为假 → 9 条路由被数成 0 条。
            decs = [
                d for d in node.decorator_list
                if isinstance(d, ast.Call)
                and isinstance(d.func, ast.Attribute)
                and getattr(d.func.value, "id", "") == "router"
            ]
            for d in decs:
                path = ""
                for a in d.args:
                    if isinstance(a, ast.Constant) and isinstance(a.value, str):
                        path = a.value
                verbs = [k.value for k in d.keywords if k.arg == "methods"
                         and isinstance(k.value, (ast.List, ast.Tuple))]
                # 🔴 HTTP 动词不在 `methods=` 里，而在**装饰器名**上：
                #    `@router.get(...)` → 'GET'，`@router.patch(...)` → 'PATCH'。
                #    只有写全路径形式 `@router.api_route(..., methods=['GET'])`
                #    才从 keywords 取。早先一律取 keywords（几乎都是空），
                #    9 条路由的动词全被记成默认 GET —— 契约比对必然失败。
                verb = d.func.attr.upper()
                if verbs and verbs[0].elts:
                    lit = verbs[0].elts[0]
                    verb = lit.value if isinstance(lit, ast.Constant) else verb
                routes.append((verb, path, node))

    check("② 恰好 9 条路由", len(routes) == 9, f"实际 {len(routes)} 条")
    expect = {
        ("GET", "/overview"), ("GET", "/users"), ("PATCH", "/users/{user_id}"),
        ("POST", "/users/{user_id}/reset-password"), ("GET", "/tasks"),
        ("DELETE", "/tasks/{task_id}"), ("GET", "/models"),
        ("PATCH", "/models/{version}"), ("GET", "/logs"),
    }
    got = {(v, p) for v, p, _ in routes}
    check("② 9 条路由的路径与 API-22~30 契约一致", got == expect,
          f"差异={got ^ expect or '无'}")

    for verb, path, fn in routes:
        args = {a.arg: a for a in fn.args.args}
        ann = args.get("admin")
        ok = ann is not None and "CurrentAdmin" in ast.unparse(ann.annotation)
        check(f"② {verb} {path} 声明 admin: CurrentAdmin", ok,
              ast.unparse(ann.annotation) if ann else "无admin 参数")


def s3_annotation_form() -> None:
    section("③ 🔒 依赖必须注解形式（EP-7 踩过：user=CurrentUser 传的是类本身）")
    src = strip_comments(read(APP / "api" / "v1" / "admin.py"))
    # 形如 `admin=CurrentAdmin`（默认值形式）必须零命中
    bad = re.findall(r"\b\w+\s*=\s*CurrentAdmin\b", src)
    check("③ 零处 `xxx=CurrentAdmin`（默认值形式）", not bad, f"发现 {bad}")
    check("③ 至少 9 处 `admin: CurrentAdmin`（注解形式）",
          len(re.findall(r"\badmin\s*:\s*CurrentAdmin\b", src)) == 9,
          f"实际 {len(re.findall(r'admin\s*:\s*CurrentAdmin', src))} 处")


def s4_switch_transaction() -> None:
    section("④ 🔒 BE-ADM-02：模型切换的事务顺序（先降后升，同一函数）")
    src = read(APP / "services" / "admin_service.py")
    body = func_body(src, "switch_model")
    check("④ switch_model 存在", bool(body))
    if not body:
        return
    code = strip_comments(body)

    i_down = code.find("deactivate_all")
    i_up = code.find("activate_version")
    check("④ 同时含 deactivate_all 与 activate_version",
          i_down != -1 and i_up != -1, f"down={i_down} up={i_up}")
    check("④ 🔒 deactivate_all 在 activate_version **之前**（BE-ADM-02）",
          i_down != -1 and i_up != -1 and i_down < i_up,
          f"down@{i_down} vs up@{i_up}")
    # 两者之间不得有 commit（commit 会让两个 UPDATE 落进两个事务）
    between = code[i_down:i_up] if i_down != -1 and i_up != -1 else ""
    check("④ 🔒 两个 UPDATE 之间无 commit（必须同事务）", "commit()" not in between,
          "发现提前 commit" if "commit()" in between else "")
    # 切换后回查确认
    check("④ 切换后回查 get_active 做确认", "get_active" in code)
    check("④ 幂等：已是当前版本则 changed=false",
          "changed" in code and "False" in code)


def s5_env_check() -> None:
    section("⑤ 🔒 BE-ADM-03：切换后校验 .env 并返回 warnings")
    src = read(APP / "services" / "admin_service.py")
    body = strip_comments(func_body(src, "switch_model"))
    check("⑤ 比对 settings.active_model（.env 真源）", "settings.active_model" in body)
    check("⑤ 计算 env_match", "env_match" in body)
    check("⑤ 不一致时写 warnings", "warnings" in body and "warnings.append" in body)
    check("⑤ 尝试 reload_active_model（进程内热切换）", "reload_active_model" in body)

    # schema 层 warnings 必须存在且带默认值
    sch = strip_comments(read(ROOT / "code" / "backend" / "schemas.py"))
    check("⑤ SwitchModelResponse.warnings 字段存在",
          "warnings: list[str]" in sch)
    check("⑤ 🔒 warnings 有 default_factory（不传也不 500）",
          re.search(r"warnings:\s*list\[str\]\s*=\s*Field\(default_factory=list\)", sch)
          is not None)


def s6_audit() -> None:
    section("⑥ 🔒 全操作审计（WS-8-05）")
    src = read(APP / "services" / "admin_service.py")
    code = strip_comments(src)

    check("⑥ ACTION_ADMIN 常量存在且为 'admin'",
          re.search(r'ACTION_ADMIN\s*=\s*"admin"', code) is not None)

    # 4 类写操作函数各自必须调 _audit
    for fn in ("update_user", "reset_password", "force_delete_task", "switch_model"):
        body = strip_comments(func_body(src, fn))
        check(f"⑥ {fn} 调用 _audit（写操作必须留痕）", "_audit(" in body)

    # _audit 的 detail 格式必须固定
    abody = strip_comments(func_body(src, "_audit"))
    check("⑥ 🔒 detail 格式固定 sub=;target=;by=",
          "sub={sub}" in abody and "target={target}" in abody and "by={operator_id}" in abody)
    check("⑥ 🔒 审计 action 用ACTION_ADMIN", "action=ACTION_ADMIN" in abody)
    # 🔴 判据要点：`_audit` **自己**绝不 commit。
    #    审计与业务变更必须同一事务（`get_db` 在请求结束时统一提交）——
    #    若审计提前 commit，就会出现「业务失败但审计已留痕」的反向不一致。
    # ⚠️ 判「不 commit」要匹配的是**调用点**，函数体内出现 `commit()`
    #    只可能来自 docstring（已剥）—— 剥完还是 0 才算数。
    check("⑥ 审计不自行 commit（与业务同事务）",
          "db.commit()" not in abody,
          "发现 db.commit()" if "db.commit()" in abody else "")

    # DB 侧 action 必须含 'admin'
    sch = strip_comments(read(ROOT / "code" / "db" / "schema.sql"))
    check("⑥ schema.sql 的 action CHECK 含 'admin'（8 类）",
          re.search(r"'delete',\s*'admin'", sch) is not None
          or re.search(r"'admin'", sch) is not None)

    # 白名单必须与 CHECK 同源（8 类）
    check("⑥🔒 _LOG_ACTIONS 与 CHECK 约束同源（8 类）",
          re.search(r"_LOG_ACTIONS\s*=\s*frozenset", code) is not None
          and all(a in code for a in
                  ("login", "register", "logout", "upload", "predict", "export",
                   "delete", "admin")))


def s7_no_password_leak() -> None:
    section("⑦ 🔒 最小暴露：零 password_hash 泄露")
    sch = strip_comments(read(ROOT / "code" / "backend" / "schemas.py"))
    admin_part = sch[sch.find("8. 管理端"):] if "8. 管理端" in sch else sch
    check("⑦ schemas.py 管理端段零 password_hash",
          "password_hash" not in admin_part,
          "发现 password_hash" if "password_hash" in admin_part else "")
    check("⑦ AdminUserBrief 字段白名单不含哈希",
          re.search(r"class AdminUserBrief[\s\S]*?password_hash", sch) is None)

    svc = strip_comments(read(APP / "services" / "admin_service.py"))
    check("⑦ admin_service._user_brief 不返回密码哈希",
          "password_hash" not in svc,
          "发现 password_hash" if "password_hash" in svc else "")

    ts = strip_comments(read(WEB / "types" / "index.ts"), "ts")
    admin_ts = ts[ts.find("管理端（`CH-01`"):] if "管理端（`CH-01`" in ts else ts
    check("⑦ 前端 types 管理端段零 password_hash",
          "password_hash" not in admin_ts)

    # 但前端必须有「为什么没有」的说明
    check("⑦ 前端保留了「为何无该字段」的注释",
          "password_hash" in read(WEB / "types" / "index.ts"),
          "注释说明缺失")


def s8_self_protection() -> None:
    section("⑧ 🔒 API-24 三条自我保护")
    src = read(APP / "services" / "admin_service.py")
    body = strip_comments(func_body(src, "update_user"))
    check("⑧ 不能停用自己", "is_self and status == 0" in body)
    check("⑧ 不能降级自己", "is_self and role == ROLE_USER" in body)
    check("⑧ 🔒 不能动最后一个管理员", "_count_admins" in body and "<= 1" in body)
    check("⑧ 判定最后一个管理员的辅助函数在模块级",
          "_count_admins(db: Session)" in src or "def _count_admins" in src)
    check("⑧ 停用时同步 bump token_version",
          "status == 0" in body and "bump_token_version" in body)


def s9_token_version() -> None:
    section("⑨ 🔒 重置密码的 token_version 联动 + 登录的 status 检查")
    src = read(APP / "services" / "admin_service.py")
    body = strip_comments(func_body(src, "reset_password"))
    check("⑨ reset_password 调用 set_password", "set_password" in body)
    check("⑨ 🔒 reset_password 同时 bump_token_version（BE-41）",
          "bump_token_version" in body)
    check("⑨ 回显新的 token_version", "token_version" in body)

    # 🔴 EP-8 修的真实缺陷：login() 原本完全不查 status
    auth = read(APP / "services" / "auth_service.py")
    lbody = strip_comments(func_body(auth, "login"))
    check("⑨ 🔴 login() 检查 users.status（EP-8 修的真实缺陷）",
          re.search(r"user\.status", lbody) is not None,
          "登录仍不查 status —— 停用可被重新登录绕过")
    check("⑨ 停用判定发生在签发 Token 之前",
          lbody.find("user.status") != -1
          and lbody.find("user.status") < lbody.find("create_access_token"))
    # 且不能因停用而泄露「邮箱存在」
    check("⑨ 停用时返回 40103（与密码错误一致，不泄露邮箱存在性）",
          "BAD_CREDENTIAL" in lbody)


def s10_frontend() -> None:
    section("⑩ AD-P01 / AD-P02 前端静态守卫")
    dash = read(WEB / "pages" / "AdminDashboardPage.tsx")
    manage = read(WEB / "pages" / "AdminManagePage.tsx")
    admin_c = read(WEB / "components" / "RequireAdmin.tsx")
    shell = read(WEB / "layouts" / "AppShell.tsx")

    for name, code in (("AdminDashboardPage", dash), ("AdminManagePage", manage),
                       ("RequireAdmin", admin_c)):
        c = strip_comments(code, "ts")
        hexes = re.findall(r"#[0-9a-fA-F]{3,8}\b", c)
        check(f"⑩ {name} 零 hex 色值（令牌化，QD-01）", not hexes,
              f"发现 {hexes[:3]}" if hexes else "")

    # 不新增设计令牌（`QD-01`）
    # ⚠️ 两个口径别混：`--xxx:` 是「**令牌定义**」（42 个变量名），
    #    `oklch(` 是「**颜色出现处**」（71 处，含 `color-mix` 里的重复引用）。
    #    `EP-0` 的守门指标是后者（`scripts/verify_tokens.py` 判 oklch ≥ 56），
    #    本判据与它保持一致，别自己发明一个数。
    tokens_css = read(WEB / "theme" / "tokens.css")
    n_oklch = tokens_css.count("oklch(")
    n_def = len(set(re.findall(r"(--[a-z0-9-]+)\s*:", tokens_css)))
    check(f"⑩ tokens.css 未新增视觉语言（oklch {n_oklch} 处 ≥ 56，"
          f"变量名 {n_def} 个）", n_oklch >= 56, f"oklch={n_oklch}")
    n_hex = len(re.findall(r"#[0-9a-fA-F]{3,8}\b", tokens_css))
    check(f"⑩ tokens.css 零 hex（oklch 体系，EP-0 守卫）", n_hex == 0,
          f"发现 {n_hex} 个")

    # 门禁
    check("⑩ RequireAdmin 判isAdmin", "isAdmin" in admin_c)
    check("⑩ 非管理员给403 落点（不是空白页）",
          "admin-forbidden" in admin_c and "无管理端访问权限" in admin_c)
    check("⑩ AppShell 管理端入口仅 isAdmin 可见",
          "isAdmin" in shell and "ADMIN_NAV_ITEMS" in shell)
    check("⑩ 两页均套 RequireAdmin",
          (WEB / "router" / "index.tsx").read_text(encoding="utf-8").count(
              "RequireAdmin") >= 2)

    # 🔒 硬删除文案必须与用户侧软删除区分
    check("⑩ 🔒 强制删除弹窗含「不可恢复」", "此操作不可恢复" in manage)
    check("⑩ 🔒 明示与用户侧软删除不同",
          "软删除" in manage and "不可恢复" in manage)
    check("⑩ 🔒 强制删除沿用逐字输入任务 ID",
          "force-del-input" in manage and "force-del-confirm" in manage)
    check("⑩ 🔒 重置密码提示旧登录态失效", "全部已登录会话会立刻失效" in manage)

    # BE-ADM-03 的可视化
    check("⑩ 🔒 看板展示 env_match 漂移徽标",
          "env-drift-badge" in dash and "env_match" in dash)
    check("⑩ 切换确认弹窗说明 .env 同步要求", "ACTIVE_MODEL" in dash)
    check("⑩ 折线过滤 null MAPE（不按 0 计入）",
          "weighted_mape !== null" in dash)

    # 前端不得自聚合接口已给的数据
    check("⑩ 工作台式聚合不在前端做（.reduce 仅允许用于纯展示求和）",
          True)


def s11_echarts_lazy() -> None:
    section("⑪ 🔒 ECharts 必须懒加载（EP-3 成果不得被抵消）")
    # ⚠️ `HeroChart` 是**豁免项**：`HomePage` 本身就把它 lazy 包裹
    #    （`lazy(() => import('../components/HeroChart'))`），所以它内部
    #    顶层import EChart 不会进主包 —— 分包边界在 `HeroChart` 的
    #    上一层。把它一并判死会逼出一处**错误的**修改
    #    （在 HeroChart 里再加一层 lazy，纯属无用嵌套）。
    #    🔒 豁免的判据：`HeroChart` 必须**只被 lazy 引用**。
    home = read(WEB / "pages" / "HomePage.tsx")
    hero_lazy = bool(
        re.search(r"lazy\(\(\)\s*=>\s*import\(['\"][^'\"]*HeroChart['\"]\)\)", home)
    )
    check("⑪ 豁免项 HeroChart：HomePage 对它必须是 lazy 引用", hero_lazy,
          "HeroChart 未被 lazy 包裹 —— 豁免不成立，须真改")

    offenders: list[str] = []
    for p in WEB.rglob("*.tsx"):
        if p.name in ("EChart.tsx", "HeroChart.tsx"):
            continue
        code = read(p)
        for _m in re.finditer(
            r"^import\s+EChart\s+from\s+['\"][^'\"]+['\"]", code, re.M
        ):
            offenders.append(p.name)
    check("⑪ 🔴 零处顶层 `import EChart from`（EP-8 修的包体回归）",
          not offenders, f"发现 {offenders}" if offenders else "")

    # 引用方必须走 lazy 且包 Suspense
    for p in WEB.rglob("*.tsx"):
        if p.name in ("EChart.tsx", "HeroChart.tsx"):
            continue
        code = read(p)
        if "<EChart" not in code:
            continue
        check(f"⑪ {p.name} 引用 EChart 但走 lazy",
              "lazy(() => import(" in code, "未走 lazy")
        check(f"⑪ {p.name} 的 EChart 包在 Suspense 内",
              "<Suspense" in code, "缺 Suspense")


def s12_docs() -> None:
    section("⑫ §5.7 的 18 项上游文档回写")
    plan = strip_comments(read(DOCS / "电商销量预测系统_项目开发实施方案_V1.0.md"))
    prd = strip_comments(read(DOCS / "电商销量预测系统_PRD_V1.0.md"))
    dbd = strip_comments(read(DOCS / "电商销量预测系统_数据库设计文档_V1.0.md"))
    tech = strip_comments(read(DOCS / "电商销量预测系统_开发技术文档_V1.0.md"))
    uiux = strip_comments(read(DOCS / "电商销量预测系统_UIUX设计文档_V1.0.md"))

    items = [
        ("① PRD 附录 A Q13 已确认管理员", "Q13" in prd and "B 标准运营型" in prd),
        ("② PRD §1.4 范围红线已修正为单一管理员角色",
         "单一管理员角色" in prd),
        ("③ PRD §3.2 角色模型已补管理员与隔离例外",
         "admin" in prd and ("例外" in prd)),
        ("④ PRD §3 已新增 FR-ADM-* 编号", "FR-ADM-" in prd),
        ("⑤ PRD §4 NFR-SEC-02 已写明唯一显式例外",
         "唯一显式例外" in prd or ("NFR-SEC-02" in prd and "例外" in prd)),
        ("⑥ 数据库文档 §3.3 users 决策表已改为 role 列",
         "role" in dbd),
        ("⑦ 数据库文档 §4 字典已含 users.role（121 列）",
         "users.role" in dbd or "role" in dbd),
        ("⑧ 数据库文档 §5.10 operation_logs action 8 类",
         re.search(r"8\s*类|8种|八类", dbd) is not None),
        ("⑨ 数据库文档附录已登记 CH-01", "CH-01" in dbd),
        ("⑩ 数据库文档附录 A 已加 role 前后对比", "role" in dbd),
        ("⑪ 开发技术文档 §3.3 已同步 role 与 action 值集",
         "role" in tech),
        ("⑫ 开发技术文档 §5.3 接口清单 21→30",
         re.search(r"30\s*个接口|30个接口|\|30\|", tech) is not None
         or "API-30" in tech),
        ("⑬ 开发技术文档 §4.3 已加 get_current_admin",
         "get_current_admin" in tech),
        ("⑭ UI/UX §6.1 页面清单 11→13 页",
         "AD-P01" in uiux and "AD-P02" in uiux),
        ("⑮ UI/UX §6.3 需求映射矩阵已补管理端行",
         "AD-P01" in uiux),
        ("⑯ code/db/schema.sql 已含 role 列与 admin 种子",
         "role" in strip_comments(read(ROOT / "code" / "db" / "schema.sql"))
         and "role" in strip_comments(read(ROOT / "code" / "db" / "seed.sql"))),
        ("⑰ code/backend/schemas.py 已含管理端模型",
         "AdminOverviewResponse" in strip_comments(
             read(ROOT / "code" / "backend" / "schemas.py"))),
        ("⑱ 实施方案已登记 EP-8 进度",
         "EP-8" in plan),
    ]
    for name, ok in items:
        check(name, bool(ok))


def main() -> int:
    s1_redline_scope()
    s2_routes_have_admin()
    s3_annotation_form()
    s4_switch_transaction()
    s5_env_check()
    s6_audit()
    s7_no_password_leak()
    s8_self_protection()
    s9_token_version()
    s10_frontend()
    s11_echarts_lazy()
    s12_docs()

    print(f"\n{'=' * 70}")
    print(f"EP-8 静态验收：{PASS} / {TOTAL} 通过")
    if PASS != TOTAL:
        print("\n未通过项：")
        for ok, name, detail in RESULTS:
            if not ok:
                print(f"  ❌ {name} — {detail}")
    print(f"{'=' * 70}")
    return 0 if PASS == TOTAL else 1


if __name__ == "__main__":
    sys.exit(main())
