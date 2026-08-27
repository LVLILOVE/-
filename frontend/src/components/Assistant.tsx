// ============================================================
// 代码段功能：猫屿小助手组件（右下角对话式 FAQ 助手）
// - 悬浮气泡：右下角固定，猫爪图标；点击展开/收起对话面板
// - 面板：欢迎语 + 快捷问题 chips + 自由输入（关键词匹配知识库）
// - 门店信息动态化：加载时从 /api/store 拉取，替换答案中的
//   {address} {phone} {hours} 占位符（后台「门店设置」可配）
// - 无障碍：打开自动聚焦输入框、ESC 关闭、aria 标签
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { FAQS, FALLBACK_ANSWER, QUICK_QUESTIONS, WELCOME_ANSWER } from '@/data/assistant'
import { fetchStore } from '@/api/modules'

// 消息类型：bot=小助手 / user=访客
interface Msg {
  role: 'bot' | 'user'
  text: string
}

// 猫爪 SVG 图标（UIUX 规范：图标用 SVG，不用 emoji）
function PawIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="7" cy="9" r="2.4" />
      <circle cx="12" cy="6.5" r="2.6" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M12 11.5c-3.2 0-6 2.6-6 5.6 0 1.8 1.3 3 2.9 3 1.1 0 1.8-.6 3.1-.6s2 .6 3.1.6c1.6 0 2.9-1.2 2.9-3 0-3-2.8-5.6-6-5.6z" />
    </svg>
  )
}

export default function Assistant() {
  const [open, setOpen] = useState(false)          // 面板展开状态
  const [messages, setMessages] = useState<Msg[]>([{ role: 'bot', text: WELCOME_ANSWER }])
  const [input, setInput] = useState('')           // 输入框内容
  const [store, setStore] = useState<Record<string, string>>({})  // 门店配置
  const listRef = useRef<HTMLDivElement>(null)     // 消息列表（自动滚动到底部）
  const inputRef = useRef<HTMLInputElement>(null)  // 输入框（打开时聚焦）

  // 加载门店配置（地址/电话/营业时间），用于替换答案占位符
  useEffect(() => {
    fetchStore().then((d) => setStore(d)).catch(() => {})
  }, [])

  // 打开面板时聚焦输入框
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  // 新消息时自动滚动到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // 替换答案中的门店占位符（缺失时用默认文案）
  const fill = (text: string) =>
    text
      .replaceAll('{address}', store.address || 'XX 市 XX 区 XX 路 XX 号')
      .replaceAll('{phone}', store.phone || '138-0000-0000')
      .replaceAll('{hours}', store.hours || '11:00-19:00 · 周一店休')
      .replaceAll('{name}', store.store_name || '猫屿 CAT ISLE')

  // 关键词匹配：返回命中的答案；未命中返回兜底
  const answer = (q: string): string => {
    const hit = FAQS.find((f) => f.keywords.some((k) => q.includes(k)))
    return fill(hit ? hit.answer : FALLBACK_ANSWER)
  }

  // 发送问题：追加访客消息 + 小助手回复（模拟打字延迟）
  const send = (text: string) => {
    const t = text.trim()
    if (!t) return
    setMessages((m) => [...m, { role: 'user', text: t }])
    setInput('')
    setTimeout(() => {
      setMessages((m) => [...m, { role: 'bot', text: answer(t) }])
    }, 350)
  }

  return (
    <>
      {/* ===== 悬浮气泡按钮（右下角固定）===== */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '关闭猫屿小助手' : '打开猫屿小助手'}
        aria-expanded={open}
        className="fixed right-5 bottom-20 md:right-6 md:bottom-6 z-50 w-14 h-14 rounded-full bg-main text-white shadow-[0_6px_20px_rgba(107,79,63,0.35)] hover:bg-main-deep hover:scale-105 transition-all flex items-center justify-center"
      >
        {open ? (
          // 展开时显示关闭图标（×）
          <span className="text-2xl leading-none">×</span>
        ) : (
          <PawIcon />
        )}
      </button>

      {/* ===== 对话面板 ===== */}
      {open && (
        <div className="fixed right-4 bottom-[136px] md:right-6 md:bottom-24 z-50 w-[calc(100vw-32px)] max-w-[380px] bg-card border border-line rounded-2xl shadow-[0_12px_40px_rgba(107,79,63,0.18)] flex flex-col overflow-hidden" role="dialog" aria-label="猫屿小助手">
          {/* 面板头部：标题 + 在线状态 */}
          <div className="bg-main text-white px-4 py-3 flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center"><PawIcon /></span>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-wide">猫屿小助手</p>
              <p className="text-[11px] text-white/85">解答新客疑惑 · 随时在</p>
            </div>
          </div>

          {/* 消息列表（可滚动） */}
          <div ref={listRef} className="flex-1 px-3.5 py-4 space-y-3 h-[360px] overflow-y-auto bg-bg-soft/60">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-line ${
                    m.role === 'user'
                      ? 'bg-btn text-white rounded-br-md'
                      : 'bg-card border border-line text-ink rounded-bl-md'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {/* 快捷问题 chips（仅开局展示，提问后收起） */}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {QUICK_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="px-3 py-1.5 rounded-full border border-line bg-card text-[12px] text-ink-soft hover:border-main hover:text-main-deep transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 输入区：输入框 + 发送按钮 */}
          <div className="border-t border-line p-3 flex gap-2 bg-card">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(input) }}
              placeholder="输入你的问题，如：怎么预约？"
              className="flex-1 px-3.5 py-2.5 rounded-full bg-bg-soft border border-line text-[13px] focus:outline-none focus:border-main"
              aria-label="输入问题"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="px-4 py-2 rounded-full bg-btn text-white text-[13px] hover:bg-btn-hover disabled:opacity-40 transition-colors flex-none"
            >
              发送
            </button>
          </div>
        </div>
      )}
    </>
  )
}
