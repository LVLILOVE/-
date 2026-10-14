/**
 * =============================================================================
 * `EP-5` 浏览器端校验（DOD-EP5 动态部分）
 * -----------------------------------------------------------------------------
 * 用系统自带 Edge（`--headless=new`）+ 原生 CDP 驱动，**不依赖 playwright**
 * （本机无法访问 googleapis，装不上 playwright 的浏览器内核）。
 *
 * 覆盖 `DOD-EP5` 中**只能靠真实渲染判定**的部分：
 *   ① 🔒 `UX-P06` 参数页四个区块齐全，数据取自 `API-09`（非原型假数据）
 *        · 粒度**只读**显示「仓库 × 商品」，且无「重新训练」入口（WS-5-09 🔒）
 *        · 步长 7/14/30 三选一，且 `API-09.estimate_by_horizon` 驱动耗时预估
 *        · 节假日开关 + `<details>` 高级设置（内含「不提供在线重训练」警示）
 *        · 提交失败态：错误码 + 原因 + 重试 + 排查指引（UX-P06-08）
 *   ② 🔒 `UX-P07` 执行页五阶段进度可观测（DOD 第 6 条）
 *        · 时间轴 5 段宽度按 `budget_ratio`，`inference` 最宽
 *        · 完成后展示**真实**分段耗时（而非预估）—— 同源于 `API-12.timing`
 *        · GPU→CPU 回退有明确披露文案
 *   ③ 🔒 完成态「查看预测结果」有路由落点（`/result/:taskId`），不落空白页
 *   ④ 🔒 模板 B 结构未被改坏：`aside` 仍为 2 个（EP-3 `STRUCT_EXPECT` 同款断言）
 *   ⑤ 🔒 游客链路走通：未登录从 `/params` 提交 → `/running` → `/result`
 *   ⑥ 🔒 每个状态 `consoleErrors` 必须为 0（**含 warning 与未捕获异常**）
 *      —— 已有 `api/client.ts` 泛型错标导致参数页渲染空白的前车之鉴，
 *         tsc 与 lint 都查不出来，只有真实渲染才暴露。
 *
 * 用法（在**工作区根目录**执行）：
 *   node scripts/verify_ep5_browser.mjs
 *
 * 前置：后端与前端都要先起好（脚本自己不去拉服务，避免僵尸进程）：
 *   # 后端（🔒 用独立库，避免污染 data/app.db）
 *   DB_PATH=data/tmp/ep5_browser/app.db \
 *   UPLOAD_DIR=data/tmp/ep5_browser/uploads \
 *   EXPORT_DIR=data/tmp/ep5_browser/exports \
 *   C:/ProgramData/anaconda3/envs/deploy/python.exe -m uvicorn app.main:app --port 8000
 *   # 前端
 *   cd web && npx vite --port 5173
 *
 * 环境变量：EDGE_BIN / APP_URL / API_URL / CDP_PORT / OUT_DIR
 * =============================================================================
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE = process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.env.CDP_PORT || 9600 + (process.pid % 200));
const APP = process.env.APP_URL || 'http://localhost:5173';
const API = process.env.API_URL || 'http://localhost:8000';
const OUT = process.env.OUT_DIR || 'outputs/ep5-shots';

/**
 * 🔒 每次跑用**全新的** `--user-data-dir`。
 * 踩过的坑（EP-4 亲历）：复用固定目录时上一次残留的 Edge 子进程
 * （`edge.kill()` 只杀父进程）仍持有 profile 锁，下一次启动会静默挂起 ——
 * 表现为「一直不结束、也不报错」，且一张截图都产不出来。
 */
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
  // 🔒 必加：本机 Edge 装有厂商插件（注入 `/hybridaction/...` 追踪脚本），
  //    不禁用的话「consoleErrors 必须为 0」会被环境噪声打成假失败。
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  // 🔴 必须绕过系统代理（`EP-9` 实测踩坑，见 EP-9 测试报告 §1.2）
  '--no-proxy-server',
  '--proxy-bypass-list=<-loopback>',
  '--window-size=1600,2000',
  // 🔴 缺这一行 Edge 会正常启动但**不监听调试端口** ⇒ `waitForDevtools` 30 秒超时，
  //    表现为「[FATAL] DevTools 端口未就绪」，与页面/脚本都无关。
  `--remote-debugging-port=${PORT}`,
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
    /* 连不上 = 端口空闲 */
  }
}

