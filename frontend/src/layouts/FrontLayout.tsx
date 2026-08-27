// ============================================================
// 代码段功能：前台公共布局
// - 包裹前台 7 个页面：吸顶导航 + 内容 + 页脚 + 悬浮横幅 + 移动端底部预约栏
// - 猫屿小助手：右下角悬浮，解答新客疑惑（所有前台页面可见）
// - Outlet 渲染当前路由对应的页面
// ============================================================
import { Outlet } from 'react-router-dom'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import FloatingBanner from '@/components/FloatingBanner'
import MobileBottomBar from '@/components/MobileBottomBar'
import Assistant from '@/components/Assistant'

export default function FrontLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* 吸顶导航：固定定位 */}
      <Navbar />
      {/* 主内容区：padding-top 避开固定导航高度 */}
      <main className="flex-1 pt-0">
        <Outlet />
      </main>
      {/* 页脚 */}
      <Footer />
      {/* 桌面端右侧悬浮横幅 */}
      <FloatingBanner />
      {/* 猫屿小助手：右下角对话式 FAQ（移动端避开底部预约栏） */}
      <Assistant />
      {/* 移动端底部预约栏（页面底部留白防止遮挡） */}
      <div className="md:hidden h-16" aria-hidden="true" />
      <MobileBottomBar />
    </div>
  )
}
