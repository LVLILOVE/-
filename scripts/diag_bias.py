"""诊断：为什么 MAE 只降 11.67%，而 RMSE 降 20.52%？

假设：递归多步预测中，预测值被拉向"平均值"。
- RMSE 对大步长大误差敏感 → 模型避开了大误差 → 降低明显
- MAE 对大误差不敏感 → 反映的是"平均来说预测值偏多少"
如果模型把预测值压得过平（趋向均值），MAE 改善就会远小于 RMSE 改善。

本脚本量化：预测值的波动幅度 vs 真值的波动幅度（"扁平化"程度）。
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
from app.algo import classify, infer, metrics as metrics_mod, preprocess, train  # noqa: E402

csv_path = ROOT / "outputs" / "models" / "demo_sales.csv"
df = pd.read_csv(csv_path)
df = preprocess.clean_dataframe(df)
infos = classify.classify_series(df)

model, meta = infer.load_bundle(str(ROOT / "outputs" / "models" / "lstm_v1.pt"), device="cpu")
window = meta.get("window", C.WINDOW_SIZE)

records = train.evaluate_on_holdout(model, df, infos, horizon=14, window=window, device="cpu")

print("=" * 78)
print(f"{'序列':<24}{'真值均值':>10}{'真值std':>10}{'预测均值':>10}{'预测std':>10}{'std比':>8}{'MAPE%':>8}")
print("=" * 78)

ratios = []
rows = []
for r in records:
    if not r.get("y_true") or r.get("y_pred") is None:
        continue
    yt = np.asarray(r["y_true"], dtype=float)
    yp = np.asarray(r["y_pred"], dtype=float)
    if yt.size == 0 or yt.mean() == 0:
        continue
    ratio = (yp.std() / yt.std()) if yt.std() > 1e-9 else float("nan")
    mape = metrics_mod.series_mape(yt, yp)
    ratios.append(ratio)
    rows.append((r["sku"], r["warehouse"], yt.mean(), yt.std(), yp.mean(), yp.std(), ratio, mape))

rows.sort(key=lambda x: (x[6] if not np.isnan(x[6]) else 9))
for sku, wh, ym, ys, pm, ps, ratio, mape in rows[:14]:
    print(f"{sku+'/'+wh:<24}{ym:>10.1f}{ys:>10.2f}{pm:>10.1f}{ps:>10.2f}{ratio:>8.2f}{mape:>8.1f}")

print("...")
for sku, wh, ym, ys, pm, ps, ratio, mape in rows[-6:]:
    print(f"{sku+'/'+wh:<24}{ym:>10.1f}{ys:>10.2f}{pm:>10.1f}{ps:>10.2f}{ratio:>8.2f}{mape:>8.1f}")

arr = np.asarray([r for r in ratios if not np.isnan(r)])
print("=" * 78)
print(f"\n预测值波动 / 真值波动 的比值：")
print(f"  中位数 {np.median(arr):.3f}   均值 {arr.mean():.3f}   最小 {arr.min():.3f}   最大 {arr.max():.3f}")
print(f"  < 0.5 的序列数：{int((arr < 0.5).sum())} / {len(arr)}")
print(f"  < 0.8 的序列数：{int((arr < 0.8).sum())} / {len(arr)}")
print("\n解读：比值远小于 1 说明预测被压平（向均值收缩）——")
print("     这会让 MAE 改善远小于 RMSE 改善，并压低达标序列占比。")

# 分位数诊断：真值 vs 预测的极值覆盖
all_true = np.concatenate([np.asarray(r["y_true"], dtype=float) for r in records
                           if r.get("y_true") and r.get("y_pred") is not None])
all_pred = np.concatenate([np.asarray(r["y_pred"], dtype=float) for r in records
                           if r.get("y_true") and r.get("y_pred") is not None])
print("\n总体分布对比：")
print(f"{'':<12}{'mean':>10}{'std':>10}{'p10':>10}{'p50':>10}{'p90':>10}{'max':>10}")
for name, a in (("真值", all_true), ("预测", all_pred)):
    print(f"{name:<12}{a.mean():>10.2f}{a.std():>10.2f}"
          f"{np.percentile(a,10):>10.2f}{np.percentile(a,50):>10.2f}"
          f"{np.percentile(a,90):>10.2f}{a.max():>10.2f}")
