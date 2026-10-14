/**
 * UX-P05 · 上传数据页（模板 B）
 * =============================================================================
 * 依据：《UI/UX 设计文档 V1.0》§8.1（全量）· PRD `FR-UPL-01` ~ `FR-UPL-15`
 *      ·《开发技术文档》§5.5 `API-06` ~ `API-11` · 本方案 `WS-4-01` ~ `WS-4-08`
 * 原型：`prototype/upload.html`（视觉与文案基准）
 * -----------------------------------------------------------------------------
 * 状态机（与原型 10 个 `.state-pill` 演示态一一对应，此处为真实状态）：
 *
 *   idle         待上传        拖拽区
 *   selected     已选文件      文件条（待上传徽标）
 *   uploading    上传中        文件条 + 进度条 + 百分比
 *   validating   校验中        第 N/7 步 + 进度条
 *   sample       加载示例      忙碌面板（不可数步骤，故不套 7 步）
 *   interpolating 断档插值     忙碌面板
 *   ok           校验通过      4 指标 + 预览 + 搜索 + 下一步
 *   error        校验失败      5 类分支（见 ErrorCard）
 *
 * 🔒 三条硬约束在本页的落点：
 *   1. **游客可达**（`FR-USR-08` / `JT-10`）：本页及后续 `/params` 刻意不加
 *      `RequireAuth`；数据归属由后端写 `user_id = 0`，前端不感知。
 *   2. **断档不自动继续**（`FR-UPL-13`）：`40005` 只呈现「自动插值 / 放弃」，
 *      用户不点就停在这里 —— 不做任何自动跳转。
 *   3. **失败卡也能下载明细**（`API-11`）：`data.dataset_id` 非空时渲染下载按钮；
 *      扩展名/大小两种前置拦截没有数据集行，按钮不出现。
 *
 * ⚠️ 刻意**没有**移植原型里的 `.state-bar` / `.spec-note`：
 *   `.state-bar` 是原型用来切换演示状态的调试控件，产品里状态由真实交互驱动；
 *   `.spec-note`（「本页与 PRD 的对应关系」表）是交付评审用的说明，不是产品 UI。
 *   二者移除符合 `UX-GOV-01`（停止移植原型演示痕迹）。
 * =============================================================================
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, datasetApi, saveBlob } from '../api/client';
import Card from '../components/Card';
import NoticeBar from '../components/NoticeBar';
import DropZone from '../components/upload/DropZone';
import ErrorCard from '../components/upload/ErrorCard';
import FieldSpecCard from '../components/upload/FieldSpecCard';
import FileChip from '../components/upload/FileChip';
import PreviewTable from '../components/upload/PreviewTable';
import UploadAside from '../components/upload/UploadAside';
import ValidationPanel, { BusyPanel, VALIDATE_TOTAL } from '../components/upload/ValidationPanel';
import { fmtBytes, fmtInt, hasCsvExtension } from '../components/upload/format';
import { useAsideContent } from '../layouts/aside-slot';
import { useAuthStore } from '../store/useAuthStore';
import { useTaskStore } from '../store/useTaskStore';
import { ERR, LIMITS } from '../types';
import type { DatasetPreview, UploadDatasetResponse, ValidationErrorData } from '../types';

/**
 * 右栏内容：**模块级常量**，引用永久稳定。
 * 见 `layouts/aside-slot.tsx` 的说明 —— 每次渲染新建元素会导致插槽无限重渲染。
 */
const UPLOAD_ASIDE = <UploadAside />;

/** 校验失败（可结构化呈现）的业务码集合，其余错误走普通提示条 */
const VALIDATION_CODES: number[] = [
  ERR.MISSING_COLUMN,
  ERR.DATE_UNPARSABLE,
  ERR.NEGATIVE_VALUE,
  ERR.SERIES_OVER_LIMIT,
  ERR.DATE_GAP,
  ERR.INSUFFICIENT_DATA,
  ERR.FILE_TOO_LARGE,
  ERR.ROW_OVER_LIMIT,
  ERR.BAD_EXTENSION,
  ERR.EMPTY_FILE,
];

/**
 * 「校验中」面板的最短展示时长。
 *
 * ⚠️ 这不是伪造状态：校验**确实**发生了（实测本机 < 100 ms 返回）。
 *    但若结果卡瞬间替换掉校验面板，用户会怀疑「是不是根本没校验」。
 *    与登录页「提交中」按钮同理，属于界面节奏控制。
 */
