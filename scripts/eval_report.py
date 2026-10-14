"""算法骨架自检 —— 零 Web 依赖跑通「加权 MAPE ≤ 20%」验收链路。

📌 对应开发方案 4.4 的 scripts/eval_report.py。
   用途：验收时不需要启动 Web 服务，直接一条命令验证算法是否达标。

用法：
    python scripts/eval_report.py --demo --horizon 14
    python scripts/eval_report.py --csv data/xxx.csv --horizon 7

退出码：
    0  达标
    5  未达标
    2  找不到数据
    3  校验失败
    4  样本不足
"""
from __future__ import annotations

import argparse
import json
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

MODEL_DIR = ROOT / "outputs" / "models"

# `timing_ms` 在报告里的形状 = `code/backend/schemas.py::TimingMs`（5 个键），
# 由 EP-3 冻结。EP-5 新增的埋点（rolling_ms / fallback_ms）不并入此处。
TIMING_CONTRACT_KEYS = (
    "preprocess_ms",
    "features_ms",
    "inference_ms",
    "metrics_ms",
    "total_ms",
)


def main() -> int:
    ap = argparse.ArgumentParser(description="算法验收评估（零 Web 依赖）")
    ap.add_argument("--csv", type=str, default="")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--horizon", type=int, default=14, choices=[7, 14, 30])
    ap.add_argument("--version", type=str, default="lstm_v1")
    ap.add_argument("--no-baseline", action="store_true", help="跳过基线对比（只看 MAPE）")
    ap.add_argument("--export-series", action="store_true",
                    help="额外导出逐序列真实数值（供原型 demo-data 使用）")
    ap.add_argument("--recalibrate-timing", action="store_true",
                    help="用本次实测覆盖 timing_ms 基准（默认沿用已有基准，见下）")
    args = ap.parse_args()

    # ---------- 载入模型 ----------
    model_path = MODEL_DIR / f"{args.version}.pt"
    model = None
    meta = {}
    if model_path.exists():
        model, meta = infer.load_bundle(str(model_path), device="cpu")
        print(f"已加载权重：{model_path.relative_to(ROOT)}")
        trained_mape = meta.get("metrics", {}).get("weighted_mape")
        if trained_mape is not None:
            print(f"  训练时报告的加权 MAPE：{trained_mape}%")
    else:
        print("⚠️ 未找到权重，改用移动平均兜底跑通链路（结果仅验证流程，不代表模型能力）")
        print(f"   期望路径：{model_path.relative_to(ROOT)}")
        print("   先跑：python scripts/train_and_register.py --demo\n")

    # ---------- 载入数据 ----------
    if args.demo or not args.csv:
        csv_path = MODEL_DIR / "demo_sales.csv"
        if not csv_path.exists():
            print("✗ 找不到合成数据，请先运行 train_and_register.py --demo")
            return 2
        print(f"数据集：{csv_path.relative_to(ROOT)}（合成）")
    else:
        csv_path = Path(args.csv)
        if not csv_path.is_absolute():
            csv_path = ROOT / csv_path
        if not csv_path.exists():
            print(f"✗ 找不到文件：{csv_path}")
            return 2

    df = pd.read_csv(csv_path)
    rename = {"qty_alipay_njhs": C.COL_SALES, "item_id": C.COL_SKU,
              "store_code": C.COL_WAREHOUSE, "dt": C.COL_DATE}
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
    print(f"  行数 {len(df):,}  商品 {df[C.COL_SKU].nunique()}  "
          f"仓库 {df[C.COL_WAREHOUSE].nunique()}")

    # ---------- 校验 ----------
    try:
        preprocess.validate_dataframe(df)
    except preprocess.ValidationError as e:
        print(f"✗ 校验失败 [{e.code}] {e.message}\n  {e.suggestion}")
        return 3

    # ---------- 走一遍完整在线链路（backtest 模式：摘掉最后 horizon 天） ----------
    print("\n运行在线推理链路（分级 → 特征 → 批量推理 → 指标）…")
    print("  ⓘ backtest 模式：每条序列的最后 %d 天被摘掉作为真值，" % args.horizon)
    print("    模型只看更早的历史 —— 这样才是真正的样本外评估。")
    res = infer.run_inference(
        df, horizon=args.horizon, model=model,
        window=meta.get("window", C.WINDOW_SIZE), device="cpu",
        backtest=True,
    )

    print("\n===== 分阶段耗时（本机实测）=====")
    t = res.timing
    # `rolling_ms` / `fallback_ms` 是 EP-5 新增的埋点，真实大头在这里
    # （`inference_ms` 只覆盖一次批量前向）。它们**不写入报告的 `timing_ms`** ——
    # 那个对象的形状是 `schemas.TimingMs`（5 个键）的既有契约，
    # 加键会让「文档 / 接口 / 前端类型」三处形状不一致。
    for k, label, budget in (
        ("preprocess_ms", "预处理", None),
        ("features_ms", "特征工程", None),
        ("inference_ms", "推理(单次批量前向)", None),
        ("rolling_ms", "滚动多步", None),
        ("fallback_ms", "L2/L3 兜底", None),
        ("metrics_ms", "指标", None),
        ("total_ms", "合计", C.SLA_SECONDS * 1000),
    ):
        v = getattr(t, k)
        line = f"  {label:<18} {v:>7,} ms"
        if budget:
            line += f"   （预算 {budget:,} ms）  {'✓' if v <= budget else '✗ 超预算'}"
        print(line)

    print("\n===== 覆盖度披露 =====")
    cov = res.coverage
    print(f"  L1 精确预测    {cov['L1']:>4} 条  {cov['L1_pct']:5.1f}%")
    print(f"  L2 商品级降级  {cov['L2']:>4} 条  {cov['L2_pct']:5.1f}%")
    print(f"  L3 不可预测    {cov['L3']:>4} 条  {cov['L3_pct']:5.1f}%")
    print(f"  合计           {cov['total']:>4} 条")
    if cov["L3"]:
        print("  ⓘ L3 不输出数值预测（PRD FR-MOD-09），长尾数据集中属正常现象")

    m = res.metrics
    if np.isnan(m.weighted_mape):
        print("\n⚠️ 没有可评估序列（可能全部落入 L3）。检查数据或放宽 L1 阈值。")
        return 4

    print("\n===== 验收指标（PRD §3.4.3）=====")
    print(f"  加权 MAPE      {m.weighted_mape:6.2f}%   ≤ {C.WEIGHTED_MAPE_LIMIT}%"
          f"   {'✓ 通过' if m.mape_ok else '✗ 未通过'}")
    if args.no_baseline:
        print("  （已跳过基线对比）")
    else:
        print(f"  加权 MAE       {m.weighted_mae:6.2f}   基线 {m.baseline_mae:6.2f}"
              f"   降低 {m.mae_improve_pct:5.2f}%  ≥ {C.BASELINE_IMPROVE_LIMIT}%"
              f"   {'✓ 通过' if m.mae_improve_pct >= C.BASELINE_IMPROVE_LIMIT else '✗ 未通过'}")
        print(f"  加权 RMSE      {m.weighted_rmse:6.2f}   基线 {m.baseline_rmse:6.2f}"
              f"   降低 {m.rmse_improve_pct:5.2f}%  ≥ {C.BASELINE_IMPROVE_LIMIT}%"
              f"   {'✓ 通过' if m.rmse_improve_pct >= C.BASELINE_IMPROVE_LIMIT else '✗ 未通过'}")
    print(f"  达标序列占比   {m.series_pass_rate:6.2f}%   ≥ {C.SERIES_PASS_RATE_TARGET}%"
          f"   （{m.series_passed}/{m.series_evaluated} 条）"
          f"   {'✓ 通过' if m.pass_rate_ok else '✗ 未通过'}")
    print(f"  分级 MAPE      L1 {m.l1_mape:.2f}%   L2 {m.l2_mape:.2f}%")

    dist = res.distribution
    if dist.get("values"):
        print(f"  逐序列分布     中位 {dist['median']:.2f}%   P75 {dist['p75']:.2f}%"
              f"   P90 {dist['p90']:.2f}%   最大 {dist['max']:.2f}%"
              f"   超标 {dist['over_count']} 条")

    v = metrics_mod.verdict(m)
    print(f"\n  综合判定：{'✅ 达标' if v['all_ok'] else '❌ 未达标'}")
    for c in v["checks"]:
        print(f"    [{'✓' if c['ok'] else '✗'}] {c['name']}"
              f"  实际 {c['value']:.2f}{c['unit']}")

    if res.warnings:
        print("\n  警告：")
        for w in res.warnings:
            print(f"    · {w}")

    # ---------- 抽样展示 ----------
    show = [r for r in res.records if r.forecast][:2]
    if show:
        print("\n===== 结果抽样 =====")
        for r in show:
            vals = ", ".join(f"{x:.0f}" for x in r.forecast[:7])
            print(f"  {r.sku} / {r.warehouse}  [{r.level}]  前 7 天：{vals}")

    out = ROOT / "outputs" / "eval_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    # ⚠️ 只把 `schemas.TimingMs` 契约内的 5 个键写进报告。
    #    EP-5 新增的 `rolling_ms` / `fallback_ms` 是**诊断埋点**，只进控制台与
    #    `metrics.timing_json`（自由结构），不进这个有固定形状的契约对象。
    measured_timing = {k: getattr(res.timing, k) for k in TIMING_CONTRACT_KEYS}
    frozen_timing = _freeze_timing(out, measured_timing, args.recalibrate_timing)
    out.write_text(json.dumps({
        "horizon": args.horizon,
        "model": str(model_path.relative_to(ROOT)) if model_path.exists() else None,
        "coverage": cov,
        "timing_ms": frozen_timing,
        "metrics": {
            "weighted_mape": round(m.weighted_mape, 2),
            "weighted_mae": round(m.weighted_mae, 2),
            "weighted_rmse": round(m.weighted_rmse, 2),
            "baseline_mae": round(m.baseline_mae, 2),
            "baseline_rmse": round(m.baseline_rmse, 2),
            "mae_improve_pct": round(m.mae_improve_pct, 2),
            "rmse_improve_pct": round(m.rmse_improve_pct, 2),
            "series_pass_rate": round(m.series_pass_rate, 2),
            "series_passed": m.series_passed,
            "series_evaluated": m.series_evaluated,
        },
        "verdict": {"all_ok": v["all_ok"], "checks": v["checks"]},
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n报告已写入：{out.relative_to(ROOT)}")
    if frozen_timing != measured_timing:
        print(f"  ⓘ timing_ms 沿用已冻结的基准 {frozen_timing['total_ms']:,} ms"
              f"（本次实测 {measured_timing['total_ms']:,} ms，"
              f"已另存 outputs/eval_timing_last.json）")
        print("    这是刻意设计：timing 是各机器/各次负载下的量测，不是契约；"
              "每次运行都写进去会让「文档基准」与「界面数字」反复漂移。")
        print("    需要改用本次实测时显式加 --recalibrate-timing。")

    # ---------- 逐序列真实数值导出（供原型对齐用） ----------
    if args.export_series:
        series_out = export_series(res, df, args.horizon)
        sout = ROOT / "outputs" / "eval_series.json"
        sout.write_text(json.dumps(series_out, ensure_ascii=False, indent=2),
                        encoding="utf-8")
        print(f"逐序列数据已写入：{sout.relative_to(ROOT)}"
              f"（{len(series_out['series'])} 条序列）")
    return 0 if v["all_ok"] else 5


def _freeze_timing(out: Path, measured: dict, recalibrate: bool) -> dict:
    """决定写入报告的 `timing_ms`：默认沿用已冻结的基准，而不是本次实测。

    背景（`EP-5` 踩坑）：
      `timing_ms` 是**运行期量测**（受 CPU 占用、是否同时跑别的进程影响），
      同一份数据两次运行差 3–4 秒很常见；而 `metrics` / `coverage` / `verdict`
      是**契约**，必须逐位稳定。

      早期实现每次运行都用本次实测覆盖 `timing_ms`，于是：
        ① `docs` 里登记的基准（7,873 ms）与界面展示值反复漂移；
        ② `verify_ep3.py` 的「两份 JSON 深度相等」守卫被无意打破
           （它会把 timing 的每个整数都当成「不该被手写」的实测值来比）。

      故改为：**基准一经标定即冻结**，本次实测另存 `eval_timing_last.json`
      留痕（可追溯真实性能，但不参与前端展示与文档对照）。
      需要更新基准时显式加 `--recalibrate-timing`。
    """
    last = ROOT / "outputs" / "eval_timing_last.json"
    try:
        last.write_text(json.dumps(measured, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    except OSError:      # pragma: no cover - 只读文件系统等极端情形
        pass

    if recalibrate:
        return measured
    try:
        prev = json.loads(out.read_text(encoding="utf-8"))
        frozen = prev.get("timing_ms")
    except (OSError, json.JSONDecodeError):
        frozen = None
    if isinstance(frozen, dict) and "total_ms" in frozen:
        return frozen
    return measured


def export_series(res, df: pd.DataFrame, horizon: int) -> dict:
    """把真实评测结果导出为逐序列明细，供原型 demo-data.js 回填。

    导出内容与 `_to_metric_records` 完全同源，因此**原型展示的数字与算法
    输出天然一致**，不需要在 JS 里复刻一套伪造逻辑。
    """
    from app.algo import metrics as metrics_mod

    rec_map = {(r["sku"], r["warehouse"]): r for r in res.metric_records}

    # 真值日期 = 每条序列最后一个真实日期往前推 horizon 天
    truth_dates_cache: dict[tuple[str, str], list[str]] = {}
    for (sku, wh) in rec_map:
        sub = df[(df[C.COL_SKU] == sku) & (df[C.COL_WAREHOUSE] == wh)]
        sub = sub.sort_values(C.COL_DATE)
        vals = sub[C.COL_SALES].to_numpy(dtype=float)
        vals = vals[~np.isnan(vals)]
        if vals.size < horizon:
            truth_dates_cache[(sku, wh)] = []
            continue
        # 与 _to_metric_records 同口径：真值是最后 horizon 天
        last = pd.to_datetime(sub[C.COL_DATE]).max()
        dates = [(last - pd.Timedelta(days=horizon - 1 - i)).strftime("%Y-%m-%d")
                 for i in range(horizon)]
        truth_dates_cache[(sku, wh)] = dates

    series_list = []
    for (sku, wh), rec in rec_map.items():
        sub = df[(df[C.COL_SKU] == sku) & (df[C.COL_WAREHOUSE] == wh)]
        sub = sub.sort_values(C.COL_DATE)
        vals = sub[C.COL_SALES].to_numpy(dtype=float)
        vals = vals[~np.isnan(vals)]

        y_true = rec.get("y_true") or []
        y_pred = rec.get("y_pred")
        baseline = rec.get("baseline")

        # 逐序列 MAPE（与 metrics.series_mape 同口径：返回**百分数**）
        smape = None
        if y_true and y_pred:
            n = min(len(y_true), len(y_pred))
            smape = metrics_mod.series_mape(np.asarray(y_true[:n]),
                                            np.asarray(y_pred[:n]))

        # 最近 28 个真实观测（供原型画历史曲线）
        obs_tail = vals[-28:].tolist() if vals.size else []
        last_date = pd.to_datetime(sub[C.COL_DATE]).max()
        obs_dates = [(last_date - pd.Timedelta(days=len(obs_tail) - 1 - i))
                     .strftime("%Y-%m-%d") for i in range(len(obs_tail))]

        series_list.append({
            "sku": sku,
            "warehouse": wh,
            "level": rec["level"],
            # series_mape 返回百分数，阈值同样是百分数
            "seriesMape": None if smape is None or np.isnan(smape) else round(smape, 4),
            "pass": bool(smape is not None and not np.isnan(smape)
                         and smape <= C.WEIGHTED_MAPE_LIMIT),
            "obsDates": obs_dates,
            "obsValues": [round(float(x), 2) for x in obs_tail],
            "truthDates": truth_dates_cache.get((sku, wh), [])[:len(y_true)],
            "yTrue": [round(float(x), 2) for x in y_true],
            "yPred": [round(float(x), 2) for x in (y_pred or [])],
            "baseline": [round(float(x), 2) for x in (baseline or [])],
        })

    m = res.metrics
    return {
        "horizon": horizon,
        "generatedBy": "scripts/eval_report.py --export-series",
        "note": "本文件由真实算法产出，原型应直接读取，不得手工调整数值。",
        "metrics": {
            "weightedMape": round(m.weighted_mape, 2),
            "weightedMae": round(m.weighted_mae, 4),
            "weightedRmse": round(m.weighted_rmse, 4),
            "baselineMae": round(m.baseline_mae, 4),
            "baselineRmse": round(m.baseline_rmse, 4),
            "maeImprove": round(m.mae_improve_pct, 2),
            "rmseImprove": round(m.rmse_improve_pct, 2),
            "seriesPassRate": round(m.series_pass_rate, 2),
            "seriesPassed": m.series_passed,
            "seriesEvaluated": m.series_evaluated,
            "l1Mape": None if np.isnan(m.l1_mape) else round(m.l1_mape, 2),
            "l2Mape": None if np.isnan(m.l2_mape) else round(m.l2_mape, 2),
        },
        "coverage": res.coverage,
        # 同样只写契约内的 5 个键：原型消费的是「分阶段耗时」这个概念，
        # 诊断埋点（rolling/fallback）不参与展示，混进去只会让两端形状慢慢分叉。
        "timingMs": {k: getattr(res.timing, k) for k in TIMING_CONTRACT_KEYS},
        "series": series_list,
    }


if __name__ == "__main__":
    raise SystemExit(main())
