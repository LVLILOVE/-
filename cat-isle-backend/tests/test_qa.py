# ============================================================
# 代码段功能：店长解答（QA）接口测试
# - 覆盖：提交问题 / 前台仅展示已解答 / 店长解答流转 / 删除 / 鉴权 / 参数校验
# ============================================================
import pytest


def admin_token(client):
    """登录获取管理员 JWT"""
    r = client.post("/api/admin/auth/login", json={"username": "admin", "password": "testpass123"})
    assert r.json()["code"] == 0
    return r.json()["data"]["token"]


def submit_qa(client, question="周末可以带猫来玩吗？", nickname="新客小喵"):
    """前台提交问题"""
    return client.post("/api/qa", json={
        "question": question, "nickname": nickname, "phone": "13900001111",
    })


def test_qa_submit_success(client):
    """顾客提交问题成功，状态为待解答"""
    r = submit_qa(client)
    assert r.json()["code"] == 0
    assert r.json()["data"]["status"] == "pending"


def test_qa_public_only_answered(client):
    """前台列表只展示店长已解答的问题（未解答不可见）"""
    submit_qa(client)
    r = client.get("/api/qa")
    assert r.json()["code"] == 0
    assert r.json()["data"] == []          # 未解答 → 前台看不到

    # 店长解答后前台可见
    token = admin_token(client)
    rows = client.get("/api/admin/qa", headers={"Authorization": f"Bearer {token}"}).json()["data"]
    qid = rows[0]["id"]
    client.put(f"/api/admin/qa/{qid}", json={"answer": "欢迎带猫来社交！店内提供隔离区。"},
               headers={"Authorization": f"Bearer {token}"})
    r = client.get("/api/qa")
    assert len(r.json()["data"]) == 1
    assert r.json()["data"][0]["answer"] == "欢迎带猫来社交！店内提供隔离区。"
    # 手机号不外露
    assert "phone" not in r.json()["data"][0]


def test_qa_admin_answer_flow(client):
    """店长解答：pending → answered，带解答时间"""
    submit_qa(client)
    token = admin_token(client)
    qid = client.get("/api/admin/qa", headers={"Authorization": f"Bearer {token}"}).json()["data"][0]["id"]
    r = client.put(f"/api/admin/qa/{qid}", json={"answer": "可以的，提前预约即可"},
                   headers={"Authorization": f"Bearer {token}"})
    assert r.json()["data"]["status"] == "answered"
    detail = client.get(f"/api/admin/qa?status=answered", headers={"Authorization": f"Bearer {token}"}).json()["data"][0]
    assert detail["answered_at"] != ""


def test_qa_admin_delete(client):
    """店长删除问题后前台同步消失"""
    submit_qa(client)
    token = admin_token(client)
    qid = client.get("/api/admin/qa", headers={"Authorization": f"Bearer {token}"}).json()["data"][0]["id"]
    r = client.delete(f"/api/admin/qa/{qid}", headers={"Authorization": f"Bearer {token}"})
    assert r.json()["code"] == 0
    assert client.get("/api/qa").json()["data"] == []


def test_qa_admin_unauthorized(client):
    """未登录访问后台问答接口返回 401"""
    assert client.get("/api/admin/qa").status_code == 401
    assert client.put("/api/admin/qa/1", json={"answer": "x"}).status_code == 401


def test_qa_invalid_question(client):
    """问题过短（<2 字）被参数校验拒绝（40001）"""
    r = client.post("/api/qa", json={"question": "啊", "nickname": "x"})
    assert r.json()["code"] == 40001
