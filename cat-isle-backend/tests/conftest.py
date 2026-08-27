"""测试基座：独立测试库 + 种子 + 公共夹具"""
import os
import random

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_catisle.db")
os.environ.setdefault("JWT_SECRET", "test-secret-key")
os.environ.setdefault("ADMIN_USERNAME", "admin")
os.environ.setdefault("ADMIN_PASSWORD", "testpass123")
os.environ.setdefault("RESERVATION_TIMEOUT_MINUTES", "120")
os.environ.setdefault("DEPOSIT_AMOUNT", "2000")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.core.db import SessionLocal, engine
from app.seed import seed
from app.routers import auth as auth_module

@pytest.fixture(scope="session", autouse=True)
def setup_db():
    seed()
    yield
    engine.dispose()
    if os.path.exists("test_catisle.db"):
        os.remove("test_catisle.db")

@pytest.fixture(autouse=True)
def clean_business_tables():
    """每个测试后清空业务表 + 登录锁定状态，保证用例隔离"""
    yield
    auth_module._login_attempts.clear()        # 登录锁定为内存态，测试间必须清理
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM adoption_notes"))
        db.execute(text("DELETE FROM adoptions"))
        db.execute(text("DELETE FROM reservations"))
        db.commit()
    finally:
        db.close()

@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture()
def admin_token(client) -> str:
    r = client.post("/api/admin/auth/login",
                    json={"username": "admin", "password": "testpass123"})
    assert r.status_code == 200 and r.json()["code"] == 0, r.text
    return r.json()["data"]["token"]

def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}

def unique_phone() -> str:
    """生成唯一手机号 139xxxxxxxx"""
    return "139" + "".join(random.choices("0123456789", k=8))

def next_monday() -> str:
    """下一个周一（店休日测试用）"""
    from datetime import date, timedelta
    d = date.today()
    days = (7 - d.weekday()) % 7
    days = days if days else 7
    return (d + timedelta(days=days)).isoformat()
