import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// ⚠️ 样式必须在 App 之前导入（ESM 按声明顺序执行 side-effect import）：
//    `useThemeStore` 在**模块初始化**时就会读 CSS 变量注册 ECharts 主题，
//    若此时 tokens.css 尚未注入，getComputedStyle 会取到空值 → 图表色板为空。
import './theme/tokens.css';
import './styles/index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* future flags：提前采用 v7 行为，消除 v6.26 的未来版本警告 */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
