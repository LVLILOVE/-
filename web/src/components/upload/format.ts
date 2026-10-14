/**
 * 上传页专用的展示格式化工具（EP-4 / UX-P05）。
 *
 * 🔒 不复用 `demo-data.js` 的 `num()`：那是原型演示脚本的内嵌函数，
 *    按 `UX-GOV-01` 已停止移植。产品侧只保留这里的最小实现。
 */

/** 千分位整数：14305 → 14,305 */
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

/** 文件大小：0.42 MB / 512 KB（阈值 1 MB 切换单位，与原型一致） */
export function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return '—';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 展示用两位小数（指标类） */
export function fmtFixed(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

/** 扩展名是否被接受（FR-UPL-01：前端即时拦截，`FR-UPL-09` 的 ① 步同口径） */
export function hasCsvExtension(name: string): boolean {
  return name.toLowerCase().endsWith('.csv');
}
