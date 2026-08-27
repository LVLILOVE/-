// ============================================================
// 代码段功能：首页（单页长滚动，对齐 PRD §3.1/§4.1 与首页原型）
// - 9 区块：Hero → 品牌故事 → 猫咪预览(前6) → 餐单预览 → 安全须知 → 门店信息 → 预约入口
// - 猫咪/餐单/门店数据来自后端 API（无数据时显示占位/空态）
// ============================================================
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CatCard from '@/components/CatCard'
import Button from '@/components/Button'
import { fetchCats, fetchMenu, fetchStore } from '@/api/modules'
import type { Cat, MenuItem, StoreInfo } from '@/types'

// 品牌故事文案（PRD §4.1：文案在代码中维护）
const STORY_LINES = [
  { head: '想抚摸一只猫的时候', text: '猫屿在这里。' },
  { head: '心情沉闷需要安静的时候', text: '猫屿在这里。' },
  { head: '想和重要的人拉近距离的时候', text: '猫屿在这里。' },
]

export default function Home() {
  const [cats, setCats] = useState<Cat[]>([])        // 猫咪预览数据（前 6 只）
  const [menu, setMenu] = useState<MenuItem[]>([])   // 餐单预览数据
  const [store, setStore] = useState<StoreInfo>({})  // 门店配置

  // 页面加载时并行拉取三份数据；失败静默（页面仍有占位内容）
  useEffect(() => {
    fetchCats().then((d) => setCats(d.slice(0, 6))).catch(() => {})
    fetchMenu().then((d) => setMenu(d.slice(0, 4))).catch(() => {})
    fetchStore().then(setStore).catch(() => {})
  }, [])

  return (
    <div>
      {/* ===== 区块 1：Hero（全宽猫咪图 + Slogan + 双 CTA）===== */}
      <section className="relative min-h-[92vh] flex items-center justify-center text-center overflow-hidden">
        {/* 背景图：全宽猫咪实拍 */}
        <img
          src="https://images.unsplash.com/photo-1532951779377-1080f5c62ab7?auto=format&fit=crop&w=1600&q=75"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* 渐变遮罩：顶部浅 → 底部融入页面背景色 */}
        <div className="absolute inset-0 bg-gradient-to-b from-bg/35 via-bg/55 to-bg" aria-hidden="true" />
        {/* Hero 文案与 CTA（位于遮罩之上） */}
        <div className="relative z-10 px-6 max-w-2xl">
          <h1 className="text-[clamp(28px,5vw,52px)] font-semibold tracking-[0.15em] leading-[1.5]">
            在猫的节奏里<br />慢下来
          </h1>
          <p className="mt-4 text-base tracking-[0.1em] text-ink-soft">城市里，有一个被猫治愈的角落</p>
          <div className="mt-9 flex gap-4 justify-center flex-wrap">
            <Link to="/reserve"><Button>立即预约</Button></Link>
            <Link to="/cats"><Button variant="ghost">认识猫咪</Button></Link>
          </div>
        </div>
      </section>

      {/* ===== 区块 2：品牌故事（短句分段 + 图）===== */}
      <section className="max-w-[1100px] mx-auto px-5 md:px-10 py-20" id="story">
        <h2 className="text-center text-[26px] tracking-[0.2em] font-semibold">猫屿的故事</h2>
        <p className="text-center text-xs tracking-[0.3em] text-ink-faint mt-2 mb-9 font-en">OUR STORY</p>
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <img
            src="https://images.unsplash.com/photo-1622046016568-ff3842481d42?auto=format&fit=crop&w=800&q=70"
            alt="女孩怀抱白棕色小猫的温馨照片"
            className="w-full rounded-2xl object-cover h-[400px]"
            loading="lazy"
          />
          <div className="space-y-4">
            {STORY_LINES.map((line) => (
              <p key={line.head} className="text-base text-ink-soft tracking-wide">
                {line.head}，<b className="text-ink">{line.text}</b>
              </p>
            ))}
            <p className="text-base text-ink-soft tracking-wide">
              这里的每一只猫，都有自己的名字和脾气。<br />
              你可以只是坐着，看它们晒太阳。<br />
              <b className="text-ink">第一次来也没关系，猫会先认识你。</b>
            </p>
          </div>
        </div>
      </section>

      {/* ===== 区块 3：猫咪预览（前 6 只上线猫）===== */}
      <section className="max-w-[1100px] mx-auto px-5 md:px-10 py-16" id="cats">
        <h2 className="text-center text-[26px] tracking-[0.2em] font-semibold">住在这里的猫</h2>
        <p className="text-center text-xs tracking-[0.3em] text-ink-faint mt-2 mb-9 font-en">OUR CATS</p>
        {cats.length > 0 ? (
          <>
            {/* 3 列网格（响应式降列） */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {cats.map((cat) => <CatCard key={cat.id} cat={cat} />)}
            </div>
            <p className="text-center mt-8">
              <Link to="/cats"><Button variant="ghost">查看全部猫咪</Button></Link>
            </p>
          </>
        ) : (
          // 空状态：数据未就绪的治愈文案
          <p className="text-center text-ink-faint">猫们正在午睡，稍后再来看看吧。</p>
        )}
      </section>

      {/* ===== 区块 4：餐单预览 ===== */}
      <section className="max-w-[1100px] mx-auto px-5 md:px-10 py-16" id="menu">
        <h2 className="text-center text-[26px] tracking-[0.2em] font-semibold">一杯咖啡的时间</h2>
        <p className="text-center text-xs tracking-[0.3em] text-ink-faint mt-2 mb-9 font-en">MENU</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {menu.map((m) => (
            <div key={m.id} className="bg-card border border-line rounded-xl p-5 text-center">
              {/* 圆形图占位（上线替换真实菜品图） */}
              <div className="w-16 h-16 rounded-full bg-bg-soft border border-line mx-auto mb-2.5 flex items-center justify-center text-2xl" aria-hidden="true">
                {m.category === 'coffee' ? '☕' : m.category === 'cat_snack' ? '🐟' : '🍰'}
              </div>
              <h4 className="text-sm font-medium">{m.name}</h4>
              <p className="text-[11px] text-ink-faint mt-0.5">
                {m.category === 'coffee' ? '咖啡' : m.category === 'tea' ? '茶饮' : m.category === 'dessert' ? '甜品' : '猫零食'}
              </p>
              <p className="text-[13px] font-semibold text-btn mt-1">¥ {m.price.toFixed(2)}</p>
            </div>
          ))}
        </div>
        <p className="text-center mt-8">
          <Link to="/menu"><Button variant="ghost">查看完整菜单</Button></Link>
        </p>
      </section>

      {/* ===== 区块 5：安全须知（降低首次到访门槛）===== */}
      <section className="max-w-[1100px] mx-auto px-5 md:px-10 py-16" id="safety">
        <h2 className="text-center text-[26px] tracking-[0.2em] font-semibold">让你和猫都安心</h2>
        <p className="text-center text-xs tracking-[0.3em] text-ink-faint mt-2 mb-9 font-en">SAFETY</p>
        <div className="grid md:grid-cols-3 gap-5">
          <div className="bg-card border border-line rounded-xl p-6">
            <h4 className="text-[15px] font-medium mb-2">进店消毒</h4>
            <p className="text-[13px] text-ink-soft">入店前手部消毒，提供一次性鞋套，猫咪疫苗接种记录店内公示。</p>
          </div>
          <div className="bg-card border border-line rounded-xl p-6">
            <h4 className="text-[15px] font-medium mb-2">互动规则</h4>
            <p className="text-[13px] text-ink-soft">请用逗猫棒引导互动，不抱猫、不打扰睡觉的猫，儿童需家长全程陪同。</p>
          </div>
          <div className="bg-card border border-line rounded-xl p-6">
            <h4 className="text-[15px] font-medium mb-2">首次到访</h4>
            <p className="text-[13px] text-ink-soft">第一次来也不用紧张——安静坐下，等猫主动靠近就好。</p>
          </div>
        </div>
      </section>

      {/* ===== 区块 6：门店与预约入口 ===== */}
      <section className="max-w-[1100px] mx-auto px-5 md:px-10 py-16" id="store">
        <h2 className="text-center text-[26px] tracking-[0.2em] font-semibold">来找我们吧</h2>
        <p className="text-center text-xs tracking-[0.3em] text-ink-faint mt-2 mb-9 font-en">VISIT US</p>
        <div className="bg-card border border-line rounded-2xl p-8 md:p-9 grid md:grid-cols-2 gap-8">
          {/* 门店信息（后台可配） */}
          <div className="text-[14.5px] text-ink-soft space-y-2.5">
            <p><b className="text-ink">{store.store_name || '猫屿 CAT ISLE'}</b></p>
            <p>📍 {store.address || 'XX 市 XX 区 XX 路 XX 号（后台可配）'}</p>
            <p>📞 {store.phone || '138-0000-0000（后台可配）'}</p>
            <p>🕐 {store.hours || '营业时间：11:00-19:00 · 周一店休（后台可配）'}</p>
            <p className="text-[13px] text-ink-faint">预约需支付押金 ¥20（线下收款码转账，店主核验）· 每时段限 6 组</p>
            <div className="pt-3">
              <Link to="/reserve"><Button>立即预约</Button></Link>
            </div>
          </div>
          {/* 地图占位（高德/腾讯 iframe，后台配置 map_embed） */}
          <div className="bg-bg-soft border border-dashed border-line rounded-xl h-[240px] flex items-center justify-center text-[13px] text-ink-faint">
            地图占位（后台配置高德/腾讯地图 iframe）
          </div>
        </div>
      </section>
    </div>
  )
}
