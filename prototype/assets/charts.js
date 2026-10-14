/* ==========================================================================
   轻量 SVG 图表库（无外部依赖，离线可用）
   产出与后端 ECharts 方案视觉一致的图元，供原型演示使用。
   所有图表使用语义化 CSS 变量着色，自动跟随深浅色主题。
   ========================================================================== */

/** 读取当前主题下的 CSS 变量值 */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 数值友好格式化（图表轴用） */
function axisNum(v) {
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(v % 10000 === 0 ? 0 : 1) + '万';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
  return String(Math.round(v));
}

/** 线性映射 */
function scaleLinear(domain, range) {
  const [d0, d1] = domain, [r0, r1] = range;
  const span = d1 - d0 || 1;
  const fn = (v) => r0 + ((v - d0) / span) * (r1 - r0);
  fn.invert = (r) => d0 + ((r - r0) / (r1 - r0)) * span;
  return fn;
}

/**
 * 折线图：历史实线 + 预测虚线 + 置信区间带。
 * @param {object} o
 * @param {Array<{date:string,value:number|null}>} o.history
 * @param {Array<{date:string,predict:number|null,lower?:number,upper?:number}>} o.forecast
 * @param {number} o.height
 * @param {boolean} o.showBand
 * @param {number|null} o.limitLine
 */
