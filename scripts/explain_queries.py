"""对典型查询做 EXPLAIN QUERY PLAN 实测，产出索引命中证据。

用法：
    python scripts/explain_queries.py

在内存库中执行 schema.sql，再灌入「多用户长期使用」量级的测试数据
（约 8 万行 predictions、5 万行 tasks 等），然后对文档 §6 列出的典型查询
逐条打印执行计划。用于验证索引不是摆设。

不写入任何磁盘文件，纯内存。
"""
from __future__ import annotations

import random
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "code" / "db" / "schema.sql"

N_USERS = 5000
N_DATASETS = 60
N_TASKS = 50
SERIES_PER_TASK = 113
DAYS = 14

QUERIES: list[tuple[str, str, str]] = [
    (
        "Q1",
        "历史列表首屏（经视图 v_task_summary → IX-03）",
        "SELECT task_id, task_name, status, weighted_mape FROM v_task_summary "
        "WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    ),
    (
        "Q2",
        "任务结果明细页（IX-06）",
        "SELECT sku_id, warehouse_id, forecast_date, predicted_value "
        "FROM predictions WHERE task_id = ? ORDER BY sku_id, warehouse_id LIMIT 20",
    ),
    (
        "Q3",
        "导出全量明细（IX-06 / FR-VIS-05 列序固定）",
        "SELECT sku_id, warehouse_id, forecast_date, predicted_value, granularity_level "
        "FROM predictions WHERE task_id = ? "
        "ORDER BY sku_id, warehouse_id, forecast_date",
    ),
    (
        "Q4a",
        "登录查用户（不带 COLLATE，索引失效）",
        "SELECT id, password_hash, token_version FROM users WHERE email = ?",
    ),
    (
        "Q4b",
        "登录查用户（带 COLLATE NOCASE，命中 IX-01）",
        "SELECT id, password_hash, token_version FROM users WHERE email = ? COLLATE NOCASE",
    ),
    (
        "Q5",
        "取当前启用模型（IX-07 部分唯一索引）",
        "SELECT version, file_path, window_size FROM model_registry WHERE is_active = 1",
    ),
    (
        "Q6",
        "任务指标一对一（IX-AUTO-01 UNIQUE）",
        "SELECT mape, mae, series_pass_rate FROM metrics WHERE task_id = ?",
    ),
    (
        "Q7",
        "数据集列表（IX-02）",
        "SELECT id, file_name, row_count FROM datasets "
        "WHERE user_id = ? ORDER BY created_at DESC",
    ),
    (
        "Q8",
        "埋点按事件名统计（IX-09）",
        "SELECT COUNT(*) FROM events WHERE event_name = ?",
    ),
    (
        "Q9",
        "操作日志按用户查（IX-08）",
        "SELECT action, result, created_at FROM operation_logs "
        "WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    ),
    (
        "Q10",
        "埋点按任务追溯（IX-10）",
        "SELECT event_name, created_at FROM events WHERE task_id = ?",
    ),
    (
        "Q11",
        "结果页按分层筛选（无专用索引，验证退化情况）",
        "SELECT COUNT(*) FROM predictions WHERE task_id = ? AND granularity_level = 'L2'",
    ),
]

# 各查询绑定参数（按 QUERIES 的 id 给出），未列出的默认 1
PARAMS: dict[str, tuple] = {"Q4a": ("u2500@example.com",), "Q4b": ("u2500@example.com",)}


def build(con: sqlite3.Connection) -> dict[str, int]:
    """灌入测试数据，返回各表行数。"""
    rnd = random.Random(20261009)
    counts: dict[str, int] = {}

    con.executemany(
        "INSERT INTO users (email, password_hash, nickname) VALUES (?, 'h', ?)",
        [(f"u{i}@example.com", f"用户{i}") for i in range(1, N_USERS + 1)],
    )
    counts["users"] = con.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    con.executemany(
        "INSERT INTO datasets (user_id, file_name, stored_name, file_path, "
        "row_count, sku_count, warehouse_count, valid_series_count) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                rnd.randint(1, N_USERS),
                f"sales_{i}.csv",
                f"{i:04d}_uuid.csv",
                f"uploads/u1/{i:04d}_uuid.csv",
                rnd.randint(5000, 60000),
                rnd.randint(20, 200),
                5,
                rnd.randint(50, 400),
            )
            for i in range(1, N_DATASETS + 1)
        ],
    )
    counts["datasets"] = con.execute("SELECT COUNT(*) FROM datasets").fetchone()[0]

    task_rows = []
    for t in range(1, N_TASKS + 1):
        task_rows.append(
            (
                rnd.randint(1, N_USERS),
                rnd.randint(1, N_DATASETS),
                f"任务 {t}",
                rnd.choice([7, 14, 30]),
                rnd.choice(["created", "running", "succeeded", "failed"]),
                "lstm_v1",
                SERIES_PER_TASK,
                rnd.randint(70, 100),
                rnd.randint(0, 30),
                0,
                rnd.randint(5000, 40000),
            )
        )
    con.executemany(
        "INSERT INTO tasks (user_id, dataset_id, task_name, horizon, status, "
        "model_version, series_total, l1_count, l2_count, l3_count, duration_ms) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        task_rows,
    )
    counts["tasks"] = con.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]

    pred_rows = []
    for tid in range(1, N_TASKS + 1):
        for s in range(SERIES_PER_TASK):
            # (sku, warehouse) 必须唯一，否则会撞 ux_predictions_key 联合唯一索引
            sku = f"SKU{(s // 5) + 1:04d}"
            wh = f"WH{(s % 5) + 1:02d}"
            lvl = "L1" if s < 81 else "L2"
            for d in range(1, DAYS + 1):
                pred_rows.append(
                    (tid, sku, wh, f"2015-12-{d:02d}", round(rnd.uniform(0, 500), 2), lvl)
                )
    con.executemany(
        "INSERT INTO predictions (task_id, sku_id, warehouse_id, forecast_date, "
        "predicted_value, granularity_level) VALUES (?, ?, ?, ?, ?, ?)",
        pred_rows,
    )
    counts["predictions"] = con.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]

    con.executemany(
        "INSERT INTO metrics (task_id, mape, mae, rmse, baseline_mae, mae_improve_pct, "
        "series_pass_rate, l1_mape, l2_mape, is_over_threshold) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                t,
                round(rnd.uniform(8, 25), 2),
                round(rnd.uniform(0.8, 2.5), 3),
                round(rnd.uniform(2, 6), 3),
                round(rnd.uniform(1.5, 4), 3),
                round(rnd.uniform(5, 40), 2),
                round(rnd.uniform(50, 95), 2),
                round(rnd.uniform(8, 20), 2),
                round(rnd.uniform(40, 70), 2),
                rnd.choice([0, 1]),
            )
            for t in range(1, N_TASKS + 1)
        ],
    )
    counts["metrics"] = con.execute("SELECT COUNT(*) FROM metrics").fetchone()[0]

    con.executemany(
        "INSERT INTO operation_logs (user_id, action, target_id, result, ip) "
        "VALUES (?, ?, ?, ?, ?)",
        [
            (
                rnd.randint(1, N_USERS),
                rnd.choice(["login", "register", "logout", "upload", "predict", "export", "delete"]),
                str(rnd.randint(1, N_TASKS)),
                rnd.choice(["success", "fail"]),
                f"192.168.1.{rnd.randint(2, 254)}",
            )
            for _ in range(20_000)
        ],
    )
    counts["operation_logs"] = con.execute("SELECT COUNT(*) FROM operation_logs").fetchone()[0]

    con.executemany(
        "INSERT INTO events (event_name, user_id, task_id, properties) VALUES (?, ?, ?, ?)",
        [
            (
                rnd.choice(["prediction_start", "prediction_complete", "export_click", "upload_success"]),
                rnd.randint(1, N_USERS),
                rnd.randint(1, N_TASKS),
                '{"horizon": 14}',
            )
            for _ in range(15_000)
        ],
    )
    counts["events"] = con.execute("SELECT COUNT(*) FROM events").fetchone()[0]

    return counts


