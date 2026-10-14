"""
=============================================================================
`_ep5_cfg_probe.py` · 受控配置下的单次预测探针
-----------------------------------------------------------------------------
在**独立子进程**里用指定环境变量跑一次 `POST /api/v1/predictions`，
把响应原样落盘，供 `verify_ep5_api.py` 断言。

用法（由父脚本调用）：
    TASK_BUDGET_MS=1  python scripts/_ep5_cfg_probe.py --dataset-id 1 --out x.json
    MAX_SERIES=10     python scripts/_ep5_cfg_probe.py --dataset-id 1 --out y.json

🔴 **为什么必须独立进程**：`app.core.config.settings` 是
   **`@dataclass(frozen=True)`**，运行期改不了；而这些用例的
   前提恰恰是「换个配置再跑一次」（压低预算、压低序列上限）。
   唯一可靠的路径是让 `config` 在**模块导入时**就读到新环境变量，
   即另起一个进程。

   （曾在同一进程里写 `settings.task_budget_ms = 1`，直接吃到
     `dataclasses.FrozenInstanceError` —— 记在这里以免再犯。）

⚠️ **只传需要改的那一个变量**，其余 DB / 上传目录等由父进程通过
   `inherit` 环境继承 —— 保证子进程操作的是**同一个临时库**，
   这样「失败任务是否落库」「tasks 行数是否变化」才查得到。
=============================================================================
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-id", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--horizon", type=int, default=7)
    args = ap.parse_args()

    from fastapi.testclient import TestClient

    from app.core import config as app_config
    from app.core.db import SessionLocal
    from app.main import app
    from sqlalchemy import text as sa_text

    settings = app_config.settings
    print("=" * 70)
    print(
        f"配置探针 · TASK_BUDGET_MS={settings.task_budget_ms} "
        f"MAX_SERIES={settings.max_series} DB={settings.db_path}"
    )
    print("=" * 70)

    def count_tasks() -> int:
        db = SessionLocal()
        try:
            return int(db.execute(sa_text("SELECT COUNT(*) FROM tasks")).scalar() or 0)
        finally:
            db.close()

    before = count_tasks()

    client = TestClient(app)
    t0 = time.perf_counter()
    with client:  # 🔒 触发 lifespan（建库 / seed / 预加载模型）
        # 子进程启动时 DB 可能还没建（首次跑），先确保 ready 数据集存在
        s = client.get("/api/v1/datasets/sample")
        if s.status_code != 200:
            print(f"[WARN] /datasets/sample 返回 {s.status_code}：{s.text[:200]}")
        resp = client.post(
            "/api/v1/predictions",
            json={"dataset_id": args.dataset_id, "horizon": args.horizon},
        )
    wall = (time.perf_counter() - t0) * 1000

    after = count_tasks()

    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        body = {"_raw": resp.text[:500]}

    dump = {
        "env": {
            "TASK_BUDGET_MS": os.environ.get("TASK_BUDGET_MS"),
            "MAX_SERIES": os.environ.get("MAX_SERIES"),
            "DB_PATH": os.environ.get("DB_PATH"),
        },
        "settings": {
            "task_budget_ms": settings.task_budget_ms,
            "max_series": settings.max_series,
            # ⚠️ settings.db_path 是 WindowsPath，json 不认 —— 必须 str() 后再落盘
            "db_path": str(settings.db_path),
        },
        "http_status": resp.status_code,
        "body": body,
        "wall_ms": round(wall, 1),
        "tasks_before": before,
        "tasks_after": after,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dump, ensure_ascii=False), encoding="utf-8")

    print(f"HTTP {resp.status_code}  wall={wall:.0f}ms  tasks {before} → {after}")
    print(f"body.code={body.get('code')}  data.status={(body.get('data') or {}).get('status')}")
    print(f"已写出：{out}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())