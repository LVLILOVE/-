/**
 * `DropZone` · 拖拽 / 点击选择区（UX-P05 的空态）
 * -----------------------------------------------------------------------------
 * 依据：《UI/UX 设计文档》§8.1（数据文件卡组件）· `UX-P05-01`
 *      PRD `FR-UPL-03` / `NFR-PERF-03` / `NFR-PERF-04`
 *
 * 职责边界（刻意做「哑组件」）：
 *   只负责**收集文件**并原样抛出，不做任何校验 —— 扩展名与大小的拦截放在页面层，
 *   因为拦截结果要以 `40009` / `40007` 的错误卡呈现（`FR-UPL-01` 要求「即时拦截」，
 *   但提示形态必须与后端回包一致，所以两处判定共用一个出口）。
 *
 * 无障碍：
 *   - 拖拽区是 `<button>`，Tab 可聚焦、回车/空格可触发文件选择（键盘可用）
 *   - 隐藏的 `<input type="file">` 只做选择器，不承载语义
 *   - 拖拽中的视觉反馈同时改变边框与底色，不只靠颜色（`NFR-USE-05`）
 */
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

type Props = {
  /** 拿到文件后的回调。校验由调用方负责 */
  onFile: (file: File) => void;
  disabled?: boolean;
  /** 上限提示文案（默认与 LIMITS 一致，允许结果页复用其它口径） */
  hint?: string;
};

export default function DropZone({ onFile, disabled = false, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick(file: File | undefined | null) {
    if (!file || disabled) return;
    onFile(file);
  }

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragging(false);
    // 多文件时只取第一个：接口是单文件契约（`API-06`），
    // 提前丢弃并让用户看到「只处理了一个」，好过静默忽略后一半
    pick(e.dataTransfer?.files?.[0]);
  }

  return (
    <div className="dropzone">
      <button
        type="button"
        data-testid="dropzone"
        aria-label="选择要上传的 CSV 文件，支持拖拽"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          // 只有真正离开拖拽区才取消高亮：进出子元素也会触发 dragleave
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={onDrop}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius)] px-6 py-9 text-center"
        style={{
          border: `1.5px dashed ${dragging ? 'var(--primary)' : 'var(--border-field)'}`,
          background: dragging ? 'var(--primary-soft)' : 'var(--surface-2)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'border-color .18s ease, background-color .18s ease',
        }}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
            stroke="var(--primary)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 15v2.5A2.5 2.5 0 006.5 20h11A2.5 2.5 0 0020 17.5V15"
            stroke="var(--text-3)"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        <strong className="text-[0.875rem]">把 CSV 文件拖到这里，或点击选择</strong>
        <span className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
          {hint ?? '支持 .csv · 单文件 ≤ 20 MB · 行数 ≤ 500,000'}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          // 重置 value：否则「同一个文件连续选两次」不会再触发 change
          e.target.value = '';
        }}
      />
    </div>
  );
}
