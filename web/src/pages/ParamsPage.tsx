/**
 * UX-P06 · 参数配置页（模板 B）
 * =============================================================================
 * 依据：《UI/UX 设计文档 V1.0》§8.2（全量）· PRD `FR-MOD-01~04/08/12`、
 *      `FR-FEA-02/10`、`NFR-PERF-01`、`NFR-USE-02`、`FR-SYS-07`
 *      ·《开发技术文档》§5.6（`API-09` / `API-12`）· 本方案 `WS-5-09`
 * 原型：`prototype/params.html`（视觉与文案基准）
 * -----------------------------------------------------------------------------
 * 本页的设计使命是「**让用户放心用默认值**」（`UX-P06` 定位）。四条落点：
 *
 *   1. **粒度只读**（`UX-P06-01`）—— 仓库 × 商品是 `📌` 已确认决策，不是可选项。
 *      做成下拉框再禁用，用户仍会以为自己能改；故直接渲染为只读字段 + 「已固定」徽标。
 *   2. **序列分级预判提前告知**（`UX-P06-05`）—— 这是本页最重要的诚实性要求：
 *      用户必须在**提交前**就知道有多少条序列会走规则兜底，而不是在结果页
 *      突然看到「L2 32 条」才发现。数据取自 `API-09` 的 `level_preview`。
 *   3. **耗时预估必须与真实任务同口径**（`UX-P06-06`）——
 *      🔒 取 `estimate_by_horizon`（两遍流水线口径），**不是** `estimated_ms`
 *      （单遍评测口径）。用后者会得到「预估 7.9 s、实际 16.6 s」的经典两套数字
 *      （`GIT-7` / `QD-06`）。
 *   4. **不提供在线重训练**（`UX-P06-04`）—— 高级设置里显式声明，并给出替代路径。
 *
 * 🔒 不加 `RequireAuth`：游客链路（`FR-USR-08` / `JT-10`）必须能走到这里并提交。
 *
 * ⚠️ 刻意**没有**移植原型里的 `.state-bar`（演示状态切换控件）与 `.spec-note`
 *    （「本页与 PRD 的对应关系」表）—— 前者是原型调试控件，后者是评审材料，
 *    都不是产品 UI（`UX-GOV-01` 停止移植原型演示痕迹）。
 *
 * 🔴 提交动作放在本页（而不是执行页）是 `EP-5` 的关键设计决定
 * -----------------------------------------------------------------------------
 * `API-12` 是**同步**语义：响应返回时任务已入终态。若把 `POST` 放到 `/running`
 * 由执行页发起，则用户刷新执行页会**重复创建任务**（浏览器会中断上一个请求，
 * 但服务端那次执行仍在跑），历史里凭空多出重复任务。
 * 放在本页则：提交由用户显式点击触发，执行页只读 —— 刷新是幂等的。
 * 代价是用户要在本页等待（实测 h=14 约 16.6 s），故「提交中」必须显示
 * **真实进度的估计**（按 `estimate_by_horizon` 折算 + 已用秒数），而不是假动画。
 * =============================================================================
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError, datasetApi, predictApi, systemApi } from '../api/client';
import Card from '../components/Card';
import NoticeBar from '../components/NoticeBar';
import StepBadges from '../components/StepBadges';
import ParamsAside from '../components/params/ParamsAside';
import { fmtInt } from '../components/upload/format';
import { PIPELINE_META } from '../generated/pipeline';
import { useAsideContent } from '../layouts/aside-slot';
import { useTaskStore } from '../store/useTaskStore';
import { ERR, LIMITS } from '../types';
import type { DatasetDetailResponse, Horizon } from '../types';

/** 任务名长度上限（`CreateTaskRequest.task_name` 的契约，与原型 `maxlength` 一致） */
const TASK_NAME_MAX = 40;

/** 尾栏右栏的静态部分用模块级常量（引用稳定，见 layouts/aside-slot.tsx） */
const BACK_LINK = '/upload';

/**
 * 步长三档的展示元信息。
 *
 * ⚠️ 数值来自 `PIPELINE_META.HORIZONS`（后端 `algo.config.HORIZONS` 的构建期快照），
 *    这里的「文案」才是本页自己的东西。若两处不一致，以生成物为准并重跑
 *    `scripts/sync_pipeline_meta.py`。
 */
