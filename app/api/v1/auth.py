"""
=============================================================================
认证与用户接口（`API-01` ~ `API-05`）
-----------------------------------------------------------------------------
版本     : V1.0（EP-2）
依据文档 : 《开发技术文档 V1.0》§5.4
           《PRD V1.0》FR-USR-01 ~ 07、FR-SYS-01（统一响应包装）
-----------------------------------------------------------------------------
| 编号 | 方法 + 路径 | 鉴权 | 用途 |
|---|---|---|---|
| `API-01` | `POST /api/v1/auth/register` | 否 | 注册（邮箱 + 密码） |
| `API-02` | `POST /api/v1/auth/login`    | 否 | 登录并签发 JWT（含限流） |
| `API-03` | `POST /api/v1/auth/logout`   | 是 | 登出（把 jti 拉黑） |
| `API-04` | `GET   /api/v1/users/me`     | 是 | 取当前用户（刷新页面恢复登录态） |
| `API-05` | `PATCH /api/v1/users/me`     | 是 | 改昵称 / 改密码 |
-----------------------------------------------------------------------------
路由层职责（`BE-04` §4.2）：只做「取参数 → 调 service → 组响应」。
  本文件内**不得**出现任何业务判断（不比对密码、不判断限流、不查重）。
  唯一允许的判断是组装响应时把 ORM 对象转成响应模型。

🔒 两条不许踩的线：
  1. `FR-SYS-01` 统一响应包：成功与业务失败都返回 `{code, message, data}`。
     业务失败由 `core/errors.py` 的处理器统一成形（HTTP 200 + body.code），
     本文件**不要**自己 try/except 去拼错误响应。
  2. `NFR-SEC-09`：任何响应的任何字段都不得出现 `password_hash`。
     本文件只使用 `UserProfile` 白名单模型，天然不含该字段。
=============================================================================
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.deps import AuthCtx, CurrentUser, DbSession
from app.schemas import (
    ApiResponse,
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    RegisterResponse,
    UpdateUserRequest,
    UserProfile,
)
from app.services import auth_service

# 认证相关：/api/v1/auth/*
router = APIRouter(prefix="/auth", tags=["auth"])
# 当前用户：/api/v1/users/*
users_router = APIRouter(prefix="/users", tags=["users"])


def _client_ip(request: Request) -> str | None:
    """取客户端 IP（写操作日志用）。

    ⚠️ 不读 `X-Forwarded-For`：该头可被客户端伪造，未经可信代理清洗前
       写入审计日志会造成误导。部署到反向代理后需在此处按白名单信任链解析。
    """
    return request.client.host if request.client else None


def _profile(user) -> UserProfile:
    """ORM → 响应模型（白名单字段，杜绝 password_hash 泄露）。"""
    return UserProfile.model_validate(user)


# =============================================================================
# `API-01` 用户注册
# =============================================================================
@router.post("/register", response_model=ApiResponse[RegisterResponse], summary="注册")
def register(body: RegisterRequest, db: DbSession, request: Request) -> ApiResponse[RegisterResponse]:
    """邮箱 + 密码注册（`FR-USR-01`/`02`/`03`）。

    密码强度、字符数与 UTF-8 字节数（≤72）的校验在 `RegisterRequest` 内完成，
    不满足时由统一异常处理器返回 `40011` / `40012`。
    邮箱重复由**唯一索引**拦截并映射为 `40105`（`API-01-1`）。
    """
    user = auth_service.register(
        db,
        email=body.email,
        password=body.password,
        nickname=body.nickname,
        ip=_client_ip(request),
    )
    return ApiResponse.ok(
        RegisterResponse(user_id=user.id, email=user.email),
        message="注册成功",
    )


# =============================================================================
# `API-02` 用户登录
# =============================================================================
@router.post("/login", response_model=ApiResponse[LoginResponse], summary="登录")
def login(body: LoginRequest, db: DbSession, request: Request) -> ApiResponse[LoginResponse]:
    """登录并签发 JWT（`FR-USR-04`），含失败限流（`FR-USR-06`）。

    错误码：
      - `40103` 邮箱或密码错误 —— ⚠️ 不区分二者，防账号枚举（`API-02-1`）；
        `data` 附带 `fail_count` / `max_fail` / `lock_seconds`，供前端渲染
        「这是第 N 次失败…」（`UX-P02-02`）。
      - `40104` 冷却中 —— `data.retry_after_seconds` 给出剩余秒数（`BE-19`）。
    """
    token, expires_in, user = auth_service.login(
        db,
        email=body.email,
        password=body.password,
        ip=_client_ip(request),
    )
    return ApiResponse.ok(
        LoginResponse(
            access_token=token,
            token_type="bearer",
            expires_in=expires_in,
            user=_profile(user),
        )
    )


# =============================================================================
# `API-03` 用户登出
# =============================================================================
@router.post("/logout", response_model=ApiResponse[None], summary="登出")
def logout(ctx: AuthCtx, db: DbSession, request: Request) -> ApiResponse[None]:
    """使当前 Token 立即失效（`FR-USR-05`）。

    实现：把 Token 的 `jti` 写入内存黑名单（`BE-19` 方案 B），
    `get_auth_context` 每次校验都会先查黑名单。

    ⚠️ 需 `AuthCtx` 而非 `CurrentUser`：登出必须拿到 `jti` 与 `exp`
       才能精确拉黑**这一个** Token（改密走的是 `token_version`，量级不同）。
    """
    auth_service.logout(
        db,
        user_id=ctx.user.id,
        jti=ctx.payload["jti"],
        exp=int(ctx.payload["exp"]),
        ip=_client_ip(request),
    )
    return ApiResponse.ok(None, message="已退出登录")


# =============================================================================
# `API-04` 获取当前用户
# =============================================================================
@users_router.get("/me", response_model=ApiResponse[UserProfile], summary="当前用户")
def get_me(user: CurrentUser) -> ApiResponse[UserProfile]:
    """前端刷新页面后恢复登录态（`FR-USR-07`，`API-04-1`）。

    前端在应用挂载时调用一次；返回 401（`40101`/`40102`）即清 Token 跳登录。
    """
    return ApiResponse.ok(_profile(user))


# =============================================================================
# `API-05` 修改资料 / 密码
# =============================================================================
@users_router.patch("/me", response_model=ApiResponse[UserProfile], summary="修改资料/密码")
def update_me(
    body: UpdateUserRequest,
    user: CurrentUser,
    db: DbSession,
    request: Request,
) -> ApiResponse[UserProfile]:
    """部分更新：昵称、密码（`FR-USR-07`）。未传字段不变。

    🔒 改密后 `token_version + 1`，该用户**全部**旧 Token 立即失效，
       前端须引导重新登录（`API-05-1`）。响应仍返回更新后的资料，
       便于前端在跳登录前把昵称等展示信息刷新到位。
    """
    updated = auth_service.update_profile(
        db,
        user=user,
        nickname=body.nickname,
        old_password=body.old_password,
        new_password=body.new_password,
        ip=_client_ip(request),
    )
    message = "资料已更新" if body.new_password is None else "密码已修改，请重新登录"
    return ApiResponse.ok(_profile(updated), message=message)
