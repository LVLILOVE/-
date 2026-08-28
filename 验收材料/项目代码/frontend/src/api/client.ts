// ============================================================
// 代码段功能：axios HTTP 客户端封装
// - baseURL 指向 /api（开发由 Vite 代理到 8000，生产由 Nginx/FastAPI 托管同源）
// - 请求拦截：自动附加管理员 JWT（Authorization: Bearer）
// - 响应拦截：统一解包 {code,msg,data}；code!==0 统一提示；401 跳转后台登录
// ============================================================
import axios from 'axios'
import type { ApiResp } from '@/types'

// 创建 axios 实例：同源 /api，跨域自动带凭据
const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// ---- 请求拦截器：附加管理员令牌（Zustand 持久化在 localStorage）----
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ---- 响应拦截器：解包统一响应结构 ----
http.interceptors.response.use(
  (resp) => {
    const body = resp.data as ApiResp
    // code=0 成功，返回 data 部分供调用方直接使用
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data as never
      // 业务错误：40101 未登录 → 清理令牌并跳后台登录；其余统一弹提示
      if (body.code === 40101) {
        localStorage.removeItem('admin_token')
        if (window.location.pathname.startsWith('/admin')) {
          window.location.href = '/admin/login'
        }
      }
      // 全局轻提示（浏览器原生，原型阶段够用；正式可替换为 toast 组件）
      window.alert(body.msg || '操作失败')
      return Promise.reject(new Error(body.msg))
    }
    return body as never
  },
  (error) => {
    // 网络/超时/HTTP 错误兜底提示
    const msg = error.response?.data?.msg || error.message || '网络异常'
    if (error.response?.status !== 401) window.alert(msg)
    return Promise.reject(error)
  },
)

export default http
