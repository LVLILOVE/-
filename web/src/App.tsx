import { ConfigProvider } from 'antd';
import { useEffect } from 'react';
import { useRoutes } from 'react-router-dom';

import { registerUnauthorizedHandler } from './api/client';
import ErrorBoundary from './components/ErrorBoundary';
import { router } from './router';
import { useAuthStore } from './store/useAuthStore';
import { useThemeStore } from './store/useThemeStore';
import { buildAntdTheme } from './theme/antd-token';

export default function App() {
  const isDark = useThemeStore((s) => s.isDark);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    // 1) 把「Token 失效」的回调注入 axios 拦截器。
    //    放在这里而不是 client.ts 内部，是为了让 api 层不依赖 store / router
    //    （依赖方向：store → api，不能反过来，否则形成循环依赖）。
    registerUnauthorizedHandler(() => {
      useAuthStore.getState().clear();
    });

    // 2) 应用挂载时校验一次登录态（API-04）。
    //    刷新页面后 Token 还在 localStorage 里，但内存 store 是空的，
    //    必须回一次后端才能确认它是否仍然有效（可能已过期 / 已改密 / 已登出）。
    void bootstrap();
  }, [bootstrap]);

  return (
    <ConfigProvider theme={buildAntdTheme(isDark)}>
      {/* 全局错误边界（WS-3-04）：任何页面渲染异常都不白屏 */}
      <ErrorBoundary>{useRoutes(router)}</ErrorBoundary>
    </ConfigProvider>
  );
}
