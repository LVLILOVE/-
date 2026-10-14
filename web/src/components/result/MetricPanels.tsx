/**
 * 结果页·结论判定条 + 指标卡 + 基线对照表（`UX-P08-01` / `UX-P08-02` / `UX-P08-03`）
 * =============================================================================
 * 🔒 **为什么指标不四舍五入后再判定**：判定用的是接口返回的原值
 *    （`weighted_mape` 等），不是显示用的 `toFixed(2)` 字符串。
 *    先格式化再比较会出现「显示 20.00% 但判定为达标」的边界矛盾 ——
 *    20.004 显示成 20.00 却 ≥ 20 判达标，用户会认为判定错了。
 *
 * 🔒 **为什么主口径徽标只挂在 MAPE 上**（`UX-P08-02`）：
 *    加权 MAPE 是唯一的**主指标**（📌 已确认，见开发方案附录 C Q2），
 *    MAE / RMSE 是绝对误差量纲、与基线对比才有意义，达标占比是辅助指标。
 *    四张卡平铺时若不明确标出主口径，用户会拿 MAE 去和 20% 的阈值比。
 *
 * ⚠️ **基线对照表必须写「同口径」声明**（`FR-MOD-06` / `UX-P08-03`）：
 *    「优于基线 26.42%」这句话离开「同预测点、同序列集合」的前提就是误导 ——
 *    换个更差的基线（如「昨天的销量」）一样能提升 26%，而那没有意义。
 */
import type { MetricBundle } from '../../types';
import { THRESHOLDS } from '../../types';

type Props = {
  metrics: MetricBundle;
  isOverThreshold: boolean;
  /** L1 序列数（主指标统计范围），来自 coverage */
  l1Count: number;
  /** 明细总行数，用于说明「评估对象」 */
  detailTotal: number;
};

type Verdict = {
  key: string;
  label: string;
  value: number | null;
  limit: number;
  /** 比较方向：true 表示 value <= limit 为达标 */
  lessOrEqual: boolean;
  fmt: (v: number) => string;
  unit: string;
  /** 判定所用值；null 时判为「无法判定」 */
  judge: (m: MetricBundle) => number | null;
};

/**
 * 四条判定（`PRD` §3.4.3 三条硬指标 + 达标占比辅助）。
 *
 * ⚠️ `baseline_mape` **不参与判定**：它是数据库预留列，恒为 NULL
 *    （`models/metric.py` 的 TD-DB-04）。把它列进判定表会出现一行永远
 *    「无法判定」，用户以为系统坏了。基线的可比口径是 MAE / RMSE。
 */
const VERDICTS: Verdict[] = [
  {
    key: 'mape',
    label: '加权 MAPE',
    value: null,
    limit: THRESHOLDS.weighted_mape_max,
    lessOrEqual: true,
    fmt: (v) => v.toFixed(2),
    unit: '%',
    judge: (m) => m.weighted_mape,
  },
  {
    key: 'maeImprove',
    label: 'MAE 优于基线',
    value: null,
    limit: THRESHOLDS.baseline_improve_min,
    lessOrEqual: false,
    fmt: (v) => v.toFixed(2),
    unit: '%',
    judge: (m) => m.mae_improve_pct,
  },
  {
    key: 'rmseImprove',
    label: 'RMSE 优于基线',
    value: null,
    limit: THRESHOLDS.baseline_improve_min,
    lessOrEqual: false,
    fmt: (v) => v.toFixed(2),
    unit: '%',
    judge: (m) => m.rmse_improve_pct,
  },
  {
    key: 'passRate',
    label: '达标序列占比',
    value: null,
    limit: THRESHOLDS.series_pass_rate_min,
    lessOrEqual: false,
    fmt: (v) => v.toFixed(2),
    unit: '%',
    judge: (m) => m.series_pass_rate,
  },
];

function isPass(v: Verdict, m: MetricBundle): boolean | null {
  const raw = v.judge(m);
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
  return v.lessOrEqual ? raw <= v.limit : raw >= v.limit;
}

