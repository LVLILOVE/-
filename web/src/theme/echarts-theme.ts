/**
 * ECharts 主题桥接（WS-0-04 / UX-GOV-02a）
 * -----------------------------------------------------------------------------
 * 颜色**全部**从 CSS 变量读取（顺序色板 c1~c5 + 中性色），
 * 因此主题一切换，重建出来的主题对象自然带新色值。
 *
 * 🔒 本文件**刻意不 import 'echarts'**（只产出主题配置对象）。
 *    原因：`useThemeStore` 曾在此调用注册函数，导致 echarts（压缩后 ~460 KB）
 *    被静态拉进主包、无法随首屏图表一起懒加载。
 *    现在「注册」这一步由**唯一使用者** `components/EChart.tsx` 负责，
 *    既让 echarts 落进图表所在的分包，也顺带消除了
 *    「store 初始化时 CSS 还没注入 → 色板取到空值」的时序坑。
 * =============================================================================
 */

/** 注册到 ECharts 的主题名，图表组件以它引用主题 */
export const ECHARTS_THEME = 'sp-theme';

/** 读取设计令牌当前值（CSS 变量）。 */
export function readTokenVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 顺序色板（图表第 1~5 系列颜色，来自 --c1..--c5） */
export function palette(): string[] {
  return ['--c1', '--c2', '--c3', '--c4', '--c5'].map(readTokenVar);
}

/**
 * 构造 ECharts 主题配置对象（**纯函数**，不依赖 echarts 模块）。
 * 由 `EChart` 在 `echarts.registerTheme()` 时消费。
 */
export function buildEchartsTheme() {
  return {
    color: palette(),
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: readTokenVar('--font-sans'),
      color: readTokenVar('--text'),
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: readTokenVar('--border') } },
      axisLabel: { color: readTokenVar('--text-2') },
      axisTick: { lineStyle: { color: readTokenVar('--border') } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: readTokenVar('--border') } },
      axisLabel: { color: readTokenVar('--text-2') },
      splitLine: { lineStyle: { color: readTokenVar('--border') } },
    },
    tooltip: {
      backgroundColor: readTokenVar('--surface'),
      borderColor: readTokenVar('--border'),
      textStyle: { color: readTokenVar('--text') },
    },
  };
}
