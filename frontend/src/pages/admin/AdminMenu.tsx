// ============================================================
// 代码段功能：后台餐单管理（对齐后台管理原型）
// - 表格：菜品/分类/价格/状态(在售/下架)/操作
// - 新增/编辑弹窗（价格元→分自动转换由后端处理）/ 上下架 / 删除
// ============================================================
import { useEffect, useState } from 'react'
import { adminMenu, adminCreateMenuItem, adminUpdateMenuItem, adminDeleteMenuItem } from '@/api/modules'

export default function AdminMenu() {
  const [items, setItems] = useState<any[]>([])
  const [editing, setEditing] = useState<any>(null)

  // 加载餐单
  const load = () => adminMenu().then(setItems).catch(() => setItems([]))
  useEffect(() => { load() }, [])

  // 上下架切换
  const toggleStatus = (m: any) => {
    adminUpdateMenuItem(m.id, { status: m.status === 'on_sale' ? 'off_shelf' : 'on_sale' }).then(load)
  }

  // 保存新增/编辑
  const save = async () => {
    if (!editing?.name) { window.alert('请填写菜品名'); return }
    try {
      if (editing.id) await adminUpdateMenuItem(editing.id, editing)
      else await adminCreateMenuItem(editing)
      setEditing(null)
      load()
    } catch { /* 提示已处理 */ }
  }

  // 删除
  const handleDelete = (m: any) => {
    if (!window.confirm(`确认删除「${m.name}」？`)) return
    adminDeleteMenuItem(m.id).then(load)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[15px] font-medium">餐单列表</h3>
        <button className="px-4 py-2 rounded-full bg-btn text-white text-xs hover:bg-btn-hover" onClick={() => setEditing({ id: 0, name: '', category: 'coffee', price: 0, status: 'on_sale' })}>+ 新增菜品</button>
      </div>

      <div className="bg-card border border-line rounded-xl overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-soft text-main-deep">
              <th className="text-left px-4 py-2.5 font-semibold">菜品</th>
              <th className="text-left px-4 py-2.5 font-semibold">分类</th>
              <th className="text-left px-4 py-2.5 font-semibold">价格</th>
              <th className="text-left px-4 py-2.5 font-semibold">状态</th>
              <th className="text-left px-4 py-2.5 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className="border-t border-line-soft hover:bg-bg-soft">
                <td className="px-4 py-3"><b>{m.name}</b></td>
                <td className="px-4 py-3 text-ink-soft">{m.category === 'coffee' ? '咖啡' : m.category === 'tea' ? '茶饮' : m.category === 'dessert' ? '甜品' : '猫零食'}</td>
                <td className="px-4 py-3 font-semibold text-btn">¥ {Number(m.price).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] ${m.status === 'on_sale' ? 'bg-success-bg text-success' : 'bg-bg-soft text-ink-faint'}`}>
                    {m.status === 'on_sale' ? '在售' : '已下架'}
                  </span>
                </td>
                <td className="px-4 py-3 space-x-2">
                  <button className="px-3 py-1 rounded-full border border-line text-xs hover:border-main" onClick={() => setEditing({ ...m })}>编辑</button>
                  <button className="px-3 py-1 rounded-full border border-line text-xs" onClick={() => toggleStatus(m)}>{m.status === 'on_sale' ? '下架' : '上架'}</button>
                  <button className="px-3 py-1 rounded-full border border-danger/30 text-danger text-xs" onClick={() => handleDelete(m)}>删除</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-faint">暂无菜品，点击右上角新增</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="bg-card rounded-2xl p-7 w-[480px] max-w-full">
            <h3 className="text-base font-semibold mb-5">{editing.id ? '编辑菜品' : '新增菜品'}</h3>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-xs font-semibold">菜品名 *<input className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label className="text-xs font-semibold">分类
                <select className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  <option value="coffee">咖啡</option><option value="tea">茶饮</option><option value="dessert">甜品</option><option value="cat_snack">猫零食</option>
                </select>
              </label>
              <label className="text-xs font-semibold">价格（元）<input className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" type="number" step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></label>
              <label className="text-xs font-semibold">状态
                <select className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  <option value="on_sale">在售</option><option value="off_shelf">下架</option>
                </select>
              </label>
              <label className="col-span-2 text-xs font-semibold">描述<input className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-soft border border-line text-[13px]" value={editing.desc || ''} onChange={(e) => setEditing({ ...editing, desc: e.target.value })} /></label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button className="px-4 py-2 rounded-full border border-line text-xs" onClick={() => setEditing(null)}>取消</button>
              <button className="px-5 py-2 rounded-full bg-btn text-white text-xs" onClick={save}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
