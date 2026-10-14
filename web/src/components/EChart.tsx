/**
 * ECharts 封装（WS-3-05 / UX-GOV-02a）
 * -----------------------------------------------------------------------------
 * 🔒 图表色随主题切换的实现要点（也是本组件存在的理由）：
 *    ECharts **不支持运行时换主题**，`setOption` 也不会重取主题色板。
 *    因此主题变化时必须 `dispose()` → 重新 `registerTheme()` → `init()` → `setOption()`。
 *    这里把「主题变化」放进 effect 依赖，保证每次重绘都取到新令牌色值。
 *
 * 为什么注册主题放在这里而不是 `useThemeStore`：
 *    ① 注册必须发生在 `init()` 之前、且 CSS 已注入之后 —— EChart 的 effect
 *       正好满足（`main.tsx` 已把样式 import 提到 App 之前）；
 *    ② echarts 因此只被本组件所属的**懒加载分包**引入，主包不含 echarts。
 *
 * 渲染器固定用 `svg`：既保留矢量清晰度，也让「图表颜色」可被
 * 校验脚本用 DOM 属性（`stroke` / `fill`）读到，便于自动化回归。
 */
import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

import { useThemeStore } from '../store/useThemeStore';
import { ECHARTS_THEME, buildEchartsTheme } from '../theme/echarts-theme';

type Props = {
  option: echarts.EChartsOption;
  /** 容器高度；同时用于骨架屏对齐，避免加载抖动 */
  height?: number | string;
  className?: string;
  ariaLabel?: string;
  /** 校验脚本定位钩子 */
  testId?: string;
};

export default function EChart({
  option,
  height = 260,
  className = '',
  ariaLabel,
  testId = 'echart',
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const isDark = useThemeStore((s) => s.isDark);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    // 每次 init 前按当前令牌重注册主题（主题名复用，注册即覆盖）
    echarts.registerTheme(ECHARTS_THEME, buildEchartsTheme());

    const chart = echarts.init(el, ECHARTS_THEME, { renderer: 'svg' });
    chart.setOption(option);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [option, isDark]);

  return (
    <div
      ref={hostRef}
      data-testid={testId}
      className={className}
      style={{ width: '100%', height }}
      role="img"
      aria-label={ariaLabel}
    />
  );
}
