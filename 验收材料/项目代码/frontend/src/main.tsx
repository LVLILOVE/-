// ============================================================
// 代码段功能：前端应用入口
// - 引入全局样式
// - 挂载 React 应用，外层包 BrowserRouter 提供路由能力
// - 通过 StrictMode 启用 React 严格模式（开发期暴露潜在问题）
// ============================================================
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'

// 找到根节点并挂载 React 应用
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
