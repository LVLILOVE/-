/**
 * 主题切换（WS-3-05）
 * -----------------------------------------------------------------------------
 * 深浅主题切换，选择持久化到 localStorage（`useThemeStore` 负责落盘），
 * 切换后由 store 重注册 ECharts 主题 → 图表重绘（UX-GOV-02a）。
 *
 * 无障碍：`aria-pressed` 表达开关状态、`aria-label` 说明「点击后会发生什么」
 * （而不是仅描述图标），符合 `UX-A11Y` 对图标按钮的要求。
 */
import { useThemeStore } from '../store/useThemeStore';

type Props = {
  /** 紧凑档：用于认证页等空间受限处 */
  compact?: boolean;
};

export default function ThemeToggle({ compact = false }: Props) {
  const isDark = useThemeStore((s) => s.isDark);
  const toggle = useThemeStore((s) => s.toggle);

  const label = isDark ? '切换到浅色主题' : '切换到深色主题';

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      className={`theme-toggle inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border ${
        compact ? 'px-2 py-1 text-[0.6875rem]' : 'px-2.5 py-1.5 text-[0.75rem]'
      }`}
      style={{ borderColor: 'var(--border-field)', color: 'var(--text-2)', background: 'var(--surface)' }}
    >
      {isDark ? (
        /* 当前为深色 → 图标示意「切到浅色」（太阳） */
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
          <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2" />
            <path d="M5.3 5.3 6.9 6.9M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
          </g>
        </svg>
      ) : (
        /* 当前为浅色 → 图标示意「切到深色」（月亮） */
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {!compact && <span>{isDark ? '浅色' : '深色'}</span>}
    </button>
  );
}
