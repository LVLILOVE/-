"""后台：猫咪/餐单管理 + 门店/时段配置 + 统计 + 图片上传"""
import uuid
import os
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.orm import Session
from PIL import Image

from ..models import Cat, MenuItem, StoreSetting, SlotSetting, Reservation, Adoption
from ..core.deps import get_db, get_current_admin
from ..core.response import ok, BizError
from ..core.config import settings

router = APIRouter(prefix="/api/admin", tags=["后台"], dependencies=[Depends(get_current_admin)])

# ===== 猫咪管理 =====
@router.get("/cats")
def cats_list(db: Session = Depends(get_db)):
    rows = db.query(Cat).filter(Cat.deleted == 0).order_by(Cat.sort_order).all()
    return ok([{"id": c.id, "name": c.name, "persona": c.persona, "status": c.status,
                "adoptable": c.adoptable, "sort_order": c.sort_order} for c in rows])


@router.post("/cats")
def cats_create(body: dict, db: Session = Depends(get_db)):
    c = Cat(**{k: v for k, v in body.items() if hasattr(Cat, k)})
    db.add(c)
    db.commit()
    return ok({"id": c.id})


@router.put("/cats/{cid}")
def cats_update(cid: int, body: dict, db: Session = Depends(get_db)):
    c = db.get(Cat, cid)
    if not c:
        raise BizError(40401, "猫咪不存在")
    for k, v in body.items():
        if hasattr(c, k) and k not in ("id", "created_at"):
            setattr(c, k, v)
    c.updated_at = datetime.now()
    db.commit()
    return ok({"id": c.id})


@router.delete("/cats/{cid}")
def cats_delete(cid: int, db: Session = Depends(get_db)):
    c = db.get(Cat, cid)
    if not c:
        raise BizError(40401, "猫咪不存在")
    c.deleted = 1                     # 软删除
    db.commit()
    return ok(None)

# ===== 餐单管理 =====
@router.get("/menu")
def menu_list(db: Session = Depends(get_db)):
    rows = db.query(MenuItem).order_by(MenuItem.sort_order).all()
    return ok([{"id": m.id, "name": m.name, "category": m.category,
                "price": m.price / 100, "status": m.status} for m in rows])


@router.post("/menu")
def menu_create(body: dict, db: Session = Depends(get_db)):
    body = dict(body)
    if "price" in body:
        body["price"] = int(round(float(body["price"]) * 100))   # 元 → 分
    m = MenuItem(**{k: v for k, v in body.items() if hasattr(MenuItem, k)})
    db.add(m)
    db.commit()
    return ok({"id": m.id})


@router.put("/menu/{mid}")
def menu_update(mid: int, body: dict, db: Session = Depends(get_db)):
    m = db.get(MenuItem, mid)
    if not m:
        raise BizError(40401, "菜品不存在")
    for k, v in body.items():
        if hasattr(m, k) and k not in ("id",):
            if k == "price":
                v = int(round(float(v) * 100))
            setattr(m, k, v)
    m.updated_at = datetime.now()
    db.commit()
    return ok({"id": m.id})


@router.delete("/menu/{mid}")
def menu_delete(mid: int, db: Session = Depends(get_db)):
    m = db.get(MenuItem, mid)
    if not m:
        raise BizError(40401, "菜品不存在")
    db.delete(m)                            # 菜品为内容数据，物理删除可接受
    db.commit()
    return ok(None)

# ===== 门店/时段配置 =====
@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return ok({s.key: s.value for s in db.query(StoreSetting).all()})


@router.put("/settings")
def put_settings(body: dict, db: Session = Depends(get_db)):
    for k, v in body.items():
        row = db.get(StoreSetting, k)
        if row:
            row.value = str(v)
        else:
            db.add(StoreSetting(key=k, value=str(v)))
    db.commit()
    return ok(None)


@router.get("/slot-settings")
def get_slots(db: Session = Depends(get_db)):
    rows = db.query(SlotSetting).order_by(SlotSetting.id).all()
    return ok([{"id": s.id, "slot": s.slot, "capacity": s.capacity,
                "is_open": s.is_open, "holidays": s.holidays} for s in rows])


@router.put("/slot-settings")
def put_slots(body: dict, db: Session = Depends(get_db)):
    """body: {"slots":[{id,capacity,is_open}], "holidays":"[1,2]" }"""
    for item in body.get("slots", []):
        s = db.get(SlotSetting, item["id"])
        if s:
            s.capacity = item.get("capacity", s.capacity)
            s.is_open = item.get("is_open", s.is_open)
    if "holidays" in body:
        for s in db.query(SlotSetting).all():
            s.holidays = body["holidays"]
    db.commit()
    return ok(None)

# ===== 统计 =====
@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    today = datetime.now().strftime("%Y-%m-%d")
    return ok({
        "today_reservations": db.query(Reservation).filter(Reservation.reserve_date == today).count(),
        "pending_verify": db.query(Reservation).filter(Reservation.status == "payment_verify").count(),
        "pending_adoptions": db.query(Adoption).filter(Adoption.status == "pending").count(),
        "active_cats": db.query(Cat).filter(Cat.status == "active", Cat.deleted == 0).count(),
        "week_trend": [
            {"date": (datetime.now() - timedelta(days=i)).strftime("%m-%d"),
             "count": db.query(Reservation).filter(Reservation.reserve_date ==
                 (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")).count()}
            for i in range(6, -1, -1)
        ],
    })

# ===== 图片上传 =====
@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in {"jpg", "jpeg", "png", "webp"}:
        raise BizError(40001, "仅支持 jpg/png/webp")
    data = await file.read()
    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise BizError(40001, f"图片不能超过 {settings.MAX_UPLOAD_MB}MB")
    img = Image.open(__import__("io").BytesIO(data))
    img.thumbnail((1600, 1600))                      # 长边 ≤1600，自动压缩
    name = f"{uuid.uuid4().hex}.webp"
    target_dir = Path(settings.UPLOAD_DIR) / "admin"
    target_dir.mkdir(parents=True, exist_ok=True)
    img.save(target_dir / name, "WEBP", quality=80)
    return ok({"url": f"/uploads/admin/{name}"})
