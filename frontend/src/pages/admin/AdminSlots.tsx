// ============================================================
// 代码段功能：后台时段设置（对齐后台管理原型 + PRD §5.8）
// - 时段表格：时段/容量(可改)/是否开放
// - 店休日配置：周一到周日点击切换（存 JSON 数组，1=周一）
// ============================================================
import { useEffect, useState } from 'react'
import { adminSlots, adminSaveSlots } from '@/api/modules'

// 星期定义（1=周一 … 7=周日）
const WEEKDAYS = [
  { n: 1, label: '周一' }, { n: 2, label: '周二' }, { n: 3, label: '周三' },
  { n: 4, label: '周四' }, { n: 5, label: '周五' }, { n: 6, label: '周六' }, { n: 7, label: '周日' },
]

export default function AdminSlots() {
  const [slots, setSlots] = useState<any[]>([])
  const [holidays, setHolidays] = useState<number[]>([1])
  const [saved, setSaved] = useState(false)

  // 加载时段与店休配置
  useEffect(() => {
    adminSlots().then((d) => {
      setSlots(d)
      if (d[0]?.holidays) {
        try { setHolidays(JSON.parse(d[0].holidays)) } catch { /* 保持默认 */ }
      }
    }).catch(() => {})
  }, [])

  // 修改时段容量/开放状态
  const updateSlot = (id: number, patch: Partial<any>) => {
    setSlots((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  // 切换店休日
  const toggleHoliday = (n: number) => {
    setHolidays((h) => (h.includes(n) ? h.filter((x) => x !== n) : [...h, n]))
  }

  // 保存配置
  const save = async () => {
    await adminSaveSlots({
      slots: slots.map(({ id, capacity, is_open }) => ({ id, capacity, is_open })),
      holidays: JSON.stringify(holidays.sort()),
    }).catch(() => {})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <h3 className="text-[15px] font-medium mb-5">时段容量（默认 4 时段 · 每时段限 6 组）</h3>
      <div className="bg-card border border-line rounded-xl p-6 max-w-2xl">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-main-deep border-b border-line">
              <th className="text-left py-2 font-semibold">时段</th>
              <th className="text-left py-2 font-semibold">容量（组）</th>
              <th className="text-left py-2 font-semibold">状态</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.id} className="border-b border-line-soft">
                <td className="py-3">{s.slot}</td>
                <td className="py-3">
                  <input type="number" min={1} className="w-20 px-2 py-1.5 rounded-lg bg-bg-soft border border-line text-[13px]" value={s.capacity} onChange={(e) => updateSlot(s.id, { capacity: Number(e.target.value) })} />
                </td>
                <td className="py-3">
                  <button onClick={() => updateSlot(s.id, { is_open: s.is_open ? 0 : 1 })} className={`px-3 py-1 rounded-full text-[11px] ${s.is_open ? 'bg-success-bg text-success' : 'bg-bg-soft text-ink-faint'}`}>
                    {s.is_open ? '开放' : '停用'}
                  </button>
                </td>
              </tr>
            ))}
            {slots.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-ink-faint">未配置时段（请先启动后端种子数据）</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 店休日配置 */}
      <h3 className="text-[15px] font-medium mt-6 mb-4">店休日配置</h3>
      <div className="bg-card border border-line rounded-xl p-6 max-w-2xl">
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((w) => (
            <button
              key={w.n}
              onClick={() => toggleHoliday(w.n)}
              className={`px-4 py-2 rounded-full text-[12.5px] border transition-colors ${
                holidays.includes(w.n) ? 'bg-danger-bg border-danger/30 text-danger' : 'bg-bg-soft border-line text-ink-soft'
              }`}
              aria-pressed={holidays.includes(w.n)}
            >
              {w.label}{holidays.includes(w.n) ? ' · 店休' : ''}
            </button>
          ))}
        </div>
        <p className="text-[11.5px] text-ink-faint mt-3">店休日前台预约日期自动置灰不可约（当前：{holidays.map((h) => WEEKDAYS.find((w) => w.n === h)?.label).join('、')}）</p>
        <button className="mt-5 px-6 py-2.5 rounded-full bg-btn text-white text-xs font-medium" onClick={save}>
          保存配置
        </button>
        {saved && <span className="text-xs text-success ml-3">已保存 ✓</span>}
      </div>
    </div>
  )
}
