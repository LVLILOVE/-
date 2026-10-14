/**
 * `PreviewTable` · 数据预览表（UX-P05）
 * -----------------------------------------------------------------------------
 * 依据：《UI/UX》§8.1「数据预览表（前 20 行，6 列）+ 搜索框」· `UX-P05-05`
 *      （须标注「系统实际读到的内容」并支持按商品/仓库搜索）
 *      PRD `FR-UPL-07`（表头与数据类型与源文件一致）
 *
 * 🔒 列是**动态**的：直接渲染接口返回的 `preview.columns`，不写死 4 列。
 *    原因（`FR-UPL-07`）：用户上传的 CSV 可能带额外列（如 `item_name`），
 *    预览若只显示固定 4 列，用户就无法确认「系统到底读到了哪些列」——
 *    而这正是本表存在的唯一理由。
 *    ⚠️ 与原型的一处受控偏离：原型预览表固定 6 列，其中「商品名称 / 仓库」两列
 *    来自 `demo-data.js` 的演示映射（真实 CSV 里没有）。产品侧没有这份映射，
 *    故按源文件列渲染。已登记为 EP-4 偏离项。
 *
 * 搜索走**服务端**（`API-10` 的 `keyword`）：只过滤当前 20 行会让用户
 * 搜不到第 300 行的商品，从而误判「数据里没有这个商品」。
 */
import type { DatasetPreview } from '../../types';

type Props = {
  preview: DatasetPreview;
  keyword: string;
  onKeywordChange: (v: string) => void;
  /** 服务端搜索进行中（用于输入框右侧的状态字） */
  searching?: boolean;
  /** 表格最大高度，超出滚动 */
  maxHeight?: number;
};

/** 右对齐的数值列：只按列名判断（`sales` 为大写无关匹配） */
function isNumericColumn(col: string): boolean {
  return col.toLowerCase() === 'sales';
}

export default function PreviewTable({
  preview,
  keyword,
  onKeywordChange,
  searching = false,
  maxHeight = 340,
}: Props) {
  const { columns, rows, total, shown } = preview;

  return (
    <div data-testid="preview-table">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[0.9375rem]">数据预览（前 {shown} 行）</h4>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-[0.75rem] outline-none"
            style={{
              width: 190,
              borderColor: 'var(--border-field)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
            }}
            placeholder="搜索商品 / 仓库"
            value={keyword}
            aria-label="按商品或仓库搜索预览数据"
            data-testid="preview-search"
            onChange={(e) => onKeywordChange(e.target.value)}
          />
          <span className="text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
            {searching ? '搜索中…' : '系统实际读到的内容'}
          </span>
        </div>
      </div>

      <div
        className="overflow-auto rounded-[var(--radius-sm)] border"
        style={{ maxHeight, borderColor: 'var(--border)' }}
      >
        <table className="w-full border-collapse text-[0.75rem]">
          <thead className="sticky top-0">
            <tr style={{ background: 'var(--surface-2)' }}>
              {columns.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className={`mono whitespace-nowrap px-3 py-2 font-semibold ${
                    isNumericColumn(c) ? 'text-right' : 'text-left'
                  }`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length)}
                  className="px-3 py-6 text-center"
                  style={{ color: 'var(--text-3)' }}
                >
                  没有匹配的行
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr
                  key={i}
                  className="border-t"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {columns.map((c) => (
                    <td
                      key={c}
                      className={`mono whitespace-nowrap px-3 py-1.5 ${
                        isNumericColumn(c) ? 'text-right' : 'text-left'
                      }`}
                      style={{ color: isNumericColumn(c) ? 'var(--text)' : 'var(--text-2)' }}
                    >
                      {r[c] === null || r[c] === undefined || r[c] === '' ? '—' : String(r[c])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-1.5 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
        本数据集共 {total.toLocaleString('en-US')} 行，此处展示 {shown} 行
        {keyword ? `（匹配「${keyword}」）` : ''}
      </div>
    </div>
  );
}
