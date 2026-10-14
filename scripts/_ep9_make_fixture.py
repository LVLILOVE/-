"""`EP-9` 校验链回归的 fixture 准备脚本（辅助，非校验脚本，不进 `verify_ep9.py` 清单）。

## 为什么需要它

`EP-6` 的浏览器走查（`verify_ep6_browser.mjs`）**硬编码依赖一个已存在的
游客成功任务**（`TASK_ID`，默认 `19`）—— 它整段都在**无 token** 的游客态下
访问 `/result/:id`，所以该任务必须是游客的（`user_id = 0`）。

`EP-9` 的链路回归跑在独立临时库（`data/tmp/ep9_chain/`）上，库里没有这个任务，
于是 `EP-6` 走查会以「指标卡 4 张 — 实际 0」+ `[FATAL] weighted_mape` 收场。
这不是产品缺陷，是**夹具缺失**。

## 用法

    python scripts/_ep9_make_fixture.py [API_BASE]

输出最后一行形如 `TASK_ID=37`，供上游走查脚本使用：

    TASK_ID=37 APP_URL=http://127.0.0.1:5199 API_URL=http://127.0.0.1:8021 \
      node scripts/verify_ep6_browser.mjs
"""

from __future__ import annotations

import json
import math
import random
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta
from pathlib import Path

API = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8021").rstrip("/")
OUT = Path("data/tmp/ep9_chain/fixture")
OUT.mkdir(parents=True, exist_ok=True)

# 🔴 本机设了 `HTTP_PROXY/HTTPS_PROXY`，标准库会用它去代理 `127.0.0.1` ⇒ 连接被截断。
#    必须显式装一个「空代理」opener，等价于浏览器的 `--no-proxy-server`。
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http(method: str, path: str, *, payload: dict | None = None,
         files: dict | None = None, headers: dict | None = None) -> dict:
    h = dict(headers or {})
    body: bytes | None = None
    if files:
        boundary = "----ep9fixture" + uuid.uuid4().hex
        chunks: list[bytes] = []
        for name, (fname, content, ctype) in files.items():
            chunks.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
                f'filename="{fname}"\r\nContent-Type: {ctype}\r\n\r\n'.encode()
                + content + b"\r\n"
            )
        chunks.append(f"--{boundary}--\r\n".encode())
        body = b"".join(chunks)
        h["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif payload is not None:
        body = json.dumps(payload).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=body, headers=h, method=method)
    with _OPENER.open(req, timeout=300) as r:
        return json.loads(r.read().decode())


def build_csv() -> Path:
    """20 条 L1 序列 + 12 条 L2 序列。

    L1 段取 220 天：跨过 L1 建模门槛（90 点），又不至于让夹具变成负担，
    并刻意保留周内波动 + 月度促销尖峰（`EP-6` 走查会核对营销节点相关曲线）。

    L2 段（4 商品 × 3 仓 × 各 50 天）：**必须真实存在 L2 序列**，否则
    `EP-6` 走查的「按 L2 过滤只返回 L2」用例会拿到空集、断言恒假
    （`EP-9` 链路回归实际踩到过）。分级规则见 `app/algo/classify.py`：
    本仓有效 50 < 90，但同商品跨仓聚合 150 ≥ 90 ⇒ 判 L2。
    """
    p = OUT / "ep6_fixture.csv"
    d0 = date(2015, 1, 1)
    whs = ["上海仓", "广州仓", "北京仓", "成都仓", "武汉仓"]
    rnd = random.Random(42)
    lines = ["sku_id,warehouse_id,date,sales"]

    # ---- L1 段 ----
    for s in range(20):
        sku = f"item_{s:04d}"
        wh = whs[s % len(whs)]
        base = rnd.randint(40, 200)
        for d in range(220):
            weekly = 1.0 + 0.25 * math.sin(d / 7.0 * 2 * math.pi)
            promo = base * 0.9 if d % 30 < 3 else 0.0
            noise = rnd.gauss(0, base * 0.08)
            v = max(0, int(base * weekly + promo + noise))
            lines.append(f"{sku},{wh},{d0 + timedelta(days=d)},{v}")

    # ---- L2 段 ----
    for s in range(4):
        sku = f"sparse_{s:04d}"
        base = rnd.randint(30, 80)
        for wh in whs[:3]:
            for d in range(50):
                weekly = 1.0 + 0.20 * math.sin(d / 7.0 * 2 * math.pi)
                v = max(0, int(base * weekly + rnd.gauss(0, base * 0.10)))
                lines.append(f"{sku},{wh},{d0 + timedelta(days=d)},{v}")

    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


def main() -> int:
    csv = build_csv()
    n_rows = len(csv.read_text(encoding="utf-8").splitlines()) - 1
    n_series = len({
        (ln.split(",")[0], ln.split(",")[1])
        for ln in csv.read_text(encoding="utf-8").splitlines()[1:] if ln
    })
    print(f"夹具 {csv.name}：{n_rows} 行 / {n_series} 序列（20 条 L1 + 12 条 L2）")

    # ① 上传（**不带 token** ⇒ 游客哨兵 user_id=0）
    up = http("POST", "/api/v1/datasets",
              files={"file": (csv.name, csv.read_bytes(), "text/csv")})
    if up.get("code") != 0:
        print("上传失败：", json.dumps(up, ensure_ascii=False)[:300])
        return 1
    ds = (up.get("data") or {}).get("dataset") or up.get("data") or {}
    ds_id = ds.get("id") or up.get("dataset_id")
    print(f"数据集 dataset_id={ds_id} series={(ds.get('series_count') or ds.get('series'))}")

    # ② 建任务（同样不带 token）
    cr = http("POST", "/api/v1/predictions", payload={"dataset_id": ds_id, "horizon": 14})
    if cr.get("code") != 0:
        print("建任务失败：", json.dumps(cr, ensure_ascii=False)[:300])
        return 1
    task_id = (cr.get("data") or {}).get("task_id") or cr.get("task_id")
    print(f"任务已创建 task_id={task_id}，等待完成……")

    # ③ 轮询（`EP-9` 性能基线：示例规模端到端约 12 s，给足 180 s）
    deadline = time.time() + 180
    while time.time() < deadline:
        st = http("GET", f"/api/v1/predictions/{task_id}/status")
        d = st.get("data") or {}
        status = d.get("status")
        if status in ("succeeded", "failed"):
            print(f"终态 status={status} error_code={d.get('error_code')}")
            if status != "succeeded":
                return 1
            print(f"TASK_ID={task_id}")
            return 0
        time.sleep(2)
    print("超时：任务 180 s 内未到终态")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
