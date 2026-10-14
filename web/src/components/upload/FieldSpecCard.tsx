/**
 * `FieldSpecCard` · CSV 字段规范卡（UX-P05 · 强制契约）
 * -----------------------------------------------------------------------------
 * 依据：《UI/UX》§8.1「字段规范卡：列名 / 中文含义 / 必需 / 类型 / 约束 / 缺失后果，
 *      6 列表格」+「校验顺序」徽标行
 *      PRD §3.2.2（列名不可改）、`FR-UPL-15` 的字段说明来源
 *
 * 🔒 校验顺序徽标取自 `VALIDATE_ORDER`（与后端 `algo.config` 同源），
 *    不在这里重抄一份字面量 —— 顺序一旦调整，本卡自动跟随。
 *
 * ⚠️ 两个「必需」却不同色的设计是刻意的：`warehouse_id` 用 `--danger`，
 *    因为它是分仓预测的立身之本，缺失时**没有降级路径**（`FR-UPL-05` / `JT-01`）；
 *    其余三列缺失同样是拒绝上传，但视觉上不额外强调，避免满屏红。
 */
import { REQUIRED_COLUMNS, VALIDATE_ORDER } from '../../types';

/** 字段说明：键必须覆盖 `REQUIRED_COLUMNS`，缺一个就会在下方自查中报错 */
const FIELD_SPEC: Record<
  string,
  { meaning: string; required: boolean; type: string; rule: string; miss: string }
> = {
  sku_id: {
    meaning: '商品编码',
    required: true,
    type: '字符串',
    rule: '非空，长度 ≤ 64',
    miss: '拒绝上传',
  },
  warehouse_id: {
    meaning: '仓库编码',
    required: true,
    type: '字符串',
    rule: '非空，长度 ≤ 64',
    miss: '拒绝上传（分仓预测的立身之本）',
  },
  date: {
    meaning: '日期',
    required: true,
    type: '日期',
    rule: '可解析，推荐 YYYY-MM-DD',
    miss: '拒绝上传',
  },
  sales: {
    meaning: '销量',
    required: true,
    type: '数值',
    rule: '≥ 0，整数或小数均可',
    miss: '拒绝上传',
  },
};

if (REQUIRED_COLUMNS.some((c) => !FIELD_SPEC[c])) {
  console.error('[EP-4] 字段规范卡缺少必需列的说明，请补齐 FIELD_SPEC');
}

export default function FieldSpecCard() {
  return (
    <div
      className="mt-4 rounded-[var(--radius)] border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      data-testid="field-spec-card"
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <h3 className="text-[1.0312rem]">CSV 字段规范</h3>
        <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
          强制契约 · 校验顺序不可调整
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[0.75rem]">
          <thead>
            <tr style={{ background: 'var(--surface-2)' }}>
              <th className="px-4 py-2 text-left font-semibold">列名</th>
              <th className="px-4 py-2 text-left font-semibold">中文含义</th>
              <th className="px-4 py-2 text-left font-semibold">必需</th>
              <th className="px-4 py-2 text-left font-semibold">类型</th>
              <th className="px-4 py-2 text-left font-semibold">约束</th>
              <th className="px-4 py-2 text-left font-semibold">缺失后果</th>
            </tr>
          </thead>
          <tbody>
            {REQUIRED_COLUMNS.map((col) => {
              const s = FIELD_SPEC[col];
              const emphasis = col === 'warehouse_id';
              return (
                <tr key={col} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="mono whitespace-nowrap px-4 py-2 font-semibold">{col}</td>
                  <td className="px-4 py-2" style={{ color: 'var(--text-2)' }}>{s.meaning}</td>
                  <td className="px-4 py-2">
                    <span
                      className="rounded-full px-2 py-[1px] text-[0.6875rem] font-semibold"
                      style={{
                        color: emphasis ? 'var(--danger)' : 'var(--success)',
                        background: emphasis ? 'var(--danger-soft)' : 'var(--success-soft)',
                      }}
                    >
                      必需
                    </span>
                  </td>
                  <td className="px-4 py-2" style={{ color: 'var(--text-2)' }}>{s.type}</td>
                  <td className="px-4 py-2" style={{ color: 'var(--text-2)' }}>{s.rule}</td>
                  <td
                    className="px-4 py-2"
                    style={{
                      color: emphasis ? 'var(--danger)' : 'var(--text-2)',
                      fontWeight: emphasis ? 650 : 400,
                    }}
                  >
                    {s.miss}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-1.5 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
          校验顺序（任一步失败即终止，不继续后续校验）
        </div>
        <div className="flex flex-wrap gap-1.5">
          {VALIDATE_ORDER.map((s, i) => (
            <span
              key={s}
              className="rounded-full px-2 py-[2px] text-[0.6875rem]"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              {i + 1} {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
