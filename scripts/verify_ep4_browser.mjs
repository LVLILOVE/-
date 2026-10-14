/**
 * =============================================================================
 * `EP-4` 浏览器端校验（DOD-EP4 动态部分）
 * -----------------------------------------------------------------------------
 * 用系统自带 Edge（`--headless=new`）+ 原生 CDP 驱动，**不依赖 playwright**：
 * 本机无法访问 googleapis，装不上 playwright 的浏览器内核。
 *
 * 覆盖 `DOD-EP4` 中**只能靠真实渲染判定**的部分：
 *   ① UX-P05 八个真实状态逐个走查（不是改 props 假造，而是真选文件真上传）：
 *        idle / selected / uploading / validating / ok
 *        error ×7（40001/40002/40003/40004/40005/40007/40009）
 *        interpolating（断档→自动插值）/ sample（示例数据）
 *      —— 每个状态截图留证到 `outputs/ep4-shots/<状态>/app_screenshot.png`
 *   ② 🔒 硬指标同源：通过卡的 4 个指标读 DOM，与接口响应逐项比对
 *   ③ 🔒 预览表列 = 源文件列（`FR-UPL-07`）：断言预览表头**恰好**是上传文件
 *        的表头，不多不少 —— 内部辅助列（`_d` / `_s`）一旦泄漏到这里就失败
 *   ④ 🔒 错误卡「有明细才给下载」：40002/40003/40005 必须有下载按钮；
 *        40007/40009 必须**没有**（前端前置拦截，没有数据集行，点了必 40402）
 *   ⑤ 🔒 断档不自动继续（`FR-UPL-13`）：停在二选一，两个按钮都在
 *   ⑥ 模板 B 结构未被改坏：`aside` 仍为 2 个（EP-3 的 `STRUCT_EXPECT` 同款断言）
 *   ⑦ EP-3 回归：免责声明在 `/upload` 仍存在 / 可见 / 未被折叠
 *   ⑧ 每个状态 `consoleErrors` 必须为 0（含 warning 与未捕获异常）
 *
 * 用法（在**工作区根目录**执行）：
 *   node scripts/verify_ep4_browser.mjs
 *
 * 前置：后端与前端都要先起好（脚本自己不去拉服务，避免僵尸进程）：
 *   # 后端（🔒 用独立库，避免污染 data/app.db）
 *   DB_PATH=data/tmp/ep4_browser/app.db \
 *   UPLOAD_DIR=data/tmp/ep4_browser/uploads \
 *   EXPORT_DIR=data/tmp/ep4_browser/exports \
 *   C:/ProgramData/anaconda3/envs/deploy/python.exe -m uvicorn app.main:app --port 8000
 *   # 前端
 *   cd web && npx vite --port 5173
 *
 * 环境变量：EDGE_BIN / APP_URL / CDP_PORT / OUT_DIR
 * =============================================================================
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE = process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.env.CDP_PORT || 9400 + (process.pid % 200));
const APP = process.env.APP_URL || 'http://localhost:5173';
const OUT = process.env.OUT_DIR || 'outputs/ep4-shots';
const FIX = path.resolve(OUT, 'fixtures');

/**
 * 🔒 每次跑用**全新的** `--user-data-dir`。
 *
 * 踩过的坑：复用固定目录时，上一次跑残留的 Edge 子进程（`edge.kill()` 只杀父进程）
 * 仍持有 profile 锁，下一次启动的 Edge 会静默挂起 —— 表现为脚本「一直不结束、
 * 也不报错」，且一张截图都产不出来（本脚本曾因此空转 15 分钟）。
 */
