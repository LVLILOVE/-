"""业务服务层（`api → services → dao → models`）。

🔒 架构红线（方案 §3.3 / 技术文档 `BE-04`）：
  - 本层**不得** `import app.algo.train`（服务进程内不应存在训练逻辑）；
  - 本层不 import fastapi —— 业务逻辑与 HTTP 框架解耦，便于离线脚本复用。
"""
