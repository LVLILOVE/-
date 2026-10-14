/**
 * =============================================================================
 * 首页硬指标 · 派生层（DOD-EP3 / QD-06）
 * -----------------------------------------------------------------------------
 * 🔒 **本文件禁止出现任何「模型实测指标」的数值字面量。**
 *    所有实测值必须经下方 `derived` 派生自 `./eval_report.json`。
 *
 * 数据链路（唯一真源）：
 *   outputs/eval_report.json                  ← 算法侧产出（scripts/eval_report.py）
 *        │  scripts/sync_eval_metrics.py       ← 构建期注入（原样复制）
 *        ▼
 *   web/src/generated/eval_report.json        ← 前端可 import
 *        │  本文件
 *        ▼
 *   HomePage 的 .eval-metrics 区块
 *
 * 守卫：`scripts/verify_ep3.py` 会做三件事，任一失败即报错——
 *   ① 两个 JSON 深度相等；
 *   ② 本文件内不含实测数值字面量（防有人「顺手写死」）；
 *   ③ 浏览器渲染出的 `.eval-metrics` 各项与 JSON 逐项一致。
 *
 * 🔁 重训模型后必须重跑：
 *      python scripts/eval_report.py --horizon 14 --export-series
 *      python scripts/sync_eval_metrics.py
 * =============================================================================
 */
import evalReportJson from './eval_report.json';

/* =============================================================================
 * 1. 类型（与 outputs/eval_report.json 的结构一一对应）
 * ========================================================================== */

export type CoverageBlock = {
  L1: number;
  L2: number;
  L3: number;
  total: number;
  L1_pct: number;
  L2_pct: number;
  L3_pct: number;
  predictable: number;
  predictable_pct: number;
};

export type TimingBlock = {
  preprocess_ms: number;
  features_ms: number;
  inference_ms: number;
  metrics_ms: number;
  total_ms: number;
};

export type MetricsBlock = {
  weighted_mape: number;
  weighted_mae: number;
  weighted_rmse: number;
  baseline_mae: number;
  baseline_rmse: number;
  mae_improve_pct: number;
  rmse_improve_pct: number;
  series_pass_rate: number;
  series_passed: number;
  series_evaluated: number;
};

export type VerdictCheck = {
  name: string;
  value: number;
  limit: number;
  ok: boolean;
  unit: string;
};

export type EvalReport = {
  horizon: number;
  model: string;
  coverage: CoverageBlock;
  timing_ms: TimingBlock;
  metrics: MetricsBlock;
  verdict: { all_ok: boolean; checks: VerdictCheck[] };
};

/** 算法侧评测报告的只读视图（真源，勿改写） */
export const EVAL_REPORT = evalReportJson as EvalReport;

/* =============================================================================
 * 2. 实测硬指标（.eval-metrics 区块的数据源）
 * ========================================================================== */

/**
 * 稳定标识：与 `verdict.checks` 的**顺序**一一对应。
 * 加注释是为了让「顺序错位」这种静默 bug 在 code review 时就暴露。
 */
const CHECK_KEYS = [
  'weighted_mape', // 加权 MAPE ≤ 20%
  'mae_improve_pct', // MAE 优于基线 ≥ 15%
  'rmse_improve_pct', // RMSE 优于基线 ≥ 15%
  'series_pass_rate', // 达标序列占比 ≥ 60%
] as const;

export type MetricKey = (typeof CHECK_KEYS)[number];

export type MetricRow = {
  /** 稳定标识，渲染为 `data-metric`，供校验脚本按名取值 */
  key: string;
  /** 展示名（取自评测报告，人工不重写） */
  label: string;
  /** 展示值（保留 2 位，含单位） */
  display: string;
  /** 数值（保留 2 位字符串），渲染为 `data-value`，供脚本逐项比对 */
  valueText: string;
  /** 阈值 */
  limit: number;
  unit: string;
  ok: boolean;
};

/** 实测硬指标行（全部派生，禁止写死） */
export const METRIC_ROWS: MetricRow[] = EVAL_REPORT.verdict.checks.map((c, i) => ({
  key: CHECK_KEYS[i] ?? `check_${i}`,
  label: c.name,
  display: `${c.value.toFixed(2)}${c.unit}`,
  valueText: c.value.toFixed(2),
  limit: c.limit,
  unit: c.unit,
  ok: c.ok,
}));

/** 全部硬指标是否达标（评测报告自带结论） */
export const METRICS_ALL_OK: boolean = EVAL_REPORT.verdict.all_ok;

