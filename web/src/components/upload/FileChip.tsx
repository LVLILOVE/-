/**
 * `FileChip` · 已选文件条 + 上传进度（UX-P05）
 * -----------------------------------------------------------------------------
 * 依据：《UI/UX》§8.1「文件条 `.file-chip`（已选/上传中，含 CSV 角标、文件名、
 *      尺寸·行数·列数、状态徽标、移除按钮）」
 *      PRD `FR-UPL-04`（上传进度条 + 百分比）
 *
 * 三个状态（由 `status` 决定）：
 *   selected  —— 待上传（灰徽标）
 *   uploading —— 上传中（信息色徽标 + 进度条 + 百分比）
 *   done      —— 已收到校验结果前的一瞬（成功色徽标），随后整卡被结果卡替换
 *
 * ⚠️ `meta` 里的「行数 / 列数」在**上传完成前不可知**（服务端才算得出来）：
 *    上传中只显示大小，避免先编一个数字再被结果覆盖（`NFR-USE-03` 不误导）。
 */
import { fmtBytes, fmtInt } from './format';

export type FileChipStatus = 'selected' | 'uploading';

type Props = {
  file: { name: string; size: number };
  status: FileChipStatus;
  /** 0..100，仅 uploading 时有意义 */
  percent?: number;
  /** 服务端返回的行数 / 列数（拿到结果前传 undefined） */
  rows?: number;
  cols?: number;
  onRemove?: () => void;
  disabled?: boolean;
};

const BADGE: Record<FileChipStatus, { label: string; fg: string; bg: string }> = {
  selected: { label: '待上传', fg: 'var(--text-2)', bg: 'var(--surface-2)' },
  uploading: { label: '上传中', fg: 'var(--on-info-soft)', bg: 'var(--info-soft)' },
};

export default function FileChip({
  file,
  status,
  percent = 0,
  rows,
  cols,
  onRemove,
  disabled = false,
}: Props) {
  const badge = BADGE[status];
  const metaParts = [fmtBytes(file.size)];
  if (rows !== undefined) metaParts.push(`${fmtInt(rows)} 行`);
  if (cols !== undefined) metaParts.push(`${cols} 列`);

  return (
    <div data-testid="file-chip">
      <div
        className="flex items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
      >
        <span
          aria-hidden
          className="flex-none rounded-[6px] px-1.5 py-0.5 text-[0.625rem] font-bold"
          style={{ background: 'var(--primary-soft)', color: 'var(--on-primary-soft)' }}
        >
          CSV
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.8125rem] font-semibold" title={file.name}>
            {file.name}
          </div>
          <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
            {metaParts.join(' · ')}
          </div>
        </div>

        <div className="flex flex-none items-center gap-2">
          <span
            className="rounded-full px-2 py-[1px] text-[0.6875rem] font-semibold"
            style={{ color: badge.fg, background: badge.bg }}
          >
            {badge.label}
          </span>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              aria-label="移除文件"
              title="移除文件并重新选择"
              className="flex h-5 w-5 items-center justify-center rounded-full"
              style={{
                color: 'var(--text-3)',
                background: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {status === 'uploading' && (
        <div className="mt-2" data-testid="upload-progress">
          <div
            className="mb-1 flex items-center justify-between text-[0.6875rem]"
            style={{ color: 'var(--text-3)' }}
          >
            <span>正在上传…</span>
            <span className="mono">{percent}%</span>
          </div>
          <ProgressBar percent={percent} />
        </div>
      )}
    </div>
  );
}

/** 细进度条（上传进度 / 校验进度共用），沿用原型的 `.progress` 视觉 */
export function ProgressBar({
  percent,
  tone = 'var(--primary)',
  testId,
}: {
  percent: number;
  tone?: string;
  testId?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      data-testid={testId}
      className="h-[6px] w-full overflow-hidden rounded-full"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
    >
      <i
        className="block h-full transition-[width] duration-200 ease-out"
        style={{ width: `${v}%`, background: tone }}
      />
    </div>
  );
}
