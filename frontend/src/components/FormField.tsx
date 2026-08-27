// ============================================================
// 代码段功能：表单字段组件（对齐 UIUX §3.4 表单规范）
// - label 关联 input（无障碍）；必填项显示 * 标记
// - 错误状态：红棕描边 + 错误文案（aria-describedby 关联）
// - 支持 tel/date/text/textarea/select 类型
// ============================================================
import { useId } from 'react'
import type { ReactNode } from 'react'

interface FormFieldProps {
  label: string
  required?: boolean
  error?: string
  children: ReactNode  // 实际输入控件（input/select/textarea）
}

export default function FormField({ label, required, error, children }: FormFieldProps) {
  // 生成唯一 id，用于 label 与输入控件关联（无障碍）
  const id = useId()
  return (
    <div className="mb-4">
      {/* 字段标签：必填项显示红棕 * 号 */}
      <label htmlFor={id} className="block text-xs font-semibold mb-1.5">
        {label}
        {required && <span className="text-btn ml-0.5">*</span>}
      </label>
      {/* 输入控件包裹：错误时加红棕边框类（由子元素继承 id） */}
      <div className={error ? '[&_input]:border-danger [&_select]:border-danger [&_textarea]:border-danger' : ''}>
        {children}
      </div>
      {/* 错误文案：aria-describedby 关联输入框，红色提示 */}
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger mt-1">
          {error}
        </p>
      )}
    </div>
  )
}

// 导出基础输入框样式（供各页面复用，保证全站一致）
export const inputCls =
  'w-full px-3 py-2.5 text-[13px] bg-bg-soft border border-line rounded-lg focus:outline-none focus:border-main transition-colors'