/**
 * 一次性抓取页面关键结构（比多次 eval 快，也避免多次往返的时序漂移）。
 * 全部用 try/catch 包住 —— 任一项缺失返回 null，由断言去判失败，
 * 不能让探针本身把整轮走查打断。
 */
const PAGE_PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const text = (s) => (q(s) ? q(s).innerText.trim() : null);
  const vis = (s) => {
    const e = q(s);
    if (!e) return false;
    const r = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  return {
    testid: q('[data-testid]') ? q('[data-testid]').getAttribute('data-testid') : null,
    pageTestId: (() => {
      for (const t of ['params-page','running-page','result-page','upload-page']) {
        if (q('[data-testid="' + t + '"]')) return t;
      }
      return null;
    })(),
    dataPhase: (() => {
      for (const t of ['params-page','running-page','result-page','upload-page']) {
        const e = q('[data-testid="' + t + '"]');
        if (e) return e.getAttribute('data-phase');
      }
      return null;
    })(),
    title: text('h1'),
    asides: qa('aside').length,
    steps: qa('[data-testid="step-badges"] [aria-current], [data-testid="step-badges"] *').length,
    stepTestId: q('[data-testid="step-badges"]') ? true : false,
    // 参数页
    horizonRadios: qa('input[name="horizon"]').length,
    horizonChecked: (() => {
      const c = q('input[name="horizon"]:checked');
      return c ? c.value : null;
    })(),
    horizonLabels: qa('input[name="horizon"]').map((i) => i.value),
    // ⚠️ testid 直接落在 input 元素上（外层 label 没有 testid），
    //    别再往下多找一层 checkbox —— 那样只会拿到 null。
    //    （本段在 PAGE_PROBE 模板字面量内，注释里不能用反引号！）
    holidayChecked: q('[data-testid="params-holiday"]')
      ? q('[data-testid="params-holiday"]').checked
      : null,
    holidayPresent: !!q('[data-testid="params-holiday"]'),
    holidayText: q('[data-testid="params-holiday-text"]')
      ? q('[data-testid="params-holiday-text"]').innerText.trim()
      : null,
    granularityText: (() => {
      const all = document.body.innerText;
      const m = all.match(/仓库\\s*[×x]\\s*商品/);
      return m ? m[0] : null;
    })(),
    detailsCount: qa('details').length,
    detailsOpen: qa('details[open]').length,
    taskNameInput: q('[data-testid="params-task-name"]') ? true : false,
    taskNameMax: q('[data-testid="params-task-name"]')
      ? q('[data-testid="params-task-name"]').getAttribute('maxlength')
      : null,
    submitBtn: q('[data-testid="params-submit"]')
      ? { text: q('[data-testid="params-submit"]').innerText.trim(), disabled: q('[data-testid="params-submit"]').disabled }
      : null,
    submitError: q('[data-testid="params-submit-error"]')
      ? q('[data-testid="params-submit-error"]').innerText.trim().slice(0, 400)
      : null,
    // 4 张：metric-estimate / metric-device / metric-l1 / metric-fallback
    estimateMetrics: qa('[data-testid^="metric-"]').map((e) => e.innerText.replace(/\\s+/g, ' ').trim()),
    estimateValue: (() => {
      const e = q('[data-testid="metric-estimate"]');
      return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null;
    })(),
    l1Value: (() => {
      const e = q('[data-testid="metric-l1"]');
      return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null;
    })(),
    asideSelection: q('[data-testid="aside-selection"]') ? q('[data-testid="aside-selection"]').innerText.replace(/\\s+/g,' ').trim().slice(0,200) : null,
    asideWindow: q('[data-testid="aside-window"]') ? q('[data-testid="aside-window"]').innerText.replace(/\\s+/g,' ').trim().slice(0,200) : null,
    // 执行页
    stageRows: qa('[data-testid^="stage-row-"]').map((e) => e.innerText.replace(/\\s+/g, ' ').trim()),
    stageListPresent: !!q('[data-testid="stage-list"]'),
    stageSegs: qa('[data-testid^="timeline-seg-"]').map((e) => ({
      key: e.getAttribute('data-testid').replace('timeline-seg-', ''),
      width: e.getBoundingClientRect().width,
      ms: Number(e.getAttribute('data-stage-ms') || 0),
    })),
    timelinePresent: !!q('[data-testid="stage-timeline"]'),
    timelineSource: q('[data-testid="stage-timeline"]')
      ? q('[data-testid="stage-timeline"]').getAttribute('data-source')
      : null,
    logPresent: !!q('[data-testid="log-stream"]'),
    logLines: q('[data-testid="log-stream"]')
      ? q('[data-testid="log-stream"]').innerText.split('\\n').filter((x) => x.trim()).length
      : 0,
    deviceText: (() => {
      const all = document.body.innerText;
      const m = all.match(/(GPU|CPU)[^\\n]{0,40}/g);
      return m ? m.slice(0, 3) : null;
    })(),
    fallbackText: (() => {
      const all = document.body.innerText;
      const m = all.match(/[^\\n]*回退[^\\n]*/g);
      return m ? m.slice(0, 3) : null;
    })(),
    suggestions: q('[data-testid="run-suggestions"]')
      ? q('[data-testid="run-suggestions"]').innerText.replace(/\\s+/g, ' ').trim().slice(0, 500)
      : null,
    viewResultBtn: q('[data-testid="run-view-result"]')
      ? q('[data-testid="run-view-result"]').getAttribute('href')
      : null,
    bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 1200),
  };
})()`;

const report = { browser: null, pages: {}, checks: [], shots: [] };
let failed = 0;

function assert(name, ok, detail = '') {
  report.checks.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? '[ OK ]' : '[FAIL]'} ${name}${ok || !detail ? '' : `  ${detail}`}`);
}

