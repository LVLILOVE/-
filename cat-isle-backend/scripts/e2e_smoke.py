# ============================================================
# 代码段功能：M4 端到端联调冒烟脚本（真实 8000 端口单实例）
# - 覆盖 PRD §11 验收核心：SPA 托管 / 登录鉴权 / 预约全流程 /
#   店休日 / 领养流转+回访 / 内容管理即时生效
# - 用法：先启动 uvicorn app.main:app --port 8000，再执行本脚本
# ============================================================
import httpx
import os
import random
import sys

BASE = "http://localhost:8000"
# 管理员密码：与启动后端时的环境变量一致（启动：ADMIN_PASSWORD=xxx uvicorn ...）
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "change-me")
ok_count = 0
fail_count = 0


def check(name: str, cond: bool, extra: str = ""):
    """断言辅助：打印通过/失败并计数"""
    global ok_count, fail_count
    if cond:
        ok_count += 1
        print(f"  [PASS] {name} {extra}")
    else:
        fail_count += 1
        print(f"  [FAIL] {name} {extra}")


def unique_phone() -> str:
    return "139" + "".join(random.choices("0123456789", k=8))


def main():
    c = httpx.Client(base_url=BASE, timeout=15)

    print("== 1. SPA 静态托管与路由回退 ==")
    r = c.get("/")
    check("首页返回 index.html", r.status_code == 200 and "<div id=\"root\">" in r.text)
    r = c.get("/cats")
    check("SPA 路由 /cats 回退 index.html", r.status_code == 200 and "<div id=\"root\">" in r.text)
    r = c.get("/admin/login")
    check("SPA 路由 /admin/login 回退 index.html", r.status_code == 200 and "<div id=\"root\">" in r.text)
    assets = c.get("/").text.split("src=\"/assets/")[1].split("\"")[0] if "assets" in c.get("/").text else ""
    r = c.get(f"/assets/{assets}")
    check("静态 JS 产物可访问", r.status_code == 200 and len(r.content) > 10000)
    r = c.get("/api/store")
    check("API 正常（/api/store）", r.json().get("code") == 0)

    print("== 2. 后台鉴权（验收项 5）==")
    r = c.get("/api/admin/cats")
    check("未登录访问后台接口返回 401", r.status_code == 401)

    print("== 3. 登录 ==")
    r = c.post("/api/admin/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    check("管理员登录成功", r.json().get("code") == 0)
    token = r.json()["data"]["token"]
    h = {"Authorization": f"Bearer {token}"}

    print("== 4. 预约全流程（验收项 1/3/10）==")
    # 店休日：计算下一个周一
    from datetime import date, timedelta
    today = date.today()
    days = (7 - today.weekday()) % 7 or 7
    monday = (today + timedelta(days=days)).isoformat()
    r = c.get("/api/slots", params={"date": monday})
    check("店休日 slots 返回 is_holiday=true（验收项 3）", r.json()["data"]["is_holiday"] is True)

    r = c.get("/api/slots", params={"date": (today + timedelta(days=1)).isoformat()})
    slots = r.json()["data"]["slots"]
    check("非店休日返回 4 时段", len(slots) == 4 and all(s["remaining"] == 6 for s in slots))

    # 创建预约（预填意向）
    phone = unique_phone()
    r = c.post("/api/reservations", json={
        "name": "验收顾客", "phone": phone, "reserve_date": (today + timedelta(days=1)).isoformat(),
        "slot": "15:00-17:00", "party_size": 2, "has_child": False, "remark": "M4 验收",
    })
    check("提交预约成功（pending_payment）", r.json().get("code") == 0 and r.json()["data"]["status"] == "pending_payment")
    rid = r.json()["data"]["id"]
    no = r.json()["data"]["reservation_no"]

    # 重复提交拒绝（验收项 9 的后半）
    r = c.post("/api/reservations", json={
        "name": "验收顾客", "phone": phone, "reserve_date": (today + timedelta(days=1)).isoformat(),
        "slot": "11:00-13:00", "party_size": 2, "has_child": False, "remark": "",
    })
    check("同手机号同日重复提交被拒（40003）", r.json().get("code") == 40003)

    # 押金凭证 → 核验 → 到店（验收项 1）
    r = c.post(f"/api/reservations/{rid}/payment-proof", json={"phone": phone, "trans_no": "E2E001", "nickname": "验收转账"})
    check("提交押金凭证 → payment_verify", r.json()["data"]["status"] == "payment_verify")
    r = c.put(f"/api/admin/reservations/{rid}/verify-payment", json={"result": "pass"}, headers=h)
    check("店主核验通过 → confirmed", r.json()["data"]["status"] == "confirmed")
    r = c.put(f"/api/admin/reservations/{rid}", json={"action": "arrive"}, headers=h)
    check("到店 → completed", r.json()["data"]["status"] == "completed")

    # 自助取消 + 名额释放（验收项 10）
    phone2 = unique_phone()
    r = c.post("/api/reservations", json={
        "name": "取消测试", "phone": phone2, "reserve_date": (today + timedelta(days=2)).isoformat(),
        "slot": "13:00-15:00", "party_size": 1, "has_child": False, "remark": "",
    })
    rid2 = r.json()["data"]["id"]
    r = c.post(f"/api/reservations/{rid2}/cancel", json={"phone": phone2})
    check("顾客自助取消成功（cancelled）", r.json()["data"]["status"] == "cancelled")
    r = c.post("/api/reservations", json={
        "name": "取消测试", "phone": phone2, "reserve_date": (today + timedelta(days=2)).isoformat(),
        "slot": "13:00-15:00", "party_size": 1, "has_child": False, "remark": "取消后重约",
    })
    check("取消后可重新预约（名额/唯一索引均释放）", r.json().get("code") == 0)

    print("== 5. 领养流程（验收项 4）==")
    r = c.post("/api/adoptions", json={
        "name": "领养验收", "phone": unique_phone(), "city": "杭州",
        "housing": "整租（室友同意）", "experience": "养过猫", "family_agreed": "同意",
        "reason": "希望给猫咪一个温暖的家，已经做好准备", "photos": [],
    })
    aid = r.json()["data"]["id"]
    check("提交领养申请成功", r.json().get("code") == 0)
    for s in ["interview", "home_check", "adopted"]:
        c.put(f"/api/admin/adoptions/{aid}", json={"status": s, "note": "审核推进", "success_story": "它找到了温暖的家"}, headers=h)
    r = c.post(f"/api/admin/adoptions/{aid}/notes", json={"note_date": str(today), "content": "回访 1 个月：状态良好，已疫苗"}, headers=h)
    check("回访记录可登记", r.json().get("code") == 0)
    r = c.get(f"/api/admin/adoptions/{aid}", headers=h)
    check("回访记录可查询", len(r.json()["data"]["notes"]) == 1)
    r = c.get("/api/adopted-cats")
    check("成功案例出现在前台墙", any(w["story"] == "它找到了温暖的家" for w in r.json()["data"]))

    print("== 6. 内容管理即时生效（验收项 6）==")
    r = c.post("/api/admin/cats", json={"name": "验收橘", "persona": "测试猫", "story": "M4 验收新增", "status": "active", "adoptable": 0, "sort_order": 99}, headers=h)
    cid = r.json()["data"]["id"]
    r = c.get("/api/cats")
    check("后台新增猫咪前台立即可见", any(x["name"] == "验收橘" for x in r.json()["data"]))
    c.put(f"/api/admin/cats/{cid}", json={"status": "offline"}, headers=h)
    r = c.get("/api/cats")
    check("下线后前台立即不可见", not any(x["name"] == "验收橘" for x in r.json()["data"]))
    c.delete(f"/api/admin/cats/{cid}", headers=h)
    r = c.get("/api/admin/cats", headers=h)
    check("删除为软删除（后台列表不显示）", not any(x["id"] == cid for x in r.json()["data"]))

    print(f"\n===== 端到端联调结果：{ok_count} 通过 / {fail_count} 失败 =====")
    sys.exit(1 if fail_count else 0)


if __name__ == "__main__":
    main()
