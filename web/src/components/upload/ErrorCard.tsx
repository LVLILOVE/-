/**
 * `ErrorCard` · 校验失败卡（5 类分支 + 兜底）
 * -----------------------------------------------------------------------------
 * 依据：《UI/UX》§8.1「五类错误分支（`UX-ST-05`）」· `UX-P05-03`（标题用 `--danger`、
 *      右上角错误码徽标）· `UX-AC-05`（每类提示含「错在哪 + 怎么改」）
 *      PRD `FR-UPL-05` / `FR-UPL-09` ~ `FR-UPL-14`
 *
 * 分支与错误码一一对应（顺序即 PRD §3.2.2 的校验顺序）：
 * | 码 | 分支 | 专属内容 |
 * |---|---|---|
 * | 40001 | 缺字段 | 表头徽标组（✓ 已识别 / ✗ 缺失）+「如何修正」 |
 * | 40002 | 日期异常 | 错误明细表（行号 + 原始值 + 问题说明）+ 下载明细 |
 * | 40003 | 销量非法（负值 / 非数值） | 同上，合并两类明细 |
 * | 40004 | 序列超限 | 当前值 vs 上限对比卡 + 筛选建议 |
 * | 40005 | 时间断档 | 断档区间表 + 「自动插值 / 放弃上传」二选一 |
 * | 其它（40007/08/09/10） | 前置拦截 | 仅结论 + 如何修正（**无明细可下载**） |
 *
 * 🔒 「下载错误明细 CSV」的显隐由 `data.dataset_id` 决定，不是由错误码决定：
 *    扩展名非 `.csv`（40009）与大小超限（40007）时文件未完整落盘、没有数据集行，
 *    `dataset_id` 为 `null`，此时渲染按钮只会让用户点出一个 40402。
 *
 * ⚠️ 与原型的一处受控偏离：原型的负值明细表有 4 列（行号/原始值/sku_id/warehouse_id），
 *    但后端 `ValidationErrorData.negative_rows` 只回 `{row_no, value}`（契约见
 *    `types/index.ts`）。此处按契约渲染 3 列，商品与仓库信息在**下载的错误明细 CSV**
 *    里完整保留（该文件含原始所有列 + `error_reason`）。已登记为 EP-4 偏离项。
 */
import { useState } from 'react';

import type { ValidationErrorData } from '../../types';
import { ERR, REQUIRED_COLUMNS, LIMITS, VALIDATE_ORDER } from '../../types';
import { fmtInt } from './format';

/**
 * 把 `fail_stage`（中文阶段名，与后端 `VALIDATE_ORDER` 同源）翻回步序号。
 *
 * ⚠️ 找不到时返回「—」而不是猜一个数字：`fail_stage` 是后端给的真值，
 *    前端只做呈现；对不上宁可显示得含糊，也不能编一个错的步号误导排查。
 */
function failStageNo(stage: string): string {
  const i = (VALIDATE_ORDER as readonly string[]).indexOf(stage);
  return i >= 0 ? String(i + 1) : '—';
}

type Props = {
  code: number;
  message: string;
  data: ValidationErrorData | null;
  /** 返回重新上传（重置全部状态） */
  onReset: () => void;
  /** 下载错误明细（仅当有 dataset_id 时可用） */
  onDownloadErrors?: (datasetId: number) => void | Promise<void>;
  /** 断档二选一（FR-UPL-13） */
  onResolveGap?: (datasetId: number, action: 'interpolate' | 'abort') => void | Promise<void>;
};

