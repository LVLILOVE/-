/**
 * 工作台（`UX-P04` / `FR-HIS-01`）
 * =============================================================================
 * 定位：登录后首页。回答「我上次跑得怎么样、现在要做什么」。
 *
 * 🔒 **统计数字一律来自接口**（`GET /history/dashboard`），前端不做二次聚合。
 *    服务端的「最近任务」就是 `API-17` 列表的第 1 页 —— 两处口径一旦
 *    分叉，「工作台最近任务」与「历史列表首屏」会对不上，而这种差异
 *    极难被发现（用户要点进历史页逐条比对才发现）。
 *
 * 🔒 **问候语含具体近况**（`UX-P04-05`），而不是「欢迎回来」。
 *    「最近一次任务完成于 2 小时前，加权 MAPE 14.3%，已达标」才有信息量。
 *
 * 📌 **汇总卡只 4 张**（`UX-P04-02`）：原型的 5 张是演示用，PRD 未定义
 *    工作台汇总体系。实现时按文档授权裁剪为「最近任务 + 快速入口」。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, historyApi } from '../api/client';
import NoticeBar from '../components/NoticeBar';
import { Skeleton } from '../components/Skeleton';
import { useAuthStore } from '../store/useAuthStore';
import { THRESHOLDS, type WorkbenchSummary } from '../types';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [data, setData] = useState<WorkbenchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await historyApi.dashboard();
        if (alive) setData(d);
      } catch (e) {
        if (alive) {
          setError(
            e instanceof ApiError ? e.message : '加载工作台失败，请刷新页面重试',
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const stats = data?.stats;
  const recent = data?.recent ?? [];
  // 🔒 取「最近一次**成功**」的任务做问候语：拿失败的当近况会
  //    让问候变成「最近一次失败了」，而上一条成功结果才是用户关心的
  const latestOk = recent.find((i) => i.status === 'succeeded');

  return (
    <div data-testid="dashboard-page">
      <header className="mb-5">
        <p className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
          工作台 / 概览
        </p>
        <h1 className="mt-1 text-[1.5rem] font-semibold" style={{ color: 'var(--text)' }}>
          {greeting()}，{user?.nickname ?? user?.email ?? '用户'}
        </h1>
        <p className="mt-1 text-[0.8125rem]" style={{ color: 'var(--text-2)' }} data-testid="dashboard-lede">
          {loading
            ? '正在加载最近任务…'
            : latestOk
              ? `最近一次任务完成于 ${latestOk.finished_at ?? latestOk.created_at}，加权 MAPE ${latestOk.weighted_mape?.toFixed(2)}%，${latestOk.is_over_threshold ? '未达标' : '已达标'}`
              : '还没有运行过预测任务，先上传一份销量数据试试'}
        </p>
      </header>

      {error ? (
        <div className="mb-4">
          <NoticeBar variant="danger" title="加载失败">
            {error}
          </NoticeBar>
        </div>
      ) : null}

      {/* 🔒 UX-P04-01：主按钮唯一且醒目 —— 主干入口收敛（NFR-USE-01） */}
      <div className="mb-5">
        <Link
          to="/upload"
          data-testid="cta-new-task"
          className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-[0.875rem] font-medium"
          style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
        >
          新建预测任务
        </Link>
      </div>

      {/* 汇总卡 */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="dashboard-stats">
        <StatCard
          label="累计任务"
          value={stats ? String(stats.total) : '—'}
          testId="stat-total"
        />
        <StatCard
          label="最近成功"
          value={stats ? String(stats.recent_succeeded) : '—'}
          tone="success"
          testId="stat-succeeded"
        />
        <StatCard
          label="最近失败"
          value={stats ? String(stats.recent_failed) : '—'}
          tone={stats && stats.recent_failed > 0 ? 'danger' : undefined}
          testId="stat-failed"
        />
        <StatCard
          label="平均加权 MAPE"
          value={
            stats?.recent_mape_avg === null || stats?.recent_mape_avg === undefined
              ? '—'
              : `${stats.recent_mape_avg.toFixed(2)}%`
          }
          tone={
            stats?.recent_mape_avg === null || stats?.recent_mape_avg === undefined
              ? undefined
              : stats.recent_mape_avg <= THRESHOLDS.weighted_mape_max
                ? 'success'
                : 'danger'
          }
          testId="stat-mape"
        />
      </div>

      {/* 快速开始 */}
      <h2 className="mb-2 text-[1.0625rem] font-semibold" style={{ color: 'var(--text)' }}>
        快速开始
      </h2>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickCard to="/upload" title="上传销量 CSV" desc="按模板准备历史销量数据" testId="quick-upload" />
        <QuickCard to="/upload?sample=1" title="用示例数据体验" desc="无需准备，立刻看到结果" testId="quick-sample" />
        <QuickCard to="/history" title="回看历史任务" desc="参数、指标、曲线随时复查" testId="quick-history" />
        <QuickCard to="/compare" title="跨任务对比" desc="最多 4 个任务并排比较" testId="quick-compare" />
      </div>

      {/* 最近任务 */}
      <h2 className="mb-2 text-[1.0625rem] font-semibold" style={{ color: 'var(--text)' }}>
        最近任务
      </h2>
      {loading ? (
        <div data-testid="dashboard-skeleton">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-2">
              <Skeleton className="h-[2.2rem]" />
            </div>
          ))}
        </div>
      ) : recent.length === 0 ? (
        <div
          className="rounded-[var(--radius)] border px-4 py-8 text-center"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          data-testid="dashboard-empty"
        >
          <p className="text-[0.9375rem] font-medium" style={{ color: 'var(--text)' }}>
            还没有预测任务
          </p>
          <p className="mt-1 text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
            点击上方「新建预测任务」，或先用示例数据体验完整流程
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]" data-testid="dashboard-recent">
            <thead>
              <tr style={{ color: 'var(--text-3)' }}>
                <th scope="col" className="px-2.5 py-2 text-left text-[0.75rem] font-medium">
                  任务
                </th>
                <th scope="col" className="hide-md px-2.5 py-2 text-right text-[0.75rem] font-medium">
                  步长
                </th>
                <th scope="col" className="hide-md px-2.5 py-2 text-right text-[0.75rem] font-medium">
                  序列数
                </th>
                <th scope="col" className="px-2.5 py-2 text-right text-[0.75rem] font-medium">
                  加权 MAPE
                </th>
                <th scope="col" className="hide-md px-2.5 py-2 text-right text-[0.75rem] font-medium">
                  耗时
                </th>
                <th scope="col" className="px-2.5 py-2 text-right text-[0.75rem] font-medium">
                  状态
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map((it) => (
                <tr
                  key={it.task_id}
                  data-testid={`dash-row-${it.task_id}`}
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  <td className="px-2.5 py-2.5">
                    {/* 🔒 UX-P04-03：行可点击跳转（成功→详情，失败→详情页看原因） */}
                    <Link
                      to={`/history/${it.task_id}`}
                      style={{ color: 'var(--text)', fontWeight: 500 }}
                      data-testid={`dash-link-${it.task_id}`}
                    >
                      {it.task_name ?? `任务 #${it.task_id}`}
                    </Link>
                    <p className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                      {it.created_at}
                    </p>
                  </td>
                  <td className="hide-md px-2.5 py-2.5 text-right">{it.horizon} 天</td>
                  <td className="hide-md px-2.5 py-2.5 text-right">{it.series_total}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">
                    <span
                      style={{
                        color:
                          it.weighted_mape === null
                            ? 'var(--text-3)'
                            : it.weighted_mape <= THRESHOLDS.weighted_mape_max
                              ? 'var(--success)'
                              : 'var(--danger)',
                      }}
                    >
                      {it.weighted_mape === null ? '—' : `${it.weighted_mape.toFixed(2)}%`}
                    </span>
                  </td>
                  <td className="hide-md px-2.5 py-2.5 text-right" style={{ color: 'var(--text-2)' }}>
                    {it.duration_ms === null ? '—' : `${(it.duration_ms / 1000).toFixed(1)} s`}
                  </td>
                  <td className="px-2.5 py-2.5 text-right">
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-[0.6875rem] font-medium"
                      style={{
                        background:
                          it.status === 'succeeded'
                            ? 'var(--success-soft)'
                            : it.status === 'failed'
                              ? 'var(--danger-soft)'
                              : 'var(--bg-subtle)',
                        color:
                          it.status === 'succeeded'
                            ? 'var(--success)'
                            : it.status === 'failed'
                              ? 'var(--danger)'
                              : 'var(--text-3)',
                      }}
                    >
                      {it.status === 'succeeded'
                        ? '已完成'
                        : it.status === 'failed'
                          ? (it.error_code ?? '失败')
                          : it.status === 'running'
                            ? '运行中'
                            : '排队中'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 按时段问候。刻意不显示「欢迎回来」—— 那句话不含任何信息量。 */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return '凌晨好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function StatCard({
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
        style={{
          color:
            tone === 'danger' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--text)',
        }}
      >
        {value}
      </p>
    </div>
  );
}

function QuickCard({
  to,
  title,
  desc,
  testId,
}: {
  to: string;
  title: string;
  desc: string;
  testId: string;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="rounded-[var(--radius)] border px-3.5 py-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <p className="text-[0.875rem] font-medium" style={{ color: 'var(--text)' }}>
        {title}
      </p>
      <p className="mt-0.5 text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
        {desc}
      </p>
    </Link>
  );
}