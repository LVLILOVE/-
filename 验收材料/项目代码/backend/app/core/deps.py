from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from .db import SessionLocal
from .security import decode_token

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_admin(authorization: str = Header(default="")):
    """JWT 校验依赖：Authorization: Bearer <token>"""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": 40101, "msg": "未登录"})
    username = decode_token(authorization[7:])
    if not username:
        raise HTTPException(status_code=401, detail={"code": 40101, "msg": "登录已过期，请重新登录"})
    return username
