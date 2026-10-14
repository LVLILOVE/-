/**
 * 空状态（WS-3-04）
 * -----------------------------------------------------------------------------
 * 用于「首次使用无记录」「筛选后无结果」「任务失败无可展示数据」等场景。
 * 约定：空状态必须**说清原因 + 给一条出路**，不能只说「暂无数据」。
 */
import type { ReactNode } from 'react';

type Props = {
  title: string;
  description?: ReactNode;
  /** 可选的下一步动作（按钮 / 链接） */
  action?: ReactNode;
  /** 自定义图标；不给则用默认的空盒子图形 */
  icon?: ReactNode;
  /** 竖向内边距档位 */
  size?: 'sm' | 'md' | 'lg';
};

const PADDING: Record<NonNullable<Props['size']>, string> = {
  sm: 'px-4 py-6',
  md: 'px-5 py-10',
  lg: 'px-6 py-16',
};

export default function EmptyState({ title, description, action, icon, size = 'md' }: Props) {
  return (
    <div
      data-testid="empty-state"
      className={`flex flex-col items-center justify-center rounded-[var(--radius)] border border-dashed text-center ${PADDING[size]}`}
      style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)' }}
    >
      <div
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-full"
        style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
        aria-hidden
      >
        {icon ?? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )}
      </div>

      <h3 className="text-[0.9375rem]">{title}</h3>
      {description ? (
        <p
          className="mt-1.5 max-w-[46ch] text-[0.8125rem] leading-[1.75]"
          style={{ color: 'var(--text-2)' }}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
