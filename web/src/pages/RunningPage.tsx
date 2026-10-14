/**
 * UX-P07 · 执行进度页（模板 B）
 * =============================================================================
 * 依据：《UI/UX 设计文档 V1.0》§8.3（全量）· PRD `FR-MOD-09/10/12/13`、
 *      `FR-SYS-07/08`、`NFR-PERF-01`、`NFR-REL-03/04`、`NFR-SEC-09`、`NFR-USE-02`
 *      ·《开发技术文档》§5.6 `API-13` · 本方案 `WS-5-10`
 * 原型：`prototype/running.html`（视觉与文案基准）
 * -----------------------------------------------------------------------------
 * 🔴 本页最重要的一件事：**如实说明「同步接口下不存在实时进度可轮询」**
 * =============================================================================
 * `API-12` 是同步语义 —— 响应返回时任务已入终态（`succeeded` / `failed`）。
 * 因此：
 *   - 前端在任务运行期间**拿不到 `task_id`**，不可能轮询 `API-13`；
 *   - 用户实际等待发生在上一个页面（`/params` 的「提交中」面板）；
 *   - 本页拿到的是一个**已完成**的任务，能提供的是**真实分阶段耗时的回放**，
 *     而不是「实时进度条」。
 *
 * 这与 UI/UX §8.3 的原型叙事（「用户在此停留 8–60 秒」「可离开本页」）不同，
 * 是 `EP-5` 的一处**受控偏离**，登记在《实施方案》§7.6。三条理由：
 *   ① 若把 `POST` 放到本页由页面发起，则用户刷新本页会**重复创建任务**
 *      （浏览器中断的是请求，服务端那次执行仍在跑），历史里凭空多出重复任务；
 *      放 `/params` 则由用户显式点击触发，本页只读 → 刷新幂等。
 *   ② `UX-GOV-07` 已明确禁止「用放慢的假动画演示动效」（原型为了让动画可见用
 *      34.3 s，而完成态卡片用真实 7.9 s，同一件事两套数字）。真实 16 s 逐秒播一遍
 *      等于让用户白等一遍，故回放时长被压缩，**但数字全部是实测值**。
 *   ③ 页面内容一条没少：五阶段列表 / 0–60 s 时间轴 / 设备与回退披露 / 执行日志 /
 *      超时软失败态 / 完成态 / 右栏四块，全部按 `UX-P07` 落地。
 *
 * 口径来源（🔒 界面上每个耗时数字都必须来自这里，不得估算、不得写死）
 *   - `API-13`（`GET /predictions/{id}/status`）：状态 / 进度 / 预算 / 分级计数 / 错误
 *   - `API-12` 响应（经 `useTaskStore` 带过来）：`timing.stages_two_pass_ms`（**真实**分段）、
 *     `coverage`、`mape`、`model_version`、`device_fallback`
 *   - 路由参数（`horizon` / `holiday` / `datasetId` / `t`）：查询串即真源，
 *     刷新与分享都不丢（与 `/params?datasetId=` 同一约定）
 * =============================================================================
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { ApiError, datasetApi, predictApi, systemApi } from '../api/client';
import Card from '../components/Card';
import NoticeBar from '../components/NoticeBar';
import StepBadges from '../components/StepBadges';
import LogStream, { type LogLine } from '../components/run/LogStream';
import RunAside from '../components/run/RunAside';
import StageList, { type StageRow, type StageState } from '../components/run/StageList';
import StageTimeline, { type TimelineSegment } from '../components/run/StageTimeline';
import { fmtInt } from '../components/upload/format';
import { PIPELINE_META } from '../generated/pipeline';
import { useAsideContent } from '../layouts/aside-slot';
import { useTaskStore } from '../store/useTaskStore';
import { ERR } from '../types';
import type {
  CreateTaskResponse,
  PipelineStage,
  TaskStatus,
  TaskStatusResponse,
} from '../types';

/** 五阶段顺序与名称取自生成物（后端 `predict_service.STAGES` 的构建期快照） */
const STAGE_KEYS: PipelineStage[] = PIPELINE_META.STAGES.map((s) => s.key as PipelineStage);

