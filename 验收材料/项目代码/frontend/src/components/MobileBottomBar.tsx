// ============================================================
// 代码段功能：移动端底部固定预约栏（对齐 UIUX §3.1 移动端规范）
// - 仅在移动端显示；预约转化路径不丢失
// - 白底毛玻璃 + safe-area 适配（iPhone 底部安全区）
// ============================================================
import { Link } from 'react-router-dom'

export default function MobileBottomBar() {
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] bg-white/94 backdrop-blur-md border-t border-line">
      <Link
        to="/reserve"
        className="block text-center bg-btn text-white rounded-full py-3 text-sm font-medium tracking-[0.2em] hover:bg-btn-hover transition-colors"
      >
        立即预约
      </Link>
    </div>
  )
}
