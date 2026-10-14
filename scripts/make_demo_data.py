#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
=============================================================================
`WS-10-06` / `WS-10-07` 演示数据冻结（可复现生成）
-----------------------------------------------------------------------------
依据文档 : 《项目开发实施方案 V1.0》§7.11
             `WS-10-06`「固定数据集，现场可复现」
             `WS-10-07`「现场展示 1 个失败分支（如上传缺列文件）」
           《项目任务书 V1.0.0》§6.4（演示须体现异常处理真实可用）
           风险 `RG-15`「演示现场失败（数据/环境）」的缓解措施
-----------------------------------------------------------------------------
产出（写入 `demo/`，随仓库冻结）：

  `演示数据_正常.csv`            —— 主链路演示用（9 序列：8 长 + 1 短）
  `演示数据_失败_缺仓库列.csv`    —— 失败分支 A：表头缺 `warehouse_id`（🔒 缺失即拒）
  `演示数据_失败_负销量.csv`      —— 失败分支 B：`sales` 含负值（备用）
  `README.md`                    —— 每个文件的预期行为与"正常/失败"判据

为什么必须用脚本生成而不是手搓
-----------------------------------------------------------------------------
现场演示最怕「昨天还能跑、今天数据不一样了」。故本脚本：

  1. **固定随机种子**（`SEED = 20261013`）—— 每次生成逐字节一致；
  2. 生成后在 `README.md` 里写明行数/序列数/日期跨度，便于现场核对；
  3. 刻意设计三种"演示必需"的特性（见下）。

三种刻意设计的特性
-----------------------------------------------------------------------------
  · **营销节点**：`item_1001/上海仓` 在 6 月 18 日附近有大促尖峰。
    → 展示"模型学到的不只是均值"，也解释了为什么尖峰不能无条件截断。
  · **长尾短历史**：`item_1008/广州仓` 只有 45 天数据（本仓 < 90 天阈值），
    但同商品跨仓聚合（上海仓 273 + 广州仓 45 = 318 天）≥ 90。
    → 展示**三级降级**中的 L2 商品级降级 + 按历史占比分摊 ——
      稀疏是常态，不是异常分支。
  · **缺失仓库组合**：并非每个商品都在每个仓有记录。
    → 与真实数据集（963 商品 × 5 仓 ≈ 4,815 条理论序列，实际远少于该数）同构。

运行
-----------------------------------------------------------------------------
    <deploy python> scripts/make_demo_data.py
    <deploy python> scripts/make_demo_data.py --out demo     # 指定输出目录
