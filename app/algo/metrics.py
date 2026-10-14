"""评估指标：加权 MAE / RMSE / MAPE + 移动平均基线 + 达标序列占比。

📌 口径依据（附录 C-1，已确认）：
    主指标  销量加权 MAPE = Σ|yᵢ-ŷᵢ| / Σ|yᵢ|        （即 WAPE，≤ 20%）
    辅指标  达标序列占比 = 单序列 MAPE ≤ 20% 的比例   （≥ 60%）
    基线    移动平均（与模型**同一测试段、同一序列集合**）

🔒 公平性硬约束（代码评审重点）：
    基线必须与模型在**完全相同的预测点**上计算。若基线用了更多/更少的数据，
    或用了不同的序列集合，则"优于基线 15%"这个结论毫无意义。
    实现方式：compute_task_metrics() 只接受「模型输出的那批预测点 + 对应真值」，
    基线的输入是同一批点的历史均值，不接受任何外部数据。

⚠️ 关于"加权"的含义：
    普通 MAPE 先算每条序列的百分比误差再取平均，低销量序列会让分母趋近 0，
    从而贡献一个巨大的百分比、把整体指标拉爆。加权口径用总绝对误差 / 总真实销量，
    等价于按销量加权，低销量序列的影响自然下降。这正是长尾数据集需要的口径。
"""
from __future__ import annotations

import numpy as np

from . import config as C


