// ============================================================
// 代码段功能：后台门店设置（对齐后台管理原型 + PRD §5.7）
// - 表单：门店名/电话/地址/营业时间/押金金额/地图 iframe/微信收款码
// - 收款码上传：走后台上传接口（JWT），成功后回填 URL
// ============================================================
import { useEffect, useState } from 'react'
import { adminSettings, adminSaveSettings, adminUpload } from '@/api/modules'

// 表单字段配置：key → 中文标签
const FIELDS: { key: string; label: string; full?: boolean }[] = [
  { key: 'store_name', label: '门店名称' },
  { key: 'phone', label: '联系电话' },
  { key: 'address', label: '门店地址', full: true },
  { key: 'hours', label: '营业时间' },
  { key: 'deposit_amount', label: '押金金额（元）' },
  { key: 'map_embed', label: '地图嵌入代码（iframe）', full: true },
]

export default function AdminSettings() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)   // 保存成功提示

  // 加载当前配置
  useEffect(() => {
    adminSettings().then((d) => {
      const f: Record<string, string> = {}
      FIELDS.forEach((x) => { f[x.key] = d[x.key] || '' })
      setForm(f)
      setQr(d.wechat_qr_url || '')
    }).catch(() => {})
  }, [])

  const [qr, setQr] = useState('')

  // 保存配置
  const save = async () => {
    await adminSaveSettings({ ...form, wechat_qr_url: qr }).catch(() => {})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <h3 className="text-[15px] font-medium mb-5">门店信息（前台门店区与押金金额从此读取）</h3>
      <div className="bg-card border border-line rounded-xl p-6 max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <label key={f.key} className={f.full ? 'col-span-2 text-xs font-semibold' : 'text-xs font-semibold'}>
              {f.label}
              {f.key === 'map_embed' ? (
                <textarea className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[12.5px]" rows={2} value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder="高德/腾讯地图 iframe 代码" />
              ) : (
                <input className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[12.5px]" value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              )}
            </label>
          ))}
        </div>

        {/* 微信收款码上传 */}
        <label className="block text-xs font-semibold mt-4">微信收款码（押金收款展示）</label>
        <div className="mt-1.5 flex items-center gap-4">
          {qr && <img src={qr} alt="微信收款码" className="w-24 h-24 rounded-lg border border-line object-contain" />}
          <label className="px-4 py-2 rounded-full border border-line text-xs cursor-pointer hover:border-main">
            上传收款码图片
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return
              try { const { url } = await adminUpload(f); setQr(url) } catch { /* 提示已处理 */ }
            }} />
          </label>
        </div>

        <div className="flex items-center gap-4 mt-6">
          <button className="px-6 py-2.5 rounded-full bg-btn text-white text-xs font-medium" onClick={save}>保存配置</button>
          {saved && <span className="text-xs text-success">已保存 ✓</span>}
        </div>
      </div>
    </div>
  )
}
