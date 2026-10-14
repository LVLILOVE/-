"""标定「端到端耗时 × 步长」关系（临时脚本，结果写进 predict_service 的常量注释）。

⚠️ 为什么必须实测而不是拍一个系数：
   `API-09` 的 `estimated_ms` 来自 `eval_report.timing_ms.total_ms`（**单遍**
   `run_inference(backtest=True)`，且不含逐序列多步滚动与落库）。
   而真实任务要跑**两遍**流水线（见 `predict_service._run_pipeline` 的说明），
   所以参数页若直接展示 `estimated_ms`，用户会看到「预估 7.9 s、实际 25 s」
   —— 正是 `GIT-7` / `QD-06` 要消灭的「两套数字」。
"""
from __future__ import annotations

import json
import time

import httpx

c = httpx.Client(base_url="http://127.0.0.1:8000", timeout=200.0, trust_env=False)
for _ in range(40):
    try:
        c.get("/health")
        break
    except Exception:
        time.sleep(2)

detail = c.get("/api/v1/datasets/1").json()["data"]
print("API-09 estimated_ms =", detail["estimated_ms"], "· series =", detail["level_preview"]["total"])

rows = []
for h in (7, 14, 30):
    t0 = time.perf_counter()
    r = c.post("/api/v1/predictions", json={"dataset_id": 1, "horizon": h})
    wall = int((time.perf_counter() - t0) * 1000)
    d = r.json()["data"]
    rows.append((h, d["duration_ms"], wall, d["status"]))
    print(f"horizon={h:2d}  duration_ms={d['duration_ms']:6d}  wall_ms={wall:6d}  status={d['status']}")

print("\n=== 基准关系 ===")
base_ms = detail["estimated_ms"]
for h, dur, _wall, _st in rows:
    print(f"h={h:2d}  dur/base = {dur / base_ms:.3f}   dur/(base*h/14) = {dur / (base_ms * h / 14):.3f}")

json.dump({"base_ms": base_ms, "rows": [{"horizon": h, "duration_ms": d} for h, d, _, _ in rows]},
          open("outputs/_ep5_calib.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("已写 outputs/_ep5_calib.json")