const HORIZON_HINTS: Record<number, { title: string; desc: string; tag?: string }> = {
  7: { title: '7 天', desc: '短期补货，精度最高', tag: '默认' },
  14: { title: '14 天', desc: '双周备货，推荐' },
  30: { title: '30 天', desc: '月度规划，误差偏大' },
};

/** 时间预算分配条里各阶段的短名（取后端 `STAGE_LABELS` 的第一段，不另造一套命名） */
function shortLabel(label: string): string {
  return label.split(' · ')[0];
}

const secText = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/**
 * 提交时刻的本地文本（`YYYY-MM-DD HH:mm:ss`）。
 * 随地址带给执行页，使其刷新后仍显示正确的提交时间（`API-13` 无 `created_at`）。
 */
function submittedStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** 日期加法（按 UTC 计算，避免本地时区把日期推错一天） */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 提交失败的展示信息（`UX-P06-08` 要求四件套：错误码 + 原因 + 重试 + 排查指引）。
 *
 * ⚠️ `code` 允许是字符串：网络层失败没有业务码（axios 的 `ECONNABORTED` 等），
 *    此时展示 `network` 而不是编一个不存在的 4xxxx/5xxxx。
 */
type SubmitError = { code: number | 'network'; message: string; hint: string; retryable: boolean };

