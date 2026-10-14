"""
=============================================================================
`_ep5_parity_run.py` · 单设备推理结果落盘器（CPU / GPU 一致性验证的一半）
-----------------------------------------------------------------------------
跑一次推理，把**逐序列预测值**落成一个 JSON，供 `verify_ep5_api.py` 与另一
设备的结果逐点比对。

用法：
    set TORCH_DEVICE=cpu   && python scripts/_ep5_parity_run.py --device cpu   --out x.json
    set TORCH_DEVICE=cuda  && python scripts/_ep5_parity_run.py --device cuda  --out y.json

🔴 **为什么必须分进程跑**：`app.core.model_holder.holder` 是**模块级单例**。
   同进程内改 `settings.torch_device` 再加载会命中已缓存的 GPU 句柄，
   得到「两边一样」的假象。唯一可靠的方式是两个独立进程各跑一份。

🔴 **为什么比对预测值而不是指标**：指标经过四舍五入会掩盖 1e-6 级浮点差异；
   `records[].forecast` 才是真正该逐点比的东西。

🔴 **`backtest=True`**：线上是 `False`（用全部历史预测未来），但那样没有真值可比。
   切末尾 `horizon` 天后预测，两个进程看到的是**完全相同的输入窗口**，
   才是可比的。这也是 `WS-6-04`「评测必须 backtest=True」的同一理由。
=============================================================================
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", required=True, choices=["cpu", "cuda"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--horizon", type=int, default=14)
    args = ap.parse_args()

    # ⚠️ 必须在 import 应用之前设好（config 在模块导入时即读环境变量）
    os.environ["TORCH_DEVICE"] = args.device
    os.environ.setdefault("DB_PATH", str(ROOT / "data" / "tmp" / "verify_ep5" / "app.db"))
    os.environ.setdefault("UPLOAD_DIR", str(ROOT / "data" / "tmp" / "verify_ep5" / "uploads"))
    os.environ.setdefault("EXPORT_DIR", str(ROOT / "data" / "tmp" / "verify_ep5" / "exports"))
    os.environ.setdefault("JWT_SECRET", "verify-ep5-parity-0123456789abcdef")

    import pandas as pd

    from app.algo import config as C
    from app.algo import infer
    from app.core.model_holder import holder, load_active_model

    print("=" * 70)
    print(f"单设备推理 · 请求 {args.device} / TORCH_DEVICE={os.environ['TORCH_DEVICE']}")
    print("=" * 70)

    load_active_model()
    handle = holder.handle
    if handle is None:
        print("[FAIL] 模型未加载成功")
        return 1
    print(f"模型版本：{handle.version}   实际设备：{handle.device}   参数数：{handle.param_count:,}")

    if handle.device != args.device:
        # ⚠️ 不是硬失败：GPU 不可用时 CUDA 侧会被降级，用户可能只跑 CPU。
        #    但必须在输出里如实标记，否则父脚本会把「cuda 实为 cpu」当成通过。
        print(f"[WARN] 请求 {args.device}，实际落在 {handle.device}（可能是无 GPU 导致的降级）")

    # ---------------- 读示例数据集 ----------------
    from sqlalchemy import text as sa_text

    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        row = db.execute(
            sa_text(
                # 🔴 `datasets.status` 是 **INTEGER（1 可用 / -1 已失效）**，
                #    不是字符串枚举。写 `status = 'ready'` 在 SQLite 宽松比较下
                #    不匹配任何行 ⇒ 「库里没有 ready 数据集」的假阴性。
                "SELECT id, file_path FROM datasets WHERE status = 1 ORDER BY id ASC LIMIT 1"
            )
        ).fetchone()
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] 读 datasets 失败：{exc}")
        return 1
    finally:
        db.close()
    if not row:
        print("[FAIL] 库里没有 ready 数据集")
        return 1

    # 🔴 `datasets.file_path` 存的是**相对工作区根目录**的路径
    #    （示例数据集是 `outputs/models/demo_sales.csv`），不是绝对路径。
    #    曾按「绝对路径 / uploads 目录里找」两种猜法都落空 —— 判据要按实际存法来。
    raw = str(row[1])
    cands = [Path(raw), ROOT / raw]
    for cand in cands:
        if cand.is_absolute() and cand.exists():
            path = cand
            break
    else:
        for cand in (
            ROOT / raw,
            ROOT / "data" / "uploads" / Path(raw).name,
            ROOT / "data" / "tmp" / "verify_ep5" / "uploads" / Path(raw).name,
            ROOT / "data" / "tmp" / "ep5_browser" / "uploads" / Path(raw).name,
        ):
            if cand.exists():
                path = cand
                break
        else:
            print(f"[FAIL] 数据集文件不存在：{raw}（试过 {len(cands) + 4} 个候选路径）")
            return 1

    df = pd.read_csv(path)
    df[C.COL_DATE] = pd.to_datetime(df[C.COL_DATE])
    print(f"数据：{path.name}  行数={len(df):,}  商品={df[C.COL_SKU].nunique()}")

    # ---------------- 推理 ----------------
    res = infer.run_inference(
        df,
        horizon=args.horizon,
        model=handle.model,
        feat_names=handle.feat_names,
        window=handle.window,
        holiday=True,
        device=args.device,
        backtest=True,        # 🔒 样本外，否则两边看到的输入窗口不同，不可比
        levels_for_main=("L1",),
    )

    forecasts: dict[str, list[float]] = {}
    for r in res.records:
        if r.forecast:
            forecasts[f"{r.sku}||{r.warehouse}"] = [round(float(v), 8) for v in r.forecast]

    print(f"推理完成：L1 序列数={len(forecasts)}  res.device={res.device}  total={res.timing.total_ms}ms")
    print(f"  覆盖率={res.coverage}")
    if not forecasts:
        print("[FAIL] 没有任何预测值")
        return 1

    dump = {
        "requested_device": args.device,
        "actual_device": handle.device,
        "model_version": handle.version,
        "horizon": args.horizon,
        "backtest": True,
        "coverage": res.coverage,
        "weighted_mape": res.metrics.weighted_mape,
        "timing": {
            "preprocess_ms": res.timing.preprocess_ms,
            "features_ms": res.timing.features_ms,
            "inference_ms": res.timing.inference_ms,
            "rolling_ms": getattr(res.timing, "rolling_ms", 0),
            "fallback_ms": getattr(res.timing, "fallback_ms", 0),
            "metrics_ms": res.timing.metrics_ms,
            "total_ms": res.timing.total_ms,
        },
        "forecasts": forecasts,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dump, ensure_ascii=False), encoding="utf-8")
    print(f"已写出：{out}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())