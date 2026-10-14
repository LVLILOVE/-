/**
 * =============================================================================
 * 电商销量预测系统 · 前端 API 客户端
 * -----------------------------------------------------------------------------
 * 版本     : V1.0
 * 依据文档 : 《开发技术文档 V1.0》§5.1.3（通用约定）、§7.3（错误处理约定）
 * 依赖     : axios ^1.7, ./types.ts
 * 落位建议 : src/api/client.ts + src/api/*.ts
 * -----------------------------------------------------------------------------
 * 关键约定：
 *   1. baseURL 来自 import.meta.env.VITE_API_BASE，默认 /api/v1
 *      开发期由 Vite proxy 转发到 http://127.0.0.1:8000，避免跨域。
 *   2. 响应拦截器统一拆包 ApiResponse<T>，业务代码只拿 data，
 *      不重复写 res.data.data。
 *   3. 401 统一处理：清 Token → 跳登录 → 保留当前草稿参数
 *      （开发方案 §2.2 B12「跳登录并保留草稿参数」）。
 *   4. 失败时抛出 ApiError（携带业务 code），由调用方或全局兜底决定提示。
 * =============================================================================
 */

import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ERR, type ApiResponse, type Paginated } from './types';

/** 业务错误：保留后端 code，便于按错误码分支处理 */
export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'sp_token';

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (t: string): void => localStorage.setItem(TOKEN_KEY, t),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

/** 登录失效时的回调，由路由层注入，避免 api 层依赖 router */
let onUnauthorized: (() => void) | null = null;
export function registerUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export function createClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE ?? '/api/v1',
    timeout: 90_000, // 预测任务 SLA 60s，留 30s 余量
    headers: { 'Content-Type': 'application/json' },
  });

  instance.interceptors.request.use((config) => {
    const token = tokenStore.get();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    (error: AxiosError<ApiResponse<unknown>>) => {
      // 网络层错误（无响应）
      if (!error.response) {
        const isTimeout = error.code === 'ECONNABORTED';
        throw new ApiError(
          ERR.INFER_FAIL,
          isTimeout
            ? '请求超时。若任务数据量较大，请稍后在历史记录中查看结果'
            : '无法连接服务，请确认后端已启动',
        );
      }

      const body = error.response.data;
      const code = body?.code ?? error.response.status * 100;
      const message = body?.message ?? `请求失败（HTTP ${error.response.status}）`;

      if (error.response.status === 401) {
        tokenStore.clear();
        onUnauthorized?.();
      }

      throw new ApiError(code, message, body?.data);
    },
  );

  return instance;
}

export const http = createClient();

/** 统一解包：后端永远是 {code, message, data}，HTTP 层失败已在拦截器抛出 */
async function unwrap<T>(p: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const res = await p;
  const body = res.data;
  if (body.code !== 0) {
    throw new ApiError(body.code, body.message, body.data);
  }
  return body.data;
}

/* =============================================================================
 * 认证                                                 API-01 ~ API-05
 * ========================================================================== */

export const authApi = {
  register: (req: import('./types').RegisterRequest) =>
    unwrap<import('./types').RegisterResponse>(http.post('/auth/register', req)),

  login: (req: import('./types').LoginRequest) =>
    unwrap<import('./types').LoginResponse>(http.post('/auth/login', req)),

  logout: () => unwrap<null>(http.post('/auth/logout')),

  me: () => unwrap<import('./types').UserProfile>(http.get('/users/me')),

  updateMe: (req: import('./types').UpdateUserRequest) =>
    unwrap<import('./types').UserProfile>(http.patch('/users/me', req)),
};

/* =============================================================================
 * 数据集                                               API-06 ~ API-11
 * ========================================================================== */

