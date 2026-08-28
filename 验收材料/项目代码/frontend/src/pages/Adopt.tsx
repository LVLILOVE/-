// ============================================================
// 代码段功能：领养页（对齐 PRD §4.5 与 UIUX §4.6/§6）
// - 情感入口 → 5 步流程条 → 待领养猫咪 → 申请表单（照片上传）→ 成功案例墙
// - 支持从猫咪详情带意向参数跳转（?cat=&name=）
// ============================================================
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FormField, { inputCls } from '@/components/FormField'
import Button from '@/components/Button'
import CatCard from '@/components/CatCard'
import { fetchCats, fetchAdoptedCases, createAdoption, uploadPhoto } from '@/api/modules'
import type { Cat, AdoptedCase } from '@/types'

const PHONE_RE = /^1[3-9]\d{9}$/

// 领养流程 5 步定义（PRD §6.2）
const STEPS = ['在线申请', '待审核', '待面谈', '待家访', '已领养']

export default function Adopt() {
  const [params] = useSearchParams()
  const prefillCatId = params.get('cat') ? Number(params.get('cat')) : null

  // ---- 页面数据 ----
  const [cats, setCats] = useState<Cat[]>([])            // 待领养猫咪
  const [cases, setCases] = useState<AdoptedCase[]>([])  // 成功案例
  const [submitted, setSubmitted] = useState(false)      // 申请提交成功

  // ---- 申请表单状态 ----
  const [form, setForm] = useState({
    cat_id: prefillCatId, name: '', phone: '', city: '', housing: '整租',
    experience: '', family_agreed: '', reason: '',
  })
  const [photos, setPhotos] = useState<string[]>([])      // 环境照片 URL
  const [errors, setErrors] = useState<Record<string, string>>({})

  // 加载待领养猫咪与成功案例
  useEffect(() => {
    fetchCats(1).then(setCats).catch(() => setCats([]))
    fetchAdoptedCases().then(setCases).catch(() => setCases([]))
  }, [])

  // ---- 照片上传（公开接口，最多 3 张，UIUX §6.2）----
  const handlePhoto = async (file: File) => {
    if (photos.length >= 3) { window.alert('最多上传 3 张环境照片'); return }
    try {
      const { url } = await uploadPhoto(file)
      setPhotos((p) => [...p, url])
    } catch { /* 错误已提示 */ }
  }

  // ---- 表单校验（onBlur 即时 + 提交兜底）----
  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = '请填写姓名'
    if (!PHONE_RE.test(form.phone)) e.phone = '请输入正确的手机号'
    if (!form.city.trim()) e.city = '请填写所在城市'
    if (!form.reason.trim() || form.reason.trim().length < 5) e.reason = '请填写领养理由（至少 5 个字）'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ---- 提交领养申请 ----
  const handleSubmit = async () => {
    if (!validate()) return
    try {
      await createAdoption({ ...form, photos })
      setSubmitted(true)
    } catch { /* 错误已提示 */ }
  }

  return (
    <div className="max-w-[1000px] mx-auto px-5 md:px-10 pt-32 pb-16">
      {/* 情感入口 */}
      <div className="text-center mb-12">
        <h1 className="text-[28px] tracking-[0.2em] font-semibold">把爱带回家</h1>
        <p className="text-ink-soft text-[15px] mt-3 max-w-lg mx-auto leading-loose">
          每一只猫都值得一个家。如果你准备好用一生去陪伴，这里有一只猫正在等你。
        </p>
      </div>

      {/* 5 步流程条：桌面横向 / 移动端纵向 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-12">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full bg-main text-white flex items-center justify-center text-xs flex-none">{i + 1}</span>
            <span className="text-[13px] text-ink">{s}</span>
          </div>
        ))}
      </div>

      {/* 待领养猫咪 */}
      <h2 className="text-xl tracking-[0.15em] font-semibold mb-5">等待遇见你的猫</h2>
      {cats.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-14">
          {cats.map((cat) => <CatCard key={cat.id} cat={cat} />)}
        </div>
      ) : (
        <p className="text-ink-faint text-sm mb-14 bg-bg-soft rounded-xl p-6 text-center">当前没有可领养的猫咪，请持续关注。</p>
      )}

      {/* 申请表单 */}
      <h2 className="text-xl tracking-[0.15em] font-semibold mb-5">提交领养申请</h2>
      {submitted ? (
        // 提交成功视图（PRD §4.5）
        <div className="bg-success-bg border border-success/30 rounded-2xl p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-success text-white flex items-center justify-center text-2xl mx-auto mb-3">✓</div>
          <h3 className="text-lg font-semibold text-success">申请已收到</h3>
          <p className="text-sm text-ink-soft mt-2">我们会尽快联系您进行下一步沟通。</p>
        </div>
      ) : (
        <div className="bg-card border border-line rounded-2xl p-6 md:p-8 mb-14">
          {/* 意向猫咪下拉 */}
          <FormField label="意向猫咪">
            <select className={inputCls} value={form.cat_id ?? ''} onChange={(e) => setForm({ ...form, cat_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">暂不指定</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
          <div className="grid md:grid-cols-2 gap-x-5">
            <FormField label="姓名" required error={errors.name}>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={validate} autoComplete="name" />
            </FormField>
            <FormField label="手机号" required error={errors.phone}>
              <input className={inputCls} type="tel" maxLength={11} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} onBlur={validate} autoComplete="tel" />
            </FormField>
            <FormField label="所在城市" required error={errors.city}>
              <input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} onBlur={validate} />
            </FormField>
            <FormField label="居住情况" required>
              <select className={inputCls} value={form.housing} onChange={(e) => setForm({ ...form, housing: e.target.value })}>
                <option value="自有住房">自有住房</option>
                <option value="整租">整租</option>
                <option value="合租">合租（已获室友同意）</option>
              </select>
            </FormField>
            <FormField label="养宠经验">
              <input className={inputCls} value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} placeholder="如：养过 2 年猫咪" />
            </FormField>
            <FormField label="家人是否同意">
              <input className={inputCls} value={form.family_agreed} onChange={(e) => setForm({ ...form, family_agreed: e.target.value })} placeholder="如：全家一致同意" />
            </FormField>
          </div>
          <FormField label="领养理由" required error={errors.reason}>
            <textarea className={inputCls} rows={4} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} onBlur={validate} placeholder="说说你为什么想领养它" />
          </FormField>

          {/* 环境照片上传（最多 3 张） */}
          <FormField label="环境照片（选填，最多 3 张）">
            <div className="flex gap-3 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p} alt={`环境照片 ${i + 1}`} className="w-20 h-20 rounded-xl object-cover border border-line" />
                  <button className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white text-[10px]" onClick={() => setPhotos((arr) => arr.filter((_, j) => j !== i))} aria-label="删除照片">×</button>
                </div>
              ))}
              {photos.length < 3 && (
                <label className="w-20 h-20 rounded-xl border-2 border-dashed border-line flex flex-col items-center justify-center text-ink-faint text-[11px] cursor-pointer hover:border-main">
                  上传
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = '' }} />
                </label>
              )}
            </div>
          </FormField>

          <p className="text-xs text-ink-faint mb-4">提交即表示您同意我们为领养审核使用以上信息（见隐私政策）。</p>
          <Button onClick={handleSubmit} className="w-full">提交申请</Button>
        </div>
      )}

      {/* 成功案例墙（PRD §4.5「它们毕业回家啦」） */}
      <h2 className="text-xl tracking-[0.15em] font-semibold mb-5">它们毕业回家啦</h2>
      {cases.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cases.map((c) => (
            <div key={c.id} className="bg-card border border-line rounded-2xl overflow-hidden">
              <img src={c.photo || 'https://images.unsplash.com/photo-1573865526739-10659fec78a5?auto=format&fit=crop&w=500&q=70'} alt={`${c.cat_name}领养成功`} className="w-full h-44 object-cover" loading="lazy" />
              <div className="p-4">
                <p className="font-medium">{c.cat_name} · 回家啦</p>
                <p className="text-[13px] text-ink-soft mt-1.5 leading-relaxed">{c.story}</p>
                {c.adopted_at && <p className="text-[11px] text-ink-faint mt-2">{c.adopted_at} 毕业</p>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-ink-faint text-sm bg-bg-soft rounded-xl p-6 text-center">第一批毕业的猫咪正在路上…</p>
      )}
    </div>
  )
}
