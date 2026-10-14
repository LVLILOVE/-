/**
 * 结果页·结果明细表（`FR-VIS-03` / `UX-P08-07`）
 * =============================================================================
 * 🔒 **服务端排序 + 分页**（`API-15`），不是前端全量排序。
 *    前端排序的前提是拿到全部明细（上限 30,000 行），单响应会到数十 MB；
 *    且「排序后翻页」在前端实现极易与筛选条件不同步（第 2 页重复第 1 页的行）。
 *
 * 🔒 **每行标注 `granularity_level` 与置信度**（`UX-P08-07`）：
 *    置信度**由分级推导**（L1 高 / L2 中 / L3 低），不另存一列 ——
 *    存两列必然出现「L1 但置信度低」的自相矛盾数据。
 *
 * ⚠️ **无真值时显示「—」而不是 0**（`UX-AC-10` 同源口径）：
 *    在线预测的真值尚未发生，`actual_value` / `error` / `error_pct` 都是 null。
 *    显示 0 会被读成「预测完全准确」，这是彻头彻尾的误导。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  GranularityLevel,
  PredictionDetailQuery,
  PredictionRow,
} from '../../types';

type Props = {
  taskId: number;
  detailTotal: number;
  /** 拉取一页数据；失败时抛错由页面统一处理 */
  fetcher: (taskId: number, query: PredictionDetailQuery) => Promise<{
    items: PredictionRow[];
    page: number;
    size: number;
    total: number;
    pages: number;
  }>;
  onError: (msg: string) => void;
};

type SortKey = 'sku_id' | 'warehouse_id' | 'forecast_date' | 'predicted_value' | 'error';

const COLUMNS: Array<{ key: SortKey; label: string; align: 'left' | 'right'; sortable: boolean }> = [
  { key: 'sku_id', label: '商品 ID', align: 'left', sortable: true },
  { key: 'warehouse_id', label: '仓库', align: 'left', sortable: true },
  { key: 'forecast_date', label: '预测日期', align: 'left', sortable: true },
  { key: 'predicted_value', label: '预测销量', align: 'right', sortable: true },
  { key: 'error', label: '绝对误差', align: 'right', sortable: true },
];

/** 置信度由分级推导（UX-P08-07）；不与分级矛盾 */
const CONFIDENCE: Record<GranularityLevel, { label: string; token: string }> = {
  L1: { label: '高', token: 'var(--success)' },
  L2: { label: '中', token: 'var(--warning)' },
  L3: { label: '低', token: 'var(--text-3)' },
};

const DASH = '—';