export const datasetApi = {
  /** 上传 CSV：走 multipart，带上传进度回调（FR-UPL-04 进度条） */
  upload: (
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<import('./types').UploadDatasetResponse> => {
    const form = new FormData();
    form.append('file', file);
    return unwrap(
      http.post('/datasets', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        },
      }),
    );
  },

  /** 一键加载示例数据：幂等，重复调用返回同一 dataset_id */
  loadSample: () =>
    unwrap<import('./types').UploadDatasetResponse>(http.get('/datasets/sample')),

  detail: (datasetId: number) =>
    unwrap<import('./types').DatasetSummary>(http.get(`/datasets/${datasetId}`)),

  preview: (datasetId: number, limit = 20) =>
    unwrap<import('./types').DatasetPreview>(
      http.get(`/datasets/${datasetId}/preview`, { params: { limit } }),
    ),

  /** 错误明细下载（FR-UPL-06）：返回 Blob，由调用方触发下载 */
  downloadErrors: async (datasetId: number): Promise<Blob> => {
    const res = await http.get(`/datasets/${datasetId}/errors`, {
      responseType: 'blob',
    });
    return res.data as Blob;
  },

  /** 标准模板下载（FR-UPL-08） */
  downloadTemplate: async (): Promise<Blob> => {
    const res = await http.get('/datasets/template', { responseType: 'blob' });
    return res.data as Blob;
  },

  /** 断档处置（FR-UPL-13）：必须由用户显式选择后才继续 */
  resolveGap: (req: import('./types').ResolveGapRequest) =>
    unwrap<import('./types').UploadDatasetResponse>(http.post('/datasets/gap', req)),
};

/* =============================================================================
 * 预测任务                                             API-12 ~ API-15
 * ========================================================================== */

export const predictApi = {
  create: (req: import('./types').CreateTaskRequest) =>
    unwrap<import('./types').CreateTaskResponse>(http.post('/predictions', req)),

  status: (taskId: number) =>
    unwrap<import('./types').TaskStatusResponse>(
      http.get(`/predictions/${taskId}/status`),
    ),

  result: (taskId: number) =>
    unwrap<import('./types').PredictionResultResponse>(
      http.get(`/predictions/${taskId}`),
    ),

  /** 明细表分页（结果页表格用，避免单响应过大） */
  detail: (taskId: number, query: import('./types').PredictionDetailQuery = {}) =>
    unwrap<Paginated<import('./types').PredictionRow>>(
      http.get(`/predictions/${taskId}/detail`, { params: query }),
    ),

  /** 导出：format 为 csv 或 xlsx（FR-VIS-05） */
  export: async (taskId: number, format: 'csv' | 'xlsx' = 'csv'): Promise<Blob> => {
    const res = await http.get(`/predictions/${taskId}/export`, {
      params: { format },
      responseType: 'blob',
    });
    return res.data as Blob;
  },
};

/* =============================================================================
 * 历史与对比                                           API-16 ~ API-19
 * ========================================================================== */

export const historyApi = {
  list: (query: import('./types').HistoryQuery = {}) =>
    unwrap<Paginated<import('./types').HistoryItem>>(
      http.get('/history', { params: query }),
    ),

  detail: (taskId: number) =>
    unwrap<import('./types').PredictionResultResponse>(http.get(`/history/${taskId}`)),

  compare: (req: import('./types').CompareRequest) =>
    unwrap<import('./types').CompareResponse>(http.post('/history/compare', req)),

  /** 软删除（FR-HIS-05），需二次确认后调用 */
  remove: (taskId: number) => unwrap<null>(http.delete(`/history/${taskId}`)),
};

/* =============================================================================
 * 系统                                                 API-20
 * ========================================================================== */

export const systemApi = {
  health: () => unwrap<import('./types').HealthResponse>(http.get('/health')),
};

/* =============================================================================
 * 工具：触发浏览器下载（导出与模板共用）
 * ========================================================================== */

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 结果导出统一文件名：预测结果_{taskId}_{YYYYMMDD}.csv */
export function exportFilename(taskId: number, ext: 'csv' | 'xlsx'): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  return `预测结果_${taskId}_${stamp}.${ext}`;
}