/**
 * 🔒 指标格式化：**null 一律显示「—」，绝不退化成 0**。
 *
 * 什么时候会是 null：没有任何可评估序列时（`levels_for_main=("L1",)` 且
 * L1 = 0 —— 例如上传的数据全是 5 天短序列，全部落入 L2/L3），算法把误差
 * 指标置为 NaN，落库为 NULL。此时：
 *   · 显示 0 → 用户读成「误差为零、完美预测」，比空白危险得多；
 *   · 显示 — + 判为「无法评估」→ 才是诚实的表达。
 */
function fmt(v: number | null | undefined, digits = 2, suffix = ''): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}${suffix}`;
}

/** 达标判定；null → 无法评估（第三态，不可当达标也不可当未达标） */
function ge(v: number | null | undefined, limit: number): boolean | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return v >= limit;
}
function le(v: number | null | undefined, limit: number): boolean | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return v <= limit;
}

/** 三态 → 颜色（null 走中性灰，不冒充成功/失败） */
function stateColor(s: boolean | null): string {
  return s === null ? 'var(--text-3)' : s ? 'var(--success)' : 'var(--danger)';
}

/**
 * soft 底（`--{k}-soft`）之上的三态文字色。
 * -----------------------------------------------------------------------------
 * ⚠️ **为什么不能复用 `stateColor`**：`--success-soft` 是「语义色按低透明度叠在
 * surface 上」，深色主题下 surface 很暗（L=0.225），叠出来的底色也偏暗；
 * 而 `--success` / `--danger` 的 L 本身不高（0.68 / 0.64），实测对比度只有
 * 3.62 / 3.07，**低于 AA 要求的 4.5:1** —— 表现就是深色下「通过 / 未通过」
 * 徽标文字发灰、看不清。故 soft 底场景改用专用的 `--on-*-soft`（深色下已拉亮）。
 *
 * 📌 `stateColor` 仍用于**卡片 / 表格**底（背景是 surface，对比度天然充足），
 *    两套函数按「底色是不是 soft」分工，不要合并。
 */
function stateColorOnSoft(s: boolean | null): string {
  return s === null ? 'var(--text-3)' : s ? 'var(--on-success-soft)' : 'var(--on-danger-soft)';
}

export function VerdictBar({ metrics, isOverThreshold }: Pick<Props, 'metrics' | 'isOverThreshold'>) {
  // 🔒 总体判定用接口的 `is_over_threshold`（后端算好的），
  //    **不**在前端重算四项的与关系。两处判定一旦不一致，
  //    用户会看到「警告说超标、下面四张卡却全绿」的自相矛盾。
  const allPass = !isOverThreshold;
  // 🔒 「无法评估」是**第三种状态**：全部四项指标都为 null（无可评估序列）。
  //    此时不能沿用「未达标」的措辞 —— 那会把「数据不足」说成「模型不行」，
  //    用户会去调模型参数，而真正该做的是换一份历史更长的数据。
  const noEvaluable = VERDICTS.every((v) => v.judge(metrics) === null
    || v.judge(metrics) === undefined
    || Number.isNaN(v.judge(metrics) as number));
  const tone = noEvaluable ? 'var(--text-3)' : allPass ? 'var(--success)' : 'var(--danger)';
  const toneSoft = noEvaluable ? 'var(--bg-subtle)' : allPass ? 'var(--success-soft)' : 'var(--danger-soft)';
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border px-4 py-3"
      style={{ borderColor: tone, background: toneSoft }}
      data-testid="verdict-bar"
      role="status"
    >
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.95rem] font-bold"
        style={{ background: tone, color: 'var(--surface)' }}
        aria-hidden
      >
        {noEvaluable ? '?' : allPass ? '✓' : '!'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[1.0625rem] font-semibold" style={{ color: 'var(--text)' }}>
          {noEvaluable ? '本次结果无法评估' : allPass ? '预测结果达标' : '预测结果未达标'}
        </p>
        <p className="text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
          {noEvaluable
            ? '没有任何序列达到 L1（历史充足）标准，主指标不参与计算 —— 这是数据条件所限，不是模型表现问题。请上传历史更长的数据后重跑。'
            : allPass
              ? `加权 MAPE ${fmt(metrics.weighted_mape)}% ≤ ${THRESHOLDS.weighted_mape_max}%，且 MAE / RMSE 均优于移动平均基线 ${THRESHOLDS.baseline_improve_min}% 以上。`
              : `加权 MAPE ${fmt(metrics.weighted_mape)}% 超过 ${THRESHOLDS.weighted_mape_max}% 阈值，请查看下方指标定位原因，或调整步长 / 数据范围后重跑。`}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="verdict-chips">
        {VERDICTS.map((v) => {
          const pass = isPass(v, metrics);
          return (
            <span
              key={v.key}
              className="rounded-full px-2.5 py-1 text-[0.75rem] font-medium"
              style={{
                background: pass === null ? 'var(--bg-subtle)' : pass ? 'var(--success-soft)' : 'var(--danger-soft)',
                color: stateColorOnSoft(pass),
                border: `1px solid ${pass === null ? 'var(--border)' : pass ? 'var(--success)' : 'var(--danger)'}`,
              }}
              data-testid={`verdict-chip-${v.key}`}
            >
              {v.label} {pass === null ? '无法评估' : pass ? '通过' : '未通过'}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 四张指标卡（`UX-P08-02`） */
export function MetricCards({ metrics, l1Count, detailTotal }: Props) {
  const cards = [
    {
      key: 'mape',
      title: '加权 MAPE',
      main: true,
      value: fmt(metrics.weighted_mape, 2, '%'),
      sub: `阈值 ≤ ${THRESHOLDS.weighted_mape_max}%`,
      ok: le(metrics.weighted_mape, THRESHOLDS.weighted_mape_max),
      note: `主口径 · 仅统计 L1 ${l1Count} 条序列`,
    },
    {
      key: 'mae',
      title: '加权 MAE',
      main: false,
      value: fmt(metrics.weighted_mae, 3),
      sub: `基线 ${fmt(metrics.baseline_mae, 3)} · 降低 ${fmt(metrics.mae_improve_pct, 2, '%')}`,
      ok: ge(metrics.mae_improve_pct, THRESHOLDS.baseline_improve_min),
      note: `约束：降低 ≥ ${THRESHOLDS.baseline_improve_min}%`,
    },
    {
      key: 'rmse',
      title: '加权 RMSE',
      main: false,
      value: fmt(metrics.weighted_rmse, 3),
      sub: `基线 ${fmt(metrics.baseline_rmse, 3)} · 降低 ${fmt(metrics.rmse_improve_pct, 2, '%')}`,
      ok: ge(metrics.rmse_improve_pct, THRESHOLDS.baseline_improve_min),
      note: `约束：降低 ≥ ${THRESHOLDS.baseline_improve_min}%`,
    },
    {
      key: 'passRate',
      title: '达标序列占比',
      main: false,
      value: fmt(metrics.series_pass_rate, 2, '%'),
      sub: `${metrics.series_passed} / ${metrics.series_evaluated} 条达标`,
      ok: ge(metrics.series_pass_rate, THRESHOLDS.series_pass_rate_min),
      note: `阈值 ≥ ${THRESHOLDS.series_pass_rate_min}%`,
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="metric-cards">
      {cards.map((c) => (
        <div
          key={c.key}
          className="rounded-[var(--radius)] border p-4"
          style={{
            borderColor: c.main ? 'var(--primary)' : 'var(--border)',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-sm)',
          }}
          data-testid={`metric-card-${c.key}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
              {c.title}
            </span>
            {c.main && (
              <span
                className="rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold"
                style={{ background: 'var(--primary-soft)', color: 'var(--on-primary-soft)' }}
              >
                主口径
              </span>
            )}
          </div>
          <p
            className="mt-2 text-[1.75rem] font-semibold tabular-nums"
            // 🔒 三态配色：达标绿 / 未达标红 / 无法评估中性灰。
            //    null 若落到 `c.ok ? success : danger`，会显示成红色 ——
            //    「无法评估」被染成「未达标」，是在误导用户去调模型。
            style={{ color: stateColor(c.ok) }}
          >
            {c.value}
          </p>
          <p className="mt-1 text-[0.75rem]" style={{ color: 'var(--text-2)' }}>
            {c.sub}
          </p>
          <p className="mt-2 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
            {c.note}
          </p>
        </div>
      ))}
      <p className="text-[0.75rem] sm:col-span-2 lg:col-span-4" style={{ color: 'var(--text-3)' }} data-testid="metric-scope">
        评估对象：L1 序列 {l1Count} 条（预测点 {detailTotal.toLocaleString('zh-CN')} 个）。
        L2 / L3 的误差由降级规则决定，不代表 LSTM 能力，故不计入主指标。
      </p>
    </div>
  );
}