/** 表头徽标：逐个必需列标注「已识别 / 缺失」 */
function HeaderBadges({ missing }: { missing: string[] }) {
  return (
    <div className="mb-3" data-testid="header-badges">
      <div className="mb-1 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
        已识别的表头
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REQUIRED_COLUMNS.map((col) => {
          const lost = missing.includes(col);
          return (
            <span
              key={col}
              className="mono inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
              style={{
                color: lost ? 'var(--on-danger-soft)' : 'var(--on-success-soft)',
                background: lost ? 'var(--danger-soft)' : 'var(--success-soft)',
              }}
            >
              <span aria-hidden>{lost ? '✗' : '✓'}</span>
              {lost ? `${col}（缺失）` : col}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 「如何修正」提示块（5 类分支共用，保证 `UX-AC-05` 不留空） */
function Suggestion({ text }: { text: string }) {
  return (
    <div
      className="mt-3 flex gap-2.5 rounded-[var(--radius-sm)] px-3 py-2.5"
      style={{ background: 'var(--info-soft)' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 flex-none">
        <circle cx="12" cy="12" r="9" stroke="var(--info)" strokeWidth="1.8" />
        <path d="M12 11v5.5M12 7.6v.1" stroke="var(--info)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <div className="text-[0.75rem] leading-[1.7]">
        <div className="font-bold">如何修正</div>
        <p style={{ color: 'var(--text-2)' }}>{text}</p>
      </div>
    </div>
  );
}

/** 三列错误明细表（行号 / 原始值 / 问题说明） */
function ErrorRowsTable({
  rows,
}: {
  rows: Array<{ row_no: number; raw: string; why: string }>;
}) {
  return (
    <div
      className="overflow-x-auto rounded-[var(--radius-sm)] border"
      style={{ borderColor: 'var(--border)' }}
      data-testid="error-rows"
    >
      <table className="w-full border-collapse text-[0.75rem]">
        <thead>
          <tr style={{ background: 'var(--surface-2)' }}>
            <th className="px-3 py-2 text-left font-semibold" style={{ width: 90 }}>行号</th>
            <th className="px-3 py-2 text-left font-semibold">原始值</th>
            <th className="px-3 py-2 text-left font-semibold">问题说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.row_no}-${r.raw}`} className="border-t" style={{ borderColor: 'var(--border)' }}>
              <td className="mono px-3 py-1.5" style={{ color: 'var(--text-2)' }}>{r.row_no}</td>
              <td className="mono px-3 py-1.5 font-semibold" style={{ color: 'var(--danger)' }}>
                {r.raw}
              </td>
              <td className="px-3 py-1.5" style={{ color: 'var(--text-2)' }}>{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ErrorCard({
  code,
  message,
  data,
  onReset,
  onDownloadErrors,
  onResolveGap,
}: Props) {
  const [busy, setBusy] = useState<'download' | 'interpolate' | 'abort' | null>(null);
  const suggestion = data?.suggestion ?? '请修正上述问题后重新上传。';
  const datasetId = data?.dataset_id ?? null;
  const canDownload = datasetId !== null && Boolean(onDownloadErrors);

  /** 明细表内容：40002 取日期列，40003 合并「负值 + 非数值」两类 */
  function detailRows(): Array<{ row_no: number; raw: string; why: string }> {
    if (!data) return [];
    const rows: Array<{ row_no: number; raw: string; why: string }> = [];
    for (const r of data.unparsable_rows ?? []) {
      rows.push({
        row_no: r.row_no,
        raw: r.raw_value === '' ? '（空）' : r.raw_value,
        why: code === ERR.NEGATIVE_VALUE ? '销量非数值或为空' : `${r.column} 无法解析为日期`,
      });
    }
    for (const r of data.negative_rows ?? []) {
      rows.push({ row_no: r.row_no, raw: String(r.value), why: '销量为负值（系统不取绝对值）' });
    }
    return rows.sort((a, b) => a.row_no - b.row_no).slice(0, 20);
  }

  async function run(kind: 'download' | 'interpolate' | 'abort') {
    if (kind === 'download') {
      if (!canDownload || datasetId === null) return;
      setBusy('download');
      try {
        await onDownloadErrors?.(datasetId);
      } finally {
        setBusy(null);
      }
      return;
    }
    if (datasetId === null || !onResolveGap) return;
    setBusy(kind);
    try {
      await onResolveGap(datasetId, kind);
    } finally {
      setBusy(null);
    }
  }

  const isGap = code === ERR.DATE_GAP;
  const isSeries = code === ERR.SERIES_OVER_LIMIT;
  const isMissing = code === ERR.MISSING_COLUMN;
  const isRows =
    (code === ERR.DATE_UNPARSABLE || code === ERR.NEGATIVE_VALUE) && detailRows().length > 0;

  return (
    <div
      className="rounded-[var(--radius)] border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      data-testid="error-card"
      data-error-code={code}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <h3 className="text-[1.0312rem]" style={{ color: 'var(--danger)' }}>
          数据校验未通过
        </h3>
        <span
          className="mono rounded-full px-2 py-[2px] text-[0.6875rem] font-bold"
          style={{ color: 'var(--on-danger)', background: 'var(--danger)' }}
          data-testid="error-code"
        >
          {code}
        </span>
      </div>

      <div className="p-4">
        <div
          className="flex gap-2.5 rounded-[var(--radius-sm)] px-3.5 py-3"
          style={{
            background: 'var(--danger-soft)',
            borderLeft: '3px solid var(--danger)',
          }}
          role="alert"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 flex-none">
            <circle cx="12" cy="12" r="9" stroke="var(--danger)" strokeWidth="1.8" />
            <path d="M12 7.5v5.5M12 16.2v.1" stroke="var(--danger)" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div className="text-[0.75rem] leading-[1.7]">
            <div className="font-bold" style={{ color: 'var(--on-danger-soft)' }} data-testid="error-message">
              {message}
            </div>
            {data?.fail_stage && (
              <p style={{ color: 'var(--text-2)' }}>
                校验顺序第 {failStageNo(data.fail_stage)} 步失败：{data.fail_stage}
              </p>
            )}
          </div>
        </div>

        {/* ---- 分支 ①：缺字段 ---- */}
        {isMissing && (
          <div className="mt-3">
            <HeaderBadges missing={data?.missing_columns ?? []} />
          </div>
        )}

        {/* ---- 分支 ②③：日期异常 / 销量非法 ---- */}
        {isRows && (
          <div className="mt-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                错误明细（最多显示前 20 条，完整明细请下载 CSV）
              </span>
              {canDownload && (
                <button
                  type="button"
                  onClick={() => run('download')}
                  disabled={busy !== null}
                  data-testid="download-errors"
                  className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-[0.6875rem] font-semibold"
                  style={{
                    borderColor: 'var(--border-field)',
                    color: 'var(--text-2)',
                    background: 'var(--surface-2)',
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  {busy === 'download' ? '正在下载…' : '下载错误明细 CSV'}
                </button>
              )}
            </div>
            <ErrorRowsTable rows={detailRows()} />
          </div>
        )}

        {/* ---- 分支 ④：序列数超限 ---- */}
        {isSeries && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div
              className="rounded-[var(--radius-sm)] border p-3"
              style={{ borderColor: 'var(--border)', background: 'var(--danger-soft)' }}
            >
              <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>当前序列数</div>
              <div
                data-testid="series-current"
                className="mono text-[1.375rem] font-bold"
                style={{ color: 'var(--on-danger-soft)' }}
              >
                {fmtInt(data?.series_count)}
              </div>
              <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                sku_id × warehouse_id 去重后
              </div>
            </div>
            <div
              className="rounded-[var(--radius-sm)] border p-3"
              style={{ borderColor: 'var(--border)', background: 'var(--primary-soft)' }}
            >
              <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>上限</div>
              <div
                data-testid="series-limit"
                className="mono text-[1.375rem] font-bold"
                style={{ color: 'var(--on-primary-soft)' }}
              >
                {fmtInt(data?.series_limit ?? LIMITS.max_series)}
              </div>
              <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                受 60 秒端到端约束
              </div>
            </div>
          </div>
        )}

        {/* ---- 分支 ⑤：时间断档 ---- */}
        {isGap && (
          <div className="mt-3">
            <div
              className="overflow-x-auto rounded-[var(--radius-sm)] border"
              style={{ borderColor: 'var(--border)' }}
              data-testid="gap-table"
            >
              <table className="w-full border-collapse text-[0.75rem]">
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <th className="px-3 py-2 text-left font-semibold">商品 (sku_id)</th>
                    <th className="px-3 py-2 text-left font-semibold">仓库 (warehouse_id)</th>
                    <th className="px-3 py-2 text-left font-semibold">断档区间</th>
                    <th className="px-3 py-2 text-right font-semibold">缺失天数</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.gap_ranges ?? []).map((g) => (
                    <tr
                      key={`${g.sku_id}-${g.warehouse_id}-${g.gap_start}`}
                      className="border-t"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="mono px-3 py-1.5">{g.sku_id}</td>
                      <td className="mono px-3 py-1.5">{g.warehouse_id}</td>
                      <td className="mono px-3 py-1.5">{g.gap_start} ~ {g.gap_end}</td>
                      <td
                        className="mono px-3 py-1.5 text-right font-semibold"
                        style={{ color: 'var(--warning)' }}
                      >
                        {g.gap_days}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              className="mt-3 rounded-[var(--radius-sm)] px-3.5 py-3"
              style={{ background: 'var(--warning-soft)' }}
            >
              <div className="text-[0.75rem] font-bold">请选择处理方式（系统不会自动继续）</div>
              <p className="mt-0.5 text-[0.75rem] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
                自动插值会用线性插值补齐缺失日期；放弃上传则保留原始数据不变，需你修正后重传。
                本次共 {fmtInt(data?.gap_ranges?.length)} 个断档区间。
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => run('interpolate')}
                  disabled={busy !== null || datasetId === null}
                  data-testid="gap-interpolate"
                  className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[0.75rem] font-semibold"
                  style={{
                    background: 'var(--primary)',
                    color: 'var(--on-primary)',
                    cursor: busy ? 'wait' : 'pointer',
                    opacity: datasetId === null ? 0.6 : 1,
                  }}
                >
                  {busy === 'interpolate' ? '正在补齐…' : '自动插值补齐后继续'}
                </button>
                <button
                  type="button"
                  onClick={() => run('abort')}
                  disabled={busy !== null || datasetId === null}
                  data-testid="gap-abort"
                  className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.75rem] font-semibold"
                  style={{
                    borderColor: 'var(--border-field)',
                    color: 'var(--text-2)',
                    background: 'var(--surface-2)',
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  放弃上传
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- 分支 ⑥：扩展名 / 超限等前置拦截（无明细） ---- */}
        {!isMissing && !isRows && !isSeries && !isGap && (
          <div className="mt-3 text-[0.75rem] leading-[1.75]" style={{ color: 'var(--text-2)' }}>
            {code === ERR.FILE_TOO_LARGE && (
              <p>
                当前文件超过 {LIMITS.max_file_size_mb} MB 上限。请先按时间或商品拆分，
                或只保留建模所需的列（`sku_id` / `warehouse_id` / `date` / `sales`）后再上传。
              </p>
            )}
            {code === ERR.ROW_OVER_LIMIT && (
              <p>
                当前文件超过 {fmtInt(LIMITS.max_rows)} 行上限。请按商品或时间拆分后分批上传。
              </p>
            )}
            {code === ERR.BAD_EXTENSION && (
              <p>
                仅支持 `.csv` 文件。若源文件是 Excel，请在「另存为」中选择
                <strong> CSV（逗号分隔）</strong>，而不要直接改扩展名 —— 后者会得到
                一个内容仍是 xlsx 的假 CSV。
              </p>
            )}
            {code === ERR.EMPTY_FILE && <p>文件内容为空或只有表头，没有可用的历史销量数据。</p>}
          </div>
        )}

        <Suggestion text={suggestion} />

        <div className="mt-4">
          <button
            type="button"
            onClick={onReset}
            data-testid="error-reset"
            className="rounded-[var(--radius-sm)] px-3.5 py-2 text-[0.8125rem] font-semibold"
            style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
          >
            返回重新上传
          </button>
        </div>
      </div>
    </div>
  );
}
