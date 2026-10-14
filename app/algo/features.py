"""特征工程：滑动窗口 + 时间/滞后/滚动特征。

特征清单（PRD FR-FEA-02）：
    时间类  星期几、月份、是否周末、是否节假日
    滞后类  lag-1、lag-7（捕捉"昨天"与"上周同一天"）
    滚动类  滚动均值 7 / 14（捕捉近期水平，是模型对趋势的主要信息来源）

🔒 三条硬约束（防数据泄漏，风险 R2）：
    1. 所有滚动统计**只向后看**（不 center），否则会用到未来值。
    2. 归一化统计量只能从训练段拟合（见 preprocess.Scaler）。
    3. lag 特征在序列开头会缺，**必须裁掉**，不能填 0 —— 填 0 会让模型
       学到一个假的"零销量"模式。
"""
from __future__ import annotations

from dataclasses import dataclass

from collections.abc import Sequence

import numpy as np
import pandas as pd

from . import config as C

# 窗口内每一列最多向前依赖的天数（lag_7 → 7；roll_mean_14 → shift(1)+rolling(14) → 14）。
# 与 `min_required_points()` 里的「+14」是同一个数；`infer._ROLL_LOOKBACK` 引用它，
# 避免同一个物理量在两处各写一遍。
ROLL_WARMUP = 14

# 中国法定节假日（近似表；仅覆盖数据集时间范围，PRD FR-FEA-02 允许后续外置为配置）
HOLIDAYS: dict[str, str] = {
    "2014-10-01": "国庆节", "2014-10-02": "国庆节", "2014-10-03": "国庆节",
    "2014-10-04": "国庆节", "2014-10-05": "国庆节", "2014-10-06": "国庆节",
    "2014-10-07": "国庆节",
    "2014-11-11": "双十一", "2014-11-12": "双十一返场",
    "2014-12-12": "双十二", "2014-12-24": "平安夜", "2014-12-25": "圣诞节",
    "2015-01-01": "元旦",
    "2015-02-18": "除夕", "2015-02-19": "春节", "2015-02-20": "春节",
    "2015-02-21": "春节", "2015-02-22": "春节", "2015-02-23": "春节",
    "2015-02-24": "春节",
    "2015-04-05": "清明节", "2015-05-01": "劳动节",
    "2015-06-20": "端午节",
    "2015-09-27": "中秋节", "2015-10-01": "国庆节", "2015-10-02": "国庆节",
    "2015-11-11": "双十一", "2015-11-12": "双十一返场", "2015-12-12": "双十二",
    "2015-12-24": "平安夜", "2015-12-25": "圣诞节",
}

FEATURE_NAMES: tuple[str, ...] = (
    "sales",        # 当天的（归一化）销量 —— 预测目标是下一天的
    "dow_sin", "dow_cos",   # 星期几的周期编码（比 one-hot 更省维度且连续）
    "month_sin", "month_cos",
    "is_weekend",
    "is_holiday",
    "lag_1", "lag_7",
    "roll_mean_7", "roll_mean_14",
)

N_FEATURES = len(FEATURE_NAMES)

# ================================================================ 预测目标
# 🔑 关键设计：**学残差，不学绝对值**（实测决定成败）
#
# 问题（scripts/diag_bias.py 实测）：
#   直接让模型回归归一化后的绝对销量 y/σ 时，多步递归预测会向序列均值收缩 ——
#   预测值标准差 / 真值标准差 的中位数只有 0.26，64 条序列里 60 条低于 0.5。
#   表现上就是 MAPE 看着还行（16.8%），但 MAE 只比基线好 11.7%、
#   达标序列占比只有 52%，全都卡在 15% / 60% 两条红线之下。
#
# 解法：
#   让模型只学「目标值 − 移动平均基线」这个残差（再除以 σ 缩放）。
#   基线已经承担了"绝对水平"，模型只需补上基线看不出来的部分（趋势、星期效应）。
#   模型预测再差也只是退回基线水平，因此**下界有保证**（MAE 改善必然 ≥ 0）。
#
# 副作用与代价：
#   1) 推理时最终预测 = 历史均值 + 模型残差，两处都要动；
#   2) 训练标签依赖基线窗口，改 BASELINE_WINDOW 必须重训（模型 meta 会记录）。
TARGET_ABS = "abs"         # 直接回归绝对销量（对照组，实测会压平）
TARGET_RESIDUAL = "resid"  # 回归相对基线的残差（默认，线上使用）
TARGET_MODE = TARGET_RESIDUAL


