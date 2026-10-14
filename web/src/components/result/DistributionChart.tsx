/**
 * 结果页·逐序列 MAPE 分布直方图（`FR-VIS-08` / `UX-P08-09`）
 * =============================================================================
 * 🔒 **分箱 ≤ 20**（`UX-P08-09`）：接口的 `distribution.buckets` 已是
 *    20 个箱（后端 `_distribution()` 压好的，每箱 5 个百分点）。
 *    这里**只做展示**，不重新分箱 —— 前端再分一次箱，两侧的分箱边界
 *    必然对不上（后端是 `int(v // 5)`），图上会出现「接口说 13 条超标，
 *    图里数出来 15 条」。
 *
 * 🔒 **超标箱用 `--danger`**：分界线固定在 `threshold`（20%）。
 *    20% 恰好落在第 4 个箱（15~20）与第 5 个箱（20~25）的边界上，
 *    所以「箱下界 ≥ threshold」即整箱超标 —— 用**箱下界**判断而不是
 *    「箱内是否有超标值」，因为后端已按同一规则压箱，两者必须同口径。
 *
 * ⚠️ **为什么不给每根柱子挂 tooltip 里的「该箱内序列数」以外的信息**：
 *    逐序列 MAPE 明细未落库（见 `result_service._series_curves` 的说明），
 *    所以直方图只能到「分布」这一层。这里如实呈现分位数与超标条数，
 *    不编造「最差的 3 条序列是哪几个」。
 */
import { lazy, Suspense, useMemo } from 'react';

import { Skeleton } from '../Skeleton';
import type { Distribution } from '../../types';

type Props = { distribution: Distribution };

const BUCKET_SIZE = 5;

/**
 * 🔴 **顶层 `import EChart` 已改为懒加载**（`EP-8` 修复的包体回归）。
 *
 * 背景：本组件是 `EP-6` 的产物，当时顶层静态 import 了 `EChart`。
 * 由于 `ResultPage` 是**静态导入**的（路由全静态，无 `React.lazy`），
 * 整条链路 `router → ResultPage → DistributionChart → EChart → echarts`
 * 全部落进主包 —— 实测主包 **343 kB → 1.6 MB**，把`EP-3`
 * 「主包从 1381 kB 降到 343 kB」的优化成果完全抵消了。
 *
 * 为什么之前一直没被发现：`EP-3` 只验证了**首页**（`HeroChart`，
 * 本来就是 lazy 的），此后没人再盯主包体积；而 `DOD-EP6`~`DOD-EP7`
 * 的验收项里没有「包体」这一条。**指标没测= 回归不会被拦下。**
 *
 * 📌 改法沿用`HomePage` 对 `HeroChart` 的既有写法（`lazy(() => import(...))`
 *    + `<Suspense>`），不是新发明。
 */
const EChart = lazy(() => import('../EChart'));

export default function DistributionChart({ distribution }: Props) {
  // 🔒 用 useMemo 固定引用：`distribution.buckets ?? []` 每次渲染都是新数组，
  //    会让下面的 useMemo 依赖每次都变 → 图表每次重绘（ECharts 全量 setOption）。
  const buckets = useMemo(() => distribution.buckets ?? [], [distribution.buckets]);

  const option = useMemo(() => {
    const labels = buckets.map((_, i) => {
      const lo = i * BUCKET_SIZE;
      const hi = lo + BUCKET_SIZE;
      return hi >= 100 ? `${lo}+` : `${lo}~${hi}`;
    });
    // 🔒 超标箱：箱下界 >= threshold（与后端 int(v // 5) 压箱同口径）
    const threshold = distribution.threshold || 20;
    const colors = buckets.map((_, i) =>
      i * BUCKET_SIZE >= threshold ? 'var(--danger)' : 'var(--c1)',
    );

    return {
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        formatter: (params: unknown) => {
          const arr = params as Array<{ name: string; value: number; dataIndex: number }>;
          const p = arr?.[0];
          if (!p) return '';
          const lo = p.dataIndex * BUCKET_SIZE;
          const hi = lo + BUCKET_SIZE;
          const tag = lo >= threshold ? '（超标区间）' : '';
          return `MAPE ${lo}% ~ ${hi === 100 ? '100%+' : `${hi}%`}<br/>${p.value} 条序列${tag}`;
        },
      },
      xAxis: {
        type: 'category' as const,
        data: labels,
        axisLabel: { fontSize: 11, interval: buckets.length > 12 ? 1 : 0 },
      },
      yAxis: {
        type: 'value' as const,
        name: '序列数',
        nameTextStyle: { fontSize: 11 },
        axisLabel: { fontSize: 11 },
        splitLine: { lineStyle: { type: 'dashed' as const } },
      },
      series: [
        {
          type: 'bar' as const,
          data: buckets.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
          barMaxWidth: 34,
          markLine: {
            silent: true,
            symbol: 'none',
            label: {
              formatter: `阈值 ${threshold}%`,
              fontSize: 11,
              position: 'insideEndTop' as const,
            },
            lineStyle: { type: 'dashed' as const, color: 'var(--danger)' },
            data: [{ xAxis: threshold / BUCKET_SIZE - 0.5 }],
          },
        },
      ],
    };
  }, [buckets, distribution.threshold]);

  if (!buckets.length) {
    return (
      <p className="py-8 text-center text-[0.8125rem]" style={{ color: 'var(--text-3)' }}>
        暂无分布数据
      </p>
    );
  }

  const stats = [
    { k: '中位数', v: distribution.median },
    { k: 'P75', v: distribution.p75 },
    { k: 'P90', v: distribution.p90 },
    { k: '最大值', v: distribution.max },
  ];
  const total = buckets.reduce((a, b) => a + b, 0);

  return (
    <div data-testid="distribution-chart">
      {/*骨架高度与 chart 的 240px 对齐，避免懒加载完成时布局跳动 */}
      <Suspense fallback={<Skeleton className="h-[15rem]" />}>
        <EChart option={option} height={240} testId="histogram" ariaLabel="逐序列 MAPE 分布直方图" />
      </Suspense>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="distribution-stats">
        {stats.map((s) => (
          <div key={s.k} className="rounded-[var(--radius-sm)] border p-2" style={{ borderColor: 'var(--border)' }}>
            <dt className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>{s.k}</dt>
            <dd className="text-[1rem] font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
              {s.v === null || s.v === undefined || Number.isNaN(s.v) ? '—' : `${Number(s.v).toFixed(2)}%`}
            </dd>
          </div>
        ))}
        <div
          className="rounded-[var(--radius-sm)] border p-2"
          style={{ borderColor: distribution.over_count > 0 ? 'var(--danger)' : 'var(--border)' }}
          data-testid="distribution-over"
        >
          <dt className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>超阈值</dt>
          <dd
            className="text-[1rem] font-semibold tabular-nums"
            style={{ color: distribution.over_count > 0 ? 'var(--danger)' : 'var(--success)' }}
          >
            {distribution.over_count} / {total}
          </dd>
        </div>
      </dl>
    </div>
  );
}
