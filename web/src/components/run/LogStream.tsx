/**
 * 执行日志流（`UX-P07`「执行日志」区块 / `NFR-SEC-09`）
 * =============================================================================
 * 要点：
 *  1. **只记阶段级摘要与异常**，绝不记销量明细 —— 页面底部必须写明这一点
 *     （`NFR-SEC-09`：避免敏感业务数据落盘）。日志行由页面按真实响应拼装，
 *     不是编出来的假 log。
 *  2. 语义着色用 `level`（info / highlight / warning / error），
 *     同时行首带符号（· / ▸ / ! / ✗），不与颜色单通道绑定（`UX-CMP-10`）。
 *  3. 单色等宽字体 + 固定行高，避免动画推进时行高跳动。
 */
export type LogLevel = 'info' | 'highlight' | 'warning' | 'error';

export type LogLine = {
  level: LogLevel;
  message: string;
  /** 该行发生时的累计毫秒；无则为 null */
  atMs?: number | null;
};

const LEVEL_STYLE: Record<LogLevel, { fg: string; mark: string }> = {
  info: { fg: 'var(--text-2)', mark: '·' },
  highlight: { fg: 'var(--primary)', mark: '▸' },
  warning: { fg: 'var(--warning)', mark: '!' },
  error: { fg: 'var(--danger)', mark: '✗' },
};

export default function LogStream({ lines }: { lines: LogLine[] }) {
  return (
    <div>
      <div
        className="mono max-h-[240px] overflow-auto rounded-[var(--radius-sm)] border p-2.5 text-[0.75rem] leading-[1.9]"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--surface-2)',
          color: 'var(--text-2)',
        }}
        data-testid="log-stream"
        role="log"
        aria-label="执行日志"
      >
        {lines.length === 0 ? (
          <div style={{ color: 'var(--text-3)' }}>等待任务输出…</div>
        ) : (
          lines.map((l, i) => {
            const s = LEVEL_STYLE[l.level];
            return (
              <div key={`${i}-${l.message.slice(0, 12)}`} className="flex gap-2">
                <span className="flex-none" style={{ color: s.fg }} aria-hidden>
                  {s.mark}
                </span>
                {l.atMs !== null && l.atMs !== undefined ? (
                  <span className="mono flex-none" style={{ color: 'var(--text-3)' }}>
                    {String((l.atMs / 1000).toFixed(2)).padStart(6, ' ')}s
                  </span>
                ) : null}
                <span className="min-w-0 break-all" style={{ color: s.fg }}>
                  {l.message}
                </span>
              </div>
            );
          })
        )}
      </div>
      <p className="mt-2 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
        日志仅记录阶段级摘要与异常，不包含原始销量明细，避免敏感业务数据落盘（NFR-SEC-09）。
      </p>
    </div>
  );
}
