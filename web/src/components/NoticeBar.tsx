/**
 * 提示条（WS-3-04）
 * -----------------------------------------------------------------------------
 * 4 个变体：info / success / warning / danger。
 * 无障碍：`danger` 与 `warning` 用 `role="alert"`（打断式，需立即感知），
 * 其余用 `role="status"`（礼貌式）。
 *
 * 与登录 / 注册页既有的 `.alert-danger` 的关系：
 *   那两页在 EP-2 已实现并使用内联样式（且被无头浏览器断言钉住），
 *   为避免回归，本组件不改写它们；新页面统一用本组件。
 */
import type { ReactNode } from 'react';

export type NoticeVariant = 'info' | 'success' | 'warning' | 'danger';

type Props = {
  variant?: NoticeVariant;
  title?: ReactNode;
  children: ReactNode;
  /** 右侧附加内容（例如「去查看」链接） */
  extra?: ReactNode;
  className?: string;
  /** 去掉外边框，用作内嵌说明 */
  plain?: boolean;
  /**
   * 🔒 **透传 `data-*` 等 DOM 属性**。
   *
   * 为什么不逐个加 `dataTestId` 字段：`NoticeBar` 被无头浏览器走查当**断言锚点**用
   * （例如管理端「删除回执」`data-testid="ok-msg"`）。若组件不透传，
   * 调用方写在上面的 `data-testid` 会被**静默丢弃** —— 页面看着正常，
   * 验收脚本却永远断言不到，且不报任何错。这类失败最难查，故从组件层根治。
   */
  [key: `data-${string}`]: unknown;
};

/** 变体 → CSS 变量三元组（背景 / 描边 / 前景） */
const VARIANT_STYLE: Record<NoticeVariant, { bg: string; border: string; fg: string; icon: ReactNode }> = {
  info: {
    bg: 'var(--info-soft)',
    border: 'oklch(0.68 0.13 250 / .32)',
    fg: 'var(--info)',
    icon: <circle cx="12" cy="12" r="8.5" />,
  },
  success: {
    bg: 'var(--success-soft)',
    border: 'oklch(0.51 0.15 155 / .32)',
    fg: 'var(--success)',
    icon: <path d="M5.5 12.5 10 17l8.5-9" />,
  },
  warning: {
    bg: 'var(--warning-soft)',
    border: 'oklch(0.76 0.155 75 / .35)',
    fg: 'var(--warning)',
    icon: <path d="M12 4.5 21 20H3L12 4.5zM12 10v4.5" />,
  },
  danger: {
    bg: 'var(--danger-soft)',
    border: 'oklch(0.555 0.20 25 / .32)',
    fg: 'var(--danger)',
    icon: <path d="M12 4.5 21 20H3L12 4.5zM12 10v4.5" />,
  },
};

export default function NoticeBar({
  variant = 'info',
  title,
  children,
  extra,
  className = '',
  plain = false,
  ...rest
}: Props) {
  const v = VARIANT_STYLE[variant];
  return (
    <div
      className={`notice notice-${variant} flex items-start gap-2.5 rounded-[var(--radius-sm)] px-3.5 py-3 text-[0.75rem] leading-[1.7] ${
        plain ? '' : 'border'
      } ${className}`}
      style={{ background: v.bg, borderColor: v.border, color: 'var(--text-2)' }}
      role={variant === 'danger' || variant === 'warning' ? 'alert' : 'status'}
      {...rest}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className="mt-[2px] flex-none"
      >
        <g stroke={v.fg} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {v.icon}
        </g>
      </svg>
      <div className="min-w-0 flex-1">
        {title ? (
          <div className="font-semibold" style={{ color: 'var(--text)' }}>
            {title}
          </div>
        ) : null}
        <div>{children}</div>
      </div>
      {extra ? <div className="flex-none">{extra}</div> : null}
    </div>
  );
}
