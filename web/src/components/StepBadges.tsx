/**
 * 四步主流程指示条（上传 → 参数 → 执行 → 结果）
 * -----------------------------------------------------------------------------
 * 依据：`UI/UX §8` 各页「步骤条」区块（原型 `upload/params/running/result.html`
 *       顶部那一排 `badge`）。
 *
 * 三态（`UX-CMP-10`：形状 + 颜色双通道，不靠单一颜色区分）：
 *   done    ✓ 前缀 + success 色
 *   current 数字 + primary 色 + 加粗
 *   todo    数字 + 中性色
 *
 * 🔒 未登录游客同样能看到完整四步（`FR-USR-08`：可跑到结果页），
 *    所以这里**不**根据登录态隐藏任何一步。
 */
export type StepKey = 'upload' | 'params' | 'running' | 'result';

const STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'upload', label: '上传数据' },
  { key: 'params', label: '确认参数' },
  { key: 'running', label: '执行预测' },
  { key: 'result', label: '查看结果' },
];

type Props = {
  /** 当前所在步骤 */
  current: StepKey;
  /** 已完成到哪一步（含）。默认取 current 的前一步 */
  doneThrough?: StepKey;
};

export default function StepBadges({ current, doneThrough }: Props) {
  const curIdx = STEPS.findIndex((s) => s.key === current);
  const doneIdx = doneThrough
    ? STEPS.findIndex((s) => s.key === doneThrough)
    : curIdx - 1;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[0.75rem]" data-testid="step-badges">
      {STEPS.map((step, i) => {
        const done = i <= doneIdx;
        const active = i === curIdx;
        const style = done
          ? { background: 'var(--success-soft)', color: 'var(--on-success-soft)', borderColor: 'transparent' }
          : active
            ? { background: 'var(--primary-soft)', color: 'var(--on-primary-soft)', borderColor: 'transparent' }
            : { background: 'var(--surface-2)', color: 'var(--text-3)', borderColor: 'var(--border)' };
        return (
          <span key={step.key} className="flex items-center gap-2">
            {i > 0 ? (
              <span aria-hidden style={{ color: 'var(--text-3)' }}>
                →
              </span>
            ) : null}
            <span
              className={`rounded-full border px-2.5 py-[3px] ${
                done || active ? 'font-semibold' : ''
              }`}
              style={style}
              aria-current={active ? 'step' : undefined}
            >
              {done ? '✓ ' : ''}
              {i + 1} · {step.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
