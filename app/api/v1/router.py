"""
=============================================================================
API v1 路由聚合器
-----------------------------------------------------------------------------
版本     : V1.0（EP-0，EP-4 增补 datasets，EP-5 增补 predictions）
依据文档 : 《开发技术文档 V1.0》§4.1（路由挂载）、§5（接口设计）
-----------------------------------------------------------------------------
已挂载：
  - EP-2：auth（API-01~05）
  - EP-4：datasets（API-06~11 + 断档处置 /datasets/gap）
  - EP-5：predictions（API-12~13；EP-6 起在同一 router 上续挂 API-14~16）
  - EP-7：history（API-17~20 + UX-P04 工作台概览）
  - EP-8：admin（API-22~30，隔离红线的唯一显式例外）
🔒 接口总数：21（既有）+ 9（管理端）= **30**（《技术文档》§5.3）
=============================================================================
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import admin, auth, datasets, history, predictions

api_router = APIRouter()

# EP-2：认证与用户
#   auth.router       → /api/v1/auth/register | login | logout   （API-01~03）
#   auth.users_router → /api/v1/users/me                          （API-04~05）
# 两个 router 分开挂，是因为它们的前缀不同（/auth 与 /users），
# 但同属「认证与用户」这一职责，故定义在同一个 auth.py 内（技术文档 §2.2 文件划分）。
api_router.include_router(auth.router)
api_router.include_router(auth.users_router)

# EP-4：数据集（API-06~11）
#   datasets.router 自带 prefix="/datasets"，故此处不再传 prefix，
#   避免出现 /api/v1/datasets/datasets 这种叠前缀的低级错误。
#   ⚠️ 子路由内部的注册顺序有硬约束（字面量路径必须在 /{dataset_id} 之前），
#      详见 app/api/v1/datasets.py 的文件头说明与 scripts/verify_ep4.py 的顺序守卫。
api_router.include_router(datasets.router)

# EP-5：预测任务（API-12~13）
#   predictions.router 自带 prefix="/predictions"。
#   ⚠️ 该文件的接口在**游客态**下也可调用（API-12 / API-13 用 OptionalUserId），
#      这是《技术文档》§5「游客跑到结果页」与 `FR-USR-08` 的交集解，
#      不是漏加鉴权 —— 详见 app/api/v1/predictions.py 文件头。
api_router.include_router(predictions.router)

# EP-7：历史与对比（API-17~20）
#   history.router 自带 prefix="/history"。
#   🔴 该文件内部的**注册顺序是硬约束（BE-39）**：
#      POST /history/compare 与 GET /history/dashboard 必须排在
#      GET|DELETE /history/{task_id} 之前，否则字面量路径会被
#      参数化路径吞掉（`compare` 被当 task_id → 报 40012）。
#      详见 app/api/v1/history.py 的文件头说明与 scripts/verify_ep7.py 的顺序守卫。
api_router.include_router(history.router)

# EP-8：管理端（API-22~30）
#   admin.router 自带 prefix="/admin"。
#   🔴 该文件是数据隔离红线（NFR-SEC-02）的**唯一显式例外**（BE-ADM-01）：
#      9 个接口全部跨用户聚合、**不带 user_id 过滤**，因此：
#        1. 例外只允许存在于 admin.py 这一个文件 —— 其余 5 个 api/v1/*.py
#           出现不带 user_id 的查询即视为红线破坏（scripts/verify_ep8.py 做 AST 扫描）；
#        2. 9 个路由全部声明 CurrentAdmin，禁止「先查后判」；
#        3. 4 类写操作全部写 operation_logs（action='admin'）。
api_router.include_router(admin.router)

