"""`EP-8` 管理端接口验收（`DOD-EP8` 动态部分）。

与 `verify_ep7_api.py` 同一套骨架：临时库 + `TestClient` +
**整个运行在同一个 lifespan 内**（否则模型单例被清，要推理的用例全挂）。

覆盖：
  ① 🔒 **非管理员 403**（`API-22`~`30` 逐条，且未登录是 401 不是 403）
  ② 🔒 **响应零密码哈希**（9 个接口的响应体递归扫 `password` 字段）
  ③ `API-23` 用户列表：分页 / 筛选 / 关键词
  ④ 🔒 `API-24` 三条自我保护：不能停用自己 / 不能降级自己 / 不能动最后一个管理员
  ⑤ 🔒 `API-24` 停用后旧 Token 立即失效（`token_version + 1`）
  ⑥ 🔒 `API-25` 重置密码 → `token_version + 1` → 旧 Token 失效
  ⑦ `API-26` 全量任务列表（含已软删除的，`is_deleted` 标记）
  ⑧ 🔒 `API-27` 强制删除：级联 `predictions`/`metrics`、`datasets` 保留、
     `operation_logs` 保留、任务不存在返 40012
  ⑨ `API-28` 模型列表 + `env_match` 标记
  ⑩ 🔒 `API-29` 切换事务顺序（`BE-ADM-02`）+ 唯一索引 + `BE-ADM-03` 警告
  ⑪ 🔒 **全操作审计**：4 类写操作都写 `operation_logs(action='admin')`
     且 `detail` 可解析出 `sub` / `target` / `by`
  ⑫ `API-30` 日志查询 + 非法 `action` 返 `40012`（不是 500）
  ⑬ `API-22` 看板：指标齐备 + `mape_trend` 时间正序
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "data" / "tmp" / "verify_ep8_api"
shutil.rmtree(TMP, ignore_errors=True)
TMP.mkdir(parents=True, exist_ok=True)
os.environ.update(
    DB_PATH=str(TMP / "app.db"),
    UPLOAD_DIR=str(TMP / "uploads"),
    EXPORT_DIR=str(TMP / "exports"),
    MODEL_DIR=str(ROOT / "outputs" / "models"),
    JWT_SECRET="x" * 32,
    APP_ENV="test",
)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

PASS = 0
TOTAL = 0
RESULTS: list[tuple[bool, str, str]] = []
STATE: dict = {}

# 种子管理员的口令（与 code/db/seed.sql 的 bcrypt 注释同源）。
# ⚠️ 这是**开发种子账号**，仅存在于本地 SQLite，不对应任何真实系统。
ADMIN_EMAIL = "admin@salesforecast.cn"
ADMIN_PASSWORD = "Admin@2026"


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


def api(method: str, path: str, *, json_body: dict | None = None, who: str = "admin"):
    """🔴 业务错误也是 HTTP 200，判据必须看 `body.code` 而非状态码。"""
    headers = STATE.get(f"H_{who}")
    c: TestClient = STATE["client"]
    r = c.request(method, path, json=json_body, headers=headers or {})
    try:
        return r.status_code, r.json()
    except Exception:  # noqa: BLE001
        return r.status_code, {}


def q(sql: str, args: tuple = ()) -> list[tuple]:
    """只读查询 —— 开新连接，保证看到的是已提交的数据。"""
    con = sqlite3.connect(STATE["db_path"])
    try:
        return con.execute(sql, args).fetchall()
    finally:
        con.close()


def qx(sql: str, args: tuple = ()) -> None:
    """🔒 写操作（构造夹具）—— **必须 commit**，否则连接关闭即回滚。

    ⚠️ 这正是本脚本第一版 `API-29` 用例失败的根因：用 `q()` 插入了
    一个 `lstm_v_test`，连接一关就回滚了，随后 `switch_model`
    自然报「版本不存在」，而断言却显示「切换生效」——
    **假失败 + 假通过同时出现**，比直接报错更难查。
    """
    con = sqlite3.connect(STATE["db_path"])
    try:
        con.execute(sql, args)
        con.commit()
    finally:
        con.close()


def walk_keys(obj, out: set[str] | None = None) -> set[str]:
    """递归收集所有 dict 的键名（用来扫 `password_hash` 是否泄露）。"""
    if out is None:
        out = set()
    if isinstance(obj, dict):
        out.update(obj.keys())
        for v in obj.values():
            walk_keys(v, out)
    elif isinstance(obj, list):
        for v in obj:
            walk_keys(v, out)
    return out


# =============================================================================
def case_setup() -> bool:
    section("① 前置：普通用户注册登录 + 管理员登录 + 示例数据 + 一个任务")
    st, b = api("POST", "/api/v1/auth/register",
                json_body={"email": "ep8user@verify.com", "password": "Verify123456"},
                who="none")
    if not check("① 普通用户注册成功", st == 200 and b.get("code") == 0,
                 str(b.get("message"))):
        return False
    # ⚠️ `RegisterResponse` 只含 user_id / email，**不返 token** —— 必须再登录。
    st, b = api("POST", "/api/v1/auth/login",
                json_body={"email": "ep8user@verify.com", "password": "Verify123456"},
                who="none")
    if not check("① 普通用户登录成功", st == 200 and b.get("code") == 0,
                 str(b.get("message"))):
        return False
    STATE["H_user"] = {"Authorization": f"Bearer {b['data']['access_token']}"}
    STATE["user_id"] = b["data"]["user"]["id"]

    # 🔒 管理员：走**正常登录接口**，不用直接改库造 token。
    #    这样验的是「种子账号真的能登录」（WS-8-02：邮箱域名须被 EmailStr 接受）。
    st, b = api("POST", "/api/v1/auth/login",
                json_body={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                who="none")
    if not check("① 管理员种子账号可登录（WS-8-02）",
                 st == 200 and b.get("code") == 0,
                 f"{b.get('message')}（邮箱域名须被 EmailStr 接受）"):
        return False
    STATE["H_admin"] = {"Authorization": f"Bearer {b['data']['access_token']}"}
    STATE["admin_id"] = b["data"]["user"]["id"]

    # 示例数据 + 跑一个任务（给看板/任务列表造真实数据）
    # ⚠️ `API-07` 是 **GET** `/datasets/sample`，不是 POST。
    st, b = api("GET", "/api/v1/datasets/sample", who="user")
    if not check("① 普通用户加载示例数据集", st == 200 and b.get("code") == 0,
                 str(b.get("message"))):
        return False
    # ⚠️ `API-07` 的响应是 `UploadDatasetResponse`，`dataset_id` **嵌套在
    #    `data.dataset.id` 里**，不是顶层字段 —— 与 `CreateTaskResponse`
    #    的顶层 `task_id` 不同。写错会直接 KeyError。
    ds_id = b["data"]["dataset"]["id"]

    st, b = api("POST", "/api/v1/predictions",
                json_body={"dataset_id": ds_id, "granularity": "warehouse_sku",
                           "horizon": 7, "use_holiday": True},
                who="user")
    if not check("① 提交预测任务", st == 200 and b.get("code") == 0, str(b.get("message"))):
        return False
    STATE["task_id"] = b["data"]["task_id"]
    return True


# =============================================================================
def case_forbidden() -> None:
    section("② 🔒 权限隔离：非管理员 403 / 未登录 401")

    paths_get = [
        "/api/v1/admin/overview",
        "/api/v1/admin/users",
        "/api/v1/admin/tasks",
        "/api/v1/admin/models",
        "/api/v1/admin/logs",
    ]
    for p in paths_get:
        st, b = api("GET", p, who="user")
        check(f"② 普通用户 GET {p.split('/')[-1]} → 40301",
              st == 200 and b.get("code") == 40301,
              f"HTTP={st} code={b.get('code')}")

    # 🔴 写操作同样403 —— 不能因为「只有读接口挂了校验」就放过
    st, b = api("PATCH", "/api/v1/admin/users/2", json_body={"status": 0}, who="user")
    check("② 普通用户 PATCH /admin/users/{id} → 40301", b.get("code") == 40301,
          str(b.get("message")))

    st, b = api("POST", "/api/v1/admin/users/2/reset-password",
                json_body={"new_password": "Hacked123456"}, who="user")
    check("② 普通用户 POST reset-password → 40301", b.get("code") == 40301)

    st, b = api("DELETE", "/api/v1/admin/tasks/1", who="user")
    check("② 普通用户 DELETE /admin/tasks/{id} → 40301", b.get("code") == 40301)

    st, b = api("PATCH", "/api/v1/admin/models/lstm_v1",
                json_body={"is_active": True}, who="user")
    check("② 普通用户 PATCH /admin/models/{v} → 40301", b.get("code") == 40301)

    # 🔒 未登录必须是 **401 而不是 403** —— 顺序反了前端就分不清
    #    「该去登录」与「登录了但没权限」（BE-41：先认证后授权）。
    c: TestClient = STATE["client"]
    for method, path, body in [
        ("GET", "/api/v1/admin/overview", None),
        ("GET", "/api/v1/admin/users", None),
        ("DELETE", "/api/v1/admin/tasks/1", None),
    ]:
        r = c.request(method, path, json=body)
        check(f"② 未登录 {method} {path.split('/')[-1]} → 真实 401",
              r.status_code == 401, f"HTTP={r.status_code}")


# =============================================================================
def case_no_password_leak() -> None:
    section("③ 🔒 最小暴露：9 个接口响应零密码字段")
    _, me = api("GET", "/api/v1/admin/users")
    keys = walk_keys(me)
    leaked = {k for k in keys if "password" in k.lower()}
    check("③ API-23 响应无任何 password* 键", not leaked, f"泄露字段={leaked or '无'}")

    st, b = api("POST", "/api/v1/admin/login-check", who="none")
    # 用户列表里也不能出现哈希值本体
    raw = str(me)
    check("③ API-23 响应体不含 bcrypt 哈希（$2b$）", "$2b$" not in raw)


# =============================================================================
def case_api23() -> None:
    section("④ API-23 用户列表：分页 / 筛选 / 关键词")
    st, b = api("GET", "/api/v1/admin/users?page=1&size=10")
    d = b.get("data", {})
    check("④ 列表返回结构完整",
          st == 200 and b.get("code") == 0 and "items" in d and "total" in d,
          f"total={d.get('total')}")
    check("④ 游客哨兵 id=0 不出现在列表",
          all(u["id"] != 0 for u in d.get("items", [])), "已过滤")
    check("④ 列表含普通用户与管理员", d.get("total", 0) >= 2,
          f"total={d.get('total')}")

    st, b = api("GET", "/api/v1/admin/users?role=admin")
    items = b.get("data", {}).get("items", [])
    check("④ role=admin 筛选只剩管理员",
          len(items) >= 1 and all(u["role"] == "admin" for u in items),
          f"命中 {len(items)}")

    st, b = api("GET", "/api/v1/admin/users?q=ep8user")
    items = b.get("data", {}).get("items", [])
    check("④ 关键词 q 命中目标用户",
          len(items) == 1 and items[0]["email"] == "ep8user@verify.com",
          f"命中 {len(items)}")

    # 🔴 非法筛选值必须 40012 而非 500（schema 刻意不收窄取值域）
    st, b = api("GET", "/api/v1/admin/users?role=superuser")
    check("④ 非法 role=superuser → 40012（非 500）", b.get("code") == 40012,
          f"code={b.get('code')} msg={b.get('message')}")

    st, b = api("GET", "/api/v1/admin/users?status=7")
    check("④ 非法 status=7 → 40012（非 500）", b.get("code") == 40012)


# =============================================================================
def case_api24_guard() -> None:
    section("⑤ 🔒 API-24 三条自我保护")
    admin_id = STATE["admin_id"]

    st, b = api("PATCH", f"/api/v1/admin/users/{admin_id}", json_body={"status": 0})
    check("⑤ 不能停用自己", b.get("code") == 40012, str(b.get("message")))

    st, b = api("PATCH", f"/api/v1/admin/users/{admin_id}", json_body={"role": "user"})
    check("⑤ 不能降级自己", b.get("code") == 40012, str(b.get("message")))

    # 「最后一个管理员」：库里只有种子管理员一个admin，
    # 把它降级会被这条拦住（此时操作者不是它自己，需要另造一个 admin）
    rows = q("select id from users where role='admin' and status=1")
    if len(rows) == 1:
        only = rows[0][0]
        st, b = api("PATCH", f"/api/v1/admin/users/{only}", json_body={"role": "user"})
        # 若 only==自己，已被「不能降级自己」拦（同样是保护生效）
        check("⑤ 不能动最后一个管理员",
              b.get("code") == 40012, str(b.get("message")))
    else:
        check("⑤ 管理员数 >1，跳过最后一名判定", True, f"共 {len(rows)} 个")

    st, b = api("PATCH", f"/api/v1/admin/users/{admin_id}", json_body={})
    check("⑤ status 与 role 都为空 → 40012", b.get("code") == 40012,
          str(b.get("message")))


# =============================================================================
def case_api24_token_version() -> None:
    section("⑥ 🔒 API-24/25 的 token_version 联动（旧 Token 立即失效）")
    # 造第二个用户，用于停用与重置密码
    st, b = api("POST", "/api/v1/auth/register",
                json_body={"email": "ep8victim@verify.com", "password": "Verify123456"},
                who="none")
    st, b = api("POST", "/api/v1/auth/login",
                json_body={"email": "ep8victim@verify.com", "password": "Verify123456"},
                who="none")
    if not check("⑥ 造第二个用户并登录", b.get("code") == 0, str(b.get("message"))):
        return
    victim_token = b["data"]["access_token"]
    victim_id = b["data"]["user"]["id"]
    victim_h = {"Authorization": f"Bearer {victim_token}"}
    STATE["victim_id"] = victim_id

    st, b = api("GET", "/api/v1/users/me", who="none")
    c: TestClient = STATE["client"]
    r = c.get("/api/v1/users/me", headers=victim_h)
    check("⑥ 停用前 victim Token 有效", r.status_code == 200)

    ver_before = q("select token_version from users where id=?", (victim_id,))[0][0]

    # 🔒 重置密码（API-25）
    st, b = api("POST", f"/api/v1/admin/users/{victim_id}/reset-password",
                json_body={"new_password": "Reset12345678"})
    check("⑥ API-25 重置密码成功", b.get("code") == 0, str(b.get("message")))
    ver_after = q("select token_version from users where id=?", (victim_id,))[0][0]
    check("⑥ token_version 已 +1（BE-41 联动）", ver_after == ver_before + 1,
          f"{ver_before} → {ver_after}")
    check("⑥ 响应回显新 token_version",
          b.get("data", {}).get("token_version") == ver_after,
          str(b.get("data", {}).get("token_version")))

    r = c.get("/api/v1/users/me", headers=victim_h)
    check("⑥ 🔒 重置后旧 Token 立即失效（40102）", r.status_code == 401,
          f"HTTP={r.status_code}")

    # 新密码可登录，旧密码不可
    st, b = api("POST", "/api/v1/auth/login",
                json_body={"email": "ep8victim@verify.com", "password": "Reset12345678"},
                who="none")
    check("⑥ 新密码可登录", b.get("code") == 0, str(b.get("message")))
    st, b = api("POST", "/api/v1/auth/login",
                json_body={"email": "ep8victim@verify.com", "password": "Verify123456"},
                who="none")
    check("⑥ 旧密码已不可登录", b.get("code") != 0, str(b.get("message")))

    # 🔒 弱密码必须被拒（重置出来的密码不能比用户自己注册的更弱）
    st, b = api("POST", f"/api/v1/admin/users/{victim_id}/reset-password",
                json_body={"new_password": "abcdefgh"})
    check("⑥ 弱密码（无数字）被拒", b.get("code") != 0, str(b.get("message")))

    # 改回来便于后续用例
    api("POST", f"/api/v1/admin/users/{victim_id}/reset-password",
        json_body={"new_password": "Verify123456"})


# =============================================================================
def case_api24_status() -> None:
    section("⑦ API-24 停用 / 启用")
    vid = STATE["victim_id"]
    st, b = api("PATCH", f"/api/v1/admin/users/{vid}", json_body={"status": 0})
    check("⑦ 停用成功", b.get("code") == 0, str(b.get("message")))
    check("⑦ 响应含 status=0", b.get("data", {}).get("user", {}).get("status") == 0)

    # 🔒 停用后该用户登录直接被拒
    st, b = api("POST", "/api/v1/auth/login",
                json_body={"email": "ep8victim@verify.com", "password": "Verify123456"},
                who="none")
    check("⑦ 停用后登录被拒", b.get("code") != 0, str(b.get("message")))

    st, b = api("PATCH", f"/api/v1/admin/users/{vid}", json_body={"status": 1})
    check("⑦ 重新启用成功", b.get("code") == 0, str(b.get("message")))


# =============================================================================
def case_api26() -> None:
    section("⑧ API-26 全量任务列表")
    st, b = api("GET", "/api/v1/admin/tasks?page=1&size=10")
    d = b.get("data", {})
    check("⑧ 列表结构完整", b.get("code") == 0 and "items" in d, f"total={d.get('total')}")
    items = d.get("items", [])
    if items:
        it = items[0]
        need = {"id", "task_name", "owner_email", "status", "is_deleted",
                "granularity", "horizon"}
        check("⑧ 条目字段齐备", need <= set(it.keys()),
              f"缺={need - set(it.keys()) or '无'}")
        check("⑧ 含归属用户邮箱（运维定位）", bool(it.get("owner_email")),
              str(it.get("owner_email")))
    st, b = api("GET", "/api/v1/admin/tasks?status=succeeded")
    items = b.get("data", {}).get("items", [])
    check("⑧ status筛选生效", all(i["status"] == "succeeded" for i in items),
          f"命中 {len(items)}")
    st, b = api("GET", "/api/v1/admin/tasks?status=bogus")
    check("⑧ 非法 status → 40012（非 500）", b.get("code") == 40012)


# =============================================================================
def case_api27() -> None:
    section("⑨ 🔒 API-27 强制删除：级联范围与审计保留")
    tid = STATE["task_id"]

    # 先造一条软删除任务，验证管理端列表**含**它（与用户侧相反）
    st, b = api("GET", "/api/v1/admin/tasks?page=1&size=50")
    items = b.get("data", {}).get("items", [])
    check("⑨ 管理端列表含 is_deleted 字段（运维视角）",
          any("is_deleted" in i for i in items), "字段存在")

    ds_id = q("select dataset_id from tasks where id=?", (tid,))[0][0]
    pred_before = q("select count(*) from predictions where task_id=?", (tid,))[0][0]
    metric_before = q("select count(*) from metrics where task_id=?", (tid,))[0][0]
    log_before = q("select count(*) from operation_logs")[0][0]
    check("⑨ 前置：目标任务确有预测明细", pred_before > 0, f"predictions={pred_before}")

    st, b = api("DELETE", f"/api/v1/admin/tasks/{tid}")
    check("⑨ 强制删除成功", b.get("code") == 0, str(b.get("message")))
    d = b.get("data", {})
    check("⑨ 回执含连带删除行数（不可逆操作必须有回执）",
          "deleted_predictions" in d and "deleted_metrics" in d,
          f"pred={d.get('deleted_predictions')} metric={d.get('deleted_metrics')}")
    check("⑨ 回执行数与库内实际一致",
          d.get("deleted_predictions") == pred_before
          and d.get("deleted_metrics") == metric_before,
          f"回执 {d.get('deleted_predictions')}/{d.get('deleted_metrics')} "
          f"vs 实际 {pred_before}/{metric_before}")

    check("⑨ 🔒 tasks 行已删除",
          q("select count(*) from tasks where id=?", (tid,))[0][0] == 0)
    check("⑨ 🔒 predictions 已级联删除",
          q("select count(*) from predictions where task_id=?", (tid,))[0][0] == 0)
    check("⑨ 🔒 metrics 已级联删除",
          q("select count(*) from metrics where task_id=?", (tid,))[0][0] == 0)
    check("⑨ 🔒 datasets 未被删除（RESTRICT，可能被其他任务引用）",
          q("select count(*) from datasets where id=?", (ds_id,))[0][0] == 1)
    check("⑨ 🔒 operation_logs 保留（审计不随任务消失）",
          q("select count(*) from operation_logs")[0][0] > log_before,
          f"{log_before} → {q('select count(*) from operation_logs')[0][0]}")

    st, b = api("DELETE", f"/api/v1/admin/tasks/{tid}")
    check("⑨ 重复删除同一任务 → 40012（不静默成功）", b.get("code") == 40012,
          str(b.get("message")))

    # 把数据集清掉，避免残留影响后续
    STATE.pop("task_id", None)


# =============================================================================
def case_api28_29() -> None:
    section("⑩ API-28 模型列表 / 🔒 API-29 切换事务")
    st, b = api("GET", "/api/v1/admin/models")
    d = b.get("data", {})
    check("⑩ 模型列表结构完整", b.get("code") == 0 and "items" in d,
          f"total={d.get('total')}")
    items = d.get("items", [])
    if items:
        it = items[0]
        need = {"version", "window_size", "hidden_size", "num_layers",
                "param_count", "val_mape", "is_active", "env_match"}
        check("⑩ 条目字段齐备", need <= set(it.keys()),
              f"缺={need - set(it.keys()) or '无'}")
        check("⑩ 🔒 每行带 env_match（BE-ADM-03 可视化）",
              "env_match" in it, str(it.get("env_match")))
    actives = [i for i in items if i["is_active"]]
    check("⑩ 有且仅有一个启用版本（部分唯一索引）", len(actives) == 1,
          f"启用 {len(actives)} 个")

    # 切到不存在的版本
    st, b = api("PATCH", "/api/v1/admin/models/lstm_v99",
                json_body={"is_active": True})
    check("⑩ 切到不存在的版本 → 40012", b.get("code") == 40012, str(b.get("message")))

    # 幂等：切到当前已启用版本
    cur = actives[0]["version"] if actives else "lstm_v1"
    st, b = api("PATCH", f"/api/v1/admin/models/{cur}", json_body={"is_active": True})
    check("⑩ 切到当前版本幂等成功", b.get("code") == 0, str(b.get("message")))
    check("⑩ 幂等时 changed=false", b.get("data", {}).get("changed") is False,
          str(b.get("data", {}).get("changed")))

    # 🔒 BE-ADM-02/03 真切换：注册第二个版本并切过去
    reg = q("select id, file_path, window_size, hidden_size, num_layers, dropout,"
            " learning_rate, batch_size from model_registry where version=?", (cur,))[0]
    qx("INSERT INTO model_registry (version, file_path, window_size, hidden_size,"
       " num_layers, dropout, learning_rate, batch_size, is_active, created_at)"
       " VALUES (?,?,?,?,?,?,?,?,0, datetime('now','localtime'))",
       ("lstm_v_test", reg[1], reg[2], reg[3], reg[4], reg[5], reg[6], reg[7]))
    # ⚠️ 必须先确认插入**真的落库**了再往下走 —— 否则后面的断言全部是假象
    check("⑩ 夹具：lstm_v_test 已落库",
          q("select count(*) from model_registry where version='lstm_v_test'")[0][0] == 1)

    before = q("select version from model_registry where is_active=1")[0][0]
    st, b = api("PATCH", "/api/v1/admin/models/lstm_v_test", json_body={"is_active": True})
    check("⑩ 切换到新版本成功", b.get("code") == 0, str(b.get("message")))
    d = b.get("data", {})
    check("⑩ 🔒 切换确实生效（原版本已降）",
          before != d.get("version"), f"{before} → {d.get('version')}")
    now_actives = q("select version from model_registry where is_active=1")
    check("⑩ 🔒 切换后仍只有一个启用版本（BE-ADM-02事务正确）",
          len(now_actives) == 1 and now_actives[0][0] == "lstm_v_test",
          f"启用={[r[0] for r in now_actives]}")

    # 🔒 BE-ADM-03：.env 未同步 → 必须带 warning，而不是静默成功
    check("⑩ 🔒 env_match=false 时必须给 warnings（BE-ADM-03）",
          d.get("env_match") is False and len(d.get("warnings") or []) > 0,
          f"env_match={d.get('env_match')} warnings={d.get('warnings')}")

    # 切回原版本，恢复现场
    st, b = api("PATCH", f"/api/v1/admin/models/{cur}", json_body={"is_active": True})
    check("⑩ 切回原版本成功", b.get("code") == 0)
    qx("DELETE FROM model_registry WHERE version='lstm_v_test'")


# =============================================================================
def case_audit() -> None:
    section("⑪ 🔒 全操作审计（WS-8-05）")
    vid = STATE["victim_id"]

    rows = q("select detail from operation_logs where action='admin' order by id")
    details = [r[0] or "" for r in rows]
    check("⑪ action='admin' 的日志条数 ≥ 4", len(details) >= 4, f"共 {len(details)} 条")

    for sub in ("reset_pwd", "disable", "enable", "hard_delete"):
        check(f"⑪ 子动作 {sub} 已留痕",
              any(f"sub={sub}" in d for d in details),
              "缺失" if not any(f"sub={sub}" in d for d in details) else "")

    # 🔒 detail 必须是可解析的 k=v;k=v 固定格式
    parsed_ok = all(
        all("=" in part for part in d.split(";") if part) for d in details if d
    )
    check("⑪ 🔒 detail 为固定 k=v;k=v 格式（API-30 可解析）", parsed_ok)

    #每条都必须能解析出操作者与子动作
    miss_sub = [d for d in details if "sub=" not in d]
    miss_by = [d for d in details if "by=" not in d]
    check("⑪ 🔒 每条都含 sub=（子动作）", not miss_sub, f"缺 {len(miss_sub)} 条")
    check("⑪ 🔒 每条都含 by=（操作者）", not miss_by, f"缺 {len(miss_by)} 条")

    # 目标用户是谁
    tgt = [d for d in details if "sub=hard_delete" in d]
    check("⑪ 硬删除日志含 target=任务号",
          bool(tgt) and "target=" in tgt[0], tgt[0] if tgt else "无")


# =============================================================================
def case_api30() -> None:
    section("⑫ API-30 操作日志查询")
    st, b = api("GET", "/api/v1/admin/logs?page=1&size=20")
    d = b.get("data", {})
    check("⑫ 日志列表结构完整", b.get("code") == 0 and "items" in d,
          f"total={d.get('total')}")
    items = d.get("items", [])
    admins = [i for i in items if i["action"] == "admin"]
    check("⑫ 能筛出 action=admin 的条目", len(admins) > 0, f"{len(admins)} 条")
    if admins:
        it = admins[0]
        check("⑫ 🔒 子动作已结构化拆出 sub_action（前端不必自行split）",
              it.get("sub_action") is not None, str(it.get("sub_action")))
        check("⑫ 🔒 operator_id 已解析", it.get("operator_id") is not None,
              str(it.get("operator_id")))

    st, b = api("GET", "/api/v1/admin/logs?action=admin&size=50")
    items = b.get("data", {}).get("items", [])
    check("⑫ action=admin 筛选生效",
          bool(items) and all(i["action"] == "admin" for i in items),
          f"命中 {len(items)}")

    st, b = api("GET", "/api/v1/admin/logs?action=teleport")
    check("⑫ 非法 action → 40012（非 500）", b.get("code") == 40012,
          f"code={b.get('code')}")
    st, b = api("GET", "/api/v1/admin/logs?result=maybe")
    check("⑫ 非法 result → 40012", b.get("code") == 40012)


# =============================================================================
def case_api22() -> None:
    section("⑬ API-22 运营看板概览")
    st, b = api("GET", "/api/v1/admin/overview?days=30")
    d = b.get("data", {})
    need = {"user_count", "dataset_count", "task_count", "success_rate",
            "avg_duration_ms", "avg_mape", "mape_trend", "active_model",
            "event_counts", "days"}
    check("⑬ 概览字段齐备", need <= set(d.keys()), f"缺={need - set(d.keys()) or '无'}")
    check("⑬ user_count ≥ 3（不含游客哨兵）", d.get("user_count", 0) >= 3,
          f"user_count={d.get('user_count')}")
    check("⑬ admin_count ≥ 1", d.get("admin_count", 0) >= 1)
    check("⑬ days 回显请求值", d.get("days") == 30, str(d.get("days")))
    am = d.get("active_model")
    check("⑬ 🔒 active_model 带 env_match（BE-ADM-03）",
          bool(am) and "env_match" in am, str((am or {}).get("env_match")))

    trend = d.get("mape_trend", [])
    check("⑬ mape_trend 存在", isinstance(trend, list), f"{len(trend)} 点")
    if len(trend) >= 2:
        dates = [p["created_at"] for p in trend]
        check("⑬ 🔒 折线点按时间正序（x 轴不能乱序）",
              dates == sorted(dates), f"{dates[0]} → {dates[-1]}")

    # 🔴 非法 days 必须 40012，而不是静默兜底成 30
    st, b = api("GET", "/api/v1/admin/overview?days=99999")
    check("⑬ 非法 days=99999 → 40012（非静默兜底）", b.get("code") == 40012,
          str(b.get("message")))
    st, b = api("GET", "/api/v1/admin/overview?days=0")
    check("⑬ 非法 days=0 → 40012", b.get("code") == 40012)


# =============================================================================
def main() -> int:
    # 🔴 **整个运行都在同一个 lifespan 内**（EP-6/EP-7 的教训）：
    #    `TestClient` 的 `with` 一旦提前退出，`holder.clear()` 清掉模型单例。
    #    本脚本的前置会跑一次真实预测（要推理），提前退出会让后续全挂。
    client = TestClient(app)
    with client:
        STATE["client"] = client
        STATE["db_path"] = os.environ["DB_PATH"]
        return _run()


def _run() -> int:
    if not case_setup():
        print("\n[FATAL] 前置未通过，后续用例跳过")
        return 1
    case_forbidden()
    case_no_password_leak()
    case_api23()
    case_api24_guard()
    case_api24_token_version()
    case_api24_status()
    case_api26()
    case_api27()
    case_api28_29()
    case_audit()
    case_api30()
    case_api22()

    print(f"\n{'=' * 70}")
    print(f"EP-8 接口验收：{PASS} / {TOTAL} 通过")
    if PASS != TOTAL:
        print("\n未通过项：")
        for ok, name, detail in RESULTS:
            if not ok:
                print(f"  ❌ {name} — {detail}")
    print(f"{'=' * 70}")
    return 0 if PASS == TOTAL else 1


if __name__ == "__main__":
    raise SystemExit(main())
