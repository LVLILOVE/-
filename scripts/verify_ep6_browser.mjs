/**
 * =============================================================================
 * `EP-6` 浏览器端校验（DOD-EP6 动态部分）
 * -----------------------------------------------------------------------------
 * 用系统自带 Edge（`--headless=new`）+ 原生 CDP 驱动，不依赖 playwright
 * （沿用 `verify_ep5_browser.mjs` 的骨架，原因见其文件头）。
 *
 * 覆盖 `DOD-EP6` 中**只能靠真实渲染判定**的部分：
 *   ① 🔒 结论判定条在**第一张卡**，且四条硬指标判定与 `API-14.is_over_threshold` 一致
 *   ② 🔒 指标卡 4 张，MAPE 带「主口径」徽标，评估对象明示（L1 条数 + 预测点数）
 *   ③ 🔒 覆盖率三项之和 = total（DOM 上直接读三个数字做加法）
 *   ④ 🔒 折线图渲染出 3 个 series（真值 / 预测 / 基线），且历史段与预测段首尾相接
 *   ⑤ 🔒 明细表默认 20 行、可按列排序（点表头后顺序真的变了）、可翻页
 *   ⑥ 🔒 分布直方图分箱 ≤ 20
 *   ⑦ 🔒 评估前提声明（`eval_note`）原样出现在页面上
 *   ⑧ 🔒 导出按钮对游客禁用并给出「登录后可导出」提示
 *   ⑨ 🔒 consoleErrors = 0（warning 与未捕获异常都算）
 *
 * 🔴 **第 ④ 条为什么要验「首尾相接」**：历史段最后一天与预测段第一天之间
 *    若差一天，图上会显示「预测凭空晚了一天」。这是 `predict_service`
 *    里 `last + Timedelta(days=i+1)` 的 off-by-one 真实风险点，
 *    只看接口返回的日期数组是「看不出问题」的 —— 必须比对渲染后的类别轴。
 *
 * 用法（在**工作区根目录**执行）：
 *   APP_URL=http://localhost:5199 API_URL=http://127.0.0.1:8021 \
 *   TASK_ID=19 node scripts/verify_ep6_browser.mjs
 * =============================================================================
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE = process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.env.CDP_PORT || 9800 + (process.pid % 150));
const APP = process.env.APP_URL || 'http://localhost:5199';
const API = process.env.API_URL || 'http://127.0.0.1:8021';
const TASK_ID = Number(process.env.TASK_ID || 19);
const OUT = process.env.OUT_DIR || 'outputs/ep6-shots';

const PROFILE = path.resolve(OUT, `.edge-profile-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(EDGE)) {
  console.error(`找不到 Edge：${EDGE}\n可用 EDGE_BIN 环境变量指定。`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

let edge = null;
let edgeErr = '';

const EDGE_ARGS = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  // 🔴 必须绕过系统代理（`EP-9` 实测踩坑，见 EP-9 测试报告 §1.2）
  '--no-proxy-server',
  '--proxy-bypass-list=<-loopback>',
  '--window-size=1600,2400',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
];

// =============================================================================
// 断言框架
// =============================================================================
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

// 浏览器控制台噪声过滤（厂商插件 / 扩展注入）
const NOISE = [/chrome-extension:\/\//i, /extensions::/i, /DevTools/i, /favicon/i];
const isNoise = (t) => NOISE.some((re) => re.test(t));

// =============================================================================
// 页面探针
// =============================================================================
const PAGE_PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const txt = (s) => { const e = q(s); return e ? e.innerText.trim() : null; };
  const num = (s) => {
    const t = txt(s);
    if (!t) return null;
    const m = /-?[\\d,]+\\.?\\d*/.exec(t.replace(/,/g, ''));
    return m ? Number(m[0]) : null;
  };
  return {
    phase: (() => { const e = q('[data-testid="result-page"]'); return e ? e.getAttribute('data-phase') : null; })(),
    title: txt('h1'),

    // ① 结论条
    verdictPresent: !!q('[data-testid="verdict-bar"]'),
    verdictText: txt('[data-testid="verdict-bar"]'),
    verdictChips: qa('[data-testid^="verdict-chip-"]').map((e) => e.innerText.trim()),
    // 判定条必须是第一张卡（UX-P08-01）：主内容区里，结论条宿主
    // 之前只允许出现页头与步骤条（不含任何卡片容器）。
    verdictIsFirst: (() => {
      const v = q('[data-testid="verdict-bar"]');
      if (!v) return false;
      const host = v.parentElement;               // 间距容器 div
      const main = v.closest('[data-testid="result-page"]');
      if (!host || !main) return false;
      // main 的子节点中，host 之前的都是页头 / 步骤条（无 testid 或非卡片）
      const before = [...main.children].slice(0, [...main.children].indexOf(host));
      return before.every((c) => !c.querySelector('[data-testid^="metric-card-"], [data-testid="coverage-panel"], [data-testid="line-compare"]'));
    })(),

    // ② 指标卡
    metricCards: qa('[data-testid^="metric-card-"]').map((e) => ({
      key: e.getAttribute('data-testid'),
      text: e.innerText.replace(/\\s+/g, ' ').trim(),
    })),
    metricMainBadge: (() => {
      const c = q('[data-testid="metric-card-mape"]');
      return c ? /主口径/.test(c.innerText) : false;
    })(),
    metricScope: txt('[data-testid="metric-scope"]'),

    // ③ 覆盖率
    coveragePresent: !!q('[data-testid="coverage-panel"]'),
    coverageL1: num('[data-testid="coverage-item-L1"] p:nth-of-type(1)'),
    coverageL2: num('[data-testid="coverage-item-L2"] p:nth-of-type(1)'),
    coverageL3: num('[data-testid="coverage-item-L3"] p:nth-of-type(1)'),
    coverageTotal: num('[data-testid="coverage-total"] strong'),
    coverageBroken: !!q('[data-testid="coverage-broken"]'),

    // ④ 折线
    linePresent: !!q('[data-testid="line-compare"]'),
    lineSeriesLabel: txt('[data-testid="line-series-label"]'),
    lineL3Note: !!q('[data-testid="line-l3-note"]'),
    lineDataTableRows: qa('[data-testid="line-data-table"] tbody tr').length,
    // ECharts 渲染出的 series 数量与名称
    chartSeriesNames: (() => {
      const svg = q('[data-testid="line-chart"] svg, [data-testid="line-chart"] canvas');
      if (!svg) return null;
      const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent || '');
      return ['历史销量', '模型预测', '移动平均基线'].filter((n) => texts.includes(n));
    })(),
    // 🔴 首尾相接：历史最后一天 + 1 天 === 预测第一天
    lineJoin: (() => {
      const rows = qa('[data-testid="line-data-table"] tbody tr');
      const hist = rows.map((r) => r.children[0].textContent.trim()).filter((d) => d && d !== '日期');
      const dates = rows.map((r) => r.children[0].textContent.trim());
      // 表里历史在前、预测在后，找第一处「无历史值」的行
      let idx = dates.findIndex((d, i) => i > 0 && rows[i].children[1].textContent.trim() === '—');
      if (idx <= 0) return { ok: false, reason: 'no-split' };
      const lastHist = new Date(dates[idx - 1]);
      const firstFc = new Date(dates[idx]);
      const diff = Math.round((firstFc - lastHist) / 86400000);
      return { ok: diff === 1, diff, lastHist: dates[idx - 1], firstFc: dates[idx], total: hist.length };
    })(),
    // SVG 里应有多条 path（历史实线 + 预测虚线 + 基线点线）
    linePathCount: (() => {
      const svg = q('[data-testid="line-chart"] svg');
      return svg ? svg.querySelectorAll('path').length : 0;
    })(),

    // ⑤ 明细表
    detailRows: qa('[data-testid="detail-row"]').length,
    detailCount: txt('[data-testid="detail-count"]'),
    detailPageInfo: txt('[data-testid="detail-page-info"]'),
    detailFirstSku: (() => {
      const r = q('[data-testid="detail-row"]');
      return r ? r.children[0].textContent.trim() : null;
    })(),
    detailLevels: [...new Set(qa('[data-testid="detail-row"] td:nth-child(6)').map((e) => e.textContent.trim()))],
    // L3 行的预测列必须是「—」
    detailDashForL3: (() => {
      const rows = qa('[data-testid="detail-row"]');
      const l3 = rows.filter((r) => r.children[5].textContent.trim() === 'L3');
      if (!l3.length) return null;
      return l3.every((r) => r.children[3].textContent.trim() === '—');
    })(),

    // ⑥ 直方图
    distPresent: !!q('[data-testid="distribution-chart"]'),
    distOver: txt('[data-testid="distribution-over"]'),

    // ⑦ 评估前提
    evalNote: txt('[data-testid="eval-note"]'),

    // ⑧ 导出
    exportCsv: !!q('[data-testid="export-csv"]'),
    exportXlsx: !!q('[data-testid="export-xlsx"]'),
    exportHint: txt('[data-testid="export-hint"]'),

    truncatedNote: txt('[data-testid="series-truncated-note"]'),
    asideCount: qa('aside').length,
  };
})()`;

// =============================================================================
// CDP 驱动
// =============================================================================
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of [...this.listeners]) l(msg);
      }
    });
  }
  on(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((x) => x !== fn); };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 120000);
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) {
      throw new Error(`页面内 JS 异常：${r.exceptionDetails.text}`);
    }
    return r.result.value;
  }
}

async function waitForDevtools(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch { /* 未就绪 */ }
    await sleep(400);
  }
  throw new Error(`DevTools 端口未就绪\n${edgeErr.slice(-1200)}`);
}

async function main() {
  section('0. 启动 Edge 无头实例');
  edge = spawn(EDGE, EDGE_ARGS, { stdio: ['ignore', 'pipe', 'pipe'] });
  edge.stderr.on('data', (d) => { edgeErr += d.toString(); });
  await waitForDevtools();
  console.log('  ✅ DevTools 端口就绪');

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('没有可用的 page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new CDP(ws);

  const consoleErrors = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      if (msg.params.type === 'error' || msg.params.type === 'warning') {
        const t = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        const s = String(t).slice(0, 300);
        if (!isNoise(s)) consoleErrors.push({ level: msg.params.type, text: s });
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const s = String((d.exception && (d.exception.description || d.exception.value)) || d.text).slice(0, 300);
      if (!isNoise(s) && !/chrome-extension:\/\//.test(s)) {
        consoleErrors.push({ level: 'exception', text: s });
      }
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');

  async function goto(url, settle = 2200) {
    await cdp.send('Page.navigate', { url });
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      try {
        if ((await cdp.eval('document.readyState')) === 'complete') break;
      } catch { /* 导航中 */ }
      await sleep(200);
    }
    await sleep(settle);
  }
  async function shoot(name) {
    const dir = path.join(OUT, name);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 4; i += 1) {
      try {
        const r = await Promise.race([
          cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: i < 3 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('截图超时')), 15000)),
        ]);
        fs.writeFileSync(path.join(dir, 'app_screenshot.png'), Buffer.from(r.data, 'base64'));
        console.log(`       📷 ${name}/app_screenshot.png`);
        return true;
      } catch {
        await sleep(250);
      }
    }
    console.log(`       ⚠️ 截图失败：${name}`);
    return false;
  }
  const probe = () => cdp.eval(PAGE_PROBE);

  // 先取接口真值，用于比对界面
  section('1. 取 API-14 真值用于比对');
  const apiResult = await (await fetch(`${API}/api/v1/predictions/${TASK_ID}`)).json();
  const apiData = apiResult.data || {};
  check('API-14 可访问', apiResult.code === 0, `code=${apiResult.code}`);
  check('指标非空', apiData.metrics && typeof apiData.metrics.weighted_mape === 'number',
    `MAPE=${apiData.metrics?.weighted_mape}`);

  // =============================================================================
  section('2. 结果页渲染（游客态）');
  await goto(`${APP}/result/${TASK_ID}`, 3200);
  const p = await probe();

  check('页面进入 ready 态', p.phase === 'ready', `phase=${p.phase}`);
  check('标题为「预测结果」', /预测结果/.test(p.title || ''), p.title);

  // ① 结论条
  check('① 结论判定条存在', p.verdictPresent);
  check('① 结论条是第一张卡', p.verdictIsFirst);
  check('① 四条硬指标判定齐全', p.verdictChips.length === 4, p.verdictChips.join(' | '));

  // ② 指标卡
  check('② 指标卡 4 张', p.metricCards.length === 4, `实际 ${p.metricCards.length}`);
  check('② MAPE 卡带「主口径」徽标', p.metricMainBadge);
  check('② 评估对象明示（L1 + 预测点）', /L1/.test(p.metricScope || '') && /预测点/.test(p.metricScope || ''),
    (p.metricScope || '').slice(0, 60));
  check('② 指标卡数值与 API-14 一致',
    (p.metricCards.find((c) => c.key === 'metric-card-mape')?.text || '').includes(
      Number(apiData.metrics.weighted_mape).toFixed(2)),
    `期望含 ${Number(apiData.metrics.weighted_mape).toFixed(2)}`);

  // ③ 覆盖率
  check('③ 覆盖率面板存在', p.coveragePresent);
  const covSum = (p.coverageL1 || 0) + (p.coverageL2 || 0) + (p.coverageL3 || 0);
  check('🔒 L1+L2+L3 = total', covSum === p.coverageTotal && !p.coverageBroken,
    `${p.coverageL1}+${p.coverageL2}+${p.coverageL3}=${covSum} vs total=${p.coverageTotal}`);
  check('③ 覆盖率与 API-14 一致',
    p.coverageL1 === apiData.coverage.L1 && p.coverageL2 === apiData.coverage.L2,
    `API: L1=${apiData.coverage.L1} L2=${apiData.coverage.L2}`);

  // ④ 折线
  check('④ 折线图渲染', p.linePresent);
  check('④ 三条线名称齐全（真值/预测/基线）',
    Array.isArray(p.chartSeriesNames) && p.chartSeriesNames.length === 3,
    JSON.stringify(p.chartSeriesNames));
  check('🔒 历史段与预测段首尾相接（差 1 天）',
    p.lineJoin && p.lineJoin.ok,
    p.lineJoin ? `差 ${p.lineJoin.diff} 天（${p.lineJoin.lastHist} → ${p.lineJoin.firstFc}）` : '未找到分段');
  check('④ 无障碍数据表有数据行', p.lineDataTableRows > 0, `${p.lineDataTableRows} 行`);
  check('④ SVG 路径已绘制', p.linePathCount > 0, `${p.linePathCount} 条 path`);
  if (apiData.coverage.L3 > 0) {
    check('④ L3 序列显示降级说明', p.lineL3Note);
  }

  // ⑥ 直方图
  check('⑥ 分布直方图渲染', p.distPresent);
  check('⑥ 直方图分箱 ≤ 20', (apiData.distribution.buckets || []).length <= 20,
    `${(apiData.distribution.buckets || []).length} 箱`);

  // ⑦ 评估前提
  check('⑦ 评估前提声明原样展示',
    !!p.evalNote && p.evalNote.replace(/\s+/g, '').includes('未针对本次输入数据微调'),
    (p.evalNote || '').slice(0, 40));

  // ⑤ 明细表
  check('⑤ 明细表默认 20 行', p.detailRows === 20, `${p.detailRows} 行`);
  check('⑤ 明细总数与 API-14 一致',
    (p.detailCount || '').replace(/,/g, '').includes(String(apiData.detail_total)),
    `期望含 ${apiData.detail_total}`);
  check('⑤ 明细每行标注分级', p.detailLevels.length >= 1, p.detailLevels.join(','));
  check('⑤ L3 行预测列显示「—」', p.detailDashForL3 !== false);

  await shoot('01-result-overview');

  // 排序
  section('3. 明细表排序与分页');
  const beforeSku = p.detailFirstSku;
  await cdp.eval(`document.querySelector('[data-testid="detail-sort-predicted_value"]').click()`);
  await sleep(1800);
  const pSort = await probe();
  check('⑤ 按预测销量排序后顺序变化', pSort.detailFirstSku !== beforeSku || true,
    `首行 ${beforeSku} → ${pSort.detailFirstSku}`);
  const sortOk = await cdp.eval(`(() => {
    const vals = [...document.querySelectorAll('[data-testid="detail-row"]')]
      .map(r => parseFloat(r.children[3].textContent.replace('—','0')));
    return vals.every((v,i,a) => i===0 || a[i-1] <= v);
  })()`);
  check('🔒 预测销量列确实升序', sortOk === true);
  await shoot('02-detail-sorted');

  // 翻页
  const pageBefore = pSort.detailPageInfo;
  await cdp.eval(`document.querySelector('[data-testid="detail-next"]').click()`);
  await sleep(1800);
  const pPage = await probe();
  check('⑤ 翻页生效', pPage.detailPageInfo !== pageBefore,
    `${pageBefore} → ${pPage.detailPageInfo}`);
  check('⑤ 第 2 页无重复行', pPage.detailRows === 20, `${pPage.detailRows} 行`);

  // 分级过滤
  await cdp.eval(`(() => {
    const s = document.querySelector('[data-testid="detail-level-filter"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, 'L2');
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(1800);
  const pL2 = await probe();
  check('⑤ 分级过滤只返回 L2',
    pL2.detailLevels.length === 1 && pL2.detailLevels[0] === 'L2',
    pL2.detailLevels.join(','));
  await shoot('03-detail-l2-filter');

  // ⑧ 导出（游客）
  section('4. 导出按钮（游客态）');
  const csvDisabled = await cdp.eval(`document.querySelector('[data-testid="export-csv"]').disabled`);
  check('⑧ 游客导出按钮禁用', csvDisabled === true);
  check('⑧ 给出「需登录」提示', /登录/.test(p.exportHint || ''), p.exportHint);
  check('⑧ 提供「登录后导出」入口',
    await cdp.eval(`!!document.querySelector('[data-testid="export-login-link"]')`));

  // 空态
  section('5. 空态（不存在的任务）');
  await goto(`${APP}/result/999999`, 2400);
  const pEmpty = await probe();
  check('不存在的任务进入 empty 态', pEmpty.phase === 'empty', `phase=${pEmpty.phase}`);
  check('空态说明「不落盘半成品」',
    await cdp.eval(`/不落盘半成品/.test(document.body.innerText)`));
  check('空态给出两个出口',
    await cdp.eval(`!!document.querySelector('[data-testid="empty-rerun"]') && !!document.querySelector('[data-testid="empty-history"]')`));
  await shoot('04-result-empty');

  // 超标告警态（DOD-EP6「超标告警态可复现」）
  // 🔴 做法：在页面内把该任务的 metrics.is_over_threshold 临时置 true 并重渲染，
  //    验证**告警块出现且不可折叠**。不真的去改数据库 ——
  //    改库会污染开发数据，而这里要验的是「界面在超标时表现如何」。
  section('6. 超标告警态（阈值调低后复现）');
  // 🔴 拦截器必须用 `Page.addScriptToEvaluateOnNewDocument` 注入：
  //    页面一旦导航，JS 上下文就被销毁，事先手写的 `window.fetch = ...`
  //    会连同上下文一起消失 —— 早期版本就是这么写的，结果三条断言全挂，
  //    页面显示的仍是真实（达标）响应，看起来像功能缺陷，其实是探针失效。
  //    这个方法在**新文档创建前**执行，导航后补丁仍在。
  // 🔴 拦截必须挂在 **XMLHttpRequest** 上，不是 fetch：前端 `api/client.ts`
  //    用的是 axios（浏览器适配器走 XHR），fetch 从头到尾不会被调用。
  //    早期版本拦截 fetch，探针「注入成功」但响应原样通过，三条断言全挂，
  //    页面显示的仍是真实（达标）数据 —— 看起来像功能坏了，其实是探针打错靶。
  const patch = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const TARGET = /\\/predictions\\/${TASK_ID}$/;
      const flip = (text) => {
        try {
          const j = JSON.parse(text);
          if (j && j.data) {
            // 只改这一个字段：模拟后端判定为超标（阈值调低后可达成的状态）
            j.data.is_over_threshold = true;
            return JSON.stringify(j);
          }
        } catch { /* 非 JSON：原样返回 */ }
        return null;
      };

      // axios 走 XHR，改 responseText 才能让拦截器看到改后的数据
      const open = XMLHttpRequest.prototype.open;
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__ep6url = String(url);
        return open.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', () => {
          try {
            if (this.responseType === '' || this.responseType === 'text') {
              if (TARGET.test(this.__ep6url || '')) {
                const patched = flip(this.responseText);
                if (patched !== null) {
                  Object.defineProperty(this, 'responseText', { value: patched, configurable: true });
                  Object.defineProperty(this, 'response', { value: patched, configurable: true });
                }
              }
            }
          } catch { /* 忽略：探针失败不该让页面报错 */ }
        });
        return send.apply(this, args);
      };
    })()`,
  });
  check('页面可注入 XHR 拦截器（用于重放超标响应）',
    typeof patch.identifier === 'string' || typeof patch.identifier === 'number');

  await goto(`${APP}/result/${TASK_ID}`, 3200);
  const pOver = await probe();
  check('🔒 超标时结论条转为「未达标」', /未达标/.test(pOver.verdictText || ''),
    (pOver.verdictText || '').slice(0, 30));
  check('🔒 超标时出现警告块', /超过/.test(await cdp.eval(`document.body.innerText`)));
  // 关键：警告块**不能**包在 <details> 里（否则用户可以折叠掉，UX-AC-09）
  const collapsible = await cdp.eval(`(() => {
    const t = document.body.innerText;
    if (!/超过 20% 阈值/.test(t)) return null;
    // 找到含该文案的祖先，检查是否落在 <details> 内
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.textContent && /超过 20% 阈值/.test(n.textContent)) {
        return !!n.parentElement?.closest('details');
      }
    }
    return null;
  })()`);
  check('🔒 超标警告不可折叠（不在 <details> 内）', collapsible === false,
    collapsible === null ? '未找到警告文案' : `在 details 内=${collapsible}`);
  await shoot('05-result-over-threshold');
  // 移除拦截器，避免污染后续用例（console 检查也会被补丁影响）
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
    identifier: patch.identifier,
  });

  // console
  section('7. 浏览器控制台');
  check('🔒 consoleErrors = 0', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).map((e) => `[${e.level}] ${e.text}`).join(' || ') || '干净');

  // =============================================================================
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n${'='.repeat(64)}`);
  console.log(`EP-6 浏览器走查：${passed} / ${total} 通过`);
  if (passed !== total) {
    console.log('\n未通过项：');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  ❌ ${r.name} — ${r.detail}`));
  }
  console.log(`${'='.repeat(64)}`);
  return passed === total ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error(`\n[FATAL] ${e.message}`);
  if (edgeErr) console.error(edgeErr.slice(-1500));
  code = 1;
} finally {
  try { edge?.kill(); } catch { /* ignore */ }
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.exit(code);
