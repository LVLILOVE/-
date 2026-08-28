// ============================================================
// 代码段功能：后台预约管理（对齐后台管理原型 + PRD §5.5）
// - 筛选条：状态 / 日期 / 手机号
// - 表格：单号/顾客/日期时段/人数/押金/状态徽章/操作
// - 操作：押金核验(通过/退回) / 到店 / 爽约 / 取消(退款备注)
// ============================================================
import { useEffect, useState } from 'react'
import StatusBadge from '@/components/StatusBadge'
import { adminReservations, adminVerifyPayment, adminReservationAction } from '@/api/modules'

export default function AdminReservations() {
  const [rows, setRows] = useState<any[]>([])
  const [filters, setFilters] = useState({ status: '', date: '', phone: '' })

  // 按筛选条件加载预约列表
  const load = (f = filters) => {
    adminReservations(f).then(setRows).catch(() => setRows([]))
  }
  useEffect(() => { load() }, [])   // 首次加载

  // 押金核验：pass → 已确认；reject → 核验未通过（填原因）
  const verify = (r: any, result: 'pass' | 'reject') => {
    if (result === 'reject') {
      const reason = window.prompt('请输入退回原因（顾客将看到）：') || ''
      if (!reason) return
      adminVerifyPayment(r.id, result, reason).then(() => load())
    } else {
      adminVerifyPayment(r.id, result).then(() => load())
    }
  }

  // 状态操作：到店 / 爽约 / 取消
  const action = (r: any, act: string) => {
    if (act === 'cancel') {
      const reason = window.prompt('取消原因 + 退款备注（如：已退押金-微信转账）：') || ''
      if (!reason) return
      adminReservationAction(r.id, act, reason).then(() => load())
    } else {
      adminReservationAction(r.id, act).then(() => load())
    }
  }

  return (
    <div>
      {/* 筛选条 */}
      <div className="flex flex-wrap gap-3 mb-5">
        <select className="px-3 py-2 rounded-lg bg-card border border-line text-[13px]" value={filters.status} onChange={(e) => { const f = { ...filters, status: e.target.value }; setFilters(f); load(f) }}>
          <option value="">全部状态</option>
          <option value="pending_payment">待支付押金</option>
          <option value="payment_verify">押金待核验</option>
          <option value="verify_rejected">核验未通过</option>
          <option value="confirmed">已确认</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已取消</option>
          <option value="no_show">爽约</option>
        </select>
        <input type="date" className="px-3 py-2 rounded-lg bg-card border border-line text-[13px]" value={filters.date} onChange={(e) => { const f = { ...filters, date: e.target.value }; setFilters(f); load(f) }} />
        <input className="px-3 py-2 rounded-lg bg-card border border-line text-[13px]" placeholder="手机号搜索" value={filters.phone} onChange={(e) => { const f = { ...filters, phone: e.target.value }; setFilters(f); load(f) }} />
      </div>

      <div className="bg-card border border-line rounded-xl overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-soft text-main-deep">
              <th className="text-left px-4 py-2.5 font-semibold">单号</th>
              <th className="text-left px-4 py-2.5 font-semibold">顾客</th>
              <th className="text-left px-4 py-2.5 font-semibold">日期时段</th>
              <th className="text-left px-4 py-2.5 font-semibold">押金</th>
              <th className="text-left px-4 py-2.5 font-semibold">状态</th>
              <th className="text-left px-4 py-2.5 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line-soft hover:bg-bg-soft">
                <td className="px-4 py-3 font-medium">{r.reservation_no}</td>
                <td className="px-4 py-3">{r.name}<br /><span className="text-[11px] text-ink-faint">{r.phone}</span></td>
                <td className="px-4 py-3">{r.reserve_date}<br /><span className="text-[11px] text-ink-faint">{r.slot} · {r.party_size}人</span></td>
                <td className="px-4 py-3 font-semibold text-btn">¥ {Number(r.deposit_amount).toFixed(2)}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 space-x-1.5 whitespace-nowrap">
                  {/* 押金待核验 → 通过/退回 */}
                  {r.status === 'payment_verify' && (
                    <>
                      <button className="px-2.5 py-1 rounded-full bg-success-bg text-success text-[11px]" onClick={() => verify(r, 'pass')}>核验通过</button>
                      <button className="px-2.5 py-1 rounded-full bg-danger-bg text-danger text-[11px]" onClick={() => verify(r, 'reject')}>退回</button>
                    </>
                  )}
                  {/* 核验未通过 → 提示原因（无操作，顾客可重提） */}
                  {r.status === 'verify_rejected' && <span className="text-[11px] text-danger">{r.verify_reject_reason || '待顾客重提'}</span>}
                  {/* 已确认 → 到店/爽约/取消 */}
                  {r.status === 'confirmed' && (
                    <>
                      <button className="px-2.5 py-1 rounded-full border border-line text-[11px]" onClick={() => action(r, 'arrive')}>到店</button>
                      <button className="px-2.5 py-1 rounded-full border border-danger/30 text-danger text-[11px]" onClick={() => action(r, 'no_show')}>爽约</button>
                      <button className="px-2.5 py-1 rounded-full border border-line text-[11px]" onClick={() => action(r, 'cancel')}>取消</button>
                    </>
                  )}
                  {/* 待支付状态 → 可取消 */}
                  {r.status === 'pending_payment' && (
                    <button className="px-2.5 py-1 rounded-full border border-line text-[11px]" onClick={() => action(r, 'cancel')}>取消</button>
                  )}
                  {/* 取消原因/退款备注展示 */}
                  {r.status === 'cancelled' && r.cancel_reason && <span className="text-[11px] text-ink-faint">{r.cancel_reason}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-faint">暂无符合条件的预约</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
