"""序列分级 L1 / L2 / L3。

📌 附录 C-2 已确认：输出是**后续所有环节的输入** —— 分级决定走推理还是走兜底，
也决定指标的统计口径。所以这里的判定必须唯一、可复现、可解释。

分级规则（PRD FR-MOD-05）：
    L1  仓库×商品序列有效历史 ≥ 90 → 走 LSTM 推理
    L2  自身不足但**同商品跨仓聚合** ≥ 90 → 商品级降级 + 按历史占比分摊
    L3  跨仓聚合仍 < 90 → 不可预测，**不输出数值预测**，只给历史均值

为什么 L2 要求「跨仓聚合」而不是「找同款商品的其他仓」：
    数据事实是天池 963 商品 × 5 仓 ≈ 4815 条理论序列，但 17,063 条仓缺失样本，
    长尾商品往往只在 1–2 个仓有货。跨仓聚合是把同一商品所有仓的历史拼起来，
    能显著提高可用序列数，且分摊比例有真实依据（各仓历史占比）。
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import config as C

L1, L2, L3 = "L1", "L2", "L3"


def count_valid(values: np.ndarray) -> int:
    """有效（非空）点数。注意：这是**插值前**的原始有效点数，
    因为插值造出来的点不能算作"有历史"，否则稀疏序列会被误判成 L1。"""
    v = np.asarray(values, dtype=float)
    return int(np.sum(~np.isnan(v)))


def sparse_ratio(values: np.ndarray) -> float:
    """缺失率，用于报告与诊断（不参与分级，分级只看有效点数）。"""
    v = np.asarray(values, dtype=float)
    if v.size == 0:
        return 1.0
    return float(np.mean(np.isnan(v)))


@dataclass
class SeriesInfo:
    """单条序列的分级结果。"""

    sku: str
    warehouse: str
    valid_points: int
    total_points: int
    level: str
    level_reason: str
    # L2 专用：按历史占比分摊到本仓的比例（L1/L3 恒为 1.0 / 0.0）
    share: float = 1.0

    @property
    def predictable(self) -> bool:
        """L3 不输出数值预测（PRD FR-MOD-09 / FR-VIS-04）。"""
        return self.level != L3


def classify_series(
    df: pd.DataFrame,
    threshold: int = C.L1_MIN_VALID_POINTS,
) -> dict[tuple[str, str], SeriesInfo]:
    """对全表做分级。df 应已校验通过；用原始（未插值）销量判定有效性。

    返回 {(sku_id, warehouse_id): SeriesInfo}。
    """
    raw_sales = df[C.COL_SALES].to_numpy(dtype=float)

    # ---- 第一遍：逐序列有效点数
    per_series: dict[tuple[str, str], int] = {}
    per_series_total: dict[tuple[str, str], int] = {}
    item_valid: dict[str, int] = {}
    item_by_wh: dict[str, dict[str, int]] = {}

    frame = df.assign(_v=raw_sales)
    for (sku, wh), g in frame.groupby([C.COL_SKU, C.COL_WAREHOUSE], observed=True, sort=False):
        n_valid = count_valid(g["_v"].to_numpy())
        per_series[(sku, wh)] = n_valid
        per_series_total[(sku, wh)] = len(g)
        item_valid[sku] = item_valid.get(sku, 0) + n_valid
        item_by_wh.setdefault(sku, {})[wh] = n_valid

    # ---- 第二遍：套规则
    result: dict[tuple[str, str], SeriesInfo] = {}
    for (sku, wh), n_valid in per_series.items():
        total = per_series_total[(sku, wh)]
        agg = item_valid.get(sku, 0)

        if n_valid >= threshold:
            level, reason, share = L1, f"本仓有效 {n_valid} 天 ≥ {threshold}，走 LSTM 推理", 1.0
        elif agg >= threshold:
            # 按该商品各仓历史占比分摊；本仓占比为 0 时退化为均分
            denom = sum(item_by_wh[sku].values())
            share = (n_valid / denom) if denom > 0 else 1.0 / max(len(item_by_wh[sku]), 1)
            level = L2
            reason = (f"本仓仅 {n_valid} 天，但跨仓聚合 {agg} 天 ≥ {threshold}；"
                      f"走商品级降级，按历史占比 {share:.1%} 分摊")
        else:
            level, reason, share = L3, f"本仓 {n_valid} 天、跨仓聚合 {agg} 天均 < {threshold}，不可预测", 0.0

        result[(sku, wh)] = SeriesInfo(
            sku=sku, warehouse=wh, valid_points=n_valid, total_points=total,
            level=level, level_reason=reason, share=share,
        )

    return result


def count_levels(infos: dict[tuple[str, str], SeriesInfo]) -> C.LevelCounts:
    """统计三级覆盖数（写入 task.l1_count / l2_count / l3_count）。"""
    counts = C.LevelCounts()
    for info in infos.values():
        setattr(counts, info.level, getattr(counts, info.level) + 1)
    return counts


def l1_series(infos: dict[tuple[str, str], SeriesInfo]) -> list[tuple[str, str]]:
    """可进 LSTM 的序列集合。**模型与基线都必须用这同一集合**（公平性硬约束）。"""
    return [k for k, v in infos.items() if v.level == L1]


def l2_l3_series(infos: dict[tuple[str, str], SeriesInfo]) -> list[tuple[str, str]]:
    return [k for k, v in infos.items() if v.level in (L2, L3)]


def coverage_report(infos: dict[tuple[str, str], SeriesInfo]) -> dict:
    """覆盖度披露数据（PRD FR-VIS-07：必须同时可见，避免"用少量好序列拉高均值"）。"""
    counts = count_levels(infos)
    total = max(counts.total, 1)
    return {
        "L1": counts.L1, "L2": counts.L2, "L3": counts.L3, "total": counts.total,
        "L1_pct": counts.L1 / total * 100,
        "L2_pct": counts.L2 / total * 100,
        "L3_pct": counts.L3 / total * 100,
        "predictable": counts.L1 + counts.L2,
        "predictable_pct": (counts.L1 + counts.L2) / total * 100,
    }


def estimate_series_count(df: pd.DataFrame) -> int:
    """上传后立刻估算序列数，用于 E_TOO_MANY_SERIES 预检（避免占满 60s 才失败）。"""
    return int(df.groupby([C.COL_SKU, C.COL_WAREHOUSE], observed=True).ngroups)