=============================================================================
"""
from __future__ import annotations

import argparse
import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SEED = 20261013
START = date(2026, 1, 1)
END = date(2026, 9, 30)          # 主链路数据截止日（现场演示固定不变）
FULL_DAYS = (END - START).days + 1
PROMO_DAY = date(2026, 6, 18)    # 618 大促（落在历史区间内，模型可学）
SHORT_DAYS = 45                  # 短历史序列长度（< 90 天 → L2 兜底）

# (sku, 仓库, 基线量, 周趋势, 周末系数, 是否有大促, 长度)
#
# 🔑 分级设计（L1_MIN_VALID_POINTS = 90，见 app/algo/config.py）：
#    绝大多数序列 273 天 → **L1**（走 LSTM 推理）。
#    `item_1008` 刻意造成「本仓不足、跨仓够」的形态：
#        · 上海仓 273 天 → L1
#        · 广州仓  45 天 → **L2**（自身 < 90，但同商品跨仓聚合 273+45 = 318 ≥ 90）
#    → 现场能同时看到 L1 与 L2 两条路径，且 L2 是**规则兜底分摊**的结果，
#      不是异常分支（对照真实数据集：963 商品 × 5 仓，缺失仓库样本 17,063 条）。
SERIES: list[tuple[str, str, float, float, float, bool, int]] = [
    ("item_1001", "上海仓", 120, 0.35, 1.28, True, FULL_DAYS),   # 大促标杆（618 尖峰）
    ("item_1001", "北京仓", 86, 0.22, 1.18, False, FULL_DAYS),
    ("item_1002", "上海仓", 240, -0.18, 1.10, False, FULL_DAYS),  # 缓慢下行
    ("item_1002", "广州仓", 175, 0.05, 1.22, False, FULL_DAYS),
    ("item_1003", "北京仓", 58, 0.62, 1.35, False, FULL_DAYS),   # 强增长
    ("item_1004", "上海仓", 310, 0.02, 1.05, False, FULL_DAYS),  # 平稳大品
    ("item_1005", "广州仓", 33, 0.40, 1.30, False, FULL_DAYS),   # 小量增长
    ("item_1008", "上海仓", 95, 0.12, 1.15, False, FULL_DAYS),   # L1 参照
    ("item_1008", "广州仓", 70, 0.10, 1.20, False, SHORT_DAYS),  # 🔑 长尾短历史 → L2
]

HEADER = ["sku_id", "warehouse_id", "date", "sales"]


def _gen_series(
    rng: random.Random, base: float, trend: float, weekend: float, promo: bool, days: int
) -> list[int]:
    """生成一条销量序列：基线 + 线性趋势 + 周周期 + 噪声（+ 大促尖峰）。"""
    out: list[int] = []
    for i in range(days):
        d = START + timedelta(days=i)
        # 线性趋势（trend 为全程相对变化率）
        t = 1.0 + trend * (i / max(days - 1, 1))
        # 周周期：周末抬升
        w = weekend if d.weekday() >= 5 else 1.0
        # 月周期：月初略高
        m = 1.06 if d.day <= 5 else 1.0
        # 噪声（±8%，正态）
        noise = max(0.75, min(1.25, rng.gauss(1.0, 0.08)))
        v = base * t * w * m * noise
        if promo:
            # 大促：前 3 天蓄水、当天爆发、后 4 天回落
            delta = (d - PROMO_DAY).days
            if -3 <= delta < 0:
                v *= 1.35
            elif delta == 0:
                v *= 4.20          # 🔑 唯一可学的业务信号，务必明显
            elif 0 < delta <= 4:
                v *= 2.10 - 0.25 * delta
        out.append(max(0, int(round(v))))
    return out


def write_normal(out_dir: Path) -> tuple[int, int, dict[str, int]]:
    rng = random.Random(SEED)
    rows: list[list[str]] = []
    per_series: dict[str, int] = {}
    for sku, wh, base, trend, weekend, promo, days in SERIES:
        vals = _gen_series(rng, base, trend, weekend, promo, days)
        per_series[f"{sku}/{wh}"] = days
        for i, v in enumerate(vals):
            d = START + timedelta(days=i)
            rows.append([sku, wh, d.isoformat(), str(v)])
    # 按 (sku, 仓库, 日期) 排序，便于人工核对
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    p = out_dir / "演示数据_正常.csv"
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)
    return len(rows), len(SERIES), per_series


def write_missing_column(out_dir: Path, src_rows: list[list[str]]) -> int:
    """失败分支 A：删掉 `warehouse_id` 列（🔒 缺失即拒，`FR-UPL-05`）。"""
    p = out_dir / "演示数据_失败_缺仓库列.csv"
    keep = [0, 2, 3]  # sku_id, date, sales
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([HEADER[i] for i in keep])
        for r in src_rows:
            w.writerow([r[i] for i in keep])
    return len(src_rows)


def write_negative_sales(out_dir: Path, src_rows: list[list[str]]) -> int:
    """失败分支 B：把最后 20 行的销量改成负值（退货未冲销的典型形态）。"""
    p = out_dir / "演示数据_失败_负销量.csv"
    rng = random.Random(SEED + 1)
    rows = [list(r) for r in src_rows]
    for r in rows[-20:]:
        r[3] = str(-rng.randint(3, 25))
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)
    return len(rows)


README_TMPL = """# 演示数据（冻结） · {today}

> 由 `scripts/make_demo_data.py` 生成（随机种子 `SEED = {seed}`），**每次生成逐字节一致**。
> 请勿手工编辑 —— 需要改数据请改生成脚本后重跑，否则「现场可复现」就断了。

## 1. 演示数据_正常.csv —— 主链路用

| 项 | 值 |
|---|---|
| 行数（不含表头） | {n_rows} |
| 序列数（商品 × 仓库） | {n_series} |
| 商品数 / 仓库数 | {n_sku} / {n_wh} |
| 日期跨度 | {start} ~ {end}（{full_days} 天） |
| 表头 | `sku_id,warehouse_id,date,sales` |