function lineChart(o) {
  const id = o.id || 'chart-' + Math.random().toString(36).slice(2, 8);
  const H = o.height || 300;
  const W = 960;
  const m = { t: 18, r: 20, b: 34, l: 52 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const hist = (o.history || []).filter((p) => p.value !== null);
  const fcast = (o.forecast || []).filter((p) => p.predict !== null);

  // 统一时间轴：历史 + 预测
  const allDates = [...(o.history || []).map((p) => p.date), ...(o.forecast || []).map((p) => p.date)];
  if (!allDates.length) return '<div class="empty"><p>无数据</p></div>';

  const vals = [];
  hist.forEach((p) => vals.push(p.value));
  fcast.forEach((p) => { vals.push(p.predict); if (p.upper != null) vals.push(p.upper); });
  if (o.limitLine != null) vals.push(o.limitLine);
  let vMax = Math.max(...vals, 1) * 1.08;
  let vMin = Math.min(...vals, 0);
  vMin = Math.min(vMin, vMax * 0.05);
  vMin = Math.max(0, vMin - vMax * 0.04);

  const x = scaleLinear([0, Math.max(1, allDates.length - 1)], [m.l, m.l + iw]);
  const y = scaleLinear([vMin, vMax], [m.t + ih, m.t]);

  const colorLine = o.color || cssVar('--c1');
  const colorFc = o.colorForecast || cssVar('--c3');
  const colorText = cssVar('--text-3');
  const colorGrid = cssVar('--border');
  const colorBand = o.bandColor || cssVar('--c3');

  const dateIdx = new Map(allDates.map((d, i) => [d, i]));
  const histPts = hist.map((p) => [x(dateIdx.get(p.date)), y(p.value)]);
  const fcPts = fcast.map((p) => [x(dateIdx.get(p.date)), y(p.predict)]);

  // 预测起点：衔接最后一条历史点，视觉连续
  const bridge = histPts.length && fcPts.length ? [histPts[histPts.length - 1], ...fcPts] : fcPts;

  const path = (pts) => pts.length
    ? 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L')
    : '';

  let band = '';
  if (o.showBand !== false && fcast.length && fcast.some((p) => p.upper != null)) {
    const up = fcast.filter((p) => p.upper != null).map((p) => [x(dateIdx.get(p.date)), y(p.upper)]);
    const lo = fcast.filter((p) => p.lower != null).map((p) => [x(dateIdx.get(p.date)), y(p.lower)]);
    if (up.length && lo.length === up.length) {
      const d = path(up) + 'L' + lo.slice().reverse().map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
      band = `<path d="${d}" fill="${colorBand}" opacity="0.16"/>`;
    }
  }

  // 网格与 Y 轴刻度
  const ticks = 5;
  let grid = '', yLabels = '';
  for (let i = 0; i <= ticks; i++) {
    const v = vMin + ((vMax - vMin) / ticks) * i;
    const yy = y(v);
    grid += `<line x1="${m.l}" y1="${yy.toFixed(1)}" x2="${m.l + iw}" y2="${yy.toFixed(1)}" stroke="${colorGrid}" stroke-width="1" stroke-dasharray="${i === 0 ? '0' : '3 3'}"/>`;
    yLabels += `<text x="${m.l - 8}" y="${(yy + 3.5).toFixed(1)}" fill="${colorText}" font-size="10" text-anchor="end" font-family="var(--font-mono)">${axisNum(v)}</text>`;
  }

  // X 轴刻度（最多 8 个）
  const step = Math.max(1, Math.ceil(allDates.length / 8));
  let xLabels = '';
  allDates.forEach((d, i) => {
    if (i % step !== 0 && i !== allDates.length - 1) return;
    xLabels += `<text x="${x(i).toFixed(1)}" y="${H - 12}" fill="${colorText}" font-size="10" text-anchor="middle">${d.slice(5)}</text>`;
  });

  // 历史/预测分界
  let divider = '';
  if (histPts.length && fcPts.length) {
    const dx = histPts[histPts.length - 1][0];
    divider = `<line x1="${dx.toFixed(1)}" y1="${m.t}" x2="${dx.toFixed(1)}" y2="${m.t + ih}" stroke="${colorFc}" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.7"/>
    <text x="${(dx + 5).toFixed(1)}" y="${m.t + 11}" fill="${colorFc}" font-size="10" font-weight="600">预测起点</text>`;
  }

  // 限值参考线
  let limit = '';
  if (o.limitLine != null) {
    limit = `<line x1="${m.l}" y1="${y(o.limitLine).toFixed(1)}" x2="${m.l + iw}" y2="${y(o.limitLine).toFixed(1)}" stroke="${cssVar('--warning')}" stroke-width="1.2" stroke-dasharray="6 3" opacity="0.85"/>`;
  }

  // 预测点
  const fDots = fcPts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="${colorFc}"/>`).join('');

  return `
  <div class="chart-box">
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${o.aria || '销量历史与预测折线图'}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="${id}-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${colorLine}" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="${colorLine}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}${yLabels}${xLabels}
      ${limit}${band}
      ${histPts.length ? `<path d="${path(histPts)}L${histPts[histPts.length - 1][0].toFixed(1)},${(m.t + ih)}L${histPts[0][0].toFixed(1)},${(m.t + ih)}Z" fill="url(#${id}-fade)"/>` : ''}
      ${histPts.length ? `<path d="${path(histPts)}" fill="none" stroke="${colorLine}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      ${fcPts.length ? `<path d="${path(bridge)}" fill="none" stroke="${colorFc}" stroke-width="2.2" stroke-dasharray="6 4" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      ${fDots}${divider}
      <line x1="${m.l}" y1="${m.t + ih}" x2="${m.l + iw}" y2="${m.t + ih}" stroke="${colorGrid}" stroke-width="1.2"/>
    </svg>
    ${o.legend === false ? '' : `<div class="chart-legend">
      <span class="lg"><span class="lg-line" style="border-color:${colorLine}"></span>历史销量（观测值）</span>
      <span class="lg"><span class="lg-line lg-dash" style="border-color:${colorFc}"></span>预测销量</span>
      ${o.showBand === false ? '' : `<span class="lg"><span class="lg-box" style="background:${colorBand};opacity:.3"></span>置信区间</span>`}
      ${o.limitLine != null ? `<span class="lg"><span class="lg-line lg-dash" style="border-color:${cssVar('--warning')}"></span>${o.limitLabel || '参考线'}</span>` : ''}
    </div>`}
  </div>`;
}

/**
 * 多序列折线图（用于跨任务对比）。
 * @param {object} o
 * @param {Array<{label:string,color:string,dash?:boolean,points:Array<{date:string,value:number|null}>}>} o.series
 */
function multiLineChart(o) {
  const H = o.height || 320;
  const W = 960;
  const m = { t: 18, r: 20, b: 34, l: 52 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const allDates = [];
  o.series.forEach((s) => s.points.forEach((p) => { if (!allDates.includes(p.date)) allDates.push(p.date); }));
  allDates.sort();
  if (!allDates.length) return '<div class="empty"><p>无数据</p></div>';

  const vals = [];
  o.series.forEach((s) => s.points.forEach((p) => { if (p.value != null) vals.push(p.value); }));
  let vMax = Math.max(...vals, 1) * 1.08;
  let vMin = Math.max(0, Math.min(...vals, 0) - vMax * 0.04);

  const x = scaleLinear([0, Math.max(1, allDates.length - 1)], [m.l, m.l + iw]);
  const y = scaleLinear([vMin, vMax], [m.t + ih, m.t]);
  const dateIdx = new Map(allDates.map((d, i) => [d, i]));
  const colorGrid = cssVar('--border'), colorText = cssVar('--text-3');

  let grid = '', yLabels = '';
  for (let i = 0; i <= 5; i++) {
    const v = vMin + ((vMax - vMin) / 5) * i;
    const yy = y(v);
    grid += `<line x1="${m.l}" y1="${yy.toFixed(1)}" x2="${m.l + iw}" y2="${yy.toFixed(1)}" stroke="${colorGrid}" stroke-width="1" stroke-dasharray="${i === 0 ? '0' : '3 3'}"/>`;
    yLabels += `<text x="${m.l - 8}" y="${(yy + 3.5).toFixed(1)}" fill="${colorText}" font-size="10" text-anchor="end" font-family="var(--font-mono)">${axisNum(v)}</text>`;
  }
  const step = Math.max(1, Math.ceil(allDates.length / 8));
  let xLabels = '';
  allDates.forEach((d, i) => {
    if (i % step !== 0 && i !== allDates.length - 1) return;
    xLabels += `<text x="${x(i).toFixed(1)}" y="${H - 12}" fill="${colorText}" font-size="10" text-anchor="middle">${d.slice(5)}</text>`;
  });

  const paths = o.series.map((s) => {
    const pts = s.points.filter((p) => p.value != null)
      .map((p) => [x(dateIdx.get(p.date)), y(p.value)]);
    if (!pts.length) return '';
    const d = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round" stroke-linecap="round" opacity="${s.opacity || 1}"/>`;
  }).join('');

  return `
  <div class="chart-box">
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${o.aria || '多序列对比折线图'}" preserveAspectRatio="xMidYMid meet">
      ${grid}${yLabels}${xLabels}${paths}
      <line x1="${m.l}" y1="${m.t + ih}" x2="${m.l + iw}" y2="${m.t + ih}" stroke="${colorGrid}" stroke-width="1.2"/>
    </svg>
    <div class="chart-legend">
      ${o.series.map((s) => `<span class="lg"><span class="lg-line ${s.dash ? 'lg-dash' : ''}" style="border-color:${s.color}"></span>${s.label}</span>`).join('')}
    </div>
  </div>`;
}

