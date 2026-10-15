/**
 * =============================================================================
 * `UX-P01` 产品首页（模板 D / index）
 * -----------------------------------------------------------------------------
 * 布局四区块（UI/UX §7.1）：
 *   ① 首屏 hero：标签 + 主标题（含"一分钟"）+ 导语 + 双 CTA + 4 个事实数字 + 右侧图表
 *   ② 核心能力：「为什么用它」4 张特性卡，每卡带 `FR-*` 角标
 *   ③ 使用流程：五步步骤条（上传→校验→参数→执行→结果）
 *   ④ 基准数据集：介绍卡（字段表）+ 右侧元信息 + 与天池赛题差异对照表
 *
 * 另有一条**硬指标实测披露条**（`.eval-metrics`）：`DOD-EP3` 要求
 * 「首页展示的硬指标与 outputs/eval_report.json 逐项一致」，
 * 该条即为此要求的展示位与校验位（每项带 `data-metric` / `data-value`）。
 *
 * 🔒 数值来源纪律（`QD-06`）：
 *   - 实测值 → 一律取自 `../generated/metrics`（链路：outputs/eval_report.json →
 *     sync_eval_metrics.py → web/src/generated/）。文件里**不出现**任何实测数字。
 *   - 目标阈值 → `PRD_TARGETS`（`UX-P01-02` 要求与 PRD 一字不差）。
 *   两者并排展示，避免把「目标」读成「结果」。
 * =============================================================================
 */
import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';

import NoticeBar from '../components/NoticeBar';
import { SkeletonChart } from '../components/Skeleton';
import {
  COVERAGE_TEXT,
  DATASET_DIFF,
  DATASET_FIELDS,
  DATASET_META,
  E2E_SECONDS_TEXT,
  EVAL_REPORT,
  METRIC_ROWS,
  METRICS_ALL_OK,
  PRD_TARGETS,
} from '../generated/metrics';

/**
 * 首屏图表懒加载：ECharts 体积大（压缩后约 300 KB+），
 * 而它**只在首页用到**。懒加载后首屏 JS 明显变小，
 * 加载期间用同高骨架屏占位，避免布局抖动（WS-3-04 + `NFR-PERF`）。
 */
const HeroChart = lazy(() => import('../components/HeroChart'));

/** 从实测指标行里按 key 取值（找不到时给占位，避免静默显示 undefined） */
function metricDisplay(key: string, fallback = '—'): string {
  return METRIC_ROWS.find((m) => m.key === key)?.display ?? fallback;
}

/** 首屏 4 个事实数字：目标值来自 PRD，实测值来自评测报告 */
const HERO_FACTS = [
  {
    index: 1,
    value: `≤ ${PRD_TARGETS.mape_max_pct}%`,
    label: '销量加权 MAPE 硬指标',
    measuredLabel: '实测',
    measured: metricDisplay('weighted_mape'),
  },
  {
    index: 2,
    value: `≥ ${PRD_TARGETS.improve_min_pct}%`,
    label: '优于移动平均基线（MAE）',
    measuredLabel: '实测',
    measured: metricDisplay('mae_improve_pct'),
  },
  {
    index: 3,
    value: `≤ ${PRD_TARGETS.e2e_seconds_max} 秒`,
    label: '端到端耗时上限',
    measuredLabel: '实测',
    measured: `${E2E_SECONDS_TEXT} 秒`,
  },
  {
    index: 4,
    value: `${PRD_TARGETS.warehouse_count} 大分仓`,
    label: '仓库 × 商品粒度建模',
    measuredLabel: '基准集',
    measured: `${DATASET_META.item_count} 商品`,
  },
] as const;

