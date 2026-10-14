/**
 * Ant Design 主题桥接（WS-0-03）
 * -----------------------------------------------------------------------------
 * 把 tokens.css 中的设计令牌（品牌色 / 语义色 / 圆角 / 字号）映射到
 * ConfigProvider，深色使用 theme.darkAlgorithm。
 *
 * 说明：颜色值从 CSS 变量实时读取（getComputedStyle），因此主题切换后
 * 重新调用 buildAntdTheme() 即可得到新色值；圆角 rem 值换算为 px 供 AntD 使用。
 */
import { theme as antdTheme, type ThemeConfig } from 'antd';

/** 读取 CSS 变量计算值（在对应主题 class 生效后调用） */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** rem → px（根字号 16px） */
function remToPx(name: string, fallback: number): number {
  const v = parseFloat(cssVar(name));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 16) : fallback;
}

export function buildAntdTheme(isDark: boolean): ThemeConfig {
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: cssVar('--primary'),
      colorSuccess: cssVar('--success'),
      colorWarning: cssVar('--warning'),
      colorError: cssVar('--danger'),
      colorInfo: cssVar('--info'),
      colorTextBase: cssVar('--text'),
      colorBgBase: cssVar('--bg'),
      colorBorder: cssVar('--border'),
      borderRadius: remToPx('--radius', 10),
      fontFamily: cssVar('--font-sans'),
    },
    components: {
      Layout: {
        headerBg: cssVar('--surface'),
        siderBg: cssVar('--surface'),
        bodyBg: cssVar('--bg'),
      },
    },
  };
}