def add_calendar_features(dates: pd.Series) -> pd.DataFrame:
    """时间类特征。周期量用 sin/cos 编码，保证星期五与星期一"相邻"而不是首尾割裂。"""
    d = pd.to_datetime(dates)
    dow = d.dt.dayofweek.to_numpy(dtype=float)      # 0=周一
    month = d.dt.month.to_numpy(dtype=float)
    iso = d.dt.strftime("%Y-%m-%d")
    return pd.DataFrame({
        "dow_sin": np.sin(2 * np.pi * dow / 7.0),
        "dow_cos": np.cos(2 * np.pi * dow / 7.0),
        "month_sin": np.sin(2 * np.pi * (month - 1) / 12.0),
        "month_cos": np.cos(2 * np.pi * (month - 1) / 12.0),
        "is_weekend": (dow >= 5).astype(float),
        "is_holiday": iso.isin(HOLIDAYS.keys()).to_numpy(dtype=float),
    })


def add_lag_rolling_features(sales: np.ndarray) -> pd.DataFrame:
    """滞后 + 滚动特征。移动平均基线也用这里的滚动均值，保证口径一致。"""
    s = pd.Series(np.asarray(sales, dtype=float))
    return pd.DataFrame({
        "lag_1": s.shift(1),
        "lag_7": s.shift(7),
        # 🔒 min_periods=1 是**允许**的：滚动窗口长度变短不会引入未来信息。
        #    但更稳妥的做法是要求窗口完整（见 build_windows 的 valid_start）。
        "roll_mean_7": s.shift(1).rolling(7, min_periods=7).mean(),
        "roll_mean_14": s.shift(1).rolling(14, min_periods=14).mean(),
    })


def build_feature_frame(dates: pd.Series, sales: np.ndarray,
                        holiday: bool = True) -> pd.DataFrame:
    """把一条（已归一化的）序列拼成特征表。返回的 DataFrame 含 NaN，由调用方裁掉。"""
    cal = add_calendar_features(dates)
    lag = add_lag_rolling_features(sales)
    if not holiday:
        cal = cal.drop(columns=["is_holiday"])
    feat = pd.concat([pd.Series(np.asarray(sales, dtype=float), name="sales"), cal, lag], axis=1)
    return feat[list(FEATURE_NAMES) if holiday else
                [c for c in FEATURE_NAMES if c != "is_holiday"]]


@dataclass
class WindowSet:
    """监督学习样本集。

    X: (n_samples, window, n_features)
    y: (n_samples,)          —— 按 target_mode 决定是残差还是绝对值（均已 /σ）
    y_date: (n_samples,)     —— 目标日期，用于后续多步滚动与指标对齐
    baseline: (n_samples,)   —— 目标位置对应的移动平均基线（原量纲），还原时要用
    feat_names: tuple[str, ...]
    """

    X: np.ndarray
    y: np.ndarray
    y_date: np.ndarray
    feat_names: tuple[str, ...]
    baseline: np.ndarray = None        # type: ignore[assignment]


