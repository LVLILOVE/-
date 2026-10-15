/**
 * 历史任务列表（`UX-P09` / `FR-HIS-01`）
 * =============================================================================
 * 🔒 **删除必须逐字输入任务 ID**（`UX-P09-04` / `UX-CMP-17`）。
 *    一个「删除」按钮 + 一句「确定吗？」拦不住误触，而软删除虽然可
 *    查回，但要恢复得走数据库。逐字输入 ID 把「点错」的成本抬到
 *    「不可能手滑」—— 这不是麻烦，是唯一有效的防误删交互。
 *
 * 🔒 **失败任务 MAPE 显示「—」而不是 0**（`UX-P09-03`）：
 *    显示 0 会被读成「预测完全准确」，是彻头彻尾的误导。
 *
 * ⚠️ **软删除文案必须与实现一致**（`UX-P09-07`）：
 *    接口只置 `is_deleted = 1`，数据仍在库里。弹窗若写「永久删除」
 *    就是欺骗用户 —— 那会让人不敢删本该删的东西。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, historyApi } from '../api/client';
import EmptyState from '../components/EmptyState';
import NoticeBar from '../components/NoticeBar';
import { Skeleton } from '../components/Skeleton';
import { THRESHOLDS, type HistoryItem, type HistoryQuery, type TaskStatus } from '../types';

/**
 * 汇总条的**本页**四项（`UX-P09` 汇总条）。
 *
 * 🔴 刻意**不再含「总数」**（`D-05`）：这四个数都只能从**当前页**那 ≤20 条算出来
 *    （接口只回当前页，没有全局聚合）。历史上这里有一项 `total: items.length`，
 *    被渲染在标签为「任务总数」的卡片上 —— 于是有 35 条任务时卡片显示 20，
 *    与同屏分页器的「共 35 条」当场自相矛盾。修法：总数改用接口的 `total`，
 *    其余四项在标签上显式写「本页」，让口径与数据一致。
 */
type Summary = {
  succeeded: number;
  failed: number;
  mapeAvg: number | null;
  durationAvg: number | null;
};

