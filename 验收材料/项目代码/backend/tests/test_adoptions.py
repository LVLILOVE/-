"""领养测试：申请创建/审核流转/回访记录"""
from tests.conftest import auth, unique_phone


def _adopt(client, phone=None):
    return client.post("/api/adoptions", json={
        "name": "申请人", "phone": phone or unique_phone(), "city": "北京",
        "housing": "整租（室友同意）", "experience": "养过猫",
        "family_agreed": "同意", "reason": "希望给猫咪一个温暖的家",
        "photos": [],
    })


def test_create_adoption_success(client):
    r = _adopt(client)
    assert r.json()["code"] == 0
    assert r.json()["data"]["status"] == "pending"


def test_adoption_flow_to_adopted(client, admin_token):
    aid = _adopt(client).json()["data"]["id"]
    h = auth(admin_token)
    steps = ["interview", "home_check", "adopted"]
    for s in steps:
        r = client.put(f"/api/admin/adoptions/{aid}",
                       json={"status": s, "note": "推进", "success_story": "找到了温暖的家"},
                       headers=h)
        assert r.json()["code"] == 0, r.text
    detail = client.get(f"/api/admin/adoptions/{aid}", headers=h).json()["data"]
    assert detail["status"] == "adopted"
    assert detail["adopted_at"]               # adopted 时写入日期
    assert detail["success_story"] == "找到了温暖的家"
    # 成功案例出现在前台墙
    wall = client.get("/api/adopted-cats").json()["data"]
    assert any(w["story"] == "找到了温暖的家" for w in wall)


def test_adoption_reject(client, admin_token):
    aid = _adopt(client).json()["data"]["id"]
    r = client.put(f"/api/admin/adoptions/{aid}",
                   json={"status": "rejected", "note": "居住条件不符"}, headers=auth(admin_token))
    assert r.json()["data"]["status"] == "rejected"


def test_adoption_invalid_status(client, admin_token):
    aid = _adopt(client).json()["data"]["id"]
    r = client.put(f"/api/admin/adoptions/{aid}", json={"status": "bad_status"},
                   headers=auth(admin_token))
    assert r.json()["code"] == 40001


def test_adoption_notes(client, admin_token):
    aid = _adopt(client).json()["data"]["id"]
    h = auth(admin_token)
    client.put(f"/api/admin/adoptions/{aid}", json={"status": "adopted"}, headers=h)
    n = client.post(f"/api/admin/adoptions/{aid}/notes",
                    json={"note_date": "2026-08-26", "content": "回访 1 个月：状态良好"},
                    headers=h)
    assert n.json()["code"] == 0
    detail = client.get(f"/api/admin/adoptions/{aid}", headers=h).json()["data"]
    assert len(detail["notes"]) == 1
    assert detail["notes"][0]["content"].startswith("回访")


def test_upload_extension_rejected(client):
    r = client.post("/api/upload", files={"file": ("a.txt", b"hello", "text/plain")})
    assert r.json()["code"] == 40001


def test_public_upload_success(client):
    # 1x1 透明 PNG
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d4944415478da63fccf307000000401010005c31e4b0000000049454e44ae426082"
    )
    r = client.post("/api/upload", files={"file": ("cat.png", png, "image/png")})
    assert r.json()["code"] == 0, r.text
    assert r.json()["data"]["url"].startswith("/uploads/adoption/")
