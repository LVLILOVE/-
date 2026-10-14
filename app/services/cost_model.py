"""
=============================================================================
端到端耗时经验模型（`UX-P06-06` 的唯一口径）
-----------------------------------------------------------------------------
版本     : V1.0（EP-5）
依据文档 : 《UI/UX 设计文档 V1.0》`UX-P06-06`（提交前可预估耗时，并显示"上限 60s · 余量 X%"）
           《PRD V1.0》`NFR-PERF-01`（端到端 ≤ 60 s）
           《开发技术方案》§4.3 `BE-15`、实施方案 `WS-5-07`
-----------------------------------------------------------------------------
为什么需要这个模块（而不是直接用 `outputs/eval_report.json` 的 `timing_ms`）
-----------------------------------------------------------------------------
    `API-09` 早期用 `eval_report.timing_ms.total_ms` 按序列数折算返回 `estimated_ms`。
    那个数字是**单遍** `run_inference(backtest=True)` 的耗时，而真实任务要
    ① 跑**两遍**流水线（评估一遍 + 未来预测一遍，见 `predict_service` 模块说明），
    ② 逐序列逐日**滚动推理**，③ 批量落库 —— 三项都不在单遍评测里。

    ⇒ 参数页若直接展示它，用户会看到「预估 7.9 s、实际 16.6 s」。
      这正是技术文档 `GIT-7` 与 `QD-06` 要消灭的「两套数字」形态。

本模块把**实测标定**的结果固化成一个小公式，供两处共用：
    - `dataset_service.get_detail` → `API-09` 的 `estimate_by_horizon`
    - 验证脚本 / 文档回写
`API-09` 的 `estimated_ms` 字段保持原义（单遍评测基准），**不动** —— 它已被
`EP-4` 的 `verify_ep4_api.py` 钉住，且语义确实不同。

标定方法与数据
-----------------------------------------------------------------------------
脚本：`scripts/_ep5_calibrate.py`
环境：本机 MX450 / 113 序列 / 演示数据集 / EP-5 滚动优化**之后**
      （`last_window_fast` 之前，同样参数下 horizon=30 需 72.2 s，见 `WS-5-05`）

| 步长 | 实测端到端 | 每序列 |
|---|---|---|
| 7  | 11,329 ms | 100.3 ms |
| 14 | 16,618 ms | 147.1 ms |
| 30 | 23,843 ms | 211.0 ms |

对 (h, 每序列 ms) 做最小二乘直线拟合，得每序列成本
    per_series_ms(h) = 73.4 + 4.671 · h
拟合残差：h=7 +5.8% / h=14 −5.6% / h=30 +1.2%（最大 ±6%）。

⚠️ 这是**经验模型**，不是物理定律。它依赖：
    - 硬件（本机 MX450；换成纯 CPU 会慢约 4.3 倍，见 `FR-MOD-10`）
    - 数据形态（序列数与序列长度；此处按序列数线性外推）
    - 优化后的算法实现
  因此：① 数字变化时**必须重跑标定脚本**并更新下方常量；
        ② `scripts/verify_ep5.py` 会断言「预估 vs 实测」的偏差在 ±25% 内，
           公式一旦与实际脱节就会在验收时立刻暴露，而不是等用户投诉。
=============================================================================
"""
from __future__ import annotations

__all__ = [
    "COST_INTERCEPT_MS_PER_SERIES",
    "COST_SLOPE_MS_PER_SERIES_DAY",
    "estimate_task_ms",
    "estimate_by_horizon",
]

# 每序列的固定成本（ms）：序列分级、特征装配、指标聚合、逐序列兜底
# 拟合自 EP-5 标定（`scripts/_ep5_calibrate.py`）
COST_INTERCEPT_MS_PER_SERIES = 73.4

# 每序列每增加一天的滚动推理成本（ms）：递归多步是逐日的
COST_SLOPE_MS_PER_SERIES_DAY = 4.671


def estimate_task_ms(series_count: int, horizon: int) -> int:
    """预估一次预测任务的端到端耗时（毫秒）。

    `series_count` 取数据集的有效序列数（`API-09` 的 `level_preview.total`）。
    下限 200 ms：序列数为 1 时不应给出「0 秒」这种没有信息量的答复。
    """
    if series_count <= 0 or horizon <= 0:
        return 0
    per_series = COST_INTERCEPT_MS_PER_SERIES + COST_SLOPE_MS_PER_SERIES_DAY * horizon
    return max(int(round(per_series * series_count)), 200)


def estimate_by_horizon(series_count: int, horizons: tuple[int, ...]) -> list[dict[str, int]]:
    """三个可选步长的预估耗时（`API-09` 的 `estimate_by_horizon`）。

    ⚠️ 为什么由后端算而不是前端算：公式是**业务口径**（含两遍流水线与滚动），
       放到前端就成了「同一个物理量在两处各实现一遍」，两边一旦不同步，
       参数页显示的预估与真实任务耗时就会再次分叉 —— 即 `GIT-7` 的老问题。
    """
    return [
        {"horizon": h, "estimated_ms": estimate_task_ms(series_count, h)} for h in horizons
    ]
