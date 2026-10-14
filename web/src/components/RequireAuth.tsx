/**
 * 路由守卫：受保护路由的登录校验（WS-2-08）
 * -----------------------------------------------------------------------------
 * 三条分支，顺序不可调换：
 *   1. `status !== 'ready'` → 还在校验登录态，先显示占位
 *      ⚠️ 这一支不能省。若直接判 `isAuthenticated`，刷新页面时会先得到
 *      `false`（store 初始值），守卫会在 `fetchMe` 返回之前就把用户踢到
 *      `/login`，表现为「每次刷新都掉登录」。
 *   2. 未登录 → 跳 `/login`，并把原路径放进 `state.from`，登录后回到原处
 *      （开发方案 B12「跳登录并保留草稿参数」的简化版）。
 *   3. 已登录 → 渲染受保护内容。
 */
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthStore } from '../store/useAuthStore';

export default function RequireAuth({ children }: { children?: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (status !== 'ready') {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-[0.8125rem]"
        style={{ background: 'var(--bg)', color: 'var(--text-3)' }}
        role="status"
        aria-live="polite"
      >
        正在校验登录状态…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children ?? <Outlet />}</>;
}
