// ============================================================
// 代码段功能：猫咪列表页（对齐 UIUX §4.2 + 新增「今日店长」）
// - 顶部「今日店长」展示位：每天按日期轮换一位当值店长（照片+名字+性格+故事），
//   放置在最显眼位置（列表最上方），点击进入详情
// - 下方：标题 +「可领养」筛选开关 + 3 列网格（响应式降列）
// ============================================================
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CatCard from '@/components/CatCard'
import { fetchCats } from '@/api/modules'
import type { Cat } from '@/types'

// 占位图（无照片时的治愈系兜底）
const FALLBACK = 'https://images.unsplash.com/photo-1532951779377-1080f5c62ab7?auto=format&fit=crop&w=600&q=70'

// 按当天日期轮换选择「今日店长」：每年从第 1 天起递增索引，取模猫咪数量
const pickDailyManager = (cats: Cat[]): Cat | null => {
  if (cats.length === 0) return null
  const now = new Date()
  // 计算今天是一年中的第几天（1 月 1 日为第 1 天）
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000)
  return cats[dayOfYear % cats.length]
}

export default function CatList() {
  const [cats, setCats] = useState<Cat[]>([])    // 全量猫咪
  const [onlyAdoptable, setOnlyAdoptable] = useState(false)  // 可领养筛选
  const [loading, setLoading] = useState(true)

  // 加载猫咪列表；筛选变化时重新拉取（adoptable=1 走后端过滤）
  useEffect(() => {
    setLoading(true)
    fetchCats(onlyAdoptable ? 1 : 0)
      .then(setCats)
      .catch(() => setCats([]))
      .finally(() => setLoading(false))
  }, [onlyAdoptable])

  // 今日店长：仅在「全部猫咪」视图展示（筛选可领养时隐藏，聚焦候选）
  const manager = onlyAdoptable ? null : pickDailyManager(cats)

  return (
    <div className="max-w-[1100px] mx-auto px-5 md:px-10 pt-32 pb-16">
      {/* ===== 今日店长（最显眼位置：页面顶部大卡片）===== */}
      {!loading && manager && (
        <section className="mb-10">
          {/* 区块标题：每日店长 */}
          <div className="flex items-center gap-2.5 mb-4">
            <h2 className="text-lg tracking-[0.15em] font-semibold">今日店长</h2>
            <span className="text-[11px] text-ink-faint">每天一位当值店长 · 今天轮到谁？</span>
          </div>
          {/* 店长卡片：左图右文，白底圆角大卡（点击进入详情） */}
          <Link
            to={`/cats/${manager.id}`}
            className="block bg-card border-2 border-main/40 rounded-2xl overflow-hidden hover:border-main transition-colors shadow-[0_8px_28px_rgba(169,122,80,0.12)]"
          >
            <div className="grid md:grid-cols-[280px_1fr] items-stretch">
              {/* 店长照片：方形裁切，移动端上方 / 桌面端左侧 */}
              <img
                src={manager.avatar_url || FALLBACK}
                alt={`今日店长 ${manager.name}`}
                className="w-full h-56 md:h-full object-cover"
                loading="lazy"
              />
              {/* 店长信息 */}
              <div className="p-6 md:p-8 flex flex-col justify-center">
                {/* 店长徽章 + 名字 */}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="inline-block bg-main text-white text-[11px] px-3 py-1 rounded-full tracking-wider">今日店长</span>
                  <span className="text-[26px] font-semibold tracking-wider">{manager.name}</span>
                </div>
                {/* 性格标签 */}
                {manager.persona && (
                  <span className="inline-block w-fit bg-bg-soft border border-line text-main-deep text-xs px-3 py-0.5 rounded-full mt-3">
                    {manager.persona}
                  </span>
                )}
                {/* 一句话故事 */}
                <p className="text-[14.5px] text-ink-soft leading-loose mt-3">{manager.story}</p>
                {/* 引导链接 */}
                <span className="text-[13px] text-main-deep mt-4 inline-flex items-center gap-1">
                  去看看 TA 的档案 <span aria-hidden="true">→</span>
                </span>
              </div>
            </div>
          </Link>
        </section>
      )}

      {/* ===== 页标题 + 筛选开关 ===== */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
        <div>
          <h1 className="text-[26px] tracking-[0.2em] font-semibold">住在这里的猫</h1>
          <p className="text-xs tracking-[0.3em] text-ink-faint mt-1 font-en">OUR CATS</p>
        </div>
        {/* 可领养筛选胶囊：激活态主色底白字 */}
        <button
          onClick={() => setOnlyAdoptable((v) => !v)}
          className={`px-5 py-2 rounded-full text-sm border transition-colors ${
            onlyAdoptable
              ? 'bg-main border-main text-white'
              : 'bg-card border-line text-ink-soft hover:border-main'
          }`}
          aria-pressed={onlyAdoptable}
        >
          仅看可领养
        </button>
      </div>

      {/* 加载中 / 空状态 / 列表 */}
      {loading ? (
        <p className="text-center text-ink-faint py-16">猫们正在路上…</p>
      ) : cats.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-ink text-[15px]">猫们出去晒太阳了，稍后再来。</p>
          <p className="text-ink-faint text-[13px] mt-2">（当前没有符合条件的猫咪）</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cats.map((cat) => <CatCard key={cat.id} cat={cat} />)}
        </div>
      )}
    </div>
  )
}
