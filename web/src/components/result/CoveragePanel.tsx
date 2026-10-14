/**
 * 结果页·覆盖率面板（`UX-P08-04` / `FR-VIS-07` / `UX-AC-06`）
 * =============================================================================
 * 🔒 **三项之和必须等于总数**，且这里**显式做闭合校验并展示**。
 *
 * 为什么要在前端再校验一次（后端 `_coverage()` 已经校验过）：
 *   后端校验的是「落库数据是否自洽」，前端校验的是「**我拿到手的这份**是否自洽」。
 *   两者之间隔着网络、缓存、未来的接口改动。只要三者之和 ≠ total，
 *   覆盖率这张图就在骗人 —— 而覆盖率恰恰是用户判断「这批预测能不能用」的第一依据。
 *   与其默默显示一个错的百分比，不如把不一致摆在界面上。
 *
 * ⚠️ **L3 的口径**：L3 = 无有效历史、**不可预测**的序列。它们既不进入主指标，
 *    也不产生数值预测行（`UX-AC-10`）。所以 `predictable = L1 + L2`，
 *    不是 `total - L3` 之外的任何算法。
 */
import type { Coverage } from '../../types';

type Props = { coverage: Coverage };

const LEVELS = [
  {
    key: 'L1' as const,
    name: 'L1 · 模型预测',
    desc: '历史充足，由 LSTM 直接推理',
    token: 'var(--c1)',
  },
  {
    key: 'L2' as const,
    name: 'L2 · 规则降级',
    desc: '历史偏短，用商品级均值兜底',
    token: 'var(--c3)',
  },
  {
    key: 'L3' as const,
    name: 'L3 · 不可预测',
    desc: '无有效历史，仅给历史均值占位',
    token: 'var(--text-3)',
  },
];

export default function CoveragePanel({ coverage }: Props) {
  const sum = coverage.L1 + coverage.L2 + coverage.L3;
  const closed = sum === coverage.total;

  return (
    <div data-testid="coverage-panel">
      <div
        className="flex h-8 w-full overflow-hidden rounded-[var(--radius-sm)] border"
        role="img"
        aria-label={`序列分级构成：L1 ${coverage.L1} 条、L2 ${coverage.L2} 条、L3 ${coverage.L3} 条，共 ${coverage.total} 条`}
      >
        {LEVELS.map((lv) => {
          const count = coverage[lv.key];
          if (!count) return null;
          const pct = coverage.total ? (count / coverage.total) * 100 : 0;
          return (
            <div
              key={lv.key}
              style={{ width: `${pct}%`, background: lv.token }}
              title={`${lv.name}：${count} 条（${pct.toFixed(1)}%）`}
              data-testid={`coverage-bar-${lv.key}`}
            />
          );
        })}
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {LEVELS.map((lv) => {
          const count = coverage[lv.key];
          return (
            <li
              key={lv.key}
              className="rounded-[var(--radius-sm)] border p-3"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
              data-testid={`coverage-item-${lv.key}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: lv.token }}
                  aria-hidden
                />
                <span className="text-[0.8125rem] font-medium" style={{ color: 'var(--text)' }}>
                  {lv.name}
                </span>
              </div>
              <p className="mt-1.5 text-[1.25rem] font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
                {count}
                <span className="ml-1 text-[0.75rem] font-normal" style={{ color: 'var(--text-3)' }}>
                  条 · {coverage[`${lv.key}_pct`].toFixed(2)}%
                </span>
              </p>
              <p className="mt-1 text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
                {lv.desc}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem]" style={{ color: 'var(--text-2)' }}>
        <span data-testid="coverage-total">
          合计 <strong className="tabular-nums">{coverage.total}</strong> 条序列
        </span>
        <span data-testid="coverage-predictable">
          可预测 <strong className="tabular-nums">{coverage.predictable}</strong> 条（
          {coverage.predictable_pct.toFixed(2)}%）
        </span>
        {coverage.L3 > 0 && (
          <span style={{ color: 'var(--warning)' }} data-testid="coverage-l3-note">
            其中 {coverage.L3} 条 L3 无有效历史，不输出数值预测
          </span>
        )}
      </div>

      {!closed && (
        <p
          className="mt-2 rounded-[var(--radius-sm)] border px-3 py-2 text-[0.75rem]"
          style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)', color: 'var(--on-danger-soft)' }}
          data-testid="coverage-broken"
          role="alert"
        >
          ⚠️ 分级计数不一致：L1+L2+L3 = {sum}，与总数 {coverage.total} 不符。覆盖率数据不可信，请重新运行该任务。
        </p>
      )}
    </div>
  );
}
