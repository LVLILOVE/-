// ============================================================
// 代码段功能：店长解答页面（前台 /qa）
// - 顶部：功能说明 + 「我要提问」按钮（弹窗表单：昵称/手机号/问题）
// - 主体：已解答问答列表（卡片式，点击展开/收起答案）
// - 提交后提示"店长解答后将公开展示"；联系方式仅店长可见（后台）
// ============================================================
import { useEffect, useState } from 'react'
import FormField, { inputCls } from '@/components/FormField'
import Button from '@/components/Button'
import { fetchAnsweredQa, submitQuestion } from '@/api/modules'
import type { QaItem } from '@/types'

const PHONE_RE = /^1[3-9]\d{9}$/

export default function QaPage() {
  const [list, setList] = useState<QaItem[]>([])      // 已解答问答列表
  const [openId, setOpenId] = useState<number | null>(null)  // 展开的答案项
  const [showForm, setShowForm] = useState(false)     // 提问弹窗
  const [form, setForm] = useState({ nickname: '', phone: '', question: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)   // 提问成功提示

  // 加载已解答问答
  useEffect(() => {
    fetchAnsweredQa().then(setList).catch(() => setList([]))
  }, [])

  // 提问校验：昵称必填 / 手机号（选填，填则校验格式）/ 问题 2-500 字
  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.nickname.trim()) e.nickname = '请填写昵称'
    if (form.phone && !PHONE_RE.test(form.phone)) e.phone = '手机号格式不正确'
    if (form.question.trim().length < 2) e.question = '问题至少 2 个字'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // 提交问题：成功 → 关闭弹窗 + 成功提示
  const handleSubmit = async () => {
    if (!validate()) return
    try {
      await submitQuestion({ question: form.question.trim(), nickname: form.nickname.trim(), phone: form.phone })
      setShowForm(false)
      setSubmitted(true)
      setForm({ nickname: '', phone: '', question: '' })
      setTimeout(() => setSubmitted(false), 4000)
    } catch { /* 错误已由拦截器提示 */ }
  }

  return (
    <div className="max-w-[760px] mx-auto px-5 md:px-10 pt-32 pb-16">
      {/* 页标题 + 功能说明 */}
      <div className="text-center mb-8">
        <h1 className="text-[26px] tracking-[0.2em] font-semibold">店长解答</h1>
        <p className="text-xs tracking-[0.3em] text-ink-faint mt-2 mb-4 font-en">QA WITH OWNER</p>
        <p className="text-[14px] text-ink-soft max-w-lg mx-auto">
          关于预约、猫咪、到店体验的任何问题，都可以在这里提问。<br />
          店长会亲自解答，答案公开给每一位新客人。
        </p>
        <div className="mt-6">
          <Button onClick={() => setShowForm(true)}>我要提问</Button>
        </div>
      </div>

      {/* 提问成功提示 */}
      {submitted && (
        <p className="text-center text-sm text-success bg-success-bg rounded-xl py-3 mb-6">
          ✓ 提问成功！店长解答后会自动公开展示在这里。
        </p>
      )}

      {/* 问答列表（已解答，按解答时间倒序） */}
      {list.length === 0 ? (
        <div className="bg-bg-soft border border-line rounded-2xl py-14 text-center">
          <p className="text-ink-faint">还没有问答记录</p>
          <p className="text-[13px] text-ink-faint mt-1.5">来提第一个问题吧，店长会认真解答</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((item) => (
            <div key={item.id} className="bg-card border border-line rounded-xl overflow-hidden">
              {/* 问题行：点击展开/收起答案（按钮语义，无障碍） */}
              <button
                onClick={() => setOpenId(openId === item.id ? null : item.id)}
                aria-expanded={openId === item.id}
                className="w-full text-left px-5 py-4 flex items-center gap-3"
              >
                <span className="w-8 h-8 rounded-full bg-main/10 text-main flex items-center justify-center text-sm flex-none">问</span>
                <span className="flex-1">
                  <span className="block text-[14.5px] leading-relaxed">{item.question}</span>
                  <span className="block text-[11px] text-ink-faint mt-1">
                    {item.nickname} · {item.answered_at} 店长已解答
                  </span>
                </span>
                {/* 展开箭头 */}
                <span className={`text-main-deep text-xs transition-transform ${openId === item.id ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {/* 答案区：展开时显示 */}
              {openId === item.id && (
                <div className="px-5 pb-4 pl-16">
                  <div className="bg-bg-soft border border-line rounded-lg px-4 py-3">
                    <p className="text-[13px] text-ink-soft leading-relaxed whitespace-pre-line">{item.answer}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 提问弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setShowForm(false)}>
          <div className="bg-card rounded-2xl p-7 w-[520px] max-w-full">
            <h3 className="text-base font-semibold mb-1">向店长提问</h3>
            <p className="text-[12px] text-ink-faint mb-5">解答后会公开展示；手机号仅店长可见，用于回访联系。</p>
            <FormField label="昵称" required error={errors.nickname}>
              <input className={inputCls} value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} onBlur={validate} placeholder="如：新客小喵" maxLength={30} />
            </FormField>
            <FormField label="手机号（选填，仅店长可见）" error={errors.phone}>
              <input className={inputCls} type="tel" maxLength={11} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} onBlur={validate} placeholder="13900000000" />
            </FormField>
            <FormField label="问题" required error={errors.question}>
              <textarea className={inputCls} rows={4} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} onBlur={validate} placeholder="想了解什么？" maxLength={500} />
            </FormField>
            <div className="flex justify-end gap-3 mt-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}>取消</Button>
              <Button onClick={handleSubmit}>提交提问</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
