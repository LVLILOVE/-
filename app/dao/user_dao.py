"""`users` 表数据访问（`DB-T01`）。

🔒 纯 CRUD，不含业务判断（不校验密码强度、不判断限流、不签发 Token）——
   那些属于 `services/auth_service.py`。

🔒 本模块不得 `import algo`（架构红线 4）。
"""
from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.user import GUEST_USER_ID, ROLE_ADMIN, ROLE_USER, User

__all__ = [
    "GUEST_USER_ID",
    "ROLE_ADMIN",
    "ROLE_USER",
    "get_by_id",
    "get_by_ids",
    "get_user_by_email",
    "create",
    "update_last_login",
    "reset_fail_count",
    "bump_fail_count",
    "set_login_lock",
    "set_password",
    "bump_token_version",
    "update_status",
    "update_role",
    "list_paged",
    "count",
    "count_all",
    "exists_email",
]


def get_by_id(db: Session, user_id: int) -> User | None:
    """按主键取用户。"""
    return db.get(User, user_id)


def get_by_ids(db: Session, user_ids: list[int]) -> list[User]:
    """一次取回一批用户（管理端任务列表显示「归属用户」，`API-26`）。

    🔒 存在的理由是**避免 N+1**：任务列表每行都要显示归属用户邮箱，
       逐个`get_by_id` 就是每页 N 次查询（20 条 = 20 次主键查）。
       主键查虽然比全表扫便宜，但 20 次往返仍远慢于一条 `IN (...)`。

    ⚠️ 返回顺序**不保证**与入参一致（SQL 无 ORDER BY 承诺），
       调用方需按 id 建字典使用（`admin_service._task_briefs` 即如此）。
    """
    if not user_ids:
        return []
    stmt = select(User).where(User.id.in_(user_ids))
    return list(db.execute(stmt).scalars().all())


def get_user_by_email(db: Session, email: str) -> User | None:
    """按邮箱取用户 —— **全项目唯一的邮箱查询入口**（`WS-1-07`）。

    🔒 `DB-17 / RG-07`：`ux_users_email` 建在 `(email COLLATE NOCASE)` 上，
       查询若写常规 `WHERE email = ?`，**排序规则不匹配 → 索引不生效 →
       全表 SCAN**。必须显式声明 `COLLATE NOCASE` 才能走
       `SEARCH users USING INDEX ux_users_email`（实测见 `explain_queries.py`）。

    ⚠️ 这个坑**危险性在于测不出来**：本机数据量小（几十行），两种写法都是微秒级，
       压测发现不了；用户量上千后每次登录都会全表扫描。故必须单点封装，
       任何地方都不允许再手写邮箱查询。
    """
    stmt = select(User).where(text("email = :email COLLATE NOCASE"))
    return db.execute(stmt, {"email": email}).scalars().first()


def exists_email(db: Session, email: str) -> bool:
    """邮箱是否已存在（注册查重）。内部复用 `get_user_by_email`，保证排序规则一致。"""
    return get_user_by_email(db, email) is not None


def create(
    db: Session,
    *,
    email: str,
    password_hash: str,
    nickname: str | None = None,
    status: int = 1,
    role: str = ROLE_USER,
) -> User:
    """插入用户并 flush（拿自增 id）。提交由调用方（`get_db`）负责。"""
    user = User(
        email=email,
        password_hash=password_hash,
        nickname=nickname,
        status=status,
        role=role,
    )
    db.add(user)
    db.flush()
    return user


def update_last_login(db: Session, user_id: int, at: str) -> int:
    """写入最近登录时间，返回受影响行数。"""
    return (
        db.query(User)
        .filter(User.id == user_id)
        .update({User.last_login_at: at}, synchronize_session=False)
    )


def reset_fail_count(db: Session, user_id: int) -> int:
    """登录成功后清零失败计数并解除冷却。"""
    return (
        db.query(User)
        .filter(User.id == user_id)
        .update({User.fail_count: 0, User.locked_until: None}, synchronize_session=False)
    )


