"""
=============================================================================
API v1 · 管理端                API-22 ~ API-30  （CH-01 / EP-8）
-----------------------------------------------------------------------------
依据文档 : 《项目开发实施方案 V1.0》§5.5（管理端接口清单）、§5.4（隔离例外）
承载页面 : AD-P01 运营看板 / AD-P02 用户与任务管理

🔒🔒 本文件是数据隔离红线（`NFR-SEC-02`）的**唯一显式例外**（`BE-ADM-01`）
-----------------------------------------------------------------------------
普通接口（`auth` / `datasets` / `predictions` / `history` / `system`，共 21 个）
的每一条查询都必须携带 `user_id` 过滤。本文件的 9 个接口**不携带**——
这是业务上的必要（管理员要看跨用户的运营数据）。

代价是「例外必须有边界」，因此以下四条是硬约束：

  1. 🔒 **本文件是唯一入口**。任何在其它 5 个 `api/v1/*.py` 里出现
     「不带 `user_id` 过滤的查询」都视为红线破坏，评审直接打回。
     `scripts/verify_ep8.py` 会做 AST 级扫描来守这条。
  2. 🔒 **9 个路由全部声明 `CurrentAdmin`**，`get_current_admin` 会在
     `get_current_user` 之上强制 `role == 'admin'`，非管理员 → `40301`。
     **禁止**「在路由函数内部先查后判」——漏判一处即越权。
  3. 🔒 **4 类写操作全部留痕**（`action='admin'`，`detail` 记
     `sub=<子动作>;target=<目标>;by=<操作者>`）。
  4. 🔒 **不返回密码哈希、不提供原始 CSV 下载**（`QD-04` 最小暴露）。

🔒 越权判定顺序（`BE-41`，**先认证后授权**）
-----------------------------------------------------------------------------
  未登录            → 40101 / 40102（`get_current_user` 先跑）
  已登录但非管理员  → 40301（`get_current_admin` 抛）
  已登录且是管理员  → 进入业务

  ⚠️ 顺序不可调换：若把 role 判断提前，未登录请求会拿到 403 而不是 401，
     前端就无法区分「该去登录」与「登录了但没权限」。

🔒 路由注册顺序
-----------------------------------------------------------------------------
  本文件 9 条路由**互不遮蔽**（`/admin/overview`、`/admin/users/{user_id}`
  等都不存在「字面量路径排在 `{param}` 路径之后」的冲突：
  `GET /admin/users` 与 `GET /admin/users/{user_id}` 前者不含参数、不遮蔽；
  `PATCH /admin/users/{user_id}` 与 `POST /admin/users/{user_id}/reset-password`
  方法不同且路径段数不同，也不冲突）。
  `scripts/verify_ep8.py` 仍会实测 `admin.router.routes` 做顺序断言 ——
  加新接口时请一并跑一遍，不要因为「现在没问题」就跳过。
"""
from __future__ import annotations

from fastapi import APIRouter, Path, Query
from starlette.concurrency import run_in_threadpool

from app.core.deps import CurrentAdmin, DbSession
from app.schemas import (
    AdminDeleteTaskResponse,
    AdminLogPage,
    AdminLogQuery,
    AdminModelListResponse,
    AdminOverviewQuery,
    AdminOverviewResponse,
    AdminTaskPage,
    AdminTaskQuery,
    AdminUpdateUserRequest,
    AdminUpdateUserResponse,
    AdminUserPage,
    AdminUserQuery,
    ApiResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
    SwitchModelRequest,
    SwitchModelResponse,
)
from app.services import admin_service

router = APIRouter(prefix="/admin", tags=["管理端"])


# =============================================================================
# API-22 运营看板概览
# =============================================================================
@router.get("/overview", response_model=ApiResponse[AdminOverviewResponse], summary="API-22 运营看板概览")
async def admin_overview(
    db: DbSession,
    admin: CurrentAdmin,
    query: AdminOverviewQuery = Query(default=AdminOverviewQuery()),
) -> ApiResponse[AdminOverviewResponse]:
    """运营看板概览（`AD-P01` 顶部）。

    ⚠️ `days` 非法值返回 `40012` 而**不是静默兜底成 30** ——
       静默兜底会让运营以为在看半年的数据，实际只有一个月。
    """
    data = await run_in_threadpool(
        admin_service.overview, db, days=query.days
    )
    return ApiResponse(data=data)


