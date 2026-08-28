# ============================================================
# 代码段功能：PRD §11 补充验收（超时/压缩/上传限制）
# - 项2 押金超时：pending_payment 超 2h → 定时任务自动取消并释放名额
# - 项8 上传限制：非图片类型被拒（jpg/png/webp 白名单）
# - 项11 图片压缩：上传 >1MB 大图 → 压缩后体积显著下降
# - 用法：后端已在 8000 运行，本脚本同时直连数据库做超时验证
# ============================================================
import io
import os
import random
import sys
from datetime import datetime, timedelta

# 将项目根加入 sys.path（脚本位于 scripts/ 子目录，需能 import app）
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from PIL import Image
from sqlalchemy import text

BASE = "http://localhost:8000"
ok = fail = 0


def check(name: str, cond: bool, extra: str = ""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  [PASS] {name} {extra}")
    else:
        fail += 1
        print(f"  [FAIL] {name} {extra}")


def main():
    c = httpx.Client(base_url=BASE, timeout=30)

    # ---- 项 8：上传类型限制（非白名单类型被拒）----
    r = c.post("/api/upload", files={"file": ("x.txt", b"hello", "text/plain")})
    check("上传 .txt 被拒（40001）", r.json().get("code") == 40001)

    # ---- 项 11：图片压缩 ----
    # 生成 2000x1500 随机噪点 JPEG（>1MB 且 <5MB 上传上限）
    rnd = random.Random(42)
    img = Image.new("RGB", (2000, 1500))
    img.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(2000 * 1500)])
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=95)
    original_size = buf.tell()
    print(f"    原始图片大小：{original_size / 1024:.0f} KB")
    r = c.post("/api/upload", files={"file": ("big.jpg", buf.getvalue(), "image/jpeg")})
    ok_upload = r.json().get("code") == 0
    check("上传大图成功", ok_upload)
    if ok_upload:
        url = r.json()["data"]["url"]
        dl = c.get(url)
        compressed_size = len(dl.content)
        print(f"    压缩后大小：{compressed_size / 1024:.0f} KB")
        check("压缩后体积显著下降（<原图 60%）", compressed_size < original_size * 0.6)
        check("压缩后长边 ≤1600", Image.open(io.BytesIO(dl.content)).size[0] <= 1600)

    # ---- 项 2：押金超时自动取消 ----
    from app.core.db import SessionLocal, engine
    from app.services.reservation import scan_expired_reservations
    # 直接建一条超时的 pending_payment 记录
    db = SessionLocal()
    try:
        db.execute(text(
            "INSERT INTO reservations (name, phone, reserve_date, slot, party_size, has_child, "
            "remark, status, deposit_amount, created_at, updated_at) VALUES "
            "(:n, :p, :d, :s, 2, 0, '', 'pending_payment', 2000, :ct, :ct)"
        ), {"n": "超时测试", "p": "13811112222", "d": (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d"),
            "s": "11:00-13:00", "ct": datetime.now() - timedelta(hours=3)})
        db.commit()
        # 触发超时扫描（与定时任务同一函数）
        scan_expired_reservations()
        st = db.execute(text("SELECT status FROM reservations WHERE phone='13811112222'")).scalar()
        check("超 2h 未支付自动取消（验收项 2）", st == "cancelled")
    finally:
        db.close()

    print(f"\n===== 补充验收结果：{ok} 通过 / {fail} 失败 =====")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
