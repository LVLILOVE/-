// ============================================================
// 代码段功能：Vite 构建配置
// - 启用 React 与 Tailwind v4 插件
// - 开发服务器代理：/api 与 /uploads 转发到 FastAPI 后端(8000)
// - 路径别名 @ 指向 src（便于模块引用）
// ============================================================
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // 路径别名：import 时用 @/components/xxx 引用 src/components/xxx
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    // 开发代理：前端 5173 → 后端 8000，避免跨域并保持接口路径一致
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // 产物目录名保持简洁，方便后端 static 托管时复制
    emptyOutDir: true,
  },
})