def main() -> int:
    if not SCHEMA.exists():
        print(f"[FAIL] 找不到建表脚本：{SCHEMA}")
        return 1

    con = sqlite3.connect(":memory:")
    con.executescript(SCHEMA.read_text(encoding="utf-8"))
    con.execute("PRAGMA foreign_keys = ON")

    counts = build(con)
    con.commit()
    con.execute("ANALYZE")  # 更新统计信息，模拟生产环境常规维护后的状态

    print("=" * 74)
    print("EXPLAIN QUERY PLAN 实测")
    print("=" * 74)
    print("测试数据量：" + " · ".join(f"{k} {v:,}" for k, v in counts.items()))
    print("=" * 74)

    for qid, title, sql in QUERIES:
        print()
        print(f"[{qid}] {title}")
        print("-" * 74)
        params = PARAMS.get(qid, (1,) if "?" in sql else ())
        try:
            rows = con.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()
        except sqlite3.Error as exc:
            print(f"  <执行失败：{exc}>")
            continue
        for r in rows:
            detail = r[-1] if r else ""
            mark = ""
            if "USING INDEX" in detail or "USING COVERING INDEX" in detail:
                mark = "  ← 命中索引"
            elif "USING INTEGER PRIMARY KEY" in detail:
                mark = "  ← 主键"
            elif "SCAN" in detail:
                mark = "  ← 全表扫描"
            print(f"  {detail}{mark}")

    print()
    print("=" * 74)
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