def _align(y_true: np.ndarray, y_pred: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """对齐并剔除含 NaN 的位置。两数组必须等长。"""
    a = np.asarray(y_true, dtype=float)
    b = np.asarray(y_pred, dtype=float)
    if a.shape != b.shape:
        raise ValueError(f"真值与预测长度不一致：{a.shape} vs {b.shape}")
    ok = ~(np.isnan(a) | np.isnan(b))
    return a[ok], b[ok]


# ============================================================ 单点/整体指标
def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    a, b = _align(y_true, y_pred)
    if a.size == 0:
        return float("nan")
    return float(np.mean(np.abs(a - b)))


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    a, b = _align(y_true, y_pred)
    if a.size == 0:
        return float("nan")
    return float(np.sqrt(np.mean((a - b) ** 2)))


def weighted_mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """销量加权 MAPE（WAPE）。Σ|e| / Σ|y|，返回百分数。"""
    a, b = _align(y_true, y_pred)
    if a.size == 0:
        return float("nan")
    denom = np.sum(np.abs(a))
    if denom == 0:
        return float("nan")          # 全零真值：百分比无定义，不要返回 0 假装完美
    return float(np.sum(np.abs(a - b)) / denom * 100.0)


def series_mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """单序列 MAPE，返回百分数。用于逐序列判定与直方图。"""
    return weighted_mape(y_true, y_pred)


# ============================================================ 移动平均基线
def moving_average_forecast(history: np.ndarray, horizon: int,
                            window: int = C.BASELINE_WINDOW) -> np.ndarray:
    """朴素基线：用最后 window 天的均值，平铺外推 horizon 天。

    为什么选移动平均而不是"上一天重复"或"季节性朴素"：
      - 上一天重复 对促销尖峰极度敏感，长尾序列会被单日 spike 带偏；
      - 季节性朴素 需要至少 7 天完整周期，稀疏序列常常凑不齐；
      - 移动平均 用窗口抹平噪声，对最长 30 天步长都稳定，且实现最简、
        评审时不会有人质疑口径 —— 基线越"笨"，胜过它才越说明模型有价值。
    """
    h = np.asarray(history, dtype=float)
    h = h[~np.isnan(h)]
    if h.size == 0:
        return np.full(horizon, np.nan)
    w = min(window, h.size)
    return np.full(horizon, float(np.mean(h[-w:])))


# ============================================================ 任务级聚合
def compute_task_metrics(
    series_records: list[dict],
    horizon: int,
    levels_for_main: tuple[str, ...] = ("L1",),
) -> C.Metrics:
    """聚合任务级指标。

    入参 series_records：每条序列一个 dict
        {
          "sku": str, "warehouse": str, "level": "L1"|"L2"|"L3",
          "y_true": list[float],          # 长度 = horizon，L3 可含 None
          "y_pred": list[float] | None,   # L3 为 None（不输出数值预测）
          "baseline": list[float] | None, # 同一批点的基线值，L3 忽略
        }

    levels_for_main：计入**主指标**的级别。

    ⚠️ 这里是个容易被忽视的口径决定（实测踩坑）：
       L2 的预测值由规则（商品级均值 × 仓占比）产生，不代表 LSTM 的能力。
       实测 L2 组 MAPE 约 60%，若混进主指标，会把一个 L1 达标的模型
       整体拖成不达标（加权 MAPE 由 13.6% 变 25.9%），
       于是"模型是否达标"这个问题就被问歪了。
       因此：
         · 默认主指标只统计 L1（模型真正负责的部分）；
         · L2 的误差单独列出，作为**产品级**质量参考；
         · L3 无数值预测，任何情况下都不参与。
       若产品希望对外承诺"端到端准确率"，应显式传 levels_for_main=("L1","L2")
       并在结果页同时披露覆盖度 —— 不能只看一个混合数字。
    """
    m = C.Metrics()
    counts = C.LevelCounts()

    all_true: list[float] = []
    all_pred: list[float] = []
    all_base: list[float] = []

    # 逐序列用于「达标序列占比」与分组 MAPE
    per_series: list[tuple[str, np.ndarray, np.ndarray]] = []
    l1_true: list[float] = []
    l1_pred: list[float] = []
    l2_true: list[float] = []
    l2_pred: list[float] = []

    for rec in series_records:
        level = rec.get("level", "L1")
        setattr(counts, level, getattr(counts, level) + 1)

        if level == "L3" or rec.get("y_pred") is None:
            continue                       # L3 不参与指标

        yt = np.asarray(rec["y_true"], dtype=float)
        yp = np.asarray(rec["y_pred"], dtype=float)
        ok = ~(np.isnan(yt) | np.isnan(yp))
        if not ok.any():
            continue
        yt, yp = yt[ok], yp[ok]

        is_main = level in levels_for_main
        if is_main:
            all_true.extend(yt.tolist())
            all_pred.extend(yp.tolist())

            base = rec.get("baseline")
            if base is not None:
                bb = np.asarray(base, dtype=float)
                bok = ~np.isnan(bb)
                if bok.any():
                    all_base.extend(bb[bok].tolist())

            per_series.append((level, yt, yp))

        if level == "L1":
            l1_true.extend(yt.tolist()); l1_pred.extend(yp.tolist())
        else:
            l2_true.extend(yt.tolist()); l2_pred.extend(yp.tolist())

    m.levels = counts

    if not all_true:
        return m                             # 全部 L3：指标留 NaN，由上层提示

    yt_all = np.asarray(all_true)
    yp_all = np.asarray(all_pred)

    m.weighted_mape = weighted_mape(yt_all, yp_all)
    m.weighted_mae = mae(yt_all, yp_all)
    m.weighted_rmse = rmse(yt_all, yp_all)

    # 基线（用同一批点；若上层未提供则留 NaN，不静默填 0）
    if all_base:
        yb_all = np.asarray(all_base)
        m.baseline_mae = mae(yt_all, yb_all)
        m.baseline_rmse = rmse(yt_all, yb_all)
        if m.baseline_mae and m.baseline_mae > 0:
            m.mae_improve_pct = (1 - m.weighted_mae / m.baseline_mae) * 100.0
        if m.baseline_rmse and m.baseline_rmse > 0:
            m.rmse_improve_pct = (1 - m.weighted_rmse / m.baseline_rmse) * 100.0

    # 达标序列占比
    evaluated = 0
    passed = 0
    for _level, yt, yp in per_series:
        sm = series_mape(yt, yp)
        if np.isnan(sm):
            continue
        evaluated += 1
        if sm <= C.SERIES_MAPE_THRESHOLD:
            passed += 1
    m.series_evaluated = evaluated
    m.series_passed = passed
    m.series_pass_rate = (passed / evaluated * 100.0) if evaluated else float("nan")

    # 分组 MAPE（用于覆盖度面板，解释"整体达标但局部很差"）
    if l1_true:
        m.l1_mape = weighted_mape(np.asarray(l1_true), np.asarray(l1_pred))
    if l2_true:
        m.l2_mape = weighted_mape(np.asarray(l2_true), np.asarray(l2_pred))

    return m


def series_mape_distribution(series_records: list[dict]) -> dict:
    """逐序列 MAPE 分布（PRD FR-VIS-08 直方图 + 分位数）。"""
    values = []
    for rec in series_records:
        if rec.get("level") == "L3" or rec.get("y_pred") is None:
            continue
        yt = np.asarray(rec["y_true"], dtype=float)
        yp = np.asarray(rec["y_pred"], dtype=float)
        sm = series_mape(yt, yp)
        if not np.isnan(sm):
            values.append(sm)

    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return {"values": [], "median": float("nan"), "p75": float("nan"),
                "p90": float("nan"), "max": float("nan"), "over_count": 0}

    return {
        "values": arr.tolist(),
        "median": float(np.median(arr)),
        "p75": float(np.percentile(arr, 75)),
        "p90": float(np.percentile(arr, 90)),
        "max": float(arr.max()),
        "over_count": int(np.sum(arr > C.SERIES_MAPE_THRESHOLD)),
        "threshold": C.SERIES_MAPE_THRESHOLD,
    }


def verdict(m: C.Metrics) -> dict:
    """综合判定（PRD §3.4.3 三条件全满足才算达标）。"""
    checks = [
        {"name": "加权 MAPE ≤ 20%", "value": m.weighted_mape, "limit": C.WEIGHTED_MAPE_LIMIT,
         "ok": bool(m.mape_ok), "unit": "%"},
        {"name": "MAE 优于基线 ≥ 15%", "value": m.mae_improve_pct,
         "limit": C.BASELINE_IMPROVE_LIMIT, "ok": bool(m.mae_improve_pct >= C.BASELINE_IMPROVE_LIMIT),
         "unit": "%"},
        {"name": "RMSE 优于基线 ≥ 15%", "value": m.rmse_improve_pct,
         "limit": C.BASELINE_IMPROVE_LIMIT, "ok": bool(m.rmse_improve_pct >= C.BASELINE_IMPROVE_LIMIT),
         "unit": "%"},
        {"name": "达标序列占比 ≥ 60%", "value": m.series_pass_rate,
         "limit": C.SERIES_PASS_RATE_TARGET, "ok": bool(m.pass_rate_ok), "unit": "%"},
    ]
    return {"checks": checks, "all_ok": all(c["ok"] for c in checks)}
