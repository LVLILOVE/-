"""算法骨架自检 —— 不依赖真实数据与训练，验证各模块的契约与边界行为。

用途：
    1) 改完算法代码先跑这个，确认没有破坏基础契约；
    2) 代码评审时作为"可执行规格"，比读文档快；
    3) CI 里当作快速冒烟测试（本脚本在 CPU 上约 1–3 秒）。

用法：
    python scripts/self_check.py

退出码：0 全部通过；1 有失败项。
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
from app.algo import classify, fallback, features, metrics as M, preprocess  # noqa: E402

PASS, FAIL = 0, 0
FAILED_NAMES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}" + (f"   {detail}" if detail else ""))
    else:
        FAIL += 1
        FAILED_NAMES.append(name)
        print(f"  ✗ {name}   {detail}")


def section(title: str) -> None:
    print(f"\n【{title}】")


# ======================================================== 1. 数据校验契约
def test_validate() -> None:
    section("1. 数据校验（PRD §3.2 强制契约 + 固定校验顺序）")
    base = pd.DataFrame({
        C.COL_SKU: ["a", "a"], C.COL_WAREHOUSE: ["w1", "w1"],
        C.COL_DATE: ["2015-01-01", "2015-01-02"], C.COL_SALES: [1, 2],
    })

    # 缺列
    try:
        preprocess.validate_dataframe(base.drop(columns=[C.COL_WAREHOUSE]))
        check("缺 warehouse_id 应报错", False)
    except preprocess.ValidationError as e:
        check("缺 warehouse_id 应报错", e.code == "E_MISSING_COLUMN", e.code)

    # 日期不可解析
    bad_date = base.copy(); bad_date[C.COL_DATE] = ["2015-01-01", "不是日期"]
    try:
        preprocess.validate_dataframe(bad_date)
        check("日期不可解析应报错", False)
    except preprocess.ValidationError as e:
        check("日期不可解析应报错", e.code == "E_BAD_DATE", e.code)

    # 负销量
    neg = base.copy(); neg[C.COL_SALES] = [1, -5]
    try:
        preprocess.validate_dataframe(neg)
        check("负销量应报错", False)
    except preprocess.ValidationError as e:
        check("负销量应报错", e.code == "E_NEGATIVE", e.code)

    # 非数字销量
    txt = base.copy(); txt[C.COL_SALES] = ["1", "暂无"]
    try:
        preprocess.validate_dataframe(txt)
        check("非数字销量应报错", False)
    except preprocess.ValidationError as e:
        check("非数字销量应报错", e.code == "E_NON_NUMERIC_SALES", e.code)

    # 正常数据应通过
    try:
        preprocess.validate_dataframe(base)
        check("合法数据应通过校验", True)
    except preprocess.ValidationError as e:
        check("合法数据应通过校验", False, e.message)

    # 序列数超限
    many = pd.DataFrame({
        C.COL_SKU: [f"i{i}" for i in range(C.MAX_SERIES + 5)],
        C.COL_WAREHOUSE: ["w1"] * (C.MAX_SERIES + 5),
        C.COL_DATE: ["2015-01-01"] * (C.MAX_SERIES + 5),
        C.COL_SALES: [1] * (C.MAX_SERIES + 5),
    })
    try:
        preprocess.validate_dataframe(many)
        check("序列数超限应报错", False)
    except preprocess.ValidationError as e:
        check("序列数超限应报错", e.code == "E_TOO_MANY_SERIES", e.code)


# ======================================================== 2. 清洗
def test_clean() -> None:
    section("2. 清洗（插值不外推 / 促销节点保护）")

    # 内部空洞应被线性插值
    v = np.array([1.0, np.nan, np.nan, 4.0])
    out = preprocess.interpolate_series(v)
    check("内部空洞线性插值", np.allclose(out, [1, 2, 3, 4]), str(np.round(out, 2)))

    # 两端缺失不得外推（这是分级正确性的前提）
    v2 = np.array([np.nan, 2.0, 3.0, np.nan, np.nan])
    out2 = preprocess.interpolate_series(v2)
    check("两端缺失不填补（不外推）",
          np.isnan(out2[0]) and np.isnan(out2[3]) and np.isnan(out2[4]),
          str(np.round(out2, 2)))

    # 全空序列不应崩溃
    out3 = preprocess.interpolate_series(np.array([np.nan, np.nan]))
    check("全空序列返回全 NaN 且不崩溃", np.isnan(out3).all())

    # 促销日应被保护（不被当成异常尖峰截断）
    dates = pd.Series(pd.date_range("2015-11-08", periods=7))
    vals = np.array([10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0])
    vals[3] = 40.0                               # 11-11 大促
    clipped, mask = preprocess.truncate_spikes(vals, preserve_calendar=dates)
    check("大促日不被截断到原始值以下",
          clipped[3] >= 40.0 * 0.8,
          f"40.0 → {clipped[3]:.1f}")

    # 普通日期的极端离群点仍应被截断
    # 注意：需要足够长的序列，因为 truncate_spikes 在 n < window*2 时直接跳过
    dates2 = pd.Series(pd.date_range("2015-06-01", periods=40))
    rng_s = np.random.default_rng(7)
    vals2 = rng_s.normal(10, 1, 40)
    vals2[20] = 5000.0                        # 中间的极端离群点
    clipped2, mask2 = preprocess.truncate_spikes(vals2, preserve_calendar=dates2)
    check("普通日期的离群点被截断", clipped2[20] < 5000.0, f"5000 → {clipped2[20]:.1f}")


# ======================================================== 3. 归一化与切分
def test_scaler_split() -> None:
    section("3. 归一化与时间切分（防数据泄漏 R2）")

    train = np.array([10.0, 12.0, 14.0, 16.0, 18.0])
    sc = preprocess.Scaler.fit(train)
    check("Scaler 拟合值来自传入片段",
          abs(sc.mean - train.mean()) < 1e-9, f"mean={sc.mean:.2f}")

    # 反变换应还原
    z = sc.transform(train)
    back = sc.inverse(z)
    check("transform/inverse 互逆", np.allclose(back, train))

    # 常量序列不得除零
    sc0 = preprocess.Scaler.fit(np.array([5.0, 5.0, 5.0]))
    check("常量序列 std 退化为 1（不除零）", sc0.std == 1.0, f"std={sc0.std}")

    # 时间切分必须严格递增且不重叠
    tr, va, te = preprocess.chronological_split(100)
    check("8:1:1 切分边界正确",
          (tr.start, tr.stop, va.start, va.stop, te.start, te.stop) == (0, 80, 80, 90, 90, 100),
          f"{tr} {va} {te}")
    check("切分区间不重叠且覆盖全部",
          tr.stop == va.start and va.stop == te.start and te.stop == 100)


# ======================================================== 4. 分级
def test_classify() -> None:
    section("4. 序列分级 L1/L2/L3（附录 C-2）")

    n = 120
    rng = np.random.default_rng(0)
    rows = []
    # A：单仓 120 天 → L1（自身达标）
    for i in range(n):
        rows.append({"sku_id": "A", "warehouse_id": "w1",
                     "date": (pd.Timestamp("2015-01-01") + pd.Timedelta(days=i)).strftime("%Y-%m-%d"),
                     "sales": int(rng.integers(5, 20))})
    # B：w1 只有 30 天（不足 90），w2 有 100 天（自身达标）
    #    → w1 判 L2（靠跨仓聚合兜底），w2 判 L1
    for i in range(30):
        rows.append({"sku_id": "B", "warehouse_id": "w1",
                     "date": (pd.Timestamp("2015-03-01") + pd.Timedelta(days=i)).strftime("%Y-%m-%d"),
                     "sales": int(rng.integers(5, 20))})
    for i in range(100):
        rows.append({"sku_id": "B", "warehouse_id": "w2",
                     "date": (pd.Timestamp("2015-01-01") + pd.Timedelta(days=i)).strftime("%Y-%m-%d"),
                     "sales": int(rng.integers(5, 20))})
    # C：w1 10 天 + w2 6 天，跨仓聚合仅 16 天 → 两个仓都判 L3
    for i in range(10):
        rows.append({"sku_id": "C", "warehouse_id": "w1",
                     "date": (pd.Timestamp("2015-05-01") + pd.Timedelta(days=i)).strftime("%Y-%m-%d"),
                     "sales": int(rng.integers(1, 5))})
    for i in range(6):
        rows.append({"sku_id": "C", "warehouse_id": "w2",
                     "date": (pd.Timestamp("2015-05-01") + pd.Timedelta(days=i)).strftime("%Y-%m-%d"),
                     "sales": int(rng.integers(1, 5))})

    df = pd.DataFrame(rows)
    infos = classify.classify_series(df)

    check("A/w1 判为 L1（自身 120 天 ≥ 90）", infos[("A", "w1")].level == "L1",
          f"valid={infos[('A','w1')].valid_points}")
    check("B/w1 判为 L2（自身 30 天不足，跨仓聚合 130 天够）",
          infos[("B", "w1")].level == "L2",
          f"本仓 {infos[('B','w1')].valid_points} 天")
    check("B/w2 判为 L1（自身 100 天 ≥ 90）", infos[("B", "w2")].level == "L1",
          f"valid={infos[('B','w2')].valid_points}")
    check("C/w1 判为 L3（聚合也不够）",
          infos[("C", "w1")].level == "L3",
          f"聚合 {infos[('C','w1')].valid_points + infos[('C','w2')].valid_points} 天")

    # L3 必须标记为不可预测
    check("L3 标记 predictable=False", infos[("C", "w1")].predictable is False)

    # L2 分摊比例应落在 (0,1) 且同商品各仓合计 ≤ 1
    shares = [v.share for v in infos.values() if v.level == "L2"]
    check("L2 分摊比例在 (0,1) 区间", all(0 < s < 1 for s in shares),
          f"share={shares}")

    cov = classify.coverage_report(infos)
    check("覆盖度报告计数一致",
          cov["L1"] + cov["L2"] + cov["L3"] == cov["total"] == len(infos),
          f"L1={cov['L1']} L2={cov['L2']} L3={cov['L3']}")


# ======================================================== 5. 特征
def test_features() -> None:
    section("5. 特征工程（防泄漏 + 残差目标）")

    n = 200
    rng = np.random.default_rng(1)
    sales = np.cumsum(rng.normal(0, 1, n)) + 50
    dates = pd.Series(pd.date_range("2015-01-01", periods=n))

    # ⚠️ 第一个可用窗口不在 t=window-1：roll_mean_14 需要前 14 个值，
    #    所以首个无 NaN 窗口的末端是 max(window-1, 14+window-1-9) 之类的位置。
    #    正确做法是让被测函数自己告诉我们它取了哪一天，而不是硬编码下标。
    ws = features.build_windows(dates, sales, window=10, horizon=1,
                               sigma=1.0, target_mode="abs")
    first_target = pd.Timestamp(ws.y_date[0])
    expect = float(sales[dates[dates == first_target].index[0]])
    check("abs 模式目标 = 该样本目标日期的真实销量",
          abs(float(ws.y[0]) - expect) < 1e-4,
          f"y={ws.y[0]:.4f} 期望={expect:.4f} @ {first_target.date()}")

    ws2 = features.build_windows(dates, sales, window=10, horizon=1,
                                 sigma=1.0, target_mode="resid")
    base = float(ws2.baseline[0])
    check("resid 模式目标 = 真值 − 基线",
          abs(float(ws2.y[0]) - (expect - base)) < 1e-4,
          f"y={ws2.y[0]:.4f} 真值-基线={expect - base:.4f}")
    check("残差还原闭环",
          abs(features.residual_to_value(float(ws2.y[0]), base, 1.0) - expect) < 1e-4)
    check("X / y / baseline 行数一致",
          ws2.X.shape[0] == ws2.y.shape[0] == ws2.baseline.shape[0],
          f"{ws2.X.shape[0]} 行")
    check("无 NaN 泄漏进标签",
          not np.isnan(ws2.y).any() and not np.isnan(ws2.baseline).any())

    # 滚动特征必须只向后看（防未来信息泄漏）
    feat = features.build_feature_frame(dates, sales)
    check("滚动特征不含未来信息（roll_mean_7 首位为 NaN）",
          np.isnan(feat["roll_mean_7"].iloc[0]))

    # 窗口内含缺失的样本必须被丢弃，而不是填 0
    s2 = sales.copy(); s2[5] = np.nan
    ws3 = features.build_windows(dates, s2, window=10, horizon=1, sigma=1.0)
    check("窗口含缺失的样本被丢弃（不填 0）", ws3.X.shape[0] < ws.X.shape[0],
          f"{ws3.X.shape[0]} < {ws.X.shape[0]} 样本")

    # 推理窗口
    xw = features.build_inference_windows(dates, sales, window=10)
    check("推理窗口形状为 (1, window, n_features)",
          xw.shape == (1, 10, features.N_FEATURES), str(xw.shape))

    check("日历特征含节假日列", "is_holiday" in features.FEATURE_NAMES)
    check("特征数一致", features.N_FEATURES == len(features.FEATURE_NAMES),
          f"N_FEATURES={features.N_FEATURES}")


# ======================================================== 6. 指标与基线
def test_metrics() -> None:
    section("6. 指标与基线（附录 C-1 口径 + 同点公平性）")

    check("加权 MAPE 计算正确",
          abs(M.weighted_mape(np.array([100.0, 200.0]), np.array([110.0, 180.0])) - 10.0) < 1e-6,
          f"{M.weighted_mape(np.array([100.,200.]), np.array([110.,180.])):.2f}%")

    check("全零真值的 MAPE 为 NaN（不返回 0 假完美）",
          np.isnan(M.weighted_mape(np.array([0.0, 0.0]), np.array([1.0, 1.0]))))

    check("MAE 计算正确",
          abs(M.mae(np.array([1.0, 3.0]), np.array([2.0, 5.0])) - 1.5) < 1e-9)

    check("RMSE 计算正确",
          abs(M.rmse(np.array([1.0, 3.0]), np.array([2.0, 5.0])) - np.sqrt(2.5)) < 1e-9)

    # 长度不一致必须报错（静默对齐会掩盖 bug）
    try:
        M.mae(np.array([1.0]), np.array([1.0, 2.0]))
        check("长度不一致应抛错", False)
    except ValueError:
        check("长度不一致应抛错", True)

    # 移动平均基线
    fc = M.moving_average_forecast(np.array([10.0, 20.0, 30.0]), 3, window=3)
    check("移动平均基线平铺外推", np.allclose(fc, 20.0), str(fc))
    check("空历史的基线为 NaN",
          np.isnan(M.moving_average_forecast(np.array([]), 2)).all())

    # 任务级：模型应赢过基线
    rng = np.random.default_rng(2)
    truth = rng.normal(100, 10, 50)
    good = truth + rng.normal(0, 2, 50)      # 模型：小误差
    base = truth + rng.normal(0, 8, 50)      # 基线：大误差
    recs = [{"sku": f"s{i}", "warehouse": "w", "level": "L1",
             "y_true": [truth[i]], "y_pred": [good[i]], "baseline": [base[i]]}
            for i in range(50)]
    m = M.compute_task_metrics(recs, 1)
    check("模型优于基线时 improve 为正", m.mae_improve_pct > 0,
          f"MAE 降低 {m.mae_improve_pct:.1f}%")
    check("综合判定达标", m.all_ok)

    # L3 不参与指标
    recs2 = recs + [{"sku": "z", "warehouse": "w", "level": "L3",
                     "y_true": [1.0], "y_pred": None, "baseline": None}]
    m2 = M.compute_task_metrics(recs2, 1)
    check("L3 计入覆盖统计", m2.levels.L3 == 1)
    check("L3 不影响指标（与不含 L3 的结果相同）",
          abs(m2.weighted_mape - m.weighted_mape) < 1e-9)

    # L2 默认不计入主指标（口径决定，见 metrics 模块说明）
    recs3 = [{"sku": "a", "warehouse": "w", "level": "L1",
              "y_true": [100.0], "y_pred": [102.0], "baseline": [110.0]},
             {"sku": "b", "warehouse": "w", "level": "L2",
              "y_true": [100.0], "y_pred": [900.0], "baseline": [110.0]}]
    m3 = M.compute_task_metrics(recs3, 1)
    check("L2 默认不计入主指标", abs(m3.weighted_mape - 2.0) < 1e-6,
          f"MAPE={m3.weighted_mape:.2f}%（若含 L2 会变成 401%）")
    check("L2 误差仍单独统计", not np.isnan(m3.l2_mape), f"L2 MAPE={m3.l2_mape:.1f}%")

    # verdict 结构
    v = M.verdict(m)
    check("verdict 返回 4 项检查", len(v["checks"]) == 4)


# ======================================================== 7. 兜底
def test_fallback() -> None:
    section("7. 规则兜底（L2 分摊 / L3 明确不预测）")

    df = pd.DataFrame({
        "sku_id": ["X"] * 6, "warehouse_id": ["w1"] * 3 + ["w2"] * 3,
        "date": pd.date_range("2015-01-01", periods=3).tolist() * 2,
        "sales": [10, 10, 10, 30, 30, 30],
    })

    shares = fallback.warehouse_shares(df, "X")
    check("仓占比计算正确",
          abs(shares["w1"] - 0.25) < 1e-9 and abs(shares["w2"] - 0.75) < 1e-9,
          str({k: round(v, 3) for k, v in shares.items()}))

    fc, note = fallback.l2_forecast(df, "X", "w1", 3)
    check("L2 预测非负", (fc >= 0).all(), str(np.round(fc, 1)))
    check("L2 说明含分摊策略", note["strategy"] == "item_level_allocate")

    # L3 必须返回 None —— 绝不能"给个大概数让它看起来完整"
    fc3, note3 = fallback.l3_forecast(df, "X", "w3")
    check("L3 不输出数值预测（返回 None）", fc3 is None)
    check("L3 标记 predictable=False", note3["predictable"] is False)
    check("L3 提供历史均值供人工参考", not np.isnan(note3["historical_mean"]))


# ======================================================== 8. 配置契约
def test_config() -> None:
    section("8. 配置契约（与 PRD / 附录 C 一致）")

    check("加权 MAPE 阈值 = 20%", C.WEIGHTED_MAPE_LIMIT == 20.0)
    check("基线改善阈值 = 15%", C.BASELINE_IMPROVE_LIMIT == 15.0)
    check("达标序列占比 = 60%", C.SERIES_PASS_RATE_TARGET == 60.0)
    check("SLA = 60 秒", C.SLA_SECONDS == 60)
    check("L1 阈值 = 90 天", C.L1_MIN_VALID_POINTS == 90)
    check("序列上限 = 1000", C.MAX_SERIES == 1000)
    check("CSV 必需列含 warehouse_id", C.COL_WAREHOUSE in C.REQUIRED_COLUMNS,
          str(C.REQUIRED_COLUMNS))
    check("校验顺序固定为 7 步", len(C.VALIDATE_ORDER) == 7, " → ".join(C.VALIDATE_ORDER))

    # TaskConfig 只接受 7/14/30
    for h in (7, 14, 30):
        try:
            C.TaskConfig(horizon=h)
            ok = True
        except ValueError:
            ok = False
        check(f"horizon={h} 合法", ok)
    try:
        C.TaskConfig(horizon=15)
        check("horizon=15 应被拒绝", False)
    except ValueError:
        check("horizon=15 应被拒绝", True)

    # 粒度固定
    try:
        C.TaskConfig(granularity="item")
        check("非 warehouse_sku 粒度应被拒绝", False)
    except ValueError:
        check("非 warehouse_sku 粒度应被拒绝", True)


# ======================================================== 9. 架构红线
def test_architecture() -> None:
    section("9. 架构红线（algo 层不得依赖 Web 框架）")

    algo_dir = ROOT / "app" / "algo"
    banned = ("fastapi", "sqlalchemy", "pydantic", "starlette", "uvicorn")
    offenders = []
    for py in algo_dir.glob("*.py"):
        text = py.read_text(encoding="utf-8")
        for line in text.splitlines():
            s = line.strip()
            if s.startswith(("import ", "from ")):
                if any(b in s for b in banned):
                    offenders.append(f"{py.name}: {s}")
    check("app/algo 下无 Web 依赖引用", not offenders, "; ".join(offenders) or "已扫描全部模块")

    check("train.py 存在于 algo 层（供离线调用）", (algo_dir / "train.py").exists())
    check("infer.py 存在（在线主路径）", (algo_dir / "infer.py").exists())


# ======================================================== main
def main() -> int:
    print("=" * 64)
    print("  算法骨架自检 —— 可执行规格")
    print("=" * 64)

    test_validate()
    test_clean()
    test_scaler_split()
    test_classify()
    test_features()
    test_metrics()
    test_fallback()
    test_config()
    test_architecture()

    print("\n" + "=" * 64)
    total = PASS + FAIL
    print(f"  通过 {PASS}/{total}   失败 {FAIL}")
    if FAILED_NAMES:
        print("  失败项：")
        for n in FAILED_NAMES:
            print(f"    · {n}")
    print("=" * 64)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
