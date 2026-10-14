/**
 * 首页首屏图表（浏览器框样式 + 历史实线 / 预测虚线 / 置信带 + 图例）
 * -----------------------------------------------------------------------------
 * 对应 UI/UX §7.1 的「首屏 hero 右侧：SVG 示意图」。
 *
 * 实现决策（记入方案 §7.4 执行记录）：
 *   原型是**手写 inline SVG**；此处改用 **ECharts + SVG 渲染器**，原因有三：
 *     ① 形态仍是 SVG（`renderer: 'svg'`），满足「SVG 示意图」的字面要求；
 *     ② 手写 SVG 的颜色是硬编码 oklch 字面量，**不会随主题变化**，
 *        而 `UX-GOV-02a` 要求「图表色随主题切换」，手写 SVG 做不到；
 *     ③ ECharts 的色板取自 CSS 变量令牌，顺带把「令牌是唯一真源」
 *        （`UX-GOV-02`）也一起落实了。
 *
 * ⚠️ 图中的数值是**示意**（schematic），不是真实预测产出。
 *    真实曲线在 EP-6 由 `API-15` 提供；本组件不消费 `eval_report.json`，
 *    因此与 `QD-06`（硬指标禁手写）无冲突。
 */
import type { EChartsOption } from 'echarts';
import { useMemo } from 'react';

import { useThemeStore } from '../store/useThemeStore';
import { readTokenVar } from '../theme/echarts-theme';
import EChart from './EChart';

/** 21 个时点：前 10 个为历史，第 10 个（索引 9）为历史/预测锚点 */
const N = 21;
const ANCHOR = 9;

/** 历史段（示意数据） */
const HISTORY: (number | null)[] = [
  420, 462, 431, 520, 488, 561, 529, 612, 570, 660,
  ...Array<null>(N - 10).fill(null),
];

/** 预测段基准值（示意数据），索引 9 起 */
const FORECAST_BASE = [660, 690, 726, 704, 762, 742, 802, 782, 834, 812, 866, 846];

const FORECAST: (number | null)[] = [
  ...Array<null>(ANCHOR).fill(null),
  ...FORECAST_BASE,
];

/** 置信区间：以预测值为中心上下浮动，越远越宽 */
const BAND_LOWER: (number | null)[] = [
  ...Array<null>(ANCHOR).fill(null),
  ...FORECAST_BASE.map((v, i) => Math.round(v - (55 + i * 4))),
];
/** 置信带宽度（上界 − 下界），预测越远越不确定 → 带越宽 */
const BAND_SPAN: (number | null)[] = [
  ...Array<null>(ANCHOR).fill(null),
  ...FORECAST_BASE.map((_, i) => 115 + i * 9),
];