export default function ParamsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const raw = params.get('datasetId');
  const datasetId = raw && /^\d+$/.test(raw) ? Number(raw) : null;

  const setDatasetId = useTaskStore((s) => s.setDatasetId);
  const setLastTask = useTaskStore((s) => s.setLastTask);

  const [detail, setDetail] = useState<DatasetDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modelVersion, setModelVersion] = useState<string>('—');
  const [loadedDevice, setLoadedDevice] = useState<'cuda' | 'cpu' | null>(null);

  const [horizon, setHorizon] = useState<Horizon>(7);
  const [holiday, setHoliday] = useState(true);
  const [taskName, setTaskName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  /** 防止「用户已重试/已离开」后迟到的响应改写界面 */
  const runIdRef = useRef(0);

  /* ---------------------------------------------------------------- 数据装载 */
  useEffect(() => {
    if (datasetId === null) {
      setLoadError('缺少 datasetId 参数');
      return;
    }
    setDatasetId(datasetId);
    let alive = true;
    datasetApi
      .detail(datasetId)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setLoadError(
          e instanceof ApiError && e.code === ERR.DATASET_NOT_FOUND
            ? `数据集 #${datasetId} 不存在或不可见（可能已被清理，游客数据保留 24 小时）`
            : e instanceof Error
              ? e.message
              : '数据集信息读取失败',
        );
      });
    return () => {
      alive = false;
    };
  }, [datasetId, setDatasetId]);

  /**
   * 模型版本 / 设备：取 `API-21`（`/health`）。
   *
   * ⚠️ 这是**尽力而为**：失败时不影响本页可用性（只是高级设置里显示「—」），
   *    所以不把它并进上面的错误处理 —— 否则健康检查一抖动，整页表单就废了。
   */
  useEffect(() => {
    let alive = true;
    systemApi
      .health()
      .then((h) => {
        if (!alive) return;
        setModelVersion(h.model_version ?? '—');
        setLoadedDevice(h.device);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------------------------------------------------------- 派生值 */
  const estimateMs = useMemo(() => {
    const hit = detail?.estimate_by_horizon?.find((e) => e.horizon === horizon);
    return hit ? hit.estimated_ms : null;
  }, [detail, horizon]);

  const windowRange = useMemo(() => {
    const end = detail?.dataset.date_end;
    if (!end) return { start: '—', end: '—' };
    return { start: addDays(end, 1), end: addDays(end, horizon) };
  }, [detail, horizon]);

  /**
   * 窗口内命中的节假日（`UX-P06-07`）。
   *
   * ⚠️ 节假日表取自 `generated/pipeline.ts`，即后端 `features.HOLIDAYS` 的构建期快照。
   *    原型里按步长写死的 `HOLIDAY_IN_WINDOW` 是演示假数据（`UX-GOV-01` 已停止移植）。
   */
  const holidayNames = useMemo(() => {
    const { start, end } = windowRange;
    if (start === '—') return [];
    const names: string[] = [];
    for (const [date, name] of Object.entries(PIPELINE_META.HOLIDAYS)) {
      if (date >= start && date <= end && !names.includes(name)) names.push(name);
    }
    return names;
  }, [windowRange]);

  const remainingPct = useMemo(() => {
    if (estimateMs === null) return null;
    return (1 - estimateMs / PIPELINE_META.TASK_BUDGET_MS) * 100;
  }, [estimateMs]);

  /* ---------------------------------------------------------------- 右栏 */
  const aside = useMemo(
    () => (
      <ParamsAside
        detail={detail}
        loadError={loadError}
        horizon={horizon}
        holiday={holiday}
        modelVersion={modelVersion}
        windowSize={PIPELINE_META.WINDOW_SIZE}
        windowStart={windowRange.start}
        windowEnd={windowRange.end}
        holidayNames={holidayNames}
        estimateMs={estimateMs}
      />
    ),
    [detail, loadError, horizon, holiday, modelVersion, windowRange, holidayNames, estimateMs],
  );
  useAsideContent(aside);

  /* ---------------------------------------------------------------- 提交中计时 */
  useEffect(() => {
    if (phase !== 'submitting') return;
    const t0 = performance.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => setElapsedMs(performance.now() - t0), 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* ---------------------------------------------------------------- 提交 */
  const submit = useCallback(async () => {
    if (datasetId === null || phase === 'submitting') return;
    const name = taskName.trim();
    if (name.length > TASK_NAME_MAX) {
      setNameError(`任务名称不能超过 ${TASK_NAME_MAX} 个字符（当前 ${name.length}）。`);
      return;
    }
    setNameError(null);

    runIdRef.current += 1;
    const runId = runIdRef.current;
    setSubmitError(null);
    setPhase('submitting');

    try {
      const resp = await predictApi.create({
        dataset_id: datasetId,
        granularity: 'warehouse_sku',
        horizon,
        use_holiday_feature: holiday ? 1 : 0,
        task_name: name || undefined,
      });
      if (runId !== runIdRef.current) return;
      // 把完整响应（含 timing 分段耗时）交给执行页 —— 同步语义下这是唯一来源
      setLastTask(resp);
      /**
       * ⚠️ 软失败（`status=failed`）**也**跳执行页，而不是留在这里报错。
       *    理由：失败态的完整表达在 `UX-P07-04/05`（半成品不落盘 + 三条处置建议 +
       *    三个出口），本页只负责「任务压根没创建成功」那一类硬错误。
       */
      const qs = new URLSearchParams({
        horizon: String(horizon),
        holiday: holiday ? '1' : '0',
        datasetId: String(datasetId),
        // 提交时刻随地址带走：执行页刷新后仍能显示正确的提交时间
        // （`API-13` 的响应里没有 created_at，而 store 是内存态，一刷新就没了）
        t: submittedStamp(),
      });
      navigate(`/running/${resp.task_id}?${qs.toString()}`);
    } catch (e: unknown) {
      if (runId !== runIdRef.current) return;
      setSubmitError(describeSubmitError(e));
      setPhase('error');
    }
  }, [datasetId, phase, taskName, horizon, holiday, setLastTask, navigate]);

  /* ---------------------------------------------------------------- 渲染 */
  const ready = detail !== null;

  return (
    <div data-testid="params-page" data-phase={phase}>
      <div className="mb-4">
        <div className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
          工作台 / 新建预测 / 确认参数
        </div>
        <h1 className="mt-1 text-[1.5rem]">确认预测参数</h1>
        <p className="mt-1.5 text-[0.8125rem] leading-[1.75]" style={{ color: 'var(--text-2)' }}>
          数据已通过校验。请确认预测步长与节假日开关，随后提交任务。
          系统使用<strong>已完成离线训练的模型</strong>进行推理，<strong>不包含在线重训练</strong>，
          端到端耗时不超过 {PIPELINE_META.TASK_BUDGET_MS / 1000} 秒。
        </p>
      </div>

      <div className="mb-3">
        <StepBadges current="params" />
      </div>

      {datasetId === null || (loadError && !ready) ? (
        <NoticeBar variant="danger" title="无法进入参数配置">
          {datasetId === null ? (
            <>
              缺少 <code>datasetId</code> 参数。请先 <Link to={BACK_LINK}>上传数据</Link>{' '}
              或加载示例数据。
            </>
          ) : (
            <>
              {loadError}。<Link to={BACK_LINK}>返回上传页</Link> 重新选择数据。
            </>
          )}
        </NoticeBar>
      ) : null}

      {!ready ? (
        datasetId !== null ? (
          <p className="mt-4 text-[0.8125rem]" style={{ color: 'var(--text-3)' }}>
            正在读取数据集信息…
          </p>
        ) : null
      ) : (
        <div className="flex flex-col gap-4">
          {/* ================= 1. 本次数据概要 ================= */}
          <Card
            title="1. 本次数据概要"
            testId="params-summary"
            badge={
              <span
                className="rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
                style={{ color: 'var(--on-success-soft)', background: 'var(--success-soft)' }}
              >
                校验通过
              </span>
            }
          >
            <div
              className="grid grid-cols-2 gap-x-5 gap-y-2 md:grid-cols-3"
              data-testid="params-strip"
            >
              {(
                [
                  ['文件', detail.dataset.file_name],
                  ['数据行数', fmtInt(detail.dataset.row_count)],
                  ['商品数', fmtInt(detail.dataset.sku_count)],
                  ['仓库数', fmtInt(detail.dataset.warehouse_count)],
                  ['序列数', fmtInt(detail.dataset.valid_series_count)],
                  [
                    '时间范围',
                    `${detail.dataset.date_start} ~ ${detail.dataset.date_end}`,
                  ],
                ] as Array<[string, string]>
              ).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                    {k}
                  </div>
                  <div className="mono truncate text-[0.8125rem] font-semibold" title={v}>
                    {v}
                  </div>
                </div>
              ))}
            </div>

            {/* 序列分级预判（`UX-P06-05`）：提交前就告知有多少序列会走降级 */}
            <div className="mt-3" data-testid="params-level-preview">
              <NoticeBar
                variant={detail.level_preview.L3 > 0 ? 'warning' : 'info'}
                title="序列分级预判"
              >
                按「有效历史长度 ≥ <code>{PIPELINE_META.L1_MIN_VALID_POINTS}</code> 点」规则预判：
                <strong> L1 模型推理 {fmtInt(detail.level_preview.L1)} 条</strong>、
                <strong> L2 商品级降级 {fmtInt(detail.level_preview.L2)} 条</strong>、
                <strong> L3 不可预测 {fmtInt(detail.level_preview.L3)} 条</strong>。
                L2/L3 是数据集<strong>长尾稀疏的正常结果，不是异常</strong>；
                它们走规则兜底而非模型推理，故不计入主指标（`BE-23`）。
                提交后可在结果页查看覆盖率披露。
              </NoticeBar>
            </div>

            {detail.over_budget_risk ? (
              <div className="mt-2">
                <NoticeBar variant="warning" title="序列数已接近 60 秒预算">
                  当前 {fmtInt(detail.level_preview.total)} 条序列（上限{' '}
                  {fmtInt(LIMITS.max_series)}）。若提交后接近超时，可把步长降到 7 天，
                  或按近 90 天销量取 Top N 商品重新上传。
                </NoticeBar>
              </div>
            ) : null}
          </Card>

          {/* ================= 2. 预测设置 ================= */}
          <Card title="2. 预测设置" testId="params-form">
            {/* 粒度：只读（📌 已确认决策，不给「禁用下拉」以免用户以为可改） */}
            <Field label="预测粒度">
              <div
                className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3.5 py-2.5"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                data-testid="params-granularity"
              >
                <span className="text-[0.8125rem]">
                  仓库 × 商品（<code>warehouse_id</code> × <code>sku_id</code>）
                </span>
                <span
                  className="flex-none rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
                  style={{ background: 'var(--surface)', color: 'var(--text-3)' }}
                >
                  已固定
                </span>
              </div>
              <FieldHelp>
                按 <code>FR-MOD-01</code> 规定，粒度固定为「仓库 × 商品」，用户不可修改。
                数据集中的全国汇总行（<code>warehouse_id = all</code>）不参与预测。
              </FieldHelp>
            </Field>

            {/* 步长：三选一（`FR-MOD-02`） */}
            <Field label={`预测步长（必选，默认 ${PIPELINE_META.HORIZONS[0]} 天）`}>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="预测步长">
                {PIPELINE_META.HORIZONS.map((h) => {
                  const hint = HORIZON_HINTS[h] ?? { title: `${h} 天`, desc: '' };
                  const active = horizon === h;
                  return (
                    <label
                      key={h}
                      className="flex cursor-pointer flex-col gap-0.5 rounded-[var(--radius-sm)] border px-3.5 py-2.5"
                      style={{
                        borderColor: active ? 'var(--primary)' : 'var(--border-field)',
                        background: active ? 'var(--primary-soft)' : 'var(--surface)',
                      }}
                    >
                      <input
                        type="radio"
                        name="horizon"
                        value={h}
                        checked={active}
                        onChange={() => setHorizon(h as Horizon)}
                        data-testid={`params-horizon-${h}`}
                        className="sr-only"
                      />
                      <span
                        className="flex items-center gap-2 text-[0.875rem] font-semibold"
                        style={{ color: active ? 'var(--primary)' : 'var(--text)' }}
                      >
                        {hint.title}
                        {'tag' in hint && hint.tag ? (
                          <span
                            className="rounded-full px-1.5 py-[1px] text-[0.625rem] font-semibold"
                            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                          >
                            {hint.tag}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
                        {hint.desc}
                      </span>
                    </label>
                  );
                })}
              </div>
              <FieldHelp>
                对应 <code>FR-MOD-02</code>。步长越长误差累积越明显，30 天场景下系统会在结果页
                自动追加误差放大提示。修改步长后下方耗时预估与右栏预测窗口会同步更新。
              </FieldHelp>
            </Field>

            {/* 节假日特征（`FR-FEA-10`） */}
            <Field label="节假日特征">
              <div
                className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3.5 py-2.5"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
              >
                <div className="min-w-0">
                  <div className="text-[0.8125rem] font-semibold">启用节假日特征</div>
                  <div className="mt-1 text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
                    使用内置节假日表（含双十一、双十二、圣诞、元旦、年货节），
                    对未来窗口内的节假日做销量抬升修正，并<strong>豁免异常尖峰截断</strong>
                    （大促尖峰是唯一可学的业务信号，不能被削掉）。
                  </div>
                </div>
                <label className="flex flex-none cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={holiday}
                    onChange={(e) => setHoliday(e.target.checked)}
                    data-testid="params-holiday"
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className="relative inline-block h-[18px] w-[34px] rounded-full transition-colors"
                    style={{ background: holiday ? 'var(--primary)' : 'var(--border-field)' }}
                  >
                    <span
                      className="absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all"
                      style={{
                        left: holiday ? '18px' : '2px',
                        background: 'var(--on-primary)',
                      }}
                    />
                  </span>
                  <span
                    className="text-[0.75rem] font-semibold"
                    style={{ color: holiday ? 'var(--primary)' : 'var(--text-3)' }}
                    data-testid="params-holiday-text"
                  >
                    {holiday ? '开启' : '关闭'}
                  </span>
                </label>
              </div>
              <FieldHelp>
                对应 <code>FR-FEA-10</code>。关闭后模型看不到节假日信号，
                大促窗口（双十一 / 双十二）的预测会明显偏低。
              </FieldHelp>
            </Field>

            {/* 高级设置：默认折叠（`UX-P06-04`） */}
            <details className="mt-3" data-testid="params-advanced">
              <summary
                className="cursor-pointer text-[0.8125rem] font-semibold"
                style={{ color: 'var(--text-2)' }}
              >
                高级设置（滑动窗口长度 / 模型版本）
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="滑动窗口长度" compact>
                  <div
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3.5 py-2.5"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                  >
                    <span className="mono text-[0.8125rem] font-semibold">
                      {PIPELINE_META.WINDOW_SIZE} 天
                    </span>
                    <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                      随权重冻结
                    </span>
                  </div>
                  <FieldHelp>
                    对应 <code>FR-FEA-02</code>。窗口长度决定模型输入张量的时间维，
                    必须与训练配置一致；本系统从权重元信息读取，页面只读展示。
                  </FieldHelp>
                </Field>
                <Field label="模型版本" compact>
                  <div
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3.5 py-2.5"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                  >
                    <span className="mono truncate text-[0.8125rem] font-semibold">
                      {modelVersion}
                    </span>
                    <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                      启用中
                    </span>
                  </div>
                  <FieldHelp>
                    对应 <code>FR-MOD-08</code>。权重由离线脚本注册，系统不做在线更新。
                  </FieldHelp>
                </Field>
              </div>
              <div className="mt-3">
                <NoticeBar variant="warning" title="关于在线训练">
                  本系统<strong>不提供在线重训练</strong>（📌 已确认决策）。
                  端到端 SLA 只有 {PIPELINE_META.TASK_BUDGET_MS / 1000} 秒，
                  而「训练 + 网格搜索调参 + 早停」无法稳定压进这个窗口，
                  故采用纯预训练推理。若需替换模型，请在离线侧运行{' '}
                  <code>scripts/train_and_register.py</code> 后重启服务。
                </NoticeBar>
              </div>
            </details>
          </Card>

          {/* ================= 3. 耗时预估与资源 ================= */}
          <Card
            title="3. 耗时预估与资源"
            testId="params-estimate"
            actions={
              <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                ⏱️ 基于本机实测标定（非文档示例值）
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric
                testId="metric-estimate"
                label="预估端到端耗时"
                value={estimateMs === null ? '—' : (estimateMs / 1000).toFixed(1)}
                unit="s"
                foot={
                  remainingPct === null
                    ? `上限 ${PIPELINE_META.TASK_BUDGET_MS / 1000} s`
                    : remainingPct < 0
                      ? // ⚠️ 预估已超预算时不能再写「余量 -X%」（`D-09`）：负的「余量」是自相矛盾的文案
                        `上限 ${PIPELINE_META.TASK_BUDGET_MS / 1000} s · 超预算 ${Math.abs(remainingPct).toFixed(1)}%`
                      : `上限 ${PIPELINE_META.TASK_BUDGET_MS / 1000} s · 余量 ${remainingPct.toFixed(1)}%`
                }
                tone={remainingPct !== null && remainingPct < 20 ? 'warning' : 'brand'}
              />
              <Metric
                testId="metric-device"
                label="预估推理设备"
                value={loadedDevice === 'cuda' ? 'GPU' : loadedDevice === 'cpu' ? 'CPU' : '—'}
                unit={loadedDevice === 'cuda' ? 'CUDA' : ''}
                foot="显存不足时自动回退"
                tone="plain"
              />
              <Metric
                testId="metric-l1"
                label="L1 序列批量规模"
                value={fmtInt(detail.level_preview.L1)}
                unit="条"
                foot="单批推理，不逐条循环"
                tone="plain"
              />
              <Metric
                testId="metric-fallback"
                label="失败回退"
                value="CPU"
                foot="模型与输入都搬到 CPU 重跑"
                tone="plain"
              />
            </div>

            <div className="mt-4" data-testid="params-budget">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-[0.75rem] font-semibold">
                  时间预算分配（总计 {PIPELINE_META.TASK_BUDGET_MS / 1000} s 硬上限）
                </span>
                <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                  实测占比标定 · 推理段最贵
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {PIPELINE_META.STAGES.map((s) => (
                  <BudgetRow
                    key={s.key}
                    name={shortLabel(s.label)}
                    ms={
                      estimateMs === null
                        ? null
                        : Math.round(s.budget_ratio * estimateMs)
                    }
                  />
                ))}
                <BudgetRow
                  name="预留余量"
                  // ⚠️ 必须夹到 0（`D-09`）：预估 > 60 s 时（正是 `over_budget_risk`
                  //    要提示的场景）原式会给出负耗时，渲染成「≈ -X.X s」。
                  //    进度条宽度虽已 clamp 到 0，文字却是负值。
                  ms={
                    estimateMs === null
                      ? null
                      : Math.max(0, PIPELINE_META.TASK_BUDGET_MS - estimateMs)
                  }
                  muted
                />
              </div>
            </div>
          </Card>

          {/* ================= 4. 提交 ================= */}
          <Card title="4. 提交任务" testId="params-submit-card">
            {phase === 'submitting' ? (
              <div data-testid="params-submitting">
                <NoticeBar variant="info" title="正在提交并执行预测任务…">
                  系统已登记任务并开始推理。同步接口最长等待{' '}
                  {PIPELINE_META.TASK_BUDGET_MS / 1000} 秒，请勿关闭页面。
                  <div
                    className="mt-2 h-[6px] w-full overflow-hidden rounded-full"
                    style={{ background: 'var(--border)' }}
                  >
                    <i
                      className="block h-full rounded-full transition-[width] duration-200"
                      style={{
                        background: 'var(--primary)',
                        // 进度按预估耗时折算，封顶 95%：▸ 预估只是估计，不给「已到 100% 还没返回」的假象
                        width: `${
                          estimateMs === null
                            ? 8
                            : Math.min(95, (elapsedMs / estimateMs) * 100)
                        }%`,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[0.6875rem]">
                    <span data-testid="params-elapsed">
                      已用 {(elapsedMs / 1000).toFixed(1)} s
                    </span>
                    <span>
                      {estimateMs === null
                        ? '预估中…'
                        : `预估约 ${(estimateMs / 1000).toFixed(1)} s`}
                    </span>
                  </div>
                </NoticeBar>
              </div>
            ) : (
              <>
                {submitError ? (
                  <div className="mb-3" data-testid="params-submit-error">
                    <NoticeBar
                      variant="danger"
                      title={`任务提交失败 · ${submitError.code}`}
                    >
                      {submitError.message}
                      <div className="mt-1.5">{submitError.hint}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void submit()}
                          data-testid="params-retry"
                          className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.75rem] font-semibold"
                          style={{
                            borderColor: 'var(--border-field)',
                            background: 'var(--surface)',
                            color: 'var(--text-2)',
                          }}
                        >
                          重试
                        </button>
                        <Link
                          to={BACK_LINK}
                          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[0.75rem] font-semibold"
                          style={{ background: 'none', color: 'var(--primary)' }}
                        >
                          返回修改数据
                        </Link>
                      </div>
                    </NoticeBar>
                  </div>
                ) : null}

                <Field label={`任务名称（可选，≤${TASK_NAME_MAX} 字，留空自动命名）`}>
                  <input
                    type="text"
                    value={taskName}
                    maxLength={TASK_NAME_MAX}
                    onChange={(e) => {
                      setTaskName(e.target.value);
                      if (nameError) setNameError(null);
                    }}
                    placeholder="例如：双十一前 · 分仓备货预测"
                    data-testid="params-task-name"
                    className="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-[0.8125rem]"
                    style={{
                      borderColor: nameError ? 'var(--danger)' : 'var(--border-field)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                    }}
                  />
                  {nameError ? (
                    <div
                      className="mt-1 text-[0.75rem]"
                      style={{ color: 'var(--danger)' }}
                      data-testid="params-name-error"
                    >
                      {nameError}
                    </div>
                  ) : (
                    <div className="mt-1 flex justify-between text-[0.6875rem]">
                      <span style={{ color: 'var(--text-3)' }}>
                        命名会写入历史记录，便于日后对比
                      </span>
                      <span className="mono" style={{ color: 'var(--text-3)' }}>
                        {taskName.length}/{TASK_NAME_MAX}
                      </span>
                    </div>
                  )}
                </Field>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void submit()}
                    data-testid="params-submit"
                    className="rounded-[var(--radius-sm)] px-4 py-2.5 text-[0.875rem] font-semibold"
                    style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
                  >
                    提交预测任务
                  </button>
                  <Link
                    to={BACK_LINK}
                    data-testid="params-back"
                    className="rounded-[var(--radius-sm)] border px-4 py-2.5 text-[0.875rem] font-semibold"
                    style={{
                      borderColor: 'var(--border-field)',
                      background: 'var(--surface-2)',
                      color: 'var(--text-2)',
                    }}
                  >
                    返回修改数据
                  </Link>
                </div>

                <div className="mt-2 text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
                  提交后将立即执行推理，最长等待 {PIPELINE_META.TASK_BUDGET_MS / 1000} 秒。
                  期间可停留在执行页查看进度，也可离开，任务完成后可在「历史任务」中查看结果
                  （UX-P06-09）。
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * 本页局部组件（仅参数页使用，不导出）
 * ========================================================================== */

function Field({
  label,
  children,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? '' : 'mt-3 first:mt-0'}>
      <div className="mb-1.5 text-[0.8125rem] font-semibold">{label}</div>
      {children}
    </div>
  );
}

function FieldHelp({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1.5 text-[0.75rem] leading-[1.8]" style={{ color: 'var(--text-3)' }}>
      {children}
    </div>
  );
}

/** 指标卡之一（预估耗时 / 设备 / 批量规模 / 回退） */
function Metric({
  label,
  value,
  unit,
  foot,
  tone,
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  foot: string;
  tone: 'brand' | 'warning' | 'plain';
  testId: string;
}) {
  const color =
    tone === 'brand' ? 'var(--primary)' : tone === 'warning' ? 'var(--warning)' : 'var(--text)';
  const bg =
    tone === 'brand'
      ? 'var(--primary-soft)'
      : tone === 'warning'
        ? 'var(--warning-soft)'
        : 'var(--surface-2)';
  return (
    <div
      data-testid={testId}
      className="rounded-[var(--radius-sm)] border p-3"
      style={{ borderColor: 'var(--border)', background: bg }}
    >
      <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="mono text-[1.375rem] font-bold" style={{ color }}>
        {value}
        {unit ? (
          <span className="ml-1 text-[0.75rem] font-semibold" style={{ color: 'var(--text-3)' }}>
            {unit}
          </span>
        ) : null}
      </div>
      <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
        {foot}
      </div>
    </div>
  );
}

/**
 * 时间预算分配条的一行：名称 + 轨道 + 数值。
 *
 * 🔒 **轨道刻度是 0–60 s 的绝对预算，不是「占管线耗时的比例」。**
 *    把各阶段占比归一化后拉满整条轨道，会顺手把「还剩多少预算」抹掉 ——
 *    而用户关心「会不会超时」的程度不亚于「哪段最贵」。故此处宽度 =
 *    `ms / TASK_BUDGET_MS`，与执行页那条 0–60 s 时间轴同刻度。
 */
function BudgetRow({
  name,
  ms,
  muted = false,
}: {
  name: string;
  /** 该段耗时（ms）；null = 数据未就绪 */
  ms: number | null;
  muted?: boolean;
}) {
  const pct = ms === null ? 0 : Math.max(0, Math.min(100, (ms / PIPELINE_META.TASK_BUDGET_MS) * 100));
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-[9.5rem] flex-none truncate text-[0.75rem]"
        style={{ color: muted ? 'var(--text-3)' : 'var(--text-2)' }}
        title={name}
      >
        {name}
      </span>
      <span
        className="h-[8px] flex-1 overflow-hidden rounded-full"
        style={{ background: 'var(--surface-2)' }}
        role="img"
        aria-label={
          ms === null ? `${name} 暂无数据` : `${name} 预计 ${secText(ms)}，占预算 ${pct.toFixed(1)}%`
        }
      >
        <i
          className="block h-full rounded-full"
          style={{
            width: `${pct.toFixed(2)}%`,
            background: muted ? 'var(--text-3)' : 'var(--primary)',
          }}
        />
      </span>
      <span
        className="mono w-[5.5rem] flex-none text-right text-[0.75rem]"
        style={{ color: 'var(--text-3)' }}
      >
        {ms === null ? '—' : `≈ ${secText(ms)}`}
      </span>
    </div>
  );
}

/* ============================================================================
 * 提交失败的分类文案（`UX-P06-08`：错误码 + 原因 + 重试 + 排查指引）
 * ========================================================================== */

function describeSubmitError(e: unknown): SubmitError {
  if (e instanceof ApiError) {
    switch (e.code) {
      case ERR.SERIES_OVER_LIMIT:
        return {
          code: e.code,
          message: e.message,
          hint:
            '排查指引：请按近 90 天销量取 Top N 商品重新上传，或先聚合到更少的仓库口径。' +
            '序列数下降后推理耗时近似线性下降。',
          retryable: false,
        };
      case ERR.BAD_PARAM:
        return {
          code: e.code,
          message: e.message,
          hint: '排查指引：预测步长只允许 7 / 14 / 30 天。请刷新页面后重选步长再提交。',
          retryable: false,
        };
      case ERR.DATASET_NOT_FOUND:
        return {
          code: e.code,
          message: e.message,
          hint: '排查指引：数据集可能已被清理（游客数据保留 24 小时）。请返回上传页重新选择数据。',
          retryable: false,
        };
      case ERR.MODEL_NOT_READY:
        return {
          code: e.code,
          message: e.message,
          hint:
            '排查指引：服务端当前没有启用中的模型版本。请在离线侧运行 ' +
            'scripts/train_and_register.py 注册权重后重启服务。',
          retryable: false,
        };
      default:
        return {
          code: e.code,
          message: e.message,
          hint:
            '排查指引：① 确认后端服务仍在运行（GET /health 应返回 status=ok）；' +
            '② 查看服务端日志中该时间点的异常栈；③ 若为显存不足，系统会自动回退 CPU 重跑，' +
            '回退失败时会给出 E_INFER_FAIL。',
          retryable: true,
        };
    }
  }
  return {
    code: 'network',
    message: e instanceof Error ? e.message : '无法连接服务',
    hint: '排查指引：① 确认后端已启动（默认 127.0.0.1:8000）；② 检查网络代理设置；③ 稍后重试。',
    retryable: true,
  };
}
