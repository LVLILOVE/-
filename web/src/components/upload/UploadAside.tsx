/**
 * `UploadAside` · 上传页右栏（模板 B）
 * -----------------------------------------------------------------------------
 * 依据：《UI/UX》§8.1「右栏：数据要求速查卡 + “这份数据会怎么用”卡」
 *      + 数据用途声明（`NFR-SEC-05` 最小暴露 / `FR-USR-08` 游客数据说明）
 *
 * 🔒 三处**按文档口径修正**了原型里的数字（原型无文档依据，属于演示文案）：
 *    ① 「最少历史 28 天」→「模型建模门槛 90 个有效历史点」（`FR-FEA-09`：L1 ≥ 90）
 *    ② 「P99.5 / 均值+3σ」→「滚动中位数 ± 3×MAD，营销节点豁免」
 *       （`preprocess.truncate_spikes` 的真实实现；用 MAD 而非标准差是因为
 *        大促尖峰会把标准差本身拉高，3σ 门限跟着抬高反而放过尖峰）
 *    ③ 补一行「编码 UTF-8（兼容 GB18030 回退）」——国内 Excel 另存 CSV 默认是
 *       GB18030，不写清楚会让用户以为必须转码
 *    三者均登记为 EP-4 偏离项（原型 → 实装的数值口径修正）。
 *
 * 本组件是**纯静态**的：不留 props、不做请求。上传页据此把它提为模块级常量，
 * 交给布局的右栏插槽一次挂载 —— 避免每次状态变化都重建这一整块 DOM。
 */
import { LIMITS } from '../../types';

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0"
      style={{ borderColor: 'var(--border)' }}
    >
      <dt className="text-[0.75rem]" style={{ color: 'var(--text-3)' }}>{k}</dt>
      <dd className="mono text-[0.75rem] font-semibold" style={{ margin: 0 }}>{v}</dd>
    </div>
  );
}

const USAGE_STEPS: Array<{ title: string; text: string }> = [
  { title: '字段校验', text: '逐项检查必需列、日期格式与数值合法性' },
  { title: '清洗', text: '缺失线性插值、异常尖峰截断（滚动中位数 ± 3×MAD，营销节点豁免）' },
  { title: '序列分级', text: '按有效历史点数打 L1 / L2 / L3 标签' },
  { title: '推理', text: '加载预训练模型批量前向，不重新训练' },
  { title: '对照', text: '计算移动平均基线与加权指标' },
];

export default function UploadAside() {
  return (
    <>
      <div
        className="rounded-[var(--radius-sm)] border"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <h4 className="text-[0.9375rem]">数据要求速查</h4>
        </div>
        <dl className="px-4 py-2">
          <Row k="文件格式" v=".csv" />
          <Row k="大小上限" v={`${LIMITS.max_file_size_mb} MB`} />
          <Row k="行数上限" v={LIMITS.max_rows.toLocaleString('en-US')} />
          <Row k="序列数上限" v={LIMITS.max_series.toLocaleString('en-US')} />
          <Row k="日期格式" v="YYYY-MM-DD" />
          <Row k="编码" v="UTF-8（兼容 GB18030）" />
          <Row k="建模门槛" v={`${LIMITS.l1_min_valid_points} 个有效点`} />
        </dl>
        <div
          className="border-t px-4 py-2 text-[0.6875rem] leading-[1.7]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
        >
          有效历史点数不足 {LIMITS.l1_min_valid_points} 的序列不会导致上传失败：
          系统会自动降级为规则兜底或全局均值（L2 / L3），只影响置信度，不影响可用性。
        </div>
      </div>

      <div
        className="mt-3 rounded-[var(--radius-sm)] border"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <h4 className="text-[0.9375rem]">这份数据会怎么用</h4>
        </div>
        <div className="px-4 py-3">
          {USAGE_STEPS.map((s) => (
            <div key={s.title} className="mb-1.5 flex items-start gap-2 last:mb-0">
              <span
                aria-hidden
                className="mt-[6px] h-[7px] w-[7px] flex-none rounded-full"
                style={{ background: 'var(--info)' }}
              />
              <span className="text-[0.75rem] leading-[1.8]" style={{ color: 'var(--text-2)' }}>
                <strong>{s.title}</strong>：{s.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        className="mt-3 flex gap-2.5 rounded-[var(--radius-sm)] px-3 py-2.5"
        style={{ background: 'var(--info-soft)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 flex-none">
          <path
            d="M12 3l7 3v5.5c0 4.3-2.9 8-7 9.5-4.1-1.5-7-5.2-7-9.5V6l7-3z"
            stroke="var(--info)"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M9 12l2 2 4-4" stroke="var(--info)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="text-[0.75rem] leading-[1.7]">
          <div className="font-bold">数据用途</div>
          <p style={{ color: 'var(--text-2)' }}>
            你上传的数据仅用于本次预测计算，不作其他用途，其他用户无法访问。
            未登录时上传的数据 24 小时后自动清理。
          </p>
        </div>
      </div>
    </>
  );
}
