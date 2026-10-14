"""DAO 包 —— 纯 CRUD 层（8 个模块，与 8 张表一一对应）。

| 模块 | 表 | 数据库设计文档编号 |
|---|---|---|
| `user_dao` | `users` | `DB-T01` |
| `dataset_dao` | `datasets` | `DB-T02` |
| `task_dao` | `tasks` | `DB-T03` |
| `prediction_dao` | `predictions` | `DB-T04` |
| `metric_dao` | `metrics` | `DB-T05` |
| `model_dao` | `model_registry` | `DB-T06` |
| `oplog_dao` | `operation_logs` | `DB-T07` |
| `event_dao` | `events` | `DB-T08` |

🔒 三条不可违反的约定：
  1. **纯 CRUD，不含业务判断**（技术文档 §2.2）。校验、限流、状态流转的判定
     属于 `services/`；DAO 只回答「怎么存取」。
  2. **不得 `import algo`**（架构红线 4）。分层依赖单向：
     `api → services → dao → models`，`services ↘ algo`。
  3. **所有用户侧查询必须携带 `user_id`**（`NFR-SEC-02` 隔离红线）。
     带 `_all` 后缀的函数是管理端（`CH-01`）唯一显式例外，只允许 `admin.py` 调用。

📌 视图 `v_task_summary`（`VW-01`）不建 ORM 实体，按需用原生 SQL 只读查询。
"""
from app.dao import (
    dataset_dao,
    event_dao,
    metric_dao,
    model_dao,
    oplog_dao,
    prediction_dao,
    task_dao,
    user_dao,
)

__all__ = [
    "user_dao",
    "dataset_dao",
    "task_dao",
    "prediction_dao",
    "metric_dao",
    "model_dao",
    "oplog_dao",
    "event_dao",
]
