"""EP-5 软失败与预检不落库验证（临时脚本）。

① `API-12-2`：预算 1 ms → 期望 HTTP 200 / code 0 / status failed / E_TIMEOUT / 3 条建议
② `API-12-1`：上限 10 序列 → 期望 40004，且 `tasks` 表行数不增
"""
from __future__ import annotations

import json
import sqlite3
import time

import httpx

DB = "data/app.db"


def count_tasks() -> int:
    with sqlite3.connect(DB) as c:
        return c.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]


def show(title: str, r: httpx.Response) -> dict:
    print(f"\n=== {title} === HTTP {r.status_code}")
    print(json.dumps(r.json(), ensure_ascii=False)[:1200])
    return r.json()


# ---------------- ② 先测预检（快，不动任务表） ----------------
c2 = httpx.Client(base_url="http://127.0.0.1:8002", timeout=180.0, trust_env=False)
for i in range(30):
    try:
        c2.get("/health")
        break
    except Exception:
        time.sleep(2)

before = count_tasks()
r = c2.post(
    "/api/v1/predictions",
    json={"dataset_id": 1, "horizon": 14, "use_holiday_feature": 1},
)
body = show("POST /predictions (MAX_SERIES=10) 期望 40004", r)
after = count_tasks()
print(f"tasks 行数: {before} → {after}  （API-12-1 要求相等，即不创建任务）")
assert body["code"] == 40004, body
assert before == after, "序列数超限竟然创建了任务行 —— 违反 API-12-1"
print("✅ API-12-1 通过：超限不落库")

# ---------------- ① 软失败（要跑完整推理，约 25 s） ----------------
c1 = httpx.Client(base_url="http://127.0.0.1:8001", timeout=180.0, trust_env=False)
for i in range(30):
    try:
        c1.get("/health")
        break
    except Exception:
        time.sleep(2)

t0 = time.perf_counter()
r = c1.post(
    "/api/v1/predictions",
    json={"dataset_id": 1, "horizon": 14, "task_name": "EP5 软失败"},
)
wall = (time.perf_counter() - t0) * 1000
body = show("POST /predictions (TASK_BUDGET_MS=1) 期望 code 0 + failed", r)
data = body.get("data") or {}
print(f"wall_ms = {wall:.0f}")
assert r.status_code == 200, f"软失败不得返回非 200，实际 {r.status_code}"
assert body["code"] == 0, body
assert data.get("status") == "failed", data
assert data.get("error_code") == "E_TIMEOUT", data
assert data.get("completed_stage"), data
assert isinstance(data.get("suggestions"), list) and len(data["suggestions"]) == 3, data
print("✅ API-12-2 通过：HTTP 200 / code 0 / status failed / E_TIMEOUT / 三条建议")

# 失败任务必须真的落库（BE-16：复现得了也要查得到）
with sqlite3.connect(DB) as c:
    row = c.execute(
        "SELECT id, status, error_code, completed_stage, duration_ms "
        "FROM tasks WHERE id = ?", (data["task_id"],)
    ).fetchone()
print("DB 中的失败任务行：", row)
assert row and row[1] == "failed" and row[2] == "E_TIMEOUT", row
print("✅ BE-16 通过：软失败任务在库中可查")
