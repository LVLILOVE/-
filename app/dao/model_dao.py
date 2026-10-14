"""`model_registry` 表数据访问（`DB-T06`）。

🔒 纯 CRUD。**唯一带事务语义的函数是 `activate_version()`** —— 因为它必须
   在同一事务内「先降后升」，否则撞部分唯一索引 `ux_model_active`（`BE-ADM-02`）。
   这里保留在 DAO 层是因为它本质是「两次 UPDATE 的顺序契约」，不是业务规则。

🔒 本模块不得 `import algo`。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.model_registry import ModelRegistry

__all__ = [
    "get_active",
    "get_by_version",
    "list_all",
    "register",
    "deactivate_all",
    "activate_version",
]


def get_active(db: Session) -> ModelRegistry | None:
    """取当前启用版本（`is_active = 1`，全库至多一条；命中 `IX-07`）。"""
    stmt = select(ModelRegistry).where(ModelRegistry.is_active == 1)
    return db.execute(stmt).scalars().first()


def get_by_version(db: Session, version: str) -> ModelRegistry | None:
    stmt = select(ModelRegistry).where(ModelRegistry.version == version)
    return db.execute(stmt).scalars().first()


def list_all(db: Session) -> list[ModelRegistry]:
    """模型版本列表（管理端 `API-28`）。"""
    stmt = select(ModelRegistry).order_by(ModelRegistry.id.desc())
    return list(db.execute(stmt).scalars().all())


def register(db: Session, **fields) -> ModelRegistry:
    """注册新版本（离线脚本 `train_and_register.py` 使用）。"""
    row = ModelRegistry(**fields)
    db.add(row)
    db.flush()
    return row


def deactivate_all(db: Session) -> int:
    """把当前启用版本降级为 0。"""
    return (
        db.query(ModelRegistry)
        .filter(ModelRegistry.is_active == 1)
        .update({ModelRegistry.is_active: 0}, synchronize_session=False)
    )


def activate_version(db: Session, version: str) -> int:
    """切换启用版本 —— 🔒 **顺序固定，不可颠倒**（`BE-ADM-02` / `API-29`）。

    部分唯一索引 `ux_model_active ON model_registry (is_active) WHERE is_active = 1`
    保证全局至多一个启用版本。因此必须先降旧、再升新：

        ① UPDATE model_registry SET is_active = 0 WHERE is_active = 1
        ② UPDATE model_registry SET is_active = 1 WHERE version = ?

    ⏱️ 实测：分两次提交、或顺序颠倒，第二次 UPDATE 会命中
       `UNIQUE constraint failed: model_registry.is_active`。
       调用方必须在**同一事务**内完成（`get_db` 已保证：一次请求一个事务）。

    :return: 受影响的「新版本」行数（0 表示 version 不存在）。
    """
    deactivate_all(db)
    return (
        db.query(ModelRegistry)
        .filter(ModelRegistry.version == version)
        .update({ModelRegistry.is_active: 1}, synchronize_session=False)
    )
