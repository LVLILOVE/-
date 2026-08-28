from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import json

from ..models import AdminUser, Reservation
from ..schemas import LoginIn, LoginOut
from ..core.deps import get_db, get_current_admin
from ..core.security import hash_password, verify_password, create_access_token
from ..core.response import ok, fail, BizError
from ..core.config import settings

router = APIRouter(prefix="/api/admin/auth", tags=["认证"])

# 登录失败计数（内存态，单实例可接受；重启清零）
_login_attempts: dict[str, dict] = {}
MAX_ATTEMPTS = 5
LOCK_MINUTES = 15


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    rec = _login_attempts.get(body.username)
    if rec and rec["locked_until"] and datetime_now() < rec["locked_until"]:
        return fail(40102, "尝试次数过多，账号已锁定 15 分钟")

    admin = db.query(AdminUser).filter(AdminUser.username == body.username).first()
    if not admin or not verify_password(body.password, admin.password_hash):
        rec = _login_attempts.setdefault(body.username, {"count": 0, "locked_until": None})
        rec["count"] += 1
        if rec["count"] >= MAX_ATTEMPTS:
            from datetime import timedelta
            rec["locked_until"] = datetime_now() + timedelta(minutes=LOCK_MINUTES)
            rec["count"] = 0
            return fail(40102, "连续失败 5 次，账号已锁定 15 分钟")
        return fail(40102, "用户名或密码错误")

    _login_attempts.pop(body.username, None)
    return ok(LoginOut(token=create_access_token(admin.username), expires_in=settings.JWT_EXPIRE_MINUTES).model_dump())


@router.get("/me")
def me(username: str = Depends(get_current_admin)):
    return ok({"username": username})


def datetime_now():
    from datetime import datetime
    return datetime.now()
