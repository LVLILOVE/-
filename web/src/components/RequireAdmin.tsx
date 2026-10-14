/**
 * 路由守卫：管理端权限校验（`CH-01` / `WS-8-12`）
 * -----------------------------------------------------------------------------
 * 🔒 **前端隐藏 ≠ 安全**。本守卫只负责「不把不该看的入口摆出来」，
 *    真正的安全边界在后端 `get_current_admin`（`BE-ADM-01`）：
 *    非管理员直接调 `/api/v1/admin/*` 一律 `40301`。
 *    写手工请求绕过守卫是可行的 —— 那正好说明后端那道防线是必要的。
 *
 * 三条分支（顺序与 `RequireAuth` 同理，不可调换）：
 *   1. `status !== 'ready'` → 登录态还没校验完，先占位。
 *      ⚠️ 这一支不能省：刷新页面时 store 初始值是「未登录」，
 *      少了它会在 `fetchMe` 返回前就把管理员踢去登录页。
 *   2. 未登录 → 跳 `/login`（由外层 `RequireAuth` 兜住，本守卫仍要兜一层，
 *      因为两页会被单独引用）。
 *   3. 已登录但 `role !== 'admin'` → **跳 403 页而不是空白页**。
 *      🔒 给「你不是管理员」一个明确落点很重要：空白页会被读成
 *      「系统坏了」，而 403 页告诉用户「这个功能需要管理员权限，
 *      请联系管理员开通」—— 这是两件完全不同的事。
 */
import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthStore } from '../store/useAuthStore';

export default function RequireAdmin({ children }: { children?: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const location = useLocation();

  if (status !== 'ready') {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-[0.8125rem]"
        style={{ background: 'var(--bg)', color: 'var(--text-3)' }}
        role="status"
        aria-live="polite"
      >
        正在校验管理员权限…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!isAdmin) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: 'var(--bg)', color: 'var(--text-2)' }}
        data-testid="admin-forbidden"
      >
        <h1 className="text-[1.25rem] font-semibold" style={{ color: 'var(--text-1)' }}>
          无管理端访问权限
        </h1>
        <p className="max-w-[36rem] text-[0.8125rem]" style={{ color: 'var(--text-3)' }}>
          管理后台仅对<b style={{ color: 'var(--text-2)' }}>管理员角色</b>开放。
          若你确实需要使用，请联系系统管理员为你的账号开通权限。
        </p>
        <p className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
          若你确信自己已是管理员，可能是登录状态已过期，请重新登录后再试。
        </p>
        <Link
          to="/dashboard"
          className="mt-2 rounded-[var(--radius-md)] px-4 py-2 text-[0.8125rem] no-underline"
          style={{ background: 'var(--primary)', color: 'var(--primary-fg)' }}
        >
          返回工作台
        </Link>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}