/** 基线对照表（`UX-P08-03` / `FR-MOD-06`） */
export function BaselineTable({ metrics }: Pick<Props, 'metrics'>) {
  const rows = [
    {
      key: 'mae',
      name: 'MAE',
      model: metrics.weighted_mae,
      baseline: metrics.baseline_mae,
      improve: metrics.mae_improve_pct,
      constraint: `≥ ${THRESHOLDS.baseline_improve_min}%`,
    },
    {
      key: 'rmse',
      name: 'RMSE',
      model: metrics.weighted_rmse,
      baseline: metrics.baseline_rmse,
      improve: metrics.rmse_improve_pct,
      constraint: `≥ ${THRESHOLDS.baseline_improve_min}%`,
    },
  ];
  return (
    <div data-testid="baseline-table">
      <table className="w-full border-collapse text-[0.8125rem]">
        <caption className="sr-only">模型与移动平均基线的同口径对照</caption>
        <thead>
          <tr style={{ color: 'var(--text-2)' }}>
            <th scope="col" className="border-b px-2 py-2 text-left font-medium">指标</th>
            <th scope="col" className="border-b px-2 py-2 text-right font-medium">本模型</th>
            <th scope="col" className="border-b px-2 py-2 text-right font-medium">移动平均基线</th>
            <th scope="col" className="border-b px-2 py-2 text-right font-medium">降低幅度</th>
            <th scope="col" className="border-b px-2 py-2 text-left font-medium">约束</th>
            <th scope="col" className="border-b px-2 py-2 text-left font-medium">判定</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ok = ge(r.improve, THRESHOLDS.baseline_improve_min);
            return (
              <tr key={r.key} data-testid={`baseline-row-${r.key}`}>
                <th scope="row" className="border-b px-2 py-2 text-left font-medium" style={{ color: 'var(--text)' }}>
                  {r.name}
                </th>
                <td className="border-b px-2 py-2 text-right tabular-nums">{fmt(r.model, 3)}</td>
                <td className="border-b px-2 py-2 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>
                  {fmt(r.baseline, 3)}
                </td>
                <td className="border-b px-2 py-2 text-right tabular-nums" style={{ color: stateColor(ok) }}>
                  {fmt(r.improve, 2, '%')}
                </td>
                <td className="border-b px-2 py-2" style={{ color: 'var(--text-2)' }}>{r.constraint}</td>
                <td className="border-b px-2 py-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[0.75rem] font-medium"
                    style={{
                      background: ok === null ? 'var(--bg-subtle)' : ok ? 'var(--success-soft)' : 'var(--danger-soft)',
                      color: stateColorOnSoft(ok),
                    }}
                  >
                    {ok === null ? '无法评估' : ok ? '通过' : '未通过'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
        基线 = 同窗口移动平均，与模型在<strong style={{ color: 'var(--text-2)' }}>完全相同的预测点、相同的序列集合</strong>上计算，两者可直接比较。
      </p>
    </div>
  );
}
