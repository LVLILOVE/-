"""`operation_logs` 操作日志表 ORM 实体（`DB-T07`）。

对应 `code/db/schema.sql` 的 `T07` 段。

📌 `user_id` **不建外键**（弱引用）：注册失败时尚无用户；删用户后审计线索必须保留。
   取值域为 **≥ 0 或 NULL** —— `0` 是游客（游客也会产生审计记录），
   NULL 表示完全未登录的系统级事件。

📌 `action` 为 **8 类**（`CH-01` 后）。管理端 4 类写操作（停用/启用用户、
   重置密码、强制删除任务、切换模型版本）统一记 `action='admin'`，
   细分动作写入 `detail`（形如 `sub=user_disable;target_user=3;by=1`，`QD-02` 方案 A）。
"""
from __future__ import annotations

from sqlalchemy import INTEGER, TEXT, CheckConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# 8 类操作
ACTION_LOGIN = "login"
ACTION_REGISTER = "register"
ACTION_LOGOUT = "logout"
ACTION_UPLOAD = "upload"
ACTION_PREDICT = "predict"
ACTION_EXPORT = "export"
ACTION_DELETE = "delete"
ACTION_ADMIN = "admin"          # CH-01：管理端子动作的统一 action

ALL_ACTIONS = (
    ACTION_LOGIN,
    ACTION_REGISTER,
    ACTION_LOGOUT,
    ACTION_UPLOAD,
    ACTION_PREDICT,
    ACTION_EXPORT,
    ACTION_DELETE,
    ACTION_ADMIN,
)

RESULT_SUCCESS = "success"
RESULT_FAIL = "fail"


class OperationLog(Base):
    __tablename__ = "operation_logs"
    __table_args__ = (
        CheckConstraint(
            "action IN ('login', 'register', 'logout', 'upload', 'predict', "
            "'export', 'delete', 'admin')",
            name="ck_operation_logs_action",
        ),
        CheckConstraint(
            "result IN ('success', 'fail')", name="ck_operation_logs_result"
        ),
        Index("ix_oplogs_user_time", "user_id", text("created_at DESC")),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(INTEGER, primary_key=True, autoincrement=True)
    # 弱引用，无外键；未登录操作（如注册失败）可为 NULL
    user_id: Mapped[int | None] = mapped_column(INTEGER, nullable=True, default=None)
    action: Mapped[str] = mapped_column(TEXT, nullable=False)
    # 用 TEXT 以兼容将来的非整数标识（如 UUID 形式的导出文件名）
    target_id: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    result: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("'success'")
    )
    # 错误摘要，不存完整堆栈
    detail: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    ip: Mapped[str | None] = mapped_column(TEXT, nullable=True, default=None)
    created_at: Mapped[str] = mapped_column(
        TEXT, nullable=False, server_default=text("(datetime('now', 'localtime'))")
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<OperationLog id={self.id} action={self.action!r} result={self.result!r}>"