/** 端到端实测耗时（秒，保留 1 位）——NFR-USE-01 的实测对照 */
export const E2E_SECONDS_TEXT: string = (EVAL_REPORT.timing_ms.total_ms / 1000).toFixed(1);

/** 覆盖率摘要文案 */
export const COVERAGE_TEXT: string = `L1 ${EVAL_REPORT.coverage.L1} · L2 ${EVAL_REPORT.coverage.L2} · L3 ${EVAL_REPORT.coverage.L3}`;

/* =============================================================================
 * 3. PRD 硬指标目标阈值（UX-P01-02：必须与 PRD 一字不差）
 * -----------------------------------------------------------------------------
 * ⚠️ 这 4 个数是**需求目标**（PRD §3 的硬指标），不是模型实测值。
 *    实测值见上面的 METRIC_ROWS。首页把两者并排展示：
 *    「目标 ≤ 20%」+「实测 14.26%」，避免把目标当成结果。
 * ========================================================================== */

export const PRD_TARGETS = {
  /** FR-MOD-06：销量加权 MAPE 上限 */
  mape_max_pct: 20,
  /** FR-MOD-11：相对移动平均基线降低幅度下限 */
  improve_min_pct: 15,
  /** NFR-USE-01：端到端耗时上限（秒） */
  e2e_seconds_max: 60,
  /** 数据集分仓数（FR-FEA-09 建模粒度的事实前提） */
  warehouse_count: 5,
} as const;

/* =============================================================================
 * 4. 基准数据集元信息（FR-FEA-10 的数据集说明对接）
 * -----------------------------------------------------------------------------
 * 来源：《数据库设计文档》与《开发方案文档》中的数据事实（天池 167097，
 * 联网核实）：963 商品 × 5 仓 ≈ 4,815 条理论序列，约 450 天；
 * 长尾稀疏，缺失仓库样本 17,063 条。
 * ⚠️ 属「数据集描述」，与模型实测指标是两码事，故不与 METRIC_ROWS 混放。
 * ========================================================================== */

export const DATASET_META = {
  name: '菜鸟-需求预测与分仓规划',
  source: '天池 167097',
  url: 'https://tianchi.aliyun.com/dataset/167097',
  item_count: 963,
  warehouse_count: PRD_TARGETS.warehouse_count,
  series_theoretical: 4815,
  date_range: '2014-10-10 ~ 2015-12-27',
  distribution: '长尾 · 稀疏',
  missing_warehouse_samples: 17063,
  license: '免费（需登录）',
} as const;

/** 数据集字段表（对接 FR-UPL-02 的字段规范） */
export const DATASET_FIELDS: readonly { field: string; type: string; desc: string }[] = [
  { field: 'item_id', type: 'bigint', desc: '商品 ID' },
  { field: 'store_code', type: 'string', desc: '仓库编码（全国口径时为 all）' },
  { field: 'date', type: 'bigint', desc: '日期，如 20150912' },
  { field: 'qty_alipay_njhs', type: 'bigint', desc: '非聚划算支付件数（预测目标）' },
  { field: 'cate_id', type: 'bigint', desc: '叶子类目 ID' },
  { field: 'brand_id', type: 'bigint', desc: '品牌 ID' },
];

/**
 * 与天池赛题主页的差异对照（UX-P01-03）。
 * 结论列固定为「以 PRD 为准」——产品口径刻意收窄为「仅销量时序特征」。
 */
export const DATASET_DIFF: readonly {
  dim: string;
  tianchi: string;
  product: string;
}[] = [
  { dim: '预测步长', tianchi: '固定未来 2 周（14 天）', product: '7 / 14 / 30 天三档可选，默认 7 天' },
  { dim: '预测目标', tianchi: '目标库存 target（非销量）', product: '销量预测值 forecast_sales' },
  {
    dim: '评估指标',
    tianchi: '补少成本 A / 补多成本 B 的成本最小化',
    product: '加权 MAPE ≤ 20%，且优于移动平均基线 ≥ 15%',
  },
  { dim: '空间范围', tianchi: '全国 + 分仓双口径，含 all 汇总行', product: '仅仓库 × 商品，无全国汇总口径' },
  {
    dim: '特征范围',
    tianchi: '含浏览、加购、直通车等 30+ 行为特征',
    product: '仅销量时序 + 星期 / 月份 / 节假日 / 滞后 / 滚动均值',
  },
];
