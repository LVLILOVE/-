// ============================================================
// 代码段功能：后台猫咪管理（对齐后台管理原型）
// - 表格列表：照片/名字/性格/状态(上线/下线)/可领养/排序/操作
// - 操作：编辑（弹窗表单）/ 上下线 / 软删除
// ============================================================
import { useEffect, useState } from 'react'
import { adminCats, adminUpdateCat, adminDeleteCat, adminUpload } from '@/api/modules'

export default function AdminCats() {
  const [cats, setCats] = useState<any[]>([])
  const [editing, setEditing] = useState<any>(null)   // 当前编辑对象（null 隐藏弹窗）

  // 加载猫咪列表
  const load = () => adminCats().then(setCats).catch(() => setCats([]))
  useEffect(() => { load() }, [])

  // 上下线切换
  const toggleStatus = (c: any) => {
    adminUpdateCat(c.id, { status: c.status === 'active' ? 'offline' : 'active' }).then(load)
  }

  // 软删除（确认后执行）
  const handleDelete = (c: any) => {
    if (!window.confirm(`确认删除「${c.name}」？（软删除，可恢复）`)) return
    adminDeleteCat(c.id).then(load)
  }

  // 保存编辑（含图片上传 URL 更新）
  const saveEdit = async () => {
    if (!editing) return
    try {
      await adminUpdateCat(editing.id, editing)
      setEditing(null)
      load()
    } catch { /* 提示已处理 */ }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[15px] font-medium">猫咪列表（{cats.length}）</h3>
        <button className="px-4 py-2 rounded-full bg-btn text-white text-xs font-medium hover:bg-btn-hover" onClick={() => setEditing({ id: 0, name: '', persona: '', story: '', status: 'active', adoptable: 0, sort_order: 0 })}>+ 新增猫咪</button>
      </div>

      <div className="bg-card border border-line rounded-xl overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-soft text-main-deep">
              <th className="text-left px-4 py-2.5 font-semibold">猫咪</th>
              <th className="text-left px-4 py-2.5 font-semibold">性格</th>
              <th className="text-left px-4 py-2.5 font-semibold">状态</th>
              <th className="text-left px-4 py-2.5 font-semibold">可领养</th>
              <th className="text-left px-4 py-2.5 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id} className="border-t border-line-soft hover:bg-bg-soft">
                <td className="px-4 py-3"><b>{c.name}</b></td>
                <td className="px-4 py-3 text-ink-soft">{c.persona || '—'}</td>
                {/* 状态徽章：上线绿 / 下线灰 */}
                <td className="px-4 py-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] ${c.status === 'active' ? 'bg-success-bg text-success' : 'bg-bg-soft text-ink-faint'}`}>
                    {c.status === 'active' ? '上线' : '下线'}
                  </span>
                </td>
                <td className="px-4 py-3">{c.adoptable ? <span className="text-pink text-xs">可领养</span> : '否'}</td>
                <td className="px-4 py-3 space-x-2">
                  <button className="px-3 py-1 rounded-full border border-line text-xs hover:border-main" onClick={() => setEditing({ ...c })}>编辑</button>
                  <button className="px-3 py-1 rounded-full border border-line text-xs" onClick={() => toggleStatus(c)}>{c.status === 'active' ? '下线' : '上线'}</button>
                  <button className="px-3 py-1 rounded-full border border-danger/30 text-danger text-xs" onClick={() => handleDelete(c)}>删除</button>
                </td>
              </tr>
            ))}
            {cats.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-faint">暂无猫咪，点击右上角新增</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 编辑弹窗（新增时 id=0） */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="bg-card rounded-2xl p-7 w-[520px] max-w-full max-h-[86vh] overflow-auto">
            <h3 className="text-base font-semibold mb-5">{editing.id ? '编辑猫咪' : '新增猫咪'}</h3>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-xs font-semibold">名字 *<input className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label className="text-xs font-semibold">性格标签<input className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" value={editing.persona || ''} onChange={(e) => setEditing({ ...editing, persona: e.target.value })} /></label>
              <label className="col-span-2 text-xs font-semibold">一句话故事<input className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" value={editing.story || ''} onChange={(e) => setEditing({ ...editing, story: e.target.value })} /></label>
              <label className="text-xs font-semibold">可领养
                <select className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" value={editing.adoptable} onChange={(e) => setEditing({ ...editing, adoptable: Number(e.target.value) })}>
                  <option value={0}>否</option><option value={1}>是</option>
                </select>
              </label>
              <label className="text-xs font-semibold">排序号<input className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} /></label>
              <label className="col-span-2 text-xs font-semibold">照片
                <input type="file" accept="image/*" className="mt-1 w-full text-[12px]" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return
                  try { const { url } = await adminUpload(f); setEditing({ ...editing, avatar_url: url }) } catch { /* 提示已处理 */ }
                }} />
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button className="px-4 py-2 rounded-full border border-line text-xs" onClick={() => setEditing(null)}>取消</button>
              <button className="px-5 py-2 rounded-full bg-btn text-white text-xs" onClick={saveEdit}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