def bump_fail_count(db: Session, user_id: int, locked_until: str | None) -> int:
    """失败次数 +1，并按需写入冷却截止时间。"""
    return (
        db.query(User)
        .filter(User.id == user_id)
        .update(
            {
                User.fail_count: User.fail_count + 1,
                User.locked_until: locked_until,
            },
            synchronize_session=False,
        )
    )


def set_login_lock(db: Session, user_id: int, locked_until: str) -> int:
    """记满失败阈值：写入冷却截止时间，并把失败计数**归零**。

    🔒 两个字段必须在**同一条 UPDATE** 内完成（技术文档 §4.4.3）。
       若拆成「先归零、再写冷却」，中间态会让用户在冷却生效前多拿到一次尝试机会；
       若拆成「先写冷却、再归零」，归零前若再有一次请求进来会立刻再次触发锁定。
    """
    return (
        db.query(User)
        .filter(User.id == user_id)
        .update(
            {User.fail_count: 0, User.locked_until: locked_until},
            synchronize_session=False,
        )
    )


def set_password(db: Session, user_id: int, password_hash: str) -> int:
    """仅更新密码哈希。`token_version` 的自增由 `bump_token_version` 单独负责
    （两步分开是为了让「管理员重置密码」与「用户改密」能复用同一组原子操作）。"""
    return (
        db.query(User)
        .filter(User.id == user_id)
        .update({User.password_hash: password_hash}, synchronize_session=False)
    )


def bump_token_version(db: Session, user_id: int) -> int:
    """`token_version = token_version + 1`，使该用户全部旧 Token 立即失效。

    调用场景：改密（`FR-USR-07`）、管理员重置密码（`CH-01` / `API-25`）。
    """
    return (
        db.query(User)
        .filter(User.id == user_id)
        .update({User.token_version: User.token_version + 1}, synchronize_session=False)
    )


def update_status(db: Session, user_id: int, status: int) -> int:
    """启用/停用（管理端 `API-24`）。"""
    return (
        db.query(User)
        .filter(User.id == user_id)
        .update({User.status: status}, synchronize_session=False)
    )


def update_role(db: Session, user_id: int, role: str) -> int:
    """变更角色（管理端 `API-24`，`CH-01`）。"""
    return (
        db.query(User)
        .filter(User.id == user_id)
        .update({User.role: role}, synchronize_session=False)
    )


def list_paged(
    db: Session,
    *,
    page: int = 1,
    size: int = 20,
    keyword: str | None = None,
    status: int | None = None,
    role: str | None = None,
) -> list[User]:
    """分页查询用户（管理端 `API-23`）。**只读元信息，不返回密码哈希。**

    🔒 这是 `NFR-SEC-02` 隔离红线的显式例外，只允许被 `admin.py` 调用。
    """
    stmt = select(User).where(User.id != GUEST_USER_ID)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(User.email.like(like) | User.nickname.like(like))
    if status is not None:
        stmt = stmt.where(User.status == status)
    if role is not None:
        stmt = stmt.where(User.role == role)
    stmt = stmt.order_by(User.id.desc()).offset((page - 1) * size).limit(size)
    return list(db.execute(stmt).scalars().all())


def count(
    db: Session,
    *,
    keyword: str | None = None,
    status: int | None = None,
    role: str | None = None,
) -> int:
    """配合 `list_paged` 的计数。"""
    stmt = select(func.count()).select_from(User).where(User.id != GUEST_USER_ID)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(User.email.like(like) | User.nickname.like(like))
    if status is not None:
        stmt = stmt.where(User.status == status)
    if role is not None:
        stmt = stmt.where(User.role == role)
    return int(db.execute(stmt).scalar_one())


def count_all(db: Session, *, include_guest: bool = False) -> int:
    """用户总数（管理端看板 `API-22`）。默认排除游客哨兵。"""
    stmt = select(func.count()).select_from(User)
    if not include_guest:
        stmt = stmt.where(User.id != GUEST_USER_ID)
    return int(db.execute(stmt).scalar_one())