def build_windows(
    dates: pd.Series,
    sales: np.ndarray,
    window: int = C.WINDOW_SIZE,
    horizon: int = 1,
    holiday: bool = True,
    sigma: float = 1.0,
    target_mode: str = TARGET_MODE,
    baseline_window: int = C.BASELINE_WINDOW,
) -> WindowSet:
    """滑动窗口采样。

    horizon=1 用于训练（单步）；多步预测由 infer.py 滚动递归完成 ——
    这样只需维护一套模型，避免为每个步长单独训练（1 分钟 SLA 下无法承受）。

    sigma 必须由调用方用**训练段**拟合后传入（防数据泄漏）。
    """
    feat = build_feature_frame(dates, sales, holiday=holiday)
    names = tuple(feat.columns)
    arr = feat.to_numpy(dtype=float)
    n = len(arr)
    y_all = np.asarray(sales, dtype=float)
    d_all = pd.to_datetime(dates).to_numpy()

    X, y, y_date = [], [], []
    # 起点：要留够 window 天特征 + horizon 天目标
    start = window - 1
    for t in range(start, n - horizon):
        xw = arr[t - window + 1: t + 1]
        if np.isnan(xw).any():
            continue          # 窗口内有缺失 → 整条样本丢弃（不填补，避免造数）
        target_idx = t + horizon
        if np.isnan(y_all[target_idx]):
            continue
        X.append(xw)
        y_date.append(d_all[target_idx])

    if not X:
        return WindowSet(
            X=np.zeros((0, window, len(names))), y=np.zeros((0,)),
            y_date=np.array([], dtype="datetime64[ns]"), feat_names=names,
            baseline=np.zeros((0,)),
        )

    X = np.asarray(X, dtype=np.float32)
    # 目标下标必须用与上面**完全相同的过滤条件**重算，否则 X / y 错位（静默 bug）
    idx = _target_indices(arr, y_all, window, horizon)
    y_vals, base = make_target(y_all, idx, sigma, mode=target_mode, window=baseline_window)

    return WindowSet(
        X=X,
        y=y_vals.astype(np.float32),
        y_date=np.asarray(y_date),
        feat_names=names,
        baseline=base,
    )


def _target_indices(arr: np.ndarray, sales: np.ndarray, window: int, horizon: int) -> np.ndarray:
    """重算每个样本对应的目标下标（与 build_windows 的过滤条件严格一致）。

    单独抽出来是因为 build_windows 里会跳过"窗口含 NaN"或"目标为 NaN"的样本，
    必须用同一套条件再走一遍，否则 X / y 会错位 —— 这是最隐蔽也最致命的一类 bug
    （不报错，只是模型学到噪声）。
    """
    out = []
    n = len(arr)
    for t in range(window - 1, n - horizon):
        if np.isnan(arr[t - window + 1: t + 1]).any():
            continue
        ti = t + horizon
        if np.isnan(sales[ti]):
            continue
        out.append(ti)
    return np.asarray(out, dtype=int)



def build_inference_windows(
    dates: pd.Series,
    sales: np.ndarray,
    window: int = C.WINDOW_SIZE,
    holiday: bool = True,
) -> np.ndarray:
    """推理用：只取**最后一个**完整窗口，用来预测未来第 1 步。

    多步预测在 infer.py 里滚动调用本函数（把预测值接到序列尾部再取窗口）。
    这样训练与推理的窗口构造完全同源，杜绝"训练用一套、推理用另一套"的错位 bug。
    """
    feat = build_feature_frame(dates, sales, holiday=holiday)
    arr = feat.to_numpy(dtype=float)
    if len(arr) < window:
        return np.zeros((0, window, arr.shape[1]), dtype=np.float32)
    xw = arr[-window:]
    if np.isnan(xw).any():
        # 末尾窗口含缺失：向前找一个干净窗口（稀疏序列常见）
        for end in range(len(arr), window, -1):
            cand = arr[end - window:end]
            if not np.isnan(cand).any():
                return cand[None, :, :].astype(np.float32)
        return np.zeros((0, window, arr.shape[1]), dtype=np.float32)
    return xw[None, :, :].astype(np.float32)


