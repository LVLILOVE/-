"""预约核心测试：创建/限流满员/防重复/店休/凭证/核验/取消/名额释放"""
from datetime import date, timedelta
from tests.conftest import auth, unique_phone, next_monday


def _tomorrow() -> str:
    return (date.today() + timedelta(days=1)).isoformat()


def _reserve(client, phone=None, day=None, slot="13:00-15:00", party=2):
    return client.post("/api/reservations", json={
        "name": "测试顾客", "phone": phone or unique_phone(),
        "reserve_date": day or _tomorrow(), "slot": slot,
        "party_size": party, "has_child": False, "remark": "",
    })


def test_create_success(client):
    r = _reserve(client)
    assert r.json()["code"] == 0
    data = r.json()["data"]
    assert data["status"] == "pending_payment"
    assert data["deposit_amount"] == 20.0          # 2000 分 → 元
    assert data["reservation_no"].startswith("R")


def test_phone_format_rejected(client):
    r = _reserve(client, phone="12345")
    assert r.json()["code"] == 40001


def test_holiday_rejected(client):
    r = _reserve(client, day=next_monday())
    assert r.json()["code"] == 40004


def test_duplicate_phone_same_day_rejected(client):
    phone = unique_phone()
    assert _reserve(client, phone=phone).json()["code"] == 0
    r = _reserve(client, phone=phone)              # 同日第二次 → 40003
    assert r.json()["code"] == 40003


def test_capacity_full(client):
    day = _tomorrow()
    for i in range(6):                             # 占满 6 组
        assert _reserve(client, day=day).json()["code"] == 0
    r = _reserve(client, day=day)                  # 第 7 单 → 40002
    assert r.json()["code"] == 40002


def test_cancel_releases_capacity_and_allow_retry(client):
    """关键：取消后名额释放，且部分唯一索引允许同手机号同日重新预约"""
    phone = unique_phone()
    day = _tomorrow()
    r = _reserve(client, phone=phone, day=day)
    rid = r.json()["data"]["id"]
    c = client.post(f"/api/reservations/{rid}/cancel", json={"phone": phone})
    assert c.json()["code"] == 0
    # 取消后可再次提交（验证部分唯一索引：cancelled 行不在占用集内）
    r2 = _reserve(client, phone=phone, day=day)
    assert r2.json()["code"] == 0


def test_payment_proof_full_flow(client, admin_token):
    r = _reserve(client)
    rid = r.json()["data"]["id"]
    phone = r.json()["data"]["phone"]
    # 提交凭证
    p = client.post(f"/api/reservations/{rid}/payment-proof",
                    json={"phone": phone, "trans_no": "T123", "nickname": "张三"})
    assert p.json()["data"]["status"] == "payment_verify"
    # 核验通过
    v = client.put(f"/api/admin/reservations/{rid}/verify-payment",
                   json={"result": "pass"}, headers=auth(admin_token))
    assert v.json()["data"]["status"] == "confirmed"
    # 到店完成
    a = client.put(f"/api/admin/reservations/{rid}",
                   json={"action": "arrive"}, headers=auth(admin_token))
    assert a.json()["data"]["status"] == "completed"


def test_payment_proof_wrong_phone(client):
    r = _reserve(client)
    rid = r.json()["data"]["id"]
    p = client.post(f"/api/reservations/{rid}/payment-proof",
                    json={"phone": "13800000000", "nickname": "冒名"})
    assert p.json()["code"] == 40401


def test_verify_reject_then_retry(client, admin_token):
    r = _reserve(client)
    rid = r.json()["data"]["id"]
    phone = r.json()["data"]["phone"]
    client.post(f"/api/reservations/{rid}/payment-proof",
                json={"phone": phone, "nickname": "张三"})
    v = client.put(f"/api/admin/reservations/{rid}/verify-payment",
                   json={"result": "reject", "reason": "转账备注不符"}, headers=auth(admin_token))
    assert v.json()["data"]["status"] == "verify_rejected"
    # 重新提交凭证 → payment_verify
    p2 = client.post(f"/api/reservations/{rid}/payment-proof",
                     json={"phone": phone, "nickname": "张三", "trans_no": "T456"})
    assert p2.json()["data"]["status"] == "payment_verify"


def test_admin_reservation_list_filter(client, admin_token):
    _reserve(client)
    r = client.get("/api/admin/reservations?status=pending_payment", headers=auth(admin_token))
    assert r.json()["code"] == 0
    assert len(r.json()["data"]) >= 1
