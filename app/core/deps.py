"""
=============================================================================
依赖注入（数据库会话 / 鉴权 / 角色校验）
-----------------------------------------------------------------------------
版本     : V1.0（EP-2）
依据文档 : 《开发技术文档 V1.0》§4.3（依赖注入）、§5.4（认证接口）
           《项目开发实施方案 V1.0》WS-2-02、§5.4.3（越权判定顺序）
-----------------------------------------------------------------------------
对外提供的依赖
-----------------------------------------------------------------------------
    get_db            数据库会话（成功提交 / 异常回滚，BE-17）
    get_auth_context  解析 Bearer Token → AuthContext(user, payload, token)
    get_current_user  必须已登录 → User（未登录 40101 / Token 失效 40102）
    get_optional_user 游客态 → user_id（未登录或 Token 无效一律返回 0，不抛错）
    get_current_admin 必须已登录且 role=='admin'（非管理员 → 40301）

🔒 越权判定顺序（`BE-41`，**不得简化、不得调换**）
-----------------------------------------------------------------------------
    请求进入
      ├─ 携带 Token？ 否 → 401（40101 未登录）
      └─ 是 → 校验签名 + 到期 + `ver`(token_version) + `jti`(黑名单)
              ├─ 失败 → 401（40102 Token 失效）
              └─ 成功 → 取 user_id → 查库
                  ├─ 用户不存在 / 已停用 → 401（40102）
                  ├─ （仅管理端）role != 'admin' → 40301
                  └─ 通过

    注意先后：**先认证后授权**。若把 role 判断提前，未登录请求会拿到 403 而不是
    401，前端就无法区分「该去登录」与「登录了但没权限」。

🔒 分层依赖（`BE-04`）：本模块位于 `core/`，属基础设施层，允许 import `dao`
   （技术文档 §4.3 的参考实现即如此）。禁止的是 `api/` 直接 import `dao`。
=============================================================================
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated, Iterator

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core import security
from app.core.db import SessionLocal
from app.core.errors import BizError, ErrorCode
from app.dao import user_dao
from app.models.user import GUEST_USER_ID, ROLE_ADMIN, User

logger = logging.getLogger(__name__)

__all__ = [
    "GUEST_USER_ID",
    "AuthContext",
    "DbSession",
    "CurrentUser",
    "OptionalUserId",
    "CurrentAdmin",
    "get_db",
    "get_auth_context",
    "get_current_user",
    "get_optional_user",
    "get_current_admin",
]

_BEARER_PREFIX = "Bearer "


def get_db() -> Iterator[Session]:
    """请求级数据库会话。

    `BE-17`：**不在 `finally` 中提交**。`commit()` 放在 `yield` 之后的正常路径，
    异常时走 `rollback`，避免「业务失败但数据已落库」的不一致。

    ⚠️ 业务异常（`BizError`）也会走 `rollback` 分支。这是刻意的：
       例如注册时唯一索引冲突，先把该会话的失败事务清干净再交给异常处理器，
       否则后续在同一会话上的任何查询都会报
       `PendingRollbackError`。
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@dataclass(frozen=True)
class AuthContext:
    """一次已认证请求的上下文。

    把 `user` / `payload` / `token` 打包，供两类调用方使用：
      - 常规接口：只用 `.user`（通过 `get_current_user`）
      - 登出接口：还需要 `.payload['jti']` 与 `.payload['exp']` 去写黑名单
    """

    user: User
    payload: dict
    token: str


def _extract_bearer(authorization: str | None) -> str:
    """从 Authorization 头取 Token 原文。

    兼容大小写（`Bearer` / `bearer`）与前后的空白——某些客户端会写成小写，
    严格按 `startswith('Bearer ')` 判断会把它们全部判为未登录。
    """
    if not authorization:
        raise BizError(ErrorCode.UNAUTHORIZED, "请先登录后再执行此操作")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise BizError(ErrorCode.UNAUTHORIZED, "请先登录后再执行此操作")
    return token.strip()


