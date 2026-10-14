/**
 * `ValidationPanel` · 校验中面板（UX-P05）
 * -----------------------------------------------------------------------------
 * 依据：《UI/UX》§8.1「校验中卡」· `UX-P05-02`（显示「第 N/7 步」与进度条）
 *      PRD `FR-UPL-09`（7 步校验顺序不可调整）
 *
 * 🔒 步骤文案**不是自由书写**的：顺序取自 `types/index.ts` 的 `VALIDATE_ORDER`，
 *    与后端 `app/algo/config.py::VALIDATE_ORDER` 同源。这里只负责把顺序翻译成
 *    用户看得懂的动词短语，并在模块加载时断言两者长度一致 —— 任何人调整了
 *    校验顺序而忘了改这里，会立刻在控制台暴露，而不是悄悄给用户看错步骤名。
 *
 * ⚠️ 进度是「已进行到的步骤」，不是伪造的服务端进度：
 *    后端校验是同步的、不回流进度，所以前端按「上传字节完成 → 校验开始」
 *    推进到第 N 步，收到响应即结束。卡在第 7 步意味着「还在等最后一个判定的结果」，
 *    这与真实状态一致，不撒谎。
 */
import { VALIDATE_ORDER } from '../../types';
import { ProgressBar } from './FileChip';

/** 与 `VALIDATE_ORDER` 逐项对应的说明文案（顺序必须一一对应） */
const STEP_DESC = [
  '检查文件扩展名与大小', // 1 扩展名
  '检查行数与序列数规模', // 2 大小/行数
  '检查表头完整性', // 3 表头完整性
  '检查日期可解析性', // 4 日期可解析性
  '检查销量非负性', // 5 销量非负
  '检查时间连续性', // 6 时间连续性
  '检查序列数上限', // 7 序列数上限
] as const;

if (STEP_DESC.length !== VALIDATE_ORDER.length) {
  // 开发期自查：顺序源只有一处，文案必须跟着走
  console.error(
    `[EP-4] 校验步骤文案与 VALIDATE_ORDER 长度不一致：${STEP_DESC.length} vs ${VALIDATE_ORDER.length}`,
  );
}

/** 总步数（提交给「第 N/7 步」的分母） */
export const VALIDATE_TOTAL = VALIDATE_ORDER.length;

/** 第 index 步（0 基）的中文说明 */
export function stepText(index: number): string {
  const i = Math.max(0, Math.min(VALIDATE_TOTAL - 1, index));
  return STEP_DESC[i];
}

/**
 * 通用忙碌面板（无步骤可数时用）。
 *
 * 为什么不能复用 `ValidationPanel`：断档插值 / 加载示例数据都**不是** 7 步校验，
 * 套上「第 1/7 步」会给出一个不存在的进度，属于撒谎式 UI（`NFR-USE-03`）。
 */
export function BusyPanel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      className="rounded-[var(--radius)] border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      data-testid="busy-panel"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-[9px] w-[9px] flex-none animate-pulse rounded-full motion-reduce:animate-none"
          style={{ background: 'var(--info)' }}
        />
        <div className="flex-1">
          <div className="text-[0.875rem] font-bold">{title}</div>
          {hint && (
            <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
              {hint}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2">
        {/* 不定进度：没有可用的百分比就是没有，不编一个假的。
            用骨架屏的扫光条表达「正在进行、进度未知」。 */}
        <div
          data-testid="busy-progress"
          className="sk h-[6px] w-full rounded-full"
          style={{ border: '1px solid var(--border)' }}
          role="progressbar"
          aria-valuetext="进度未知"
        />
      </div>
    </div>
  );
}

export default function ValidationPanel({ stepIndex }: { stepIndex: number }) {
  const shown = Math.max(0, Math.min(VALIDATE_TOTAL - 1, stepIndex));
  const percent = Math.round(((shown + 1) / VALIDATE_TOTAL) * 100);

  return (
    <div
      className="rounded-[var(--radius)] border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      data-testid="validation-panel"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          data-testid="validation-pulse"
          className="h-[9px] w-[9px] flex-none animate-pulse rounded-full motion-reduce:animate-none"
          style={{ background: 'var(--info)' }}
        />
        <div className="flex-1">
          <div className="text-[0.875rem] font-bold">正在校验数据…</div>
          <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
            第 {shown + 1}/{VALIDATE_TOTAL} 步：{stepText(shown)}
          </div>
        </div>
      </div>
      <div className="mt-2">
        <ProgressBar percent={percent} tone="var(--info)" testId="validation-progress" />
      </div>
    </div>
  );
}
