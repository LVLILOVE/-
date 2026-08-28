// ============================================================
// 代码段功能：吸顶导航组件（对齐 UIUX §3.1 / PRD §4.1）
// - 桌面端：Logo「猫屿」+ 6 导航项（猫咪/餐单/预约/领养/店长解答/关于我们）+ 立即预约 CTA
// - 滚动 >200px 切换白色毛玻璃吸顶（useEffect 监听滚动）
// - 移动端 ≤900px：汉堡菜单展开 6 项（44px 触控目标）+ 底部预约栏
// - 当前页导航项显示暖橙下划线激活态
// ============================================================
import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

// 导航项定义：路径与文字（猫咪/餐单/预约/领养/店长解答/关于我们）
const NAV_ITEMS = [
  { to: '/cats', label: '猫咪' },
  { to: '/menu', label: '餐单' },
  { to: '/reserve', label: '预约' },
  { to: '/adopt', label: '领养' },
  { to: '/qa', label: '店长解答' },
  { to: '/about', label: '关于我们' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)  // 是否滚动超过 200px
  const [menuOpen, setMenuOpen] = useState(false)   // 移动端汉堡菜单展开状态
  const location = useLocation()

  // 滚动监听：滚动 >200px 时导航切换毛玻璃背景（PRD §4.1）
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 200)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 路由变化时自动关闭移动端菜单
  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <>
      {/* 顶部导航：初始透明 → 滚动后白底毛玻璃吸顶 */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 flex items-center gap-8 px-5 md:px-10 py-3.5 transition-all duration-300 border-b ${
          scrolled
            ? 'bg-white/85 backdrop-blur-md border-line shadow-sm'
            : 'bg-transparent border-transparent'
        }`}
      >
        {/* Logo：圆形主色底「猫」+ 中文名 + 英文名 */}
        <Link to="/" className="flex items-center gap-2.5 flex-none" aria-label="猫屿首页">
          <span className="w-9 h-9 rounded-full bg-main text-white flex items-center justify-center text-base">
            猫
          </span>
          <span className="leading-tight">
            <span className="block text-[17px] font-semibold tracking-[0.3em]">猫屿</span>
            <span className="block text-[10px] tracking-[0.2em] text-ink-faint font-en">CAT ISLE</span>
          </span>
        </Link>

        {/* 桌面端导航项：4 项，激活态暖橙下划线 */}
        <nav className="hidden md:flex gap-7 text-sm" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `py-1.5 px-0.5 border-b-2 transition-colors ${
                  isActive ? 'border-accent font-medium text-ink' : 'border-transparent text-ink hover:text-main-deep'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* 右侧：桌面 CTA + 移动端汉堡按钮 */}
        <div className="ml-auto flex items-center gap-4">
          <Link to="/reserve" className="hidden md:inline-flex bg-btn text-white rounded-full px-7 py-2.5 text-sm font-medium tracking-[0.2em] hover:bg-btn-hover transition-colors">
            立即预约
          </Link>
          {/* 汉堡按钮：三横线，aria-expanded 管理展开状态（UIUX §3.1） */}
          <button
            className="md:hidden flex flex-col gap-[5px] p-2.5"
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className={`w-5 h-0.5 bg-ink rounded transition-transform ${menuOpen ? 'rotate-45 translate-y-[7px]' : ''}`} />
            <span className={`w-5 h-0.5 bg-ink rounded transition-opacity ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`w-5 h-0.5 bg-ink rounded transition-transform ${menuOpen ? '-rotate-45 -translate-y-[7px]' : ''}`} />
          </button>
        </div>
      </header>

      {/* 移动端展开菜单：全宽白底、4 项纵向、触控目标 ≥44px */}
      {menuOpen && (
        <nav className="fixed top-[60px] left-0 right-0 z-40 bg-card border-b border-line px-6 py-3 shadow-lg md:hidden" aria-label="移动端导航">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block py-3 min-h-[44px] text-[15px] border-b border-dashed border-line-soft last:border-none ${
                  isActive ? 'text-btn font-medium' : 'text-ink'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </>
  )
}
