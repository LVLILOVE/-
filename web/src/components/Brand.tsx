/**
 * 品牌标识（复用组件）
 * 对齐原型 app.css 的 .brand / .brand-mark 视觉：渐变方块 + 产品名。
 */
export default function Brand() {
  return (
    <a
      href="/"
      className="flex items-center gap-2.5 font-bold text-[0.9375rem] tracking-tight no-underline"
      style={{ color: 'var(--text)' }}
    >
      <span
        className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px]"
        style={{ background: 'linear-gradient(135deg, var(--primary), oklch(0.66 0.16 265))' }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2 9 L5 5 L8 8 L12 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>电商销量预测</span>
    </a>
  );
}
