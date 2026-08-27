// ============================================================
// 代码段功能：后台管理布局（对齐后台管理原型）
// - 左侧边栏 7 个管理模块 + 顶部栏（标题 + 管理员信息 + 退出）
// - 移动端：侧边栏收窄为图标；内容区渲染当前模块
// ============================================================
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAdminStore } from '@/stores/admin'

// 侧边栏菜单：路径 + 图标字符（原型阶段用字符，正式可换 Lucide SVG）
const MENU = [
  { to: '/admin', label: '仪表盘', icon: '▦', end: true },
  { to: '/admin/cats', label: '猫咪管理', icon: '🐾' },
  { to: '/admin/menu', label: '餐单管理', icon: '☕' },
  { to: '/admin/reservations', label: '预约管理', icon: '📅' },
  { to: '/admin/adoptions', label: '领养管理', icon: '❤' },
  { to: '/admin/settings', label: '门店设置', icon: '⚙' },
  { to: '/admin/slots', label: '时段设置', icon: '🕐' },
]

export default function AdminLayout() {
  const { username, logout } = useAdminStore()
  const navigate = useNavigate()

  // 退出登录：清令牌 → 跳转登录页
  const handleLogout = () => {
    logout()
    navigate('/admin/login')
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* 侧边栏：桌面 220px；移动端 64px 图标栏 */}
      <aside className="w-16 md:w-56 flex-none bg-[#F1E8DA] border-r border-line py-5 px-2 md:px-3.5 flex flex-col">
        {/* 后台 Logo */}
        <div className="flex items-center gap-2.5 px-2 pb-4 border-b border-line mb-3">
          <span className="w-8 h-8 rounded-full bg-main text-white flex items-center justify-center text-sm flex-none">猫</span>
          <div className="hidden md:block leading-tight">
            <b className="text-[15px] tracking-[0.15em]">猫屿 后台</b>
            <small className="block text-[10px] text-ink-faint tracking-wider">CAT ISLE ADMIN</small>
          </div>
        </div>
        {/* 菜单项：激活态白底+橙字 */}
        <nav className="space-y-1">
          {MENU.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 md:px-3.5 py-2.5 rounded-lg text-[13.5px] transition-colors ${
                  isActive ? 'bg-card text-btn font-semibold border border-line' : 'text-ink-soft hover:bg-white/70 hover:text-ink'
                }`
              }
            >
              <span className="text-sm w-4 text-center">{m.icon}</span>
              <span className="hidden md:inline">{m.label}</span>
            </NavLink>
          ))}
        </nav>
        {/* 底部：返回前台 + 退出 */}
        <div className="mt-auto pt-4 border-t border-line space-y-1">
          <NavLink to="/" className="block px-2.5 md:px-3.5 py-2.5 rounded-lg text-[13.5px] text-main-deep hover:bg-white/70">
            <span className="hidden md:inline">↩ 返回前台</span>
            <span className="md:hidden">↩</span>
          </NavLink>
          <button onClick={handleLogout} className="w-full text-left px-2.5 md:px-3.5 py-2.5 rounded-lg text-[13.5px] text-ink-soft hover:bg-white/70">
            <span className="hidden md:inline">退出登录</span>
            <span className="md:hidden">⏻</span>
          </button>
        </div>
      </aside>

      {/* 右侧：顶栏 + 内容 */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 顶部栏：当前模块标题占位（页面内各自渲染）+ 管理员信息 */}
        <header className="bg-white/90 backdrop-blur border-b border-line px-5 md:px-7 py-3.5 flex items-center gap-4">
          <h2 className="text-[17px] tracking-[0.1em]">猫屿 后台管理</h2>
          <div className="ml-auto flex items-center gap-2 text-[13px] text-ink-soft">
            <span className="w-7 h-7 rounded-full bg-main text-white flex items-center justify-center text-xs">店</span>
            <span>{username || '店主'}</span>
          </div>
        </header>
        {/* 内容区：渲染各管理模块页面 */}
        <main className="flex-1 p-5 md:p-7">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