**逐序列明细**

| 序列 | 天数 | 演示看点 |
|---|---|---|
{series_table}

### 预期行为（现场核对用）

- 上传后预览表应显示 **{n_series} 个序列**、**{n_rows} 行**，动态列 = 4 列；
- 无任何校验错误（这一份是"干净数据"）；
- 参数页预估耗时落在**秒级**（远低于 60 s SLA）；
- 结果页覆盖率面板应出现 **L1 与 L2 混合** —— `item_1008/广州仓` 只有 {short_days} 天，
  本仓不足 90 天阈值，但同商品跨仓聚合（{full_days} + {short_days} = {agg_days} 天）≥ 90，
  故归为 **L2 商品级降级 + 按历史占比分摊**（这是**正常路径**，不是错误）；
- 折线图中 `item_1001/上海仓` 在 **{promo}** 前后有明显尖峰，且预测曲线能跟随该形态。

## 2. 演示数据_失败_缺仓库列.csv —— 失败分支 A（主用）

| 项 | 值 |
|---|---|
| 行数 | {n_rows} |
| 表头 | `sku_id,date,sales`（**缺 `warehouse_id`**） |

**预期行为**：上传后在第 3 步「表头完整性」被拒，错误卡应明确写出
**错在哪**（缺哪一列）+ **怎么改**（补上 `warehouse_id` 列后重新上传），
并给出「下载错误明细 CSV」入口。**不得**出现 500 或静默接受。

> 🔒 仓库列是**必有项**：本项目的预测粒度是「仓库 × 商品」，没有仓库维度
> 就无法定位序列。所以这一项不是"警告"，是**直接拒绝**。

## 3. 演示数据_失败_负销量.csv —— 失败分支 B（备用）

| 项 | 值 |
|---|---|
| 行数 | {n_rows} |
| 变化点 | 末尾 20 行 `sales` 为负值 |

**预期行为**：在第 5 步「销量非负」被拒，提示"负值通常源于退货未冲销"，
并可在错误明细里精确指出这几行。

## 4. 现场注意事项

- 演示前先跑一遍**主链路 + 失败分支 A**，确认环境无变化（`RG-15` 缓解措施）；
- 备好**离线兜底**：若网络/环境异常，直接打开 `outputs/电商销量预测系统_API接口文档_V1.0.html`
  与控制台截图继续讲，不要在现场调试；
- 演示数据**不要放到 `outputs/`** —— 那里有 TTL 清理任务，会被清掉。
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="demo", help="输出目录（相对项目根）")
    args = ap.parse_args()

    out_dir = ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    n_rows, n_series, per_series = write_normal(out_dir)

    # 重新读回正常数据，供两个失败分支复用（保证同源）
    with (out_dir / "演示数据_正常.csv").open(encoding="utf-8", newline="") as f:
        src_rows = [r for r in csv.reader(f)][1:]

    write_missing_column(out_dir, src_rows)
    write_negative_sales(out_dir, src_rows)

    series_table = "\n".join(
        f"| `{k}` | {v} | {'🔑 618 大促尖峰' if 'item_1001/上海' in k else ''}"
        f"{'🔑 长尾短历史 → L2 兜底' if v == SHORT_DAYS else ''} |"
        for k, v in per_series.items()
    )

    (out_dir / "README.md").write_text(
        README_TMPL.format(
            today=date.today().isoformat(),
            seed=SEED,
            n_rows=f"{n_rows:,}",
            n_series=n_series,
            n_sku=len({s[0] for s in SERIES}),
            n_wh=len({s[1] for s in SERIES}),
            start=START.isoformat(),
            end=END.isoformat(),
            full_days=FULL_DAYS,
            short_days=SHORT_DAYS,
            agg_days=FULL_DAYS + SHORT_DAYS,
            promo=PROMO_DAY.isoformat(),
            series_table=series_table,
        ),
        encoding="utf-8",
    )

    print(f"[OK] 输出目录：{out_dir.relative_to(ROOT)}")
    for p in sorted(out_dir.iterdir()):
        print(f"     {p.name:<28} {p.stat().st_size:>8,} 字节")
    print(f"     正常数据：{n_rows:,} 行 / {n_series} 序列 / {FULL_DAYS} 天")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
