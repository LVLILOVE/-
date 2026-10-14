/**
 * 右栏内容插槽（模板 B 专用）
 * -----------------------------------------------------------------------------
 * 问题：`AsideLayout` 是**布局**，而右栏卡片是**页面内容**（每个页面的右栏不同）。
 *       布局不该知道上传页有什么卡片，页面也不该自己再画一列 —— 否则两栏布局
 *       会在页面层被复制一遍，窄屏下 `order` 规则也会各写一份。
 *
 * 方案：布局持有插槽状态，页面通过 `useAsideContent(node)` 把自己的右栏内容送上去。
 *
 * 🔒 **两个 aside 的既有结构不变**（`AppShell` 的侧栏 + 本布局的右栏）。
 *    EP-3 的浏览器探针断言上传页 `aside === 2`，改坏会让回归失败。
 *
 * ⚠️ 调用方**必须**传入引用稳定的节点：
 *    `useAsideContent(<Foo />)` 每次渲染都会产生新的元素对象 → effect 依赖变化 →
 *    `setState` → 布局重渲染 → 页面重渲染 → 新对象 …… 无限循环。
 *    正确写法是模块级常量或 `useMemo`：
 *      const NODE = <UploadAside />;                 // 模块级（静态内容首选）
 *      useAsideContent(useMemo(() => <X a={a} />, [a]));
 */
import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';

/** 未被任何页面接管时的默认右栏（保持 EP-0 的占位观感） */
export const DEFAULT_ASIDE: ReactNode = (
  <div
    className="rounded-[var(--radius-sm)] border p-4"
    style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
  >
    <h3 className="mb-2 text-[0.9375rem]">任务信息</h3>
    <p className="text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
      右栏元信息会随当前页面变化（数据概要 / 任务信息）。
    </p>
  </div>
);

export const AsideSlotContext = createContext<((node: ReactNode) => void) | null>(null);

/**
 * 把本页的右栏内容交给 `AsideLayout`。
 * 页面卸载时自动还原为 `DEFAULT_ASIDE`，避免把上传页的卡片带到结果页。
 */
export function useAsideContent(node: ReactNode): void {
  const setAside = useContext(AsideSlotContext);

  useEffect(() => {
    setAside?.(node);
  }, [setAside, node]);

  useEffect(() => {
    return () => {
      setAside?.(DEFAULT_ASIDE);
    };
  }, [setAside]);
}