def get_auth_context(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> AuthContext:
    """解析 Token → 校验 → 载入用户（`FR-USR-04` / `FR-USR-05` / `FR-USR-07`）。"""
    token = _extract_bearer(authorization)
    payload = security.decode_access_token(token)

    user = user_dao.get_by_id(db, security.payload_user_id(payload))
    if user is None:
        raise BizError(ErrorCode.TOKEN_EXPIRED, "登录状态已失效，请重新登录")

    # 🔒 FR-USR-07：改密时 token_version+1，此处比对即可让该用户全部旧 Token 失效。
    #    这是 JWT 无状态条件下唯一可行的「全量撤销」手段。
    if security.payload_token_version(payload) != int(user.token_version):
        raise BizError(ErrorCode.TOKEN_EXPIRED, "登录状态已变更，请重新登录")

    if user.status != 1:
        # 管理端停用账号（API-24）后，该用户的 Token 立刻不可用。
        # 归入 40102 而非 40301：让前端走「清 Token → 跳登录」的标准路径，
        # 而不是停留在一个永远无法操作的登录态里。
        raise BizError(ErrorCode.TOKEN_EXPIRED, "账号已被停用，请联系管理员")

    # 供登出接口取 jti/exp；request.state 在单请求内共享
    request.state.jwt_payload = payload
    request.state.access_token = token
    return AuthContext(user=user, payload=payload, token=token)


def get_current_user(ctx: AuthContext = Depends(get_auth_context)) -> User:
    """必须已登录。返回 ORM 用户对象。

    🔒 `BE-18`：这是**数据隔离的执行点**。返回对象的 `.id` 必须被后续所有
       DAO 查询用作过滤条件（`NFR-SEC-02`）。任何 `dao.xxx(db, task_id=...)`
       而不带 `user_id` 的调用都是越权风险。
    """
    return ctx.user


def get_optional_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> int:
    """返回 `user_id`；未登录或 Token 无效时返回 `GUEST_USER_ID`（0），**不抛错**。

    🔒 使用范围严格受限（`FR-USR-08` / `JT-10`）：**仅** `API-06`（上传数据集）
       与 `API-07`（加载示例数据）可用。其余接口一律用 `get_current_user`。
       误用的后果是把越权请求静默降级成游客请求，从而掩盖鉴权缺陷。

    设计取舍：Token 过期后点「上传」应能继续（降级为游客），而不是被拦下；
       但涉及数据归属的接口必须严格鉴权，故本依赖**不**作为其他接口的默认值。
    """
    if not authorization:
        return GUEST_USER_ID
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return GUEST_USER_ID
    try:
        payload = security.decode_access_token(token.strip())
    except BizError:
        # ⚠️ 这里「吞掉」40102 是刻意的降级，但必须留日志：
        #    否则「Token 有问题」这件事在生产环境完全不可观测。
        logger.info("optional auth degraded to guest: invalid token")
        return GUEST_USER_ID

    user = user_dao.get_by_id(db, security.payload_user_id(payload))
    if (
        user is None
        or user.status != 1
        or security.payload_token_version(payload) != int(user.token_version)
    ):
        return GUEST_USER_ID
    return user.id


def get_current_admin(ctx: AuthContext = Depends(get_auth_context)) -> User:
    """必须已登录且 `role == 'admin'`（`CH-01`，`EP-8` 起全面启用）。

    🔒 `BE-ADM-01`：管理端是数据隔离红线的**唯一显式例外**，因此：
      1. 本依赖必须在**每一个** `/admin/*` 接口上声明，禁止在路由函数内部
         「先查后判」（漏判即越权）；
      2. 例外只允许存在于 `app/api/v1/admin.py` 一个文件里。

    `EP-2` 阶段先落地本依赖并单测，`EP-8` 挂载管理端接口时直接复用。
    """
    if ctx.user.role != ROLE_ADMIN:
        raise BizError(
            ErrorCode.FORBIDDEN,
            "当前账号无管理端访问权限，请联系系统管理员",
        )
    return ctx.user


# ---------------------------------------------------------------------------
# 类型别名（路由签名里用，比 Annotated[...] 更短更不容易写错）
# ---------------------------------------------------------------------------
DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentAdmin = Annotated[User, Depends(get_current_admin)]
OptionalUserId = Annotated[int, Depends(get_optional_user)]
AuthCtx = Annotated[AuthContext, Depends(get_auth_context)]

# 显式引用，避免 linter 因「GUEST_USER_ID 仅用于 re-export」而报未使用
_ = (GUEST_USER_ID, ROLE_ADMIN)
