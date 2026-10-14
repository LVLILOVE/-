/**
 * 全局页脚（含免责声明）
 * -----------------------------------------------------------------------------
 * 🔒 `FR-SYS-05` / `UX-CMP-02`：免责声明是**真实需求**，必须
 *    ① 全站每一页可达（4 个模板都挂本组件）；
 *    ② 文案固定，**严禁被截断或折叠**（不得做「展开/收起」、不得用 max-height
 *       截断、不得放进弹窗）。
 *
 * 为什么做成独立组件而不是各布局各写一份：
 *   原型由 `initShell()` 统一注入页脚（`UX-CMP-01`）。React 下若每个布局各写
 *   一份文案，后续改文案必然漏改——所以这里**单点定义**，布局只负责挂载。
 *
 * 文案来源：UI/UX §4.1 `UX-CMP-02`（原文照抄，不得改写）。
 */
import { DATASET_META } from '../generated/metrics';

/** 免责声明固定文案（UI/UX §4.1 `UX-CMP-02` 原文，勿改） */
export const DISCLAIMER_TEXT =
  '本系统输出的预测结果基于历史数据与统计模型自动生成，仅供参考，不构成任何经营决策依据。' +
  '模型对突发外部事件（政策调整、竞品动作、疫情等）不具备预测能力，请结合业务实际判断。' +
  '上传数据仅用于本次预测计算，不作其他用途。';

type Props = {
  /**
   * 紧凑模式：用于模板 C（认证页，本身高度紧张）。
   * ⚠️ 只压缩外边距，**不压缩内容**——文案完整性与「不可折叠」是硬约束。
   */
  compact?: boolean;
};

export default function SiteFooter({ compact = false }: Props) {
  return (
    <footer
      data-testid="site-footer"
      className={`site-footer w-full border-t ${compact ? 'px-4 py-3' : 'px-6 py-5'}`}
      style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)' }}
    >
      <div className="mx-auto max-w-[var(--maxw)]">
        {/* 免责声明条：`.disclaimer` 为校验脚本的定位钩子（对应原型同名类） */}
        <div
          className="disclaimer flex items-start gap-2.5 rounded-[var(--radius-sm)] border px-3.5 py-3 text-[0.75rem] leading-[1.65]"
          style={{
            background: 'var(--warning-soft)',
            borderColor: 'oklch(0.76 0.155 75 / .35)',
            color: 'var(--text-2)',
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="mt-[2px] flex-none"
          >
            <path
              d="M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6l7-3z"
              stroke="var(--warning)"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M12 8v4.5" stroke="var(--warning)" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="15.6" r="0.95" fill="var(--warning)" />
          </svg>
          <div>
            <strong style={{ color: 'var(--text)' }}>免责声明：</strong>
            {DISCLAIMER_TEXT}
          </div>
        </div>

        {/* 页脚链接：系统名 + 数据来源署名（原型说明入口按 UX-GOV-01 不迁移） */}
        <div
          className="footer-links mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem]"
          style={{ color: 'var(--text-3)' }}
        >
          <span>电商销量预测系统 · V1.0</span>
          <span aria-hidden>·</span>
          <a
            href={DATASET_META.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--text-3)' }}
          >
            数据来源：{DATASET_META.name}（{DATASET_META.source}）
          </a>
        </div>
      </div>
    </footer>
  );
}
