// ============================================================
// 代码段功能：应用路由表（对齐开发技术文档 §7.1）
// - 前台 7 页 + 后台（登录 + 布局 + 各管理模块）
// - 前台用 FrontLayout 包裹（导航/页脚/悬浮横幅/底部预约栏）
// - 后台 AdminLayout 包裹（侧边栏 + 内容区），路由守卫无 token 跳登录
// ============================================================
import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import FrontLayout from './layouts/FrontLayout'
import AdminLayout from './layouts/AdminLayout'
import { useAdminStore } from './stores/admin'

// ---- 懒加载页面组件：路由级代码分割，首屏更快 ----
const Home = lazy(() => import('./pages/Home'))
const CatList = lazy(() => import('./pages/CatList'))
const CatDetail = lazy(() => import('./pages/CatDetail'))
const MenuPage = lazy(() => import('./pages/MenuPage'))
const Reserve = lazy(() => import('./pages/Reserve'))
const Adopt = lazy(() => import('./pages/Adopt'))
const Privacy = lazy(() => import('./pages/Privacy'))

const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminCats = lazy(() => import('./pages/admin/AdminCats'))
const AdminMenu = lazy(() => import('./pages/admin/AdminMenu'))
const AdminReservations = lazy(() => import('./pages/admin/AdminReservations'))
const AdminAdoptions = lazy(() => import('./pages/admin/AdminAdoptions'))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'))
const AdminSlots = lazy(() => import('./pages/admin/AdminSlots'))

// 页面加载中的占位提示
function PageLoading() {
  return <div className="py-32 text-center text-ink-faint text-sm">页面加载中…</div>
}

export default function App() {
  // 读取管理员登录态（Zustand）
  const token = useAdminStore((s) => s.token)
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* ========== 前台（公共布局）========== */}
        <Route element={<FrontLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/cats" element={<CatList />} />
          <Route path="/cats/:id" element={<CatDetail />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/reserve" element={<Reserve />} />
          <Route path="/adopt" element={<Adopt />} />
          <Route path="/privacy" element={<Privacy />} />
        </Route>

        {/* ========== 后台 ========== */}
        {/* 登录页：已登录则直接进入后台首页 */}
        <Route path="/admin/login" element={token ? <Navigate to="/admin" replace /> : <AdminLogin />} />
        {/* 后台布局：未登录强制跳登录（路由守卫） */}
        <Route
          path="/admin"
          element={token ? <AdminLayout /> : <Navigate to="/admin/login" replace />}
        >
          <Route index element={<AdminDashboard />} />
          <Route path="cats" element={<AdminCats />} />
          <Route path="menu" element={<AdminMenu />} />
          <Route path="reservations" element={<AdminReservations />} />
          <Route path="adoptions" element={<AdminAdoptions />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="slots" element={<AdminSlots />} />
        </Route>

        {/* 兜底：未知路径回首页 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