/** 核心能力 4 张卡（每卡带需求编号角标） */
const FEATURES = [
  {
    key: 'granularity',
    title: '分仓粒度，不是全国一刀切',
    body: '按 仓库 × 商品 独立建模，直接回答"上海仓的保温杯下周备多少"，而不是只给一个全国总量让业务自己拍脑袋拆分。',
    req: 'FR-FEA-09 · FR-MOD-08',
    icon: (
      <>
        <path d="M12 3.2 20.5 7.6v8.8L12 20.8 3.5 16.4V7.6L12 3.2z" />
        <path d="M3.5 7.6 12 12l8.5-4.4M12 12v8.8" />
      </>
    ),
  },
  {
    key: 'coverage',
    title: '如实披露覆盖度，不藏短板',
    body: '数据不足的序列自动三级降级（LSTM 推理 / 商品级分摊 / 标记不可预测），并在结果页展示 L1/L2/L3 占比，明确告诉你哪些品这次算不准。',
    req: 'FR-VIS-07 · FR-MOD-08',
    icon: (
      <>
        <path d="M12 3 19 6v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6l7-3z" />
        <path d="M9.2 12.2 11.4 14.4 15 10.4" />
      </>
    ),
  },
  {
    key: 'metric',
    title: '误差有口径，不和基线玩数字游戏',
    body: '主指标采用销量加权 MAPE，与移动平均基线在同一批预测点、同一序列集合上对比，避免长尾序列把平均值拉爆或虚高。',
    req: 'FR-MOD-06 · FR-MOD-11',
    icon: (
      <>
        <path d="M4 19.2V5M4 19.2h16" />
        <path d="M7.5 15.5 11.5 11l3 2.6L20 7" />
      </>
    ),
  },
  {
    key: 'pretrained',
    title: '预训练推理，不等训练',
    body: '在线只做推理，不做重训。全量数据端到端不超过 60 秒，GPU 显存不足时自动回退 CPU，任务不中断。',
    req: 'FR-MOD-07 · FR-MOD-10',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.4" />
        <path d="M12 7.4V12l3.2 2" />
      </>
    ),
  },
] as const;

/** 五步流程 */
const STEPS = [
  { n: 1, title: '上传 CSV', desc: '拖拽或选择文件，也可一键加载示例数据' },
  { n: 2, title: '自动校验', desc: '字段、日期、连续性、序列数逐项检查' },
  { n: 3, title: '确认参数', desc: '步长 7 / 14 / 30 天，默认 7 天' },
  { n: 4, title: '执行预测', desc: '清洗 → 分级 → 推理 → 基线对比' },
  { n: 5, title: '看结果导出', desc: '曲线 + 指标 + 覆盖度 + 预测表' },
] as const;

const META_ROWS: readonly { k: string; v: string; mono?: boolean }[] = [
  { k: '商品数', v: String(DATASET_META.item_count), mono: true },
  { k: '分仓数', v: String(DATASET_META.warehouse_count), mono: true },
  { k: '理论序列数', v: DATASET_META.series_theoretical.toLocaleString('en-US'), mono: true },
  { k: '时间范围', v: DATASET_META.date_range, mono: true },
  { k: '分布特征', v: DATASET_META.distribution },
  { k: '缺失仓库样本', v: DATASET_META.missing_warehouse_samples.toLocaleString('en-US'), mono: true },
  { k: '许可', v: DATASET_META.license },
];

