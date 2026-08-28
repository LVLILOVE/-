"""初始化：建表 + 种子数据 + 部分唯一索引（对齐数据库设计文档 §4）"""
from sqlalchemy import text

from .core.db import Base, engine, SessionLocal
from .core.config import settings
from .core.security import hash_password
from .models import AdminUser, SlotSetting, StoreSetting

DEFAULT_SLOTS = ["11:00-13:00", "13:00-15:00", "15:00-17:00", "17:00-19:00"]


def create_partial_indexes():
    """部分唯一索引（SQLAlchemy 无法声明 WHERE 条件，需原生 SQL 创建）"""
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_res_phone_date "
            "ON reservations(phone, reserve_date) "
            "WHERE status IN ('pending_payment','payment_verify','verify_rejected','confirmed')"
        ))


def seed():
    Base.metadata.create_all(bind=engine)
    create_partial_indexes()
    db = SessionLocal()
    try:
        if db.query(AdminUser).count() == 0:
            db.add(AdminUser(username=settings.ADMIN_USERNAME,
                             password_hash=hash_password(settings.ADMIN_PASSWORD)))
        if db.query(SlotSetting).count() == 0:
            for s in DEFAULT_SLOTS:
                db.add(SlotSetting(slot=s, capacity=6, is_open=1))
        if not db.get(StoreSetting, "deposit_amount"):
            db.add(StoreSetting(key="deposit_amount", value=str(settings.DEPOSIT_AMOUNT)))
        if not db.get(StoreSetting, "store_name"):
            db.add(StoreSetting(key="store_name", value="猫屿 CAT ISLE"))
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
    print("数据库初始化完成")
