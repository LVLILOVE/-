/**
 * 跨任务对比（`UX-P11` / `FR-HIS-04`，P1）
 * =============================================================================
 * 🔒 **最多 4 个任务**（`UX-P11-01`），勾选第 5 个时按钮禁用并说明原因。
 *    上限 4 是产品决策：并排 4 列在 1280px 下才不挤，5 列必然压缩到读不出。
 *
 * 🔒 **最优值高亮必须「取最小值」**（`UX-P11-02`）：
 *    本项目的 MAPE / MAE / RMSE / 耗时全是**误差与耗时指标，越小越好**。
 *    若照搬「数值最大即最优」的通用写法，会把最差的指标涂成绿色 ——
 *    这是对比页最容易犯、也最刺眼的错误。高亮逻辑与语义必须同源。
 *
 * 🔒 **数据文件不一致要显著提示**（`UX-P11-04` / `API-18-3`）：
 *    跨数据集对比**允许**，但指标差异可能来自数据本身而非模型。
 *    只在角落放一行小字等于没提示 —— 结论会被误读。
 *
 * ⚠️ **失败任务不参与曲线对比**（`UX-P11-06`）：可以在选择列表里看到
 *    （用户需要知道它存在），但它的指标与曲线为空，不能参与「最优值」评选。
 *    让失败任务的空值参与比较会污染高亮。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, historyApi } from '../api/client';
import EmptyState from '../components/EmptyState';
import NoticeBar from '../components/NoticeBar';
import { Skeleton } from '../components/Skeleton';
import type { CompareResponse, CompareTaskSlot, HistoryItem } from '../types';

const MAX_TASKS = 4;
const MIN_TASKS = 2;

export default function ComparePage() {
  const [tasks, setTasks] = useState<HistoryItem[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await historyApi.list({ page: 1, size: 100, status: undefined });
        if (!alive) return;
        // 🔒 只列**成功**任务：失败任务无法参与指标对比，
        //    放进选择表只会让用户选了个空结果。
        setTasks(d.items.filter((i) => i.status === 'succeeded'));
      } catch (e) {
        if (alive) {
          setError(e instanceof ApiError ? e.message : '加载任务列表失败');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (id: number) => {
    setResult(null);
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_TASKS) return prev;
      return [...prev, id];
    });
  };

  const run = useCallback(async () => {
    if (picked.length < MIN_TASKS) return;
    setComparing(true);
    setError('');
    try {
      const r = await historyApi.compare({ task_ids: picked });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '对比失败，请稍后重试');
    } finally {
      setComparing(false);
    }
  }, [picked]);

  const slots = result?.tasks ?? [];

  return (
    <div data-testid="compare-page">
      <header className="mb-4">
        <p className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
          记录 / 跨任务对比
        </p>
        <h1 className="mt-1 text-[1.5rem] font-semibold" style={{ color: 'var(--text)' }}>
          跨任务对比
        </h1>
        <p className="mt-1 text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
          选择 2~{MAX_TASKS} 个已完成的任务，叠加对比其指标与预测曲线。
        </p>
      </header>

      {error ? (
        <div className="mb-3">
          <NoticeBar variant="danger" title="操作失败">
            {error}
          </NoticeBar>
        </div>
      ) : null}

      {/* 🔒 UX-P11-01：任务选择 + 「已选 N / 4」实时计数 */}
      <section
        className="mb-4 rounded-[var(--radius)] border p-4"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        data-testid="task-picker"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[1.0625rem] font-semibold" style={{ color: 'var(--text)' }}>
            选择任务
          </h2>
          <span
            className="rounded-full px-2.5 py-1 text-[0.75rem] font-medium tabular-nums"
            style={{
              background: picked.length >= MIN_TASKS ? 'var(--success-soft)' : 'var(--bg-subtle)',
              color: picked.length >= MIN_TASKS ? 'var(--success)' : 'var(--text-3)',
            }}
            data-testid="picked-count"
          >
            已选 {picked.length} / {MAX_TASKS}
          </span>
        </div>

        {loading ? (
          <Skeleton className="h-[4rem]" />
        ) : tasks.length === 0 ? (
          <p className="text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
            还没有已完成的任务，先运行一次预测。
          </p>
        ) : (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto" data-testid="picker-list">
            {tasks.map((t) => {
              const on = picked.includes(t.task_id);
              const disabled = !on && picked.length >= MAX_TASKS;
              return (
                <li key={t.task_id}>
                  <label
                    className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-[0.8125rem]"
                    style={{
                      border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                      background: on ? 'var(--primary-soft)' : 'transparent',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.5 : 1,
                    }}
                    data-testid={`pick-label-${t.task_id}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled}
                      onChange={() => toggle(t.task_id)}
                      data-testid={`pick-${t.task_id}`}
                    />
                    <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>
                      {t.task_name ?? `任务 #${t.task_id}`}
                    </span>
                    <span style={{ color: 'var(--text-3)' }}>{t.horizon} 天</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-2)' }}>
                      {t.weighted_mape === null ? '—' : `${t.weighted_mape.toFixed(2)}%`}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={picked.length < MIN_TASKS || comparing}
            data-testid="run-compare"
            className="h-9 rounded-[var(--radius-sm)] px-4 text-[0.8125rem] font-medium disabled:opacity-50"
            style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
          >
            {comparing ? '对比中…' : '开始对比'}
          </button>
          {picked.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setPicked([]);
                setResult(null);
              }}
              data-testid="clear-picked"
              className="h-9 rounded-[var(--radius-sm)] border px-3 text-[0.8125rem]"
              style={{ borderColor: 'var(--border-field)', color: 'var(--text-2)' }}
            >
              清空选择
            </button>
          ) : null}
          {/* 🔒 UX-P11-06：少于 2 个时说明原因，而不是让用户点了没反应 */}
          {picked.length < MIN_TASKS ? (
            <span className="text-[0.75rem]" style={{ color: 'var(--text-3)' }} data-testid="pick-hint">
              至少需要选择 {MIN_TASKS} 个任务才能对比
            </span>
          ) : null}
        </div>
      </section>

      {comparing ? (
        <Skeleton className="h-[8rem]" />
      ) : result ? (
        <>
          {/* 🔒 UX-P11-04：数据文件不一致 → 显著警告 */}
          {!result.dataset_consistent ? (
            <div className="mb-3" data-testid="dataset-warning">
              <NoticeBar variant="danger" title="数据文件不一致，对比结果不可信">
                所选任务使用了不同的数据文件，指标差异可能来自数据本身而非模型。
                建议只对比同一数据文件的任务。
              </NoticeBar>
            </div>
          ) : null}

          {result.warnings.map((w) => (
            <div className="mb-3" key={w} data-testid="compare-warning">
              <NoticeBar variant="warning" title="对比提示">
                {w}
              </NoticeBar>
            </div>
          ))}

          <MetricTable slots={slots} />

          <Attribution result={result} />

          <SeriesSection result={result} />
        </>
      ) : !loading && tasks.length === 0 ? (
        <EmptyState
          title="没有可对比的任务"
          description="跨任务对比至少需要两个已完成的预测任务。"
          action={
            <Link
              to="/upload"
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[0.8125rem] font-medium"
              style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
            >
              新建预测任务
            </Link>
          }
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 指标表 */

type MetricRow = {
  key: string;
  label: string;
  /** 🔒 取值：越小越好（误差 / 耗时类指标） */
  lowerIsBetter: boolean;
  fmt: (v: number) => string;
  of: (s: CompareTaskSlot) => number | null;
  note?: string;
};

const ROWS: MetricRow[] = [
  {
    key: 'mape',
    label: '加权 MAPE',
    lowerIsBetter: true,
    fmt: (v) => `${v.toFixed(2)}%`,
    of: (s) => s.metrics?.weighted_mape ?? null,
    note: '硬指标 ≤ 20%',
  },
  {
    key: 'mae',
    label: '加权 MAE',
    lowerIsBetter: true,
    fmt: (v) => v.toFixed(3),
    of: (s) => s.metrics?.weighted_mae ?? null,
  },
  {
    key: 'rmse',
    label: '加权 RMSE',
    lowerIsBetter: true,
    fmt: (v) => v.toFixed(3),
    of: (s) => s.metrics?.weighted_rmse ?? null,
  },
  {
    key: 'maeImprove',
    label: 'MAE 基线提升',
    lowerIsBetter: false,
    fmt: (v) => `${v.toFixed(2)}%`,
    of: (s) => s.metrics?.mae_improve_pct ?? null,
    note: '越大越好 · 硬指标 ≥ 15%',
  },
  {
    key: 'passRate',
    label: '达标序列占比',
    lowerIsBetter: false,
    fmt: (v) => `${v.toFixed(2)}%`,
    of: (s) => s.metrics?.series_pass_rate ?? null,
    note: '越大越好 · 辅助指标 ≥ 60%',
  },
  {
    key: 'duration',
    label: '端到端耗时',
    lowerIsBetter: true,
    fmt: (v) => `${(v / 1000).toFixed(1)} s`,
    // 🔒 耗时在 `task` 上而不在 `metrics` 里（`API-14` 的 `timing_ms.total_ms`
    //    同源）。早期版本这里写死返回 null，耗时列永远显示「—」——
    //    一列永远空的指标会让用户以为对比功能缺了一块。
    of: (s) => (s.duration_ms === null ? null : s.duration_ms),
    note: '越小越好',
  },
];

function MetricTable({ slots }: { slots: CompareTaskSlot[] }) {
  return (
    <section
      className="mb-4 rounded-[var(--radius)] border p-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      data-testid="compare-metrics"
    >
      <h2 className="mb-3 text-[1.0625rem] font-semibold" style={{ color: 'var(--text)' }}>
        指标对比
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-[0.8125rem]">
          <thead>
            <tr style={{ color: 'var(--text-3)' }}>
              <th scope="col" className="px-2.5 py-2 text-left text-[0.75rem] font-medium">
                指标
              </th>
              {slots.map((s) => (
                <th
                  key={s.task_id}
                  scope="col"
                  className="px-2.5 py-2 text-right text-[0.75rem] font-medium"
                  data-testid={`col-${s.task_id}`}
                >
                  #{s.task_id}
                  <span className="ml-1" style={{ color: 'var(--text-3)' }}>
                    {s.horizon} 天
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              // 🔒 逐行独立求最优 —— 不同指标的「最优」方向不同，
              //    用统一规则整表涂色必然有一半是错的
              const values = slots.map(r.of);
              const valid = values.filter((v): v is number => v !== null);
              const best = valid.length
                ? r.lowerIsBetter
                  ? Math.min(...valid)
                  : Math.max(...valid)
                : null;
              return (
                <tr key={r.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <th scope="row" className="px-2.5 py-2 text-left font-medium" style={{ color: 'var(--text-2)' }}>
                    {r.label}
                    {r.note ? (
                      <span className="ml-1 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                        {r.note}
                      </span>
                    ) : null}
                  </th>
                  {slots.map((s, i) => {
                    const v = values[i];
                    const isBest = v !== null && best !== null && v === best && valid.length > 1;
                    return (
                      <td
                        key={s.task_id}
                        className="px-2.5 py-2 text-right tabular-nums"
                        style={{
                          color: v === null ? 'var(--text-3)' : isBest ? 'var(--success)' : 'var(--text)',
                          fontWeight: isBest ? 600 : 400,
                        }}
                        data-testid={`cell-${r.key}-${s.task_id}`}
                        data-best={isBest}
                      >
                        {v === null ? '—' : r.fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
        绿色为该行的最优值。误差类指标越小越好，提升率与占比越大越好 —— 两者方向相反。
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------- 归因 */

function Attribution({ result }: { result: CompareResponse }) {
  if (!result.attribution.length) return null;
  return (
    <section
      className="mb-4 rounded-[var(--radius)] border p-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      data-testid="compare-attribution"
    >
      <h2 className="mb-3 text-[1.0625rem] font-semibold" style={{ color: 'var(--text)' }}>
        差异归因
      </h2>
      <ul className="space-y-2">
        {result.attribution.map((a) => (
          <li key={`${a.task_id}-${a.note}`} className="flex gap-2 text-[0.8125rem]">
            <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-3)' }}>
              #{a.task_id}
            </span>
            <span style={{ color: 'var(--text-2)' }}>{a.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------- 曲线 */

function SeriesSection({ result }: { result: CompareResponse }) {
  // 🔒 只画**共有序列**：不同任务的分级与序列集合可能不同，
  //    强行按 key 补齐会出现某些任务在这条线上没有数据（图上突然断掉）。
  const keySets = result.tasks.map((t) => new Set(t.series.map((s) => s.key)));
  const common = [...(keySets[0] ?? [])].filter((k) => keySets.every((s) => s.has(k)));

  if (!common.length) {
    return (
      <section
        className="mb-4 rounded-[var(--radius)] border p-4"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        data-testid="compare-series-empty"
      >
        <h2 className="mb-2 text-[1.0625rem] font-semibold" style={{ color: 'var(--text)' }}>
          曲线对比
        </h2>
        <p className="text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
          所选任务没有共同覆盖的序列，无法叠加对比曲线。
        </p>
      </section>
    );
  }

  return (
    <section
      className="mb-4 rounded-[var(--radius)] border p-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      data-testid="compare-series"
    >
      <h2 className="mb-1 text-[1.0625rem] font-semibold" style={{ color: 'var(--text)' }}>
        曲线对比
      </h2>
      {/* 🔒 UX-P11-03：必须显式说明「历史段一致、仅预测段不同」 */}
      <p className="mb-3 text-[0.75rem]" style={{ color: 'var(--text-2)' }} data-testid="series-note">
        以下为同一条序列在各任务下的预测值。各任务的预测起点相同（都由同一份历史数据推算），
        差异只出现在预测段；若步长不同，则越靠后的日期相差越大。
      </p>
      <ul className="space-y-4" data-testid="series-list">
        {common.slice(0, 3).map((key) => (
          <li key={key}>
            <p className="mb-1 text-[0.8125rem] font-medium" style={{ color: 'var(--text)' }}>
              {key}
            </p>
            <SeriesRow key_={key} result={result} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 单条序列的多任务预测对比表（不用 ECharts：4 条线的迷你对比用表格更易读） */
function SeriesRow({ key_, result }: { key_: string; result: CompareResponse }) {
  const rows = useMemo(
    () =>
      result.tasks.map((t) => {
        const s = t.series.find((x) => x.key === key_);
        return { task: t, dates: s?.forecast_dates ?? [], values: s?.predicted ?? [] };
      }),
    [result, key_],
  );
  const len = Math.max(...rows.map((r) => r.dates.length), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.75rem]">
        <thead>
          <tr style={{ color: 'var(--text-3)' }}>
            <th scope="col" className="px-2 py-1 text-left font-medium">
              日期
            </th>
            {rows.map((r) => (
              <th key={r.task.task_id} scope="col" className="px-2 py-1 text-right font-medium">
                #{r.task.task_id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: len }).map((_, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
              <td className="px-2 py-1" style={{ color: 'var(--text-2)' }}>
                {rows.map((r) => r.dates[i]).find(Boolean) ?? ''}
              </td>
              {rows.map((r) => {
                const v = r.values[i];
                return (
                  <td key={r.task.task_id} className="px-2 py-1 text-right tabular-nums" style={{ color: v === null || v === undefined ? 'var(--text-3)' : 'var(--text)' }}>
                    {v === null || v === undefined ? '—' : v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}