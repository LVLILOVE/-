/**
 * 模板 A · 应用页（页头 + 侧栏 + 主内容 main-wide + 页脚）
 * 适用：工作台 / 参数 / 执行 / 结果 / 历史等（UX-P04~P11）
 */
import { Outlet } from 'react-router-dom';

import AppShell from './AppShell';

export default function AppLayout() {
  return (
    <AppShell>
      <main className="mx-auto max-w-[var(--maxw)] p-6">
        <Outlet />
      </main>
    </AppShell>
  );
}
