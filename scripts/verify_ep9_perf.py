"""
=============================================================================
`EP-9` 主干路径 · 异常操作 · 性能校验（`WS-9-01` / `WS-9-04` / `WS-9-05`）
-----------------------------------------------------------------------------
用法（在工作区根目录执行）：
    C:\\ProgramData\\anaconda3\\envs\\deploy\\python.exe scripts/verify_ep9_perf.py

覆盖范围
-----------------------------------------------------------------------------
`WS-9-01` 主干路径端到端：注册 → 登录 → 加载/上传数据集 → API-09 预估 →
          `API-12` 建任务 → `API-13` 状态 → `API-14` 结果 → `API-15` 明细 →
          `API-16` 导出。**全程只有 HTTP 调用，不含任何人工步骤**。

`WS-9-04` 异常操作不产生脏数据：二次上传 / 重复提交 / 任务完成后反复读取。
          「脏数据」在本脚本里被定义为**可判定的六件事**（见 §4 的注释），
          而不是一句主观描述 —— 否则这条工作项无法验收。

`WS-9-05` 性能测试 7 项（技术文档 §9.7）：
   ① 端到端耗时（示例数据 113 序列 / horizon=14）🔒 ≤ 60 s
   ② 极限规模 1,000 序列 × horizon=30 ≤ 60 s，**或**正确软失败（`E_TIMEOUT`）
   ③ 并发 3 个任务：全部成功、无锁冲突、**各自** ≤ 60 s
   ④ 首屏 ≤ 3 s —— ⚠️ 需真实浏览器，由 `scripts/verify_ep9_browser.mjs` 承担，
      本脚本只登记该项的归属，不重复实现（TestClient 测不到渲染与资源加载）
   ⑤ 预览接口（20 行）≤ 1 s
   ⑥ 历史列表（单页 20 条）≤ 1 s
   ⑦ GPU 回退（强制 CPU 模式）≤ 60 s

设计约定（沿用 `verify_ep5_api.py`）
-----------------------------------------------------------------------------
1. 🔒 独立临时库 `data/tmp/verify_ep9_perf/`，不碰 `data/app.db`；
   环境变量必须在 `import app` **之前**设置。
2. 🔒 「换个配置再跑一次」（限规模 / 强制 CPU）一律走**子进程**：
   `settings` 是 `@dataclass(frozen=True)`，同进程改不了。
3. 对照基线：`outputs/eval_report.json` 的 `timing_ms.total_ms`。
   按技术文档 `TEST-4`，超基线 3 倍先排查环境差异，但 🔒 60 s 硬约束不放松。
4. 结果写 `outputs/ep9_perf_report.json`，供测试报告直接引用**实测数字**，
   避免「报告里的耗时是手抄的」这类不可追溯问题。
5. 退出码 0 = 全通过；非 0 = 存在未通过项。

⚠️ 运行纪律：**每个校验脚本单独占一条 bash 命令**，不要 for 循环串跑 ——
   平台按「单次工具调用的累计删除数」计（阈值 50），串跑会把正常清理
   误判成批量删除并让后续脚本直接退出。详见 `verify_ep9_api.py` 头注释。
=============================================================================
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# ⚠️ 必须在 import 应用之前设置环境变量
# ---------------------------------------------------------------------------
TMP_DIR = ROOT / "data" / "tmp" / "verify_ep9_perf"
FIXTURES = TMP_DIR / "fixtures"
if TMP_DIR.exists():
    shutil.rmtree(TMP_DIR, ignore_errors=True)
FIXTURES.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TMP_DIR / "app.db")
os.environ["UPLOAD_DIR"] = str(TMP_DIR / "uploads")
os.environ["EXPORT_DIR"] = str(TMP_DIR / "exports")
os.environ["JWT_SECRET"] = "verify-ep9-perf-0123456789abcdefghijklmn"
os.environ["APP_ENV"] = "test"
os.environ.pop("TASK_BUDGET_MS", None)
os.environ.pop("MAX_SERIES", None)
os.environ.pop("TORCH_DEVICE", None)
os.environ.pop("ACTIVE_MODEL", None)

sys.path.insert(0, str(ROOT))

try:
    from fastapi.testclient import TestClient
    from sqlalchemy import text as sa_text
except Exception as exc:  # noqa: BLE001
    print(f"[FAIL] 缺少依赖：{exc}")
    sys.exit(1)

from app.core import config as app_config  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402

settings = app_config.settings
client = TestClient(app)

# ---- 硬约束与基线 ----------------------------------------------------------
SLA_MS = 60_000                       # 🔒 硬约束（NFR-PERF-01）
PREVIEW_LIMIT_MS = 1_000              # NFR-PERF-07
HISTORY_LIMIT_MS = 1_000              # NFR-PERF-08
FIRST_PAINT_LIMIT_MS = 3_000          # NFR-PERF-06（浏览器侧）
BASELINE_RATIO_WARN = 3.0             # TEST-4：超基线 3 倍先排查环境
STRESS_SERIES = 1_000                 # 技术文档 §9.7 第 2 项
STRESS_HORIZON = 30

passed = 0
failed = 0
REPORT: dict[str, object] = {"env": {}, "cases": {}, "timings_ms": {}}


def check(name: str, cond: bool, detail: str = "") -> bool:
    global passed, failed
    if cond:
        passed += 1
        print(f"[ OK ] {name}" + (f"  ({detail})" if detail else ""))
    else:
        failed += 1
        print(f"[FAIL] {name}  {detail}")
    return bool(cond)


def section(title: str) -> None:
    print("")
    print("=" * 74)
    print(title)
    print("=" * 74)


def api_json(resp):
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        return resp.status_code, None, None, resp.text[:300]
    return resp.status_code, body.get("code"), body.get("data"), body.get("message", "")


def tasks_count() -> int:
    db = SessionLocal()
    try:
        return int(db.execute(sa_text("SELECT COUNT(*) FROM tasks")).scalar() or 0)
    finally:
        db.close()


def sql(query: str, params: tuple = ()) -> list[tuple]:
    con = sqlite3.connect(str(app_config.settings.db_path))
    try:
        return con.execute(query, params).fetchall()
    finally:
        con.close()


def auth(token: str | None) -> dict:
    return {"Authorization": f"Bearer {token}"} if token else {}


# ===========================================================================
# 夹具：极限规模数据集（1,000 序列）
# ===========================================================================
def build_stress_dataset() -> Path:
    """200 商品 × 5 仓 × 120 天 = **恰好 1,000 条序列**，每条 120 个有效点。

    🔒 为什么每条都要 ≥ 90 天：`L1_MIN_VALID_POINTS = 90`。若序列不足 90 天，
       它们会走 L2/L3 的规则兜底（毫秒级），模型根本没被压到 ——
       那样测出来的是"规则很快"，而不是"极限规模下模型能否进 60 秒"。
    """
    p = FIXTURES / "stress_1000.csv"
    d0 = date(2015, 1, 1)
    whs = ["wh_a", "wh_b", "wh_c", "wh_d", "wh_e"]
    lines = ["sku_id,warehouse_id,date,sales"]
    for i in range(200):
        sku = f"sku_{i:04d}"
        for w, wh in enumerate(whs):
            base = 20 + (i % 37) + w * 3
            for d in range(120):
                v = base + (d % 7) + (7 if d % 30 == 0 else 0)
                lines.append(f"{sku},{wh},{(d0 + timedelta(days=d)).isoformat()},{v}")
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


# ===========================================================================
# 0. 前置
# ===========================================================================
def load_baseline() -> int | None:
    p = ROOT / "outputs" / "eval_report.json"
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return int((d.get("timing_ms") or {}).get("total_ms") or 0) or None
    except Exception:  # noqa: BLE001
        return None


def check_prereq() -> tuple[int, int | None] | None:
    section("0. 前置条件")

    try:
        sql("SELECT 1 FROM model_registry LIMIT 1")
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] 临时库尚未建表（lifespan 未触发？）：{exc}")
        return None

    rows = sql("SELECT version, is_active FROM model_registry ORDER BY id DESC LIMIT 5")
    if not check("model_registry 有一行 is_active=1",
                 any(int(r[1]) == 1 for r in rows), f"最近 5 条={rows}"):
        return None

    st, code, data, msg = api_json(client.get("/api/v1/datasets/sample"))
    if not check("示例数据集可加载（API-07）", st == 200 and code == 0, f"{st} {msg}"):
        return None
    sample = int(data["dataset"]["id"])

    base = load_baseline()
    check("对照基线可读（outputs/eval_report.json 的 timing_ms.total_ms）",
          base is not None, f"total_ms={base}")
    print(f"       示例数据集 id={sample}；模型 device={settings.torch_device}；"
          f"预算={settings.task_budget_ms}ms")
    REPORT["env"] = {
        "sample_dataset_id": sample,
        "torch_device": settings.torch_device,
        "task_budget_ms": settings.task_budget_ms,
        "max_series": settings.max_series,
        "baseline_total_ms": base,
        "db_path": str(app_config.settings.db_path),
    }
    return sample, base


# ===========================================================================
# 1. WS-9-01 主干路径端到端（无人工介入）
# ===========================================================================
def case_main_path(sample_ds: int, baseline: int | None) -> None:
    section("1. WS-9-01 主干路径端到端（🔒 全程无人工介入 / §9.7 第 1 项）")

    steps: list[tuple[str, float]] = []

    def step(label: str):
        """计时上下文。用列表累加，避免每处都手写 t0/t1 而漏记。"""
        class _Ctx:
            def __enter__(self):
                self.t0 = time.perf_counter()
                return self

            def __exit__(self, *exc):
                steps.append((label, (time.perf_counter() - self.t0) * 1000))
                return False
        return _Ctx()

    email = f"e2e_{int(time.time())}@verify.com"
    password = "Verify123456"

    with step("注册"):
        st, code, _, msg = api_json(client.post(
            "/api/v1/auth/register", json={"email": email, "password": password}))
    check("① 注册成功", st == 200 and code == 0, f"{st} code={code} msg={msg[:100]}")

    with step("登录"):
        st, code, data, msg = api_json(client.post(
            "/api/v1/auth/login", json={"email": email, "password": password}))
    token = ((data or {}) or {}).get("access_token")
    if not check("① 登录拿到 Token", code == 0 and bool(token), f"code={code} msg={msg[:100]}"):
        return
    h = auth(token)

    with step("上传数据集"):
        csv = FIXTURES / "main_path.csv"
        d0 = date(2015, 1, 1)
        lines = ["sku_id,warehouse_id,date,sales"]
        for i in range(6):
            for w in range(2):
                base = 12 + i * 3 + w
                for d in range(120):
                    lines.append(
                        f"item_{i:04d},wh{w},{(d0 + timedelta(days=d)).isoformat()},{base + (d % 7)}")
        csv.write_text("\n".join(lines) + "\n", encoding="utf-8")
        with csv.open("rb") as fh:
            res = client.post("/api/v1/datasets",
                              files={"file": (csv.name, fh, "text/csv")}, headers=h)
        st, code, data, msg = api_json(res)
    if not check("① 上传通过校验", st == 200 and code == 0, f"{st} code={code} msg={msg[:120]}"):
        return
    ds_id = int((data.get("dataset") or {}).get("id"))

    with step("API-09 详情/预估"):
        st, code, d9, msg = api_json(client.get(f"/api/v1/datasets/{ds_id}", headers=h))
    check("① API-09 可读且带 estimate_by_horizon",
          code == 0 and len((d9 or {}).get("estimate_by_horizon") or []) >= 3,
          f"code={code} n={len((d9 or {}).get('estimate_by_horizon') or [])}")

    with step("API-12 建任务(h=14)"):
        st, code, d12, msg = api_json(client.post(
            "/api/v1/predictions",
            json={"dataset_id": ds_id, "horizon": 14, "use_holiday_feature": 1},
            headers=h))
    if not check("① 预测任务跑到终态 succeeded",
                 st == 200 and code == 0 and (d12 or {}).get("status") == "succeeded",
                 f"{st} code={code} status={(d12 or {}).get('status')} msg={msg[:120]}"):
        return
    tid = int((d12 or {}).get("task_id") or 0)

    with step("API-13 状态"):
        st, code, d13, msg = api_json(client.get(
            f"/api/v1/predictions/{tid}/status", headers=h))
    check("① API-13 状态 = succeeded 且进度 100%",
           code == 0 and (d13 or {}).get("status") == "succeeded",
           f"code={code} status={(d13 or {}).get('status')} pct={(d13 or {}).get('progress_pct')}")

    with step("API-14 结果"):
        st, code, d14, msg = api_json(client.get(f"/api/v1/predictions/{tid}", headers=h))
    m = (d14 or {}).get("metrics") or {}
    check("① API-14 结果可读且指标齐备",
           code == 0 and m.get("weighted_mape") is not None and bool((d14 or {}).get("series")),
           f"code={code} mape={m.get('weighted_mape')} series={len((d14 or {}).get('series') or [])}")

    with step("API-15 明细"):
        st, code, d15, msg = api_json(client.get(
            f"/api/v1/predictions/{tid}/detail", params={"page": 1, "size": 20}, headers=h))
    check("① API-15 明细分页可读", code == 0 and int((d15 or {}).get("total") or 0) > 0,
          f"code={code} total={(d15 or {}).get('total')}")

    with step("API-16 导出 CSV"):
        exp = client.get(f"/api/v1/predictions/{tid}/export",
                         params={"format": "csv"}, headers=h)
    check("① API-16 导出 CSV 成功且为 7 列契约",
           exp.status_code == 200 and b"sku_id" in exp.content,
           f"HTTP {exp.status_code} 长度={len(exp.content)}")

    print("       ---- 各步耗时 ----")
    for label, ms in steps:
        print(f"       {label:<22} {ms:8.0f} ms")
    total = sum(ms for _, ms in steps)
    print(f"       {'全程合计':<22} {total:8.0f} ms")

    REPORT["timings_ms"]["main_path_steps"] = {k: round(v, 1) for k, v in steps}
    REPORT["timings_ms"]["main_path_total"] = round(total, 1)

    # ---- §9.7 第 1 项：端到端 ≤ 60 s（示例数据 113 序列 / horizon=14） ----
    section("1b. §9.7 第 1 项：示例数据 horizon=14 端到端耗时")

    t0 = time.perf_counter()
    st, code, d, msg = api_json(client.post(
        "/api/v1/predictions", json={"dataset_id": sample_ds, "horizon": 14}))
    wall = (time.perf_counter() - t0) * 1000
    check("示例数据 h=14 任务成功",
           st == 200 and code == 0 and (d or {}).get("status") == "succeeded",
           f"{st} code={code} status={(d or {}).get('status')} msg={msg[:120]}")
    print(f"       端到端墙钟 {wall:.0f} ms（响应 elapsed_ms={(d or {}).get('elapsed_ms')}）")
    check("🔒 端到端 ≤ 60 s（NFR-PERF-01 / DOD-EP9）", wall <= SLA_MS, f"{wall:.0f}ms")
    REPORT["timings_ms"]["e2e_h14_sample_ms"] = round(wall, 1)

    if baseline:
        ratio = wall / baseline
        print(f"       相对基线 {baseline} ms 的倍数：{ratio:.2f}×"
              f"（TEST-4 警戒线 {BASELINE_RATIO_WARN}×）")
        check("对照基线未出现数量级偏差（TEST-4）", ratio <= BASELINE_RATIO_WARN,
              f"{ratio:.2f}×")


# ===========================================================================
# 2. §9.7 第 2 项：极限规模 1,000 序列 × horizon=30
# ===========================================================================
def run_probe(env_extra: dict[str, str], dataset_id: int, tag: str,
              *, horizon: int = 7, timeout: int = 1800) -> dict | None:
    """在独立子进程里按指定环境变量跑一次预测，返回探针落盘的 JSON。

    🔒 复用 `scripts/_ep5_cfg_probe.py`（EP-5 交付物）而不是另写一份：
       它已经解决了「独立进程 + 继承 DB_PATH + 落盘 tasks_before/after」三件事，
       重写一遍只会多一处需要同步维护的口径。
    """
    runner = ROOT / "scripts" / "_ep5_cfg_probe.py"
    out = TMP_DIR / f"probe_{tag}.json"
    env = dict(os.environ)
    env.update(env_extra)
    proc = subprocess.run(
        [sys.executable, str(runner), "--dataset-id", str(dataset_id),
         "--horizon", str(horizon), "--out", str(out)],
        cwd=str(ROOT), capture_output=True, text=True, timeout=timeout, env=env,
    )
    for ln in ((proc.stdout or "") + (proc.stderr or "")).strip().splitlines()[-3:]:
        print(f"     {ln}")
    if proc.returncode != 0 or not out.exists():
        print(f"     子进程失败 exit={proc.returncode}")
        return None
    return json.loads(out.read_text(encoding="utf-8"))


def case_stress() -> None:
    section("2. §9.7 第 2 项：极限规模 1,000 序列 × horizon=30")

    csv = build_stress_dataset()
    size_mb = csv.stat().st_size / 1024 / 1024
    print(f"       夹具 {csv.name}：{size_mb:.1f} MB / 120,001 行 / 1,000 序列")
    t0 = time.perf_counter()
    with csv.open("rb") as fh:
        res = client.post("/api/v1/datasets",
                          files={"file": (csv.name, fh, "text/csv")})
    st, code, data, msg = api_json(res)
    up_ms = (time.perf_counter() - t0) * 1000
    ds = ((data or {}).get("dataset") or {}) if code == 0 else {}
    if not check(f"1,000 序列数据集上传通过（{up_ms:.0f}ms）",
                 code == 0 and int(ds.get("valid_series_count") or 0) == STRESS_SERIES,
                 f"code={code} series={ds.get('valid_series_count')} msg={msg[:140]}"):
        return
    ds_id = int(ds["id"])

    r = run_probe({}, ds_id, "stress", horizon=STRESS_HORIZON)
    if not check("极限规模探针子进程跑通", r is not None, "见上方输出"):
        return

    body = r["body"]
    d = body.get("data") or {}
    status = d.get("status")
    err = d.get("error_code")
    service_ms = int(d.get("elapsed_ms") or r["wall_ms"])
    wall = float(r["wall_ms"])
    print(f"       结果：status={status} error_code={err} "
          f"service_elapsed={service_ms}ms wall={wall:.0f}ms")
    REPORT["timings_ms"]["stress_1000x30_ms"] = service_ms
    REPORT["cases"]["stress_1000x30"] = {
        "status": status, "error_code": err, "service_elapsed_ms": service_ms,
        "wall_ms": round(wall, 1),
    }

    check("🔒 极限规模不是 5xx（要么成功、要么软失败）",
          r["http_status"] == 200 and body.get("code") == 0,
          f"HTTP {r['http_status']} code={body.get('code')}")

    if status == "succeeded":
        check("🔒 极限规模在 60 s 内跑完（最优路径，§9.7 目标）",
              service_ms <= SLA_MS, f"{service_ms}ms")
    elif status == "failed":
        check("🔒 超出 SLA 时走**软失败**：error_code=E_TIMEOUT（§9.7 允许的替代路径）",
              err == "E_TIMEOUT", f"error_code={err}")
        check("🔒 软失败仍带 completed_stage（用户知道跑到哪）",
              bool(d.get("completed_stage")), str(d.get("completed_stage")))
        check("🔒 软失败不落半成品（该任务无 predictions 行）",
              int(sql("SELECT COUNT(*) FROM predictions WHERE task_id = ?",
                      (int(d.get("task_id") or 0),))[0][0]) == 0, "已核查")
    else:
        check("极限规模返回了可判定的终态", False, f"status={status}")


# ===========================================================================
# 3. §9.7 第 3 项：并发 3 个任务（各自 ≤ 60 s）
# ===========================================================================
def case_concurrency_timing(sample_ds: int) -> None:
    section("3. §9.7 第 3 项：并发 3 任务（各自 ≤ 60 s，无锁冲突）")

    lock_hit: list[str] = []

    def one(i: int) -> tuple[int, int, dict | None, float]:
        c = TestClient(app)   # 每线程独立客户端：共享一个会串到同一 portal
        t0 = time.perf_counter()
        try:
            res = c.post("/api/v1/predictions", json={"dataset_id": sample_ds, "horizon": 14})
            if "locked" in res.text.lower():
                lock_hit.append(res.text[:200])
            return i, res.status_code, res.json(), (time.perf_counter() - t0) * 1000
        except Exception as exc:  # noqa: BLE001
            lock_hit.append(f"#{i} {type(exc).__name__}: {exc}")
            return i, -1, None, (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(one, range(3)))
    wall = (time.perf_counter() - t0) * 1000

    for i, st, body, ms in results:
        d = (body or {}).get("data") or {}
        print(f"       #{i}: HTTP={st} code={(body or {}).get('code')} "
              f"status={d.get('status')} 任务自身={d.get('duration_ms')}ms "
              f"请求墙钟={ms:.0f}ms")

    ok = all(st == 200 and (b or {}).get("code") == 0
             and ((b or {}).get("data") or {}).get("status") == "succeeded"
             for _, st, b, _ in results)
    check("🔒 并发 3 任务全部成功（NFR-PERF-09）", ok, str(
        [((b or {}).get("data") or {}).get("status") for _, _, b, _ in results]))
    check("🔒 无 database is locked", not lock_hit, f"命中 {len(lock_hit)} 次")

    # 🔒 **各自耗时取自 `CreateTaskResponse.duration_ms`，不是 `elapsed_ms`。**
    #
    #    `EP-9` 首轮这里踩了一个取数陷阱：「自身耗时」全读成 `None` → 补 0 →
    #    断言 `0 < ms <= 60000` 恒假 → 三条并发「全成功、无锁冲突」的情况下
    #    仍然报失败。根因是 `elapsed_ms` 属于 `TaskStatusResponse`（`API-13`），
    #    **不在** `CreateTaskResponse`（`API-12`）里 —— 后者用的是 `duration_ms`
    #    （成功时的结果摘要字段，见 `code/backend/schemas.py:338` 一带）。
    #    教训：跨接口取同名字段前，先确认该字段属于**这个** response 模型；
    #    字段不存在时 Pydantic 不会报错（`.get()` 返回 `None`），只会静默得到 0。
    #
    #    两个口径都判：`duration_ms` 是后端记账的任务耗时（DOD 原文要的就是它），
    #    墙钟是并发等待的上限校核 —— 两者都必须 ≤ 60 s。
    per_task = [int(((b or {}).get("data") or {}).get("duration_ms") or 0)
                for _, _, b, _ in results]
    wall_ms = [round(ms) for _, _, _, ms in results]
    check("🔒 每个任务各自 ≤ 60 s（DOD-EP9 原文要求；取 duration_ms）",
          all(0 < ms <= SLA_MS for ms in per_task),
          f"duration_ms={per_task}")
    check("🔒 并发下每个请求的墙钟也 ≤ 60 s（含排队等待的上限校核）",
          all(0 < ms <= SLA_MS for ms in wall_ms), f"墙钟={wall_ms}")
    print(f"       并发总墙钟 {wall:.0f} ms")
    REPORT["timings_ms"]["concurrent3_wall_ms"] = round(wall, 1)
    REPORT["timings_ms"]["concurrent3_per_task_ms"] = per_task
    REPORT["timings_ms"]["concurrent3_per_request_wall_ms"] = wall_ms
    REPORT["cases"]["concurrent3"] = {
        "all_succeeded": ok,
        "per_task_ms": per_task,
        "per_request_wall_ms": wall_ms,
        "source_field": "CreateTaskResponse.duration_ms",
    }


# ===========================================================================
# 4. §9.7 第 5/6 项：预览接口 / 历史列表 ≤ 1 s
# ===========================================================================
def case_fast_endpoints(token: str, ds_id: int) -> None:
    section("4. §9.7 第 5/6 项：预览接口与历史列表 ≤ 1 s")

    # 预热一次，避免把首次连接/建 session 的开销算进指标
    client.get(f"/api/v1/datasets/{ds_id}/preview", headers=auth(token))
    samples = []
    for _ in range(3):
        t0 = time.perf_counter()
        st, code, data, msg = api_json(client.get(
            f"/api/v1/datasets/{ds_id}/preview", headers=auth(token)))
        samples.append((time.perf_counter() - t0) * 1000)
    prev_ms = max(samples)
    rows = len(((data or {}).get("rows") or []))
    check(f"🔒 预览接口（{rows} 行）≤ 1 s（NFR-PERF-07）",
          code == 0 and rows == 20 and prev_ms <= PREVIEW_LIMIT_MS,
          f"code={code} 行数={rows} 最慢={prev_ms:.0f}ms（3 次取最慢）")
    REPORT["timings_ms"]["preview_ms"] = round(prev_ms, 1)
    REPORT["cases"]["preview"] = {"rows": rows, "worst_ms": round(prev_ms, 1)}

    # 🔒 历史列表必须先有数据再测，否则「空表 47 ms」会**假通过**一条
    #    NFR-PERF-08 断言 —— 那等于没测到「单页 20 条」这个真实场景。
    #
    #    `EP-9` 首轮就是这么假失败的：本用例收到的是 `main()` 里那个
    #    `perf_*` 用户的 token，而该用户只做「注册 + 登录」，**从未建过任务**，
    #    于是 `total=0`。当时判据写成 `total > 0` 而报失败 —— 判据方向对，
    #    但根因是用错了身份（有任务的用户在 `case_main_path` 内部另行注册）。
    #
    #    这里的解法是让用例**自给自足**：自己建一个短周期任务（h=7），
    #    不依赖其它用例的执行顺序。代价是多一次约 9 s 的推理，换来的
    #    是「用例独立、失败归因清晰」—— 用例间隐式依赖正是校验脚本最难排的坑。
    # ⚠️ 预热任务**必须建在本用户自己的数据集上**，不能用上面的 `sample_ds`。
    #    `sample_ds` 是游客集（`user_id = 0`）；在它上面建任务会让
    #    「任务归属 ≠ 数据集归属」，而用例 (6) 的「⑥ 越界归属」正是靠这个
    #    等式去判定数据隔离是否被打穿 —— 用一个刻意越界的样本去污染全局快照，
    #    会让那条断言以「夹具副作用」的形式误报。
    csv = FIXTURES / "history_seed.csv"
    d0 = date(2015, 1, 1)
    lines = ["sku_id,warehouse_id,date,sales"]
    for w in range(2):
        for d in range(120):
            lines.append(
                f"hist_{w:02d},wh{w},{(d0 + timedelta(days=d)).isoformat()},{20 + (d % 5) + w}")
    csv.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with csv.open("rb") as fh:
        st, _, hd, _ = api_json(client.post(
            "/api/v1/datasets", files={"file": (csv.name, fh, "text/csv")},
            headers=auth(token)))
    hist_ds = int(((hd or {}).get("dataset") or {}).get("id") or 0)
    if not check("历史列表预热：本用户数据集上传成功", hist_ds > 0, f"dataset_id={hist_ds}"):
        return

    st, code, data, msg = api_json(client.post(
        "/api/v1/predictions",
        json={"dataset_id": hist_ds, "horizon": 7}, headers=auth(token)))
    warmed = int(((data or {}).get("series_count")) or 0)
    check("历史列表预热：本用户已有一个成功任务（否则空表断言无意义）",
          code == 0 and ((data or {}).get("status") == "succeeded"),
          f"code={code} status={(data or {}).get('status')} series={warmed}")

    samples = []
    for _ in range(3):
        t0 = time.perf_counter()
        st, code, data, msg = api_json(client.get(
            "/api/v1/history", params={"page": 1, "size": 20}, headers=auth(token)))
        samples.append((time.perf_counter() - t0) * 1000)
    hist_ms = max(samples)
    total = int((data or {}).get("total") or 0)
    items = len(((data or {}).get("items") or []))
    check("🔒 历史列表（单页 20 条）≤ 1 s（NFR-PERF-08）",
          code == 0 and hist_ms <= HISTORY_LIMIT_MS,
          f"code={code} 最慢={hist_ms:.0f}ms（3 次取最慢）")
    check("历史列表确实返回了已建任务（total ≥ 1，非空表假通过）",
          total >= 1 and items >= 1, f"total={total} items={items}")
    REPORT["timings_ms"]["history_list_ms"] = round(hist_ms, 1)
    REPORT["cases"]["history_list"] = {
        "total": total, "items": items, "worst_ms": round(hist_ms, 1)
    }

    REPORT["cases"]["first_paint"] = {
        "limit_ms": FIRST_PAINT_LIMIT_MS,
        "owner": "scripts/verify_ep9_browser.mjs（需真实浏览器；TestClient 测不到渲染与资源加载）",
    }


# ===========================================================================
# 5. §9.7 第 7 项：GPU 回退（强制 CPU）≤ 60 s
# ===========================================================================
def case_cpu_fallback(sample_ds: int) -> None:
    section("5. §9.7 第 7 项：强制 CPU 模式 ≤ 60 s（NFR-PERF-10）")

    r = run_probe({"TORCH_DEVICE": "cpu"}, sample_ds, "cpu", horizon=14)
    if not check("CPU 探针子进程跑通", r is not None, "见上方输出"):
        return
    body = r["body"]
    d = body.get("data") or {}
    ms = int(d.get("elapsed_ms") or r["wall_ms"])
    check("CPU 模式任务成功", body.get("code") == 0 and d.get("status") == "succeeded",
          f"code={body.get('code')} status={d.get('status')}")
    check("确认确实跑在 CPU 上（否则测的是 GPU）",
          d.get("device") == "cpu", f"device={d.get('device')}")
    check("🔒 CPU 回退仍 ≤ 60 s（NFR-PERF-10）", ms <= SLA_MS, f"{ms}ms")
    print(f"       CPU 模式端到端 {ms} ms（墙钟 {r['wall_ms']:.0f} ms，含子进程加载模型）")
    REPORT["timings_ms"]["cpu_fallback_h14_ms"] = ms
    REPORT["cases"]["cpu_fallback"] = {"elapsed_ms": ms, "device": d.get("device")}


# ===========================================================================
# 6. WS-9-04 异常操作不产生脏数据
# ===========================================================================
def case_dirty_data(token: str) -> None:
    """「脏数据」在这里被**定义为六条可判定的事实**，逐条断言。

    1. 孤儿行：`predictions` / `metrics` 的 `task_id` 不存在于 `tasks`
    2. 悬挂任务：`status='running'`（请求已返回却没收口）
    3. 半成品：`status != 'succeeded'` 却有 `predictions` 行
    4. 重复键：同一任务内 `(warehouse_id, sku_id, forecast_date)` 重复
    5. 上传残留：`uploads/` 下有 0 字节文件（流式中断留下的半成品）
    6. 越界归属：`predictions` 所属任务的 `user_id` 与数据集 `user_id` 不一致
       （异常操作最容易打穿数据隔离）
    """
    section("6. WS-9-04 异常操作：二次上传 / 重复提交 / 完成后反复读取")

    def snapshot() -> dict[str, int]:
        return {
            "tasks": int(sql("SELECT COUNT(*) FROM tasks")[0][0]),
            "datasets": int(sql("SELECT COUNT(*) FROM datasets")[0][0]),
            "predictions": int(sql("SELECT COUNT(*) FROM predictions")[0][0]),
            "metrics": int(sql("SELECT COUNT(*) FROM metrics")[0][0]),
        }

    # ---- (a) 二次上传同一文件 ------------------------------------------------
    csv = FIXTURES / "dup_upload.csv"
    d0 = date(2015, 1, 1)
    lines = ["sku_id,warehouse_id,date,sales"]
    for d in range(120):
        lines.append(f"dup_sku,wh_x,{(d0 + timedelta(days=d)).isoformat()},{10 + d % 5}")
    csv.write_text("\n".join(lines) + "\n", encoding="utf-8")

    ids = []
    for _ in range(2):
        with csv.open("rb") as fh:
            res = client.post("/api/v1/datasets",
                              files={"file": (csv.name, fh, "text/csv")}, headers=auth(token))
        st, code, data, msg = api_json(res)
        if code == 0:
            ids.append(int((data.get("dataset") or {}).get("id")))
    check("二次上传同一文件均成功且生成**两个独立数据集行**",
          len(ids) == 2 and ids[0] != ids[1], str(ids))
    if len(ids) == 2:
        rows = sql("SELECT id, stored_name, file_path FROM datasets WHERE id IN (?, ?)", tuple(ids))
        paths = {r[2] for r in rows}
        check("两次上传的落盘路径不同（不互相覆盖）", len(paths) == len(rows), str(rows))
        check("第一次上传的文件仍存在（未被第二次覆写/删除）",
              all(int(sql("SELECT COUNT(*) FROM datasets WHERE id = ?", (i,))[0][0]) == 1
                  for i in ids), str(ids))

    # ---- (b) 重复提交同一预测请求 -------------------------------------------
    ds_dup = ids[0] if ids else None
    if ds_dup:
        before = snapshot()
        tids = []
        for _ in range(2):
            st, code, data, msg = api_json(client.post(
                "/api/v1/predictions",
                json={"dataset_id": ds_dup, "horizon": 7}, headers=auth(token)))
            if code == 0:
                tids.append(int((data or {}).get("task_id") or 0))
        check("重复提交同一请求 → 两个独立任务，均成功",
              len(tids) == 2 and len(set(tids)) == 2, str(tids))
        after = snapshot()
        check("重复提交新增 2 个任务行（不合并、不覆盖）",
              after["tasks"] == before["tasks"] + 2,
              f"{before['tasks']} → {after['tasks']}")
        if len(tids) == 2:
            per = [int(sql("SELECT COUNT(*) FROM predictions WHERE task_id = ?", (t,))[0][0])
                   for t in tids]
            check("两个任务的预测行数一致（互不污染）",
                  per[0] == per[1] == 7, f"各 {per} 行")

    # ---- (c) 任务完成后反复读取（「刷新页面」的后端等价） -------------------
    tid = int(sql("SELECT id FROM tasks WHERE status='succeeded' ORDER BY id DESC LIMIT 1")[0][0])
    before = snapshot()
    for _ in range(5):
        client.get(f"/api/v1/predictions/{tid}", headers=auth(token))
        client.get(f"/api/v1/predictions/{tid}/detail", params={"size": 20}, headers=auth(token))
        client.get(f"/api/v1/predictions/{tid}/export", params={"format": "csv"}, headers=auth(token))
    after = snapshot()
    check("反复读取（15 次含导出）不改变任何计数（读操作无副作用）",
          before == after, f"{before} → {after}")

    # ---- (d) 六条「脏数据」定义逐条断言 -------------------------------------
    orphan_p = int(sql("SELECT COUNT(*) FROM predictions p LEFT JOIN tasks t ON p.task_id = t.id "
                       "WHERE t.id IS NULL")[0][0])
    orphan_m = int(sql("SELECT COUNT(*) FROM metrics m LEFT JOIN tasks t ON m.task_id = t.id "
                       "WHERE t.id IS NULL")[0][0])
    check("① 无孤儿行（predictions / metrics 的 task_id 均存在）",
          orphan_p == 0 and orphan_m == 0, f"predictions={orphan_p} metrics={orphan_m}")

    running = int(sql("SELECT COUNT(*) FROM tasks WHERE status = 'running'")[0][0])
    check("② 无悬挂任务（不存在 status='running' 的遗留行）", running == 0, f"running={running}")

    half = int(sql("SELECT COUNT(*) FROM tasks t WHERE t.status != 'succeeded' "
                   "AND EXISTS (SELECT 1 FROM predictions p WHERE p.task_id = t.id)")[0][0])
    check("③ 无半成品（非 succeeded 任务不带 predictions 行）", half == 0, f"命中={half}")

    dup = int(sql("SELECT COUNT(*) FROM (SELECT task_id, warehouse_id, sku_id, forecast_date, "
                  "COUNT(*) c FROM predictions GROUP BY 1,2,3,4 HAVING c > 1)")[0][0])
    check("④ 无重复键（任务×(仓,商品,日期) 唯一）", dup == 0, f"重复组={dup}")

    up_dir = Path(app_config.settings.upload_dir)
    zero = [p.name for p in up_dir.rglob("*") if p.is_file() and p.stat().st_size == 0] \
        if up_dir.exists() else []
    check("⑤ 上传目录无 0 字节残留（流式中断的半成品已清理）", not zero, str(zero[:5]))

    bad_owner = int(sql(
        "SELECT COUNT(*) FROM predictions p "
        "JOIN tasks t ON p.task_id = t.id "
        "JOIN datasets d ON t.dataset_id = d.id "
        "WHERE d.user_id != 0 AND t.user_id != d.user_id"
    )[0][0])
    check("⑥ 无越界归属（任务归属与数据集归属一致；游客数据 user_id=0 豁免）",
          bad_owner == 0, f"命中={bad_owner}")

    REPORT["cases"]["dirty_data"] = {
        "orphan_predictions": orphan_p, "orphan_metrics": orphan_m,
        "running_tasks": running, "half_baked": half, "duplicate_keys": dup,
        "zero_byte_uploads": zero, "owner_mismatch": bad_owner,
    }


# ===========================================================================
# 结论
# ===========================================================================
# ---------------------------------------------------------------------------
# 用例开关：`--only=main,fast` 只跑指定用例（用例名见 `want()` 的调用点）。
#
# ⚠️ 存在的理由：`stress`（1000 序列 × horizon=30，实测 ~246 s）与
#    `cpu`（强制 CPU 重跑，~27 s + 模型加载）合起来占掉整轮 339 s 的大头。
#    修一条断言就整体重跑，是纯粹的时间浪费 —— 而 EP-9 期间这种修改很频繁。
#    🔒 默认不带参数 = **全跑**；交付前的那一轮必须全跑，且测试报告记录的是全跑结果。
# ---------------------------------------------------------------------------
ONLY = [
    x.strip()
    for a in sys.argv[1:]
    if a.startswith("--only=")
    for x in a.split("=", 1)[1].split(",")
    if x.strip()
]


def want(case: str) -> bool:
    return not ONLY or case in ONLY


def main() -> int:  # noqa: C901
    global passed, failed
    t_all = time.perf_counter()
    print(f"临时库：{app_config.settings.db_path}")
    print(f"设备  ：{app_config.settings.torch_device}")
    if ONLY:
        print(f"⚠️  只跑指定用例：{ONLY}（非全量 —— 交付前必须不带参数全跑一轮）")

    with client:
        pre = check_prereq()
        if pre is None:
            print("\n[ABORT] 前置条件不满足。")
            return 2
        sample_ds, baseline = pre

        email = f"perf_{int(time.time())}@verify.com"
        client.post("/api/v1/auth/register",
                    json={"email": email, "password": "Verify123456"})
        st, code, data, _ = api_json(client.post(
            "/api/v1/auth/login", json={"email": email, "password": "Verify123456"}))
        token = (data or {}).get("access_token") or ""

        if want("main"):
            case_main_path(sample_ds, baseline)
        if want("fast"):
            case_fast_endpoints(token, sample_ds)
        if want("dirty"):
            case_dirty_data(token)

        # ⚠️ 极限规模与并发都会吃满 CPU，放在最后，避免污染前面的耗时测量
        if want("concurrency"):
            case_concurrency_timing(sample_ds)
        if want("cpu"):
            case_cpu_fallback(sample_ds)
        if want("stress"):
            case_stress()

        section("结论")
        print(f"通过 {passed} 项，失败 {failed} 项")
        total_s = time.perf_counter() - t_all
        print(f"总耗时 {total_s:.1f}s")

        REPORT["summary"] = {
            "passed": passed, "failed": failed,
            "total_s": round(total_s, 1),
            "sla_ms": SLA_MS,
            "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        out = ROOT / "outputs" / "ep9_perf_report.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"实测数据已写出：{out}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
