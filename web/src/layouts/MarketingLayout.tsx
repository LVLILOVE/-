/**
 * 模板 D · 营销页（页头 + 全宽内容区 + 全局页脚）
 * 适用：产品首页 index（UX-P01，未登录落地页）
 * -----------------------------------------------------------------------------
 * 🔒 页脚统一由 `SiteFooter` 提供（`FR-SYS-05`：免责声明全站可达且不可折叠）。
 *    不要在本布局内再写一份页脚文案——文案是单点定义的。
 */
import { Link, Outlet } from 'react-router-dom';

import Brand from '../components/Brand';
import SiteFooter from '../components/SiteFooter';
import ThemeToggle from '../components/ThemeToggle';

export default function MarketingLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="sticky top-0 z-50 flex h-[var(--header-h)] items-center gap-4 px-5"
        style={{
          background: 'color-mix(in oklab, var(--surface) 88%, transparent)',
          borderBottom: '1px solid var(--border)',
          backdropFilter: 'blur(12px) saturate(1.4)',
        }}
      >
        <Brand />
        <nav className="ml-auto flex items-center gap-3">
          <Link to="/login" className="text-[0.8125rem] no-underline" style={{ color: 'var(--text-2)' }}>
            登录
          </Link>
          <ThemeToggle />
          <Link
            to="/dashboard"
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[0.8125rem] font-semibold no-underline"
            style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
          >
            进入工作台
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  );
}