# =============================================================================
# API-23 用户列表
# =============================================================================
@router.get("/users", response_model=ApiResponse[AdminUserPage], summary="API-23 用户列表")
async def admin_list_users(
    db: DbSession,
    admin: CurrentAdmin,
    query: AdminUserQuery = Query(default=AdminUserQuery()),
) -> ApiResponse[AdminUserPage]:
    """用户列表（跨用户）。

    🔒 响应**不含 `password_hash`** —— 由 schema白名单保证
       （`AdminUserBrief` 没有该字段，pydantic 不会凭空造出来）。
    """
    data = await run_in_threadpool(
        admin_service.list_users,
        db,
        page=query.page,
        size=query.size,
        keyword=query.q,
        status=query.status,
        role=query.role,
    )
    return ApiResponse(data=data)


# =============================================================================
# API-24 启停用 + 角色变更
# =============================================================================
@router.patch(
    "/users/{user_id}",
    response_model=ApiResponse[AdminUpdateUserResponse],
    summary="API-24 启停用与角色变更",
)
async def admin_update_user(
    payload: AdminUpdateUserRequest,
    db: DbSession,
    admin: CurrentAdmin,
    user_id: int = Path(..., ge=1),
) -> ApiResponse[AdminUpdateUserResponse]:
    """启停用 / 改角色（`AD-P02` 用户管理 Tab）。

    🔒 服务层有**三条自我保护**，缺一条就会出现「管理员把自己锁在门外」：
       不能停用自己、不能降级自己、不能动最后一个管理员。
    🔒 `status=0` 时**同时 `token_version + 1`** —— 否则旧 Token 仍可用，
       停用只挡住了新登录。
    🔒 写 `operation_logs`（`action='admin'`，`sub=enable/disable/role_change`）。
    """
    data = await run_in_threadpool(
        admin_service.update_user,
        db,
        target_user_id=user_id,
        operator=admin,
        status=payload.status,
        role=payload.role,
    )
    return ApiResponse(data={"user": data})


# =============================================================================
# API-25 重置密码
# =============================================================================
@router.post(
    "/users/{user_id}/reset-password",
    response_model=ApiResponse[ResetPasswordResponse],
    summary="API-25 重置用户密码",
)
async def admin_reset_password(
    payload: ResetPasswordRequest,
    db: DbSession,
    admin: CurrentAdmin,
    user_id: int = Path(..., ge=1),
) -> ApiResponse[ResetPasswordResponse]:
    """重置用户密码（`AD-P02` 用户管理 Tab）。

    🔒 **必须同时 `token_version + 1`**（数据库设计文档 §10.5）：
       JWT 无状态，改密码本身不影响已签发的 Token。不 bump 的话，
       攻击者手上的旧 Token 仍能用到自然过期 —— **重置形同虚设**。
       这条联动已在 `EP-2` 的改密逻辑里验证过，此处复用。
    """
    data = await run_in_threadpool(
        admin_service.reset_password,
        db,
        target_user_id=user_id,
        operator=admin,
        new_password=payload.new_password,
    )
    return ApiResponse(data=data)


# =============================================================================
# API-26 全量任务列表
# =============================================================================
@router.get("/tasks", response_model=ApiResponse[AdminTaskPage], summary="API-26 全量任务列表")
async def admin_list_tasks(
    db: DbSession,
    admin: CurrentAdmin,
    query: AdminTaskQuery = Query(default=AdminTaskQuery()),
) -> ApiResponse[AdminTaskPage]:
    """全量任务列表（跨用户）。

    ⚠️ **含已软删除的任务**（`is_deleted=1`）并带该标记：管理端是运维视角，
       用户侧列表才过滤软删除。
    """
    data = await run_in_threadpool(
        admin_service.list_tasks,
        db,
        page=query.page,
        size=query.size,
        user_id=query.user_id,
        status=query.status,
        keyword=query.q,
    )
    return ApiResponse(data=data)


