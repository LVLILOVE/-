"""预约：前台提交/凭证/状态/取消 + 后台核验/操作"""
import json
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..models import Reservation, SlotSetting
from ..schemas import ReservationCreate, PaymentProofIn, CancelIn, VerifyPaymentIn, AdminActionIn
from ..services.reservation import create_reservation, submit_payment_proof, customer_cancel, OCCUPYING
from ..core.deps import get_db, get_current_admin
from ..core.response import ok, BizError

router = APIRouter(prefix="/api", tags=["预约"])


def _no(rid: int, date: str) -> str:
    return f"R{date.replace('-', '')}-{rid:04d}"


def _dump(r: Reservation) -> dict:
    return {
        "id": r.id,
        "reservation_no": _no(r.id, r.reserve_date),
        "name": r.name, "phone": r.phone,
        "reserve_date": r.reserve_date, "slot": r.slot,
        "party_size": r.party_size, "has_child": r.has_child, "remark": r.remark,
        "status": r.status,
        "deposit_amount": r.deposit_amount / 100,
        "verify_reject_reason": r.verify_reject_reason,
        "cancel_reason": r.cancel_reason,
    }


# ===== 前台 =====
@router.post("/reservations")
def create(body: ReservationCreate, db: Session = Depends(get_db)):
    # 防重复：同手机号同日已存在占用中预约 → 40003（唯一索引兜底 + 友好提示）
    dup = db.query(Reservation).filter(
        Reservation.phone == body.phone,
        Reservation.reserve_date == body.reserve_date,
        Reservation.status.in_(("pending_payment", "payment_verify", "verify_rejected", "confirmed")),
    ).first()
    if dup:
        raise BizError(40003, "您当日已有预约，请勿重复提交")
    r = create_reservation(db, body)
    return ok(_dump(r))


@router.post("/reservations/{rid}/payment-proof")
def proof(rid: int, body: PaymentProofIn, db: Session = Depends(get_db)):
    r = submit_payment_proof(db, rid, body.phone, json.dumps({"trans_no": body.trans_no, "nickname": body.nickname}))
    return ok(_dump(r))


@router.get("/reservations/status")
def status(rid: int, phone: str, db: Session = Depends(get_db)):
    r = db.get(Reservation, rid)
    if not r or r.phone != phone:
        raise BizError(40401, "预约单不存在或手机号不匹配")
    return ok(_dump(r))


@router.post("/reservations/{rid}/cancel")
def cancel(rid: int, body: CancelIn, db: Session = Depends(get_db)):
    customer_cancel(db, rid, body.phone)
    return ok(_dump(db.get(Reservation, rid)))


# ===== 后台（JWT）=====
@router.get("/admin/reservations", dependencies=[Depends(get_current_admin)])
def admin_list(date: str = "", status: str = "", phone: str = "", db: Session = Depends(get_db)):
    q = db.query(Reservation)
    if date:
        q = q.filter(Reservation.reserve_date == date)
    if status:
        q = q.filter(Reservation.status == status)
    if phone:
        q = q.filter(Reservation.phone.like(f"%{phone}%"))
    rows = q.order_by(Reservation.reserve_date.desc(), Reservation.id.desc()).limit(100).all()
    return ok([_dump(r) for r in rows])


@router.get("/admin/reservations/overview", dependencies=[Depends(get_current_admin)])
def admin_overview(date: str, db: Session = Depends(get_db)):
    """某日时段余量总览：各时段已约/容量（后台日历视图）"""
    from sqlalchemy import text, bindparam
    rows = db.query(SlotSetting).order_by(SlotSetting.id).all()
    result = []
    for s in rows:
        used = db.execute(
            text("SELECT COUNT(*) FROM reservations WHERE reserve_date=:d AND slot=:s AND status IN :st")
            .bindparams(bindparam("st", expanding=True)),
            {"d": date, "s": s.slot, "st": OCCUPYING},
        ).scalar()
        result.append({"slot": s.slot, "capacity": s.capacity,
                       "booked": used, "remaining": s.capacity - used, "is_open": s.is_open})
    return ok({"date": date, "slots": result})


@router.put("/admin/reservations/{rid}/verify-payment", dependencies=[Depends(get_current_admin)])
def verify_payment(rid: int, body: VerifyPaymentIn, db: Session = Depends(get_db)):
    r = db.get(Reservation, rid)
    if not r:
        raise BizError(40401, "预约不存在")
    if r.status != "payment_verify":
        raise BizError(40005, "仅押金待核验状态可核验")
    if body.result == "pass":
        r.status = "confirmed"
        r.payment_verified_at = datetime.now()
    elif body.result == "reject":
        r.status = "verify_rejected"
        r.verify_reject_reason = body.reason
    else:
        raise BizError(40001, "result 仅支持 pass/reject")
    db.commit()
    return ok(_dump(r))


@router.put("/admin/reservations/{rid}", dependencies=[Depends(get_current_admin)])
def admin_action(rid: int, body: AdminActionIn, db: Session = Depends(get_db)):
    r = db.get(Reservation, rid)
    if not r:
        raise BizError(40401, "预约不存在")
    if body.action == "cancel":
        r.status, r.cancel_reason = "cancelled", body.reason or "店主取消"
    elif body.action == "arrive":
        if r.status != "confirmed":
            raise BizError(40005, "仅已确认可标记到店")
        r.status = "completed"
    elif body.action == "no_show":
        if r.status != "confirmed":
            raise BizError(40005, "仅已确认可标记爽约")
        r.status = "no_show"
    else:
        raise BizError(40001, "action 非法")
    r.updated_at = datetime.now()
    db.commit()
    return ok(_dump(r))
