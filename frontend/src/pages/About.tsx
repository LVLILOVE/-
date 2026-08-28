// ============================================================
// 代码段功能：「关于我们」页面（/about，导航第 6 项）
// - 5 区块：品牌故事 → 门店信息 → 到店指南 → 联系我们 → 快捷入口
// - 门店地址/电话/营业时间从后台「门店设置」实时读取（改后台即生效）
// - 微信二维码为占位块，上线时店主上传真实码图替换
// ============================================================
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '@/components/Button'
import { fetchStore } from '@/api/modules'
import type { StoreInfo } from '@/types'

// 品牌故事文案（与首页一致的品牌定位）
const STORY_PARAS = [
  '我们不追求热闹喧嚣，只想打造一处慢节奏空间。',
  '猫咪才是这里的主人，我们尊重每一只小猫的性格，希望你可以松弛地享受与小猫相伴的时光。',
]

// 预约 4 步流程（与预约页一致的说明）
const RESERVE_STEPS = [
  ['01', '选择日期时段', '官网首页「立即预约」，4 个时段可选（每时段限 6 组）'],
  ['02', '提交预约信息', '填写联系方式，提交后获得预约编号'],
  ['03', '转账押金', '微信转账 ¥20 押金并提交凭证，店主核验'],
  ['04', '按时到店', '核验通过即为确认预约，准时到店享受猫咖时光'],
]

// 进店互动须知
const RULES = [
  '进店请先手部消毒，保护猫咪也保护自己',
  '用逗猫棒等玩具引导互动，不强行抱猫、不打扰睡觉的猫',
  '轻声慢步，不追逐、不惊吓猫咪',
  '拍照请关闭闪光灯',
  '6 岁以下儿童需家长全程陪同',
]

