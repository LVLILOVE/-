/**
 * `UX-P07` 右栏 · 任务信息 / 序列分级（实时）/ 为什么不需要在线训练 / 操作
 * -----------------------------------------------------------------------------
 * 依据：《UI/UX 设计文档 V1.0》§8.3「右栏」四块。
 *
 * 设计要点：
 *   1. 全部取值由页面传下来，本组件**不自己取数** —— 右栏与左主体必须同源，
 *      各取一次会出现「左边说 L1=81，右边说 L1=72」这类自相矛盾。
 *   2. 分级占比条的宽度 = 计数 / 总数，三项之和必须 = 总序列数（`UX-AC-06`）。
 *      L3 不可预测是**必须披露**的事实（`FR-VIS-07`），不能因为「看着不好看」
 *      就不显示 —— 隐去 L3 等于让用户以为全部序列都由模型预测。
 *   3. 「为什么不需要在线训练」是一段**固定的技术说明**，不随任务变化，
 *      故写成常量。它解释了 `📌` 已确认决策「纯预训练推理」的存在理由。
 */
import { Link } from 'react-router-dom';

import NoticeBar from '../NoticeBar';
import type { ReactNode } from 'react';
import type { TaskStatusResponse, TaskStatus, CreateTaskResponse } from '../../types';

export type RunAsideProps = {
  taskId: number;
  /** `API-13` 的权威状态（可能尚未取到） */
  status: TaskStatusResponse | null;
  /** `API-12` 的完整响应（含 timing / coverage），仅本次会话内有 */
  result: CreateTaskResponse | null;
  /** 数据文件名；未知时为 null */
  fileName: string | null;
  /** 提交时间（本地渲染的字符串） */
  submittedAt: string;
  horizon: number;
  holiday: boolean;
  modelVersion: string;
  onRefresh: () => void;
  refreshing: boolean;
};

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0"
      style={{ borderColor: 'var(--border)' }}
    >
      <span className="flex-none text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
        {k}
      </span>
      <span
        className={`truncate text-[0.75rem] font-semibold ${mono ? 'mono' : ''}`}
        title={v}
      >
        {v}
      </span>
    </div>
  );
}

function AsideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius-sm)] border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <h4 className="mb-2 text-[0.875rem]">{title}</h4>
      {children}
    </div>
  );
}

/** 分级占比条（三条之和 = 总序列数） */
function LevelBar({
  name,
  count,
  total,
  color,
  testId,
}: {
  name: string;
  count: number | null;
  total: number | null;
  color: string;
  testId: string;
}) {
  const pct = count !== null && total ? (count / total) * 100 : 0;
  return (
    <div className="mt-2 first:mt-0" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[0.75rem]">
          <span
            aria-hidden
            className="inline-block h-[8px] w-[8px] rounded-full"
            style={{ background: color }}
          />
          {name}
        </span>
        <span className="mono text-[0.75rem] font-semibold">
          {count === null ? '—' : count.toLocaleString('en-US')}
          {count !== null && total ? (
            <span className="ml-1 font-normal" style={{ color: 'var(--text-3)' }}>
              {pct.toFixed(1)}%
            </span>
          ) : null}
        </span>
      </div>
      <span
        className="mt-1 block h-[6px] overflow-hidden rounded-full"
        style={{ background: 'var(--surface-2)' }}
        role="img"
        aria-label={`${name} ${count ?? 0} 条，占 ${pct.toFixed(1)}%`}
      >
        <i className="block h-full rounded-full" style={{ width: `${pct.toFixed(2)}%`, background: color }} />
      </span>
    </div>
  );
}

const STATUS_TEXT: Record<TaskStatus, string> = {
  created: '已创建',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
};

export default function RunAside({
  taskId,
  status,
  result,
  fileName,
  submittedAt,
  horizon,
  holiday,
  modelVersion,
  onRefresh,
  refreshing,
}: RunAsideProps) {
  const total = status?.series_count ?? result?.series_count ?? null;
  const l1 = status?.l1_count ?? result?.coverage?.L1 ?? null;
  const l2 = status?.l2_count ?? result?.coverage?.L2 ?? null;
  const l3 = status?.l3_count ?? result?.coverage?.L3 ?? null;

  return (
    <div className="flex flex-col gap-4" data-testid="run-aside">
      <AsideCard title="任务信息">
        <dl className="text-[0.75rem]" data-testid="aside-task">
          <Row k="任务 ID" v={`#${taskId}`} mono />
          <Row k="状态" v={status ? STATUS_TEXT[status.status] : '读取中…'} />
          <Row k="提交时间" v={submittedAt} mono />
          <Row k="数据文件" v={fileName ?? '—'} />
          <Row k="序列数" v={total === null ? '—' : `${total} 条`} mono />
          <Row k="预测步长" v={`${horizon} 天`} />
          <Row k="节假日特征" v={holiday ? '开启' : '关闭'} />
          <Row k="模型版本" v={modelVersion} mono />
        </dl>
      </AsideCard>

      <AsideCard title="序列分级">
        {total === null ? (
          <p className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
            读取中…
          </p>
        ) : (
          <>
            <LevelBar
              name="L1 模型推理"
              count={l1}
              total={total}
              color="var(--success)"
              testId="aside-l1"
            />
            <LevelBar
              name="L2 商品级降级"
              count={l2}
              total={total}
              color="var(--warning)"
              testId="aside-l2"
            />
            <LevelBar
              name="L3 不可预测"
              count={l3}
              total={total}
              color="var(--text-3)"
              testId="aside-l3"
            />
            <p className="mt-2 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
              三项之和 = {total} 条（结果页会再做一次覆盖率披露核对）。
              L2/L3 走规则兜底，<strong>不计入主指标</strong>。
            </p>
          </>
        )}
      </AsideCard>

      <NoticeBar variant="info" title="为什么不需要在线训练">
        端到端 SLA 只有 60 秒，而「训练 + 网格搜索调参 + 早停」无法稳定压进这个窗口。
        因此本系统采用<strong>纯预训练推理</strong>：模型在离线侧训练好并注册权重，
        在线只做加载与前向计算。
      </NoticeBar>

      <AsideCard title="操作">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            data-testid="aside-refresh"
            className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.75rem] font-semibold"
            style={{
              borderColor: 'var(--border-field)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              cursor: refreshing ? 'progress' : 'pointer',
            }}
          >
            {refreshing ? '刷新中…' : '刷新进度'}
          </button>
          <Link
            to="/upload"
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[0.75rem] font-semibold"
            style={{ background: 'none', color: 'var(--primary)' }}
          >
            再预测一份数据
          </Link>
        </div>
      </AsideCard>
    </div>
  );
}