/**
 * 回放时长（ms）。
 *
 * ⚠️ 与真实耗时只是**弱相关**（`wall/8` 并夹在 0.9–2.2 s），这是刻意的：
 *    本页数据在加载时已是终态，回放的作用是「让用户看清五阶段是怎么推进的」，
 *    而不是模拟等待。真实 16.6 s 逐秒播一遍等于让用户白等一遍。
 *    🔒 但**数字**必须是实测值 —— 压缩的只是动画节奏，不是数据（`UX-GOV-07`）。
 */
function revealDuration(wallMs: number | null): number {
  if (wallMs === null) return 1400;
  return Math.min(2200, Math.max(900, Math.round(wallMs / 8)));
}

/** 用户是否开启「减少动效」（无障碍：直接跳到终态，不播回放） */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export default function RunningPage() {
  const { taskId: rawId } = useParams<{ taskId: string }>();
  const taskId = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
  const [params] = useSearchParams();

  const queryHorizon = Number(params.get('horizon'));
  const horizon =
    (PIPELINE_META.HORIZONS as readonly number[]).includes(queryHorizon) ? queryHorizon : 7;
  const holiday = params.get('holiday') !== '0';
  const queryDataset = params.get('datasetId');
  const datasetId = queryDataset && /^\d+$/.test(queryDataset) ? Number(queryDataset) : null;
  const submittedAt = params.get('t') ?? null;

  const lastTask = useTaskStore((s) => s.lastTask);

  /**
   * 本次会话内由 `/params` 带过来的完整响应。
   *
   * 🔒 必须核对 `task_id`：`lastTask` 只是「最后一次提交」，用户可能直接打开
   *    另一个任务 id 的地址（或上次提交的是别的任务）。不核对会把 A 任务的
   *    分段耗时画到 B 任务上 —— 那是最难发现的错。
   */
  const session: CreateTaskResponse | null =
    lastTask && taskId !== null && lastTask.task_id === taskId ? lastTask : null;

  const [status, setStatus] = useState<TaskStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [modelVersion, setModelVersion] = useState<string>('—');
  const [revealed, setRevealed] = useState(0);
  const bootRef = useRef(false);

  /* ---------------------------------------------------------------- 状态拉取 */
  const loadStatus = useCallback(async (): Promise<void> => {
    if (taskId === null) return;
    setRefreshing(true);
    try {
      const s = await predictApi.status(taskId);
      setStatus(s);
      setStatusError(null);
    } catch (e: unknown) {
      setStatusError(
        e instanceof ApiError && e.code === ERR.TASK_NOT_FOUND
          ? `任务 #${taskId} 不存在或无权查看`
          : e instanceof ApiError
            ? e.message
            : '任务状态读取失败，请点击右栏「刷新进度」重试',
      );
    } finally {
      setRefreshing(false);
    }
  }, [taskId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  /* ---------------------------------------------------------------- 数据文件名 / 模型版本 */
  useEffect(() => {
    if (datasetId === null) return;
    let alive = true;
    datasetApi
      .detail(datasetId)
      .then((d) => {
        if (alive) setFileName(d.dataset.file_name);
      })
      // 文件名为辅助展示，取不到不影响本页任何判断
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [datasetId]);

  useEffect(() => {
    let alive = true;
    systemApi
      .health()
      .then((h) => {
        if (alive) setModelVersion(h.model_version ?? '—');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------------------------------------------------------- 回放推进 */
  const timing = session?.timing ?? null;
  const wallMs = timing?.wall_ms ?? status?.elapsed_ms ?? session?.duration_ms ?? null;
  const isTerminal = status !== null && (status.status === 'succeeded' || status.status === 'failed');

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    if (prefersReducedMotion()) {
      setRevealed(PIPELINE_META.STAGE_TOTAL);
      return;
    }
    const total = PIPELINE_META.STAGE_TOTAL;
    const step = revealDuration(wallMs ?? null) / total;
    const timers: number[] = [];
    for (let i = 1; i <= total; i += 1) {
      timers.push(
        window.setTimeout(() => setRevealed(i), Math.round(step * i)),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // 只在首次挂载推进一次：`wallMs` 随状态到达而变化，若作为依赖会让动画重播
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- 派生：阶段 */
  /**
   * 各阶段的**期望耗时**：`标定占比 × 本次实际端到端耗时`。
   *
   * ⚠️ 为什么不用 `标定占比 × 60 s`：那会给出「预处理预算 6.8 s」这种与本次
   *    实际完全脱节的数字（60 s 是**上限**，不是预期值）。用本次真实总耗时折算后，
   *    「预算 1.88 s / 实测 1.59 s」才是一组可比较的数字。
   *    标定占比本身来自 `EP-5` 实测（见 `predict_service.STAGE_BUDGET_RATIO`）。
   */
  const stageRows: StageRow[] = useMemo(() => {
    const measured = timing?.stages_two_pass_ms ?? null;
    return STAGE_KEYS.map((k) => {
      const meta = PIPELINE_META.STAGES.find((s) => s.key === k);
      return {
        key: k,
        label: meta ? meta.label : k,
        budgetMs: wallMs === null ? null : Math.round((meta?.budget_ratio ?? 0) * wallMs),
        measuredMs: measured && typeof measured[k] === 'number' ? measured[k] : null,
      };
    });
  }, [timing, wallMs]);

  /**
   * 时间轴分段。
   *
   * 🔒 有实测就用实测（`stages_two_pass_ms`，两遍合计口径）；
   *    没有实测才退到标定比例，并把它渲染在 0–60 s 的**计划分配**刻度上，
   *    同时在组件里写明「段宽为标定比例」。绝不把估算值伪装成实测值。
   */
  const segments: TimelineSegment[] = useMemo(() => {
    const measured = timing?.stages_two_pass_ms ?? null;
    return stageRows.map((r) => ({
      key: r.key,
      label: shortStageLabel(r.label),
      ms:
        measured && r.measuredMs !== null
          ? r.measuredMs
          : Math.round(
              (PIPELINE_META.STAGES.find((s) => s.key === r.key)?.budget_ratio ?? 0) *
                PIPELINE_META.TASK_BUDGET_MS,
            ),
    }));
  }, [stageRows, timing]);

  /**
   * 输出预测点总数。
   *
   * ⚠️ 不是简单的 `序列数 × 步长`：`predict_service._build_prediction_rows` 对
   *    L3 序列**只落一行**（历史均值占位 + 降级标记），因为 L3 的「预测值」
   *    在语义上不存在（`FR-MOD-08` / `UX-AC-10`）。
   *    样例数据 L3=0 时两种算法同值，所以这个偏差极易被忽略 ——
   *    一旦遇到 L3 > 0 的数据集，「序列数 × 步长」就会多报。
   */
  const predictedPoints = useMemo(() => {
    const total = status?.series_count ?? session?.series_count ?? 0;
    const l3 = status?.l3_count ?? session?.coverage?.L3 ?? 0;
    return (total - l3) * horizon + l3;
  }, [status, session, horizon]);

  /** 失败时停在哪个阶段（后端给的 `completed_stage`） */
  const failedIndex = useMemo(() => {
    const cs = status?.completed_stage ?? session?.completed_stage ?? null;
    if (!cs) return -1;
    return STAGE_KEYS.indexOf(cs as PipelineStage);
  }, [status, session]);

  const isFailed = (status?.status ?? session?.status) === 'failed';

  const stateOf = useCallback(
    (index: number): StageState => {
      if (isTerminal && isFailed && index === failedIndex) return 'failed';
      if (revealed >= PIPELINE_META.STAGE_TOTAL) return 'done';
      if (index < revealed) return 'done';
      if (index === revealed) return 'active';
      return 'todo';
    },
    [revealed, isTerminal, isFailed, failedIndex],
  );

  /* ---------------------------------------------------------------- 派生：日志 */
  const logs: LogLine[] = useMemo(() => {
    if (taskId === null) return [];
    const lines: LogLine[] = [];
    const total = status?.series_count ?? session?.series_count ?? 0;
    lines.push({
      level: 'highlight',
      atMs: 0,
      message:
        `task #${taskId} created · horizon=${horizon}d · series=${total} · ` +
        `model=${session?.model_version ?? modelVersion}`,
    });
    if (session?.device_fallback === 1 || status?.device_fallback === 1) {
      lines.push({
        level: 'warning',
        atMs: null,
        message:
          'CUDA out of memory → 已清空缓存并把模型与输入都搬到 CPU 重跑（任务不会失败，耗时增加）',
      });
    }
    if (timing) {
      const s = timing.stages_two_pass_ms ?? null;
      const ms = (k: PipelineStage): number | null =>
        s && typeof s[k] === 'number' ? s[k] : null;
      const fmt = (v: number | null): string => (v === null ? '—' : `${(v / 1000).toFixed(2)}s`);
      lines.push({
        level: 'info',
        atMs: ms('validate'),
        message: `阶段 1/5 validate · 数据读取与校验 · ${fmt(ms('validate'))}`,
      });
      lines.push({
        level: 'info',
        atMs: ms('preprocess'),
        message:
          `阶段 2/5 preprocess · 缺失线性插值 + 异常尖峰截断（营销节点豁免）· ` +
          `${fmt(ms('preprocess'))}`,
      });
      lines.push({
        level: 'info',
        atMs: ms('features'),
        message: `阶段 3/5 features · 特征构建 + 序列分级（window=${timing.window}）· ${fmt(ms('features'))}`,
      });
      const cov = status
        ? { L1: status.l1_count, L2: status.l2_count, L3: status.l3_count }
        : (session?.coverage ?? null);
      if (cov) {
        lines.push({
          level: 'info',
          atMs: null,
          message: `分级结果 L1=${cov.L1 ?? 0} L2=${cov.L2 ?? 0} L3=${cov.L3 ?? 0}（L2/L3 走规则兜底，不计入主指标）`,
        });
      }
      lines.push({
        level: 'info',
        atMs: ms('inference'),
        message:
          `阶段 4/5 inference · batch_size=${cov?.L1 ?? 0} · ${fmt(ms('inference'))}` +
          `（含逐序列多步滚动 rolling=${fmt(timing.rolling_ms)}；一次前向，不逐序列循环）`,
      });
      lines.push({
        level: 'info',
        atMs: ms('metrics'),
        message:
          `阶段 5/5 metrics · 加权 MAPE ${session?.mape ?? '—'}% · ${fmt(ms('metrics'))}` +
          `${timing.fallback_ms ? ` · L2/L3 兜底 ${fmt(timing.fallback_ms)}` : ''}`,
      });
    }
    if (isFailed) {
      lines.push({
        level: 'error',
        atMs: wallMs,
        message: `failed · ${status?.error_code ?? session?.error_code ?? '—'} · ${
          status?.error_msg ?? session?.error_msg ?? ''
        }`,
      });
    } else if (isTerminal) {
      lines.push({
        level: 'highlight',
        atMs: wallMs,
        message: `done · 端到端 ${wallMs === null ? '—' : (wallMs / 1000).toFixed(2)}s · 两遍流水线（回测 + 未来预测）`,
      });
    }
    return lines;
  }, [taskId, horizon, status, session, timing, modelVersion, isFailed, isTerminal, wallMs]);

  /* ---------------------------------------------------------------- 派生：右栏 */
  const aside = useMemo(
    () => (
      <RunAside
        taskId={taskId ?? 0}
        status={status}
        result={session}
        fileName={fileName}
        submittedAt={submittedAt ?? '—'}
        horizon={horizon}
        holiday={holiday}
        modelVersion={session?.model_version ?? modelVersion}
        onRefresh={() => void loadStatus()}
        refreshing={refreshing}
      />
    ),
    // 依赖里含 `loadStatus`（useCallback 恒等）与 `refreshing`（点击刷新时变一次），
    // 故本 useMemo 不会每次渲染都产生新 JSX —— 这是 `AsideLayout` 不陷入
    // 「setState → 新 aside → 再 setState」死循环的前提。
    [
      taskId,
      status,
      session,
      fileName,
      submittedAt,
      horizon,
      holiday,
      modelVersion,
      refreshing,
      loadStatus,
    ],
  );
  useAsideContent(aside);

  /* ---------------------------------------------------------------- 渲染 */
  if (taskId === null) {
    return (
      <div data-testid="running-page" data-phase="invalid">
        <NoticeBar variant="danger" title="任务地址无效">
          任务 ID 必须是数字。请从
          <Link to="/upload"> 上传数据 </Link>
          重新发起一次预测。
        </NoticeBar>
      </div>
    );
  }

  const title = !isTerminal
    ? '正在执行预测'
    : isFailed
      ? '预测任务未成功'
      : '预测任务已完成';
  const statusText: Record<TaskStatus, string> = {
    created: '已创建',
    running: '运行中',
    succeeded: '已完成',
    failed: '未成功',
  };
  const current = status?.status ?? session?.status ?? 'running';

  return (
    <div data-testid="running-page" data-phase={isTerminal ? current : 'loading'}>
      <div className="mb-4">
        <div className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
          工作台 / 新建预测 / 执行预测
        </div>
        <h1 className="mt-1 text-[1.5rem]">{title}</h1>
        <p className="mt-1.5 text-[0.8125rem] leading-[1.75]" style={{ color: 'var(--text-2)' }}>
          任务 <code>#{taskId}</code> · {fmtInt(status?.series_count ?? session?.series_count ?? 0)}{' '}
          条序列 · 步长 {horizon} 天 · 端到端不超过{' '}
          {PIPELINE_META.TASK_BUDGET_MS / 1000} 秒。
        </p>
      </div>

      <div className="mb-3">
        <StepBadges current="running" doneThrough="params" />
      </div>

      {/* 口径说明：这是本页最容易被误读的一点，必须显式写出来 */}
      <div className="mb-4">
        <NoticeBar variant="info" title="关于「实时进度」的说明">
          本系统采用<strong>同步接口</strong>：提交请求返回时任务已执行完毕，
          因此不存在可在运行期轮询的进度。下面的五阶段与时间轴是对
          <strong>本次任务真实分阶段耗时</strong>的回放（数字全部为实测值，
          回放节奏已压缩，不按真实耗时逐秒播放）。{isTerminal ? '任务已结束，可直接离开本页。' : ''}
        </NoticeBar>
      </div>

      {statusError ? (
        <div className="mb-4">
          <NoticeBar variant="danger" title="任务状态读取失败">
            {statusError}
          </NoticeBar>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {/* ================= 总体进度 ================= */}
        <Card
          title="总体进度"
          testId="run-progress"
          badge={
            <span
              className="flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[0.6875rem] font-semibold"
              style={{
                color: isFailed ? 'var(--danger)' : isTerminal ? 'var(--success)' : 'var(--info)',
                background: isFailed
                  ? 'var(--danger-soft)'
                  : isTerminal
                    ? 'var(--success-soft)'
                    : 'var(--info-soft)',
              }}
              data-testid="run-status-badge"
            >
              <span aria-hidden>{isFailed ? '✗' : isTerminal ? '✓' : '◌'}</span>
              {statusText[current]}
            </span>
          }
          actions={
            <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
              {revealed >= PIPELINE_META.STAGE_TOTAL
                ? `阶段 ${PIPELINE_META.STAGE_TOTAL}/${PIPELINE_META.STAGE_TOTAL} · 全部完成`
                : `阶段 ${Math.min(revealed + 1, PIPELINE_META.STAGE_TOTAL)}/${PIPELINE_META.STAGE_TOTAL}`}
            </span>
          }
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
              {fileName ?? '数据集'} · 输出预测点{' '}
              <span className="mono">{fmtInt(predictedPoints)}</span> 个 · 两遍流水线（回测 + 未来预测）
            </div>
            <div className="text-right">
              <div className="mono text-[1.75rem] font-bold leading-none">
                {wallMs === null ? '—' : (wallMs / 1000).toFixed(1)}
                <span className="ml-1 text-[0.875rem]" style={{ color: 'var(--text-3)' }}>
                  s
                </span>
              </div>
              <div className="mt-1 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                端到端耗时 / 上限 {PIPELINE_META.TASK_BUDGET_MS / 1000} s
              </div>
            </div>
          </div>

          <div className="mt-3">
            <div
              className="h-[8px] w-full overflow-hidden rounded-full"
              style={{ background: 'var(--surface-2)' }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((revealed / PIPELINE_META.STAGE_TOTAL) * 100)}
              data-testid="run-main-bar"
            >
              <i
                className="block h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${(revealed / PIPELINE_META.STAGE_TOTAL) * 100}%`,
                  background: isFailed ? 'var(--danger)' : 'var(--primary)',
                }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[0.6875rem]">
              <span style={{ color: 'var(--text-3)' }}>
                阶段 {Math.min(revealed + 1, PIPELINE_META.STAGE_TOTAL)}/
                {PIPELINE_META.STAGE_TOTAL} ·{' '}
                {shortStageLabel(
                  PIPELINE_META.STAGES[Math.min(revealed, PIPELINE_META.STAGE_TOTAL - 1)].label,
                )}
              </span>
              <span className="mono" style={{ color: 'var(--text-3)' }}>
                {Math.round((revealed / PIPELINE_META.STAGE_TOTAL) * 100)}%
              </span>
            </div>
          </div>

          <div className="mt-4">
            <StageTimeline
              segments={segments}
              budgetMs={PIPELINE_META.TASK_BUDGET_MS}
              source={timing?.stages_two_pass_ms ? 'measured' : 'budget'}
            />
          </div>
        </Card>

        {/* ================= 执行阶段 ================= */}
        <Card
          title="执行阶段"
          testId="run-stages"
          actions={
            <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
              图标三态：✓ 完成 · 数字 进行中 · ✗ 失败
            </span>
          }
        >
          <StageList rows={stageRows} stateOf={stateOf} />
          {!timing ? (
            <p className="mt-2 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
              本次会话未持有该任务的耗时明细（可能是刷新页面或跨会话打开），
              故「实测」列留空 —— 此处<strong>不用估算值补齐</strong>，
              以免与真实数据形成两套数字。
            </p>
          ) : null}
        </Card>

        {/* ================= 推理设备 ================= */}
        <Card
          title="推理设备"
          testId="run-device"
          badge={
            <span
              className="rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
              style={{
                color:
                  (status?.device ?? session?.device ?? 'cpu') === 'cuda'
                    ? 'var(--success)'
                    : 'var(--warning)',
                background:
                  (status?.device ?? session?.device ?? 'cpu') === 'cuda'
                    ? 'var(--success-soft)'
                    : 'var(--warning-soft)',
              }}
            >
              {(status?.device ?? session?.device ?? 'cpu') === 'cuda'
                ? 'GPU · CUDA'
                : 'CPU'}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                设备
              </div>
              <div className="text-[0.8125rem] font-semibold">
                {(status?.device ?? session?.device ?? 'cpu') === 'cuda'
                  ? 'NVIDIA GPU（CUDA）'
                  : 'CPU'}
              </div>
            </div>
            <div>
              <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                L1 批大小
              </div>
              <div className="mono text-[0.8125rem] font-semibold">
                {fmtInt(status?.l1_count ?? session?.coverage?.L1 ?? null)}（一次性入批）
              </div>
            </div>
            <div>
              <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                模型参数
              </div>
              <div className="mono text-[0.8125rem] font-semibold">
                {timing
                  ? `${fmtInt(timing.param_count)} · window ${timing.window} · ${timing.hidden_size}×${timing.num_layers}`
                  : '—'}
              </div>
            </div>
          </div>

          {(status?.device_fallback === 1 || session?.device_fallback === 1) && (
            <div className="mt-3" data-testid="run-fallback-alert">
              <NoticeBar variant="warning" title="已自动回退到 CPU 推理">
                检测到 <code>CUDA out of memory</code>，系统已按 <code>NFR-REL-03</code>{' '}
                自动切换至 CPU（清空显存缓存，并把<strong>模型与输入都</strong>搬到 CPU 后重跑）。
                <strong> 任务不会失败</strong>，但耗时预计增加至 45–55 s，请留意 60 秒上限。
                本次回退已记入任务详情，供后续排查。
              </NoticeBar>
            </div>
          )}
        </Card>

        {/* ================= 执行日志 ================= */}
        <Card
          title="执行日志"
          testId="run-logs"
          actions={
            <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
              共 {logs.length} 行
            </span>
          }
        >
          <LogStream lines={logs} />
        </Card>

        {/* ================= 失败态（`UX-P07-04` / `UX-P07-05`） ================= */}
        {isTerminal && isFailed ? (
          <Card
            title="任务失败"
            titleColor="var(--danger)"
            testId="run-failed"
            badge={
              <span
                className="rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
                style={{ color: 'var(--on-danger-soft)', background: 'var(--danger-soft)' }}
                data-testid="run-error-code"
              >
                {status?.error_code ?? session?.error_code ?? 'E_INFER_FAIL'}
              </span>
            }
          >
            <div className="flex gap-3">
              <span aria-hidden className="flex-none text-[1.25rem]" style={{ color: 'var(--danger)' }}>
                ✗
              </span>
              <div className="min-w-0">
                <div className="text-[0.875rem] font-semibold">
                  端到端耗时{' '}
                  {wallMs === null ? '—' : (wallMs / 1000).toFixed(1)} 秒
                  {wallMs !== null && wallMs > PIPELINE_META.TASK_BUDGET_MS
                    ? `，超过 ${PIPELINE_META.TASK_BUDGET_MS / 1000} 秒硬上限`
                    : ''}
                </div>
                <div className="mt-1 text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
                  {status?.error_msg ?? session?.error_msg ?? '任务未成功完成。'}
                  {status?.completed_stage || session?.completed_stage ? (
                    <>
                      （已完成阶段：
                      {PIPELINE_META.STAGES.find(
                        (s) => s.key === (status?.completed_stage ?? session?.completed_stage),
                      )?.label ?? status?.completed_stage}
                      ）
                    </>
                  ) : null}
                </div>
                <div className="mt-1.5 text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
                  已完成的中间计算结果<strong>不落盘</strong>，避免保存半成品误导决策
                  （<code>NFR-REL-04</code>）。本次未产生任何可查看的预测结果。
                </div>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="mb-1">可采取的处置</h4>
              {/*
                🔒 三条建议只从 `API-12` 的 `suggestions` 取（后端 `predict_service`
                   里已按 `UX-P07-05` 定稿：缩短步长 / 缩小商品范围 / 检查 CPU 回退）。
                   `API-13` 的状态响应**不含**该字段，所以不能用它。
                   `DEFAULT_SUGGESTIONS` 只在「刷新页面导致会话载荷丢失」时兜底 ——
                   它不是一套新文案，而是后端那三条的原文照录（守卫脚本会比对两者一致）。
              */}
              <div className="flex flex-col gap-2" data-testid="run-suggestions">
                {(session?.suggestions ?? DEFAULT_SUGGESTIONS).map((text, i) => (
                  <NoticeBar
                    key={i}
                    variant={i === 2 ? 'warning' : 'info'}
                    title={`${i + 1}. ${suggestionTitle(text)}`}
                    plain
                  >
                    {text}
                  </NoticeBar>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to={datasetId === null ? '/upload' : `/params?datasetId=${datasetId}`}
                  className="rounded-[var(--radius-sm)] px-3.5 py-2 text-[0.8125rem] font-semibold"
                  style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
                  data-testid="run-back-params"
                >
                  返回调整参数
                </Link>
                <Link
                  to="/upload"
                  className="rounded-[var(--radius-sm)] border px-3.5 py-2 text-[0.8125rem] font-semibold"
                  style={{
                    borderColor: 'var(--border-field)',
                    background: 'var(--surface-2)',
                    color: 'var(--text-2)',
                  }}
                >
                  重新上传数据
                </Link>
                <Link
                  to="/dashboard"
                  className="rounded-[var(--radius-sm)] px-3.5 py-2 text-[0.8125rem] font-semibold"
                  style={{ background: 'none', color: 'var(--primary)' }}
                >
                  返回工作台
                </Link>
              </div>
            </div>
          </Card>
        ) : null}

        {/* ================= 完成态 ================= */}
        {isTerminal && !isFailed ? (
          <Card
            title="任务已完成"
            titleColor="var(--success)"
            testId="run-done"
            badge={
              <span
                className="rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
                style={{ color: 'var(--on-success-soft)', background: 'var(--success-soft)' }}
              >
                ✓ 全部阶段完成
              </span>
            }
          >
            <div className="flex gap-3">
              <span aria-hidden className="flex-none text-[1.25rem]" style={{ color: 'var(--success)' }}>
                ✓
              </span>
              <div className="min-w-0">
                <div className="text-[0.875rem] font-semibold" data-testid="run-duration">
                  端到端耗时 {wallMs === null ? '—' : (wallMs / 1000).toFixed(1)} 秒，
                  满足 {PIPELINE_META.TASK_BUDGET_MS / 1000} 秒硬约束
                </div>
                <div className="mt-1 text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
                  识别{' '}
                  {fmtInt(status?.series_count ?? session?.series_count ?? null)} 条序列：
                  L1 模型推理 {fmtInt(status?.l1_count ?? session?.coverage?.L1 ?? null)} 条、
                  L2 商品级降级 {fmtInt(status?.l2_count ?? session?.coverage?.L2 ?? null)} 条、
                  L3 不可预测 {fmtInt(status?.l3_count ?? session?.coverage?.L3 ?? null)} 条。
                  {session?.mape !== null && session?.mape !== undefined ? (
                    <>
                      {' '}加权 MAPE <strong>{session.mape.toFixed(2)}%</strong>
                      （本次任务数据实测，阈值 ≤ 20%）。
                    </>
                  ) : null}
                  {timing?.device_fallback === 1 ? ' 本次已发生 GPU→CPU 回退。' : ''}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={`/result/${taskId}`}
                className="rounded-[var(--radius-sm)] px-4 py-2.5 text-[0.875rem] font-semibold"
                style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
                data-testid="run-view-result"
              >
                查看预测结果
              </Link>
              <Link
                to="/dashboard"
                className="rounded-[var(--radius-sm)] border px-4 py-2.5 text-[0.875rem] font-semibold"
                style={{
                  borderColor: 'var(--border-field)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                }}
              >
                返回工作台
              </Link>
            </div>
            {/*
              ⚠️ `/result/:taskId` 属 EP-6（结果可视化）尚未落地。这里刻意把按钮指向
              真实路由而不是弹一个「敬请期待」：README 级的说明写在按钮下方，
              路由落地后按钮自动生效，不会残留一个假按钮。
            */}
            <p className="mt-2 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
              结果页（曲线 / 覆盖率 / 指标卡 / 明细 / 导出）在 `EP-6` 落地；
              本节数据已全部落库，届时无需重跑任务。
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/* ============================================================================
 * 局部工具
 * ========================================================================== */

/** 阶段短名（去掉「· 明细」后缀，用于时间轴图例与进度行） */
function shortStageLabel(label: string): string {
  return label.split(' · ')[0];
}

/** 建议编号的短标题（后端给的是整句，这里只截取冒号前的部分做标题） */
function suggestionTitle(text: string): string {
  const idx = text.indexOf('：');
  return idx > 0 && idx <= 24 ? text.slice(0, idx) : '处置建议';
}

/** 兜底建议：仅在既无 `API-13.suggestions` 也无 `API-12.suggestions` 时使用 */
const DEFAULT_SUGGESTIONS: string[] = [
  '缩短预测步长：从 30 天降到 14 天可显著减少逐日推理量，这是最直接有效的降耗手段。',
  '缩小商品范围：按近 90 天销量取 Top N 商品重新上传，序列数下降后耗时近似线性下降。',
  '检查是否处于 CPU 回退状态：CPU 推理较 GPU 慢约 4.3 倍（本机实测）。若长期回退，需先解决显存占用问题。',
];