const PROFILE = path.resolve(OUT, `.edge-profile-${Date.now()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(EDGE)) {
  console.error(`找不到 Edge：${EDGE}\n可用 EDGE_BIN 环境变量指定。`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(FIX, { recursive: true });

/* ==========================================================================
 * 夹具：与 `scripts/verify_ep4_api.py` 的夹具**同形**（同一套错误样本）
 * ========================================================================== */
const HDR = 'sku_id,warehouse_id,date,sales';

/** 生成一条连续序列的 CSV 行；`skip` 里的日偏移被跳过（造断档） */
function seriesRows(sku, wh, startDay, days, base = 10, skip = []) {
  const d0 = new Date(Date.UTC(2015, 0, 1));
  const out = [];
  for (let i = 0; i < days; i += 1) {
    if (skip.includes(i)) continue;
    const d = new Date(d0.getTime() + (startDay + i) * 86400000);
    out.push(`${sku},${wh},${d.toISOString().slice(0, 10)},${base + (i % 7)}`);
  }
  return out;
}

function writeFix(name, body) {
  const p = path.join(FIX, name);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

function buildFixtures() {
  const fx = {};

  // 正常文件：2 条序列 × 100 天（≥ 90 个有效点，进 L1）
  let rows = seriesRows('item_0001', '上海仓', 0, 100, 20);
  rows = rows.concat(seriesRows('item_0002', '成都仓', 0, 100, 12));
  fx.ok = writeFix('ok.csv', [HDR, ...rows].join('\n') + '\n');

  // 较慢才能传完的正常文件：给「上传中」状态留出可截图的窗口
  // （本机 localhost 上传 6 KB 只要几毫秒，不加体积就抓不到 uploading 态）
  let slow = [];
  for (let s = 0; s < 30; s += 1) {
    slow = slow.concat(seriesRows(`item_${1000 + s}`, '上海仓', 0, 200, 5 + (s % 9)));
  }
  fx.slow_ok = writeFix('slow_ok.csv', [HDR, ...slow].join('\n') + '\n');

  // 缺 warehouse_id（🔒 仓库列缺失即拒）
  fx.missing_warehouse = writeFix(
    'missing_warehouse.csv',
    'sku_id,date,sales\nitem_0001,2015-01-01,10\nitem_0001,2015-01-02,12\n',
  );

  // 日期异常（3 种典型错法）
  fx.bad_date = writeFix(
    'bad_date.csv',
    [
      HDR,
      'item_0001,上海仓,2015-01-01,10',
      'item_0001,上海仓,2015/13/45,11',
      'item_0001,上海仓,未知,12',
      'item_0001,上海仓,,13',
      'item_0001,上海仓,2015-01-05,14',
    ].join('\n') + '\n',
  );

  // 负值 + 非数值
  fx.negative = writeFix(
    'negative.csv',
    [
      HDR,
      'item_0001,上海仓,2015-01-01,10',
      'item_0001,上海仓,2015-01-02,-12',
      'item_0001,上海仓,2015-01-03,暂无',
      'item_0001,上海仓,2015-01-04,-3.5',
      'item_0001,上海仓,2015-01-05,15',
    ].join('\n') + '\n',
  );

  // 断档：2 处（8 天 / 3 天），与 PRD 提示样例同形
  const g1 = seriesRows('item_0000', '上海仓', 0, 40, 11, [5, 6, 7, 8, 9, 10, 11, 12]);
  const g2 = seriesRows('item_0033', '成都仓', 0, 40, 7, [20, 21, 22]);
  fx.gap = writeFix('gap.csv', [HDR, ...g1, ...g2].join('\n') + '\n');

  // 序列超限：1001 条序列各 1 行
  const many = [HDR];
  for (let i = 0; i < 1001; i += 1) {
    many.push(`item_${String(i).padStart(4, '0')},上海仓,2015-01-01,${(i % 20) + 1}`);
  }
  fx.too_many_series = writeFix('too_many_series.csv', many.join('\n') + '\n');

  // 扩展名非 .csv（内容本身是合法的）
  fx.bad_ext = writeFix('sales.txt', `${HDR}\nitem_0001,上海仓,2015-01-01,10\n`);

  // 大小超限（21 MB）
  const bigPath = path.join(FIX, 'too_big.csv');
  const filler = `item_0001,上海仓,2015-01-01,${'1'.repeat(200)}\n`;
  let acc = HDR + '\n';
  while (acc.length < 21 * 1024 * 1024) acc += filler;
  fs.writeFileSync(bigPath, acc, 'utf8');
  fx.too_big = bigPath;

  return fx;
}

const FX = buildFixtures();

/* ==========================================================================
 * CDP 客户端（与 EP-3 探针同实现）
 * ========================================================================== */
/** 延迟到「端口自检通过」之后再启动，避免连上一个不是自己拉起来的浏览器 */
let edge = null;
let edgeErr = '';
const EDGE_ARGS = [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  // 🔒 必加：本机 Edge 装有厂商插件（会往页面注入 `/hybridaction/...` 追踪脚本，
  //    并在 `console` 里抛未捕获异常 + 触发 react-router 的「No routes matched」警告），
  //    不禁用的话「consoleErrors 必须为 0」这一条会被**环境噪声**打成假失败。
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  // 🔴 必须绕过系统代理（`EP-9` 实测踩坑，见 EP-9 测试报告 §1.2）
  '--no-proxy-server',
  '--proxy-bypass-list=<-loopback>',
  '--window-size=1600,1800',
  `--user-data-dir=${PROFILE}`,
  'about:blank',
];

function startEdge() {
  edge = spawn(EDGE, EDGE_ARGS, { stdio: ['ignore', 'pipe', 'pipe'] });
  edge.stderr.on('data', (d) => {
    edgeErr += d.toString();
  });
}

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
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
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
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error(
        `页面内 JS 异常：${r.exceptionDetails.text} ${JSON.stringify(r.result?.value ?? '')}`,
      );
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
    } catch {
      /* 还没起来 */
    }
    await sleep(400);
  }
  throw new Error(`DevTools 端口未就绪\n${edgeErr.slice(-1200)}`);
}

/** 起跑前自检：端口被别的实例占着就立刻失败，别去连一个不是自己启动的浏览器 */
async function assertPortFree() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) {
      const v = await r.json();
      throw new Error(
        `端口 ${PORT} 已被另一个浏览器实例占用（${v.Browser}）。` +
          `请先结束它，或用 CDP_PORT 换一个端口。`,
      );
    }
  } catch (e) {
    if (/已被另一个浏览器实例占用/.test(String(e))) throw e;
    /* 连不上 = 端口空闲，正是我们要的 */
  }
}

/* ==========================================================================
 * 页面探针：一次抓全，断言放在 node 侧（便于失败时打印完整现场）
 * ========================================================================== */
const FULL_PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const txt = (s) => { const e = q(s); return e ? norm(e.innerText) : null; };
  const page = q('[data-testid="upload-page"]');
  const dis = q('.disclaimer');
  const errCard = q('[data-testid="error-card"]');
  const okCard = q('[data-testid="ok-card"]');
  const prev = q('[data-testid="preview-table"]');
  const asides = qa('aside');
  const vp = q('[data-testid="validation-progress"]');
  return {
    phase: page ? page.getAttribute('data-phase') : null,
    bodyTextLen: norm(document.body.innerText).replace(/ /g, '').length,
    // ⚠️ 模板 B 有 **2 个** aside：[0] 是 AppShell 的导航侧栏，[1] 才是本页右栏。
    //    不要把下标写死 —— 按文本内容找，导航改名不会误伤这条断言。
    sidebars: asides.length,
    // 每栏截 1200 字：右栏三块内容（数据要求 / 用途说明 / 数据用途声明）合计约 500 字，
    // 截得太短会把最后一块「数据用途」声明切掉，从而漏断言 NFR-SEC-05。
    asideTexts: asides.map((a) => norm(a.innerText).slice(0, 1200)),
    notices: qa('.notice').map((e) => norm(e.innerText)),
    disclaimer: dis ? {
      present: true,
      display: getComputedStyle(dis).display,
      visibility: getComputedStyle(dis).visibility,
      offsetHeight: dis.offsetHeight,
      scrollHeight: dis.scrollHeight,
      clientHeight: dis.clientHeight,
      details: dis.querySelectorAll('details,summary').length,
      text: dis.innerText.replace(/\\s+/g, ''),
    } : { present: false },
    dropzone: !!q('[data-testid="dropzone"]'),
    dropzoneText: txt('[data-testid="dropzone"]'),
    fileInput: !!q('[data-testid="file-input"]'),
    fileChip: q('[data-testid="file-chip"]') ? {
      text: norm(q('[data-testid="file-chip"]').innerText),
      hasCsvBadge: norm(q('[data-testid="file-chip"]').innerText).includes('CSV'),
      hasRemove: !!q('[data-testid="file-chip"] button[aria-label="移除文件"]'),
    } : null,
    startUpload: !!q('[data-testid="start-upload"]'),
    uploadProgress: txt('[data-testid="upload-progress"]'),
    uploadProgressNow: q('[data-testid="upload-progress"] [role="progressbar"]')
      ? q('[data-testid="upload-progress"] [role="progressbar"]').getAttribute('aria-valuenow') : null,
    validationPanel: txt('[data-testid="validation-panel"]'),
    validationProgressNow: vp ? vp.getAttribute('aria-valuenow') : null,
    busyPanel: txt('[data-testid="busy-panel"]'),
    okCard: okCard ? {
      hasAllPassBadge: norm(okCard.innerText).includes('7/7'),
      metricRowCount: txt('[data-testid="metric-row_count"]'),
      metricSku: txt('[data-testid="metric-sku_count"]'),
      metricWh: txt('[data-testid="metric-warehouse_count"]'),
      metricSeries: txt('[data-testid="metric-series_count"]'),
      nextBtn: !!q('[data-testid="next-params"]'),
      okReset: !!q('[data-testid="ok-reset"]'),
    } : null,
    preview: prev ? {
      title: norm((prev.querySelector('h4') || {}).innerText || ''),
      columns: qa('[data-testid="preview-table"] thead th').map((th) => th.innerText.trim()),
      bodyRows: qa('[data-testid="preview-table"] tbody tr').length,
      foot: norm(prev.innerText).slice(-160),
      hasSourceNote: norm(prev.innerText).includes('系统实际读到的内容'),
      searchInput: !!q('[data-testid="preview-search"]'),
    } : null,
    errorCard: errCard ? {
      code: q('[data-testid="error-code"]') ? q('[data-testid="error-code"]').innerText.trim() : null,
      header: norm((errCard.querySelector('h3') || {}).innerText || ''),
      message: txt('[data-testid="error-message"]'),
      stageLine: norm((errCard.innerText.split('\\n').find((l) => l.includes('校验顺序第')) || '')),
      hasSuggestion: norm(errCard.innerText).includes('如何修正'),
      // ⚠️ 只取「徽标」那一层 span（类名含 rounded-full）。
      //    不加这个限定会把徽标内部的 ✓ / ✗ 图标 span 也一起收进来（长度翻倍）。
      headerBadges: qa('[data-testid="header-badges"] span.rounded-full').map((s) => norm(s.innerText)),
      errorRows: qa('[data-testid="error-rows"] tbody tr').map((tr) =>
        [...tr.children].map((td) => td.innerText.trim())),
      seriesCurrent: txt('[data-testid="series-current"]'),
      seriesLimit: txt('[data-testid="series-limit"]'),
      gapTable: qa('[data-testid="gap-table"] tbody tr').map((tr) =>
        [...tr.children].map((td) => td.innerText.trim())),
      gapHasNoAuto: norm(errCard.innerText).includes('系统不会自动继续'),
      gapInterpolate: !!q('[data-testid="gap-interpolate"]'),
      gapAbort: !!q('[data-testid="gap-abort"]'),
      downloadErrors: !!q('[data-testid="download-errors"]'),
      resetBtn: !!q('[data-testid="error-reset"]'),
    } : null,
  };
})()`;

const NOTICE_PROBE = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const bars = [...document.querySelectorAll('[role="status"], .notice, [class*="notice"]')];
  return {
    noticeText: norm(document.body.innerText).slice(0, 400),
    hasGiveUp: norm(document.body.innerText).includes('已放弃本次上传'),
    bars: bars.length,
  };
})()`;

/* ==========================================================================
 * 断言与证据
 * ========================================================================== */
const report = { browser: null, states: {}, checks: [], shots: [] };
let failed = 0;

function assert(name, ok, detail = '') {
  report.checks.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
}

const STEPS = [
  '检查文件扩展名与大小',
  '检查行数与序列数规模',
  '检查表头完整性',
  '检查日期可解析性',
  '检查销量非负性',
  '检查时间连续性',
  '检查序列数上限',
];

/* ==========================================================================
 * 主流程
 * ========================================================================== */
(async () => {
  await assertPortFree();
  startEdge();
  const ver = await waitForDevtools();
  report.browser = ver.Browser;

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('没有 page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WS 连接失败')), { once: true });
  });
  const cdp = new CDP(ws);

  let consoleErrors = [];

  /**
   * 环境噪声过滤。
   *
   * ⚠️ 只过滤**来源可证伪**的三类，绝不按「关键字像不像业务错」来放宽：
   *   ① `chrome-extension://` —— 浏览器插件自己的脚本异常；
   *   ② `/hybridaction/` —— 厂商插件（本机 Edge 装有）注入的追踪动作，
   *      它会真的改 `location`，从而让 react-router 打出
   *      `No routes matched location "/hybridaction/..."` 的**警告**；
   *   ③ `runtime.lastError` 类插件间通信噪声。
   * 业务侧（我们的代码、接口、渲染）产生的任何 error/warning/exception 一律计入。
   */
  const NOISE_PATTERNS = [/chrome-extension:\/\//, /\/hybridaction\//, /runtime\.lastError/];
  const isNoise = (text) => NOISE_PATTERNS.some((re) => re.test(text));

  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      if (msg.params.type === 'error' || msg.params.type === 'warning') {
        const text = (msg.params.args || [])
          .map((a) => a.value ?? a.description ?? a.type)
          .join(' ');
        const s = String(text).slice(0, 300);
        if (!isNoise(s)) consoleErrors.push({ level: msg.params.type, text: s });
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const s = String(
        (d.exception && (d.exception.description || d.exception.value)) || d.text,
      ).slice(0, 300);
      // 插件异常的栈里只有 chrome-extension://（页面内异常不会出现该协议）
      const fromExt = /chrome-extension:\/\//.test(s) || /extensions::/.test(String(d.url || ''));
      if (!isNoise(s) && !fromExt) consoleErrors.push({ level: 'exception', text: s });
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Network.enable');

  async function goto(url, settle = 1400) {
    await cdp.send('Page.navigate', { url });
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      try {
        const st = await cdp.eval('document.readyState');
        if (st === 'complete') break;
      } catch {
        /* 导航中执行上下文被销毁 */
      }
      await sleep(200);
    }
    await sleep(settle);
  }

  /**
   * 截图并落盘。
   *
   * ⚠️ `Page.captureScreenshot` 在无头模式下会偶发 `Unable to capture screenshot`
   *    （本页状态切换频繁：上传进度条每 100ms 改一次 DOM，渲染器正在合成时
   *    截图请求会被拒）。截图是**证据**不是断言，不能因为它把整轮走查打断：
   *    先重试，仍失败则降级为「只截视口」（放弃 `captureBeyondViewport`）。
   */
  async function shoot(name) {
    const dir = path.join(OUT, name);
    fs.mkdirSync(dir, { recursive: true });
    const rel = `${name}/app_screenshot.png`;
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const beyond = attempt < 3; // 前 3 次全页，最后一次降级为视口
      try {
        // ⚠️ 单独套 15 秒上限：`cdp.send` 自带的 120 秒超时对截图太长，
        //    一次挂起就是 2 分钟 × 4 次重试 —— 整轮走查会被拖成十几分钟且毫无产出。
        const r = await Promise.race([
          cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: beyond }),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error(`截图超时（attempt ${attempt}）`)), 15000),
          ),
        ]);
        fs.writeFileSync(path.join(OUT, rel), Buffer.from(r.data, 'base64'));
        report.shots.push(beyond ? rel : `${rel}（视口降级）`);
        return rel;
      } catch (e) {
        lastErr = e;
        await sleep(250);
      }
    }
    report.shots.push(`${rel}（截图失败：${String(lastErr).slice(0, 80)}）`);
    return rel;
  }

  async function probe() {
    return await cdp.eval(FULL_PROBE);
  }

  async function phaseNow() {
    return await cdp
      .eval(`(() => { const e = document.querySelector('[data-testid="upload-page"]'); return e ? e.getAttribute('data-phase') : null; })()`)
      .catch(() => null);
  }

  async function waitPhase(want, timeout = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const p = await phaseNow().catch(() => null);
      if (Array.isArray(want) ? want.includes(p) : p === want) return p;
      await sleep(70);
    }
    return null;
  }

  // DOM.setFileInputFiles 走的是真实 file input 通道（与用户点选等价）
  async function injectFile(absPath) {
    const { root } = await cdp.send('DOM.getDocument', { depth: 1 });
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '[data-testid="file-input"]',
    });
    if (!nodeId) throw new Error('找不到 [data-testid="file-input"]');
    await cdp.send('DOM.setFileInputFiles', { files: [absPath], nodeId });
  }

  async function setThrottle(uploadBytesPerSec) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: uploadBytesPerSec === null ? -1 : uploadBytesPerSec,
    });
  }

  async function click(sel) {
    const ok = await cdp.eval(
      `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`,
    );
    return ok;
  }

  /**
   * 单个状态的走查：导航 → 选文件 →（可选）开始上传 → 停在指定阶段。
   *
   * 返回 `{ snap, shot }`。**瞬态必须就地截图**（`shot` 非空）：
   * 「上传中 / 校验中」只持续几百毫秒到几秒，等回到主循环再截，页面上已经是
   * 下一个状态了 —— 那样截出来的图不能证明这个状态存在过。
   */
  async function drive(spec, shotName) {
    consoleErrors = [];
    await setThrottle(null);
    await goto(`${APP}/upload`, 1200);
    await cdp.eval(`localStorage.removeItem('sp_token'); true`);

    if (spec.fixture) {
      await injectFile(FX[spec.fixture]);
      // 选完文件后必然离开 idle：要么 selected（待上传），要么 error（前置拦截）
      const afterPick = await waitPhase(['selected', 'error'], 8000);
      if (afterPick === 'error') {
        await sleep(200);
        return { snap: await probe(), shot: null };
      }
      if (spec.stopAt === 'selected') {
        await sleep(150);
        return { snap: await probe(), shot: null };
      }

      if (spec.throttle) await setThrottle(spec.throttle);
      await click('[data-testid="start-upload"]');
      if (spec.stopAt === 'uploading') {
        const hit = await waitPhase('uploading', 8000);
        if (!hit) throw new Error('未能进入 uploading 态（节流没生效？）');
        const snap = await probe();
        const shot = await shoot(shotName); // ← 就地截图，此时节流仍在
        await setThrottle(null);
        return { snap, shot };
      }
      if (spec.stopAt === 'validating') {
        const hit = await waitPhase('validating', 25000);
        if (!hit) throw new Error('未能进入 validating 态');
        const snap = await probe();
        const shot = await shoot(shotName); // ← 900 ms 的窗口内截
        await setThrottle(null);
        return { snap, shot };
      }
      await setThrottle(null);
      await waitPhase(spec.expect ?? ['ok', 'error'], 30000);
      await sleep(spec.settle ?? 250);
      return { snap: await probe(), shot: null };
    }

    if (spec.action === 'sample') {
      await click('[data-testid="load-sample"]');
      const hit = await waitPhase('sample', 8000);
      if (spec.stopAt === 'sample') {
        if (!hit) throw new Error('未能进入 sample 态');
        const snap = await probe();
        const shot = await shoot(shotName); // ← 就地截图
        return { snap, shot };
      }
      await waitPhase(['ok', 'idle'], 30000);
      await sleep(250);
      return { snap: await probe(), shot: null };
    }

    return { snap: await probe(), shot: null };
  }

  /* ---------------------------------------------------------------- 走查清单 */
  const CASES = [
    { id: '01-idle', label: '待上传（拖拽区）', fixture: null },
    { id: '02-selected', label: '已选文件（待上传）', fixture: 'ok', stopAt: 'selected' },
    {
      id: '03-uploading',
      label: '上传中（进度条）',
      fixture: 'slow_ok',
      stopAt: 'uploading',
      throttle: 40 * 1024, // 40 KB/s：~180 KB 的文件要传 4 秒以上
    },
    { id: '04-validating', label: '校验中（第 N/7 步）', fixture: 'ok', stopAt: 'validating' },
    { id: '05-ok', label: '校验通过（4 指标 + 预览）', fixture: 'ok', expect: ['ok'] },
    { id: '06-err-40001', label: '缺必需列', fixture: 'missing_warehouse' },
    { id: '07-err-40002', label: '日期无法解析', fixture: 'bad_date' },
    { id: '08-err-40003', label: '销量负值/非数值', fixture: 'negative' },
    { id: '09-err-40004', label: '序列数超上限', fixture: 'too_many_series' },
    { id: '10-err-40005', label: '时间断档（二选一）', fixture: 'gap' },
    { id: '11-err-40007', label: '体积超限（前置拦截）', fixture: 'too_big' },
    { id: '12-err-40009', label: '扩展名非 CSV（前置拦截）', fixture: 'bad_ext' },
    { id: '13-sample', label: '加载示例数据（忙碌态）', action: 'sample', stopAt: 'sample' },
  ];

  const snapshots = {};
  for (const c of CASES) {
    const { snap, shot } = await drive(c, c.id);
    snapshots[c.id] = snap;
    const shotPath = shot ?? (await shoot(c.id));
    report.states[c.id] = { label: c.label, screenshot: shotPath, snap };
    assert(
      `[${c.id}] ${c.label} —— 到达 ${c.stopAt ?? c.expect?.[0] ?? '终态'} 且页面非空白`,
      snap.bodyTextLen >= 60,
      `phase=${snap.phase} bodyTextLen=${snap.bodyTextLen}`,
    );
    assert(`[${c.id}] consoleErrors 为空`, consoleErrors.length === 0,
      consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 3)) : '无 error/warning/exception');
  }

  /* ---------------------------------------------------------------- 结构回归 */
  for (const [id, s] of Object.entries(report.states)) {
    const asideText = (s.snap.asideTexts || []).join(' | ');
    assert(`[${id}] 模板 B：aside 仍为 2 个（EP-3 STRUCT_EXPECT 回归）`, s.snap.sidebars === 2,
      `sidebars=${s.snap.sidebars}`);
    assert(`[${id}] 右栏「数据要求速查」卡在（UI/UX §8.1 右栏两卡之一）`,
      asideText.includes('数据要求速查'), asideText.slice(0, 90));
    assert(`[${id}] 右栏「这份数据会怎么用」卡在（UI/UX §8.1 右栏两卡之二）`,
      asideText.includes('这份数据会怎么用'), asideText.slice(0, 90));
    assert(`[${id}] 🔒 右栏不出现原型无依据的「28 天」（已改为 90 点建模门槛）`,
      !asideText.includes('28 天') && asideText.includes('90 个有效点'), asideText.slice(0, 200));
    const d = s.snap.disclaimer;
    assert(`[${id}] 🔒 EP-3 回归：免责声明存在且可见未折叠`,
      d.present && d.display !== 'none' && d.offsetHeight > 0 && d.scrollHeight <= d.clientHeight + 1 && d.details === 0,
      JSON.stringify({ present: d.present, display: d.display, h: d.offsetHeight, sh: d.scrollHeight, ch: d.clientHeight, det: d.details }));
  }

  /* ---------------------------------------------------------------- ① 空态 */
  {
    const s = snapshots['01-idle'];
    assert('① 空态：拖拽区在，且同时给出拖拽与点击两种提示（FR-UPL-01）',
      s.dropzone && (s.dropzoneText || '').includes('拖到这里') && (s.dropzoneText || '').includes('点击选择'),
      String(s.dropzoneText));
    assert('① 空态：拖拽区提示上限（20 MB / 500,000 行）',
      (s.dropzoneText || '').includes('20 MB') && (s.dropzoneText || '').includes('500,000'),
      String(s.dropzoneText));
    assert('① 空态：文件选择器在（隐藏但可被无障碍工具触达）', s.fileInput === true);
    assert('① 空态：不该出现文件条 / 校验面板 / 结果卡',
      !s.fileChip && !s.validationPanel && !s.okCard && !s.errorCard);
  }

  /* ---------------------------------------------------------------- ② 已选文件 */
  {
    const s = snapshots['02-selected'];
    assert('② 已选：文件条显示文件名与大小', !!s.fileChip && /ok\.csv/.test(s.fileChip.text) && /(KB|B)/.test(s.fileChip.text),
      JSON.stringify(s.fileChip));
    assert('② 已选：文件条含 CSV 角标与移除按钮（UX-P05 组件规格）',
      !!s.fileChip && s.fileChip.hasCsvBadge && s.fileChip.hasRemove);
    assert('② 已选：状态徽标为「待上传」（上传由显式按钮触发，非自动）',
      !!s.fileChip && s.fileChip.text.includes('待上传'), String(s.fileChip && s.fileChip.text));
    assert('② 已选：「开始上传」按钮出现', s.startUpload === true);
    assert('② 已选：此时**不该**有进度条', !s.uploadProgress);
  }

  /* ---------------------------------------------------------------- ③ 上传中 */
  {
    const s = snapshots['03-uploading'];
    assert('③ 上传中：进度条出现且带百分比（FR-UPL-04）',
      !!s.uploadProgress && /%/.test(s.uploadProgress), String(s.uploadProgress));
    assert('③ 上传中：进度条 aria-valuenow 是真实数值（0..100）',
      s.uploadProgressNow !== null && Number(s.uploadProgressNow) >= 0 && Number(s.uploadProgressNow) <= 100,
      String(s.uploadProgressNow));
    assert('③ 上传中：状态徽标为「上传中」',
      !!s.fileChip && s.fileChip.text.includes('上传中'), String(s.fileChip && s.fileChip.text));
    assert('③ 上传中：上传未完成前不显示行数/列数（不编造）',
      !!s.fileChip && !/\d+ 行/.test(s.fileChip.text), String(s.fileChip && s.fileChip.text));
  }

  /* ---------------------------------------------------------------- ④ 校验中 */
  {
    const s = snapshots['04-validating'];
    const m = /第 (\d+)\/7 步：(.+)$/.exec(s.validationPanel || '');
    assert('④ 校验中：面板显示「第 N/7 步」（UX-P05-02）', !!m, String(s.validationPanel));
    if (m) {
      const n = Number(m[1]);
      assert('④ 校验中：步号在 1..7 范围内', n >= 1 && n <= 7, `N=${n}`);
      assert('④ 校验中：步骤文案与 VALIDATE_ORDER 的中文阶段名一一对应',
        STEPS.includes(m[2].trim()), `文案「${m[2]}」不在 ${JSON.stringify(STEPS)}`);
      assert('④ 校验中：进度条百分比 = 第 N 步 / 共 7 步',
        Number(s.validationProgressNow) === Math.round((n / 7) * 100),
        `aria=${s.validationProgressNow} expect=${Math.round((n / 7) * 100)}`);
    }
  }

  /* ---------------------------------------------------------------- ⑤ 校验通过 */
  {
    const s = snapshots['05-ok'];
    assert('⑤ 通过：出现通过卡且徽标写明 7/7 全通过', !!s.okCard && s.okCard.hasAllPassBadge);
    assert('⑤ 通过：4 个指标卡齐全（行数/商品/仓库/序列）',
      !!s.okCard && !!s.okCard.metricRowCount && !!s.okCard.metricSku && !!s.okCard.metricWh && !!s.okCard.metricSeries,
      JSON.stringify(s.okCard));
    assert('⑤ 通过：序列数指标含上限与占用率（UX-P05 通过卡）',
      !!s.okCard && /上限/.test(s.okCard.metricSeries) && /%/.test(s.okCard.metricSeries),
      String(s.okCard && s.okCard.metricSeries));

    // 🔒 指标与上传文件的事实一致：2 条序列 × 100 天（item_0001/0002 各 1 仓）
    assert('⑤ 🔒 指标与源文件一致：商品数 = 2',
      !!s.okCard && s.okCard.metricSku.includes('2'), String(s.okCard && s.okCard.metricSku));
    assert('⑤ 🔒 指标与源文件一致：仓库数 = 2',
      !!s.okCard && s.okCard.metricWh.includes('2'), String(s.okCard && s.okCard.metricWh));
    assert('⑤ 🔒 指标与源文件一致：序列数 = 2',
      !!s.okCard && s.okCard.metricSeries.includes('2'), String(s.okCard && s.okCard.metricSeries));
    assert('⑤ 🔒 指标与源文件一致：数据行数 = 200（2 × 100 天）',
      !!s.okCard && s.okCard.metricRowCount.includes('200'), String(s.okCard && s.okCard.metricRowCount));

    assert('⑤ 预览表标注「系统实际读到的内容」（UX-P05-05）',
      !!s.preview && s.preview.hasSourceNote);
    assert('⑤ 🔒 预览表头 = 源文件表头（不多不少，FR-UPL-07）',
      !!s.preview && JSON.stringify(s.preview.columns) === JSON.stringify(['sku_id', 'warehouse_id', 'date', 'sales']),
      JSON.stringify(s.preview && s.preview.columns));
    assert('⑤ 🔒 预览列不含内部辅助列（_d / _s 泄漏即失败）',
      !!s.preview && !s.preview.columns.some((c) => c.startsWith('_')),
      JSON.stringify(s.preview && s.preview.columns));
    assert('⑤ 预览表有数据行（前 20 行）', !!s.preview && s.preview.bodyRows >= 1, String(s.preview && s.preview.bodyRows));
    assert('⑤ 预览表有服务端搜索框（API-10）', !!s.preview && s.preview.searchInput);
    assert('⑤ 通过卡给出「下一步」与「重新上传」两个出口',
      !!s.okCard && s.okCard.nextBtn && s.okCard.okReset);
  }

  /* ---------------------------------------------------------------- ⑥ 40001 缺列 */
  {
    const s = snapshots['06-err-40001'];
    const e = s.errorCard;
    assert('⑥ 缺列：错误码 40001', !!e && e.code === '40001', String(e && e.code));
    assert('⑥ 缺列：报错阶段为「表头完整性」第 3 步（与 VALIDATE_ORDER 同源）',
      !!e && e.stageLine.includes('第 3 步') && e.stageLine.includes('表头完整性'), String(e && e.stageLine));
    assert('⑥ 🔒 缺列：4 个必需列逐个标注 ✓/✗，且明确指出缺失的是 warehouse_id',
      !!e && e.headerBadges.length === 4 && e.headerBadges.some((b) => b.includes('warehouse_id') && b.includes('缺失')),
      JSON.stringify(e && e.headerBadges));
    assert('⑥ 缺列：有「如何修正」提示（UX-AC-05）', !!e && e.hasSuggestion);
    assert('⑥ 缺列：提示点明需使用英文列名（JT-01）',
      !!e && /英文列名|warehouse_id/.test(e.message + e.headerBadges.join('')), String(e && e.message));
    assert('⑥ 🔒 缺列：无错误明细表 → 不给下载按钮（本分支不产明细）',
      !!e && e.errorRows.length === 0 && e.downloadErrors === false);
  }

  /* ---------------------------------------------------------------- ⑦ 40002 日期 */
  {
    const s = snapshots['07-err-40002'];
    const e = s.errorCard;
    assert('⑦ 日期：错误码 40002', !!e && e.code === '40002', String(e && e.code));
    assert('⑦ 日期：报错阶段为「日期可解析性」第 4 步',
      !!e && e.stageLine.includes('第 4 步') && e.stageLine.includes('日期可解析性'), String(e && e.stageLine));
    assert('⑦ 日期：错误明细表给出「行号 + 原始值 + 问题说明」三列（UX-AC-05）',
      !!e && e.errorRows.length >= 3 && e.errorRows.every((r) => r.length === 3),
      JSON.stringify(e && e.errorRows));
    assert('⑦ 🔒 日期：有 dataset_id → 必须给「下载错误明细 CSV」按钮（API-11）',
      !!e && e.downloadErrors === true);
  }

  /* ---------------------------------------------------------------- ⑧ 40003 负值 */
  {
    const s = snapshots['08-err-40003'];
    const e = s.errorCard;
    assert('⑧ 负值：错误码 40003', !!e && e.code === '40003', String(e && e.code));
    assert('⑧ 负值：报错阶段为「销量非负」第 5 步',
      !!e && e.stageLine.includes('第 5 步') && e.stageLine.includes('销量非负'), String(e && e.stageLine));
    assert('⑧ 🔒 负值：明细同时覆盖「负值」与「非数值」两类（不是只报一种）',
      !!e && e.errorRows.some((r) => r[2].includes('负值')) && e.errorRows.some((r) => r[2].includes('非数值')),
      JSON.stringify(e && e.errorRows));
    assert('⑧ 🔒 负值：负值不被取绝对值 —— 明细里要出现原始负号',
      !!e && e.errorRows.some((r) => r[1].startsWith('-')), JSON.stringify(e && e.errorRows));
    assert('⑧ 负值：有下载错误明细按钮', !!e && e.downloadErrors === true);
  }

  /* ---------------------------------------------------------------- ⑨ 40004 序列超限 */
  {
    const s = snapshots['09-err-40004'];
    const e = s.errorCard;
    assert('⑨ 序列超限：错误码 40004', !!e && e.code === '40004', String(e && e.code));
    assert('⑨ 序列超限：阶段为「序列数上限」第 7 步（最后一步）',
      !!e && e.stageLine.includes('第 7 步') && e.stageLine.includes('序列数上限'), String(e && e.stageLine));
    assert('⑨ 序列超限：给出「当前 1,001 vs 上限 1,000」的对比卡',
      !!e && e.seriesCurrent.includes('1,001') && e.seriesLimit.includes('1,000'),
      `当前=${e && e.seriesCurrent} 上限=${e && e.seriesLimit}`);
  }

  /* ---------------------------------------------------------------- ⑩ 40005 断档 */
  {
    const s = snapshots['10-err-40005'];
    const e = s.errorCard;
    assert('⑩ 断档：错误码 40005', !!e && e.code === '40005', String(e && e.code));
    assert('⑩ 断档：阶段为「时间连续性」第 6 步',
      !!e && e.stageLine.includes('第 6 步') && e.stageLine.includes('时间连续性'), String(e && e.stageLine));
    assert('⑩ 🔒 断档：区间表给出「商品/仓库/区间/缺失天数」4 列，且 2 个区间都在',
      !!e && e.gapTable.length === 2 && e.gapTable.every((r) => r.length === 4),
      JSON.stringify(e && e.gapTable));
    assert('⑩ 🔒 断档：缺失天数与夹具一致（8 天 / 3 天）',
      !!e && JSON.stringify(e.gapTable.map((r) => r[3])) === JSON.stringify(['8', '3']),
      JSON.stringify(e && e.gapTable.map((r) => r[3])));
    assert('⑩ 🔒 断档不自动继续：文案明说 + 「自动插值」「放弃上传」两个按钮都在（FR-UPL-13）',
      !!e && e.gapHasNoAuto && e.gapInterpolate && e.gapAbort);
    // 📌 按文档：`UX-ST-05` 的断档分支只含「区间表 + 二选一处置按钮」，
    //    「下载错误明细」只挂在「日期异常 / 负值」两个行级错误分支上（`FR-UPL-06`
    //    要求导出「不合格行」，断档不是行级错误）。此处断言**不给**下载按钮，
    //    防止有人「顺手统一」在断档卡上也加一个 —— 那会导出一个语义不明的文件。
    assert('⑩ 📌 断档分支按文档不给「下载错误明细」（明细面向行级错误，断档不是）',
      !!e && e.downloadErrors === false);
  }

  /* ---------------------------------------------------------------- ⑪⑫ 前置拦截 */
  for (const [id, code, stage, step] of [
    ['11-err-40007', '40007', '大小/行数', '第 2 步'],
    ['12-err-40009', '40009', '扩展名', '第 1 步'],
  ]) {
    const s = snapshots[id];
    const e = s.errorCard;
    assert(`⑪⑫ ${code}：前置拦截生效且错误码正确`, !!e && e.code === code, String(e && e.code));
    assert(`⑪⑫ ${code}：阶段为「${stage}」${step}`,
      !!e && e.stageLine.includes(step) && e.stageLine.includes(stage), String(e && e.stageLine));
    assert(`⑪⑫ 🔒 ${code}：文件未完整落盘 → **不给**下载按钮（点了必 40402）`,
      !!e && e.downloadErrors === false);
    assert(`⑪⑫ ${code}：给出「如何修正」的具体做法（UX-AC-05）`, !!e && e.hasSuggestion && !!e.message);
  }

  /* ---------------------------------------------------------------- ⑬ 示例数据忙碌态 */
  {
    const s = snapshots['13-sample'];
    assert('⑬ 示例数据：忙碌面板给出「进度未知」而不是假进度',
      !!s.busyPanel && s.busyPanel.includes('正在加载示例数据'), String(s.busyPanel));
    assert('⑬ 示例数据：忙碌态**不**套用 7 步校验面板（不属于 7 步校验）',
      !s.validationPanel);
  }

  /* ---------------------------------------------------------------- ⑭ 断档 → 自动插值 → 通过 */

  /**
   * 选文件 → 等「待上传」→ 点「开始上传」→ 等终态。
   *
   * ⚠️ 必须显式点「开始上传」：本页的设计是「选中后停在待上传态」而不是自动开传
   *    （用户要先看清自己选对了没有）。探针第一版漏了这一步，于是 `waitPhase('error')`
   *    空等到超时、后续 `click()` 全部落在不存在的按钮上 —— 表现为一串
   *    `phase=null` 的假失败。抽成函数就是不让第二处再漏。
   */
  async function pickAndUpload(key, expect = ['ok', 'error'], timeout = 30000) {
    await setThrottle(null);
    await goto(`${APP}/upload`, 1200);
    await injectFile(FX[key]);
    const picked = await waitPhase(['selected', 'error'], 10000);
    if (picked === 'error') return 'error';
    await click('[data-testid="start-upload"]');
    return await waitPhase(expect, timeout);
  }

  {
    consoleErrors = [];
    const reached = await pickAndUpload('gap', ['error'], 30000);
    assert('⑭ 前置：断档文件走到 40005 错误卡', reached === 'error', `phase=${reached}`);
    await sleep(250);
    await click('[data-testid="gap-interpolate"]');
    const mid = await waitPhase('interpolating', 8000);
    const midSnap = await probe();
    report.states['14-interpolating'] = { label: '断档自动插值中', snap: midSnap };
    assert('⑭ 插值中：出现忙碌面板，且不套 7 步校验（不是 7 步校验就不该显示 N/7）',
      mid === 'interpolating' && !!midSnap.busyPanel && !midSnap.validationPanel,
      `phase=${mid} busy=${midSnap.busyPanel}`);
    report.states['14-interpolating'].screenshot = await shoot('14-interpolating');

    const done = await waitPhase(['ok', 'error'], 30000);
    await sleep(250);
    const okSnap = await probe();
    report.states['15-gap-resolved'] = { label: '断档插值后通过', snap: okSnap };
    report.states['15-gap-resolved'].screenshot = await shoot('15-gap-resolved');

    assert('⑭ 🔒 断档选「自动插值补齐」后进入通过态（FR-UPL-13）', done === 'ok',
      `phase=${done} err=${okSnap.errorCard && okSnap.errorCard.code}`);
    // 补齐后：2 条序列 × 40 天 = 80 行（原始只有 69 行）
    assert('⑭ 插值后行数 = 2 × 40 = 80（缺失日期被补齐）',
      !!okSnap.okCard && okSnap.okCard.metricRowCount.includes('80'),
      String(okSnap.okCard && okSnap.okCard.metricRowCount));
    assert('⑭ 插值后仍为 2 条序列', !!okSnap.okCard && okSnap.okCard.metricSeries.includes('2'),
      String(okSnap.okCard && okSnap.okCard.metricSeries));
    assert('⑭ 插值流程 consoleErrors 为空', consoleErrors.length === 0,
      consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 3)) : '无 error/warning/exception');
  }

  /* ---------------------------------------------------------------- ⑯ 断档 → 放弃 */
  {
    consoleErrors = [];
    const reached = await pickAndUpload('gap', ['error'], 30000);
    assert('⑯ 前置：断档文件走到 40005 错误卡', reached === 'error', `phase=${reached}`);
    await sleep(250);
    await click('[data-testid="gap-abort"]');
    await waitPhase('idle', 10000);
    await sleep(500);
    const snap = await probe();
    const notice = await cdp.eval(NOTICE_PROBE);
    report.states['16-gap-abort'] = { label: '断档放弃上传', snap, notice };
    report.states['16-gap-abort'].screenshot = await shoot('16-gap-abort');
    const said = (snap.notices || []).join(' | ') + ' ' + notice.noticeText;
    assert('⑯ 🔒 放弃上传：回到空态（拖拽区重现）且给出「已放弃」提示',
      snap.phase === 'idle' && snap.dropzone === true && /已放弃本次上传/.test(said),
      `phase=${snap.phase} notices=${JSON.stringify(snap.notices)}`);
    assert('⑯ 🔒 放弃后不残留错误卡 / 结果卡', !snap.errorCard && !snap.okCard);
    assert('⑯ 放弃流程 consoleErrors 为空', consoleErrors.length === 0,
      consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 3)) : '无 error/warning/exception');
  }

  /* ---------------------------------------------------------------- ⑰ 示例数据 → 通过 + 预览搜索 */
  {
    consoleErrors = [];
    await goto(`${APP}/upload`, 1200);
    await click('[data-testid="load-sample"]');
    await waitPhase('sample', 8000);
    const done = await waitPhase(['ok', 'idle'], 40000);
    await sleep(300);
    const snap = await probe();
    report.states['17-sample-ok'] = { label: '示例数据校验通过', snap };
    report.states['17-sample-ok'].screenshot = await shoot('17-sample-ok');
    assert('⑰ 🔒 示例数据可一键跑通（游客也能用，FR-USR-08）', done === 'ok' && !!snap.okCard,
      `phase=${done}`);
    assert('⑰ 示例数据指标与源文件同源（4 项指标都是数字）',
      !!snap.okCard && /\d/.test(snap.okCard.metricRowCount) && /\d/.test(snap.okCard.metricSku),
      JSON.stringify(snap.okCard));

    // 服务端搜索：输入关键字后预览表脚注应标注「匹配」
    const firstCol = snap.preview && snap.preview.columns[0];
    const kw = String(firstCol || '').includes('sku_id') ? 'item_0001' : '';
    if (kw) {
      await cdp.eval(`(() => {
        const i = document.querySelector('[data-testid="preview-search"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(i, ${JSON.stringify(kw)});
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await sleep(1400);
      const searched = await probe();
      report.states['18-search'] = { label: '预览搜索', snap: searched };
      report.states['18-search'].screenshot = await shoot('18-search');
      assert('⑰ 🔒 预览搜索走服务端并回带匹配标记（API-10）',
        !!searched.preview && searched.preview.foot.includes('匹配'), String(searched.preview && searched.preview.foot));
      assert('⑰ 搜索后仍有匹配行（不是「没有匹配的行」）',
        !!searched.preview && searched.preview.bodyRows >= 1, String(searched.preview && searched.preview.bodyRows));
    }
    assert('⑰ 示例/搜索流程 consoleErrors 为空', consoleErrors.length === 0,
      consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 3)) : '无 error/warning/exception');
  }

  /* ---------------------------------------------------------------- ⑲ 游客提示条 */
  {
    const s = snapshots['01-idle'];
    const notices = (s.notices || []).join(' | ');
    assert('⑲ 🔒 未登录访问本页给出「未登录体验模式」说明（FR-USR-08 / JT-10）',
      /未登录体验模式/.test(notices) && /24 小时/.test(notices), notices.slice(0, 160));
    assert('⑲ 游客说明里写清了「导出与历史记录需登录」这一边界',
      /导出结果与查看历史记录需要登录|需要登录/.test(notices), notices.slice(0, 200));
    assert('⑲ 右栏数据用途声明含「不作其他用途 / 其他用户无法访问 / 24 小时后自动清理」（NFR-SEC-05）',
      (s.asideTexts || []).join(' ').includes('不作其他用途') &&
        (s.asideTexts || []).join(' ').includes('其他用户无法访问') &&
        (s.asideTexts || []).join(' ').includes('24 小时后自动清理'),
      (s.asideTexts || []).join(' ').slice(0, 200));
  }

  ws.close();
})()
  .catch((e) => {
    report.error = String(e && e.stack ? e.stack : e);
    failed += 1;
  })
  .finally(async () => {
    // ⚠️ 必须杀**进程树**：`edge.kill()` 只结束父进程，renderer / gpu 子进程会活下来
    //    继续持有 profile 锁，让下一次跑静默挂起。taskkill /T 才是彻底的做法。
    try {
      if (edge) spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
    try {
      if (edge) edge.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    await sleep(600);
    report.summary = { total: report.checks.length, failed, passed: report.checks.length - failed };
    fs.writeFileSync(path.join(OUT, 'browser_probe_summary.json'), JSON.stringify(report, null, 2));
    console.log('='.repeat(74));
    console.log(`EP-4 浏览器走查：通过 ${report.summary.passed} 项，失败 ${report.summary.failed} 项`);
    console.log(`截图 ${report.shots.length} 张 → ${OUT}/`);
    console.log('='.repeat(74));
    for (const c of report.checks) {
      if (!c.ok) console.log(`  [FAIL] ${c.name} —— ${c.detail}`);
    }
    console.log(`报告：${path.join(OUT, 'browser_probe_summary.json')}`);
    await sleep(300);
    process.exit(failed ? 1 : 0);
  });
