/**
 * 主题状态（useThemeStore）
 * -----------------------------------------------------------------------------
 * 深色优先（UI/UX §3.1 UX-COL-02）：默认 html.dark，与开发 IDE 主题一致。
 * 职责只有两件：① 切 `html.dark` class；② 落盘 localStorage。
 *
 * 🔑 图表重绘怎么发生（UX-GOV-02a）：
 *    本 store **不认识** ECharts，也不 import 它 —— 只把 `isDark` 变成
 *    可订阅的状态。图表组件（`components/EChart.tsx`）订阅 `isDark`，
 *    变化时 `dispose()` → 重新 `init()` → `setOption()`，颜色自然随令牌更新。
 *    这样做的两个好处：
 *      ① echarts 不被 store 静态拉进主包，可随图表懒加载（首屏包体更小）；
 *      ② 注册主题这一步发生在图表真正 init 之前，不存在
 *         「store 初始化早于 CSS 注入 → 色板取空」的时序问题。
 */
import { create } from 'zustand';

const STORAGE_KEY = 'sp_theme';

type ThemeState = {
  isDark: boolean;
  toggle: () => void;
  setDark: (v: boolean) => void;
};

function applyTheme(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark);
}

function readInitial(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === 'dark';
}

const initialIsDark = readInitial();

export const useThemeStore = create<ThemeState>((set) => ({
  isDark: initialIsDark,
  toggle: () =>
    set((s) => {
      const next = !s.isDark;
      applyTheme(next);
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
      return { isDark: next };
    }),
  setDark: (v) =>
    set(() => {
      applyTheme(v);
      localStorage.setItem(STORAGE_KEY, v ? 'dark' : 'light');
      return { isDark: v };
    }),
}));

// 首次加载即应用默认主题（幂等）
applyTheme(initialIsDark);
