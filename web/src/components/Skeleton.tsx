/**
 * 骨架屏（WS-3-04）
 * -----------------------------------------------------------------------------
 * 用途：异步首屏（结果页 113 条序列曲线、历史列表）加载期间的占位，
 * 避免「内容跳入」造成的布局抖动（`NFR-USE-03`）。
 *
 * 实现要点：统一用 `.sk` 基类（见 styles/index.css），动效为背景渐变平移，
 * 颜色全部走 CSS 变量 —— 因此深浅主题下都自然可读，且**不引入 hex 色值**。
 */
import type { CSSProperties } from 'react';

type BaseProps = {
  className?: string;
  style?: CSSProperties;
};

/** 单个骨架块（矩形） */
export function Skeleton({ className = '', style }: BaseProps) {
  return <div className={`sk rounded-[var(--radius-sm)] ${className}`} aria-hidden style={style} />;
}

/** 多行文本骨架：最后一行按 60% 宽收尾，视觉上更像真实段落 */
export function SkeletonText({ lines = 3, className = '' }: BaseProps & { lines?: number }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} data-testid="skeleton-text">
      {Array.from({ length: Math.max(1, lines) }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-[10px]"
          style={{ width: i === lines - 1 && lines > 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

/** 卡片骨架：图标 + 标题 + 3 行文本 */
export function SkeletonCard({ className = '' }: BaseProps) {
  return (
    <div
      className={`rounded-[var(--radius)] border p-4 ${className}`}
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      data-testid="skeleton-card"
    >
      <Skeleton className="mb-3 h-8 w-8" />
      <Skeleton className="mb-2.5 h-[12px] w-[45%]" />
      <SkeletonText lines={3} />
    </div>
  );
}

/** 表格骨架：表头 + N 行 M 列 */
export function SkeletonTable({
  rows = 5,
  cols = 4,
  className = '',
}: BaseProps & { rows?: number; cols?: number }) {
  return (
    <div
      className={`overflow-hidden rounded-[var(--radius)] border ${className}`}
      style={{ borderColor: 'var(--border)' }}
      data-testid="skeleton-table"
    >
      <div
        className="grid gap-3 border-b px-4 py-3"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`,
          background: 'var(--surface-2)',
          borderColor: 'var(--border)',
        }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-[10px]" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-3 border-b px-4 py-3 last:border-b-0"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`,
            borderColor: 'var(--border)',
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-[10px]" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 图表骨架：与真实图表同高，避免图表加载完成后页面「下跳」。
 * `height` 必须与目标图表一致，否则起不到防抖动的效果。
 */
export function SkeletonChart({ height = 260, className = '' }: BaseProps & { height?: number }) {
  return (
    <div
      className={`relative overflow-hidden rounded-[var(--radius-sm)] border ${className}`}
      style={{ height, borderColor: 'var(--border)', background: 'var(--surface)' }}
      data-testid="skeleton-chart"
    >
      {/* 假坐标轴 */}
      <div className="absolute inset-x-4 bottom-6 h-px" style={{ background: 'var(--border)' }} />
      <div className="absolute bottom-6 left-4 top-4 w-px" style={{ background: 'var(--border)' }} />
      <div className="absolute inset-x-8 bottom-10 top-6 flex items-end gap-3">
        {[38, 55, 44, 68, 60, 78, 70, 86].map((h, i) => (
          <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}
