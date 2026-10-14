"""诊断残差尺度：模型理论上能弥补多少？

关键概念：
    基线（移动平均）相对真值的平均绝对误差，用 σ 归一化后就是"残差 MAE"。
    这个值就是模型能改善的**上限** —— 模型再好也只能把这个误差降到接近 0。
    如果残差 MAE 本身就不大，那"优于基线 15%"就很难达成，问题不在模型而在数据。
"""
from __future__ import annotations

import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np                                          # noqa: E402
import pandas as pd                                         # noqa: E402

from app.algo import config as C                            # noqa: E402
from app.algo import classify, features, preprocess         # noqa: E402


df = pd.read_csv(ROOT / "outputs" / "models" / "demo_sales.csv")
df = preprocess.clean_dataframe(df)
infos = classify.classify_series(df)

rows = []
for (sku, wh), info in infos.items():
    if info.level != "L1":
        continue
    sub = df[(df[C.COL_SKU] == sku) & (df[C.COL_WAREHOUSE] == wh)].sort_values(C.COL_DATE)
    vals = sub[C.COL_SALES].to_numpy(float)
    tr, va, te = preprocess.chronological_split(len(vals))
    sc = preprocess.Scaler.fit(vals[tr])
    norm = sc.transform(vals)
    ws = features.build_windows(sub[C.COL_DATE].reset_index(drop=True), norm,
                                window=21, horizon=1, sigma=sc.std, target_mode="resid")
    if ws.y.size < 10:
        continue
    rows.append((sc.std, float(np.std(vals)), float(np.mean(vals)),
                 float(np.std(ws.y)), float(np.mean(np.abs(ws.y)))))

a = np.array(rows)
print("=" * 62)
print(f"序列数 {len(a)}")
print(f"{'sigma':>10}{'原std':>10}{'原mean':>10}{'残差std':>10}{'残差MAE':>10}")
print("=" * 62)
for r in a[:10]:
    print(f"{r[0]:>10.2f}{r[1]:>10.2f}{r[2]:>10.1f}{r[3]:>10.2f}{r[4]:>10.2f}")

print()
print(f"残差 std   中位 {np.median(a[:,3]):.3f}   均值 {a[:,3].mean():.3f}"
      f"   P10 {np.percentile(a[:,3],10):.2f}   P90 {np.percentile(a[:,3],90):.2f}")
print(f"残差 MAE   中位 {np.median(a[:,4]):.3f}   均值 {a[:,4].mean():.3f}")
print()
print("解读：")
print("  残差 MAE = 基线相对真值的平均绝对误差（以 sigma 计）")
print("           = 模型理论上能弥补的上限")
print("  残差 std >> 1 说明 sigma 低估了序列波动")
print("  (促销尖峰被截断后，剩余的波动仍不均匀)")

# sigma vs 真实 std 的关系
ratio = a[:, 1] / np.where(a[:, 0] > 0, a[:, 0], 1)
print()
print(f"原std / sigma 的比值：中位 {np.median(ratio):.3f}  均值 {ratio.mean():.3f}")
print("  接近 1 说明训练段与整段波动一致；明显 > 1 说明验证/测试段波动更大")
