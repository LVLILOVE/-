// ============================================================
// 代码段功能：餐单页（对齐 UIUX §4.4）
// - 分类 Tab（咖啡/茶饮/甜品/猫零食），激活态主色底胶囊
// - 菜品卡片网格；猫零食标注「给猫咪的小零食」
// ============================================================
import { useEffect, useState } from 'react'
import { fetchMenu } from '@/api/modules'
import type { MenuItem } from '@/types'

// 分类定义：key → 中文名
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'coffee', label: '咖啡' },
  { key: 'tea', label: '茶饮' },
  { key: 'dessert', label: '甜品' },
  { key: 'cat_snack', label: '猫零食' },
]

// 分类图标（占位，正式可用 Lucide SVG）
const ICONS: Record<string, string> = { coffee: '☕', tea: '🥛', dessert: '🍰', cat_snack: '🐟' }

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([])
  const [active, setActive] = useState('all')   // 当前分类 Tab

  // 拉取餐单（仅上架菜品，后端已过滤）
  useEffect(() => {
    fetchMenu().then(setItems).catch(() => setItems([]))
  }, [])

  // 按当前分类过滤
  const shown = active === 'all' ? items : items.filter((m) => m.category === active)

  return (
    <div className="max-w-[1100px] mx-auto px-5 md:px-10 pt-32 pb-16">
      {/* 页标题 */}
      <h1 className="text-[26px] tracking-[0.2em] font-semibold text-center">一杯咖啡的时间</h1>
      <p className="text-center text-xs tracking-[0.3em] text-ink-faint mt-2 mb-8 font-en">MENU</p>

      {/* 分类 Tab：横向滚动（移动端不换行） */}
      <div className="flex gap-2.5 justify-center flex-wrap mb-9">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setActive(c.key)}
            className={`px-5 py-2 rounded-full text-sm border transition-colors ${
              active === c.key ? 'bg-main border-main text-white' : 'bg-card border-line text-ink-soft hover:border-main'
            }`}
            aria-pressed={active === c.key}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* 菜品网格 */}
      {shown.length === 0 ? (
        <p className="text-center text-ink-faint py-12">该分类暂时没有在售菜品。</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {shown.map((m) => (
            <div key={m.id} className="relative bg-card border border-line rounded-xl p-5 text-center">
              {/* 猫零食标记：右上角粉色小标签（UIUX §4.4） */}
              {m.category === 'cat_snack' && (
                <span className="absolute top-3 right-3 bg-pink/10 text-pink text-[10px] px-2 py-0.5 rounded-full">
                  给猫咪的小零食
                </span>
              )}
              <div className="w-16 h-16 rounded-full bg-bg-soft border border-line mx-auto mb-2.5 flex items-center justify-center text-2xl" aria-hidden="true">
                {ICONS[m.category] || '🍽'}
              </div>
              <h4 className="text-sm font-medium">{m.name}</h4>
              {m.desc && <p className="text-[11px] text-ink-faint mt-0.5 line-clamp-2">{m.desc}</p>}
              <p className="text-[13px] font-semibold text-btn mt-1.5">¥ {m.price.toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
