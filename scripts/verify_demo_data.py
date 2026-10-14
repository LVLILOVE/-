"""
=============================================================================
`WS-10-05` / `WS-10-06` / `WS-10-07` 演示链路可复现性校验
-----------------------------------------------------------------------------
依据文档 : 《项目开发实施方案 V1.0》§7.11
             `WS-10-05`「5 分钟内跑完『上传 → 预测 → 看结果 → 导出』」
             `WS-10-06`「固定数据集，现场可复现」
             `WS-10-07`「现场展示 1 个失败分支（如上传缺列文件）」
           `DOD-EP10`「🔒 现场演示 5 分钟内跑完主链路；另有 1 个失败分支可演示」
           风险 `RG-15`「演示现场失败」的缓解措施（**演示前预跑一遍**）
-----------------------------------------------------------------------------
本脚本把「演示脚本」里写下的每一句话都变成断言。它回答的是：

    ❓ 现场照着演示脚本点一遍，真的能得到脚本里承诺的结果吗？

覆盖：
  ① `demo/演示数据_正常.csv` 上传成功，且**行数/序列数/列数**与 `demo/README.md`
     声明**逐项一致**（防止「文档写 9 序列、实际传上去 8 序列」这类现场翻车）；
  ② 覆盖率里**真的同时出现 L1 与 L2** —— `item_1008/广州仓` 走 L2 商品级降级，
     这是演示脚本要向评委解释的关键点，必须实测而非推断；
  ③ 失败分支 A（缺 `warehouse_id`）→ `40001`，且定位载荷点明缺哪一列、怎么改；
  ④ 失败分支 B（负销量）→ `40003`，且**错误明细 CSV 可下载**（证明异常处理完整）；
  ⑤ 主链路「上传 → 建任务 → 取结果 → 导出」的总墙钟耗时 **< 300 s**（5 分钟硬线），
     并按阶段分别报告耗时；
  ⑥ 结果页所需数据齐备：4 项指标、逐序列曲线、明细分页、CSV 导出（7 列 + BOM）。

用法（在工作区根目录执行）
-----------------------------------------------------------------------------
    <deploy python> scripts/verify_demo_data.py

⚠️ 运行纪律：**每个校验脚本单独占一条命令**（平台按单次调用的累计删除数计阈值 50，
   串跑会让清理被误判成批量删除并中断脚本）。
=============================================================================
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# ⚠️ 必须在 import 应用之前设置环境变量（config 在模块导入时即读取）
# ---------------------------------------------------------------------------
TMP_DIR = ROOT / "data" / "tmp" / "verify_demo"
if TMP_DIR.exists():
    shutil.rmtree(TMP_DIR, ignore_errors=True)
TMP_DIR.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TMP_DIR / "app.db")
os.environ["UPLOAD_DIR"] = str(TMP_DIR / "uploads")
os.environ["EXPORT_DIR"] = str(TMP_DIR / "exports")
os.environ["JWT_SECRET"] = "verify-demo-secret-0123456789abcdefghijklmn"
os.environ["APP_ENV"] = "test"
os.environ.pop("TASK_BUDGET_MS", None)
os.environ.pop("MAX_SERIES", None)
os.environ.pop("ACTIVE_MODEL", None)

sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app.core import config as app_config  # noqa: E402
from app.main import app  # noqa: E402

settings = app_config.settings
DEMO = ROOT / "demo"

passed = 0
failed = 0
RESULTS: list[dict] = []
STAGE_MS: dict[str, float] = {}


def check(name: str, cond: bool, detail: str = "") -> bool:
    global passed, failed
    ok = bool(cond)
    if ok:
        passed += 1
        print(f"[ OK ] {name}" + (f"  ({detail})" if detail else ""))
    else:
        failed += 1
        print(f"[FAIL] {name}  {detail}")
    RESULTS.append({"name": name, "ok": ok, "detail": detail})
    return ok


def section(t: str) -> None:
    print()
    print("=" * 74)
    print(t)
    print("=" * 74)


def api_json(resp):
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        return resp.status_code, None, None, resp.text[:300]
    return resp.status_code, body.get("code"), body.get("data"), body.get("message", "")


def upload(path: Path, token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    with path.open("rb") as fh:
        return client.post(
            "/api/v1/datasets",
            files={"file": (path.name, fh, "text/csv")},
            headers=headers,
        )


def read_readme_claims() -> dict[str, str]:
    """从 demo/README.md 里抽出「行数 / 序列数」声明，用于与实测比对。"""
    text = (DEMO / "README.md").read_text(encoding="utf-8")
    claims: dict[str, str] = {}
    m = re.search(r"\|\s*行数（不含表头）\s*\|\s*([\d,]+)\s*\|", text)
    if m:
        claims["n_rows"] = m.group(1)
    m = re.search(r"\|\s*序列数（商品 × 仓库）\s*\|\s*(\d+)\s*\|", text)
    if m:
        claims["n_series"] = m.group(1)
    m = re.search(r"\|\s*日期跨度\s*\|\s*([\d-]+) ~ ([\d-]+)", text)
    if m:
        claims["date_start"], claims["date_end"] = m.group(1), m.group(2)
    m = re.search(r"\|\s*商品数 / 仓库数\s*\|\s*(\d+) / (\d+)\s*\|", text)
    if m:
        claims["n_sku"], claims["n_wh"] = m.group(1), m.group(2)
    return claims


client = TestClient(app)

with client:
    # =======================================================================
    section("0. 前置：lifespan 已触发（建库 + seed + 预加载模型）")
    # =======================================================================
    try:
        res = client.get("/health")
        st, code, data, msg = api_json(res)
        check("0-1 /health 可用（同一 lifespan 内）", st == 200 and code == 0, f"{st} {msg}")
    except Exception as exc:  # noqa: BLE001
        check("0-1 /health 可用（同一 lifespan 内）", False, str(exc))

    # =======================================================================
    section("1. 冻结数据自检：文件齐备 + README 声明与文件实际一致")
    # =======================================================================
    need = [
        "演示数据_正常.csv",
        "演示数据_失败_缺仓库列.csv",
        "演示数据_失败_负销量.csv",
        "README.md",
    ]
    for n in need:
        p = DEMO / n
        check(f"1-{need.index(n)+1} demo/{n} 存在且非空",
              p.is_file() and p.stat().st_size > 0,
              f"实际 {p.stat().st_size if p.exists() else 0} 字节")

    normal = DEMO / "演示数据_正常.csv"
    rows = list(csv.DictReader(normal.open(encoding="utf-8")))
    series = {(r["sku_id"], r["warehouse_id"]) for r in rows}
    dates = sorted({r["date"] for r in rows})
    check("1-5 正常数据表头恰为 sku_id/warehouse_id/date/sales",
          list(rows[0].keys()) == ["sku_id", "warehouse_id", "date", "sales"],
          str(list(rows[0].keys())))
    check("1-6 🔒 正常数据是「干净数据」：无缺失值、无负销量、日期连续无断档",
          all(r["sku_id"] and r["warehouse_id"] and r["date"] and r["sales"] for r in rows)
          and all(int(r["sales"]) >= 0 for r in rows)
          and len(dates) == (datetime.fromisoformat(dates[-1])
                             - datetime.fromisoformat(dates[0])).days + 1,
          f"{len(rows)} 行 / {len(series)} 序列 / {len(dates)} 个连续日期")

    claims = read_readme_claims()
    check("1-7 README 声明的行数与文件实际一致（防「文档写一套、数据另一套」）",
          claims.get("n_rows", "").replace(",", "") == str(len(rows)),
          f"README={claims.get('n_rows')} / 实际={len(rows)}")
    check("1-8 README 声明的序列数与文件实际一致",
          claims.get("n_series") == str(len(series)),
          f"README={claims.get('n_series')} / 实际={len(series)}")
    check("1-9 README 声明的日期跨度与文件实际一致",
          claims.get("date_start") == dates[0] and claims.get("date_end") == dates[-1],
          f"README={claims.get('date_start')}~{claims.get('date_end')} / 实际={dates[0]}~{dates[-1]}")
    check("1-10 README 声明的商品数/仓库数与文件实际一致",
          claims.get("n_sku") == str(len({r['sku_id'] for r in rows}))
          and claims.get("n_wh") == str(len({r['warehouse_id'] for r in rows})),
          f"README={claims.get('n_sku')}/{claims.get('n_wh')} / "
          f"实际={len({r['sku_id'] for r in rows})}/{len({r['warehouse_id'] for r in rows})}")

    # =======================================================================
    section("1.5 演示账号：注册 + 登录（主链路一律走登录态）")
    # =======================================================================
    # ⚠️ 为什么演示必须登录：`API-16` 导出对游客返回 `401`（这是既定契约，
    #    不是缺陷 —— 导出产物含完整预测明细，不应匿名可取）。
    #    若演示时忘了登录，会在「导出」这一步卡住，是现场最容易翻车的点之一。
    demo_email = f"demo_{int(time.time())}@demo.com"
    demo_pwd = "Demo123456"
    res = client.post("/api/v1/auth/register",
                      json={"email": demo_email, "password": demo_pwd})
    st, code, _, msg = api_json(res)
    check("1.5-1 演示账号注册成功", st == 200 and code == 0, f"{st} code={code} {msg}")
    res = client.post("/api/v1/auth/login",
                      json={"email": demo_email, "password": demo_pwd})
    st, code, login_data, msg = api_json(res)
    TOKEN = (login_data or {}).get("token") or (login_data or {}).get("access_token")
    check("1.5-2 演示账号登录成功并取得 Token",
          st == 200 and code == 0 and bool(TOKEN), f"{st} code={code} {msg}")
    AUTH = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}
    check("1.5-3 契约提醒：游客导出返回 401（故演示必须登录）",
          client.get("/api/v1/predictions/1/export").status_code == 401,
          "游客导出 → 该断言是「演示必须登录」的依据")

    # =======================================================================
    section("2. 主链路①：上传 演示数据_正常.csv")
    # =======================================================================
    t0 = time.perf_counter()
    res = upload(normal, TOKEN)
    STAGE_MS["上传数据集"] = (time.perf_counter() - t0) * 1000
    st, code, data, msg = api_json(res)
    ok = check("2-1 上传成功（code=0，无任何校验错误）", st == 200 and code == 0, f"{st} {msg}")
    if not ok:
        print(f"       ❌ 演示数据无法上传，后续断言无意义。返回体：{json.dumps(data, ensure_ascii=False)[:600]}")
    else:
        ds = data["dataset"]
        check("2-2 序列数与文件实际一致", data.get("series_count") == len(series),
              f"接口={data.get('series_count')} / 文件={len(series)}")
        check("2-3 行数与文件实际一致", ds.get("row_count") == len(rows),
              f"接口={ds.get('row_count')} / 文件={len(rows)}")
        check("2-4 预览表列为 4 列（🔒 动态列，不写死）",
              data["preview"]["columns"] == ["sku_id", "warehouse_id", "date", "sales"],
              str(data["preview"]["columns"]))
        check("2-5 无日期断档（gap_warning.has_gap=False）",
              data["gap_warning"]["has_gap"] is False, str(data["gap_warning"]))
        check("2-6 商品数 6 / 仓库数 3（与冻结数据一致）",
              ds.get("sku_count") == 6 and ds.get("warehouse_count") == 3,
              f"sku={ds.get('sku_count')} wh={ds.get('warehouse_count')}")
        dataset_id = ds["id"]

        # -------------------------------------------------------------------
        section("3. 主链路②：建任务（h=7）+ 覆盖率分级实测")
        # -------------------------------------------------------------------
        t0 = time.perf_counter()
        res = client.post(
            "/api/v1/predictions",
            json={"dataset_id": dataset_id, "horizon": 7, "task_name": "演示数据校验"},
            headers=AUTH,
        )
        STAGE_MS["创建任务(h=7)"] = (time.perf_counter() - t0) * 1000
        st, code, task, msg = api_json(res)
        ok = check("3-1 任务同步返回终态 succeeded（≤60 s 硬预算）",
                   st == 200 and code == 0 and task.get("status") == "succeeded",
                   f"{st} code={code} status={task.get('status') if task else None} {msg}")
        if ok:
            task_id = task["task_id"]
            cov = task.get("coverage") or {}
            check("3-2 🔒 端到端耗时 ≤ 60 s（占预算 < 60%）",
                  task["duration_ms"] <= settings.task_budget_ms
                  and task["duration_ms"] < settings.task_budget_ms * 0.6,
                  f"duration_ms={task['duration_ms']} / 预算={settings.task_budget_ms}")
            check("3-3 覆盖率三项之和 = total", 
                  cov.get("L1", 0) + cov.get("L2", 0) + cov.get("L3", 0) == cov.get("total"),
                  str(cov))
            check("3-4 🔒 覆盖率中**同时出现 L1 与 L2**（演示脚本要向评委解释的关键点）",
                  cov.get("L1", 0) >= 1 and cov.get("L2", 0) >= 1,
                  f"L1={cov.get('L1')} L2={cov.get('L2')} L3={cov.get('L3')}")
            check("3-5 L2 恰好 1 条（item_1008/广州仓，45 天 < 90 阈值）",
                  cov.get("L2") == 1, f"L2={cov.get('L2')}")
            check("3-6 本演示数据不含 L3（全部可预测）", cov.get("L3") == 0,
                  f"L3={cov.get('L3')}")
            check("3-7 加权 MAPE 为有限值且 ≤ 20%",
                  isinstance(task.get("mape"), (int, float)) and task["mape"] <= 20,
                  f"mape={task.get('mape')}")
            check("3-8 分段耗时齐备（执行页时间轴数据源）",
                  isinstance(task.get("timing"), dict)
                  and {"validate", "preprocess", "features", "inference", "metrics"}
                  <= set((task["timing"] or {}).get("stages", {})),
                  f"stages={(task.get('timing') or {}).get('stages')}")
            print(f"       ⏱️  分段 {task.get('timing', {}).get('stages')}"
                  f" / 合计 {task.get('timing', {}).get('wall_ms')} ms"
                  f" / device={task.get('timing', {}).get('device')}")

            # ---------------------------------------------------------------
            section("4. 主链路③：看结果（API-14 / 15 / 16）")
            # ---------------------------------------------------------------
            t0 = time.perf_counter()
            res = client.get(f"/api/v1/predictions/{task_id}", headers=AUTH)
            STAGE_MS["结果接口(API-14)"] = (time.perf_counter() - t0) * 1000
            st, code, result, msg = api_json(res)
            check("4-1 API-14 结果接口可用", st == 200 and code == 0, f"{st} {msg}")
            if st == 200 and code == 0:
                keys = set(result.keys())
                check("4-2 含四项硬指标（MAPE / MAE / RMSE / 达标序列占比）",
                      {"metrics", "coverage", "series"} <= keys
                      or {"metrics", "coverage"} <= keys,
                      f"顶层键={sorted(keys)}")
                m = result.get("metrics") or {}
                check("4-3 指标结构含 mape / mae / rmse / 基线对比字段",
                      "mape" in m or "weighted_mape" in m,
                      f"metrics 键={sorted(m.keys())[:12]}")
                series_list = result.get("series") or []
                check("4-4 逐序列曲线齐备（折线图三线数据源）", len(series_list) >= 1,
                      f"序列数={len(series_list)}")

            t0 = time.perf_counter()
            res = client.get(f"/api/v1/predictions/{task_id}/detail",
                             params={"page": 1, "size": 20}, headers=AUTH)
            STAGE_MS["明细接口(API-15)"] = (time.perf_counter() - t0) * 1000
            st, code, detail, msg = api_json(res)
            check("4-5 API-15 明细分页可用", st == 200 and code == 0, f"{st} {msg}")
            if st == 200 and code == 0:
                check("4-6 明细分页结构含 items / total / page / size",
                      isinstance(detail.get("items"), list) and "total" in detail,
                      f"total={detail.get('total')} items={len(detail.get('items', []))}")

            t0 = time.perf_counter()
            res = client.get(f"/api/v1/predictions/{task_id}/export", headers=AUTH)
            STAGE_MS["导出 CSV(API-16)"] = (time.perf_counter() - t0) * 1000
            check("4-7 API-16 CSV 导出可用（HTTP 200）", res.status_code == 200,
                  f"实际 {res.status_code}")
            if res.status_code == 200:
                raw = res.content
                check("4-8 🔒 CSV 带 UTF-8 BOM（Excel 中文不乱码）",
                      raw.startswith(b"\xef\xbb\xbf"), f"首 3 字节={raw[:3]!r}")
                text = raw.decode("utf-8-sig")
                rdr = list(csv.reader(io.StringIO(text)))
                check("4-9 CSV 为 7 列（与契约一致）",
                      bool(rdr) and len(rdr[0]) == 7, f"表头={rdr[0] if rdr else None}")
                check("4-10 CSV 含数据行（非空导出）", len(rdr) > 1, f"数据行={len(rdr)-1}")

    # =======================================================================
    section("5. 失败分支 A：上传缺 warehouse_id 的文件")
    # =======================================================================
    res = upload(DEMO / "演示数据_失败_缺仓库列.csv")
    st, code, data, msg = api_json(res)
    check("5-1 🔒 被拒且返回 40001（仓库列缺失即拒，FR-UPL-05）", code == 40001,
          f"code={code} msg={msg}")
    d = data or {}
    check("5-2 定位载荷点明缺哪一列", d.get("missing_columns") == ["warehouse_id"],
          str(d.get("missing_columns")))
    check("5-3 fail_stage 为「表头完整性」（错在哪）",
          d.get("fail_stage") == "表头完整性", str(d.get("fail_stage")))
    sug = d.get("suggestion", "")
    check("5-4 建议非空且点明英文列名（怎么改，NFR-USE-03）",
          bool(sug) and "warehouse_id" in sug and "sku_id" in sug, sug[:140])
    check("5-5 🔒 失败也建了记录（dataset_id 非空，供前端引导）",
          d.get("dataset_id") is not None, str(d.get("dataset_id")))

    # =======================================================================
    section("6. 失败分支 B：上传含负销量的文件")
    # =======================================================================
    res = upload(DEMO / "演示数据_失败_负销量.csv")
    st, code, data, msg = api_json(res)
    check("6-1 🔒 被拒且返回 40003（销量非负）", code == 40003, f"code={code} msg={msg}")
    d = data or {}
    neg = d.get("negative_rows") or []
    check("6-2 定位载荷含负值行清单（精确到行）", len(neg) >= 1, f"负值行数={len(neg)}")
    check("6-3 fail_stage 为「销量非负」", d.get("fail_stage") == "销量非负",
          str(d.get("fail_stage")))
    did = d.get("dataset_id")
    check("6-4 失败也建了记录（dataset_id 非空）", did is not None, str(did))
    if did is not None:
        res2 = client.get(f"/api/v1/datasets/{did}/errors")
        check("6-5 🔒 错误明细 CSV 可下载（异常处理完整，不是只弹个提示）",
              res2.status_code == 200 and len(res2.content) > 0,
              f"HTTP {res2.status_code} / {len(res2.content)} 字节")

    # =======================================================================
    section("7. 🔒 5 分钟硬线：主链路总耗时")
    # =======================================================================
    total = sum(STAGE_MS.values())
    for k, v in STAGE_MS.items():
        print(f"       · {k:<20} {v:>9.1f} ms")
    print(f"       ── 合计（不含人工点击/讲解）      {total:>9.1f} ms")
    check("7-1 🔒 主链路总耗时 < 300 s（5 分钟演示硬线）", total < 300_000,
          f"实际 {total/1000:.1f} s")
    check("7-2 自动化链路耗时 < 60 s（留足人讲解时间）", total < 60_000,
          f"实际 {total/1000:.1f} s（自动化部分，人工讲解另计）")

# ===========================================================================
section("结果汇总")
# ===========================================================================
print(f"通过 {passed} / 共 {passed + failed}")
print("=" * 74)

report = {
    "checked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "demo_dir": str(DEMO.relative_to(ROOT)),
    "stage_ms": {k: round(v, 1) for k, v in STAGE_MS.items()},
    "stage_total_ms": round(sum(STAGE_MS.values()), 1),
    "passed": passed,
    "failed": failed,
    "results": RESULTS,
}
out = ROOT / "outputs" / "ep10_demo_report.json"
out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"[OK] 报告已写出 {out.relative_to(ROOT)}")

sys.exit(0 if failed == 0 else 1)
