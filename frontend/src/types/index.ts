// ============================================================
// 代码段功能：前后端共享的 TypeScript 类型定义
// - 与后端接口返回结构对齐（统一响应 {code,msg,data}）
// - 业务实体类型：猫咪 / 餐单 / 预约 / 领养 / 时段等
// ============================================================

// 后端统一响应包装：code=0 表示成功，否则为错误码（见开发技术文档 §5.2）
export interface ApiResp<T = unknown> {
  code: number
  msg: string
  data: T
}

// ---- 猫咪实体 ----
export interface Cat {
  id: number
  name: string
  persona: string
  story: string
  breed?: string
  age?: string
  gender?: string
  neutered?: number
  skills?: string
  avatar_url?: string
  adoptable: number
}

// ---- 餐单实体 ----
export interface MenuItem {
  id: number
  name: string
  category: 'coffee' | 'tea' | 'dessert' | 'cat_snack'
  price: number          // 单位：元（后端已由分转换）
  desc?: string
  image_url?: string
}

// ---- 预约实体（状态机见 PRD §6.1）----
export interface Reservation {
  id: number
  reservation_no: string
  name: string
  phone: string
  reserve_date: string
  slot: string
  party_size: number
  has_child: boolean
  remark: string
  status: 'pending_payment' | 'payment_verify' | 'verify_rejected' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  deposit_amount: number   // 单位：元
  verify_reject_reason?: string
  cancel_reason?: string
}

// ---- 时段余量 ----
export interface SlotInfo {
  slot: string
  capacity: number
  remaining: number
}

export interface SlotsResp {
  date: string
  is_holiday: boolean
  slots: SlotInfo[]
}

// ---- 门店配置 ----
export interface StoreInfo {
  [key: string]: string
}

// ---- 领养申请 ----
export interface Adoption {
  id: number
  cat_id: number | null
  name: string
  phone: string
  city: string
  housing: string
  experience: string
  family_agreed: string
  reason: string
  photos: string[]
  status: 'pending' | 'interview' | 'home_check' | 'adopted' | 'rejected'
  admin_note?: string
  adopted_at?: string
  success_story?: string
  notes?: { date: string; content: string }[]
}

// ---- 领养成功案例（前台"毕业回家"墙）----
export interface AdoptedCase {
  id: number
  cat_name: string
  story: string
  photo?: string
  adopted_at?: string
}