/** 时点标签：2015-12-01 起逐日，MM-DD */
function dayLabel(index: number): string {
  const d = new Date(Date.UTC(2015, 11, 1));
  d.setUTCDate(d.getUTCDate() + index);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const X_AXIS: string[] = Array.from({ length: N }, (_, i) => dayLabel(i));

/**
 * 选项里**不出现任何颜色字面量** —— 色值运行时从设计令牌（CSS 变量）读取，
 * 因此深浅主题各自一套色，且与自绘图例的色块必然同源。
 *
 * ⚠️ 为什么不用 ECharts 的默认色板：默认色板按**系列序号**取色，
 *    而置信带的两条「不可见但占位」的系列也会消耗色位，
 *    结果是「历史销量」拿到第 3 个颜色、图例却画的是第 1 个 —— EP-3 实测踩到。
 *    显式指定颜色后，图例与线条一一对应。
 */
function buildOption(): EChartsOption {
  const colorHistory = readTokenVar('--c1');
  const colorForecast = readTokenVar('--c2');

  return {
    animation: false,
    grid: { left: 46, right: 14, top: 18, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: X_AXIS,
      boundaryGap: false,
      axisLabel: { fontSize: 10, interval: 3 },
    },
    yAxis: {
      type: 'value',
      splitNumber: 5,
      axisLabel: { fontSize: 10 },
    },
    series: [
      {
        // 置信区间下界（不可见，仅作为堆叠基线）
        name: '置信区间（下界）',
        type: 'line',
        stack: 'ci',
        data: BAND_LOWER,
        symbol: 'none',
        silent: true,
        lineStyle: { width: 0, opacity: 0 },
        areaStyle: { opacity: 0 },
        tooltip: { show: false },
      },
      {
        // 堆叠增量 → 与下界围出置信带
        name: '置信区间',
        type: 'line',
        stack: 'ci',
        data: BAND_SPAN,
        symbol: 'none',
        silent: true,
        color: colorForecast,
        lineStyle: { width: 0, opacity: 0 },
        areaStyle: { opacity: 0.16 },
        tooltip: { show: false },
      },
      {
        name: '历史销量',
        type: 'line',
        data: HISTORY,
        symbol: 'none',
        color: colorHistory,
        lineStyle: { width: 2.4 },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', width: 1, opacity: 0.5 },
          label: { show: false },
          data: [{ xAxis: X_AXIS[ANCHOR] }],
        },
        z: 4,
      },
      {
        name: '预测销量',
        type: 'line',
        data: FORECAST,
        symbol: 'none',
        color: colorForecast,
        lineStyle: { width: 2.4, type: 'dashed' },
        z: 4,
      },
    ],
  };
}

export default function HeroChart() {
  // 🔑 主题变化时重建 option：颜色是「读取 CSS 变量」得到的，
  //    不重建就会把旧主题的色值一直用下去（图例与图表会一起错，反而看不出）。
  const isDark = useThemeStore((s) => s.isDark);
  const option = useMemo(buildOption, [isDark]);

  return (
    <div
      data-testid="hero-chart-frame"
      className="overflow-hidden rounded-[var(--radius-lg)] border"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {/* 浏览器框头（对齐原型 .hv-head） */}
      <div
        className="hv-head flex items-center gap-2 border-b px-3.5 py-2.5 text-[0.75rem]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)' }}
      >
        <span className="hv-dots flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <i
              key={i}
              className="block h-[9px] w-[9px] rounded-full"
              style={{ background: 'var(--border-strong)' }}
            />
          ))}
        </span>
        <span className="ml-1 truncate">预测结果示意 · 仓库 × 商品</span>
        <span
          className="ml-auto flex-none rounded-full px-2 py-[1px] text-[0.6875rem] font-semibold"
          style={{ background: 'var(--success-soft)', color: 'var(--on-success-soft)' }}
        >
          L1 · 高置信
        </span>
      </div>

      <div className="hv-body p-4">
        <EChart
          testId="hero-chart"
          option={option}
          height={240}
          ariaLabel="历史销量与预测销量示意图，含置信区间"
        />

        {/* 自绘图例：色块同样取自 CSS 变量 → 随主题变化 */}
        <div
          className="chart-legend mt-2.5 flex flex-wrap justify-center gap-4 text-[0.6875rem]"
          style={{ color: 'var(--text-2)' }}
        >
          <span className="lg flex items-center gap-1.5">
            <i
              className="lg-line block w-[18px] border-t-2 border-solid"
              style={{ borderColor: 'var(--c1)' }}
            />
            历史销量
          </span>
          <span className="lg flex items-center gap-1.5">
            <i
              className="lg-line lg-dash block w-[18px] border-t-2 border-dashed"
              style={{ borderColor: 'var(--c2)' }}
            />
            预测销量
          </span>
          <span className="lg flex items-center gap-1.5">
            <i
              className="lg-box block h-[10px] w-[10px] rounded-[2px]"
              style={{ background: 'var(--c2)', opacity: 0.3 }}
            />
            置信区间
          </span>
        </div>
      </div>
    </div>
  );
}