export default function HomePage() {
  return (
    <>
      {/* ==================== 区块 ① 首屏 ==================== */}
      <section className="hero mx-auto grid max-w-[var(--maxw)] items-center gap-10 px-7 pb-10 pt-14 max-[980px]:grid-cols-1 min-[981px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div>
          <span
            className="hero-tag mb-4 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75rem] font-semibold"
            style={{
              background: 'var(--primary-soft)',
              borderColor: 'oklch(0.62 0.145 var(--brand-h) / .3)',
              color: 'var(--primary)',
            }}
          >
            <span
              className="dot-success block h-[7px] w-[7px] rounded-full"
              style={{ background: 'var(--success)' }}
              aria-hidden
            />
            LSTM 多步预测 · 已预训练模型推理
          </span>

          <h1 className="mb-3.5 text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[1.2] tracking-[-.025em]">
            上传销量表，
            <em
              className="not-italic"
              style={{
                background: 'linear-gradient(100deg, var(--primary), oklch(0.68 0.16 265))',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              一分钟
            </em>
            拿到
            <br />
            未来分仓补货预测
          </h1>

          <p
            className="lede mb-6 max-w-[52ch] text-[0.9375rem] leading-[1.75]"
            style={{ color: 'var(--text-2)' }}
          >
            面向电商运营与仓配人员的<strong style={{ color: 'var(--text)' }}>零门槛</strong>预测工具。
            上传历史销量 CSV，系统自动完成数据清洗、特征工程与 LSTM 多步预测，
            直接给出未来 7 / 14 / 30 天的
            <strong style={{ color: 'var(--text)' }}>仓库 × 商品</strong>
            粒度销量曲线、误差指标与可导出的预测表。
          </p>

          <div className="hero-cta mb-5 flex flex-wrap gap-2.5">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-4 py-2.5 text-[0.875rem] font-semibold no-underline"
              style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
            >
              进入工作台
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 12h13M13 6.5 18.5 12 13 17.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <Link
              to="/upload"
              className="rounded-[var(--radius-sm)] border px-4 py-2.5 text-[0.875rem] no-underline"
              style={{ borderColor: 'var(--border-field)', color: 'var(--text)' }}
            >
              先看示例数据
            </Link>
          </div>

          {/* 4 个事实数字（UX-P01-02）：主值为 PRD 目标阈值，次值为实测 */}
          <div
            className="hero-facts flex flex-wrap gap-x-6 gap-y-3 border-t pt-5"
            style={{ borderColor: 'var(--border)' }}
          >
            {HERO_FACTS.map((f) => (
              <div className="hero-fact" key={f.index} data-fact-index={f.index}>
                <div
                  className="hf-v text-[1.375rem] font-bold tracking-[-.02em]"
                  style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {f.value}
                </div>
                <div className="hf-l mt-0.5 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                  {f.label}
                </div>
                <div className="mt-1 text-[0.6875rem]" style={{ color: 'var(--text-2)' }}>
                  {f.measuredLabel}{' '}
                  <strong style={{ color: 'var(--primary)' }} data-hero-measured={f.index}>
                    {f.measured}
                  </strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Suspense fallback={<SkeletonChart height={296} />}>
          <HeroChart />
        </Suspense>
      </section>

      {/* ==================== 硬指标实测披露条（DOD-EP3 校验位） ==================== */}
      <section className="section mx-auto max-w-[var(--maxw)] px-7 pb-10">
        <div
          className="eval-metrics rounded-[var(--radius)] border p-5"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          data-testid="eval-metrics"
          data-eval-source="outputs/eval_report.json"
          data-eval-horizon={EVAL_REPORT.horizon}
          data-eval-all-ok={METRICS_ALL_OK ? 'true' : 'false'}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <h2 className="text-[1.0625rem]">实测效果</h2>
            <span
              className="rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
              style={
                METRICS_ALL_OK
                  ? { background: 'var(--success-soft)', color: 'var(--on-success-soft)' }
                  : { background: 'var(--danger-soft)', color: 'var(--on-danger-soft)' }
              }
            >
              {METRICS_ALL_OK ? '四条硬指标全部达标' : '存在未达标项'}
            </span>
            <span className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
              预测步长 {EVAL_REPORT.horizon} 天 · 评测序列覆盖 {COVERAGE_TEXT} · 端到端实测{' '}
              {E2E_SECONDS_TEXT} 秒
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {METRIC_ROWS.map((m) => (
              <div
                key={m.key}
                className="metric-row rounded-[var(--radius-sm)] border p-3.5"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                data-metric={m.key}
                data-value={m.valueText}
                data-limit={m.limit}
                data-ok={m.ok ? 'true' : 'false'}
              >
                <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                  {m.label}
                </div>
                <div
                  className="mt-1 flex items-baseline gap-1.5"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  <span className="text-[1.25rem] font-bold" style={{ color: 'var(--text)' }}>
                    {m.display}
                  </span>
                  {/* 🔴 文案与配色都必须走 `m.ok`（`D-08`）：此前是硬编码的绿色「达标」，
                      判定只写进了 `data-ok` 属性。一旦某项指标未达标，界面仍显示绿色
                      「达标」，与同区顶部「存在未达标项」的徽标当场冲突。 */}
                  <span
                    className="text-[0.6875rem]"
                    style={{ color: m.ok ? 'var(--success)' : 'var(--danger)' }}
                    data-testid={`metric-verdict-${m.key}`}
                  >
                    {m.ok ? '达标' : '未达标'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <NoticeBar variant="info" className="mt-4" title="数据来源与口径">
            以上为预训练模型在基准数据集上的离线评测结果（销量加权 MAPE 为主指标，
            与移动平均基线在<strong>同一批预测点、同一序列集合</strong>上对比）。
            该数值由评测脚本产出，页面不手写。
          </NoticeBar>
        </div>
      </section>

      {/* ==================== 区块 ② 核心能力 ==================== */}
      <section className="section mx-auto max-w-[var(--maxw)] px-7 py-10">
        <div className="section-head mb-7 text-center">
          <h2 className="mb-1.5">为什么用它</h2>
          <p className="text-[0.875rem]" style={{ color: 'var(--text-2)' }}>
            四个真实存在于补货场景里、又最容易被忽略的问题
          </p>
        </div>

        <div className="feat-grid grid gap-4 min-[560px]:grid-cols-2 min-[1000px]:grid-cols-4">
          {FEATURES.map((f) => (
            <article
              key={f.key}
              className="feat rounded-[var(--radius)] border transition-colors"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', padding: '1.125rem' }}
            >
              <div
                className="feat-icon mb-3 grid h-[34px] w-[34px] place-items-center rounded-[var(--radius-sm)]"
                style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                aria-hidden
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    {f.icon}
                  </g>
                </svg>
              </div>
              <h3 className="mb-1.5 text-[0.9375rem]">{f.title}</h3>
              <p className="text-[0.8125rem] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
                {f.body}
              </p>
              <div
                className="feat-req mt-2.5 border-t border-dashed pt-2 text-[0.6875rem]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
              >
                {f.req}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ==================== 区块 ③ 使用流程 ==================== */}
      <section className="section mx-auto max-w-[var(--maxw)] px-7 py-10">
        <div className="section-head mb-7 text-center">
          <h2 className="mb-1.5">五步拿到预测结果</h2>
          <p className="text-[0.875rem]" style={{ color: 'var(--text-2)' }}>
            主干路径操作步数 ≤ 5 步，参数保持默认即可直接提交
          </p>
        </div>

        <div
          className="rounded-[var(--radius)] border p-5"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="steps grid gap-0 max-[900px]:grid-cols-1 min-[901px]:grid-cols-5">
            {STEPS.map((s) => (
              <div key={s.n} className="step flex gap-3 py-3 pr-3">
                <span
                  className="step-n grid h-7 w-7 flex-none place-items-center rounded-full border text-[0.75rem] font-bold"
                  style={{
                    background: 'var(--primary-soft)',
                    color: 'var(--on-primary-soft)',
                    borderColor: 'oklch(0.62 0.145 var(--brand-h) / .35)',
                  }}
                >
                  {s.n}
                </span>
                <div>
                  <h3 className="mb-0.5 text-[0.8125rem]">{s.title}</h3>
                  <p className="text-[0.75rem] leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== 区块 ④ 基准数据集 ==================== */}
      <section className="section mx-auto max-w-[var(--maxw)] px-7 pb-14 pt-10">
        <div className="section-head mb-7 text-center">
          <h2 className="mb-1.5">基准数据集</h2>
          <p className="text-[0.875rem]" style={{ color: 'var(--text-2)' }}>
            训练与演示统一使用阿里天池公开赛题数据
          </p>
        </div>

        <div
          className="dataset-card grid gap-6 rounded-[var(--radius)] border p-5 max-[820px]:grid-cols-1 min-[821px]:grid-cols-[minmax(0,1fr)_280px]"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2.5">
              <h3 className="text-[1.0312rem]">{DATASET_META.name}</h3>
              <span
                className="rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
                style={{ background: 'var(--primary-soft)', color: 'var(--on-primary-soft)' }}
              >
                {DATASET_META.source}
              </span>
            </div>

            <p className="mb-4 text-[0.875rem] leading-[1.8]" style={{ color: 'var(--text-2)' }}>
              阿里巴巴旗下电商场景的真实脱敏数据，覆盖全国与区域分仓两个维度。
              预测目标为<strong style={{ color: 'var(--text)' }}>非聚划算支付件数</strong>（
              <code>qty_alipay_njhs</code>），仓库维度以 <code>store_code</code> 标识，
              商品维度以 <code>item_id</code> 标识。
            </p>

            <div className="overflow-x-auto">
              <table className="fields w-full border-collapse text-[0.8125rem]">
                <thead>
                  <tr>
                    <th
                      className="border-b px-2 py-2 text-left text-[0.75rem] font-semibold"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
                    >
                      字段
                    </th>
                    <th
                      className="border-b px-2 py-2 text-left text-[0.75rem] font-semibold"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
                    >
                      类型
                    </th>
                    <th
                      className="border-b px-2 py-2 text-left text-[0.75rem] font-semibold"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
                    >
                      含义
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {DATASET_FIELDS.map((f) => (
                    <tr key={f.field}>
                      <td className="border-b px-2 py-2" style={{ borderColor: 'var(--border)' }}>
                        <code style={{ color: 'var(--primary)' }}>{f.field}</code>
                      </td>
                      <td
                        className="border-b px-2 py-2 text-[0.75rem]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
                      >
                        {f.type}
                      </td>
                      <td className="border-b px-2 py-2" style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                        {f.desc}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap gap-2.5">
              <a
                href={DATASET_META.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.8125rem]"
                style={{ borderColor: 'var(--border-field)', color: 'var(--text)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M14 4h6v6M20 4l-8.5 8.5M18 14v5.2a.8.8 0 0 1-.8.8H5.8a.8.8 0 0 1-.8-.8V7.8a.8.8 0 0 1 .8-.8H11"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                查看数据集主页
              </a>
              <Link
                to="/upload"
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[0.8125rem] no-underline"
                style={{ color: 'var(--primary)' }}
              >
                用示例数据试一次
              </Link>
            </div>
          </div>

          <div>
            <dl className="meta-list flex flex-col gap-0">
              {META_ROWS.map((r) => (
                <div
                  key={r.k}
                  className="meta-row flex items-center justify-between border-b py-2 text-[0.75rem] last:border-b-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <dt style={{ color: 'var(--text-3)' }}>{r.k}</dt>
                  <dd
                    className={r.mono ? 'mono' : ''}
                    style={{ color: 'var(--text)', fontFamily: r.mono ? 'var(--font-mono)' : undefined }}
                  >
                    {r.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* 与天池赛题主页的差异对照（UX-P01-03：结论列固定「以 PRD 为准」） */}
        <div
          className="dataset-diff mt-4 rounded-[var(--radius-sm)] border-l-[3px] px-4 py-3.5 text-[0.75rem] leading-[1.7]"
          style={{
            background: 'var(--warning-soft)',
            borderColor: 'var(--warning)',
            borderTop: '1px solid oklch(0.76 0.155 75 / .38)',
            borderRight: '1px solid oklch(0.76 0.155 75 / .38)',
            borderBottom: '1px solid oklch(0.76 0.155 75 / .38)',
            color: 'var(--text-2)',
          }}
        >
          <div className="mb-2 flex items-center gap-1.5 text-[0.75rem] font-bold" style={{ color: 'var(--text)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 4.5 21 20H3L12 4.5zM12 10v4.5"
                stroke="var(--warning)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            与参考数据集主页的差异说明（以 PRD 为准）
          </div>
          本产品的业务规则以 PRD V1.0 为准。天池赛题主页在若干设定上与本产品不同，以下差异均按 PRD 实现：
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-[0.6875rem]">
              <thead>
                <tr>
                  {['维度', '天池赛题主页', '本产品（以 PRD 为准）'].map((h) => (
                    <th
                      key={h}
                      className="border-b px-2 py-1.5 text-left font-semibold"
                      style={{ borderColor: 'oklch(0.76 0.155 75 / .28)', color: 'var(--text-3)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DATASET_DIFF.map((d) => (
                  <tr key={d.dim}>
                    <td
                      className="border-b px-2 py-1.5 align-top"
                      style={{ borderColor: 'oklch(0.76 0.155 75 / .28)', whiteSpace: 'nowrap' }}
                    >
                      {d.dim}
                    </td>
                    <td
                      className="border-b px-2 py-1.5 align-top"
                      style={{ borderColor: 'oklch(0.76 0.155 75 / .28)' }}
                    >
                      {d.tianchi}
                    </td>
                    <td
                      className="border-b px-2 py-1.5 align-top font-semibold"
                      style={{ borderColor: 'oklch(0.76 0.155 75 / .28)', color: 'var(--primary)' }}
                    >
                      {d.product}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
