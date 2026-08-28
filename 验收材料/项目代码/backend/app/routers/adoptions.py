"""领养：前台提交 + 后台审核流转/回访"""
import json
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..models import Adoption, AdoptionNote
from ..schemas import AdoptionCreate, AdoptionFlowIn, AdoptionNoteIn
from ..core.deps import get_db, get_current_admin
from ..core.response import ok, BizError

router = APIRouter(prefix="/api", tags=["领养"])

FLOW = {"pending", "interview", "home_check", "adopted", "rejected"}


@router.post("/adoptions")
def create_adoption(body: AdoptionCreate, db: Session = Depends(get_db)):
    a = Adoption(
        cat_id=body.cat_id, name=body.name, phone=body.phone, city=body.city,
        housing=body.housing, experience=body.experience, family_agreed=body.family_agreed,
        reason=body.reason, photos=json.dumps(body.photos, ensure_ascii=False),
        status="pending",
    )
    db.add(a)
    db.commit()
    return ok({"id": a.id, "status": a.status})


@router.get("/admin/adoptions", dependencies=[Depends(get_current_admin)])
def admin_list(status: str = "", db: Session = Depends(get_db)):
    q = db.query(Adoption)
    if status:
        q = q.filter(Adoption.status == status)
    rows = q.order_by(Adoption.created_at.desc()).all()
    return ok([{"id": a.id, "name": a.name, "phone": a.phone, "city": a.city,
                "cat_name": a.cat.name if a.cat else None, "status": a.status,
                "created_at": a.created_at.strftime("%Y-%m-%d %H:%M")} for a in rows])


@router.get("/admin/adoptions/{aid}", dependencies=[Depends(get_current_admin)])
def admin_detail(aid: int, db: Session = Depends(get_db)):
    a = db.get(Adoption, aid)
    if not a:
        raise BizError(40401, "申请不存在")
    notes = db.query(AdoptionNote).filter(AdoptionNote.adoption_id == aid).order_by(AdoptionNote.note_date).all()
    return ok({
        "id": a.id, "cat_id": a.cat_id, "name": a.name, "phone": a.phone, "city": a.city,
        "housing": a.housing, "experience": a.experience, "family_agreed": a.family_agreed,
        "reason": a.reason, "photos": json.loads(a.photos or "[]"), "status": a.status,
        "admin_note": a.admin_note, "adopted_at": a.adopted_at,
        "success_story": a.success_story, "success_photo": a.success_photo,
        "notes": [{"date": n.note_date, "content": n.content} for n in notes],
    })


@router.put("/admin/adoptions/{aid}", dependencies=[Depends(get_current_admin)])
def admin_flow(aid: int, body: AdoptionFlowIn, db: Session = Depends(get_db)):
    a = db.get(Adoption, aid)
    if not a:
        raise BizError(40401, "申请不存在")
    if body.status not in FLOW:
        raise BizError(40001, "状态非法")
    a.status = body.status
    if body.note:
        a.admin_note = body.note
    if body.status == "adopted":
        a.adopted_at = datetime.now().strftime("%Y-%m-%d")
        if body.success_story:
            a.success_story = body.success_story
        if body.success_photo:
            a.success_photo = body.success_photo
    a.updated_at = datetime.now()
    db.commit()
    return ok({"id": a.id, "status": a.status})


@router.post("/admin/adoptions/{aid}/notes", dependencies=[Depends(get_current_admin)])
def add_note(aid: int, body: AdoptionNoteIn, db: Session = Depends(get_db)):
    if not db.get(Adoption, aid):
        raise BizError(40401, "申请不存在")
    n = AdoptionNote(adoption_id=aid, note_date=body.note_date, content=body.content)
    db.add(n)
    db.commit()
    return ok({"id": n.id})
