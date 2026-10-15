/**
 * 代码审查用的定点复现探针（一次性，非交付物）
 * -----------------------------------------------------------------------------
 * 复现两处可疑缺陷，用真实浏览器 + 真实后端（游客链路，无需登录）：
 *   A. RunningPage 五阶段回放是否推进（怀疑 StrictMode 双调用 + bootRef 空依赖 → 回放死掉）
 *   B. ResultPage 空态的「调整参数重跑」链接参数名（datasetId vs dataset_id）
 *
 * 用法：node scripts/_review_probe.mjs
 * 前置：后端 8000、前端 5173 均已启动。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE = process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.env.CDP_PORT || 9731);
const APP = process.env.APP_URL || 'http://localhost:5173';
const API = process.env.API_URL || 'http://localhost:8000';
const OUT = process.env.OUT_DIR || 'outputs/review-probe';
const PROFILE = path.resolve(OUT, `.edge-profile-${Date.now()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(EDGE)) {
  console.error(`EDGE not found: ${EDGE}`);
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
  '--no-proxy-server',
  '--proxy-bypass-list=<-loopback>',
  '--window-size=1600,1600',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
];

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
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 120000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
    if (r.exceptionDetails) throw new Error('page JS err: ' + r.exceptionDetails.text);
    return r.result.value;
  }
}

async function waitForDevtools(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(400);
  }
  throw new Error('DevTools not ready\n' + edgeErr.slice(-1000));
}

const PROGRESS_PROBE = `(() => {
  const wrap = document.querySelector('[data-testid="run-main-bar"]');
  const fill = wrap ? wrap.querySelector('i') : null;
  const prog = document.querySelector('[data-testid="run-progress"]');
  const txt = prog ? prog.innerText.replace(/\\s+/g,' ') : '';
  const m = txt.match(/阶段\\s*(\\d+)\\s*\\/\\s*(\\d+)/);
  const rows = [...document.querySelectorAll('[data-testid^="stage-row-"]')].map(e => e.innerText.replace(/\\s+/g,' ').trim());
  return {
    pagePhase: (document.querySelector('[data-testid="running-page"]')||{}).getAttribute
      ? document.querySelector('[data-testid="running-page"]').getAttribute('data-phase') : null,
    barWidth: fill ? fill.style.width : null,
    ariaValueNow: wrap ? wrap.getAttribute('aria-valuenow') : null,
    stageText: m ? m[0] : null,
    stageRows: rows,
  };
})()`;

(async () => {
  edge = spawn(EDGE, EDGE_ARGS, { stdio: ['ignore', 'pipe', 'pipe'] });
  edge.stderr.on('data', (d) => (edgeErr += d.toString()));
  const ver = await waitForDevtools();
  console.log('browser:', ver.Browser);

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WS fail')), { once: true });
  });
  const cdp = new CDP(ws);

  const consoleMsgs = [];
  const NOISE = [/chrome-extension:\/\//, /\/hybridaction\//, /runtime\.lastError/];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      const t = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (!NOISE.some((re) => re.test(t))) consoleMsgs.push({ level: msg.params.type, text: String(t).slice(0, 240) });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const s = String((d.exception && (d.exception.description || d.exception.value)) || d.text).slice(0, 240);
      if (!NOISE.some((re) => re.test(s))) consoleMsgs.push({ level: 'exception', text: s });
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  async function goto(url, settle = 1200) {
    await cdp.send('Page.navigate', { url });
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      try {
        if ((await cdp.eval('document.readyState')) === 'complete') break;
      } catch {}
      await sleep(150);
    }
    await sleep(settle);
  }

  const result = {};

  // ---- 准备数据集 ----
  const sResp = await fetch(`${API}/api/v1/datasets/sample`);
  const sBody = await sResp.json();
  if (sBody.code !== 0) throw new Error('sample load failed: ' + JSON.stringify(sBody).slice(0, 200));
  const datasetId = sBody.data.dataset.id;
  console.log('dataset_id =', datasetId);

  // ---- 建任务（同步，返回即终态）----
  console.log('creating task (h=7)...');
  const cResp = await fetch(`${API}/api/v1/predictions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, granularity: 'warehouse_sku', horizon: 7, use_holiday_feature: 1 }),
  });
  const cBody = await cResp.json();
  if (cBody.code !== 0) throw new Error('create failed: ' + JSON.stringify(cBody).slice(0, 300));
  const taskId = cBody.data.task_id;
  console.log('task_id =', taskId, 'status =', cBody.data.status);

  // =========================================================================
  // A. RunningPage 回放推进探针
  // =========================================================================
  console.log('\n[A] /running/' + taskId + ' replay probe');
  await goto(`${APP}/running/${taskId}?horizon=7&holiday=1&datasetId=${datasetId}&t=2026-10-15%2016%3A00%3A00`, 900);
  const s1 = await cdp.eval(PROGRESS_PROBE);
  await sleep(1200);
  const s2 = await cdp.eval(PROGRESS_PROBE);
  await sleep(2500);
  const s3 = await cdp.eval(PROGRESS_PROBE);
  result.running = { t0_9s: s1, t2_1s: s2, t4_6s: s3 };
  console.log('  @0.9s :', JSON.stringify(s1));
  console.log('  @2.1s :', JSON.stringify(s2));
  console.log('  @4.6s :', JSON.stringify(s3));

  const advanced = s1.barWidth !== s3.barWidth || s1.stageText !== s3.stageText;
  console.log('  => 回放是否推进:', advanced ? 'YES (未复现)' : 'NO（复现：进度恒停）');

  // =========================================================================
  // B. ResultPage 空态「调整参数重跑」链接
  // =========================================================================
  console.log('\n[B] /result/999999 empty-state rerun link');
  await goto(`${APP}/result/999999`, 1500);
  const rr = await cdp.eval(`(() => {
    const a = document.querySelector('[data-testid="empty-rerun"]');
    const phase = document.querySelector('[data-testid="result-page"]') ? document.querySelector('[data-testid="result-page"]').getAttribute('data-phase') : null;
    return { phase, href: a ? a.getAttribute('href') : null, text: a ? a.innerText.trim() : null };
  })()`);
  result.resultEmpty = rr;
  console.log('  empty-rerun:', JSON.stringify(rr));

  // 跟着这个链接走一遍，看参数页怎么反应
  if (rr.href) {
    await goto(`${APP}${rr.href}`, 1600);
    const pparam = await cdp.eval(`(() => {
      const e = document.querySelector('[data-testid="params-page"]');
      return { pagePhase: e ? e.getAttribute('data-phase') : null, bodyText: document.body.innerText.replace(/\\s+/g,' ').slice(0, 260) };
    })()`);
    result.afterClickRerun = pparam;
    console.log('  -> params page:', JSON.stringify(pparam));
  }

  result.consoleMsgs = consoleMsgs;
  console.log('\nconsole messages (filtered):', consoleMsgs.length, JSON.stringify(consoleMsgs).slice(0, 500));

  fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(result, null, 2), 'utf-8');
  console.log('\nreport ->', path.join(OUT, 'probe.json'));
})()
  .catch((e) => console.error('\n[FATAL]', e))
  .finally(() => {
    try {
      if (edge) {
        const pid = edge.pid;
        edge.kill('SIGKILL');
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } catch {}
      }
    } catch {}
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch {}
    process.exit(0);
  });
