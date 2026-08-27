// ============================================================
// 代码段功能：猫咪列表页（对齐 UIUX §4.2）
// - 顶部标题 +「可领养」筛选开关（胶囊 toggle）
// - 3 列网格（响应式降列）；空状态治愈文案
// ============================================================
import { useEffect, useState } from 'react'
import CatCard from '@/components/CatCard'
import { fetchCats } from '@/api/modules'
import type { Cat } from '@/types'

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

  return (
    <div className="max-w-[1100px] mx-auto px-5 md:px-10 pt-32 pb-16">
      {/* 页标题 + 筛选开关 */}
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