const MIN_VALIDATE_MS = 900;

/** 步骤动画的推进间隔（7 步 × 260ms ≈ 1.7s，够看清是哪一步） */
const STEP_INTERVAL_MS = 260;

type Phase =
  | 'idle'
  | 'selected'
  | 'uploading'
  | 'validating'
  | 'sample'
  | 'interpolating'
  | 'ok'
  | 'error';

type Notice = { variant: 'info' | 'success' | 'warning' | 'danger'; title: string; text: string };

const STEP_BADGES = ['1 · 上传数据', '2 · 确认参数', '3 · 执行预测', '4 · 查看结果'];

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export default function UploadPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setDatasetId = useTaskStore((s) => s.setDatasetId);

  // 把右栏交给布局（引用稳定，只挂载一次）
  useAsideContent(UPLOAD_ASIDE);

  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<UploadDatasetResponse | null>(null);
  const [err, setErr] = useState<{ code: number; message: string; data: ValidationErrorData | null } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [keyword, setKeyword] = useState('');
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [searching, setSearching] = useState(false);

  /** 防止「用户已点重置」后迟到的响应把结果又写回去 */
  const runIdRef = useRef(0);

  /* ---------------------------------------------------------------- 校验步骤动画 */
  useEffect(() => {
    if (phase !== 'validating') return;
    setStepIndex(0);
    const timer = window.setInterval(() => {
      setStepIndex((i) => (i < VALIDATE_TOTAL - 1 ? i + 1 : i));
    }, STEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* ---------------------------------------------------------------- 预览搜索 */
  useEffect(() => {
    if (phase !== 'ok' || !result) return;
    const kw = keyword.trim();
    if (!kw) {
      // 清空搜索回到首次响应里的预览，不额外发请求
      setPreview(result.preview);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      datasetApi
        .preview(result.dataset.id, 20, kw)
        .then(setPreview)
        // 搜索失败保留上一次结果：输入过程中不打断用户（`NFR-USE-03`）
        .catch(() => undefined)
        .finally(() => setSearching(false));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [keyword, phase, result]);

  /* ---------------------------------------------------------------- 公共动作 */

  function reset() {
    runIdRef.current += 1;
    setPhase('idle');
    setFile(null);
    setPercent(0);
    setStepIndex(0);
    setResult(null);
    setErr(null);
    setNotice(null);
    setKeyword('');
    setPreview(null);
    setSearching(false);
  }

  function applyOk(resp: UploadDatasetResponse) {
    setResult(resp);
    setPreview(resp.preview);
    setKeyword('');
    setErr(null);
    setPhase('ok');
  }

  /** 服务端返回的**校验失败** → 结构化错误卡（网络/500 不走这里，见调用方） */
  function applyFail(e: ApiError) {
    setErr({
      code: e.code,
      message: e.message,
      data: (e.data ?? null) as ValidationErrorData | null,
    });
    setPhase('error');
  }

  /* ---------------------------------------------------------------- 上传主链路 */

  /**
   * 阶段一：选中文件 + 前置拦截（本地即判定，`FR-UPL-01` 要求「即时」）。
   *
   * ⚠️ 与原型一致的语义：选中后进入 **`selected`（待上传）** 而不是直接开传 ——
   *    原型里「已选择文件」与「上传中」是两个独立状态，且用户需要看到文件条
   *    确认自己选对了（大文件重传一次的代价很高）。上传由显式的「开始上传」触发。
   */
  function pickFile(picked: File) {
    runIdRef.current += 1;

    setNotice(null);
    setErr(null);
    setResult(null);
    setPreview(null);
    setKeyword('');
    setFile(picked);
    setPercent(0);
    setStepIndex(0);

    // --- 前置拦截：提示形态与后端回包一致（同一套错误卡） ---
    if (!hasCsvExtension(picked.name)) {
      setErr({
        code: ERR.BAD_EXTENSION,
        message: '文件扩展名必须是 .csv',
        data: {
          fail_stage: '扩展名',
          suggestion:
            '请上传 .csv 文件。若源文件是 Excel，请在「另存为」中选择 CSV（逗号分隔）；' +
            '直接改扩展名会得到一个内容仍是 xlsx 的假 CSV，无法被解析。',
          dataset_id: null,
        },
      });
      setPhase('error');
      return;
    }
    const maxBytes = LIMITS.max_file_size_mb * 1024 * 1024;
    if (picked.size > maxBytes) {
      setErr({
        code: ERR.FILE_TOO_LARGE,
        message: `文件大小 ${fmtBytes(picked.size)} 超过上限 ${LIMITS.max_file_size_mb} MB`,
        data: {
          fail_stage: '大小/行数',
          suggestion:
            '请按时间或商品拆分后分批上传。也可以只保留建模所需的 4 列' +
            '（sku_id / warehouse_id / date / sales）以显著减小体积。',
          dataset_id: null,
        },
      });
      setPhase('error');
      return;
    }

    setPhase('selected');
  }

  /** 阶段二：真正上传并等待校验结果（由「开始上传」触发，也用于失败后重试） */
  async function runUpload(picked: File) {
    runIdRef.current += 1;
    const runId = runIdRef.current;

    setNotice(null);
    setErr(null);
    setPercent(0);
    setPhase('uploading');

    const clock = { validatingAt: 0 };
    const markValidating = () => {
      if (!clock.validatingAt) clock.validatingAt = performance.now();
      setPhase('validating');
    };

    try {
      const resp = await datasetApi.upload(picked, (p) => {
        setPercent(p);
        if (p >= 100) markValidating();
      });
      markValidating();
      if (runId !== runIdRef.current) return; // 期间用户已重置
      const elapsed = performance.now() - (clock.validatingAt || performance.now());
      if (elapsed < MIN_VALIDATE_MS) await sleep(MIN_VALIDATE_MS - elapsed);
      if (runId !== runIdRef.current) return;
      applyOk(resp);
    } catch (e) {
      if (runId !== runIdRef.current) return;
      // 只有「业务校验未通过」才用校验失败卡；网络/超时/500 不是校验结论
      if (e instanceof ApiError && VALIDATION_CODES.includes(e.code)) {
        applyFail(e);
        return;
      }
      setNotice({
        variant: 'danger',
        title: '上传失败',
        text:
          e instanceof ApiError
            ? e.message
            : '请稍后重试。若持续失败，请检查网络连接或联系管理员。',
      });
      // 回到「待上传」态：文件还在内存里，用户点「开始上传」即可原样重试，
      // 不必重新选一遍大文件
      setPhase('selected');
    }
  }

  /* ---------------------------------------------------------------- 辅助入口 */

  async function handleSample() {
    setNotice(null);
    setErr(null);
    setResult(null);
    setKeyword('');
    setPhase('sample');
    try {
      const resp = await datasetApi.loadSample();
      applyOk(resp);
    } catch (e) {
      setNotice({
        variant: 'danger',
        title: '示例数据加载失败',
        text: e instanceof ApiError ? e.message : '请稍后重试。',
      });
      setPhase('idle');
    }
  }

  async function handleTemplate() {
    try {
      const blob = await datasetApi.downloadTemplate();
      saveBlob(blob, '销量预测_标准模板.csv');
      setNotice({
        variant: 'success',
        title: '模板已下载',
        text: '模板含表头与 2 行示例数据，按同样格式填写后可直接通过校验。',
      });
    } catch (e) {
      setNotice({
        variant: 'danger',
        title: '模板下载失败',
        text: e instanceof ApiError ? e.message : '请稍后重试。',
      });
    }
  }

  async function handleDownloadErrors(datasetId: number) {
    try {
      const blob = await datasetApi.downloadErrors(datasetId);
      saveBlob(blob, `错误明细_${datasetId}.csv`);
    } catch (e) {
      setNotice({
        variant: 'warning',
        title: '错误明细不可下载',
        text:
          e instanceof ApiError
            ? `${e.message}（错误明细自校验起 1 小时内有效，过期或已修复的数据集不再保留）`
            : '请稍后重试。',
      });
    }
  }

  async function handleResolveGap(datasetId: number, action: 'interpolate' | 'abort') {
    if (action === 'abort') {
      try {
        await datasetApi.resolveGap({ dataset_id: datasetId, action: 'abort' });
      } catch {
        // 放弃是幂等操作：即便请求失败也不该把用户卡在错误卡里
      }
      reset();
      setNotice({
        variant: 'info',
        title: '已放弃本次上传',
        text: '原始文件未做任何修改。补齐缺失日期后可随时重新上传。',
      });
      return;
    }

    setPhase('interpolating');
    try {
      const resp = await datasetApi.resolveGap({ dataset_id: datasetId, action: 'interpolate' });
      applyOk(resp);
    } catch (e) {
      setNotice({
        variant: 'danger',
        title: '插值补齐失败',
        text: e instanceof ApiError ? e.message : '请稍后重试。',
      });
      setPhase('error');
    }
  }

  function goParams() {
    if (!result) return;
    setDatasetId(result.dataset.id);
    // dataset_id 走 query：刷新 / 分享 / 前进后退都不会丢（游客链路无持久化）
    navigate(`/params?datasetId=${result.dataset.id}`);
  }

  /* ---------------------------------------------------------------- 渲染 */

  const showUploadCard =
    phase === 'idle' || phase === 'selected' || phase === 'uploading' || phase === 'error';

  return (
    <div data-testid="upload-page" data-phase={phase}>
      <div className="mb-4">
        <div className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>
          工作台 / 新建预测 / 上传数据
        </div>
        <h1 className="mt-1 text-[1.5rem]">上传历史销量数据</h1>
        <p className="mt-1.5 text-[0.8125rem] leading-[1.75]" style={{ color: 'var(--text-2)' }}>
          支持 CSV 格式，单文件不超过 {LIMITS.max_file_size_mb} MB、
          {fmtInt(LIMITS.max_rows)} 行。必需字段为 <code>sku_id</code>、<code>warehouse_id</code>、
          <code>date</code>、<code>sales</code>，其中仓库列为必需项，缺失将直接拒绝。
        </p>
      </div>

      {/* 步骤条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[0.75rem]">
        {STEP_BADGES.map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span style={{ color: 'var(--text-3)' }}>→</span>}
            <span
              className="rounded-full px-2 py-[2px] font-semibold"
              style={
                i === 0
                  ? { background: 'var(--primary-soft)', color: 'var(--on-primary-soft)' }
                  : { background: 'var(--surface-2)', color: 'var(--text-3)' }
              }
            >
              {s}
            </span>
          </span>
        ))}
      </div>

      {notice && (
        <div className="mb-3">
          <NoticeBar
            variant={notice.variant}
            title={notice.title}
            extra={
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="关闭提示"
                style={{ background: 'none', color: 'var(--text-3)' }}
              >
                ✕
              </button>
            }
          >
            {notice.text}
          </NoticeBar>
        </div>
      )}

      {!isAuthenticated && (
        <div className="mb-3">
          <NoticeBar variant="info" title="未登录体验模式">
            你可以直接上传数据并跑完预测流程，数据仅本次会话可见、24 小时后自动清理。
            导出结果与查看历史记录需要登录。
          </NoticeBar>
        </div>
      )}

      {/* ---------- ① 选择数据文件 ---------- */}
      {showUploadCard && (
        <Card
          title="1. 选择数据文件"
          testId="upload-card"
          actions={
            (phase === 'selected' || phase === 'uploading') && (
              <button
                type="button"
                onClick={reset}
                disabled={phase === 'uploading'}
                data-testid="upload-reset"
                className="text-[0.75rem]"
                style={{
                  background: 'none',
                  color: 'var(--text-3)',
                  cursor: phase === 'uploading' ? 'not-allowed' : 'pointer',
                }}
              >
                重置
              </button>
            )
          }
        >
          {phase === 'idle' ? (
            <DropZone onFile={pickFile} />
          ) : file ? (
            <>
              <FileChip
                file={{ name: file.name, size: file.size }}
                status={phase === 'uploading' ? 'uploading' : 'selected'}
                percent={percent}
                onRemove={reset}
                disabled={phase === 'uploading'}
              />
              {phase === 'selected' && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runUpload(file)}
                    data-testid="start-upload"
                    className="rounded-[var(--radius-sm)] px-3.5 py-2 text-[0.8125rem] font-semibold"
                    style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
                  >
                    开始上传
                  </button>
                  <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
                    上传后会依次执行 7 项校验，任一项不通过都不会写入历史记录
                  </span>
                </div>
              )}
            </>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleTemplate}
              data-testid="download-template"
              className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.75rem] font-semibold"
              style={{
                borderColor: 'var(--border-field)',
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
              }}
            >
              下载标准模板
            </button>
            <button
              type="button"
              onClick={handleSample}
              data-testid="load-sample"
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[0.75rem] font-semibold"
              style={{ background: 'none', color: 'var(--primary)' }}
            >
              改用示例数据（菜鸟数据集抽样）
            </button>
          </div>
        </Card>
      )}

      {/* ---------- ② 校验中 ---------- */}
      {phase === 'validating' && (
        <div className="mt-4">
          <ValidationPanel stepIndex={stepIndex} />
          {file && (
            <div className="mt-2 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
              正在处理：{file.name}（{fmtBytes(file.size)}）
            </div>
          )}
        </div>
      )}

      {/* ---------- ②' 忙碌（插值补齐 / 加载示例） ---------- */}
      {phase === 'interpolating' && (
        <div className="mt-4">
          <BusyPanel title="正在按线性插值补齐缺失日期…" hint="补齐后会直接给出新的数据概要" />
        </div>
      )}
      {phase === 'sample' && (
        <div className="mt-4">
          <BusyPanel
            title="正在加载示例数据…"
            hint="菜鸟「需求预测与分仓规划」数据集抽样"
          />
        </div>
      )}

      {/* ---------- ③ 校验失败 ---------- */}
      {phase === 'error' && err && (
        <div className="mt-4">
          <ErrorCard
            code={err.code}
            message={err.message}
            data={err.data}
            onReset={reset}
            onDownloadErrors={handleDownloadErrors}
            onResolveGap={handleResolveGap}
          />
        </div>
      )}

      {/* ---------- ④ 校验通过 ---------- */}
      {phase === 'ok' && result && (
        <div className="mt-4">
          <Card
            title="数据校验通过"
            titleColor="var(--success)"
            testId="ok-card"
            badge={
              <span
                className="rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
                style={{ color: 'var(--on-success-soft)', background: 'var(--success-soft)' }}
              >
                {VALIDATE_TOTAL}/{VALIDATE_TOTAL} 项检查全部通过
              </span>
            }
          >
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric
                testId="metric-row_count"
                label="数据行数"
                value={fmtInt(result.dataset.row_count)}
                foot={`时间范围 ${result.dataset.date_start} ~ ${result.dataset.date_end}`}
                tone="success"
              />
              <Metric
                testId="metric-sku_count"
                label="商品数"
                value={fmtInt(result.dataset.sku_count)}
                foot="去重 sku_id"
                tone="success"
              />
              <Metric
                testId="metric-warehouse_count"
                label="仓库数"
                value={fmtInt(result.dataset.warehouse_count)}
                foot="去重 warehouse_id"
                tone="success"
              />
              <Metric
                testId="metric-series_count"
                label="待预测序列数"
                value={fmtInt(result.dataset.valid_series_count)}
                foot={`上限 ${fmtInt(result.series_limit)} · 占用 ${(
                  (result.dataset.valid_series_count / result.series_limit) *
                  100
                ).toFixed(1)}%`}
                tone="brand"
              />
            </div>

            {result.gap_warning?.interpolated && (
              <div className="mb-4">
                <NoticeBar variant="warning" title="已按线性插值补齐断档">
                  本次补齐 {fmtInt(result.gap_warning.gap_count)} 个断档区间
                  {result.gap_warning.ranges?.length
                    ? `，涉及 ${fmtInt(result.gap_warning.ranges.length)} 条序列`
                    : ''}
                  。补齐仅作用于缺失日期，不会改动你原始文件里的任何一行。
                </NoticeBar>
              </div>
            )}

            {preview && (
              <PreviewTable
                preview={preview}
                keyword={keyword}
                onKeywordChange={setKeyword}
                searching={searching}
              />
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={goParams}
                data-testid="next-params"
                className="rounded-[var(--radius-sm)] px-3.5 py-2 text-[0.8125rem] font-semibold"
                style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
              >
                下一步：确认预测参数
              </button>
              <button
                type="button"
                onClick={reset}
                data-testid="ok-reset"
                className="rounded-[var(--radius-sm)] border px-3.5 py-2 text-[0.8125rem] font-semibold"
                style={{
                  borderColor: 'var(--border-field)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                }}
              >
                重新上传
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ---------- ⑤ 字段规范（常驻） ---------- */}
      <FieldSpecCard />
    </div>
  );
}

/** 4 指标卡之一（`UX-P05` 通过卡的指标网格） */
function Metric({
  label,
  value,
  foot,
  tone,
  testId,
}: {
  label: string;
  value: string;
  foot: string;
  tone: 'success' | 'brand';
  testId: string;
}) {
  const color = tone === 'success' ? 'var(--success)' : 'var(--primary)';
  const bg = tone === 'success' ? 'var(--success-soft)' : 'var(--primary-soft)';
  return (
    <div
      data-testid={testId}
      className="rounded-[var(--radius-sm)] border p-3"
      style={{ borderColor: 'var(--border)', background: bg }}
    >
      <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="mono text-[1.375rem] font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>{foot}</div>
    </div>
  );
}
