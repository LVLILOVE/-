// ============================================================
// 代码段功能：业务 API 模块（对齐开发技术文档 §6 接口清单）
// - 每个函数对应一个后端接口，返回解包后的 data
// - 前台公开接口：猫咪/餐单/时段/预约/领养/门店/案例/上传
// - 后台管理接口：登录/管理 CRUD（调用方需已登录持有 JWT）
// ============================================================
import http from './client'
import type {
  Cat, MenuItem, Reservation, StoreInfo,
  Adoption, AdoptedCase, SlotsResp,
} from '@/types'

// ==================== 前台公开接口 ====================

// 猫咪列表：adoptable=1 仅返回可领养
export const fetchCats = (adoptable = 0) =>
  http.get<unknown, Cat[]>('/cats', { params: { adoptable } })

// 猫咪详情
export const fetchCat = (id: number) =>
  http.get<unknown, Cat>(`/cats/${id}`)

// 餐单列表（仅上架）
export const fetchMenu = () =>
  http.get<unknown, MenuItem[]>('/menu')

// 某日各时段余量（周一店休时 is_holiday=true）
export const fetchSlots = (date: string) =>
  http.get<unknown, SlotsResp>('/slots', { params: { date } })

// 门店信息（key-value）
export const fetchStore = () =>
  http.get<unknown, StoreInfo>('/store')

// 领养成功案例墙
export const fetchAdoptedCases = () =>
  http.get<unknown, AdoptedCase[]>('/adopted-cats')

// 提交预约（校验通过返回预约单与押金信息）
export const createReservation = (data: {
  name: string; phone: string; reserve_date: string; slot: string;
  party_size: number; has_child: boolean; remark?: string
}) => http.post<unknown, Reservation>('/reservations', data)

// 提交押金支付凭证
export const submitPaymentProof = (rid: number, data: { phone: string; trans_no?: string; nickname: string }) =>
  http.post<unknown, Reservation>(`/reservations/${rid}/payment-proof`, data)

// 查询预约状态
export const queryReservationStatus = (rid: number, phone: string) =>
  http.get<unknown, Reservation>('/reservations/status', { params: { id: rid, phone } })

// 顾客自助取消预约
export const cancelReservation = (rid: number, phone: string) =>
  http.post<unknown, Reservation>(`/reservations/${rid}/cancel`, { phone })

// 提交领养申请
export const createAdoption = (data: Partial<Adoption>) =>
  http.post<unknown, { id: number; status: string }>('/adoptions', data)

// 上传图片（领养环境照片，公开接口）
export const uploadPhoto = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return http.post<unknown, { url: string }>('/upload', fd)
}

// ==================== 后台管理接口 ====================

// 管理员登录：返回 JWT
export const adminLogin = (username: string, password: string) =>
  http.post<unknown, { token: string; expires_in: number }>('/admin/auth/login', { username, password })

// 当前管理员信息
export const fetchMe = () => http.get<unknown, { username: string }>('/admin/auth/me')

// 后台：猫咪管理（列表/新建/编辑/软删除）
export const adminCats = () => http.get<unknown, any[]>('/admin/cats')
export const adminCreateCat = (data: any) => http.post<unknown, { id: number }>('/admin/cats', data)
export const adminUpdateCat = (id: number, data: any) => http.put<unknown, { id: number }>(`/admin/cats/${id}`, data)
export const adminDeleteCat = (id: number) => http.delete<unknown, null>(`/admin/cats/${id}`)

// 后台：餐单管理
export const adminMenu = () => http.get<unknown, any[]>('/admin/menu')
export const adminCreateMenuItem = (data: any) => http.post<unknown, { id: number }>('/admin/menu', data)
export const adminUpdateMenuItem = (id: number, data: any) => http.put<unknown, { id: number }>(`/admin/menu/${id}`, data)
export const adminDeleteMenuItem = (id: number) => http.delete<unknown, null>(`/admin/menu/${id}`)

// 后台：预约管理（列表/押金核验/状态操作/余量总览）
export const adminReservations = (params: { date?: string; status?: string; phone?: string } = {}) =>
  http.get<unknown, any[]>('/admin/reservations', { params })
export const adminVerifyPayment = (rid: number, result: 'pass' | 'reject', reason = '') =>
  http.put<unknown, any>(`/admin/reservations/${rid}/verify-payment`, { result, reason })
export const adminReservationAction = (rid: number, action: string, reason = '') =>
  http.put<unknown, any>(`/admin/reservations/${rid}`, { action, reason })
export const adminReservationOverview = (date: string) =>
  http.get<unknown, any>(`/admin/reservations/overview?date=${date}`)

// 后台：领养管理（列表/详情/流转/回访）
export const adminAdoptions = (status = '') =>
  http.get<unknown, any[]>('/admin/adoptions', { params: { status } })
export const adminAdoptionDetail = (aid: number) =>
  http.get<unknown, any>(`/admin/adoptions/${aid}`)
export const adminAdoptionFlow = (aid: number, data: any) =>
  http.put<unknown, any>(`/admin/adoptions/${aid}`, data)
export const adminAddAdoptionNote = (aid: number, data: { note_date: string; content: string }) =>
  http.post<unknown, { id: number }>(`/admin/adoptions/${aid}/notes`, data)

// 后台：配置（门店/时段）与统计
export const adminSettings = () => http.get<unknown, StoreInfo>('/admin/settings')
export const adminSaveSettings = (data: StoreInfo) => http.put<unknown, null>('/admin/settings', data)
export const adminSlots = () => http.get<unknown, any[]>('/admin/slot-settings')
export const adminSaveSlots = (data: any) => http.put<unknown, null>('/admin/slot-settings', data)
export const adminStats = () => http.get<unknown, any>('/admin/stats')

// 后台：上传（猫咪/菜品/收款码）
export const adminUpload = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return http.post<unknown, { url: string }>('/admin/upload', fd)
}
