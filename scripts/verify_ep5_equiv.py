"""
=============================================================================
EP-5 · 滚动多步「改造前后逐位等价」验证（WS-5-05 性能修复的正确性证据）
-----------------------------------------------------------------------------
背景：`EP-5` 实测发现 60 秒 SLA 的真实瓶颈是 `algo.infer._roll_multistep` ——
     它每一步都调用 `features.build_inference_windows`，而后者是
     「先对整条序列建 pandas 特征表、再取最后 window 行」。
     一条序列被重复建表 horizon 次，于是
     horizon=30 / 113 序列端到端 72.2 s，**击穿 60 s 硬约束**。

修复：日期一次算好（`features.calendar_matrix`）+ 窗口用纯 numpy 构造
     （`features.last_window_fast`）。

🔒 本脚本的作用：**证明修复是等价的，不是近似的**。
   做法是把改造前的实现逐字保留在本脚本里当「参考实现」（`reference_roll`），
   对真实数据集里**每一条 L1 序列**、每一个步长，逐位比对两条路径的滚动预测。

   判据（全部必须成立）：
     ① 步数相同；
     ② `np.array_equal` —— float64 完全相同，而不是"差距很小"。

用法：python scripts/verify_ep5_equiv.py [--horizon 7|14|30]（默认三档全跑）
=============================================================================
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd
import torch

from app.algo import classify, features, preprocess
from app.algo import infer as algo_infer
from app.algo import metrics as metrics_mod

PASS = 0
FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        print(f"  ❌ {name}   {detail}")


def reference_roll(
    model, scaler, norm, date_strs, horizon, window, holiday, device, first_pred,
    target_mode, baseline_window,
) -> list[float]:
    """**改造前**的 `_roll_multistep`，逐字照抄（含日期推进与 first_pred 收尾）。"""
    seq = list(np.asarray(norm, dtype=float))
    dates = list(date_strs)
    out: list[float] = []
    sigma = scaler.std
    last_date = pd.to_datetime(dates[-1]) if dates else None

    for _ in range(horizon):
        xw = features.build_inference_windows(
            pd.Series(dates), np.asarray(seq), window=window, holiday=holiday
        )
        if xw.shape[0] == 0:
            break
        with torch.no_grad():
            v = float(model(torch.from_numpy(xw).to(device)).item())
        if target_mode == features.TARGET_RESIDUAL:
            raw_hist = scaler.inverse(np.asarray(seq, dtype=float))
            base_now = metrics_mod.moving_average_forecast(raw_hist, 1, baseline_window)[0]
            real = features.residual_to_value(v, base_now, sigma)
        else:
            real = float(scaler.inverse(np.array([v]))[0])
        real = max(0.0, real)
        out.append(real)
        seq.append(float(scaler.transform(np.array([real]))[0]))
        if last_date is not None:
            last_date = last_date + pd.Timedelta(days=1)
            dates.append(last_date.strftime("%Y-%m-%d"))

    if first_pred is not None and out:
        raw_hist = scaler.inverse(np.asarray(seq[: len(norm)], dtype=float))
        base_now = metrics_mod.moving_average_forecast(raw_hist, 1, baseline_window)[0]
        if target_mode == features.TARGET_RESIDUAL:
            out[0] = max(0.0, features.residual_to_value(first_pred, base_now, sigma))
        else:
            out[0] = max(0.0, float(scaler.inverse(np.array([first_pred]))[0]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=0, help="0 = 三档全跑")
    ap.add_argument("--csv", default="outputs/models/demo_sales.csv")
    ap.add_argument("--model", default="outputs/models/lstm_v1.pt")
    args = ap.parse_args()

    horizons = [args.horizon] if args.horizon else [7, 14, 30]
    df = pd.read_csv(ROOT / args.csv)
    df["date"] = pd.to_datetime(df["date"])

    model, meta = algo_infer.load_bundle(str(ROOT / args.model), device="cpu")
    window = int(meta.get("window") or 21)
    holiday = True
    device = "cpu"

    infos = classify.classify_series(df)
    l1_keys = classify.l1_series(infos)
    print(f"数据集：{len(infos)} 条序列，其中 L1 {len(l1_keys)} 条；window={window}")
    print("设备：cpu（等价性验证不需要 GPU，也避免显存/温度抖动）\n")

    for horizon in horizons:
        print(f"===== horizon = {horizon} =====")
        n_eq = n_diff = 0
        worst = 0.0
        for sku, wh in l1_keys:
            sub = df[(df.sku_id == sku) & (df.warehouse_id == wh)].sort_values("date")
            vals = sub["sales"].to_numpy(dtype=float)
            if len(vals) < window:
                continue
            date_strs = sub["date"].dt.strftime("%Y-%m-%d").tolist()
            scaler = preprocess.Scaler.fit(vals)
            norm = scaler.transform(vals)

            xw0 = features.build_inference_windows(
                pd.Series(date_strs), np.asarray(norm), window=window, holiday=holiday
            )
            if xw0.shape[0] == 0:
                continue
            model.eval()
            with torch.no_grad():
                first = float(model(torch.from_numpy(xw0).to(device)).item())

            new = algo_infer._roll_multistep(  # noqa: SLF001
                model, scaler, norm, date_strs, horizon, window, holiday, device,
                first_pred=first,
            )
            old = reference_roll(
                model, scaler, norm, date_strs, horizon, window, holiday, device, first,
                features.TARGET_MODE, 7,
            )
            if len(new) != len(old) or not np.array_equal(np.asarray(new), np.asarray(old)):
                n_diff += 1
                if len(new) == len(old):
                    worst = max(worst, float(np.max(np.abs(np.asarray(new) - np.asarray(old)))))
            else:
                n_eq += 1

        total = n_eq + n_diff
        check(
            f"horizon={horizon}：{total} 条 L1 序列的滚动结果与改造前逐位相同",
            n_diff == 0 and total > 0,
            f"{n_diff} 条不同，最大差 {worst:.6g}",
        )

    print(f"\n{'='*60}\n通过 {PASS} 项，失败 {FAIL} 项")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
