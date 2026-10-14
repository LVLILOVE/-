/**
 * 0–60 s 时间轴（`UX-P07-01`）
 * =============================================================================
 * 依据：《UI/UX 设计文档 V1.0》§8.3「总体进度」区块 ——
 *      「**0–60s 时间轴**（分段着色：预处理 `--c2` / 特征 `--c1` / 推理 `--c5` /
 *      指标 `--c3`，末端红色 60s 上限标记）」。
 *
 * 🔒 两条不可动摇的口径
 * -----------------------------------------------------------------------------
 * ① **刻度是 0–60 s 的绝对预算**，不是「占管线耗时的比例」。
 *    把各段占比归一化后拉满整条轨道，会顺手抹掉「还剩多少预算」——
 *    而用户关心「会不会超时」的程度不亚于「哪段最贵」。同时段宽 = `ms / budgetMs`
 *    也让「预估」与「实测」两次渲染可以直接叠比（同一把尺子）。
 *
 * ② **段宽必须来自真实耗时**（有实测就用实测，没有才退到标定比例，
 *    且退到比例时要把「这是标定值」写在界面上）。
 *    `UX-GOV-07` 明确禁止用放慢的假数据演示动效：原型执行页为了让动画可见
 *    用了 34.3 s，而完成态卡片用的是真实 7.9 s，同一件事两套数字。
 *    本组件的 `source` 字段就是用来把这件事写清楚的。
 *
 * 配色不写死色值：一律走 CSS 变量（`UX-GOV-02` 令牌是唯一真源），
 * 因此深浅主题下都自然可读。
 */
import type { PipelineStage } from '../../types';

/** 阶段 → 时间轴配色（与 UI/UX §8.3 逐一对应） */
const STAGE_COLOR: Record<PipelineStage, string> = {
  validate: 'var(--text-3)', // 读取校验：毫秒级，给一个中性极窄段，不占视觉权重
  preprocess: 'var(--c2)',
  features: 'var(--c1)',
  inference: 'var(--c5)',
  metrics: 'var(--c3)',
};

export type TimelineSegment = {
  key: PipelineStage;
  label: string;
  /** 该段耗时（ms） */
  ms: number;
};

type Props = {
  segments: TimelineSegment[];
  /** 硬上限（ms），时间轴右端刻度，固定 60000 */
  budgetMs: number;
  /**
   * 段宽数据来源：
   *   measured 实测（`timing.stages_two_pass_ms`）
   *   budget   标定比例（无可测数据时的降级）
   */
  source: 'measured' | 'budget';
};

export default function StageTimeline({ segments, budgetMs, source }: Props) {
  const usedMs = segments.reduce((a, s) => a + s.ms, 0);
  const usedPct = Math.max(0, Math.min(100, (usedMs / budgetMs) * 100));

  return (
    <div data-testid="stage-timeline" data-source={source}>
      {/* 轨道 */}
      <div className="relative h-[34px]">
        <div
          className="absolute inset-x-0 top-0 flex h-[10px] overflow-hidden rounded-full"
          style={{ background: 'var(--surface-2)' }}
          role="img"
          aria-label={`0 到 ${(budgetMs / 1000).toFixed(0)} 秒时间轴，已用 ${(usedMs / 1000).toFixed(1)} 秒`}
        >
          {segments.map((s) => (
            <i
              key={s.key}
              className="block h-full"
              style={{
                // 小于 0.15% 的极窄段（读取校验实测 31 ms）给一个最小可见宽度，
                // 否则它会彻底消失。可见性优先，精度由下方刻度文字承担。
                width: `${Math.max((s.ms / budgetMs) * 100, 0.15).toFixed(3)}%`,
                background: STAGE_COLOR[s.key],
              }}
              // 🔴 `data-testid` + `data-stage-ms` 是**可测试性钩子**，不是装饰：
              //   `verify_ep5_browser.mjs` 要断言「5 段宽度互不相同且 inference 最宽」
              //   （`DOD-EP5` 第 2 条 + `UX-P07-01`「一眼看出哪一段最贵」）。
              //   只靠 `style.width` 或 `title` 去算都太脆（样式可能被内联表改写，
              //   title 只在 hover 时才进 DOM 文本）。
              data-testid={`timeline-seg-${s.key}`}
              data-stage-ms={s.ms}
              data-stage-pct={((s.ms / budgetMs) * 100).toFixed(3)}
              title={`${s.label} ${(s.ms / 1000).toFixed(1)} s`}
            />
          ))}
        </div>

        {/* 60 s 硬上限标记 */}
        <div
          className="absolute right-0 top-0 h-[10px] w-[2px]"
          style={{ background: 'var(--danger)', opacity: 0.75 }}
          aria-hidden
        />

        {/* 刻度 */}
        <div
          className="mono absolute left-0 top-[14px] text-[0.625rem]"
          style={{ color: 'var(--text-3)' }}
        >
          0 s
        </div>
        {[0.3, 0.6].map((r) => (
          <div
            key={r}
            className="mono absolute top-[14px] text-[0.625rem]"
            style={{ color: 'var(--text-3)', left: `${r * 100}%`, transform: 'translateX(-50%)' }}
          >
            {(budgetMs * r) / 1000} s
          </div>
        ))}
        <div
          className="mono absolute right-0 top-[14px] text-[0.625rem]"
          style={{ color: 'var(--danger)', transform: 'translateX(38%)' }}
        >
          {(budgetMs / 1000).toFixed(0)} s 上限
        </div>
      </div>

      {/* 图例 + 口径声明 */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem]">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-[8px] w-[8px] rounded-full"
              style={{ background: STAGE_COLOR[s.key] }}
            />
            <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
            <span className="mono" style={{ color: 'var(--text-3)' }}>
              {(s.ms / 1000).toFixed(2)} s
            </span>
          </span>
        ))}
        <span className="ml-auto" style={{ color: 'var(--text-3)' }}>
          已用 {usedPct.toFixed(1)}% 预算
          {source === 'budget' ? ' · 段宽为标定比例（本次无实测明细）' : ''}
        </span>
      </div>
    </div>
  );
}
