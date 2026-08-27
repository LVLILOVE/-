"""前台公开接口：猫咪 / 餐单 / 时段余量 / 门店 / 领养成功案例 / 领养照片上传"""
import io
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy import text, bindparam
from sqlalchemy.orm import Session
from PIL import Image

from ..models import Cat, MenuItem, StoreSetting, Adoption
from ..services.reservation import OCCUPYING
from ..core.deps import get_db
from ..core.response import ok, BizError
from ..core.config import settings

router = APIRouter(prefix="/api", tags=["前台公开"])


@router.get("/cats")
def list_cats(adoptable: int = 0, db: Session = Depends(get_db)):
    q = db.query(Cat).filter(Cat.deleted == 0, Cat.status == "active")
    if adoptable:
        q = q.filter(Cat.adoptable == 1)
    cats = q.order_by(Cat.sort_order).all()
    return ok([{"id": c.id, "name": c.name, "persona": c.persona, "story": c.story,
                "avatar_url": c.avatar_url, "adoptable": c.adoptable} for c in cats])


@router.get("/cats/{cid}")
def get_cat(cid: int, db: Session = Depends(get_db)):
    c = db.get(Cat, cid)
    if not c or c.deleted or c.status != "active":
        return ok(None)
    return ok({"id": c.id, "name": c.name, "persona": c.persona, "story": c.story,
               "breed": c.breed, "age": c.age, "gender": c.gender,
               "neutered": c.neutered, "skills": c.skills, "avatar_url": c.avatar_url,
               "adoptable": c.adoptable})


@router.get("/menu")
def list_menu(db: Session = Depends(get_db)):
    items = db.query(MenuItem).filter(MenuItem.status == "on_sale").order_by(MenuItem.sort_order).all()
    return ok([{"id": m.id, "name": m.name, "category": m.category,
                "price": m.price / 100, "desc": m.desc, "image_url": m.image_url} for m in items])


@router.get("/slots")
def slots(date: str, db: Session = Depends(get_db)):
    """某日各时段余量；店休返回 is_holiday=true"""
    from ..services.reservation import is_holiday, capacity_of
    from sqlalchemy import text
    if is_holiday(db, date):
        return ok({"date": date, "is_holiday": True, "slots": []})
    rows = db.execute(
        text("SELECT slot, capacity FROM slot_settings WHERE is_open=1 ORDER BY id")
    ).fetchall()
    result = []
    for slot, cap in rows:
        used = db.execute(
            text("SELECT COUNT(*) FROM reservations WHERE reserve_date=:d AND slot=:s AND status IN :st")
            .bindparams(bindparam("st", expanding=True)),
            {"d": date, "s": slot, "st": OCCUPYING},
        ).scalar()
        result.append({"slot": slot, "capacity": cap, "remaining": cap - used})
    return ok({"date": date, "is_holiday": False, "slots": result})


@router.get("/store")
def store(db: Session = Depends(get_db)):
    data = {s.key: s.value for s in db.query(StoreSetting).all()}
    return ok(data)


@router.get("/adopted-cats")
def adopted_cats(db: Session = Depends(get_db)):
    rows = db.query(Adoption).filter(
        Adoption.status == "adopted", Adoption.success_story.isnot(None)
    ).order_by(Adoption.updated_at.desc()).all()
    return ok([{"id": a.id, "cat_name": a.cat.name if a.cat else "猫咪",
                "story": a.success_story, "photo": a.success_photo, "adopted_at": a.adopted_at}
               for a in rows])


@router.post("/upload")
async def upload_adoption_photo(file: UploadFile = File(...)):
    """公开上传：仅限领养申请环境照片场景（scene=adoption）；后台图片走 /api/admin/upload"""
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in {"jpg", "jpeg", "png", "webp"}:
        raise BizError(40001, "仅支持 jpg/png/webp")
    data = await file.read()
    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise BizError(40001, f"图片不能超过 {settings.MAX_UPLOAD_MB}MB")
    img = Image.open(io.BytesIO(data))
    img.thumbnail((1600, 1600))
    name = f"{uuid.uuid4().hex}.webp"
    target = Path(settings.UPLOAD_DIR) / "adoption"
    target.mkdir(parents=True, exist_ok=True)
    img.save(target / name, "WEBP", quality=80)
    return ok({"url": f"/uploads/adoption/{name}"})