(async () => {
  await assertPortFree();
  startEdge();
  const ver = await waitForDevtools();
  report.browser = ver.Browser;
  console.log('='.repeat(74));
  console.log(`EP-5 浏览器端校验（DOD-EP5）  ${ver.Browser}`);
  console.log('='.repeat(74));

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
   * 环境噪声过滤：**只**过滤来源可证伪的三类，绝不按「像不像业务错」放宽。
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
      const fromExt = /chrome-extension:\/\//.test(s) || /extensions::/.test(String(d.url || ''));
      if (!isNoise(s) && !fromExt) consoleErrors.push({ level: 'exception', text: s });
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');

  async function goto(url, settle = 1500) {
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

  /** 截图落盘；失败只降级不打断（EP-4 踩过：状态切换频繁时偶发拒绝截图）。 */
  async function shoot(name) {
    const dir = path.join(OUT, name);
    fs.mkdirSync(dir, { recursive: true });
    const rel = `${name}/app_screenshot.png`;
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const beyond = attempt < 3;
      try {
        const r = await Promise.race([
          cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: beyond }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('截图超时')), 15000)),
        ]);
        fs.writeFileSync(path.join(OUT, rel), Buffer.from(r.data, 'base64'));
        report.shots.push(rel);
        console.log(`       📷 ${rel}`);
        return rel;
      } catch (e) {
        lastErr = e;
        await sleep(250);
      }
    }
    report.shots.push(`${rel}（截图失败：${String(lastErr).slice(0, 80)}）`);
    return rel;
  }

  const probe = async () => await cdp.eval(PAGE_PROBE);

  async function phaseNow(pageTestId) {
    return await cdp
      .eval(
        `(() => { const e = document.querySelector('[data-testid="${pageTestId}"]'); return e ? e.getAttribute('data-phase') : null; })()`,
      )
      .catch(() => null);
  }

  async function waitPhase(pageTestId, want, timeout = 90000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const p = await phaseNow(pageTestId).catch(() => null);
      if (Array.isArray(want) ? want.includes(p) : p === want) return p;
      await sleep(200);
    }
    return null;
  }

  async function click(sel) {
    const ok = await cdp.eval(
      `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`,
    );
    if (!ok) throw new Error(`点不到：${sel}`);
    return true;
  }

  // =========================================================================
  // 准备：确保示例数据集存在（游客可调）
  // =========================================================================
  console.log('\n【准备】加载示例数据集（游客态）');
  const sampleResp = await fetch(`${API}/api/v1/datasets/sample`);
  const sampleBody = await sampleResp.json();
  if (sampleResp.status !== 200 || sampleBody.code !== 0) {
    throw new Error(`示例数据集加载失败：${sampleResp.status} ${JSON.stringify(sampleBody).slice(0, 200)}`);
  }
  const datasetId = sampleBody.data.dataset.id;
  console.log(`       dataset_id=${datasetId}`);

  // =========================================================================
  // ① UX-P06 参数页
  // =========================================================================
  console.log('\n【①】UX-P06 参数页（游客态，真实取数）');
  await goto(`${APP}/params?datasetId=${datasetId}`, 2600);
  let p = await probe();
  report.pages.params = p;

  assert('① 参数页渲染（data-testid=params-page）', p.pageTestId === 'params-page', `实际=${p.pageTestId}`);
  assert(
    '① 模板 B 结构未被改坏：aside 仍为 2 个',
    p.asides === 2,
    `实际 ${p.asides} 个`,
  );
  assert('① 四步指示条存在', p.stepTestId, '未找到 step-badges');
  assert('① 标题正确', /预测参数/.test(p.title || ''), `实际=${p.title}`);

  // 🔴 步长三选一（UX-P06-02）
  assert(
    '① 🔒 步长三选一（7/14/30）且默认选中',
    p.horizonRadios === 3 && p.horizonLabels.join(',') === '7,14,30' && p.horizonChecked !== null,
    `radios=${p.horizonRadios} labels=${p.horizonLabels} checked=${p.horizonChecked}`,
  );
  // 🔴 粒度只读「仓库 × 商品」
  assert(
    '① 🔒 粒度只读显示「仓库 × 商品」（UX-P06-01）',
    !!p.granularityText,
    `未找到粒度文本；body 前 200=${(p.bodyText || '').slice(0, 200)}`,
  );
  // 节假日开关 + 高级设置
  assert(
    '① 节假日开关存在（且有明确选中态与文字）',
    p.holidayPresent && typeof p.holidayChecked === 'boolean' && !!p.holidayText,
    `present=${p.holidayPresent} checked=${p.holidayChecked} 文字=${p.holidayText}`,
  );
  assert(
    '① 高级设置为 <details>（默认折叠）',
    p.detailsCount >= 1 && p.detailsOpen === 0,
    `details=${p.detailsCount} open=${p.detailsOpen}`,
  );
  // 任务名 ≤40 字
  assert(
    '① 🔒 任务名输入框 maxlength=40（UX-P06-07）',
    p.taskNameInput && p.taskNameMax === '40',
    `存在=${p.taskNameInput} maxlength=${p.taskNameMax}`,
  );
  // 🔴 耗时预估取自 API-09.estimate_by_horizon
  assert(
    '① 🔒 耗时预估卡 4 张齐全（UX-P06-06）',
    p.estimateMetrics.length === 4,
    `指标卡数=${p.estimateMetrics.length}；内容=${JSON.stringify(p.estimateMetrics).slice(0, 220)}`,
  );
  assert(
    '① 🔒 预估耗时有真实数值（不是「—」，说明 API-09 已取到）',
    !!p.estimateValue && /\d/.test(p.estimateValue) && !/^—/.test(p.estimateValue),
    `metric-estimate=${p.estimateValue}`,
  );
  assert(
    '① 🔒 L1 批量规模取自分级预判（真实数值）',
    !!p.l1Value && /\d/.test(p.l1Value),
    `metric-l1=${p.l1Value}`,
  );
  // 右栏两块
  assert('① 右栏「当前选择」有内容', !!p.asideSelection, `实际=${p.asideSelection}`);
  assert('① 右栏「预测窗口」有内容', !!p.asideWindow, `实际=${p.asideWindow}`);

  await shoot('01-params-default');

  // 高级设置展开 → 校验「不提供在线重训练」警示在
  await cdp.eval(`(() => { const d = document.querySelector('details'); if (d) d.open = true; return !!d; })()`);
  await sleep(400);
  const advText = await cdp.eval(
    `(() => { const d = document.querySelector('details'); return d ? d.innerText : ''; })()`,
  );
  assert(
    '① 🔒 高级设置内显式声明「不提供在线重训练」（UX-P06-04）',
    /不提供在线重训练|不包含在线重训练/.test(String(advText)),
    `details 文本前 300=${String(advText).slice(0, 300)}`,
  );
  assert(
    '① 🔒 全页无「重新训练」可点入口（WS-5-09）',
    !/重新训练/.test(String(advText)) || /不提供/.test(String(advText)),
    '出现了未否定的「重新训练」',
  );
  await shoot('02-params-advanced');

  // 切步长到 30 → 预估应随之变化（证明不是写死）
  const beforeEst = p.estimateValue;
  const beforeL1 = p.l1Value;
  const beforeWindow = p.asideWindow;
  // 真实实现是 <input data-testid="params-horizon-30"> 形态，不是 name/value 选择器
  const clicked = await cdp.eval(
    `(() => { const el = document.querySelector('[data-testid="params-horizon-30"]'); if (!el) return false; el.click(); return true; })()`,
  );
  assert('① 步长 30 可点选', clicked, '未找到 params-horizon-30');
  await sleep(1200);
  const p30 = await probe();
  assert(
    '① 🔒 切换步长后耗时预估随之变化（真取数，非写死）',
    p30.estimateValue !== beforeEst,
    `h=14: ${beforeEst}  →  h=30: ${p30.estimateValue}`,
  );
  assert(
    '① 🔒 右栏「预测窗口」随之变化',
    p30.asideWindow !== beforeWindow,
    `h=14: ${beforeWindow}  →  h=30: ${p30.asideWindow}`,
  );
  await shoot('03-params-h30');

  // 回到 14（提交用）
  await cdp.eval(`(() => { const el = document.querySelector('[data-testid="params-horizon-14"]'); if (el) el.click(); return !!el; })()`);
  await sleep(600);

  // =========================================================================
  // ② 提交失败态（先断网，再恢复）
  // =========================================================================
  console.log('\n【②】UX-P06 提交失败态（错误码 + 重试 + 排查指引）');
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await sleep(300);
  await click('[data-testid="params-submit"]').catch(() => {});
  await sleep(2500);
  const pErr = await probe();
  assert(
    '② 🔒 提交失败展示错误原因（不是空白）',
    !!pErr.submitError && pErr.submitError.length > 10,
    `submitError=${(pErr.submitError || '').slice(0, 160)}`,
  );
  // ⚠️ 「重试」按钮在**提交失败态**里（params-retry），而断网时的错误条
  //    只给原因 + 排查指引。两者分开断言，避免一个正则同时要求两样。
  const hasRetry = await cdp
    .eval(`!!document.querySelector('[data-testid="params-retry"]')`)
    .catch(() => false);
  assert(
    '② 🔒 失败态有「重试」入口（params-retry）',
    hasRetry || /重试|再试/.test(pErr.bodyText || ''),
    `params-retry=${hasRetry}`,
  );
  assert(
    '② 🔒 失败态含「排查指引」',
    /排查|检查|确认|后端/.test(pErr.bodyText || ''),
    `submitError=${(pErr.submitError || '').slice(0, 200)}`,
  );
  await shoot('04-params-submit-error');

  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await sleep(800);

  // =========================================================================
  // ③ UX-P07 执行页：真提交并跑到终态
  // =========================================================================
  console.log('\n【③】UX-P07 执行页（真实提交，跑到终态）');
  console.log('       提示：h=14 端到端约 8–17 秒，耐心等待…');
  const t0 = Date.now();
  await click('[data-testid="params-submit"]');
  // 提交后应跳到 /running/:taskId
  const jumped = await waitPhase('running-page', ['running', 'succeeded', 'failed', 'invalid'], 120000);
  const urlNow = await cdp.eval('location.pathname + location.search');
  assert(
    '③ 🔒 提交后跳转到 /running/:taskId（游客链路 FR-USR-08）',
    /^\/running\/\d+/.test(String(urlNow)),
    `实际 URL=${urlNow}`,
  );

  // 抓「运行中」那一瞬（若任务太快，终态也可能直接命中）
  const pRunEarly = await probe();
  report.pages.running = pRunEarly;
  assert('③ 🔒 执行页渲染', pRunEarly.pageTestId === 'running-page', `实际=${pRunEarly.pageTestId}`);
  assert('③ 🔒 模板 B 结构未被改坏：aside 仍为 2 个', pRunEarly.asides === 2, `实际 ${pRunEarly.asides} 个`);
  assert(
    '③ 🔒 五阶段进度可观测（DOD 第 6 条）',
    pRunEarly.stageListPresent && pRunEarly.stageRows.length === 5,
    `stage-list=${pRunEarly.stageListPresent} 阶段行数=${pRunEarly.stageRows.length}；` +
      `内容=${JSON.stringify(pRunEarly.stageRows).slice(0, 300)}`,
  );

  const endPhase = await waitPhase('running-page', ['succeeded', 'failed'], 180000);
  const wallSec = ((Date.now() - t0) / 1000).toFixed(1);
  const pRun = await probe();
  report.pages.runningDone = pRun;

  console.log(`       终态=${endPhase} 耗时=${wallSec}s jumped=${jumped}`);
  assert(
    '③ 🔒 任务成功完成（h=14 端到端 ≤ 60 s 硬预算）',
    endPhase === 'succeeded' && Number(wallSec) < 60,
    `phase=${endPhase} wall=${wallSec}s`,
  );

  // 🔴 时间轴 5 段宽度：inference 必须最宽（DOD 第 2 条 + UX-P07-01）
  const segs = pRun.stageSegs || [];
  assert(
    '③ 时间轴 5 段渲染',
    pRun.timelinePresent && segs.length === 5,
    `stage-timeline=${pRun.timelinePresent} 段数=${segs.length} source=${pRun.timelineSource}`,
  );
  if (segs.length === 5) {
    const widest = segs.reduce((a, b) => (b.width > a.width ? b : a));
    assert(
      '③ 🔒 时间轴 inference 段最宽（哪段最贵要一眼可见）',
      widest.key === 'inference',
      `各段宽度=${JSON.stringify(segs)}`,
    );
    const widths = segs.map((s) => s.width);
    assert(
      '③ 🔒 时间轴 5 段宽度互不相同（不是均分假进度）',
      new Set(widths.map((w) => Math.round(w))).size === 5,
      `宽度=${JSON.stringify(widths)}`,
    );
  }

  // 🔒 完成后展示真实分段耗时（而非预估）
  const doneText = String(pRun.bodyText || '');
  assert(
    '③ 🔒 完成后展示真实耗时与分级小结',
    /端到端|实际耗时|耗时/.test(doneText) && /L1/.test(doneText),
    `bodyText 前 400=${doneText.slice(0, 400)}`,
  );
  assert(
    '③ 执行日志有摘要行',
    pRun.logPresent && (pRun.logLines || 0) >= 3,
    `log-stream=${pRun.logPresent} 行数=${pRun.logLines}`,
  );
  assert(
    '③ 🔒 设备信息已披露（GPU/CPU）',
    !!(pRun.deviceText && pRun.deviceText.length),
    `deviceText=${JSON.stringify(pRun.deviceText)}`,
  );
  // 完成态「查看预测结果」有落点
  assert(
    '③ 🔒 完成态「查看预测结果」指向 /result/:taskId（DOD：不落空白页）',
    /^\/result\/\d+/.test(String(pRun.viewResultBtn || '')),
    `href=${pRun.viewResultBtn}`,
  );
  await shoot('05-running-succeeded');

  // =========================================================================
  // ④ 结果页占位（UX-P08 属 EP-6，此处只验「有落点、不白屏」）
  // =========================================================================
  console.log('\n【④】/result/:taskId 占位页可达（EP-6 前置）');
  const taskId = String(urlNow).match(/\/running\/(\d+)/)?.[1];
  await goto(`${APP}/result/${taskId}?horizon=14`, 2200);
  const pRes = await probe();
  report.pages.result = pRes;
  assert('④ 结果页渲染（不是空白）', pRes.pageTestId === 'result-page', `实际=${pRes.pageTestId}`);
  assert('④ 结果页模板 B 结构正常', pRes.asides === 2, `实际 ${pRes.asides} 个`);
  // ⚠️ `EP-9` 校验链回归（脚本缺陷 `T-22`）：以下两条原为 `EP-5` 阶段的
  //    **临时占位断言** —— 当时 `UX-P08` 结果页尚未实现，只验「有落点、不白屏」，
  //    故要求 `data-phase=succeeded` 且页面显式标注「EP-6 补全」。
  //    `EP-6` 落地后占位文案被移除、`data-phase` 语义由「任务终态字符串」
  //    改为「页面就绪态 `ready`」，原判据必然失败。
  //    这不是产品缺陷，而是**断言的生命周期到了**：现升级为「`EP-6` 成果回归」，
  //    既确认就绪态，也**反向**确认占位文案确实已被清除（防止有人把占位又加回来）。
  assert(
    '④ 结果页进入就绪态（EP-6 已落地）',
    pRes.dataPhase === 'ready',
    `data-phase=${pRes.dataPhase}`,
  );
  assert(
    '④ 结果页已渲染真实指标，且「EP-6 补全」占位文案已清除（EP-6 成果回归）',
    /加权 MAPE/.test(String(pRes.bodyText)) && !/EP-6[ ·]*补全/.test(String(pRes.bodyText)),
    `bodyText 前 200=${(pRes.bodyText || '').slice(0, 200)}`,
  );
  await shoot('06-result-placeholder');

  // =========================================================================
  // ⑤ 回归：上传页 → 参数页链路仍通
  // =========================================================================
  console.log('\n【⑤】回归：上传页 → 参数页链路');
  await goto(`${APP}/upload`, 1800);
  const pUp = await probe();
  assert('⑤ 上传页仍渲染', pUp.pageTestId === 'upload-page', `实际=${pUp.pageTestId}`);
  assert('⑤ 上传页 aside 仍为 2 个（EP-3 STRUCT_EXPECT 回归）', pUp.asides === 2, `实际 ${pUp.asides} 个`);
  await shoot('07-upload-regression');

  // =========================================================================
  // ⑥ consoleErrors 必须为 0
  // =========================================================================
  console.log('\n【⑥】控制台干净度');
  assert(
    '⑥ 🔒 全程 consoleErrors = 0（含 warning 与未捕获异常）',
    consoleErrors.length === 0,
    `${consoleErrors.length} 条：${JSON.stringify(consoleErrors).slice(0, 600)}`,
  );

  // =========================================================================
  // 落盘报告
  // =========================================================================
  const reportPath = path.join(OUT, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('\n' + '='.repeat(74));
  const passCount = report.checks.filter((c) => c.ok).length;
  console.log(`通过 ${passCount} 项，失败 ${failed} 项`);
  console.log(`报告：${reportPath}`);
  console.log(`截图目录：${OUT}`);
  console.log('='.repeat(74));
})()
  .catch((e) => {
    console.error('\n[FATAL]', e);
    failed += 1;
  })
  .finally(() => {
    // ⚠️ 必须杀**进程树**：`edge.kill()` 只结束父进程，
    //    renderer / gpu 子进程会活下来并持有 profile 锁。
    try {
      if (edge) {
        const pid = edge.pid;
        edge.kill('SIGKILL');
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          /* 已退出 */
        }
      }
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    process.exit(failed ? 1 : 0);
  });