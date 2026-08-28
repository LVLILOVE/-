"""认证模块测试：登录成功/失败/锁定/未授权访问"""
from tests.conftest import auth


def test_login_success(client):
    r = client.post("/api/admin/auth/login", json={"username": "admin", "password": "testpass123"})
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 0
    assert body["data"]["token"]


def test_login_wrong_password(client):
    r = client.post("/api/admin/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.json()["code"] == 40102


def test_login_lock_after_5_failures(client):
    for _ in range(5):
        r = client.post("/api/admin/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.json()["code"] == 40102
    assert "锁定" in r.json()["msg"]


def test_me_unauthorized(client):
    r = client.get("/api/admin/auth/me")
    assert r.status_code == 401


def test_me_with_token(client, admin_token):
    r = client.get("/api/admin/auth/me", headers=auth(admin_token))
    assert r.json()["code"] == 0
    assert r.json()["data"]["username"] == "admin"
