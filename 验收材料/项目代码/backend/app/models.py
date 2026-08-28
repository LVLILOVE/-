from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, CheckConstraint, Index
from sqlalchemy.orm import relationship

from .core.db import Base

def now():
    return datetime.now()

# ===== 1 管理员 =====
class AdminUser(Base):
    __tablename__ = "admin_user"
    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(200), nullable=False)
    created_at = Column(DateTime, nullable=False, default=now)

# ===== 2 猫咪档案 =====
class Cat(Base):
    __tablename__ = "cats"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False)
    persona = Column(String(50))
    story = Column(String(200))
    breed = Column(String(50))
    age = Column(String(20))
    gender = Column(String(10))
    neutered = Column(Integer, nullable=False, default=0, server_default="0")
    skills = Column(String(200))
    avatar_url = Column(String(300))
    adoptable = Column(Integer, nullable=False, default=0, server_default="0")
    status = Column(String(20), nullable=False, default="active", server_default="active")
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")
    deleted = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, nullable=False, default=now)
    updated_at = Column(DateTime, nullable=False, default=now, onupdate=now)

    __table_args__ = (
        CheckConstraint("neutered IN (0,1)"),
        CheckConstraint("adoptable IN (0,1)"),
        CheckConstraint("status IN ('active','offline')"),
        CheckConstraint("deleted IN (0,1)"),
    )

# ===== 3 餐单 =====
class MenuItem(Base):
    __tablename__ = "menu_items"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False)
    category = Column(String(20), nullable=False)
    price = Column(Integer, nullable=False)          # 分
    desc = Column(String(200))                       # SQL 关键字：ORM 自动转义
    image_url = Column(String(300))
    status = Column(String(20), nullable=False, default="on_sale", server_default="on_sale")
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, nullable=False, default=now)
    updated_at = Column(DateTime, nullable=False, default=now, onupdate=now)

    __table_args__ = (
        CheckConstraint("category IN ('coffee','tea','dessert','cat_snack')"),
        CheckConstraint("price >= 0"),
        CheckConstraint("status IN ('on_sale','off_shelf')"),
    )

# ===== 4 预约 =====
class Reservation(Base):
    __tablename__ = "reservations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False)
    phone = Column(String(20), nullable=False)
    reserve_date = Column(String(10), nullable=False)
    slot = Column(String(20), nullable=False)
    party_size = Column(Integer, nullable=False)
    has_child = Column(Integer, nullable=False, default=0, server_default="0")
    remark = Column(Text)
    status = Column(String(20), nullable=False, default="pending_payment", server_default="pending_payment")
    deposit_amount = Column(Integer, nullable=False)   # 分，提交时快照
    payment_proof = Column(Text)                       # JSON {trans_no?, nickname}
    verify_reject_reason = Column(String(200))
    payment_verified_at = Column(DateTime)
    cancel_reason = Column(String(200))
    created_at = Column(DateTime, nullable=False, default=now)
    updated_at = Column(DateTime, nullable=False, default=now, onupdate=now)

    __table_args__ = (
        CheckConstraint("length(phone) >= 11"),
        CheckConstraint("length(reserve_date) = 10"),
        CheckConstraint("party_size BETWEEN 1 AND 6"),
        CheckConstraint("has_child IN (0,1)"),
        CheckConstraint("status IN ('pending_payment','payment_verify','verify_rejected','confirmed','completed','cancelled','no_show')"),
        CheckConstraint("deposit_amount >= 0"),
        Index("idx_res_date_slot", "reserve_date", "slot", "status"),
        Index("idx_res_phone", "phone"),
        Index("idx_res_status", "status"),
        # 防重复部分唯一索引（phone+reserve_date，WHERE 过滤占用中 4 状态）：
        # 不能在此声明为无条件 UniqueConstraint —— 否则取消/完成后行仍占唯一键，无法重新预约。
        # 由 seed.py::create_partial_indexes() 以原生 SQL 创建（SQLAlchemy 无法表达 WHERE 条件）。
    )

# ===== 5 领养申请 =====
class Adoption(Base):
    __tablename__ = "adoptions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    cat_id = Column(Integer, ForeignKey("cats.id"), nullable=True)
    name = Column(String(50), nullable=False)
    phone = Column(String(20), nullable=False)
    city = Column(String(50), nullable=False)
    housing = Column(String(100), nullable=False)
    experience = Column(String(200))
    family_agreed = Column(String(100))
    reason = Column(Text, nullable=False)
    photos = Column(Text)                              # JSON 数组
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    admin_note = Column(Text)
    adopted_at = Column(String(10))
    success_story = Column(Text)
    success_photo = Column(String(300))
    created_at = Column(DateTime, nullable=False, default=now)
    updated_at = Column(DateTime, nullable=False, default=now, onupdate=now)

    cat = relationship("Cat")
    __table_args__ = (
        CheckConstraint("length(phone) >= 11"),
        CheckConstraint("status IN ('pending','interview','home_check','adopted','rejected')"),
        Index("idx_adopt_status", "status"),
        Index("idx_adopt_cat", "cat_id"),
    )

# ===== 6 领养回访 =====
class AdoptionNote(Base):
    __tablename__ = "adoption_notes"
    id = Column(Integer, primary_key=True, autoincrement=True)
    adoption_id = Column(Integer, ForeignKey("adoptions.id"), nullable=False)
    note_date = Column(String(10), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=now)

    __table_args__ = (Index("idx_notes_adoption", "adoption_id"),)

# ===== 7 门店配置 =====
class StoreSetting(Base):
    __tablename__ = "store_settings"
    key = Column(String(50), primary_key=True)
    value = Column(Text)

# ===== 8 时段容量 =====
class SlotSetting(Base):
    __tablename__ = "slot_settings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    slot = Column(String(20), unique=True, nullable=False)
    capacity = Column(Integer, nullable=False, default=6, server_default="6")
    is_open = Column(Integer, nullable=False, default=1, server_default="1")
    holidays = Column(Text, nullable=False, default="[1]", server_default="[1]")

    __table_args__ = (
        CheckConstraint("capacity > 0"),
        CheckConstraint("is_open IN (0,1)"),
    )

# ===== 9 店长解答（顾客提问 / 店长解答 / 前台展示）=====
class Qa(Base):
    """问答表：前台顾客提问，后台店长解答；前台仅展示已解答的问题"""
    __tablename__ = "qa"
    id = Column(Integer, primary_key=True, autoincrement=True)
    question = Column(Text, nullable=False)          # 问题内容
    nickname = Column(String(30), nullable=False)     # 提问昵称
    phone = Column(String(11))                        # 联系电话（店长回访用，前台不展示）
    status = Column(String(20), nullable=False, default="pending", server_default="pending")  # pending/answered
    answer = Column(Text)                             # 店长解答
    answered_at = Column(DateTime)                    # 解答时间
    created_at = Column(DateTime, nullable=False, default=now)
    updated_at = Column(DateTime, nullable=False, default=now)

    __table_args__ = (
        CheckConstraint("status IN ('pending','answered')"),
        Index("idx_qa_status", "status"),
    )
