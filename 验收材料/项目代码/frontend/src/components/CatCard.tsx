// ============================================================
// 代码段功能：猫咪卡片组件（对齐 UIUX §3.3 卡片规范）
// - 白底圆角卡片：照片(4:3) + 名字 + 性格标签 + 一句话故事
// - hover 上浮（translateY -4px + 阴影），整卡可点击跳详情
// ============================================================
import { Link } from 'react-router-dom'
import type { Cat } from '@/types'

// 占位图：无照片时显示的治愈系底色卡片
const FALLBACK = 'https://images.unsplash.com/photo-1532951779377-1080f5c62ab7?auto=format&fit=crop&w=500&q=70'

export default function CatCard({ cat }: { cat: Cat }) {
  return (
    <Link
      to={`/cats/${cat.id}`}
      className="block bg-card border border-line rounded-2xl overflow-hidden hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(107,79,63,0.10)] transition-all duration-250"
    >
      {/* 猫咪照片：4:3 裁切；缺失时用占位图 */}
      <img
        src={cat.avatar_url || FALLBACK}
        alt={cat.name}
        className="w-full h-[210px] object-cover"
        loading="lazy"
      />
      <div className="p-4 pb-5">
        <p className="text-[17px] font-semibold">{cat.name}</p>
        {/* 性格标签：浅驼底胶囊 */}
        {cat.persona && (
          <span className="inline-block bg-bg-soft border border-line text-main-deep text-xs px-3 py-0.5 rounded-full my-2">
            {cat.persona}
          </span>
        )}
        {/* 一句话故事（30 字内） */}
        <p className="text-[13px] text-ink-soft">{cat.story}</p>
      </div>
    </Link>
  )
}