/**
 * 直方图：用于逐序列 MAPE 分布。
 * @param {Array<number>} values 已缩放到 0-100 的百分比
 * @param {number} threshold 达标阈值
 */
function histChart(values, threshold, bins) {
  const n = bins || 12;
  const max = Math.max(...values, threshold * 1.6, 1);
  const w = max / n;
  const counts = new Array(n).fill(0);
  values.forEach((v) => {
    let i = Math.floor(v / w);
    if (i >= n) i = n - 1;
    if (i < 0) i = 0;
    counts[i] += 1;
  });
  const peak = Math.max(...counts, 1);

  const bars = counts.map((c, i) => {
    const h = Math.max(2, (c / peak) * 100);
    const lo = i * w;
    const over = lo >= threshold;
    return `<div class="hist-bar ${over ? 'over' : ''}" style="height:${h}%" title="${lo.toFixed(0)}% ~ ${(lo + w).toFixed(0)}%：${c} 条序列"></div>`;
  }).join('');

  const axis = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${(max * f).toFixed(0)}%</span>`).join('');

  return `
  <div class="chart-box">
    <div class="hist" role="img" aria-label="逐序列 MAPE 分布直方图">${bars}</div>
    <div class="hist-axis"><span>0%</span><span>MAPE 分布</span><span>${max.toFixed(0)}%</span></div>
    <div class="chart-legend">
      <span class="lg"><span class="lg-box" style="background:${cssVar('--c1')};opacity:.82"></span>达标序列（MAPE ≤ ${threshold}%）</span>
      <span class="lg"><span class="lg-box" style="background:${cssVar('--danger')};opacity:.82"></span>超标序列</span>
    </div>
  </div>`;
}

/** 迷你走势线（表格内使用） */
function sparkline(seed, positive, w, h) {
  const rng = makeRng(seed);
  const W = w || 74, H = h || 22;
  const n = 14;
  let v = 50;
  const pts = [];
  for (let i = 0; i < n; i++) {
    v += (rng() - (positive ? 0.42 : 0.58)) * 9;
    v = Math.max(12, Math.min(88, v));
    pts.push([(i / (n - 1)) * W, H - (v / 100) * H]);
  }
  const color = positive ? cssVar('--success') : cssVar('--danger');
  const d = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/** 迷你条形（覆盖率面板） */
function miniBar(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return parts.map((p) =>
    `<i class="${p.cls}" style="width:${((p.value / total) * 100).toFixed(2)}%" title="${p.label}：${p.value} 条"></i>`
  ).join('');
}
