/**
 * Vite 配置（依据技术文档 §2.7 端口与进程约定：前端 5173，proxy /api → 8000）
 * =============================================================================
 * 🔴 后端地址**不写死**：`VITE_API_TARGET` 覆盖，缺省仍是 8000。
 *
 *    写死的真实代价：`EP-4`/`EP-5` 的浏览器走查必须用**独立临时库**起后端
 *    （`DB_PATH=data/tmp/ep5_browser/app.db`），端口自然不能是 8000；
 *    代理写死 8000 时，前端能开、页面也能渲染，但**每个接口都 502/连不上** ——
 *    排查起来非常浪费时间（表现为「页面空着但控制台说网络错误」，
 *    而后端日志里一条请求都没有）。
 *
 *    例：
 *      VITE_API_TARGET=http://127.0.0.1:8010 npx vite --port 5180
 *
 * ⚠️ 前端**不读** `import.meta.env.VITE_*` 里的后端地址 ——
 *    地址只存在于 dev server 的代理层，浏览器永远只看到同源的 `/api`。
 *    这样也顺带避免了「前端打包产物里泄漏内网地址」。
 * =============================================================================
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/health': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});