// ============================================================
// 代码段功能：页脚组件（对齐 UIUX §3.6）
// - 4 栏：品牌 / 导航 / 社交（占位）/ 信息（营业时间+隐私政策）
// - 底部版权行
// ============================================================
import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-[#F1E8DA] border-t border-line px-5 md:px-10 py-12 mt-12">
      <div className="max-w-[1100px] mx-auto flex flex-wrap justify-between gap-8">
        {/* 品牌栏：Logo + Slogan */}
        <div>
          <p className="text-base font-semibold tracking-[0.2em]">猫屿 CAT ISLE</p>
          <p className="text-xs text-ink-faint mt-1.5">在猫的节奏里，慢下来</p>
        </div>
        {/* 导航栏 */}
        <div>
          <h4 className="text-sm font-medium mb-2.5">导航</h4>
          <Link to="/cats" className="block text-[13px] text-ink-soft hover:text-main-deep py-0.5">猫咪</Link>
          <Link to="/menu" className="block text-[13px] text-ink-soft hover:text-main-deep py-0.5">餐单</Link>
          <Link to="/reserve" className="block text-[13px] text-ink-soft hover:text-main-deep py-0.5">预约</Link>
          <Link to="/adopt" className="block text-[13px] text-ink-soft hover:text-main-deep py-0.5">领养</Link>
          <Link to="/qa" className="block text-[13px] text-ink-soft hover:text-main-deep py-0.5">店长解答</Link>
        </div>
        {/* 社交占位（正式上线替换真实账号链接） */}
        <div>
          <h4 className="text-sm font-medium mb-2.5">关注我们</h4>
          <span className="block text-[13px] text-ink-soft py-0.5">小红书（占位）</span>
          <span className="block text-[13px] text-ink-soft py-0.5">抖音（占位）</span>
          <span className="block text-[13px] text-ink-soft py-0.5">微信公众号（占位）</span>
        </div>
        {/* 信息栏：营业时间 + 隐私政策 */}
        <div>
          <h4 className="text-sm font-medium mb-2.5">信息</h4>
          <p className="text-[13px] text-ink-soft py-0.5">营业时间：11:00-19:00（周一店休）</p>
          <Link to="/privacy" className="block text-[13px] text-ink-soft hover:text-main-deep py-0.5">隐私政策</Link>
        </div>
      </div>
      {/* 版权行 */}
      <div className="max-w-[1100px] mx-auto mt-8 pt-5 border-t border-line text-center text-xs text-ink-faint">
        © 2026 猫屿 CAT ISLE 保留所有权利
      </div>
    </footer>
  )
}