export default function DetailTable({ taskId, detailTotal, fetcher, onError }: Props) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [sortBy, setSortBy] = useState<SortKey>('sku_id');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [level, setLevel] = useState<GranularityLevel | ''>('');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  const [rows, setRows] = useState<PredictionRow[]>([]);
  const [total, setTotal] = useState(detailTotal);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const query = useMemo<PredictionDetailQuery>(
    () => ({
      page,
      size,
      sort_by: sortBy,
      order,
      ...(level ? { level } : {}),
      ...(appliedKeyword ? { keyword: appliedKeyword } : {}),
    }),
    [page, size, sortBy, order, level, appliedKeyword],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetcher(taskId, query);
      setRows(data.items);
      setTotal(data.total);
      setPages(data.pages);
    } catch (e) {
      onError(e instanceof Error ? e.message : '明细加载失败');
    } finally {
      setLoading(false);
    }
  }, [taskId, query, fetcher, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 切换排序列：同列切换方向，异列重置为升序并回到第 1 页 */
  const toggleSort = (key: SortKey) => {
    if (key === sortBy) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setOrder('asc');
    }
    setPage(1);
  };

  /** 任何筛选变化都回到第 1 页 —— 否则会停在越界页码上看到空白 */
  const resetPage = () => setPage(1);

  return (
    <div data-testid="detail-table">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[0.75rem]" style={{ color: 'var(--text-2)' }}>分级</span>
          <select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as GranularityLevel | '');
              resetPage();
            }}
            className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-[0.8125rem]"
            style={{ borderColor: 'var(--border-field)', background: 'var(--surface)', color: 'var(--text)' }}
            data-testid="detail-level-filter"
          >
            <option value="">全部</option>
            <option value="L1">L1 · 模型预测</option>
            <option value="L2">L2 · 规则降级</option>
            <option value="L3">L3 · 不可预测</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.75rem]" style={{ color: 'var(--text-2)' }}>搜索</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setAppliedKeyword(keyword.trim());
                resetPage();
              }
            }}
            onBlur={() => {
              setAppliedKeyword(keyword.trim());
              resetPage();
            }}
            placeholder="商品 ID / 仓库"
            maxLength={64}
            className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-[0.8125rem]"
            style={{ borderColor: 'var(--border-field)', background: 'var(--surface)', color: 'var(--text)' }}
            data-testid="detail-keyword"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.75rem]" style={{ color: 'var(--text-2)' }}>每页</span>
          <select
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value));
              resetPage();
            }}
            className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-[0.8125rem]"
            style={{ borderColor: 'var(--border-field)', background: 'var(--surface)', color: 'var(--text)' }}
            data-testid="detail-size"
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>{n} 行</option>
            ))}
          </select>
        </label>

        <p className="ml-auto text-[0.75rem] tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="detail-count">
          共 {total.toLocaleString('zh-CN')} 行
          {loading ? ' · 加载中…' : ''}
        </p>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full border-collapse text-[0.8125rem]">
          <caption className="sr-only">预测结果明细，可按列排序并分页</caption>
          <thead style={{ background: 'var(--surface-2)' }}>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    sortBy === c.key ? (order === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className={`border-b px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  style={{ color: 'var(--text-2)' }}
                >
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 hover:underline"
                      style={{ color: sortBy === c.key ? 'var(--primary)' : 'inherit' }}
                      data-testid={`detail-sort-${c.key}`}
                    >
                      {c.label}
                      <span aria-hidden className="text-[0.625rem]">
                        {sortBy === c.key ? (order === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
              <th scope="col" className="border-b px-3 py-2 text-left font-medium" style={{ color: 'var(--text-2)' }}>
                分级
              </th>
              <th scope="col" className="border-b px-3 py-2 text-left font-medium" style={{ color: 'var(--text-2)' }}>
                置信度
              </th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center" style={{ color: 'var(--text-3)' }}>
                  没有符合条件的明细行
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const conf = CONFIDENCE[r.granularity_level];
              return (
                <tr key={`${r.sku_id}-${r.warehouse_id}-${r.forecast_date}-${i}`} data-testid="detail-row">
                  <td className="border-b px-3 py-2" style={{ color: 'var(--text)' }}>{r.sku_id}</td>
                  <td className="border-b px-3 py-2" style={{ color: 'var(--text)' }}>{r.warehouse_id}</td>
                  <td className="border-b px-3 py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>{r.forecast_date}</td>
                  <td className="border-b px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text)' }}>
                    {r.granularity_level === 'L3' ? DASH : r.predicted_value.toFixed(2)}
                  </td>
                  <td className="border-b px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {r.error === null ? DASH : r.error.toFixed(2)}
                  </td>
                  <td className="border-b px-3 py-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-[0.6875rem]"
                      style={{
                        background: r.granularity_level === 'L1' ? 'var(--primary-soft)' : 'var(--bg-subtle)',
                        color: r.granularity_level === 'L1' ? 'var(--primary)' : 'var(--text-2)',
                      }}
                    >
                      {r.granularity_level}
                    </span>
                  </td>
                  <td className="border-b px-3 py-2">
                    <span className="text-[0.75rem]" style={{ color: conf.token }}>{conf.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.75rem] tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="detail-page-info">
          第 {page} / {Math.max(pages, 1)} 页
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.8125rem] disabled:opacity-40"
            style={{ borderColor: 'var(--border-field)', color: 'var(--text)' }}
            data-testid="detail-prev"
          >
            上一页
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(Math.max(pages, 1), p + 1))}
            disabled={page >= pages || loading}
            className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.8125rem] disabled:opacity-40"
            style={{ borderColor: 'var(--border-field)', color: 'var(--text)' }}
            data-testid="detail-next"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
