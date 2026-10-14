"""EP-5 冒烟：/health → /datasets/sample → /predictions → /predictions/{id}/status。

⚠️ 临时脚本（非交付物），仅用于 EP-5 联调时人工确认链路，
   正式证据由 `scripts/verify_ep5_api.py` 产出。
"""
from __future__ import annotations

import json
import time

import httpx

BASE = "http://127.0.0.1:8000"
c = httpx.Client(base_url=BASE, timeout=180.0, trust_env=False)


def show(title: str, r: httpx.Response) -> dict:
    body = r.json()
    brief = json.dumps(body, ensure_ascii=False)
    print(f"\n=== {title} === HTTP {r.status_code}")
    print(brief[:1400])
    return body


# 1) 加载示例数据（游客态）
r = c.get("/api/v1/datasets/sample")
body = show("GET /datasets/sample", r)
dataset_id = ((body.get("data") or {}).get("dataset") or {}).get("id")
print("dataset_id =", dataset_id)

if dataset_id:
    # 2) 创建并同步执行预测任务（游客态）
    t0 = time.perf_counter()
    r = c.post(
        "/api/v1/predictions",
        json={
            "dataset_id": dataset_id,
            "granularity": "warehouse_sku",
            "horizon": 14,
            "use_holiday_feature": 1,
            "task_name": "EP5 冒烟",
        },
    )
    wall = (time.perf_counter() - t0) * 1000
    body = show("POST /predictions", r)
    data = body.get("data") or {}
    print(f"wall_ms = {wall:.0f}")

    # 3) 查询任务状态
    task_id = data.get("task_id")
    if task_id:
        r = c.get(f"/api/v1/predictions/{task_id}/status")
        show(f"GET /predictions/{task_id}/status", r)

    # 4) 越界步长 → 40012
    r = c.post("/api/v1/predictions", json={"dataset_id": dataset_id, "horizon": 99})
    show("POST /predictions horizon=99 （期望 40012）", r)

    # 5) 不存在的任务 → 40401
    r = c.get("/api/v1/predictions/999999/status")
    show("GET /predictions/999999/status （期望 40401）", r)

    # 6) 不存在的数据集 → 40402
    r = c.post("/api/v1/predictions", json={"dataset_id": 999999, "horizon": 7})
    show("POST /predictions dataset_id=999999 （期望 40402）", r)
