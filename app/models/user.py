"""`users` 用户表 ORM 实体（`DB-T01`）。

对应 `code/db/schema.sql` 的 `T01` / `T01a` 段。

🔒 时间字段一律 `TEXT`（`Mapped[str]`），不使用 `DateTime`：
   依据 `NFR-COMP-04`「全部日期按本地时区处理，不引入 UTC 转换」。
"""
from __future__ import annotations

from sqlalchemy import INTEGER, TEXT, CheckConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# 游客哨兵账号 id（`JT-10` / `FR-USR-08`）
GUEST_USER_ID = 0

ROLE_USER = "user"
ROLE_ADMIN = "admin"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("status IN (0, 1)", name="ck_users_status"),
        CheckConstraint("role IN ('user', 'admin')", name="ck_users_role"),
        CheckConstraint("token_version >= 1", name="ck_users_token_version"),
        # email 唯一性用 COLLATE NOCASE：Alice@x.com 与 alice@x.com 视为同一账号。
        # ⚠️ 查询时必须显式写 WHERE email = ? COLLATE NOCASE，否则索引失效（DB-17）。
        Index("ux_users_email", text("email COLLATE NOCASE"), unique=True),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(INTEGER, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(TEXT, nullable=False)
    password_hash: Mapped[str] = mapped_column(TEXT, nullable=False)
    nickname: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    status: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("1")
    )
    # CH-01：角色。user 普通用户 / admin 管理员
    role: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("'user'")
    )
    fail_count: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("0")
    )
    locked_until: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    last_login_at: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    token_version: Mapped[int] = mapped_column(
        INTEGER, nullable=False, server_default=text("1")
    )
    created_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )
    updated_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )

    @property
    def is_admin(self) -> bool:
        """是否管理员（供 `get_current_admin` 与前端导航派生使用）。"""
        return self.role == ROLE_ADMIN

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<User id={self.id} email={self.email!r} role={self.role!r}>"
