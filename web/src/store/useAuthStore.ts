/**
 * 认证状态（useAuthStore）
 * -----------------------------------------------------------------------------
 * EP-2 落地：用户信息 / Token / isAdmin 派生 / 登录登出 / 刷新恢复登录态。
 *
 * 设计要点
 * -----------------------------------------------------------------------------
 * 1. **Token 只存一处**：`tokenStore`（`api/client.ts`）负责 localStorage 读写，
 *    本 store 只镜像一份到内存供 React 订阅。否则会出现
 *    「拦截器清空了 localStorage、store 里还留着 token」的双写不同步。
 *
 * 2. **`isAdmin` 是派生值不是状态**（WS-2-08）：从 `user.role` 算出来，
 *    不单独 set。避免「改了 user 忘了改 isAdmin」的不一致。
 *
 * 3. **`status` 区分 idle / loading / ready**：路由守卫必须能区分
 *    「还没校验完」与「校验完确认未登录」。若只有布尔值，刷新页面瞬间
 *    会误判为未登录并把用户踢到登录页（表现为「刷新就掉登录」）。
 *
 * 4. **Token 失效统一由 client 拦截器触发 `onUnauthorized`**，本 store
 *    提供 `clear()` 供其调用，不反向依赖 router。
 */
import { create } from 'zustand';

import { authApi, tokenStore } from '../api/client';
import type { LoginRequest, RegisterRequest, UserProfile } from '../types';

/** 引导（bootstrap）阶段：页面刷新后是否已确认过登录态 */
export type AuthStatus = 'idle' | 'loading' | 'ready';

type AuthState = {
  user: UserProfile | null;
  token: string | null;
  status: AuthStatus;
  /** 派生：是否管理员（决定管理端导航可见性） */
  isAdmin: boolean;
  isAuthenticated: boolean;

  /** 写入会话（登录成功后调用） */
  setSession: (token: string, user: UserProfile) => void;
  /** 仅更新用户信息（改昵称后） */
  setUser: (user: UserProfile | null) => void;
  /** 清空会话（登出 / Token 失效） */
  clear: () => void;

  login: (req: LoginRequest) => Promise<UserProfile>;
  register: (req: RegisterRequest) => Promise<UserProfile>;
  fetchMe: () => Promise<UserProfile | null>;
  logout: () => Promise<void>;
  /** 应用挂载时调用一次：有 Token 则校验并恢复用户信息 */
  bootstrap: () => Promise<void>;
};

function derived(user: UserProfile | null) {
  return {
    user,
    isAdmin: user?.role === 'admin',
    isAuthenticated: user !== null,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: tokenStore.get(),
  status: 'idle',
  isAdmin: false,
  isAuthenticated: false,

  setSession: (token, user) => {
    tokenStore.set(token);
    set({ token, status: 'ready', ...derived(user) });
  },

  setUser: (user) => set({ ...derived(user) }),

  clear: () => {
    tokenStore.clear();
    set({ token: null, status: 'ready', ...derived(null) });
  },

  login: async (req) => {
    const res = await authApi.login(req);
    get().setSession(res.access_token, res.user);
    return res.user;
  },

  register: async (req) => {
    await authApi.register(req);
    // UX-P03-07：注册后**自动登录**，直接进工作台。
    // 复用 login 而不是让用户再输一次密码；密码此刻还在表单内存里。
    return get().login({ email: req.email, password: req.password });
  },

  fetchMe: async () => {
    if (!tokenStore.get()) {
      set({ status: 'ready', ...derived(null) });
      return null;
    }
    try {
      const user = await authApi.me();
      set({ status: 'ready', token: tokenStore.get(), ...derived(user) });
      return user;
    } catch {
      // 40101 / 40102 或网络异常：一律按「未登录」处理。
      // 拦截器已负责清 Token，这里同步 store 状态即可。
      set({ token: null, status: 'ready', ...derived(null) });
      return null;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // 登出接口失败（Token 已过期等）不应阻塞用户离开：
      // 本地清干净即可，服务端那份会随过期时间自然失效。
    } finally {
      get().clear();
    }
  },

  bootstrap: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading' });
    await get().fetchMe();
  },
}));
