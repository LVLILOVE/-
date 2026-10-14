/**
 * 模板 C · 认证页（左右分栏：左品牌区 + 右表单区，无侧栏）
 * 适用：登录 / 注册（UX-P02 / UX-P03）
 * -----------------------------------------------------------------------------
 * 左栏内容按路由切换（对齐原型 login.html / register.html 的差异）：
 *   - `/login`    4 条价值点列表（`.aa-list`）
 *   - `/register` 数据隐私说明块（`UX-P03-06`，`NFR-SEC-08` 🔒）
 * 两者视觉骨架相同（品牌 + 标题 + 说明 + 列表/说明块），故共用一个布局组件。
 */
import { Outlet, useLocation } from 'react-router-dom';

import Brand from '../components/Brand';
import SiteFooter from '../components/SiteFooter';
import ThemeToggle from '../components/ThemeToggle';

const VALUE_POINTS = [
  '仓库 × 商品粒度建模，直接指导分仓铺货',
  '加权 MAPE ≤ 20%，与移动平均基线同期对比',
  '覆盖率如实披露，不可预测的序列明确标注',
  '数据仅用于本次预测，按用户目录隔离存储',
];

const PRIVACY_POINTS = [
  '上传的销量数据仅用于本次预测计算，不作其他用途',
  '原始文件按用户目录隔离存储，其他用户无法访问',
  '传输全程启用 HTTPS',
  '该说明同时写入用户协议',
];

export default function AuthLayout() {
  const { pathname } = useLocation();
  const isRegister = pathname.startsWith('/register');

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1">
        {/* 左品牌区：渐变光晕底 + 品牌 + 标题 + （价值点 | 隐私说明） */}
        <aside
          className="hidden flex-1 flex-col justify-center px-14 lg:flex"
        style={{
          background:
            'radial-gradient(900px 500px at 12% 8%, oklch(0.62 0.145 205 / .16), transparent 62%), radial-gradient(700px 420px at 88% 92%, oklch(0.66 0.16 265 / .14), transparent 60%), var(--bg-subtle)',
          borderRight: '1px solid var(--border)',
        }}
      >
        <div className="max-w-[440px]">
          <Brand />

          {isRegister ? (
            <>
              <h1 className="mt-8 text-[1.75rem] leading-tight">
                三步开始你的
                <br />
                <em
                  className="not-italic"
                  style={{
                    background: 'linear-gradient(100deg, var(--primary), oklch(0.68 0.16 265))',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  第一次预测
                </em>
              </h1>
              <p className="mt-3 text-[0.875rem] leading-[1.8]" style={{ color: 'var(--text-2)' }}>
                注册后上传历史销量 CSV，系统会自动完成字段校验、数据清洗与预测，
                无需任何算法背景。也可先加载内置示例数据零成本试用。
              </p>

              {/* UX-P03-06 / NFR-SEC-08 🔒：数据隐私说明块。
                  类名 `privacy-box` 沿用原型语义命名，仅作结构与测试钩子。 */}
              <div
                className="privacy-box mt-6 rounded-[var(--radius-sm)] px-4 py-3.5 text-[0.75rem] leading-[1.75]"
                style={{
                  background: 'var(--info-soft)',
                  border: '1px solid oklch(0.68 0.13 250 / .32)',
                  color: 'var(--text-2)',
                }}
              >
                <div
                  className="mb-1.5 flex items-center gap-1.5 text-[0.75rem] font-bold"
                  style={{ color: 'var(--text)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6l7-3z"
                      stroke="var(--info)"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                  关于你的数据
                </div>
                <ul className="flex flex-col gap-1">
                  {PRIVACY_POINTS.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span style={{ color: 'var(--info)' }}>·</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <>
              <h1 className="mt-8 max-w-[16ch] text-[2rem] leading-tight">
                让补货决策
                <br />
                <em
                  className="not-italic"
                  style={{
                    background: 'linear-gradient(100deg, var(--primary), oklch(0.68 0.16 265))',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  有数可依
                </em>
              </h1>
              <p className="mt-3 text-[0.875rem] leading-[1.8]" style={{ color: 'var(--text-2)' }}>
                上传历史销量表，一分钟拿到未来 7 / 14 / 30 天的分仓预测曲线、
                加权误差指标与可导出的预测明细。
              </p>
              <ul className="mt-6 flex flex-col gap-3">
                {VALUE_POINTS.map((p) => (
                  <li
                    key={p}
                    className="flex items-start gap-2.5 text-[0.8125rem]"
                    style={{ color: 'var(--text-2)' }}
                  >
                    <span
                      className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full"
                      style={{ background: 'var(--success-soft)' }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M5 13l4 4L19 7"
                          stroke="var(--success)"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>

        {/* 右表单区 */}
        <section
          className="relative flex w-full items-center justify-center px-8 lg:w-[460px] lg:flex-none"
          style={{ background: 'var(--surface)' }}
        >
          {/* 主题切换放右上角：不占表单流，避免切换按钮挤动表单垂直居中 */}
          <div className="absolute right-4 top-4">
            <ThemeToggle compact />
          </div>
          <div className="w-full max-w-[372px]">
            <Outlet />
          </div>
        </section>
      </div>

      {/* 🔒 FR-SYS-05：认证页同样必须可达免责声明。
          `compact` 只压缩外边距，**不压缩文案**（不可折叠是硬约束）。 */}
      <SiteFooter compact />
    </div>
  );
}