export default function AboutPage() {
  const [store, setStore] = useState<StoreInfo>({})   // 门店配置（后台可改）

  // 加载门店信息；失败静默（页面显示占位）
  useEffect(() => {
    fetchStore().then(setStore).catch(() => {})
  }, [])

  // 门店信息（带默认占位）
  const addr = store.address || 'XX 市 XX 区 XX 路 XX 号'
  const phone = store.phone || '138-0000-0000'
  const hours = store.hours || '11:00-19:00 · 周一店休'

  return (
    <div className="max-w-[1100px] mx-auto px-5 md:px-10 pt-32 pb-16">
      {/* ===== 区块 1：品牌故事 ===== */}
      <section className="text-center mb-20">
        <h1 className="text-[26px] tracking-[0.2em] font-semibold">关于猫屿</h1>
        <p className="text-xs tracking-[0.3em] text-ink-faint mt-2 mb-10 font-en">ABOUT CAT ISLE</p>
        <div className="grid md:grid-cols-2 gap-12 items-center text-left">
          <img
            src="/images/story-cats.webp"
            alt="猫屿的猫咪成员合照"
            className="w-full rounded-2xl object-cover h-[340px]"
            loading="lazy"
          />
          <div className="space-y-4">
            <h2 className="text-xl tracking-[0.15em] font-semibold">猫屿 CAT ISLE</h2>
            <p className="text-sm text-ink-soft leading-loose">
              屿，是海上的一小块陆地，也是疲倦时可以停靠的岸。
              <br />
              猫屿想做的，正是这样一处小小的「岛屿」——在热闹的城市里，给人和猫都留一块可以慢慢呼吸的地方。
            </p>
            {STORY_PARAS.map((para, i) => (
              <p key={i} className="text-[14.5px] text-ink-soft tracking-wide leading-loose">{para}</p>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 区块 2：门店信息 ===== */}
      <section className="mb-20">
        <h2 className="text-center text-[22px] tracking-[0.2em] font-semibold mb-2">门店信息</h2>
        <p className="text-center text-xs tracking-[0.3em] text-ink-faint mb-8 font-en">STORE INFO</p>
        <div className="grid sm:grid-cols-3 gap-4">
          {/* 地址 */}
          <div className="bg-card border border-line rounded-2xl p-6 text-center">
            <div className="w-11 h-11 rounded-full bg-main/10 text-main flex items-center justify-center mx-auto mb-3 text-lg">📍</div>
            <h4 className="text-sm font-medium mb-1.5">门店地址</h4>
            <p className="text-[13px] text-ink-soft leading-relaxed">{addr}</p>
          </div>
          {/* 电话 */}
          <div className="bg-card border border-line rounded-2xl p-6 text-center">
            <div className="w-11 h-11 rounded-full bg-main/10 text-main flex items-center justify-center mx-auto mb-3 text-lg">📞</div>
            <h4 className="text-sm font-medium mb-1.5">联系电话</h4>
            <a href={`tel:${phone}`} className="text-[13px] text-main-deep">{phone}</a>
            <p className="text-[11px] text-ink-faint mt-1.5">预约咨询 / 取消改期均可致电</p>
          </div>
          {/* 营业时间 */}
          <div className="bg-card border border-line rounded-2xl p-6 text-center">
            <div className="w-11 h-11 rounded-full bg-main/10 text-main flex items-center justify-center mx-auto mb-3 text-lg">🕐</div>
            <h4 className="text-sm font-medium mb-1.5">营业时间</h4>
            <p className="text-[13px] text-ink-soft leading-relaxed">{hours}</p>
          </div>
        </div>
        {/* 交通指引 */}
        <div className="bg-bg-soft border border-line rounded-xl px-6 py-4 mt-4 text-[13px] text-ink-soft">
          <b className="text-ink">交通指引：</b>
          建议地铁出行（2 号线「猫屿站」C 口步行约 300 米）；驾车可导航至门店地址，附近有停车场。
          <a
            className="text-main-deep ml-2"
            href={`https://uri.amap.com/search?keyword=${encodeURIComponent(addr)}`}
            target="_blank"
            rel="noreferrer"
          >
            点击打开地图导航 →
          </a>
        </div>
      </section>

      {/* ===== 区块 3：到店指南 ===== */}
      <section className="mb-20">
        <h2 className="text-center text-[22px] tracking-[0.2em] font-semibold mb-2">到店指南</h2>
        <p className="text-center text-xs tracking-[0.3em] text-ink-faint mb-8 font-en">VISIT GUIDE</p>
        <div className="grid md:grid-cols-2 gap-8">
          {/* 预约 4 步 */}
          <div>
            <h3 className="text-sm font-semibold mb-4">如何预约</h3>
            <div className="space-y-3">
              {RESERVE_STEPS.map(([no, t, d]) => (
                <div key={no} className="flex gap-3.5">
                  <span className="w-8 h-8 rounded-full bg-main text-white text-[11px] flex items-center justify-center flex-none">{no}</span>
                  <div>
                    <p className="text-[13.5px] font-medium">{t}</p>
                    <p className="text-[12px] text-ink-faint mt-0.5">{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* 互动须知 */}
          <div>
            <h3 className="text-sm font-semibold mb-4">进店互动须知</h3>
            <ul className="space-y-2.5">
              {RULES.map((r) => (
                <li key={r} className="flex gap-2.5 text-[13px] text-ink-soft">
                  <span className="text-main-deep flex-none">·</span>{r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ===== 区块 4：联系我们 ===== */}
      <section className="mb-16">
        <h2 className="text-center text-[22px] tracking-[0.2em] font-semibold mb-2">联系我们</h2>
        <p className="text-center text-xs tracking-[0.3em] text-ink-faint mb-8 font-en">CONTACT US</p>
        <div className="max-w-[640px] mx-auto bg-card border border-line rounded-2xl p-8 text-center">
          <p className="text-[14px] text-ink-soft mb-5">
            有任何疑问，欢迎拨打电话 <b className="text-main-deep">{phone}</b>，或添加店主微信：<br />
            预约核验、取消改期、领养咨询，都可以直接和店长沟通。
          </p>
          {/* 微信二维码占位（上线时店主上传真实码图替换此块） */}
          <div className="inline-flex flex-col items-center border border-dashed border-main/50 rounded-xl px-10 py-5 mb-5">
            <div className="w-32 h-32 bg-bg-soft rounded-lg flex items-center justify-center text-[11px] text-ink-faint">
              微信二维码<br />（上线后放置）
            </div>
            <p className="text-[11px] text-ink-faint mt-2.5">扫一扫添加店主微信</p>
          </div>
          {/* 快捷入口 */}
          <div className="flex justify-center gap-4">
            <Link to="/reserve"><Button>立即预约</Button></Link>
            <Link to="/qa"><Button variant="ghost">向店长提问</Button></Link>
          </div>
        </div>
      </section>
    </div>
  )
}
