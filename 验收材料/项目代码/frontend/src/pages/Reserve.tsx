// ============================================================
// 代码段功能：预约页（对齐 PRD §4.4 与 UIUX §4.5/§5）
// - 步骤一：预约表单（姓名/手机号/日期/时段/人数/儿童/备注 + 时段余量）
// - 步骤二：押金支付视图（收款码 + 押金金额 + 2h 倒计时 + 凭证表单）
// - 状态展示：押金待核验 / 核验未通过(可重提) / 已确认 / 已取消
// - 状态查询区：手机号 + 预约单号查询
// - 支持从猫咪详情页带意向参数跳转（?cat=&name=）
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FormField, { inputCls } from '@/components/FormField'
import Button from '@/components/Button'
import StatusBadge from '@/components/StatusBadge'
import {
  fetchSlots, createReservation, submitPaymentProof, queryReservationStatus, cancelReservation, fetchStore,
} from '@/api/modules'
import type { Reservation, SlotsResp, StoreInfo } from '@/types'

// 手机号正则（与后端一致：大陆 11 位）
const PHONE_RE = /^1[3-9]\d{9}$/

// 押金状态视图文案
const DEPOSIT_HINT = '转账时请备注手机号，店主核验通过后即为确认预约'

export default function Reserve() {
  const [params] = useSearchParams()
  // 从猫咪详情跳转时预填意向
  const prefillCat = useMemo(() => params.get('name') || '', [params])

  // ---- 表单状态 ----
  const [form, setForm] = useState({ name: '', phone: '', reserve_date: '', slot: '', party_size: 2, has_child: false, remark: prefillCat ? `想见猫咪：${prefillCat}` : '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [slots, setSlots] = useState<SlotsResp | null>(null)   // 时段余量数据
  const [store, setStore] = useState<StoreInfo>({})

  // ---- 流程状态 ----
  const [reservation, setReservation] = useState<Reservation | null>(null)  // 当前预约
  const [step, setStep] = useState<'form' | 'pay' | 'result'>('form')       // 流程步骤

  // ---- 凭证与查询状态 ----
  const [nickname, setNickname] = useState('')
  const [transNo, setTransNo] = useState('')
  const [queryNo, setQueryNo] = useState('')
  const [queryPhone, setQueryPhone] = useState('')
  const [queried, setQueried] = useState<Reservation | null>(null)

  // 门店配置（收款码展示用）
  useEffect(() => { fetchStore().then(setStore).catch(() => {}) }, [])

  // 选择日期后拉取当日时段余量（店休返回 is_holiday）
  const loadSlots = (date: string) => {
    setForm((f) => ({ ...f, reserve_date: date, slot: '' }))
    fetchSlots(date).then(setSlots).catch(() => setSlots(null))
  }

  // ---- 字段校验（onBlur 即时 + 提交兜底，UIUX §9）----
  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = '请填写姓名'
    if (!PHONE_RE.test(form.phone)) e.phone = '请输入正确的手机号'
    if (!form.reserve_date) e.reserve_date = '请选择日期'
    else if (slots?.is_holiday) e.reserve_date = '周一店休，请选择其他日期'
    if (!form.slot) e.slot = '请选择时段'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ---- 提交预约：成功后进入押金支付视图 ----
  const handleSubmit = async () => {
    if (!validate()) return
    try {
      const r = await createReservation({ ...form, party_size: Number(form.party_size) })
      setReservation(r)
      setStep('pay')
    } catch { /* 错误已由 axios 拦截器提示 */ }
  }

  // ---- 提交押金凭证 ----
  const handleProof = async () => {
    if (!reservation) return
    if (!nickname.trim()) { window.alert('请填写转账人昵称'); return }
    try {
      const r = await submitPaymentProof(reservation.id, { phone: reservation.phone, nickname, trans_no: transNo })
      setReservation(r)
      setStep('result')
    } catch { /* 提示已处理 */ }
  }

  // ---- 状态查询 ----
  const handleQuery = async () => {
    if (!queryNo || !queryPhone) { window.alert('请填写预约单号和手机号'); return }
    try {
      const r = await queryReservationStatus(Number(queryNo), queryPhone)
      setQueried(r)
    } catch { /* 40401 提示已处理 */ }
  }

  // ---- 顾客自助取消（核验前）----
  const handleCancel = async (r: Reservation) => {
    if (!window.confirm('确认取消该预约吗？名额将立即释放。')) return
    try {
      const updated = await cancelReservation(r.id, r.phone)
      if (reservation?.id === r.id) setReservation(updated)
      if (queried?.id === r.id) setQueried(updated)
    } catch { /* 提示已处理 */ }
  }

  return (
    <div className="max-w-[760px] mx-auto px-5 md:px-10 pt-32 pb-16">
      <h1 className="text-[26px] tracking-[0.2em] font-semibold text-center">预约来见猫</h1>
      <p className="text-center text-xs tracking-[0.3em] text-ink-faint mt-2 mb-9 font-en">RESERVE</p>

      {/* ===== 步骤一：预约表单 ===== */}
      {step === 'form' && (
        <div className="bg-card border border-line rounded-2xl p-6 md:p-8">
          <FormField label="姓名" required error={errors.name}>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={validate} autoComplete="name" />
          </FormField>
          <FormField label="手机号" required error={errors.phone}>
            <input className={inputCls} type="tel" inputMode="numeric" maxLength={11} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} onBlur={validate} autoComplete="tel" placeholder="用于预约确认与状态查询" />
          </FormField>

          {/* 日期选择：周一在原生 date 上无状态，选中后由 slots 接口判定店休 */}
          <FormField label="到店日期" required error={errors.reserve_date}>
            <input className={inputCls} type="date" min={new Date().toISOString().slice(0, 10)} value={form.reserve_date} onChange={(e) => loadSlots(e.target.value)} />
          </FormField>

          {/* 时段余量选择：选中日期后展示 4 时段与剩余名额 */}
          <FormField label="时段" required error={errors.slot}>
            {slots ? (
              slots.is_holiday ? (
                <p className="text-sm text-danger">周一店休，请选择其他日期。</p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {slots.slots.map((s) => {
                    const disabled = s.remaining <= 0  // 满员禁用
                    const selected = form.slot === s.slot
                    return (
                      <button
                        key={s.slot}
                        disabled={disabled}
                        onClick={() => setForm({ ...form, slot: s.slot })}
                        className={`px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                          disabled ? 'opacity-40 cursor-not-allowed bg-bg-soft'
                          : selected ? 'bg-main border-main text-white'
                          : 'bg-bg-soft border-line hover:border-main'
                        }`}
                      >
                        {s.slot}
                        <span className={`block text-[11px] ${selected ? 'text-white/80' : 'text-ink-faint'}`}>
                          {disabled ? '已约满' : `余 ${s.remaining} 组`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            ) : (
              <p className="text-sm text-ink-faint">请先选择日期</p>
            )}
          </FormField>

          <FormField label="人数" required>
            <select className={inputCls} value={form.party_size} onChange={(e) => setForm({ ...form, party_size: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} 人（单组最多 6 人）</option>)}
            </select>
          </FormField>

          <FormField label="是否有 6 岁以下儿童">
            <select className={inputCls} value={form.has_child ? '1' : '0'} onChange={(e) => setForm({ ...form, has_child: e.target.value === '1' })}>
              <option value="0">没有</option>
              <option value="1">有（需家长全程陪同）</option>
            </select>
          </FormField>

          <FormField label="备注（过敏史、想见的猫）">
            <textarea className={inputCls} rows={3} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="如：对猫毛轻微过敏；想见奶糖" />
          </FormField>

          {/* 隐私提示（UIUX §3.4） */}
          <p className="text-xs text-ink-faint mb-4">信息仅用于预约联系，详见隐私政策。</p>
          <Button onClick={handleSubmit} className="w-full">提交预约</Button>
        </div>
      )}

      {/* ===== 步骤二：押金支付视图（UIUX §5 待支付状态）===== */}
      {step === 'pay' && reservation && (
        <div className="bg-card border border-line rounded-2xl p-6 md:p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-success-bg text-success flex items-center justify-center text-2xl mx-auto mb-3">✓</div>
          <h2 className="text-lg font-semibold">预约成功，名额已锁定</h2>
          <p className="text-[13px] text-ink-soft mt-1">单号 <b className="text-ink">{reservation.reservation_no}</b> · {reservation.reserve_date} {reservation.slot}</p>

          {/* 收款码卡片 */}
          <div className="mt-6 inline-block border-2 border-dashed border-main rounded-2xl p-5">
            {store.wechat_qr_url ? (
              <img src={store.wechat_qr_url} alt="店主微信收款码" className="w-44 h-44 object-contain" />
            ) : (
              <div className="w-44 h-44 bg-bg-soft flex items-center justify-center text-xs text-ink-faint">微信收款码（店主配置后显示）</div>
            )}
            <p className="mt-3 text-sm">押金 <b className="text-btn text-lg">¥{(reservation.deposit_amount ?? 20).toFixed(2)}</b></p>
            <p className="text-xs text-ink-faint mt-1">{DEPOSIT_HINT}</p>
          </div>

          {/* 超时提示：2 小时未支付自动取消（PRD §4.4） */}
          <p className="text-xs text-warn mt-4">请于 2 小时内完成转账并提交凭证，超时预约将自动取消。</p>

          {/* 凭证表单 */}
          <div className="mt-6 max-w-sm mx-auto text-left">
            <FormField label="转账人微信昵称" required>
              <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="转账时显示的昵称" />
            </FormField>
            <FormField label="转账单号（选填）">
              <input className={inputCls} value={transNo} onChange={(e) => setTransNo(e.target.value)} placeholder="微信支付凭证中的单号" />
            </FormField>
            <Button onClick={handleProof} className="w-full">我已转账，提交凭证</Button>
          </div>
        </div>
      )}

      {/* ===== 步骤三：结果视图（待核验/核验未通过/已确认/已取消）===== */}
      {step === 'result' && reservation && (
        <div className="bg-card border border-line rounded-2xl p-6 md:p-8">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-lg font-semibold">预约状态</h2>
            <StatusBadge status={reservation.status} />
          </div>
          {/* 状态详情行：单号/日期/时段/人数 */}
          <div className="text-[14px] text-ink-soft space-y-2 mb-5">
            <p>单号：{reservation.reservation_no}</p>
            <p>到店：{reservation.reserve_date} {reservation.slot} · {reservation.party_size} 人</p>
            {reservation.verify_reject_reason && <p className="text-danger">核验未通过原因：{reservation.verify_reject_reason}</p>}
            {reservation.cancel_reason && <p className="text-ink-faint">取消原因：{reservation.cancel_reason}</p>}
          </div>
          {/* 按状态给出操作提示 */}
          {reservation.status === 'payment_verify' && (
            <p className="text-sm text-warn bg-warn-bg rounded-lg p-3">凭证已提交，店主核验中…核验通过后店主会电话联系您。</p>
          )}
          {reservation.status === 'verify_rejected' && (
            <p className="text-sm text-danger bg-danger-bg rounded-lg p-3">核验未通过，请重新提交凭证（限时 2 小时）。</p>
          )}
          {reservation.status === 'confirmed' && (
            <p className="text-sm text-success bg-success-bg rounded-lg p-3">预约已确认，期待与您和猫见面。取消请提前联系店主。</p>
          )}
          {reservation.status === 'cancelled' && (
            <p className="text-sm text-ink-faint bg-bg-soft rounded-lg p-3">预约已取消，名额已释放。</p>
          )}
          {/* 操作：核验未通过时重新提交；占用中状态可自助取消 */}
          {reservation.status === 'verify_rejected' && (
            <div className="mt-5 flex gap-3 flex-wrap">
              <Button onClick={handleProof}>重新提交凭证</Button>
              <Button variant="ghost" onClick={() => setStep('pay')}>返回凭证页</Button>
            </div>
          )}
          {['pending_payment', 'payment_verify', 'verify_rejected'].includes(reservation.status) && (
            <div className="mt-5">
              <Button variant="ghost" onClick={() => handleCancel(reservation)}>取消预约</Button>
            </div>
          )}
        </div>
      )}

      {/* ===== 状态查询区（PRD §4.4）===== */}
      <div className="mt-10 bg-bg-soft border border-line rounded-2xl p-6">
        <h3 className="text-[15px] font-medium mb-4">查询预约状态</h3>
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3">
          <input className={inputCls} inputMode="numeric" placeholder="预约单号（如 12）" value={queryNo} onChange={(e) => setQueryNo(e.target.value)} />
          <input className={inputCls} type="tel" maxLength={11} placeholder="预留手机号" value={queryPhone} onChange={(e) => setQueryPhone(e.target.value)} />
          <Button variant="ghost" onClick={handleQuery}>查询</Button>
        </div>
        {queried && (
          <div className="mt-4 bg-card border border-line rounded-xl p-4">
            <div className="flex items-center gap-3">
              <b>{queried.reservation_no}</b>
              <StatusBadge status={queried.status} />
            </div>
            <p className="text-[13px] text-ink-soft mt-1.5">{queried.reserve_date} {queried.slot} · {queried.party_size} 人</p>
            {queried.verify_reject_reason && <p className="text-xs text-danger mt-1">原因：{queried.verify_reject_reason}</p>}
            {['pending_payment', 'payment_verify', 'verify_rejected'].includes(queried.status) && (
              <button className="text-xs text-main-deep mt-2 underline" onClick={() => handleCancel(queried)}>取消该预约</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
