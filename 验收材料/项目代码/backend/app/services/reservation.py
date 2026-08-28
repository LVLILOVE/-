"""预约核心业务：限流防超卖、状态机、凭证、超时扫描（对齐数据库设计文档 §5）"""
from datetime import datetime, timedelta

from sqlalchemy import text, bindparam
from sqlalchemy.orm import Session

from ..models import Reservation, SlotSetting
from ..core.response import BizError
from ..core.config import settings

OCCUPYING = ("pending_payment", "payment_verify", "verify_rejected", "confirmed")

# 通用：状态占用集 IN 查询（expanding 绑定参数展开为 IN 列表）
OCCUPYING_IN = text(
    "SELECT COUNT(*) FROM reservations WHERE reserve_date=:d AND slot=:s AND status IN :st"
).bindparams(bindparam("st", expanding=True))

def get_holidays(db: Session) -> set[int]:
    row = db.query(SlotSetting).first()
    if not row:
        return {1}
    try:
        return set(__import__("json").loads(row.holidays))
    except Exception:
        return {1}

def is_holiday(db: Session, reserve_date: str) -> bool:
    weekday = datetime.strptime(reserve_date, "%Y-%m-%d").weekday() + 1  # 1=周一
    return weekday in get_holidays(db)

def capacity_of(db: Session, slot: str) -> int:
    row = db.query(SlotSetting).filter(SlotSetting.slot == slot, SlotSetting.is_open == 1).first()
    return row.capacity if row else 0

def create_reservation(db: Session, data) -> Reservation:
    """核心：校验 + 限流 + 落库（必须 BEGIN IMMEDIATE 获取写锁防超卖）"""
    if is_holiday(db, data.reserve_date):
        raise BizError(40004, "店休日不可预约")
    cap = capacity_of(db, data.slot)
    if cap <= 0:
        raise BizError(40004, "该时段未开放")

    db.execute(text("BEGIN IMMEDIATE"))
    try:
        occupied = db.execute(OCCUPYING_IN, {"d": data.reserve_date, "s": data.slot, "st": OCCUPYING}).scalar()
        if occupied >= cap:
            raise BizError(40002, "该时段已约满")

        r = Reservation(
            name=data.name, phone=data.phone,
            reserve_date=data.reserve_date, slot=data.slot,
            party_size=data.party_size, has_child=int(data.has_child),
            remark=data.remark,
            status="pending_payment",
            deposit_amount=settings.DEPOSIT_AMOUNT,
        )
        db.add(r)
        db.commit()
        db.refresh(r)
        return r
    except Exception:
        db.rollback()
        raise

def submit_payment_proof(db: Session, rid: int, phone: str, proof: str):
    r = db.get(Reservation, rid)
    if not r or r.phone != phone:
        raise BizError(40401, "预约单不存在或手机号不匹配")
    # 允许：待支付押金 → 押金待核验；核验未通过 → 重新提交（PRD 状态机）
    if r.status not in ("pending_payment", "verify_rejected"):
        raise BizError(40005, "当前状态不可提交凭证")
    r.payment_proof = proof
    r.status = "payment_verify"
    r.updated_at = datetime.now()
    db.commit()
    return r

def customer_cancel(db: Session, rid: int, phone: str):
    r = db.get(Reservation, rid)
    if not r or r.phone != phone:
        raise BizError(40401, "预约单不存在或手机号不匹配")
    if r.status not in ("pending_payment", "payment_verify", "verify_rejected"):
        raise BizError(40005, "已确认后取消请联系店主")
    r.status = "cancelled"
    r.cancel_reason = "顾客自助取消"
    r.updated_at = datetime.now()
    db.commit()

def scan_expired_reservations():
    """定时任务：超时未支付 / 核验未通过超时 → 自动取消释放名额"""
    from ..core.db import SessionLocal
    db = SessionLocal()
    try:
        timeout = settings.RESERVATION_TIMEOUT_MINUTES
        db.execute(
            text("UPDATE reservations SET status='cancelled', cancel_reason='超时未支付自动取消', "
                 "updated_at=:t WHERE status='pending_payment' AND created_at < :cut"),
            {"t": datetime.now(), "cut": datetime.now() - timedelta(minutes=timeout)},
        )
        db.execute(
            text("UPDATE reservations SET status='cancelled', cancel_reason='核验未通过超时', "
                 "updated_at=:t WHERE status='verify_rejected' AND updated_at < :cut"),
            {"t": datetime.now(), "cut": datetime.now() - timedelta(hours=2)},
        )
        db.commit()
    finally:
        db.close()
