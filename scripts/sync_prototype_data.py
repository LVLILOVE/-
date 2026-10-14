"""把真实算法评测结果同步进原型 demo-data.js。

背景（为什么需要这个脚本）
------------------------------------------------------------------
原型早期为了让页面好看，在 `prototype/assets/demo-data.js` 里手写了一套
「合成指标」（MAPE 17.6 / MAE↓37.8 / 达标 66.7），并用一套伪随机流程
在浏览器里现算。而真实算法 `scripts/eval_report.py` 的产出是
MAPE 14.26 / MAE↓26.42 / 达标 83.95。两套数字长期并存，答辩时一旦被问
"这个数从哪来"就答不上来。

本脚本做的事
------------------------------------------------------------------
读取 `outputs/eval_series.json`（由 eval_report.py --export-series 生成），
把**真实指标**与**逐序列真实数值**写成一个 JS 常量块，注入 demo-data.js 的
`REAL_EVAL`。demo-data.js 的 `buildDataset()` / `computeTaskMetrics()`
会优先使用该常量，缺失时才回落到旧的合成逻辑。

这样做的价值
------------------------------------------------------------------
1. 原型展示的每个数字都能追溯到一次真实的算法运行，可复现、可核对。
2. 重训模型后只需重跑两条命令，原型自动跟上，不会再产生"两套数字"。
3. 不引入 fetch/网络依赖 —— 常量内联，file:// 打开也能用。

用法
------------------------------------------------------------------
    python scripts/eval_report.py --horizon 14 --export-series
    python scripts/sync_prototype_data.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERIES_JSON = ROOT / "outputs" / "eval_series.json"
TARGET_JS = ROOT / "prototype" / "assets" / "demo-data.js"

BEGIN = "/* ===== REAL_EVAL:BEGIN（由 scripts/sync_prototype_data.py 自动生成，请勿手改）===== */"
END = "/* ===== REAL_EVAL:END ===== */"


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    i = min(len(sorted_vals) - 1, int(round(p / 100.0 * (len(sorted_vals) - 1))))
    return round(sorted_vals[i], 2)


def build_block(data: dict) -> str:
    m = data["metrics"]
    cov = data["coverage"]
    series = data["series"]

    l1 = [s for s in series if s["level"] == "L1"]
    mapes = sorted(s["seriesMape"] for s in l1 if s["seriesMape"] is not None)

    # 直方图区间：0-5,5-10,...,>50（与 PRD FR-VIS-08 一致）
    buckets = [0] * 12
    for v in mapes:
        idx = min(len(buckets) - 1, int(v // 5))
        buckets[idx] += 1

    # 逐序列精简记录（保留绘图所需字段，控制体积）
    slim = []
    for s in series:
        slim.append({
            "k": f"{s['sku']}-{s['warehouse']}",
            "sku": s["sku"],
            "wh": s["warehouse"],
            "lv": s["level"],
            "mape": s["seriesMape"],
            "pass": s["pass"],
            "dates": s["truthDates"],
            "y": s["yTrue"],
            "p": s["yPred"],
            "b": s["baseline"],
            "od": s["obsDates"],
            "ov": s["obsValues"],
        })

    payload = {
        "source": "outputs/eval_series.json",
        "horizon": data["horizon"],
        "generatedBy": data.get("generatedBy", ""),
        "metrics": {
            "weightedMape": m["weightedMape"],
            "weightedMae": m["weightedMae"],
            "weightedRmse": m["weightedRmse"],
            "baselineMae": m["baselineMae"],
            "baselineRmse": m["baselineRmse"],
            "maeImprove": m["maeImprove"],
            "rmseImprove": m["rmseImprove"],
            "seriesPassRate": m["seriesPassRate"],
            "seriesPassed": m["seriesPassed"],
            "seriesEvaluated": m["seriesEvaluated"],
            "l1Mape": m["l1Mape"],
            "l2Mape": m["l2Mape"],
        },
        "coverage": {
            "L1": cov["L1"], "L2": cov["L2"], "L3": cov["L3"],
            "total": cov["total"],
            "L1_pct": round(cov["L1_pct"], 1),
            "L2_pct": round(cov["L2_pct"], 1),
            "L3_pct": round(cov["L3_pct"], 1),
        },
        "distribution": {
            "values": mapes,
            "median": _percentile(mapes, 50),
            "p75": _percentile(mapes, 75),
            "p90": _percentile(mapes, 90),
            "max": round(mapes[-1], 2) if mapes else None,
            "overCount": sum(1 for v in mapes if v > 20.0),
            "threshold": 20.0,
            "buckets": buckets,
        },
        "timingMs": data["timingMs"],
        "series": slim,
    }

    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return (
        f"{BEGIN}\n"
        "/*\n"
        " * 以下数值来自一次真实的算法评测运行，不是手写的示例数字。\n"
        " * 复现方式：\n"
        " *   python scripts/eval_report.py --horizon 14 --export-series\n"
        " *   python scripts/sync_prototype_data.py\n"
        f" * 数据来源文件：{payload['source']}（horizon={payload['horizon']}）\n"
        " *\n"
        " * ⚠️ 如需更新数值，请重跑上面两条命令，不要手工修改本块内容，\n"
        " *    否则原型与算法会再次出现「两套数字」的问题。\n"
        " */\n"
        f"const REAL_EVAL = {body};\n"
        f"{END}"
    )


def main() -> int:
    if not SERIES_JSON.exists():
        print(f"✗ 找不到 {SERIES_JSON.relative_to(ROOT)}")
        print("  请先运行：python scripts/eval_report.py --horizon 14 --export-series")
        return 2

    data = json.loads(SERIES_JSON.read_text(encoding="utf-8"))
    block = build_block(data)

    src = TARGET_JS.read_text(encoding="utf-8")

    if BEGIN in src and END in src:
        head = src[: src.index(BEGIN)]
        tail = src[src.index(END) + len(END):]
        out = head + block + tail
        action = "已更新"
    else:
        # 首次注入：放在"确定性伪随机"之前，保证后续函数都能引用
        marker = "/* ---------- 2. 确定性伪随机 ---------- */"
        if marker not in src:
            print("✗ 找不到注入锚点，请检查 demo-data.js 结构")
            return 3
        out = src.replace(marker, block + "\n\n" + marker, 1)
        action = "已注入"

    TARGET_JS.write_text(out, encoding="utf-8")

    m = data["metrics"]
    print(f"✓ {action} {TARGET_JS.relative_to(ROOT)}")
    print(f"  序列 {len(data['series'])} 条"
          f"（L1 {data['coverage']['L1']} / L2 {data['coverage']['L2']}"
          f" / L3 {data['coverage']['L3']}）")
    print(f"  加权 MAPE {m['weightedMape']}%   MAE↓{m['maeImprove']}%"
          f"   RMSE↓{m['rmseImprove']}%   达标 {m['seriesPassRate']}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