function summarize(items: HistoryItem[]): Summary {
  const succeeded = items.filter((i) => i.status === 'succeeded');
  const mapes = items.map((i) => i.weighted_mape).filter((v): v is number => v !== null);
  const durations = items
    .map((i) => i.duration_ms)
    .filter((v): v is number => typeof v === 'number');
  return {
    succeeded: succeeded.length,
    failed: items.filter((i) => i.status === 'failed').length,
    mapeAvg: mapes.length ? mapes.reduce((a, b) => a + b, 0) / mapes.length : null,
    durationAvg: durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null,
  };
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 🔒 筛选条件与请求参数是**两个状态**：输入框里的草稿可以不立即生效，
  //    点「查询」才提交。否则每敲一个字就打一次接口。
  const [draft, setDraft] = useState({ keyword: '', status: '' as '' | TaskStatus });
  const [query, setQuery] = useState<HistoryQuery>({ page: 1, size: 20 });

  const [pendingDelete, setPendingDelete] = useState<HistoryItem | null>(null);
  const [typedId, setTypedId] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (q: HistoryQuery) => {
    setLoading(true);
    setError('');
    try {
      const d = await historyApi.list(q);
      setItems(d.items);
      setTotal(d.total);
      setPages(d.pages);
      setPage(d.page);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载历史任务失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  // 🔒 四个派生指标按**当前页**计算，标签已显式写「本页」—— 不这样标注，
  //    用户会以为「平均 MAPE」是全部任务的平均值，而分页时它会跳变。
  //    「任务总数」则取接口的全局 `total`（见 `D-05`），不用本页条数冒充。
  const summary = useMemo(() => summarize(items), [items]);

  const applyFilter = () => {
    setQuery({
      page: 1,
      size: 20,
      keyword: draft.keyword.trim() || undefined,
      status: draft.status || undefined,
    });
  };

  const reset = () => {
    setDraft({ keyword: '', status: '' });
    setQuery({ page: 1, size: 20 });
  };

  const doDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await historyApi.remove(pendingDelete.task_id);
      setPendingDelete(null);
      setTypedId('');
      // 🔒 删完当前页最后一条时回退一页，否则会停在空白页上
      const nextPage = items.length === 1 && page > 1 ? page - 1 : page;
      await load({ ...query, page: nextPage });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  const firstUse = !loading && total === 0 && !query.keyword && !query.status;

  return (
    <div data-testid="history-page">
      <header className="mb-5">
        <p className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
          记录 / 历史任务
        </p>
        <h1 className="mt-1 text-[1.5rem] font-semibold" style={{ color: 'var(--text)' }}>
          历史任务
        </h1>
      </header>

      {/* 汇总条 */}
      <div
        className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5"
        data-testid="history-summary"
      >
        {/* 🔒 总数取自接口（全局口径）；其余四项是**本页**口径 —— 标签如实写明 */}
        <SummaryCell label="任务总数" value={String(total)} testId="sum-total" />
        <SummaryCell
          label="本页已完成"
          value={String(summary.succeeded)}
          testId="sum-succeeded"
        />
        <SummaryCell
          label="本页失败"
          value={String(summary.failed)}
          testId="sum-failed"
          tone={summary.failed > 0 ? 'danger' : undefined}
        />
        <SummaryCell
          label="本页平均加权 MAPE"
          value={summary.mapeAvg === null ? '—' : `${summary.mapeAvg.toFixed(2)}%`}
          testId="sum-mape"
          tone={
            summary.mapeAvg === null
              ? undefined
              : summary.mapeAvg <= THRESHOLDS.weighted_mape_max
                ? 'success'
                : 'danger'
          }
        />
        <SummaryCell
          label="本页平均耗时"
          value={
            summary.durationAvg === null
              ? '—'
              : `${(summary.durationAvg / 1000).toFixed(1)} s`
          }
          testId="sum-duration"
        />
      </div>

      {/* 筛选栏 */}
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        data-testid="history-filters"
      >
        <input
          type="search"
          value={draft.keyword}
          onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilter();
          }}
          placeholder="搜索任务名 / 数据集名"
          aria-label="搜索任务"
          data-testid="filter-keyword"
          className="h-8 rounded-[var(--radius-sm)] border px-2.5 text-[0.8125rem]"
          style={{
            borderColor: 'var(--border-field)',
            background: 'var(--surface)',
            color: 'var(--text)',
            minWidth: '13rem',
          }}
        />
        <select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value as '' | TaskStatus })}
          aria-label="按状态筛选"
          data-testid="filter-status"
          className="h-8 rounded-[var(--radius-sm)] border px-2 text-[0.8125rem]"
          style={{
            borderColor: 'var(--border-field)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        >
          <option value="">全部状态</option>
          <option value="succeeded">已完成</option>
          <option value="failed">失败</option>
          <option value="running">运行中</option>
        </select>
        <button
          type="button"
          onClick={applyFilter}
          data-testid="filter-submit"
          className="h-8 rounded-[var(--radius-sm)] px-3 text-[0.8125rem] font-medium"
          style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
        >
          查询
        </button>
        <button
          type="button"
          onClick={reset}
          data-testid="filter-reset"
          className="h-8 rounded-[var(--radius-sm)] border px-3 text-[0.8125rem]"
          style={{
            borderColor: 'var(--border-field)',
            background: 'var(--surface)',
            color: 'var(--text-2)',
          }}
        >
          重置
        </button>
        <Link
          to="/compare"
          data-testid="goto-compare"
          className="ml-auto h-8 rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.8125rem]"
          style={{
            borderColor: 'var(--border-field)',
            color: 'var(--text-2)',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          跨任务对比
        </Link>
      </div>

      {error ? (
        <div className="mb-3">
          <NoticeBar variant="danger" title="操作失败">
            {error}
          </NoticeBar>
        </div>
      ) : null}

      {/* 列表 / 骨架 / 空态 */}
      {loading ? (
        <div data-testid="history-skeleton">
          {/* 🔒 UX-P09-06：3 行骨架。高度对齐真实行高（2.4rem），
              否则内容落位时会跳动 —— 骨架的意义是「稳住布局」。 */}
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-2">
              <Skeleton className="h-[2.4rem]" />
            </div>
          ))}
        </div>
      ) : firstUse ? (
        <EmptyState
          title="还没有任何预测任务"
          description="上传销量数据并运行一次预测后，任务会出现在这里，随时可以回看当时的参数与结果。"
          action={
            <div className="flex gap-2">
              <Link
                to="/upload"
                data-testid="empty-upload"
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[0.8125rem] font-medium"
                style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
              >
                上传数据开始预测
              </Link>
              <Link
                to="/upload?tab=format"
                data-testid="empty-format"
                className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.8125rem]"
                style={{ borderColor: 'var(--border-field)', color: 'var(--text-2)' }}
              >
                查看数据格式要求
              </Link>
            </div>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="没有符合条件的任务"
          description="试试调整关键词或状态筛选。"
          action={
            <button
              type="button"
              onClick={reset}
              className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.8125rem]"
              style={{ borderColor: 'var(--border-field)', color: 'var(--text-2)' }}
            >
              清除筛选
            </button>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8125rem]" data-testid="history-table">
              <thead>
                <tr style={{ color: 'var(--text-3)' }}>
                  <Th align="left">任务</Th>
                  <Th align="left" hideMd>提交时间</Th>
                  <Th align="right" hideMd>步长</Th>
                  <Th align="right" hideMd>序列数</Th>
                  <Th align="right">加权 MAPE</Th>
                  <Th align="right">基线提升</Th>
                  <Th align="left" hideMd>分级 L1·L2·L3</Th>
                  <Th align="right" hideMd>耗时</Th>
                  <Th align="center">状态</Th>
                  <Th align="right">操作</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr
                    key={it.task_id}
                    data-testid={`history-row-${it.task_id}`}
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    <Td align="left">
                      <Link
                        to={`/history/${it.task_id}`}
                        data-testid={`history-link-${it.task_id}`}
                        style={{ color: 'var(--text)', fontWeight: 500 }}
                      >
                        {it.task_name ?? `任务 #${it.task_id}`}
                      </Link>
                      <p className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                        {it.dataset_name}
                      </p>
                    </Td>
                    <Td align="left" hideMd>
                      <span style={{ color: 'var(--text-2)' }}>{it.created_at}</span>
                    </Td>
                    <Td align="right" hideMd>{it.horizon} 天</Td>
                    <Td align="right" hideMd>{it.series_total}</Td>
                    <Td align="right">
                      {/* 🔒 UX-P09-03：无值显示「—」，不显示 0 */}
                      <span
                        style={{
                          color:
                            it.weighted_mape === null
                              ? 'var(--text-3)'
                              : it.weighted_mape <= THRESHOLDS.weighted_mape_max
                                ? 'var(--success)'
                                : 'var(--danger)',
                        }}
                        data-testid={`mape-${it.task_id}`}
                      >
                        {it.weighted_mape === null ? '—' : `${it.weighted_mape.toFixed(2)}%`}
                      </span>
                    </Td>
                    <Td align="right">
                      <span
                        style={{
                          color:
                            it.mae_improve_pct === null
                              ? 'var(--text-3)'
                              : it.mae_improve_pct >= THRESHOLDS.baseline_improve_min
                                ? 'var(--success)'
                                : 'var(--danger)',
                        }}
                      >
                        {it.mae_improve_pct === null
                          ? '—'
                          : `${it.mae_improve_pct.toFixed(2)}%`}
                      </span>
                    </Td>
                    <Td align="left" hideMd>
                      {/* 🔒 UX-P09-02：紧凑形式 81 / 32 / 0 */}
                      <span className="tabular-nums" style={{ color: 'var(--text-2)' }}>
                        {it.series_total} 序列
                      </span>
                    </Td>
                    <Td align="right" hideMd>
                      <span style={{ color: 'var(--text-2)' }}>
                        {it.duration_ms === null
                          ? '—'
                          : `${(it.duration_ms / 1000).toFixed(1)} s`}
                      </span>
                    </Td>
                    <Td align="center">
                      <StatusBadge status={it.status} errorCode={it.error_code} />
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1.5">
                        <Link
                          to={`/history/${it.task_id}`}
                          className="rounded-[var(--radius-sm)] border px-2 py-1 text-[0.75rem]"
                          style={{ borderColor: 'var(--border-field)', color: 'var(--text-2)' }}
                        >
                          详情
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingDelete(it);
                            setTypedId('');
                          }}
                          data-testid={`delete-${it.task_id}`}
                          className="rounded-[var(--radius-sm)] border px-2 py-1 text-[0.75rem]"
                          style={{ borderColor: 'var(--border-field)', color: 'var(--danger)' }}
                        >
                          删除
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <div className="mt-3 flex items-center justify-end gap-2" data-testid="history-pager">
              <span className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
                第 {page} / {pages} 页，共 {total} 条
              </span>
              <PagerBtn
                disabled={page <= 1}
                onClick={() => setQuery({ ...query, page: page - 1 })}
                label="上一页"
                testId="page-prev"
              />
              <PagerBtn
                disabled={page >= pages}
                onClick={() => setQuery({ ...query, page: page + 1 })}
                label="下一页"
                testId="page-next"
              />
            </div>
          ) : null}
        </>
      )}

      {/* 🔒 删除二次确认：页内 + 逐字输入任务 ID（UX-P09-04） */}
      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 23, 42, 0.45)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-title"
          data-testid="delete-dialog"
        >
          <div
            className="w-full max-w-md rounded-[var(--radius)] border p-5"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <h2 id="del-title" className="text-[1.0625rem] font-semibold" style={{ color: 'var(--text)' }}>
              删除任务 #{pendingDelete.task_id}
            </h2>
            <div className="mt-3">
              <NoticeBar variant="danger" title="此操作不可撤销">
                删除后该任务将从列表中消失。其预测结果与指标仍保留在数据库中，可由管理员查回，
                但你无法再从界面访问。
                <br />
                <strong>若只是不想在列表中看到，请使用筛选而非删除。</strong>
              </NoticeBar>
            </div>
            <p className="mt-3 text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
              请输入任务 ID <code style={{ color: 'var(--text)' }}>{pendingDelete.task_id}</code>{' '}
              以确认：
            </p>
            <input
              value={typedId}
              onChange={(e) => setTypedId(e.target.value)}
              aria-label="确认任务 ID"
              data-testid="delete-confirm-input"
              className="mt-1.5 h-9 w-full rounded-[var(--radius-sm)] border px-2.5 text-[0.875rem]"
              style={{ borderColor: 'var(--border-field)', background: 'var(--surface)', color: 'var(--text)' }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingDelete(null);
                  setTypedId('');
                }}
                data-testid="delete-cancel"
                className="h-9 rounded-[var(--radius-sm)] border px-3.5 text-[0.8125rem]"
                style={{ borderColor: 'var(--border-field)', color: 'var(--text-2)' }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={doDelete}
                // 🔒 输入不匹配时按钮禁用 —— 不靠「点了再报错」，
                //    逐字输入的意义就是让误操作在物理上不可能发生
                disabled={typedId.trim() !== String(pendingDelete.task_id) || deleting}
                data-testid="delete-confirm"
                className="h-9 rounded-[var(--radius-sm)] px-3.5 text-[0.8125rem] font-medium disabled:opacity-50"
                style={{ background: 'var(--danger)', color: 'var(--on-danger)' }}
              >
                {deleting ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- 子组件 */

function SummaryCell({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
  testId: string;
}) {
  return (
    <div
      className="rounded-[var(--radius)] border px-3.5 py-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      data-testid={testId}
    >
      <p className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
      <p
        className="mt-1 text-[1.25rem] font-semibold tabular-nums"
        style={{ color: tone === 'danger' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--text)' }}
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({
  status,
  errorCode,
}: {
  status: TaskStatus;
  errorCode: string | null;
}) {
  const map: Record<TaskStatus, { bg: string; fg: string; text: string }> = {
    succeeded: { bg: 'var(--success-soft)', fg: 'var(--on-success-soft)', text: '已完成' },
    failed: { bg: 'var(--danger-soft)', fg: 'var(--on-danger-soft)', text: errorCode ?? '失败' },
    running: { bg: 'var(--warning-soft)', fg: 'var(--on-warning-soft)', text: '运行中' },
    created: { bg: 'var(--bg-subtle)', fg: 'var(--text-3)', text: '排队中' },
  };
  const s = map[status];
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[0.6875rem] font-medium"
      style={{ background: s.bg, color: s.fg }}
      data-testid={`status-${status}`}
    >
      {s.text}
    </span>
  );
}

function PagerBtn({
  disabled,
  onClick,
  label,
  testId,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className="h-7 rounded-[var(--radius-sm)] border px-2.5 text-[0.75rem] disabled:opacity-40"
      style={{ borderColor: 'var(--border-field)', color: 'var(--text-2)' }}
    >
      {label}
    </button>
  );
}

/** 🔒 ≤1080px 隐藏次要列（`UX-P04-04` 同源），保留任务 / MAPE / 耗时 */
function Th({
  children,
  align,
  hideMd,
}: {
  children: React.ReactNode;
  align: 'left' | 'right' | 'center';
  hideMd?: boolean;
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-2.5 py-2 text-[0.75rem] font-medium ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${hideMd ? 'hide-md' : ''}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  hideMd,
}: {
  children: React.ReactNode;
  align: 'left' | 'right' | 'center';
  hideMd?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-2.5 py-2.5 align-middle ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${hideMd ? 'hide-md' : ''}`}
    >
      {children}
    </td>
  );
}