// ============================================================
// 代码段功能：后台仪表盘（对齐后台管理原型 + 开发技术文档 §6.3 stats）
// - 4 张统计卡：今日预约/待核验押金/待审核领养/在店猫咪
// - 近 7 日预约趋势（简单柱状图，CSS 实现）+ 统计口径说明
// ============================================================
import { useEffect, useState } from 'react'
import { adminStats } from '@/api/modules'

// 统计卡片配置：标题 + 数据键
const CARDS = [
  { key: 'today_reservations', label: '今日预约', color: 'text-success' },
  { key: 'pending_verify', label: '待核验押金', color: 'text-warn' },
  { key: 'pending_adoptions', label: '待审核领养', color: 'text-info' },
  { key: 'active_cats', label: '在店猫咪', color: 'text-main-deep' },
]

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null)

  // 拉取仪表盘统计
  useEffect(() => {
    adminStats().then(setStats).catch(() => setStats(null))
  }, [])

  // 柱状图最大高度：用于按比例渲染柱高
  const maxCount = stats?.week_trend ? Math.max(...stats.week_trend.map((t: any) => t.count), 1) : 1

  return (
    <div>
      {/* 统计卡片区 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {CARDS.map((c) => (
          <div key={c.key} className="bg-card border border-line rounded-xl p-5">
            <p className="text-xs text-ink-faint">{c.label}</p>
            <p className={`text-[26px] font-semibold mt-1 ${c.color}`}>{stats?.[c.key] ?? '—'}</p>
          </div>
        ))}
      </div>

      {/* 近 7 日趋势柱状图 */}
      <div className="bg-card border border-line rounded-xl p-6">
        <h3 className="text-[14.5px] font-medium mb-1">近 7 日预约趋势</h3>
        <p className="text-[11.5px] text-ink-faint mb-5">统计口径：按预约日期（顾客计划到店日）</p>
        <div className="flex items-end gap-3 h-36">
          {stats?.week_trend?.map((t: any) => (
            <div key={t.date} className="flex-1 flex flex-col items-center gap-1.5">
              {/* 柱体：高度按数量比例 */}
              <div className="w-full max-w-[36px] rounded-t-md bg-main transition-all" style={{ height: `${Math.max((t.count / maxCount) * 100, 4)}px` }} />
              <span className="text-[11px] text-ink-faint">{t.date}</span>
            </div>
          ))}
        </div>
        {!stats && <p className="text-[13px] text-ink-faint text-center py-6">暂无统计数据（请先启动后端）</p>}
      </div>
    </div>
  )
}