# =============================================================================
# API-27 强制删除任务（硬删除）
# =============================================================================
@router.delete(
    "/tasks/{task_id}",
    response_model=ApiResponse[AdminDeleteTaskResponse],
    summary="API-27 强制删除任务",
)
async def admin_delete_task(
    db: DbSession,
    admin: CurrentAdmin,
    task_id: int = Path(..., ge=1),
) -> ApiResponse[AdminDeleteTaskResponse]:
    """强制删除任务（**硬删除** + 级联，`QD-03`）。

    🔒 与用户侧软删除的**语义差异**（界面上文案必须区分）：
       本接口物理删除 `tasks` 行 + 级联 `predictions` / `metrics`；
       `datasets` **不动**（`RESTRICT`，可能被其他任务引用）；
       `operation_logs` **保留**（审计不随任务消失）。
       用户侧 `API-20` 是软删除、可恢复 —— 把两者文案写混是误导。

    🔒 返回**连带删除的行数**：不可逆操作必须有回执，
       否则管理员不敢点。
    """
    data = await run_in_threadpool(
        admin_service.force_delete_task, db, task_id=task_id, operator=admin
    )
    return ApiResponse(data=data)


# =============================================================================
# API-28 模型版本列表
# =============================================================================
@router.get("/models", response_model=ApiResponse[AdminModelListResponse], summary="API-28 模型版本列表")
async def admin_list_models(
    db: DbSession,
    admin: CurrentAdmin,
) -> ApiResponse[AdminModelListResponse]:
    """模型版本列表（`AD-P01` 模型版本表）。

    📌 与 `API-29` **必须分离**（`QD-07`）：单路径承担读写两种语义会让
       权限与缓存策略无法各自独立演进。
    """
    data = await run_in_threadpool(admin_service.list_models, db)
    return ApiResponse(data=data)


# =============================================================================
# API-29 切换启用版本
# =============================================================================
@router.patch(
    "/models/{version}",
    response_model=ApiResponse[SwitchModelResponse],
    summary="API-29 切换启用模型版本",
)
async def admin_switch_model(
    payload: SwitchModelRequest,
    db: DbSession,
    admin: CurrentAdmin,
    version: str = Path(..., min_length=1, max_length=64),
) -> ApiResponse[SwitchModelResponse]:
    """切换启用模型版本（`AD-P01` 模型版本卡片）。

    🔒 `BE-ADM-02`：**同一事务内先降旧、再升新**，顺序固定。
       `model_registry` 上有部分唯一索引
       `ux_model_active ON model_registry (is_active) WHERE is_active = 1`，
       ⏱️ 实测把两个 `is_active` 都置 1 会被
       `UNIQUE constraint failed: model_registry.is_active` 拒绝。
       **先升新再降旧同样会撞索引** —— 这不是风格偏好，是数据库强制的。

    🔒 `BE-ADM-03`：切换后校验与 `.env` 的 `ACTIVE_MODEL` 一致。
       不一致 =「数据库说 v2、进程跑 v1」的静默故障。实现方式是提交后
       立即 `reload_active_model()` 热切换；若 `.env` 未同步则**仍返回成功
       但带 `warnings`** —— 把 `.env` 写进数据库不是接口该做的事，
       而悄悄失败更糟。
    """
    data = await run_in_threadpool(
        admin_service.switch_model, db, version=version, operator=admin
    )
    return ApiResponse(data=data)


# =============================================================================
# API-30 操作日志查询
# =============================================================================
@router.get("/logs", response_model=ApiResponse[AdminLogPage], summary="API-30 操作日志查询")
async def admin_list_logs(
    db: DbSession,
    admin: CurrentAdmin,
    query: AdminLogQuery = Query(default=AdminLogQuery()),
) -> ApiResponse[AdminLogPage]:
    """操作日志查询（`AD-P02` 日志 Tab）。

    ⚠️ `action` / `result` **刻意不在 schema 层收窄取值域**：
       收窄会抛 pydantic `ValidationError` → 500，
       而非法筛选值应按本项目契约返 `40012`（与 `EP-7` 的
       `HistoryQuery.status` 同理）。
    """
    data = await run_in_threadpool(
        admin_service.list_logs,
        db,
        page=query.page,
        size=query.size,
        action=query.action,
        result=query.result,
        user_id=query.user_id,
        start=query.start,
        end=query.end,
    )
    return ApiResponse(data=data)
