"""
=============================================================================
`EP-5` 预测任务编排 · 端到端校验
-----------------------------------------------------------------------------
用法（在工作区根目录执行）：
    C:\\ProgramData\\anaconda3\\envs\\deploy\\python.exe scripts/verify_ep5_api.py

覆盖 `DOD-EP5` 里**必须真跑服务**才能判定的条目：

  ①  🔒 h=14 端到端 ≤ 60 s（且实测远低于预算）
  ②  🔒 五阶段耗时与 `eval_report.timing_ms` 同量级，推理段是**毫秒级**
  ③  🔒 超时软失败：压低预算 → `E_TIMEOUT` + completed_stage + 3 条建议，
      HTTP 仍 200、`code=0`（**不是 502/504**），且失败行可查到（`BE-16`）
  ④  🔒 强制 CPU（`TORCH_DEVICE=cpu`）与 GPU 预测值一致（数值容差内）
  ⑤  🔒 序列数超限 → `40004`，且 **tasks 行数不变**（`API-12-1`）
  ⑥  🔒 `API-13` 五阶段进度可观测（stage / stage_index / progress_pct）
  ⑦  🔒 半成品不落盘：失败任务的 `predictions` 表**无该任务行**
  ⑧  契约：`estimate_by_horizon` 单调递增；`TIMING_CONTRACT_KEYS` 口径对齐
  ⑨  🔒 游客链路：未登录可创建任务并查到状态（`FR-USR-08`）

设计约定（沿用 `verify_ep4_api.py`）
-----------------------------------------------------------------------------
1. 🔒 **用独立临时库与独立数据目录**，不碰 `data/app.db`
   校验会造出失败任务与临时导出，打在开发库上会污染演示数据。
   故脚本**最先**把 `DB_PATH / UPLOAD_DIR / EXPORT_DIR` 指向
   `data/tmp/verify_ep5/`，再 import 应用（config 在模块导入时读环境变量）。
2. ⚠️ **模型必须已注册**（`EP-2` 起 `data/models/` 有权重，且 `model_registry`
   有一行 `is_active=1`）。没注册会在 `assert_ready()` 处失败，
   那是 `EP-1/EP-2` 的问题，不是本脚本的问题 —— 脚本会明确报出来。
3. 🔒 `TORCH_DEVICE=cpu` 用**子进程**跑（`subprocess` + 独立 `DB_PATH`），
   不在同进程里改 `settings`：`model_holder` 是模块级单例，
   同进程二次加载会拿到已缓存的 GPU 句柄，得到「假一致」。
4. 退出码 0 = 全通过；非 0 = 存在未通过项。
=============================================================================
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# ⚠️ 必须在 import 应用之前设置环境变量（config 在模块导入时即读取）
# ---------------------------------------------------------------------------
TMP_DIR = ROOT / "data" / "tmp" / "verify_ep5"
if TMP_DIR.exists():
    shutil.rmtree(TMP_DIR, ignore_errors=True)
TMP_DIR.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TMP_DIR / "app.db")
os.environ["UPLOAD_DIR"] = str(TMP_DIR / "uploads")
os.environ["EXPORT_DIR"] = str(TMP_DIR / "exports")
os.environ["JWT_SECRET"] = "verify-ep5-secret-0123456789abcdefghijklmn"
os.environ["APP_ENV"] = "test"
# 预算保持默认 60 s（case③ 会用独立子进程压低）
os.environ.pop("TASK_BUDGET_MS", None)

sys.path.insert(0, str(ROOT))

try:
    from fastapi.testclient import TestClient
    from sqlalchemy import text as sa_text
except Exception as exc:  # noqa: BLE001
    print(f"[FAIL] 缺少依赖（fastapi / httpx / sqlalchemy）：{exc}")
    sys.exit(1)

from app.core import config as app_config            # noqa: E402
from app.core.db import SessionLocal                 # noqa: E402
from app.main import app                             # noqa: E402

settings = app_config.settings
client = TestClient(app)

passed = 0
failed = 0


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


def tasks_count() -> int:
    db = SessionLocal()
    try:
        return int(db.execute(sa_text("SELECT COUNT(*) FROM tasks")).scalar() or 0)
    finally:
        db.close()


def api_json(resp):
    """返回 `(http_status, code, data, message)`；非 JSON 时返回原始文本。"""
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        return resp.status_code, None, None, resp.text[:300]
    return (
        resp.status_code,
        body.get("code"),
        body.get("data"),
        body.get("message", ""),
    )


# ===========================================================================
# 0. 前置：模型已注册
# ===========================================================================
def check_prereq(client: TestClient) -> bool:
    section("0. 前置条件：模型已注册 + 示例数据集就位")

    # 🔴 必须用 `with client` 触发 lifespan（建库 + seed + 预加载模型）。
    #    直接 `TestClient(app)` 发请求不会跑 lifespan —— 表都不存在。
    #    （`verify_ep4_api.py` 踩过同一个坑，故此处写成硬断言。）
    db = SessionLocal()
    try:
        db.execute(sa_text("SELECT 1 FROM model_registry LIMIT 1"))
        has_table = True
    except Exception:
        has_table = False
    finally:
        db.close()
    if not has_table:
        print("[FAIL] 临时库尚未建表 —— lifespan 未触发。请确认用 `with TestClient(app)`。")
        return False

    db = SessionLocal()
    try:
        rows = db.execute(
            sa_text("SELECT version, is_active FROM model_registry ORDER BY id DESC LIMIT 5")
        ).fetchall()
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] 读 model_registry 失败：{exc}")
        return False
    finally:
        db.close()
    active = [r for r in rows if int(r[1]) == 1]
    ok = check("model_registry 有一行 is_active=1", bool(active), f"最近 5 条={rows}")
    if not ok:
        print("       → 请先跑 scripts/train_and_register.py（EP-2 交付物）")
        return ok

    # 示例数据集：/datasets/sample 是幂等接口，会自行造出示例数据集
    status, code, data, msg = api_json(client.get("/api/v1/datasets/sample"))
    if not check("示例数据集可加载（API-07 幂等）", status == 200 and code == 0, f"{status} {msg}"):
        return False
    print(f"       示例数据集 id={data['dataset']['id']} 序列数={data['dataset'].get('series_count')}")
    return True


# ===========================================================================
# ① 端到端 ≤ 60 s（游客态）
# ===========================================================================
def case_end_to_end() -> dict | None:
    section("① 端到端：游客态创建任务并跑到终态（DOD 第 1 条 🔒 60 s）")

    status, code, data, msg = api_json(client.get("/api/v1/datasets/sample"))
    if not check("① GET /datasets/sample（游客）", status == 200 and code == 0, f"{status} {msg}"):
        return None
    dataset_id = int(data["dataset"]["id"])
    print(f"       示例数据集 id={dataset_id} 序列数={data['dataset'].get('series_count')}")

    # 🔴 口径：estimate_by_horizon 挂在 **API-09**（GET /datasets/{id}），
    #    不在 API-07（/sample 的上传响应）里 —— 后者的契约是
    #    UploadDatasetResponse{dataset, preview, series_count, ...}，无耗时预估。
    st9, c9, d9, m9 = api_json(client.get(f"/api/v1/datasets/{dataset_id}"))
    if not check("① GET /datasets/{id}（API-09 详情）", st9 == 200 and c9 == 0, f"{st9} {m9}"):
        return None
    est_list = (d9 or {}).get("estimate_by_horizon") or []
    ok_est = check(
        "① API-09 返回 estimate_by_horizon（参数页预估口径）",
        len(est_list) >= 3,
        f"档数={len(est_list)}",
    )
    if ok_est and len(est_list) >= 2:
        ms = [int(e["estimated_ms"]) for e in est_list]
        check(
            "① estimate_by_horizon 随步长单调递增",
            all(a < b for a, b in zip(ms, ms[1:])),
            f"{[e['horizon'] for e in est_list]} → {ms}",
        )
    # 🔴 口径分离：单遍 estimated_ms（评测基准）与 estimate_by_horizon（端到端预估）
    #    **并列存在**，参数页必须用后者，否则会显示「预估 7.9 s、实际 8.6 s」。
    d9 = d9 or {}
    check(
        "① API-09 单遍 estimated_ms 与 estimate_by_horizon 并列共存（QD-06 同型口径分离）",
        "estimated_ms" in d9 and ok_est,
        f"estimated_ms={d9.get('estimated_ms')}（单遍评测基准）"
        f" / estimate_by_horizon={est_list}（端到端预估）",
    )
    check(
        "① API-09 含序列分级预判（参数页右栏数据源）",
        "level_preview" in d9,
        f"level_preview keys={sorted((d9.get('level_preview') or {}).keys())}",
    )

    t0 = time.perf_counter()
    resp = client.post(
        "/api/v1/predictions",
        json={"dataset_id": dataset_id, "horizon": 14, "task_name": "EP5 校验"},
    )
    wall = (time.perf_counter() - t0) * 1000
    status, code, data, msg = api_json(resp)

    if not check("① POST /predictions（游客，未登录）", status == 200 and code == 0, f"{status} {msg}"):
        return None
    check("① 响应即终态（无 queued，同步语义）", data["status"] == "succeeded", f"status={data['status']}")
    check(
        "① 🔒 端到端耗时 ≤ 60 s 硬预算",
        data["duration_ms"] <= settings.task_budget_ms,
        f"duration_ms={data['duration_ms']} / 预算={settings.task_budget_ms}，"
        f"客户端实测 wall={wall:.0f}ms",
    )
    check(
        "① 🔒 远低于预算（留足余量，非擦线通过）",
        data["duration_ms"] < settings.task_budget_ms * 0.6,
        f"占用预算 {data['duration_ms'] / settings.task_budget_ms:.1%}",
    )

    task_id = int(data["task_id"])
    cov = data.get("coverage") or {}
    print(
        f"       task_id={task_id} mape={data.get('mape')} device={data.get('device')} "
        f"coverage={cov} duration={data['duration_ms']}ms"
    )
    # ⚠️ 键名是**大写** L1/L2/L3：与 algo/classify.coverage_report、前端 types.ts、
    #    原型 params.html 四处同名同源（见 schemas.LevelPreview 的说明）。
    check(
        "① 覆盖率三项之和 == total（UX-AC-06）",
        cov.get("L1", 0) + cov.get("L2", 0) + cov.get("L3", 0) == cov.get("total"),
        f"{cov}",
    )
    check("① 推理设备已披露", data.get("device") in ("cuda", "cpu"), f"device={data.get('device')}")

    # ② 五阶段耗时与 eval_report 同量级 + 推理段毫秒级
    timing = data.get("timing") or {}
    stages = timing.get("stages") or {}
    check(
        "② 🔒 响应回带真实分段耗时（同步语义下前端拿不到 task_id 轮询）",
        bool(stages),
        f"timing keys={sorted(timing)[:8]}",
    )
    if stages:
        print(f"       stages(单遍)={stages}")
        # eval_report.timing_ms 是单遍口径，可直接比量级
        report = json.loads((ROOT / "outputs" / "eval_report.json").read_text(encoding="utf-8"))
        r_timing = report.get("timing_ms", {})
        for key in ("preprocess_ms", "features_ms", "inference_ms", "metrics_ms"):
            a, b = stages.get(key), r_timing.get(key)
            if a is None or b is None:
                continue
            # 同量级：比值落在 0.2 ~ 5.0 视为同量级
            ratio = a / b if b else float("inf")
            check(
                f"② {key} 与 eval_report.timing_ms 同量级",
                0.2 <= ratio <= 5.0,
                f"任务={a}ms 单遍评测={b}ms 比值={ratio:.2f}",
            )
        # 🔒 推理段（批量前向本身）必须是毫秒级，不是秒级 —— 60s SLA 的关键。
        #    注意读 `stages["inference"]`（单遍分段表）而不是 `timing["inference_ms"]`
        #    （后者是任务两遍的汇总，口径不同）。
        check(
            "② 🔒 批量前向 inference 段是毫秒级（< 1000ms，非秒级）",
            int(stages.get("inference", 999999)) < 1000,
            f"stages.inference={stages.get('inference')}ms"
            f"（对照 rolling_ms={timing.get('rolling_ms')}ms 才是大头）",
        )
        # 滚动多步是大头，必须单独可见（否则「哪段最贵」无从判断）
        check(
            "② 滚动多步耗时已单独埋点（EP-5 新增）",
            "rolling_ms" in timing and "fallback_ms" in timing,
            f"rolling={timing.get('rolling_ms')} fallback={timing.get('fallback_ms')}",
        )
        algo = timing.get("algorithm") or {}
        check(
            "② 🔒 两遍流水线耗时都上报（单遍数字只反映一半成本）",
            "backtest_pass_ms" in algo and "forecast_pass_ms" in algo,
            f"algorithm={algo}",
        )

    # ⑥ API-13 进度可观测
    st, c2, d2, m2 = api_json(client.get(f"/api/v1/predictions/{task_id}/status"))
    check(
        "⑥ 🔒 GET /predictions/{id}/status（游客可查）",
        st == 200 and c2 == 0,
        f"{st} {m2}",
    )
    if d2:
        check(
            "⑥ 五阶段进度可观测：stage=metrics / stage_index=5 / progress=100",
            d2["stage"] == "metrics" and d2["stage_index"] == 5 and d2["progress_pct"] == 100,
            f"stage={d2.get('stage')} idx={d2.get('stage_index')} pct={d2.get('progress_pct')}",
        )
        check(
            "⑥ 🔒 预算字段随响应下发（前端时间轴刻度）",
            d2.get("budget_ms") == settings.task_budget_ms,
            f"budget_ms={d2.get('budget_ms')}",
        )
        check(
            "⑥ 设备信息随状态返回（UX-P07 披露 GPU→CPU 回退）",
            d2.get("device") in ("cuda", "cpu") and "device_fallback" in d2,
            f"device={d2.get('device')} fallback={d2.get('device_fallback')}",
        )

    # ⑦ 成功任务必须落盘 predictions
    db = SessionLocal()
    try:
        n_pred = int(
            db.execute(
                sa_text("SELECT COUNT(*) FROM predictions WHERE task_id = :t"), {"t": task_id}
            ).scalar()
            or 0
        )
        has_metrics = int(
            db.execute(
                sa_text("SELECT COUNT(*) FROM metrics WHERE task_id = :t"), {"t": task_id}
            ).scalar()
            or 0
        )
    finally:
        db.close()
    check("⑦ 成功任务的预测结果已落盘", n_pred > 0, f"predictions 行数={n_pred}")
    check("⑦ 成功任务的指标已落盘", has_metrics > 0, f"metrics 行数={has_metrics}")

    return {"task_id": task_id, "dataset_id": dataset_id, "data": data}


# ===========================================================================
# ③ 超时软失败（独立子进程，压低预算）
# ===========================================================================
def run_cfg_probe(env_extra: dict[str, str], dataset_id: int, tag: str) -> dict | None:
    """在独立子进程里按指定环境变量跑一次预测，落盘响应供断言。

    🔴 `settings` 是 `@dataclass(frozen=True)`，同进程改不了；
       「换个配置再跑一次」只能靠另起进程（config 在 import 时读环境变量）。
    """
    runner = ROOT / "scripts" / "_ep5_cfg_probe.py"
    out = TMP_DIR / f"probe_{tag}.json"
    if not runner.exists():
        check(f"③ 配置探针脚本存在（{tag}）", False, f"缺少 {runner.name}")
        return None
    env = dict(os.environ)
    env.update(env_extra)
    proc = subprocess.run(
        [sys.executable, str(runner), "--dataset-id", str(dataset_id), "--out", str(out)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=600,
        env=env,
    )
    tail = ((proc.stdout or "") + (proc.stderr or "")).strip().splitlines()
    for ln in tail[-4:]:
        print(f"     {ln}")
    if proc.returncode != 0 or not out.exists():
        print(f"     子进程失败 exit={proc.returncode}")
        return None
    return json.loads(out.read_text(encoding="utf-8"))


# ===========================================================================
# ③ 超时软失败（独立子进程，压低预算）
# ===========================================================================
def case_soft_failure(dataset_id: int) -> None:
    section("③ 超时软失败：TASK_BUDGET_MS=1 → E_TIMEOUT（独立子进程）")

    r = run_cfg_probe({"TASK_BUDGET_MS": "1"}, dataset_id, "timeout")
    if r is None or not check("③ 探针子进程跑通", True, f"预算={r and r['settings']['task_budget_ms']}"):
        return

    status = r["http_status"]
    body = r["body"]
    code = body.get("code")
    data = body.get("data") or {}

    check(
        "③ 🔒 超预算返回 HTTP 200（不是 502/504 —— API-12-2）",
        status == 200,
        f"HTTP {status}",
    )
    check("③ 🔒 code 仍为 0（软失败不是协议错误）", code == 0, f"code={code}")
    check("③ status=failed", data.get("status") == "failed", f"status={data.get('status')}")
    check(
        "③ 🔒 error_code=E_TIMEOUT",
        data.get("error_code") == "E_TIMEOUT",
        f"got={data.get('error_code')}",
    )
    check(
        "③ 🔒 completed_stage 给出已完成阶段（用户知道跑到哪）",
        bool(data.get("completed_stage")),
        f"completed_stage={data.get('completed_stage')}",
    )
    sugs = data.get("suggestions") or []
    check("③ 🔒 给出 3 条处置建议（UX-P07-05）", len(sugs) == 3, f"条数={len(sugs)}")
    for sv in sugs:
        print(f"       · {sv[:96]}")

    err_msg = data.get("error_msg") or ""
    print(f"       error_msg={err_msg[:140]}")
    check(
        "③ 🔒 预算文案不自相矛盾（1 毫秒预算不得显示成「0 秒」）",
        "0 秒预算" not in err_msg,
        f"error_msg={err_msg[:120]}",
    )

    # BE-16：失败行必须可查（「复现得了但查不到」是 EP-4 踩过的坑）
    check(
        "③ 🔒 失败任务已落库（BE-16 显式 commit，否则被 get_db rollback）",
        r["tasks_after"] == r["tasks_before"] + 1,
        f"tasks {r['tasks_before']} → {r['tasks_after']}",
    )
    failed_task_id = data.get("task_id")
    if failed_task_id:
        db = SessionLocal()
        try:
            n_pred = int(
                db.execute(
                    sa_text("SELECT COUNT(*) FROM predictions WHERE task_id = :t"),
                    {"t": int(failed_task_id)},
                ).scalar()
                or 0
            )
            n_met = int(
                db.execute(
                    sa_text("SELECT COUNT(*) FROM metrics WHERE task_id = :t"),
                    {"t": int(failed_task_id)},
                ).scalar()
                or 0
            )
            st_row = db.execute(
                sa_text("SELECT status, error_code FROM tasks WHERE id = :t"),
                {"t": int(failed_task_id)},
            ).fetchone()
        finally:
            db.close()
        check(
            "⑦ 🔒 半成品不落盘：失败任务无 predictions / metrics 行",
            n_pred == 0 and n_met == 0,
            f"predictions={n_pred} metrics={n_met}",
        )
        check(
            "③ 🔒 tasks 行记录了 failed + E_TIMEOUT（前端据此渲染失败卡）",
            st_row is not None and str(st_row[0]) == "failed" and st_row[1] == "E_TIMEOUT",
            f"status={st_row[0] if st_row else None} error_code={st_row[1] if st_row else None}",
        )


# ===========================================================================
# ⑤ 序列数超限 → 40004 且不建行
# ===========================================================================
def case_series_limit(dataset_id: int) -> None:
    section("⑤ 序列数超限：MAX_SERIES=10 → 40004 且 tasks 行数不变（API-12-1 🔒）")

    r = run_cfg_probe({"MAX_SERIES": "10"}, dataset_id, "limit")
    if r is None or not check("⑤ 探针子进程跑通", True, f"上限={r and r['settings']['max_series']}"):
        return

    status = r["http_status"]
    body = r["body"]
    msg = str(body.get("message") or "")

    # 🔴 口径同 ⑧：业务错误是 HTTP 200 + code（见 errors.py 的处理器）
    check(
        "⑤ 🔒 超限不是 HTTP 5xx（业务错误走 200 + code）",
        status == 200,
        f"HTTP {status}",
    )
    check("⑤ 🔒 错误码 40004", body.get("code") == 40004, f"code={body.get('code')}")
    check(
        "⑤ 提示语含可操作指引（先筛选商品再重传）",
        "筛选" in msg,
        f"message={msg[:130]}",
    )
    check(
        "⑤ 🔒 tasks 行数不变（预检在前，不建注定失败的任务行）",
        r["tasks_after"] == r["tasks_before"],
        f"{r['tasks_before']} → {r['tasks_after']}",
    )


# ===========================================================================
# ⑧ 契约与参数校验
# ===========================================================================
def case_contract(dataset_id: int) -> None:
    """🔴 错误契约口径：**HTTP 200 + body.code**（除 401 类），这是本项目自 EP-2 起
    的既定契约（见 `app/core/errors.py::register_exception_handlers`），
    **不是** RESTful 的 4xx/5xx。

    这一点非常容易判错：按 RESTful 直觉写 `assert status == 400` 会全假失败，
    而真正的红线恰恰是「软失败不得退化成 5xx」（`API-12-2`）。
    """
    section("⑧ 参数校验与错误契约（HTTP 200 + code 口径）")

    cases = [
        ("非法步长 horizon=99", {"dataset_id": dataset_id, "horizon": 99}, 40012),
        ("不存在的数据集 999999", {"dataset_id": 999999, "horizon": 7}, 40402),
        ("非法节假日开关 use_holiday_feature=5",
         {"dataset_id": dataset_id, "horizon": 7, "use_holiday_feature": 5}, 40012),
    ]
    for label, body, want in cases:
        st, code, _, msg = api_json(client.post("/api/v1/predictions", json=body))
        check(
            f"⑧ {label} → {want}",
            code == want,
            f"HTTP {st} code={code}（期望 {want}）message={msg[:80]}",
        )

    st, code, _, _ = api_json(client.get("/api/v1/predictions/999999/status"))
    check(
        "⑧ 不存在的任务 → 40401",
        code == 40401,
        f"HTTP {st} code={code}（期望 40401）",
    )

    # 🔴 业务错误一律 HTTP 200：若哪天变成 400/404，说明契约被破坏
    check(
        "⑧ 🔒 业务错误不是 HTTP 4xx/5xx（统一 200 + code 契约）",
        st == 200,
        f"HTTP {st}；若为 4xx/5xx 说明 errors.py 的处理器被改坏",
    )

    # 🔴 任务名长度契约：**后端 `max_length=64`、前端 `maxlength=40`**。
    #    这是有意的「后端略宽于前端」：前端拦用户输入，后端拦 API 滥用，
    #    两者不能对齐到同一个值 —— 对齐后改前端约束就得动接口契约。
    #    故此处断言的是「后端有上限」而非「超限被裁剪」。
    st, code, _, msg = api_json(
        client.post(
            "/api/v1/predictions",
            json={"dataset_id": dataset_id, "horizon": 7, "task_name": "长" * 80},
        )
    )
    check(
        "⑧ 超长任务名（80 字 > 后端上限 64）被拒 → 40012",
        code == 40012,
        f"code={code}（期望 40012）message={msg[:70]}",
    )

    # 前端 64 字以内应被接受，并落库为 ≤64 字
    st2, code2, data2, _ = api_json(
        client.post(
            "/api/v1/predictions",
            json={"dataset_id": dataset_id, "horizon": 7, "task_name": "短" * 40},
        )
    )
    check("⑧ 合规任务名（40 字）被接受", code2 == 0, f"code={code2}")


# ===========================================================================
# ⑨ 游客隔离（BE-41）
# ===========================================================================
def case_guest_isolation() -> None:
    """游客归属（user_id=0）与越权保护（BE-41）。"""
    section("⑨ 游客归属与越权保护（FR-USR-08 / BE-41）")

    db = SessionLocal()
    try:
        rows = db.execute(
            sa_text(
                "SELECT user_id, COUNT(*) FROM tasks GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 3"
            )
        ).fetchall()
        guest_task = db.execute(
            sa_text("SELECT id FROM tasks WHERE user_id = 0 ORDER BY id DESC LIMIT 1")
        ).fetchone()
    finally:
        db.close()

    check("⑨ 🔒 游客任务归属 user_id=0（游客哨兵）", any(int(r[0]) == 0 for r in rows),
          f"user_id 分布={rows}")
    if not guest_task:
        check("⑨ 存在游客任务可供越权测试", False, "前面的用例没有造出游客任务")
        return

    # ⚠️ `API-01` 注册返回的是 `RegisterResponse{user_id, email}`，**不含 token**；
    #    必须再调一次 `API-02` 登录才拿得到 JWT（踩过：直接取 access_token 得 None）。
    email = "ep5probe@salesforecast.cn"
    pwd = "Probe@2026x"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": pwd, "nickname": "探针"},
    )
    login = client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    body = login.json()
    token = (body.get("data") or {}).get("access_token")
    if not check("⑨ 探针账号可登录（用于越权测试）", bool(token),
                 f"HTTP {login.status_code} code={body.get('code')} msg={str(body.get('message'))[:80]}"):
        return

    auth = {"Authorization": f"Bearer {token}"}

    # 🔒 登录用户不得读到游客任务
    # ⚠️ 口径已于 EP-9 收敛：越权（资源存在但不属于你）返回 `40301` 而非 `40401`
    #    —— PRD `NFR-SEC-05`（P0）「越权返回 403 而非 404」，
    #    且与 `datasets` / `history/compare` 的既有实现对齐。
    #    `40401` 现在只表示「真的不存在」或「已软删除」。
    tid = int(guest_task[0])
    st, code, _, msg = api_json(client.get(f"/api/v1/predictions/{tid}/status", headers=auth))
    check(
        "⑨ 🔒 登录用户读他人（游客）任务 → 40301（NFR-SEC-05）",
        code == 40301,
        f"HTTP {st} code={code}（期望 40301）message={msg[:70]}",
    )

    # 反面对照：不带 token 应当能查到（证明上一条不是因为接口坏了）
    st2, code2, data2, _ = api_json(client.get(f"/api/v1/predictions/{tid}/status"))
    check(
        "⑨ 反面对照：游客本人（无 token）能查到该任务",
        code2 == 0 and data2 is not None,
        f"HTTP {st2} code={code2}",
    )


# ===========================================================================
# ④ 强制 CPU 与 GPU 一致（两个独立子进程各跑一份）
# ===========================================================================
def case_cpu_parity() -> None:
    """🔒 DOD 第 4 条：强制 CPU 的结果与 GPU 一致。

    🔴 **为什么必须两个独立进程**：`model_holder.holder` 是模块级单例，
       同进程里改 `TORCH_DEVICE` 再加载会命中已缓存的 GPU 句柄，
       比对结果必然「一致」—— 那是假通过。

    🔴 **比对的是逐点预测值而非指标**：指标四舍五入会掩盖 1e-6 级浮点差异。
    """
    section("④ 强制 CPU（TORCH_DEVICE=cpu）与 GPU 结果一致（DOD 第 4 条 🔒）")

    runner = ROOT / "scripts" / "_ep5_parity_run.py"
    if not runner.exists():
        check("④ 双进程比对脚本存在", False, f"缺少 {runner.name}")
        return

    cpu_out = TMP_DIR / "parity_cpu.json"
    gpu_out = TMP_DIR / "parity_cuda.json"

    def run(device: str, out: Path) -> bool:
        proc = subprocess.run(
            [sys.executable, str(runner), "--device", device, "--out", str(out),
             "--horizon", "14"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=1800,
        )
        tail = ((proc.stdout or "") + (proc.stderr or "")).strip().splitlines()
        print(f"---- {device} 进程输出（末 5 行）----")
        for ln in tail[-5:]:
            print(f"     {ln}")
        return proc.returncode == 0 and out.exists()

    ok_cpu = run("cpu", cpu_out)
    if not check("④ CPU 进程推理成功", ok_cpu):
        return
    ok_gpu = run("cuda", gpu_out)
    if not check("④ CUDA 进程推理成功", ok_gpu):
        print("       （无 GPU 时本条无法验证，属环境限制而非代码缺陷）")
        return

    cpu = json.loads(cpu_out.read_text(encoding="utf-8"))
    gpu = json.loads(gpu_out.read_text(encoding="utf-8"))

    check(
        "④ 两个进程确实落在不同设备上（否则比对无意义）",
        cpu.get("actual_device") == "cpu" and gpu.get("actual_device") == "cuda",
        f"cpu 进程={cpu.get('actual_device')} / cuda 进程={gpu.get('actual_device')}",
    )
    check(
        "④ 同一模型版本（否则比的是两个不同模型）",
        cpu.get("model_version") == gpu.get("model_version"),
        f"cpu={cpu.get('model_version')} cuda={gpu.get('model_version')}",
    )

    fa, fb = cpu.get("forecasts", {}), gpu.get("forecasts", {})
    common = sorted(set(fa) & set(fb))
    if not check("④ 两侧序列集合可对齐", bool(common), f"cpu={len(fa)} cuda={len(fb)} 交集={len(common)}"):
        return
    only_cpu = sorted(set(fa) - set(fb))
    only_gpu = sorted(set(fb) - set(fa))
    check(
        "④ 🔒 序列集合逐项相同（不得一侧多、一侧少）",
        not only_cpu and not only_gpu,
        f"仅 cpu 有={only_cpu[:3]} 仅 cuda 有={only_gpu[:3]}",
    )

    n = 0
    worst_abs = 0.0
    worst_rel = 0.0
    worst_at = ""
    len_mismatch: list[str] = []
    for key in common:
        va, vb = fa[key], fb[key]
        if len(va) != len(vb):
            len_mismatch.append(f"{key}:{len(va)}vs{len(vb)}")
            continue
        for i, (x, y) in enumerate(zip(va, vb)):
            d = abs(x - y)
            n += 1
            if d > worst_abs:
                worst_abs = d
                worst_at = f"{key}[{i}] {x} vs {y}"
            denom = max(abs(x), abs(y), 1e-9)
            worst_rel = max(worst_rel, d / denom)
    check("④ 每条序列预测点数一致", not len_mismatch, "; ".join(len_mismatch[:3]))

    REL_TOL = 1e-4
    ABS_TOL = 1e-3
    check(
        "④ 🔒 预测值逐点一致（相对误差 ≤ 1e-4 且绝对误差 ≤ 1e-3）",
        n > 0 and worst_rel <= REL_TOL and worst_abs <= ABS_TOL,
        f"比对 {n} 点，最大绝对差={worst_abs:.3e} 最大相对差={worst_rel:.3e}"
        + (f"（{worst_at}）" if worst_at else ""),
    )
    print(
        f"       CPU  weighted_mape={cpu.get('weighted_mape')}  "
        f"CUDA weighted_mape={gpu.get('weighted_mape')}"
    )
    check(
        "④ 加权 MAPE 两设备一致（相对误差 ≤ 1e-3）",
        isinstance(cpu.get("weighted_mape"), (int, float))
        and isinstance(gpu.get("weighted_mape"), (int, float))
        and abs(cpu["weighted_mape"] - gpu["weighted_mape"])
        / max(abs(cpu["weighted_mape"]), 1e-9) <= 1e-3,
        f"cpu={cpu.get('weighted_mape')} cuda={gpu.get('weighted_mape')}",
    )


# ===========================================================================
def main() -> int:
    print("=" * 74)
    print("EP-5 端到端校验（DOD-EP5）")
    print(f"临时库：{TMP_DIR}")
    print("=" * 74)

    # 🔴 `with client` 是硬要求：不触发 lifespan 就不会建库 / seed / 预加载模型
    with client:
        if not check_prereq(client):
            print("\n前置条件不满足，无法继续。")
            return 1

        ctx = case_end_to_end()
        if ctx is None:
            print("\n端到端用例未跑通，后续用例跳过（避免连锁误报）。")
            return 1

        ds_id = int(ctx["dataset_id"])
        case_soft_failure(ds_id)
        case_series_limit(ds_id)
        case_contract(ds_id)
        case_guest_isolation()

    # ④ 双进程比对放在 lifespan 之外：子进程各自建自己的连接，
    #    与本进程的模型单例互不干扰。
    case_cpu_parity()

    section("结论")
    print(f"通过 {passed} 项，失败 {failed} 项")
    print("临时目录保留于：" + str(TMP_DIR))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())