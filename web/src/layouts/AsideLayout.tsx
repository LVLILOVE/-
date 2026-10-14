/**
 * 模板 B · 主内容 + 右栏（A + with-aside）
 * 左主内容 + 右 300px 元信息栏；≤1100px 时右栏下移并前置（UX-IA-04，order:-1）。
 * 适用：上传 / 参数 / 结果 / 历史详情（UX-P05/P06/P07/P08）
 *
 * 🔒 右栏内容是**页面提供**的：布局只负责位置与窄屏次序，具体卡片由页面通过
 *    `useAsideContent()` 注入（见 `aside-slot.tsx`）。既有的两个 `aside`
 *    （`AppShell` 的导航侧栏 + 本布局的元信息栏）结构保持不变。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

import AppShell from './AppShell';
import { AsideSlotContext, DEFAULT_ASIDE } from './aside-slot';

export default function AsideLayout() {
  const [asideContent, setAsideContent] = useState<ReactNode>(DEFAULT_ASIDE);

  return (
    <AppShell>
      <AsideSlotContext.Provider value={setAsideContent}>
        <main className="mx-auto flex max-w-[var(--maxw)] items-start gap-6 p-6 max-[1100px]:flex-col">
          <section className="min-w-0 flex-1">
            <Outlet />
          </section>
          <aside
            data-testid="aside-meta"
            aria-label="页面辅助信息"
            className="w-[300px] flex-none max-[1100px]:order-first max-[1100px]:w-full"
          >
            {asideContent}
          </aside>
        </main>
      </AsideSlotContext.Provider>
    </AppShell>
  );
}
