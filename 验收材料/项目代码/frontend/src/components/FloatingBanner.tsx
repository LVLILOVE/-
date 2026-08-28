// ============================================================
// 代码段功能：右侧悬浮横幅组件（对齐 UIUX §3.5）
// - 3 个迷你横幅：新猫报道→/cats / 领养成功→/adopt / 周边上新→可配外链
// - 桌面端固定右侧垂直居中；移动端隐藏（由底部预约栏替代）
// ============================================================
import { Link } from 'react-router-dom'

// 横幅配置：标题 + 副文案 + 跳转目标
const BANNERS = [
  { title: '新猫报道', sub: '去看看', to: '/cats' },
  { title: '领养成功', sub: '毕业啦', to: '/adopt' },
  { title: '周边上新', sub: '（外链可配）', to: '/menu' },
]

export default function FloatingBanner() {
  return (
    <div className="hidden lg:flex fixed right-4 top-1/2 -translate-y-1/2 z-40 flex-col gap-2.5">
      {BANNERS.map((b) => (
        <Link
          key={b.title}
          to={b.to}
          className="bg-card border border-line rounded-xl px-3.5 py-2.5 text-center min-w-[88px] shadow-[0_4px_16px_rgba(107,79,63,0.10)] hover:border-accent transition-colors"
        >
          <span className="block text-xs font-semibold">{b.title}</span>
          <span className="block text-[11px] text-ink-faint mt-0.5">{b.sub}</span>
        </Link>
      ))}
    </div>
  )
}
