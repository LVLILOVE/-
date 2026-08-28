// ============================================================
// 代码段功能：通用按钮组件（对齐 UIUX §3.2 按钮规范）
// - variant: primary 主按钮(#A94A26) / ghost 次按钮(描边)
// - size: sm / md；支持禁用态与点击事件
// ============================================================
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
  size?: 'sm' | 'md'
  children: ReactNode
}

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  // 尺寸样式映射：小号与大号
  const sizeCls = size === 'sm' ? 'px-4 py-1.5 text-xs' : 'px-7 py-2.5 text-sm'
  // 变体样式映射：主按钮深橘底白字；次按钮透明底描边
  const variantCls =
    variant === 'primary'
      ? 'bg-btn text-white hover:bg-btn-hover active:translate-y-px'
      : 'bg-transparent text-btn border border-btn hover:bg-btn/10'
  return (
    <button
      className={`inline-flex items-center justify-center rounded-full font-medium tracking-wide transition-all duration-200 ${sizeCls} ${variantCls} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  )
}