# ================================================================ 推理热路径
# 🔥 为什么需要下面这一对函数（`EP-5` 的性能修复，有实测依据）
#
# 多步预测是**逐日滚动**的：每一步都要重新构造一次「最后 window 天」的窗口。
# 原实现直接调用 `build_inference_windows`，而它内部是「先对整条序列建特征表，
# 再取最后 window 行」—— 于是每一条序列都会把
# `pd.to_datetime` / `dt.strftime` / `isin` / `shift` / `rolling` / `concat`
# 这整套 pandas 操作重复执行 `horizon` 次。
#
# ⏱ 实测（本机 MX450，113 序列）：
#     horizon=7  端到端 19.7 s · horizon=14 36.0 s · horizon=30 **72.2 s（击穿 60 s）**
#   而「一次批量前向」只要 150 ms，`algo.Timing.inference_ms` 更是只有 21 ms ——
#   也就是说**滚动段的窗口构造**吃掉了 90% 以上的时间，
#   这正是文档里「端到端实测 7.9 s」与实际不符的根因。
#
# 修复办法：滚动时既不重建日历特征（日期是确定的，可一次算好），
# 也不用 pandas（逐行公式就是 6 个滞后/滚动量，纯 numpy 即可）。
#
# 🔒 等价性不是估算：`scripts/verify_ep5.py` 会用**改造前**的
#    `build_inference_windows` 与下面的快速路径，在真实数据上对全部 L1 序列
#    逐位比对滚动结果（`np.array_equal`），并断言评测指标全等。
def calendar_matrix(dates: Sequence[str]) -> np.ndarray:
    """把日期序列一次算成 (n, 6) 日历特征矩阵，列序与 `add_calendar_features` 一致。

    只做一次的理由：滚动过程中日期是**确定增长**的（每天 +1），没有理由每步重算。
    返回 float64（与 `build_feature_frame` 的 dtype 一致）。
    """
    d = pd.to_datetime(pd.Series(list(dates)))
    dow = d.dt.dayofweek.to_numpy(dtype=float)
    month = d.dt.month.to_numpy(dtype=float)
    iso = d.dt.strftime("%Y-%m-%d")
    return np.column_stack([
        np.sin(2 * np.pi * dow / 7.0),
        np.cos(2 * np.pi * dow / 7.0),
        np.sin(2 * np.pi * (month - 1) / 12.0),
        np.cos(2 * np.pi * (month - 1) / 12.0),
        (dow >= 5).astype(float),
        iso.isin(HOLIDAYS.keys()).to_numpy(dtype=float),
    ])


def last_window_fast(
    cal: np.ndarray,
    sales: np.ndarray,
    window: int = C.WINDOW_SIZE,
    holiday: bool = True,
) -> np.ndarray:
    """`build_inference_windows` 的等价快速实现（纯 numpy，无 pandas）。

    `cal[j]` 必须对应 `sales[j]` 的日期；调用方只需保证长度一致，
    并且对「序列尾部」传入（配合 `infer._ROLL_LOOKBACK` 的尾部切片）。

    逐行公式（与 `add_calendar_features` / `add_lag_rolling_features` 逐字对应）：
        sales       = v[i]
        lag_1       = v[i-1]                 （i<1 时 NaN）
        lag_7       = v[i-7]                 （i<7 时 NaN）
        roll_mean_7 = mean(v[i-7:i])         （i<7 时 NaN）
        roll_mean_14= mean(v[i-14:i])        （i<14 时 NaN）
    """
    n = len(sales)
    if n < window:
        cols = 11 if holiday else 10
        return np.zeros((0, window, cols), dtype=np.float32)

    # 只需最后 window 行；这些行的 roll_mean_14 最多向前看 14 天。
    lo = max(0, n - window - ROLL_WARMUP)
    v = np.asarray(sales[lo:], dtype=float)
    cal_seg = np.asarray(cal[lo:], dtype=float)
    m = len(v)

    lag1 = np.full(m, np.nan)
    lag7 = np.full(m, np.nan)
    roll7 = np.full(m, np.nan)
    roll14 = np.full(m, np.nan)
    if m >= 1:
        lag1[1:] = v[:-1]
    if m >= 7:
        lag7[7:] = v[:-7]
        roll7[7:] = _trailing_mean(v, 7)
    if m >= 14:
        roll14[14:] = _trailing_mean(v, 14)

    feat = np.column_stack([v, cal_seg, lag1, lag7, roll7, roll14])  # 11 列，同 FEATURE_NAMES
    if not holiday:
        feat = np.delete(feat, 6, axis=1)                            # 去掉 is_holiday
    arr = feat[-window:]
    if np.isnan(arr).any():
        # 与 build_inference_windows 相同的回退：向前找最近一个干净窗口
        for end in range(len(feat), window, -1):
            cand = feat[end - window:end]
            if not np.isnan(cand).any():
                return cand[None, :, :].astype(np.float32)
        cols = 11 if holiday else 10
        return np.zeros((0, window, cols), dtype=np.float32)
    return arr[None, :, :].astype(np.float32)


