/**
 * 任务信息右栏（结果页专用）
 * =============================================================================
 * 抽出独立文件的原因：`useAsideContent()` 要求传入**引用稳定**的节点
 * （见 `layouts/aside-slot.tsx` 的说明 —— 每次渲染新建元素会无限循环）。
 * 用 `useMemo` 把节点缓存起来即可，但把卡片内容单独成文件后，
 * 主页面只需 `useAsideContent(useMemo(() => <ResultAside ... />, [deps]))`，
 * 依赖关系一眼可见。
 *
 * 🔒 右栏展示的耗时/规模数字全部取自 `API-14` 返回值，
 *    **不由前端估算**（`QD-06` / `GIT-7`）。
 */
import Card from '../Card';
import type { PredictionResultResponse } from '../../types';

type Props = { data: PredictionResultResponse };

function fmtMs(ms: number): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function ResultAside({ data }: Props) {
  const { task, dataset, coverage, metrics, timing_ms: timing } = data;

  const rows: Array<[string, string]> = [
    ['任务 ID', `#${task.id}`],
    ['任务名', task.task_name ?? '（未命名）'],
    ['预测步长', `${task.horizon} 天`],
    ['数据粒度', '仓库 × 商品'],
    ['模型版本', task.model_version],
    ['运行设备', task.device === 'cuda' ? 'GPU（CUDA）' : 'CPU'],
    ['总耗时', fmtMs(task.duration_ms)],
    ['创建时间', task.created_at],
  ];

  const timingRows: Array<[string, string]> = [
    ['数据校验', fmtMs(timing.preprocess_ms)],
    ['特征工程', fmtMs(timing.features_ms)],
    ['模型推理', fmtMs(timing.inference_ms)],
    ['指标计算', fmtMs(timing.metrics_ms)],
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="result-aside">
      <Card title="任务信息">
        <dl className="flex flex-col gap-1.5 text-[0.8125rem]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt style={{ color: 'var(--text-3)' }}>{k}</dt>
              <dd className="text-right" style={{ color: 'var(--text)' }}>{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="数据来源">
        <dl className="flex flex-col gap-1.5 text-[0.8125rem]">
          {([
            ['文件名', dataset.file_name],
            ['数据行数', dataset.row_count.toLocaleString('zh-CN')],
            ['商品数', String(dataset.sku_count)],
            ['仓库数', String(dataset.warehouse_count)],
            ['日期范围', `${dataset.date_start} ~ ${dataset.date_end}`],
          ] as Array<[string, string]>).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt style={{ color: 'var(--text-3)' }}>{k}</dt>
              <dd className="text-right" style={{ color: 'var(--text)' }}>{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="分级构成">
        <dl className="flex flex-col gap-1.5 text-[0.8125rem]">
          {([
            ['L1 模型预测', `${coverage.L1} 条`],
            ['L2 规则降级', `${coverage.L2} 条`],
            ['L3 不可预测', `${coverage.L3} 条`],
            ['参与评估', `${metrics.series_evaluated} 条（L1）`],
            ['预测点数', data.detail_total.toLocaleString('zh-CN')],
          ] as Array<[string, string]>).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt style={{ color: 'var(--text-3)' }}>{k}</dt>
              <dd className="text-right" style={{ color: 'var(--text)' }}>{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="分阶段耗时">
        <dl className="flex flex-col gap-1.5 text-[0.8125rem]">
          {timingRows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt style={{ color: 'var(--text-3)' }}>{k}</dt>
              <dd className="text-right tabular-nums" style={{ color: 'var(--text)' }}>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
          阶段耗时为单遍评测口径（与模型评测报告可比）；任务总耗时含回测与预测两遍及写库。
        </p>
      </Card>
    </div>
  );
}
