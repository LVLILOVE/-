// ============================================================
// 代码段功能：后台登录页（对齐后台管理原型）
// - 用户名 + 密码登录；成功后写入 Zustand 并跳转后台首页
// - 登录失败（含锁定）提示后端返回的错误信息
// ============================================================
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminLogin } from '@/api/modules'
import { useAdminStore } from '@/stores/admin'

export default function AdminLogin() {
  const navigate = useNavigate()
  const setAuth = useAdminStore((s) => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // 登录提交：成功后写入令牌并跳转后台
  const handleLogin = async () => {
    if (!username || !password) { window.alert('请输入用户名和密码'); return }
    setLoading(true)
    try {
      const data = await adminLogin(username, password)
      setAuth(data.token, username)   // 持久化令牌（axios 拦截器后续自动附加）
      navigate('/admin')
    } catch { /* 错误已由拦截器提示（40102 等） */ }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-bg to-[#F1E6D8] px-5">
      {/* 登录卡片 */}
      <div className="bg-card border border-line rounded-2xl px-10 py-10 w-[380px] max-w-full text-center shadow-[0_12px_32px_rgba(107,79,63,0.08)]">
        <div className="w-13 h-13 mx-auto mb-3.5 w-[52px] h-[52px] rounded-full bg-main text-white flex items-center justify-center text-2xl">猫</div>
        <h1 className="text-xl tracking-[0.25em] font-semibold">猫屿 后台管理</h1>
        <p className="text-xs text-ink-faint mt-1 mb-6 font-en">CAT ISLE · ADMIN</p>

        {/* 用户名输入 */}
        <label className="block text-left text-xs font-semibold mb-1.5">用户名</label>
        <input className="w-full px-3.5 py-2.5 rounded-xl bg-bg-soft border border-line text-sm mb-4 focus:outline-none focus:border-main" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />

        {/* 密码输入 */}
        <label className="block text-left text-xs font-semibold mb-1.5">密码</label>
        <input className="w-full px-3.5 py-2.5 rounded-xl bg-bg-soft border border-line text-sm mb-6 focus:outline-none focus:border-main" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} autoComplete="current-password" />

        {/* 登录按钮 */}
        <button onClick={handleLogin} disabled={loading} className="w-full py-3 rounded-full bg-btn text-white text-sm font-medium tracking-[0.3em] hover:bg-btn-hover transition-colors disabled:opacity-50">
          {loading ? '登录中…' : '登 录'}
        </button>
        <p className="text-[11.5px] text-ink-faint mt-4">仅店主 1 个管理员账号 · 连续失败 5 次锁定 15 分钟</p>
      </div>
    </div>
  )
}
