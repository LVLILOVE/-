/**
 * `UX-P06` 右栏 · 当前选择 / 预测窗口 / 稀疏性提示 / 快捷跳转
 * -----------------------------------------------------------------------------
 * 依据：《UI/UX 设计文档 V1.0》§8.2「右栏」四块。
 *
 * 设计要点（`UX-P06-05` / `UX-P06-07`）：
 *   1. 「当前选择」必须与左侧表单**同源**（全部由页面把已选值传下来），
 *      不允许本组件自己再维护一份状态 —— 否则右栏会与表单显示不一致。
 *   2. 「预测窗口」按**数据末尾日期**动态推算，并列出窗口内命中的节假日
 *      （节假日表来自 `generated/pipeline.ts`，即后端 `features.HOLIDAYS`）；
 *      原型里那张按步长写死的 `HOLIDAY_IN_WINDOW` 表是演示用的假数据，已废弃。
 */
import { Link } from 'react-router-dom';

import NoticeBar from '../NoticeBar';
import { PIPELINE_META } from '../../generated/pipeline';
import type { ReactNode } from 'react';
import type { DatasetDetailResponse, Horizon } from '../../types';

export type ParamsAsideProps = {
  detail: DatasetDetailResponse | null;
  loadError: string | null;
  horizon: Horizon;
  holiday: boolean;
  modelVersion: string;
  windowSize: number;
  windowStart: string;
  windowEnd: string;
  /** 窗口内命中的节假日名（去重，按日期顺序） */
  holidayNames: string[];
  /** 本次预估端到端耗时（ms）；无数据时为 null */
  estimateMs: number | null;
};

/** 一行「键 → 值」 */
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
        style={{ margin: 0 }}
        title={v}
      >
        {v}
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
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

export default function ParamsAside({
  detail,
  loadError,
  horizon,
  holiday,
  modelVersion,
  windowSize,
  windowStart,
  windowEnd,
  holidayNames,
  estimateMs,
}: ParamsAsideProps) {
  const seriesTotal = detail?.level_preview.total ?? null;

  return (
    <div className="flex flex-col gap-4" data-testid="params-aside">
      <Card title="当前选择">
        {loadError ? (
          <p className="text-[0.75rem]" style={{ color: 'var(--danger)' }}>
            {loadError}
          </p>
        ) : !detail ? (
          <p className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
            读取中…
          </p>
        ) : (
          <dl className="text-[0.75rem]" style={{ color: 'var(--text-2)' }} data-testid="aside-selection">
            <Row k="预测粒度" v="仓库 × 商品" />
            <Row k="预测步长" v={`${horizon} 天`} />
            <Row k="节假日特征" v={holiday ? '开启' : '关闭'} />
            <Row k="滑动窗口" v={`${windowSize} 天`} />
            <Row k="模型版本" v={modelVersion} mono />
            <Row k="序列数" v={`${seriesTotal} 条`} mono />
            <Row
              k="输出预测点"
              v={seriesTotal === null ? '—' : `${(seriesTotal * horizon).toLocaleString('zh-CN')} 个`}
              mono
            />
            {estimateMs !== null ? (
              <Row k="预估耗时" v={`${(estimateMs / 1000).toFixed(1)} s`} mono />
            ) : null}
          </dl>
        )}
      </Card>

      <Card title="预测窗口">
        {!detail ? (
          <p className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
            读取中…
          </p>
        ) : (
          <>
            <p className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
              基于数据末尾日期 <code>{detail.dataset.date_end}</code> 向后推算：
            </p>
            <dl className="mt-2 text-[0.75rem]" style={{ color: 'var(--text-2)' }} data-testid="aside-window">
              <Row k="窗口起" v={windowStart} mono />
              <Row k="窗口止" v={windowEnd} mono />
              <Row
                k="窗口内节假日"
                v={holidayNames.length ? holidayNames.join('、') : holiday ? '无' : '未启用'}
              />
            </dl>
          </>
        )}
      </Card>

      <NoticeBar variant="warning" title="数据集稀疏性提示">
        菜鸟数据集中大量商品仅覆盖 1–2 个仓，序列稀疏是<strong>常态</strong>。
        L2/L3 序列走规则兜底而非模型推理（L1 需有效历史 ≥{' '}
        <code>{PIPELINE_META.L1_MIN_VALID_POINTS}</code> 个点），
        请在结果页查看覆盖率披露后再做决策。
      </NoticeBar>

      <Card title="快捷跳转">
        <div className="flex flex-wrap gap-2">
          <Link
            to="/upload"
            className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.75rem] font-semibold"
            style={{
              borderColor: 'var(--border-field)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
            }}
          >
            返回修改数据
          </Link>
          <Link
            to="/"
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[0.75rem] font-semibold"
            style={{ background: 'none', color: 'var(--primary)' }}
          >
            返回首页
          </Link>
        </div>
        {/*
          ⚠️ 原型此处还有一个「直接看结果示例」链接（指向 result.html 的演示数据）。
          产品里**不提供**：结果必须来自真实任务，给一个「演示结果」入口等于
          在界面里重新引入「两套数字」（`GIT-7` / `QD-06`）。
        */}
        <p className="mt-2 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
          任务提交后即可在本页对应数据集上创建多个不同步长的任务，用于跨任务对比。
        </p>
      </Card>
    </div>
  );
}
