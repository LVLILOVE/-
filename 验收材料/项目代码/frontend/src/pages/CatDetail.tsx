// ============================================================
// 代码段功能：猫咪详情页（对齐 UIUX §4.3）
// - 上部：大图 + 完整档案（名字/性格/故事/品种/年龄/性别/绝育/技能）
// - 中部：双 CTA（预约来见它 → 预约页；可领养时显示领养入口）
// - 下部：返回列表
// ============================================================
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Button from '@/components/Button'
import { fetchCat } from '@/api/modules'
import type { Cat } from '@/types'

const FALLBACK = 'https://images.unsplash.com/photo-1532951779377-1080f5c62ab7?auto=format&fit=crop&w=900&q=75'

export default function CatDetail() {
  const { id } = useParams<{ id: string }>()   // 路由参数：猫咪 id
  const [cat, setCat] = useState<Cat | null>(null)
  const [missing, setMissing] = useState(false)

  // 拉取猫咪详情；不存在则置 missing 展示兜底
  useEffect(() => {
    fetchCat(Number(id))
      .then((d) => (d ? setCat(d) : setMissing(true)))
      .catch(() => setMissing(true))
  }, [id])

  // 详情不存在（已下线/删除）时的兜底视图
  if (missing) {
    return (
      <div className="max-w-[700px] mx-auto px-5 pt-36 pb-20 text-center">
        <p className="text-lg">这只猫暂时不在猫屿。</p>
        <p className="text-ink-faint text-sm mt-2">它可能出去晒太阳了，看看其他猫咪吧。</p>
        <div className="mt-6"><Link to="/cats"><Button variant="ghost">返回猫咪列表</Button></Link></div>
      </div>
    )
  }
  if (!cat) return <p className="text-center pt-36 text-ink-faint">加载中…</p>

  // 档案字段：label → 值（无值则不显示）
  const fields = [
    ['品种', cat.breed],
    ['年龄', cat.age],
    ['性别', cat.gender],
    ['绝育', cat.neutered ? '已绝育' : '未绝育'],
    ['技能', cat.skills],
  ].filter(([, v]) => v) as [string, string][]

  return (
    <div className="max-w-[900px] mx-auto px-5 md:px-10 pt-32 pb-16">
      {/* 大图 + 基本信息 */}
      <div className="grid md:grid-cols-2 gap-8 items-start">
        <img
          src={cat.avatar_url || FALLBACK}
          alt={cat.name}
          className="w-full rounded-2xl object-cover h-[380px]"
        />
        <div>
          <h1 className="text-[26px] font-semibold tracking-wider">{cat.name}</h1>
          {cat.persona && (
            <span className="inline-block bg-bg-soft border border-line text-main-deep text-xs px-3 py-1 rounded-full my-3">
              {cat.persona}
            </span>
          )}
          <p className="text-[15px] text-ink-soft leading-loose">{cat.story}</p>
          {/* 档案字段列表 */}
          <dl className="mt-5 space-y-2.5 text-[14px]">
            {fields.map(([k, v]) => (
              <div key={k} className="flex">
                <dt className="w-14 text-ink-faint flex-none">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {/* 双 CTA：预约（预填意向） + 领养入口（仅可领养） */}
          <div className="flex gap-3 mt-7 flex-wrap">
            <Link to={`/reserve?cat=${cat.id}&name=${encodeURIComponent(cat.name)}`}>
              <Button>预约来见它</Button>
            </Link>
            {cat.adoptable === 1 && (
              <Link to={`/adopt?cat=${cat.id}&name=${encodeURIComponent(cat.name)}`}>
                <Button variant="ghost">领养入口</Button>
              </Link>
            )}
          </div>
        </div>
      </div>
      {/* 返回列表 */}
      <p className="mt-10"><Link to="/cats" className="text-sm text-ink-faint hover:text-main-deep">← 返回猫咪列表</Link></p>
    </div>
  )
}
