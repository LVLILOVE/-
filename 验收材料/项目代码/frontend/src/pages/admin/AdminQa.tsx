// ============================================================
// 代码段功能：后台问答管理（店长解答 /admin/qa）
// - Tab 筛选：全部 / 待解答 / 已解答
// - 列表：问题 / 提问人(含手机号，供回访) / 状态徽章 / 操作
// - 操作：解答（弹窗填答案，保存后前台立即公开）/ 删除
// ============================================================
import { useEffect, useState } from 'react'
import { adminQaList, adminQaAnswer, adminQaDelete } from '@/api/modules'

export default function AdminQa() {
  const [rows, setRows] = useState<any[]>([])
  const [tab, setTab] = useState('')            // '' 全部 / pending / answered
  const [answering, setAnswering] = useState<any>(null)  // 当前解答对象
  const [answerText, setAnswerText] = useState('')

  // 按筛选加载问答列表
  const load = (t = tab) => {
    adminQaList(t).then(setRows).catch(() => setRows([]))
  }
  useEffect(() => { load() }, [])

  // 保存解答：前台列表同步公开
  const saveAnswer = async () => {
    if (!answering || answerText.trim().length < 2) { window.alert('请填写解答内容（至少 2 个字）'); return }
    await adminQaAnswer(answering.id, answerText.trim()).catch(() => {})
    setAnswering(null)
    setAnswerText('')
    load()
  }

  // 删除问题（前台同步消失）
  const handleDelete = (x: any) => {
    if (!window.confirm('确认删除该问题？前台将同步消失。')) return
    adminQaDelete(x.id).then(() => load())
  }

  return (
    <div>
      {/* Tab 筛选 */}
      <div className="flex gap-2.5 mb-5">
        {[['', '全部'], ['pending', '待解答'], ['answered', '已解答']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); load(key) }}
            className={`px-4 py-1.5 rounded-full text-[13px] border transition-colors ${
              tab === key ? 'bg-main border-main text-white' : 'bg-card border-line text-ink-soft'
            }`}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-card border border-line rounded-xl overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-soft text-main-deep">
              <th className="text-left px-4 py-2.5 font-semibold w-1/2">问题</th>
              <th className="text-left px-4 py-2.5 font-semibold">提问人</th>
              <th className="text-left px-4 py-2.5 font-semibold">状态</th>
              <th className="text-left px-4 py-2.5 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className="border-t border-line-soft hover:bg-bg-soft">
                <td className="px-4 py-3">
                  <p className="leading-relaxed">{x.question}</p>
                  {/* 已解答时预览答案前 40 字 */}
                  {x.status === 'answered' && (
                    <p className="text-[12px] text-ink-faint mt-1 truncate max-w-[360px]">
                      答：{x.answer}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {x.nickname}<br />
                  <span className="text-[11px] text-ink-faint">{x.phone || '未留手机号'}</span>
                </td>
                {/* 状态徽章：待解答琥珀 / 已解答绿 */}
                <td className="px-4 py-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] ${x.status === 'answered' ? 'bg-success-bg text-success' : 'bg-warn-bg text-warn'}`}>
                    {x.status === 'answered' ? '已解答' : '待解答'}
                  </span>
                </td>
                <td className="px-4 py-3 space-x-1.5 whitespace-nowrap">
                  {x.status === 'pending' ? (
                    <button className="px-2.5 py-1 rounded-full bg-success-bg text-success text-[11px]" onClick={() => { setAnswering(x); setAnswerText('') }}>解答</button>
                  ) : (
                    <button className="px-2.5 py-1 rounded-full border border-line text-[11px]" onClick={() => { setAnswering(x); setAnswerText(x.answer || '') }}>修改解答</button>
                  )}
                  <button className="px-2.5 py-1 rounded-full border border-danger/30 text-danger text-[11px]" onClick={() => handleDelete(x)}>删除</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-faint">暂无问答记录</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 解答弹窗 */}
      {answering && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setAnswering(null)}>
          <div className="bg-card rounded-2xl p-7 w-[560px] max-w-full">
            <h3 className="text-base font-semibold mb-1">{answering.status === 'pending' ? '解答问题' : '修改解答'}</h3>
            {/* 原问题只读展示 */}
            <div className="bg-bg-soft rounded-lg px-4 py-3 mb-4 text-[13px] leading-relaxed">
              <b>{answering.nickname}：</b>{answering.question}
            </div>
            <label className="text-xs font-semibold">解答内容（保存后前台立即公开）</label>
            <textarea
              className="mt-1 w-full px-3 py-2.5 rounded-lg bg-bg-soft border border-line text-[13px]"
              rows={5}
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              placeholder="如：可以的，提前在官网预约即可～"
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-5">
              <button className="px-4 py-2 rounded-full border border-line text-xs" onClick={() => setAnswering(null)}>取消</button>
              <button className="px-5 py-2 rounded-full bg-btn text-white text-xs" onClick={saveAnswer}>发布解答</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
