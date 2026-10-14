"""校验 code/backend/schemas.py 可导入，且关键校验规则真实生效。

用法（需在装有 pydantic v2 的环境执行）：
    python scripts/verify_schemas.py

覆盖 PRD 中明确规定的格式约束：
    FR-USR-02  密码长度 >= 8 且含字母与数字
    FR-MOD-03  预测步长仅 7 / 14 / 30
    FR-HIS-04  跨任务对比需 2~4 个任务且不重复
    FR-SYS-01  统一响应包装
退出码 0 表示全部通过。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "code" / "backend"
sys.path.insert(0, str(BACKEND))

try:
    from pydantic import ValidationError

    import schemas as S
except Exception as exc:  # noqa: BLE001
    print(f"[FAIL] 无法导入 schemas.py：{exc}")
    sys.exit(1)


passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"[ OK ] {name}")
    else:
        failed += 1
        print(f"[FAIL] {name} {detail}")


def must_reject(name: str, fn) -> None:
    """断言构造会失败，用于校验规则生效。"""
    try:
        fn()
    except ValidationError:
        check(name, True)
    else:
        check(name, False, "（校验未生效，非法值被接受）")


def must_accept(name: str, fn) -> None:
    try:
        fn()
    except ValidationError as exc:
        check(name, False, f"（合法值被拒绝：{exc.errors()[0]['msg']}）")
    else:
        check(name, True)


print("=" * 62)
print("schemas.py 导入与规则校验")
print("=" * 62)

# ---------------------------------------------------------------- 模型清单
models = [
    name
    for name, obj in vars(S).items()
    if isinstance(obj, type) and issubclass(obj, S.BaseModel)
]
print(f"[INFO] 已定义 Pydantic 模型 {len(models)} 个：{', '.join(sorted(models))}")
check("模型数量 >= 30", len(models) >= 30, f"（实际 {len(models)}）")

# ---------------------------------------------------------------- FR-USR-02 密码强度
must_reject("FR-USR-02 拒绝纯数字密码 12345678",
            lambda: S.RegisterRequest(email="a@b.com", password="12345678"))
must_reject("FR-USR-02 拒绝纯字母密码 abcdefgh",
            lambda: S.RegisterRequest(email="a@b.com", password="abcdefgh"))
must_reject("FR-USR-02 拒绝过短密码 ab12",
            lambda: S.RegisterRequest(email="a@b.com", password="ab12"))
must_accept("FR-USR-02 接受合规密码 Demo12345",
            lambda: S.RegisterRequest(email="a@b.com", password="Demo12345"))
must_reject("邮箱格式非法被拒绝",
            lambda: S.RegisterRequest(email="not-an-email", password="Demo12345"))

# ------------------------------------------------- bcrypt 72 字节上限（BE-40 / JT-12）
# 这几条是关键回归：bcrypt 5.x 对 >72 字节的密码抛 ValueError（4.x 是静默截断）。
# ⚠️ 用例设计要点：字符数必须 < 64，否则会被 Field(max_length=64) 先拦下，
#    就测不到「字节校验」本身，形成假通过。故全部用「少字符、多字节」的中文构造。
check("常量 BCRYPT_MAX_BYTES == 72", S.BCRYPT_MAX_BYTES == 72,
      f"（实际 {S.BCRYPT_MAX_BYTES}）")
_zh_over = "中文" * 12 + "a1"          # 26 字符 / 74 字节 → 仅字节校验能拦
_zh_ok = "中文" * 11 + "a1"            # 24 字符 / 68 字节 → 应通过
check("构造的溢出用例字符数 < 64（否则测的是 max_length 而非字节数）",
      len(_zh_over) < 64 and len(_zh_over.encode()) > 72,
      f"（字符 {len(_zh_over)} / 字节 {len(_zh_over.encode())}）")
must_reject("拒绝 74 字节的中文密码（字符数仅 26，必须由字节校验拦截）",
            lambda: S.RegisterRequest(email="a@b.com", password=_zh_over))
must_accept("接受 68 字节的中文密码",
            lambda: S.RegisterRequest(email="a@b.com", password=_zh_ok))
# 精确边界：72 字节通过，73 字节拒绝。
# ⚠️ 必须用多字节字符构造 —— ASCII 下 72 字节 = 72 字符 > 64，永远先被字符上限拦截。
#    这也说明「64 字符」与「72 字节」两道限制**缺一不可**：
#      ASCII 场景由字符上限先触发，中文场景由字节上限先触发。
_b72 = "中文" * 11 + "中" + "a12"       # 23 中文(69B) + 3B = 72B / 26 字符
_b73 = "中文" * 11 + "中" + "a123"      # 23 中文(69B) + 4B = 73B / 27 字符
check("边界用例分别为 72 / 73 字节，且字符数均 < 64",
      len(_b72.encode()) == 72 and len(_b73.encode()) == 73
      and len(_b72) < 64 and len(_b73) < 64,
      f"（{len(_b72.encode())}B/{len(_b72)}c 与 {len(_b73.encode())}B/{len(_b73)}c）")
must_accept("接受恰好 72 字节的密码", lambda: S.RegisterRequest(email="a@b.com", password=_b72))
must_reject("拒绝 73 字节的密码", lambda: S.RegisterRequest(email="a@b.com", password=_b73))
must_reject("改密接口同样受 72 字节限制",
            lambda: S.UpdateUserRequest(new_password=_zh_over))

# ---------------------------------------------------------------- FR-MOD-03 预测步长
must_accept("FR-MOD-03 接受 horizon=7", lambda: S.CreateTaskRequest(dataset_id=1, horizon=7))
must_accept("FR-MOD-03 接受 horizon=30", lambda: S.CreateTaskRequest(dataset_id=1, horizon=30))
must_reject("FR-MOD-03 拒绝 horizon=15",
            lambda: S.CreateTaskRequest(dataset_id=1, horizon=15))
must_reject("FR-MOD-03 拒绝 horizon=0",
            lambda: S.CreateTaskRequest(dataset_id=1, horizon=0))

# ---------------------------------------------------------------- 其他格式约束
must_reject("use_holiday_feature 仅接受 0/1",
            lambda: S.CreateTaskRequest(dataset_id=1, horizon=14, use_holiday_feature=2))
must_reject("granularity 仅接受 warehouse_sku",
            lambda: S.CreateTaskRequest(dataset_id=1, horizon=14, granularity="sku"))

# ---------------------------------------------------------------- FR-HIS-04 对比数量
must_accept("FR-HIS-04 接受 2 个任务", lambda: S.CompareRequest(task_ids=[1, 2]))
must_accept("FR-HIS-04 接受 4 个任务", lambda: S.CompareRequest(task_ids=[1, 2, 3, 4]))
must_reject("FR-HIS-04 拒绝 1 个任务", lambda: S.CompareRequest(task_ids=[1]))
must_reject("FR-HIS-04 拒绝 5 个任务",
            lambda: S.CompareRequest(task_ids=[1, 2, 3, 4, 5]))
must_reject("FR-HIS-04 拒绝重复任务",
            lambda: S.CompareRequest(task_ids=[1, 1]))

# ---------------------------------------------------------------- FR-SYS-01 统一响应
r = S.ApiResponse.ok({"hello": "world"})
check("FR-SYS-01 成功响应 code=0 且 message='ok'", r.code == 0 and r.message == "ok")
f = S.ApiResponse.fail(40001, "缺少必需字段：warehouse_id", {"suggestion": "补齐后重传"})
check("FR-SYS-01 失败响应保留业务码与定位信息",
      f.code == 40001 and f.data is not None and "suggestion" in f.data)

# ---------------------------------------------------------------- 分页构造
pg = S.Paginated[int].build(items=[1, 2, 3], page=1, size=20, total=45)
check("Paginated 分页页数计算正确（45 条 / 每页 20 -> 3 页）", pg.pages == 3)
check("Paginated 保留 items 与 total", pg.total == 45 and len(pg.items) == 3)

# ---------------------------------------------------------------- JwtPayload（TQ-1 / FR-USR-07）
jp = S.JwtPayload(sub="7", ver=1, jti="j-1", iat=1_700_000_000, exp=1_700_003_600)
check("JwtPayload 接受合法载荷", jp.sub == "7" and jp.ver == 1 and jp.jti == "j-1")
check("TOKEN_VERSION_DEFAULT = 1（与 DDL DEFAULT 1 同源）", S.TOKEN_VERSION_DEFAULT == 1)
check("JwtPayload.ver 缺省等于 TOKEN_VERSION_DEFAULT",
      S.JwtPayload(sub="7", jti="j-1", iat=1, exp=2).ver == S.TOKEN_VERSION_DEFAULT)
check("JwtPayload.sub 为字符串（JWT 规范要求）", isinstance(jp.sub, str))
must_reject("JwtPayload 拒绝缺失 sub",
            lambda: S.JwtPayload(ver=1, jti="j-1", iat=1, exp=2))
must_reject("JwtPayload 拒绝非整数 ver",
            lambda: S.JwtPayload(sub="7", ver="not-an-int", jti="j-1", iat=1, exp=2))

# ---------------------------------------------------------------- 常量同源检查
check("MAX_FILE_SIZE_MB = 20（NFR-PERF-03）", S.MAX_FILE_SIZE_MB == 20)
check("MAX_ROWS = 500000（NFR-PERF-04）", S.MAX_ROWS == 500_000)
check("MAX_SERIES = 1000（NFR-PERF-05）", S.MAX_SERIES == 1000)
check("L1_MIN_VALID_POINTS = 90（FR-FEA-09）", S.L1_MIN_VALID_POINTS == 90)
check("SLA_SECONDS = 60（NFR-PERF-01）", S.SLA_SECONDS == 60)
check("REQUIRED_COLUMNS 与 PRD §3.2.2 一致",
      S.REQUIRED_COLUMNS == ("sku_id", "warehouse_id", "date", "sales"))

# ---------------------------------------------------------------- 字段类型抽查
fields = S.PredictionResultResponse.model_fields
for fname in ("task", "dataset", "metrics", "coverage", "distribution",
              "timing_ms", "is_over_threshold", "eval_note", "series"):
    check(f"PredictionResultResponse 含字段 {fname}", fname in fields)

cov_fields = S.Coverage.model_fields
for fname in ("L1", "L2", "L3", "total"):
    check(f"Coverage 含字段 {fname}（UX-AC-06 三项之和 = total）", fname in cov_fields)

# ---------------------------------------------------------------- CH-01 用户角色
# UserProfile.role 是前端派生 isAdmin 的唯一来源（EP-2 WS-2-08）。
# 缺了它，管理端导航会永远不显示，且前端拿不到任何角色信息。
up_fields = S.UserProfile.model_fields
check("UserProfile 含 role 字段（CH-01 / EP-2）", "role" in up_fields)
check("UserProfile.role 默认值为 'user'（最小权限）",
      up_fields["role"].default == "user",
      f"（实际 {up_fields['role'].default!r}）")
must_reject("UserProfile 拒绝非法角色 superuser",
            lambda: S.UserProfile(id=1, email="a@b.com",
                                  created_at="2026-01-01 00:00:00", role="superuser"))

# ------------------------------------------------------- 模块级守卫：重名与职责
# 🔴 **顶层类名重复 = 后者静默覆盖前者**。这类缺陷不会让 import 报错，
#    只会在运行期表现为「另一个接口拿到的字段对不上」。
#
#    `EP-8` 新增管理端模型时又写了一个 `UpdateUserRequest`（字段 status/role），
#    覆盖了 `EP-2` 的同名模型（字段 nickname/old_password/new_password）。
#    后果：`API-05`（用户改昵称/改密码）读 `body.nickname` 时 —— 字段既不在
#    `model_fields` 也不在 `model_extra`（`AppBase` 未设 `extra='allow'`，
#    Pydantic v2 默认 `ignore`）→ `AttributeError` → **500，功能整体不可用**。
#    同时 `UpdateUserRequest` 的 72 字节密码校验也一并失效。
#
#    📌 漏网原因值得记：`EP-8` 的验收只跑了本阶段的三个脚本，**没跑 `verify_auth.py`**，
#    而 `API-05` 恰好只被后者覆盖。**「新阶段只跑新脚本」是回归缺陷最典型的温床** ——
#    `EP-9` 的价值正在于把全量校验链重跑一遍。已在此加守卫，重复即失败。
import collections as _collections
import re as _re

_SRC = (BACKEND / "schemas.py").read_text(encoding="utf-8")
_TOP = _re.findall(r"^class\s+([A-Za-z_]\w*)", _SRC, _re.M)
_DUP = sorted(n for n, c in _collections.Counter(_TOP).items() if c > 1)
check("schemas.py 无重名顶层类（重名 = 后者覆盖前者，静默失效）",
      not _DUP, f"（重名：{_DUP}）")

# 两个「改用户」模型必须各司其职、字段不串
_api05_fields = set(S.UpdateUserRequest.model_fields)
_admin_fields = set(S.AdminUpdateUserRequest.model_fields)
check("UpdateUserRequest 即 API-05 用户自助改资料（nickname/old_password/new_password）",
      {"nickname", "old_password", "new_password"} <= _api05_fields,
      f"（实际 {sorted(_api05_fields)}）")
check("AdminUpdateUserRequest 即 API-24 管理端启停用/改角色（status/role）",
      {"status", "role"} <= _admin_fields,
      f"（实际 {sorted(_admin_fields)}）")
check("两个改用户模型字段不重叠（职责隔离，防止再次合并）",
      not (_api05_fields & _admin_fields),
      f"（交集 {sorted(_api05_fields & _admin_fields)}）")

print("=" * 62)
print(f"通过 {passed} 项，失败 {failed} 项")
print("结论：全部通过" if failed == 0 else "结论：存在未通过项")
sys.exit(0 if failed == 0 else 1)
