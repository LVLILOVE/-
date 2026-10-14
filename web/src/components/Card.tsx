/**
 * 卡片外壳（表头 + 正文）
 * -----------------------------------------------------------------------------
 * `EP-4` 时它是 `UploadPage.tsx` 内的局部组件；`EP-5` 新增参数页与执行页，
 * 三页共用同一套卡片骨架，故提取到此处。
 *
 * 为什么不各页各写一份：卡片是**视觉基线**（圆角 / 描边 / 表头分隔线 / 内边距），
 * 复制三份之后任何一次调整都只会改到其中一两处，页面间会慢慢长得不一样 ——
 * 而这类"慢慢不一样"在评审时很难被指出，却真实损害一致性。
 */
import type { ReactNode } from 'react';

type Props = {
  title?: string;
  titleColor?: string;
  /** 表头右侧的徽标（状态标签等） */
  badge?: ReactNode;
  /** 表头右侧的操作区（按钮 / 链接），排在 badge 之后 */
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
};

export default function Card({ title, titleColor, badge, actions, children, testId }: Props) {
  return (
    <div
      className="rounded-[var(--radius)] border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      data-testid={testId}
    >
      {(title || actions || badge) && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          {title ? (
            <h3 className="text-[1.0312rem]" style={titleColor ? { color: titleColor } : undefined}>
              {title}
            </h3>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {badge}
            {actions}
          </div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
