"""滚动多步的耗时拆分（临时脚本）：确认瓶颈到底在哪。

分别计：
  A) 全量建表（优化前语义）
  B) 尾部切片建表（优化后语义）
  C) 模型前向 + .item() 同步
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd
import torch

from app.algo import features, preprocess
from app.algo import infer as algo_infer

df = pd.read_csv("outputs/models/demo_sales.csv")
df["date"] = pd.to_datetime(df["date"])
keys = df.groupby(["sku_id", "warehouse_id"]).size().reset_index(name="n")
sku, wh = keys.sort_values("n", ascending=False).iloc[0][["sku_id", "warehouse_id"]]
sub = df[(df.sku_id == sku) & (df.warehouse_id == wh)].sort_values("date")
vals = sub["sales"].to_numpy(dtype=float)
dates = sub["date"].dt.strftime("%Y-%m-%d").tolist()
print(f"最长序列：{sku}/{wh}  n={len(vals)}")

model, meta = algo_infer.load_bundle("outputs/models/lstm_v1.pt", device="cuda")
sc = preprocess.Scaler.fit(vals)
norm = sc.transform(vals)
W, H = 21, 30

# ---- A) 全量建表 ----
seqA, dA = list(norm), list(dates)
t0 = time.perf_counter()
for _ in range(H):
    _ = features.build_inference_windows(pd.Series(dA), np.asarray(seqA), window=W, holiday=True)
    seqA.append(0.0)
    dA.append("2016-01-01")
tA = (time.perf_counter() - t0) * 1000

# ---- B) 尾部切片建表 ----
keep = W + 2 * 14
seqB, dB = list(norm), list(dates)
t0 = time.perf_counter()
for _ in range(H):
    ds = dB[-keep:] if len(dB) > keep else dB
    ss = seqB[-keep:] if len(seqB) > keep else seqB
    _ = features.build_inference_windows(pd.Series(ds), np.asarray(ss), window=W, holiday=True)
    seqB.append(0.0)
    dB.append("2016-01-01")
tB = (time.perf_counter() - t0) * 1000

# ---- C) 前向 + 同步 ----
x = features.build_inference_windows(pd.Series(dB[-keep:]), np.asarray(seqB[-keep:]),
                                     window=W, holiday=True)
batch = torch.from_numpy(x).to("cuda")
model.eval()
with torch.no_grad():
    model(batch)  # 预热
    t0 = time.perf_counter()
    for _ in range(H):
        v = float(model(batch).item())
    tC = (time.perf_counter() - t0) * 1000

print(f"A 全量建表 x{H}   : {tA:8.1f} ms   ({tA/H:.2f} ms/步)")
print(f"B 尾部建表 x{H}   : {tB:8.1f} ms   ({tB/H:.2f} ms/步)")
print(f"C 前向+item x{H}  : {tC:8.1f} ms   ({tC/H:.2f} ms/步)")
print(f"→ A+C = {tA+tC:.0f} ms /序列；  B+C = {tB+tC:.0f} ms /序列")
print(f"→ 81 序列 x horizon=30 推算：优化前 {(tA+tC)*81/1000:.1f}s，优化后 {(tB+tC)*81/1000:.1f}s")
