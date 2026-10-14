/**
 * `AD-P01` 运营看板（`CH-01` / `FR-ADM-01`）—— 路径 `/admin`
 * =============================================================================
 * 🔒 **模板 A（后台布局）+ 复用既有组件，不新增设计令牌**（§5.6 / `QD-01`）。
 *    管理端不是「另一套产品」，而是同一套后台里多出来的两个页面。
 *    本页**零新增 CSS 变量、零新增颜色字面量** ——
 *    `scripts/verify_ep8.py` 会对本文件做「零 hex / 零新令牌」断言。
 *
 * 🔒 **成功率的分母不含未完成任务**（`WS-8-05` 口径）：
 *    `succeeded / (succeeded + failed)`。把 `created`/`running` 算进分母，
 *    「刚上传还没点预测」会被记成失败，运营看到成功率下跌会去查模型。
 *
 * 🔒 **MAPE 走势显示「—」而不是 0**（沿用 `UX-P09-03` 的纪律）：
 *    失败任务没有 `metrics`，显示 0 会被读成「预测完全准确」。
 *    同理，`null` 的语义是「算不出来」而非「很好」——
 *    这与 `EP-6` 修掉的「null 染成红色」是同一个教训。
 *
 * 🔒 **模型卡必须显眼展示 `env_match`**（`BE-ADM-03`）：
 *    数据库说v2、进程跑 v1 是**静默故障** —— 预测照样出结果，
 *    只是用的老模型，指标上看不出来。所以这一条不能折叠成小字备注。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EChartsOption } from 'echarts';

import { ApiError, adminApi } from '../api/client';
import Card from '../components/Card';
import NoticeBar from '../components/NoticeBar';
import { Skeleton } from '../components/Skeleton';
import { THRESHOLDS, type AdminModelList, type AdminOverview } from '../types';
import { readTokenVar } from '../theme/echarts-theme';

/**
 * 🔒 **ECharts 必须懒加载**（`EP-3` 的 1381 kB → 343 kB 优化，`UX-GOV-02a`）。
 *    顶层 `import EChart from '../components/EChart'` 会把整个 echarts
 *    （~1.2 MB）打进主包 —— 因为本组件模块内是 `import * as echarts`。
 *    路由是全静态导入的，任何一处顶层引用都会污染主包。
 *    📌 `import type { EChartsOption } from 'echarts'` 是**类型导入**，
 *    编译后被完全擦除，不会进包 —— 与运行时导入是两回事，不要混为一谈。
 */
const EChart = lazy(() => import('../components/EChart'));

/** 顶部指标带的五项（§5.6「顶部指标带」） */
const TOP_CARDS = [
  { key: 'user_count', label: '注册用户', unit: '人' },
  { key: 'dataset_count', label: '数据集', unit: '个' },
  { key: 'task_count', label: '预测任务', unit: '次' },
  { key: 'success_rate', label: '任务成功率', unit: '%' },
  { key: 'avg_duration_ms', label: '平均端到端耗时', unit: 'ms' },
] as const;

/** 埋点概览要展示的事件（固定顺序，避免字典序导致每次渲染顺序不同） */
const EVENT_ORDER = ['upload', 'predict', 'export', 'login', 'register'];

