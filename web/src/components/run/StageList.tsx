/**
 * 五阶段列表（`UX-P07-02`）
 * =============================================================================
 * 依据：《UI/UX 设计文档 V1.0》§8.3「执行阶段」+ `UX-P07-02`
 *      「阶段图标三态（完成 ✓ / 进行 数字+脉冲 / 失败 ✗）**同时用形状与颜色**」。
 *
 * 🔒 无障碍要点（`UX-CMP-10` / WCAG 1.4.1「不能仅用颜色传达信息」）：
 *    三态各自带**形状差异**（✓ / 数字 / ✗），色盲用户与灰度打印都能区分。
 *    仅靠绿/蓝/红三色是明确违反的。
 *
 * ⚠️ 阶段名与顺序取自 `generated/pipeline.ts`（后端 `predict_service.STAGES`
 *    的构建期快照），不在此另写一套。原型把「序列分级」单独列为一个阶段，
 *    而接口契约把分级归入 `features`（分级结果就是特征构造的分流依据）——
 *    **接口契约为准**，原型只是文案差异（该说明同时写在 `predict_service.py`）。
 */
import type { PipelineStage } from '../../types';

export type StageRow = {
  key: PipelineStage;
  label: string;
  /** 该阶段预算耗时（ms） */
  budgetMs: number | null;
  /** 该阶段实测耗时（ms）；无实测时为 null */
  measuredMs: number | null;
};

export type StageState = 'done' | 'active' | 'todo' | 'failed';

type Props = {
  rows: StageRow[];
  /** 各阶段状态（由页面按时序推进计算得出） */
  stateOf: (index: number) => StageState;
};

// ⚠️ soft 底上的前景必须用 `--on-*-soft` 而非 `--{k}`：
//    深色主题下 soft 底偏暗，`--success`/`--danger` 的 L 不足以到 4.5:1（实测 3.62 / 3.07）。
const STATE_STYLE: Record<StageState, { fg: string; bg: string; border: string }> = {
  done: { fg: 'var(--on-success-soft)', bg: 'var(--success-soft)', border: 'transparent' },
  active: { fg: 'var(--on-primary-soft)', bg: 'var(--primary-soft)', border: 'transparent' },
  failed: { fg: 'var(--on-danger-soft)', bg: 'var(--danger-soft)', border: 'transparent' },
  todo: { fg: 'var(--text-3)', bg: 'var(--surface-2)', border: 'var(--border)' },
};

/** 图标：形状本身即语义（✓ / 编号 / ✗），颜色只是强化 */
function StageIcon({ index, state }: { index: number; state: StageState }) {
  const s = STATE_STYLE[state];
  return (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border text-[0.6875rem] font-bold ${
        state === 'active' ? 'animate-pulse' : ''
      }`}
      style={{ background: s.bg, color: s.fg, borderColor: s.border }}
    >
      {state === 'done' ? '✓' : state === 'failed' ? '✗' : index + 1}
    </span>
  );
}

const STATE_TEXT: Record<StageState, string> = {
  done: '已完成',
  active: '进行中',
  failed: '失败',
  todo: '待执行',
};

export default function StageList({ rows, stateOf }: Props) {
  return (
    <div className="flex flex-col" data-testid="stage-list">
      {rows.map((row, i) => {
        const state = stateOf(i);
        return (
          <div
            key={row.key}
            className="flex items-center gap-2.5 border-b py-2 last:border-b-0"
            style={{ borderColor: 'var(--border)' }}
            data-testid={`stage-row-${row.key}`}
            data-stage-state={state}
          >
            <StageIcon index={i} state={state} />
            <span className="min-w-0 flex-1 truncate text-[0.8125rem]" title={row.label}>
              {row.label}
            </span>
            <span className="sr-only">{STATE_TEXT[state]}</span>
            <span
              className="mono flex-none text-[0.6875rem]"
              style={{ color: state === 'todo' ? 'var(--text-3)' : 'var(--text-2)' }}
            >
              {row.measuredMs !== null
                ? `实测 ${(row.measuredMs / 1000).toFixed(2)} s`
                : row.budgetMs !== null
                  ? `预算 ${(row.budgetMs / 1000).toFixed(1)} s`
                  : '预算 —'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
