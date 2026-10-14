import fs from 'node:fs';
const src = fs.readFileSync('prototype/assets/demo-data.js', 'utf8');
const cut = src.indexOf('/* ---------- 1. 主题切换');
const head = src.indexOf('/* ---------- 2. 确定性伪随机');
// 跳过 DOM 相关的 1 和 10/11/12 段：拼装 theme stub + 2..9
const body = src.slice(head, src.indexOf('/* ---------- 10.'));
const stub = 'function initTheme(){} function toggleTheme(){}';
const api = new Function(stub + body + '\nreturn { buildDataset, computeTaskMetrics, BIZ, validCount };')();
const raw = api.buildDataset({ days: 120, endDate: api.BIZ.dateEnd, sparseSeed: 20261008 });
const levels = { L1: 0, L2: 0, L3: 0 };
raw.forEach(s => levels[s.level]++);
console.log('序列数', raw.length, levels);
console.log('validAfter 前12:', raw.slice(0, 12).map(s => `${s.itemId}-${s.storeCode}:${s.validAfter}`).join(' '));
const M = api.computeTaskMetrics(raw, 14);
console.log('MAPE', M.weightedMape.toFixed(2), 'MAE提升', M.maeImprove.toFixed(1), 'RMSE提升', M.rmseImprove.toFixed(1), '达标率', M.seriesPassRate.toFixed(1));
console.log('分档', M.l1Count, M.l2Count, M.l3Count);
console.log('L1 MAPE', M.l1Mape, 'L2 MAPE', M.l2Mape);
