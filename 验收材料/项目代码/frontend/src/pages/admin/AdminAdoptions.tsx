// ============================================================
// 代码段功能：后台领养管理（对齐后台管理原型 + PRD §5.6）
// - 列表：申请人/意向猫/居住/状态徽章/操作
// - 操作：审核流转（待审核→待面谈→待家访→已领养/未通过）+ 回访记录
// - 已领养时可填写成功故事（前台案例墙数据源）
// ============================================================
import { useEffect, useState } from 'react'
import { adminAdoptions, adminAdoptionFlow, adminAdoptionDetail, adminAddAdoptionNote } from '@/api/modules'

// 审核状态 → 中文
const FLOW_LABEL: Record<string, string> = {
  pending: '待审核', interview: '待面谈', home_check: '待家访', adopted: '已领养', rejected: '未通过',
}

// 下一状态流转顺序
const FLOW_NEXT: Record<string, string> = { pending: 'interview', interview: 'home_check', home_check: 'adopted' }

export default function AdminAdoptions() {
  const [rows, setRows] = useState<any[]>([])
  const [detail, setDetail] = useState<any>(null)   // 当前查看的申请详情（含回访）
  const [noteText, setNoteText] = useState('')

  // 加载申请列表
  const load = () => adminAdoptions().then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [])

  // 审核流转：推进 / 未通过
  const flow = async (a: any, status: string) => {
    const note = status === 'rejected' ? (window.prompt('未通过原因（申请人将看到）：') || '') : ''
    if (status === 'rejected' && !note) return
    // 已领养时可补充成功故事（用于前台案例墙）
    let story = ''
    if (status === 'adopted') {
      story = window.prompt('领养成功故事（将展示在前台「毕业回家」墙）：') || ''
    }
    await adminAdoptionFlow(a.id, { status, note, success_story: story }).catch(() => {})
    load()
  }

  // 查看详情（含回访记录）
  const viewDetail = (a: any) => adminAdoptionDetail(a.id).then(setDetail)

  // 新增回访记录
  const addNote = async () => {
    if (!detail || !noteText.trim()) return
    await adminAddAdoptionNote(detail.id, { note_date: new Date().toISOString().slice(0, 10), content: noteText.trim() }).catch(() => {})
    setNoteText('')
    adminAdoptionDetail(detail.id).then(setDetail)
  }

  return (
    <div>
      <div className="bg-card border border-line rounded-xl overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-soft text-main-deep">
              <th className="text-left px-4 py-2.5 font-semibold">申请人</th>
              <th className="text-left px-4 py-2.5 font-semibold">意向猫咪</th>
              <th className="text-left px-4 py-2.5 font-semibold">居住</th>
              <th className="text-left px-4 py-2.5 font-semibold">状态</th>
              <th className="text-left px-4 py-2.5 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-line-soft hover:bg-bg-soft">
                <td className="px-4 py-3">{a.name}<br /><span className="text-[11px] text-ink-faint">{a.phone}</span></td>
                <td className="px-4 py-3">{a.cat_name || '未指定'}</td>
                <td className="px-4 py-3 text-ink-soft">{a.housing}</td>
                {/* 状态徽章：颜色区分审核阶段 */}
                <td className="px-4 py-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] ${
                    a.status === 'adopted' ? 'bg-success-bg text-success'
                    : a.status === 'rejected' ? 'bg-danger-bg text-danger'
                    : a.status === 'pending' ? 'bg-bg-soft text-ink-faint'
                    : 'bg-warn-bg text-warn'}`}>
                    {FLOW_LABEL[a.status]}
                  </span>
                </td>
                <td className="px-4 py-3 space-x-1.5 whitespace-nowrap">
                  <button className="px-2.5 py-1 rounded-full border border-line text-[11px]" onClick={() => viewDetail(a)}>详情</button>
                  {/* 未到终态 → 可推进 / 未通过 */}
                  {!['adopted', 'rejected'].includes(a.status) && (
                    <>
                      <button className="px-2.5 py-1 rounded-full bg-success-bg text-success text-[11px]" onClick={() => flow(a, FLOW_NEXT[a.status])}>
                        {a.status === 'home_check' ? '通过→已领养' : '推进'}
                      </button>
                      <button className="px-2.5 py-1 rounded-full bg-danger-bg text-danger text-[11px]" onClick={() => flow(a, 'rejected')}>未通过</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-faint">暂无领养申请</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 详情弹窗：申请信息 + 审核备注 + 回访记录 */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="bg-card rounded-2xl p-7 w-[600px] max-w-full max-h-[86vh] overflow-auto">
            <h3 className="text-base font-semibold mb-4">领养申请 · {detail.name}</h3>
            <div className="text-[13px] text-ink-soft space-y-1.5 mb-4">
              <p>意向猫咪：{detail.cat_id ? detail.cat_name || '已指定' : '未指定'} · 状态：{FLOW_LABEL[detail.status]}</p>
              <p>城市：{detail.city} · 居住：{detail.housing}</p>
              <p>养宠经验：{detail.experience || '无'}</p>
              <p>家人意见：{detail.family_agreed || '未填'}</p>
              <p>领养理由：{detail.reason}</p>
              {detail.admin_note && <p className="text-warn">审核备注：{detail.admin_note}</p>}
              {detail.success_story && <p className="text-success">成功故事：{detail.success_story}</p>}
            </div>

            {/* 回访记录区 */}
            <h4 className="text-[13.5px] font-semibold mb-2">回访记录</h4>
            <div className="space-y-2 mb-3">
              {detail.notes?.length ? detail.notes.map((n: any, i: number) => (
                <div key={i} className="bg-bg-soft rounded-lg px-3 py-2 text-[12.5px]">
                  <b>{n.date}</b>　{n.content}
                </div>
              )) : <p className="text-[12px] text-ink-faint">暂无回访记录</p>}
            </div>
            {/* 新增回访输入（仅已领养可回访，PRD §5.6） */}
            {detail.status === 'adopted' && (
              <div className="flex gap-2">
                <input className="flex-1 px-3 py-2 rounded-lg bg-bg-soft border border-line text-[12.5px]" placeholder="输入回访内容…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                <button className="px-4 py-2 rounded-full bg-main text-white text-xs" onClick={addNote}>登记回访</button>
              </div>
            )}
            <div className="flex justify-end mt-5">
              <button className="px-4 py-2 rounded-full border border-line text-xs" onClick={() => setDetail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