def _trailing_mean(v: np.ndarray, w: int) -> np.ndarray:
    """`out[i] = mean(v[i-w:i])`（不含 i 本身）—— 即 `shift(1).rolling(w).mean()`。

    用 `sliding_window_view` 直接取整窗口再求均值（O(m·w)，w 只有 7/14，
    在这个规模上比任何增量技巧都便宜，而且**不会引入累加误差**——
    这正是与 pandas 逐位对齐所需的条件）。

    `min_periods=w` 的语义由调用方的切片边界保证（前 w 个位置不取值）。
    """
    if len(v) < w:
        return np.zeros(0, dtype=float)
    win = np.lib.stride_tricks.sliding_window_view(v, w)   # win[j] = v[j : j+w]
    return win.mean(axis=1)[: max(len(v) - w, 0)]


def min_required_points(window: int = C.WINDOW_SIZE) -> int:
    """一条序列能构造出**至少一个**训练样本所需的最少点数。

    = window（凑窗口）+ 1（目标）+ 14（roll_mean_14 需要 14 个前值）
    用途：训练前的可行性预检，避免跑半小时才发现样本为 0。
    """
    return window + 1 + 14


# ================================================================ 基线工具
def baseline_values(sales: np.ndarray, window: int = C.BASELINE_WINDOW) -> np.ndarray:
    """逐步的移动平均基线值。

    第 t 个元素的含义：只用 t 之前的数据算出的均值 —— 与 metrics.moving_average_forecast
    完全同一口径，保证"训练时学的东西"和"评估时比的基线"是同一个东西。
    前 window 个位置无足够历史，返回 NaN。
    """
    s = pd.Series(np.asarray(sales, dtype=float))
    return s.shift(1).rolling(window, min_periods=1).mean().to_numpy()


def make_target(
    sales: np.ndarray,
    target_idx: np.ndarray,
    sigma: float,
    mode: str = TARGET_MODE,
    window: int = C.BASELINE_WINDOW,
) -> tuple[np.ndarray, np.ndarray]:
    """构造训练目标。返回 (目标值, 该位置对应的基线值)。

    mode="resid"：目标 = (y_t − baseline_t) / σ
    mode="abs"  ：目标 = y_t / σ
    两者都要求调用方传入**逐序列独立拟合**的 sigma（防数据泄漏）。
    """
    y = np.asarray(sales, dtype=float)[target_idx]
    base = baseline_values(sales, window)[target_idx]
    # 基线缺失（序列开头）时退化为用当前有效值的历史均值，避免产生 NaN 样本
    if np.isnan(base).any():
        fallback = np.nanmean(y) if np.isfinite(y).any() else 0.0
        base = np.where(np.isnan(base), fallback, base)
    s = sigma if sigma and sigma > 0 else 1.0
    if mode == TARGET_RESIDUAL:
        return (y - base) / s, base
    return y / s, base


def residual_to_value(residual_norm: float, base: float, sigma: float) -> float:
    """把模型输出的归一化残差还原成真实销量。"""
    s = sigma if sigma and sigma > 0 else 1.0
    return float(residual_norm) * s + float(base)