const EVENT_LABEL: Record<string, string> = {
  upload: '数据集上传',
  predict: '发起预测',
  export: '结果导出',
  login: '登录',
  register: '注册',
};

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [models, setModels] = useState<AdminModelList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState('');
  const [switchWarn, setSwitchWarn] = useState<string[]>([]);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 两个接口并发拉，不串行 —— 看板是「刷新一次看全」的页面
      const [ov, md] = await Promise.all([adminApi.overview(30), adminApi.listModels()]);
      setOverview(ov);
      setModels(md);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '看板数据加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSwitch(version: string) {
    setSwitching(version);
    setSwitchWarn([]);
    try {
      const r = await adminApi.switchModel(version);
      // 🔒 `warnings` 必须展示 —— 见文件头 `BE-ADM-03` 说明
      setSwitchWarn(r.warnings ?? []);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '切换失败，请稍后重试');
    } finally {      setSwitching('');
      setPendingVersion(null);
    }
  }

  const trendOption = useMemo<EChartsOption>(() => {
    // 🔒 过滤掉 `weighted_mape === null` 的点（失败任务无 metrics）。
    //    保留它们会让折线「掉到 0」，被读成「预测极差」。
    const pts = (overview?.mape_trend ?? []).filter(
      (p): p is typeof p & { weighted_mape: number } => p.weighted_mape !== null,
    );
    const c1 = readTokenVar('--c1');
    const c3 = readTokenVar('--c3');
    const text2 = readTokenVar('--text-2');
    const border = readTokenVar('--border');
    return {
      grid: { left: 44, right: 16, top: 24, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => `${Number(v).toFixed(2)}%`,
      },
      xAxis: {
        type: 'category',
        data: pts.map((p) => p.created_at.slice(5, 10)),
        axisLabel: { color: text2, fontSize: 11 },
        axisLine: { lineStyle: { color: border } },
      },
      yAxis: {
        type: 'value',
        name: '加权 MAPE(%)',
        nameTextStyle: { color: text2, fontSize: 11 },
        axisLabel: { color: text2, fontSize: 11 },
        splitLine: { lineStyle: { color: border, type: 'dashed' as const } },
      },
      series: [
        {
          name: '加权 MAPE',
          type: 'line' as const,
          smooth: true,
          data: pts.map((p) => p.weighted_mape),
          // 🔒 显式绑定令牌色：依赖「按系列序号取色」会在有null 点时错位
          lineStyle: { color: c1, width: 2 },
          itemStyle: { color: c1 },
          // 🔒 阈值参考线：让运营一眼看出「有没有跌破 20% 红线」
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: c3, type: 'dashed' as const, width: 1 },
            label: {
              formatter: `验收阈值 ${THRESHOLDS.weighted_mape_max}%`,
              color: c3,
              fontSize: 10,
              position: 'insideEndTop' as const,
            },
            data: [{ yAxis: THRESHOLDS.weighted_mape_max }],
          },
        },
      ],
    };
  }, [overview]);

  const eventOption = useMemo<EChartsOption>(() => {
    const counts = overview?.event_counts ?? {};
    const names = EVENT_ORDER.filter((n) => counts[n] !== undefined);
    const c1 = readTokenVar('--c1');
    const text2 = readTokenVar('--text-2');
    const border = readTokenVar('--border');
    return {
      grid: { left: 90, right: 24, top: 12, bottom: 20 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'value' as const,
        axisLabel: { color: text2, fontSize: 11 },
        splitLine: { lineStyle: { color: border, type: 'dashed' as const } },
      },
      yAxis: {
        type: 'category' as const,
        data: names.map((n) => EVENT_LABEL[n] ?? n),
        axisLabel: { color: text2, fontSize: 11 },
        axisLine: { lineStyle: { color: border } },
      },
      series: [
        {
          type: 'bar' as const,
          data: names.map((n) => counts[n] ?? 0),
          itemStyle: { color: c1, borderRadius: [0, 3, 3, 0] },
          barMaxWidth: 18,
        },
      ],
    };
  }, [overview]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {TOP_CARDS.map((c) => (
            <Skeleton key={c.key} className="h-[5.2rem]" />
          ))}
        </div>
        <Skeleton className="h-[19rem]" />
      </div>
    );
  }

  const am = overview?.active_model ?? null;
  const hasTrend = (overview?.mape_trend ?? []).some((p) => p.weighted_mape !== null);

  return (
    <div className="flex flex-col gap-4" data-testid="admin-dashboard">
      {error && (
        <NoticeBar variant="danger" title="看板加载失败">
          {error}
        </NoticeBar>
      )}

      {/* ---------- 顶部指标带 ---------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="overview-cards">
        {TOP_CARDS.map((c) => {
          const raw = overview ? (overview[c.key] as number | null) : null;
          const text =
            raw === null || raw === undefined
              ? '—'
              : c.key === 'avg_duration_ms'
                ? `${Math.round(raw)}`
                : `${raw}`;
          return (
            <div
              key={c.key}
              className="rounded-[var(--radius)] border px-3.5 py-3"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              data-testid={`ov-${c.key}`}
            >
              <div className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
                {c.label}
              </div>
              <div
                className="mt-1 text-[1.25rem] font-semibold tabular-nums"
                style={{ color: 'var(--text-1)' }}
              >
                {text}
                {raw !== null && raw !== undefined && (
                  <span
                    className="ml-1 text-[0.75rem] font-normal"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {c.unit}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------- 任务质量：MAPE 走势 ---------- */}
      <Card
        title="任务质量 · 近 30 天加权 MAPE 走势"
        badge={
          overview?.avg_mape !== null && overview?.avg_mape !== undefined ? (
            <span
              className="rounded-full px-2 py-0.5 text-[0.6875rem] tabular-nums"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              均值 {overview.avg_mape}%
            </span>
          ) : undefined
        }
        testId="mape-trend-card"
      >
        {hasTrend ? (
          <Suspense fallback={<Skeleton className="h-[16.25rem]" />}>
            <EChart
              option={trendOption}
              height={260}
              testId="mape-trend-chart"
              ariaLabel="近30 天加权 MAPE 走势折线图"
            />
          </Suspense>
        ) : (
          <div
            className="flex h-[13rem] flex-col items-center justify-center gap-1 text-center"
            style={{ color: 'var(--text-3)' }}
          >
            <p className="text-[0.8125rem]">近 30 天还没有产出指标的任务</p>
            <p className="text-[0.75rem]">
              任务成功完成并落库指标后，这里会出现加权 MAPE 的走势曲线。
            </p>
          </div>
        )}
        {hasTrend && (
          <p className="mt-2 text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
            ⚠️ 折线只包含<b style={{ color: 'var(--text-2)' }}>成功产出指标</b>的任务；
            失败与进行中的任务因无指标被跳过（不按 0 计入）。
            虚线为 PRD §3.4.3 的验收阈值 {THRESHOLDS.weighted_mape_max}%。
          </p>
        )}
      </Card>

      {/* ---------- 模型版本 ---------- */}
      <Card
        title="模型版本"
        actions={
          <button
            type="button"
            className="rounded-[var(--radius-md)] px-3 py-1.5 text-[0.75rem]"
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            onClick={() => navigate('/admin/manage')}
          >
            前往管理页
          </button>
        }
        testId="model-card"
      >
        {am && (
          <div
            className="mb-3 rounded-[var(--radius-md)] border px-3.5 py-3"
            style={{
              borderColor: am.env_match ? 'var(--border)' : 'var(--danger)',
              background: 'var(--surface-2)',
            }}
            data-testid="active-model"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[0.6875rem]"
                style={{ background: 'var(--primary)', color: 'var(--primary-fg)' }}
              >
                当前启用
              </span>
              <b className="text-[0.9375rem]" style={{ color: 'var(--text-1)' }}>
                {am.version}
              </b>
              {/* 🔒 `BE-ADM-03` 的核心落点：漂移必须显眼，不能折叠 */}
              {!am.env_match && (
                <span
                  className="rounded-full px-2 py-0.5 text-[0.6875rem]"
                  style={{ background: 'var(--danger)', color: 'var(--danger-fg)' }}
                  data-testid="env-drift-badge"
                >
                  ⚠️ 与 .env 不一致，需同步并重启
                </span>
              )}
            </div>
            <dl
              className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[0.75rem] sm:grid-cols-4"
              style={{ color: 'var(--text-3)' }}
            >
              <div>
                <dt>窗口 / 隐藏层</dt>
                <dd className="tabular-nums" style={{ color: 'var(--text-2)' }}>
                  {am.window_size} / {am.hidden_size}
                </dd>
              </div>
              <div>
                <dt>参数量</dt>
                <dd className="tabular-nums" style={{ color: 'var(--text-2)' }}>
                  {am.param_count?.toLocaleString() ?? '—'}
                </dd>
              </div>
              <div>
                <dt>验证 MAPE</dt>
                <dd className="tabular-nums" style={{ color: 'var(--text-2)' }}>
                  {am.val_mape !== null ? `${am.val_mape}%` : '—'}
                </dd>
              </div>
              <div>
                <dt>训练设备</dt>
                <dd style={{ color: 'var(--text-2)' }}>{am.device ?? '—'}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr style={{ color: 'var(--text-3)' }}>
                <th className="py-1.5 text-left font-normal">版本</th>
                <th className="py-1.5 text-left font-normal">结构</th>
                <th className="py-1.5 text-right font-normal">验证 MAPE</th>
                <th className="py-1.5 text-right font-normal">参数量</th>
                <th className="py-1.5 text-right font-normal">训练时间</th>
                <th className="py-1.5 text-right font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {(models?.items ?? []).map((m) => (
                <tr
                  key={m.version}
                  style={{ borderTop: '1px solid var(--border)' }}
                  data-testid={`model-row-${m.version}`}
                >
                  <td className="py-2" style={{ color: 'var(--text-1)' }}>
                    <span className="font-medium">{m.version}</span>
                    {m.is_active && (
                      <span
                        className="ml-1.5 rounded-full px-1.5 py-0.5 text-[0.625rem]"
                        style={{ background: 'var(--primary)', color: 'var(--primary-fg)' }}
                      >
                        启用
                      </span>
                    )}
                  </td>
                  <td className="py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>
                    w{m.window_size}·h{m.hidden_size}·L{m.num_layers}
                  </td>
                  <td
                    className="py-2 text-right tabular-nums"
                    style={{ color: 'var(--text-2)' }}
                  >
                    {m.val_mape !== null ? `${m.val_mape}%` : '—'}
                  </td>
                  <td
                    className="py-2 text-right tabular-nums"
                    style={{ color: 'var(--text-2)' }}
                  >
                    {m.param_count?.toLocaleString() ?? '—'}
                  </td>
                  <td className="py-2 text-right" style={{ color: 'var(--text-3)' }}>
                    {m.trained_at ?? '—'}
                  </td>
                  <td className="py-2 text-right">
                    {m.is_active ? (
                      <span className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
                        当前使用中
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-[var(--radius-md)] px-2.5 py-1 text-[0.75rem]"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                        disabled={switching !== ''}
                        data-testid={`switch-${m.version}`}
                        onClick={() => setPendingVersion(m.version)}
                      >
                        {switching === m.version ? '切换中…' : '切换到此版本'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------- 埋点概览 ---------- */}
      <Card title="埋点概览 · 近 30 天" testId="event-card">
        {Object.keys(overview?.event_counts ?? {}).length === 0 ? (
          <p className="py-6 text-center text-[0.8125rem]" style={{ color: 'var(--text-3)' }}>
            近 30 天暂无埋点记录
          </p>
        ) : (
          <Suspense fallback={<Skeleton className="h-[11.875rem]" />}>
            <EChart
              option={eventOption}
              height={190}
              testId="event-chart"
              ariaLabel="近30 天关键事件计数柱状图"
            />
          </Suspense>
        )}
      </Card>

      {/* ---------- 切换二次确认 ---------- */}
      {pendingVersion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 23, 42, 0.45)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="switch-title"
          data-testid="switch-dialog"
        >
          <div
            className="w-full max-w-md rounded-[var(--radius)] border p-5"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            data-testid="switch-dialog-panel"
          >
            <h2
              id="switch-title"
              className="text-[1.0625rem] font-semibold"
              style={{ color: 'var(--text-1)' }}
            >
              确认切换模型版本？
            </h2>
            <p className="mt-2 text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
              即将把启用版本切换为
              <b style={{ color: 'var(--text-1)' }}> {pendingVersion}</b>。
            </p>
            <ul
              className="mt-2.5 flex list-disc flex-col gap-1 pl-5 text-[0.75rem]"
              style={{ color: 'var(--text-3)' }}
            >
              <li>该操作会立即生效，后续新建的预测任务将使用新版本。</li>
              <li>
                🔒 若 <code>.env</code> 的 <code>ACTIVE_MODEL</code> 未同步，
                <b style={{ color: 'var(--text-2)' }}>服务重启后会回退到原版本</b>。
              </li>
              <li>已完成的任务与历史指标不受影响。</li>
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-[var(--radius-md)] px-3 py-1.5 text-[0.8125rem]"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                onClick={() => setPendingVersion(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-[var(--radius-md)] px-3 py-1.5 text-[0.8125rem]"
                style={{ background: 'var(--primary)', color: 'var(--primary-fg)' }}
                data-testid="switch-confirm"
                onClick={() => void onSwitch(pendingVersion)}
              >
                确认切换
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- 切换后的警告（`BE-ADM-03`） ---------- */}
      {switchWarn.length > 0 && (
        <NoticeBar variant="warning" title="模型已切换，但需注意" data-testid="switch-warning">
          <ul className="ml-4 flex list-disc flex-col gap-1">
            {switchWarn.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </NoticeBar>
      )}
    </div>
  );
}
