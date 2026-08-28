// ============================================================
// 代码段功能：后台管理员登录状态管理（Zustand）
// - 仅后台需要登录（前台免注册，PRD §2）
// - token 持久化到 localStorage；提供 login/logout 动作
// ============================================================
import { create } from 'zustand'

// 从 localStorage 读取初始令牌（刷新页面后保持登录态）
const initialToken = localStorage.getItem('admin_token') || ''

interface AdminState {
  token: string
  username: string
  setAuth: (token: string, username: string) => void   // 登录成功后写入
  logout: () => void                                     // 退出：清除令牌
}

export const useAdminStore = create<AdminState>((set) => ({
  token: initialToken,
  username: localStorage.getItem('admin_username') || '',

  // 登录成功：保存令牌与用户名，并持久化到 localStorage
  setAuth: (token, username) => {
    localStorage.setItem('admin_token', token)
    localStorage.setItem('admin_username', username)
    set({ token, username })
  },

  // 退出登录：清除本地存储与内存状态
  logout: () => {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_username')
    set({ token: '', username: '' })
  },
}))
