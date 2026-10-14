/**
 * =============================================================================
 * `WS-10-03` 接口文档离线化 —— 真实浏览器验收
 * -----------------------------------------------------------------------------
 * 依据文档 : 《项目开发实施方案 V1.0》§7.11 `WS-10-03`
 *            「导出 OpenAPI；🔒 Swagger 资源离线化（国内网络必需）」
 *            《开发技术文档 V1.0》§10.4、§9.2 第 15 项「接口文档可访问」
 *            `DOD-EP10`「`/docs` 正常渲染（Swagger 资源已离线化）」
 * -----------------------------------------------------------------------------
 * 🔒 为什么必须用真实浏览器，`curl` 返 200 什么都不证明
 * -----------------------------------------------------------------------------
 * 资源没加载时 `/docs` **照样是 200** —— HTML 本来就能拿到，白屏的是 JS 渲染出的
 * 面板。所以「200 就是通过」是这类缺陷最容易漏判的地方。真正的判据是三条一起看：
 *
 *   ① DOM 真的渲染了              —— `.opblock`（接口条目）数量 > 0；
 *   ② 引用的资源零外部 http(s)    —— 扫全部 `link[href]` / `script[src]`；
 *   ③ 零加载失败                  —— CDP `Network.loadingFailed` 为空、
 *                                   且所有请求状态码 < 400。
 *
 * 只满足其中一条都不足以排除「HTML 到了、资源没到」这一经典故障。
 *
 * -----------------------------------------------------------------------------
 * 驱动方式：系统 Edge（或 Chrome for Testing）`--headless=new` + 原生 CDP。
 * 不依赖 playwright —— 沿用 `verify_ep6/7/8/9_browser.mjs` 的骨架。
 *
 * 用法（先启动后端，默认 8021）：
 *   node scripts/verify_docs_browser.mjs
 *   BROWSER=chrome node scripts/verify_docs_browser.mjs
 *
 * 可选环境变量：`API_URL` / `EDGE_BIN` / `CHROME_BIN` / `CDP_PORT` / `OUT_DIR`
 * =============================================================================
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API_URL || 'http://127.0.0.1:8021';
const PORT = Number(process.env.CDP_PORT || 9700 + (process.pid % 90));
const OUT = process.env.OUT_DIR || 'outputs/ep10-shots';
const OUT_ABS = path.resolve(OUT);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSERS = [
  {
    name: 'Edge',
    key: 'edge',
    cands: [
      process.env.EDGE_BIN,
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ],
  },
  {
    name: 'Chrome',
    key: 'chrome',
    cands: [
      process.env.CHROME_BIN,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      path.resolve('data/tmp/browsers/chrome-win64/chrome.exe'),
    ],
  },
];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '[ OK ] ' : '[FAIL] ') + name + (ok ? '' : `  ${detail}`));
  return !!ok;
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
  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((x) => x !== fn); }; }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP 超时: ${method}`)); }
      }, 120000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`页面内 JS 异常：${r.exceptionDetails.text}`);
    return r.result.value;
  }
}

async function waitForDevtools(port, timeoutMs, errBox) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch { /* 未就绪 */ }
    await sleep(400);
  }
  throw new Error(`DevTools 端口未就绪(port=${port})\n${String(errBox.err).slice(-1000)}`);
}

/** 页面内探针：一次取回「是否渲染 / 资源是否外部 / 本地引用」 */
const DOM_PROBE = `(() => {
  const links = [...document.querySelectorAll('link[href], script[src]')]
    .map(e => e.getAttribute('href') || e.getAttribute('src'));
  const ext = links.filter(u => /^https?:\\/\\//i.test(u));
  const local = links.filter(u => u.startsWith('/static/'));
  return JSON.stringify({
    opblocks: document.querySelectorAll('.opblock').length,
    infoTitle: (document.querySelector('.info .title') || {}).textContent || '',
    ext,
    local,
    textHead: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
  });
})()`;

const REDOC_PROBE = `(() => {
  const links = [...document.querySelectorAll('link[href], script[src]')]
    .map(e => e.getAttribute('href') || e.getAttribute('src'));
  const ext = links.filter(u => /^https?:\\/\\//i.test(u));
  const txt = (document.body.innerText || '').replace(/\\s+/g, ' ');
  return JSON.stringify({
    // ReDoc 把「按标签分组」渲染成菜单文本；用正文里出现接口路径来判定真的渲染了
    rendered: /\\/api\\/v1\\//.test(txt),
    hasTitle: /电商销量预测系统/.test(txt),
    ext,
    textHead: txt.slice(0, 160),
  });
})()`;

async function main() {
  const want = String(process.env.BROWSER || 'edge').toLowerCase();
  const target = BROWSERS.find((b) => b.key === want) || BROWSERS[0];
  const bin = target.cands.filter(Boolean).find((p) => fs.existsSync(p));
  if (!bin) {
    console.error(`[FATAL] 找不到浏览器 ${target.name}；可用环境变量 ${target.key.toUpperCase()}_BIN 指定`);
    process.exit(2);
  }
  console.log('='.repeat(74));
  console.log(`接口文档离线化 · 浏览器验收（${target.name}）`);
  console.log('='.repeat(74));

  // ---------- 0. 服务探活 ----------
  let docsStatus = 0;
  let docsHtml = '';
  try {
    const r = await fetch(`${API}/docs`, { redirect: 'manual' });
    docsStatus = r.status;
    docsHtml = await r.text();
  } catch (e) {
    console.error(`[FATAL] 后端不可达 ${API}/docs：${e.message}`);
    process.exit(2);
  }
  console.log(`  后端 ${API} 在线，/docs → HTTP ${docsStatus}（${docsHtml.length} 字节）`);

  fs.mkdirSync(OUT_ABS, { recursive: true });
  const profileDir = path.join(OUT_ABS, `.${target.key}-profile-${Date.now()}`);
  let browserErr = '';
  const browser = spawn(bin, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--disable-extensions',
    '--disable-background-networking',
    // 🔴 必须绕过系统代理：本机 HTTP_PROXY=127.0.0.1:51141 会把 127.0.0.1 也塞进代理
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    '--window-size=1600,1000',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  browser.stderr.on('data', (d) => { browserErr += d.toString(); });

  let code = 1;
  try {
    await waitForDevtools(PORT, 30000, { err: browserErr });
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page') || list[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);

    const netFail = [];
    const badStatus = [];
    const consoleErrors = [];
    cdp.on((msg) => {
      if (msg.method === 'Network.loadingFailed') {
        netFail.push(`${msg.params.type || '?'} ${msg.params.errorText || '?'}`);
      }
      if (msg.method === 'Network.responseReceived') {
        const st = msg.params.response.status;
        if (st >= 400) badStatus.push(`${st} ${msg.params.response.url}`);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        consoleErrors.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text).slice(0, 200));
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1366, height: 768, deviceScaleFactor: 1, mobile: false,
    });

    async function goto(url, settle = 2500) {
      await cdp.send('Page.navigate', { url });
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        try {
          const st = await cdp.eval('document.readyState');
          if (st === 'complete') break;
        } catch { /* 导航中 */ }
        await sleep(200);
      }
      await sleep(settle);
    }

    async function shoot(name) {
      try {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT_ABS, `${name}.png`), Buffer.from(r.data, 'base64'));
      } catch { /* 截图失败不致命 */ }
    }

    // ------------------------------------------------------------------
    console.log('\n' + '='.repeat(74));
    console.log('① /docs —— Swagger UI 离线渲染');
    console.log('='.repeat(74));
    netFail.length = 0; badStatus.length = 0; consoleErrors.length = 0;
    await goto(`${API}/docs`, 3500);
    const d = JSON.parse(await cdp.eval(DOM_PROBE));
    await shoot('docs');

    check('①-1 /docs HTTP 200', docsStatus === 200, `实际 ${docsStatus}`);
    check('①-2 HTML 内零外部 http(s) 资源引用（静态口径）',
      !/[src|href]\s*=\s*["']https?:\/\//i.test(docsHtml),
      '（HTML 里出现了 CDN 外链）');
    check('①-3 🔒 Swagger UI **真的渲染了**（.opblock > 0）', d.opblocks > 0,
      `实际 opblocks=${d.opblocks}（资源没加载时恒为 0）`);
    check('①-4 DOM 内零外部资源引用（运行时口径）', d.ext.length === 0,
      `外链：${JSON.stringify(d.ext.slice(0, 3))}`);
    check('①-5 引用的均为本地 /static/ 资源', d.local.length >= 2,
      `本地引用：${JSON.stringify(d.local)}`);
    check('①-6 零网络加载失败（Network.loadingFailed 空）', netFail.length === 0,
      `失败：${JSON.stringify(netFail.slice(0, 3))}`);
    check('①-7 零 4xx/5xx 响应', badStatus.length === 0,
      `异常响应：${JSON.stringify(badStatus.slice(0, 3))}`);
    check('①-8 零控制台 error', consoleErrors.length === 0,
      `报错：${JSON.stringify(consoleErrors.slice(0, 2))}`);
    check('①-9 接口分组标题可见（正文含系统名或分组）',
      /电商销量预测|datasets|auth|predictions|history|admin/.test(d.textHead + d.infoTitle),
      `正文头：${d.textHead.slice(0, 80)}`);

    // ------------------------------------------------------------------
    console.log('\n' + '='.repeat(74));
    console.log('② /redoc —— ReDoc 离线渲染');
    console.log('='.repeat(74));
    netFail.length = 0; badStatus.length = 0; consoleErrors.length = 0;
    let redocStatus = 0;
    try {
      redocStatus = (await fetch(`${API}/redoc`, { redirect: 'manual' })).status;
    } catch { /* ignore */ }
    await goto(`${API}/redoc`, 4000);
    const rd = JSON.parse(await cdp.eval(REDOC_PROBE));
    await shoot('redoc');
    check('②-1 /redoc HTTP 200', redocStatus === 200, `实际 ${redocStatus}`);
    check('②-2 ReDoc 真的渲染出接口内容（正文含 /api/v1/ 路径）', rd.rendered,
      `正文头：${rd.textHead.slice(0, 80)}`);
    check('②-3 DOM 内零外部资源引用（with_google_fonts=False 生效）', rd.ext.length === 0,
      `外链：${JSON.stringify(rd.ext.slice(0, 3))}`);
    check('②-4 零网络加载失败', netFail.length === 0, `失败：${JSON.stringify(netFail.slice(0, 3))}`);
    check('②-5 零控制台 error', consoleErrors.length === 0, `报错：${JSON.stringify(consoleErrors.slice(0, 2))}`);

    // ------------------------------------------------------------------
    console.log('\n' + '='.repeat(74));
    console.log('③ 负向：资源缺失必须 404，不能回退成 HTML 外壳');
    console.log('='.repeat(74));
    const miss = await fetch(`${API}/static/vendor/swagger-ui/__not_exist__.js`);
    check('③-1 不存在的静态资源返回 404（而不是 200 + HTML）', miss.status === 404,
      `实际 ${miss.status}`);
    const ct = miss.headers.get('content-type') || '';
    check('③-2 404 响应不是 HTML（避免调用方拿到外壳当资源）', !/text\/html/i.test(ct),
      `content-type=${ct}`);

    // ------------------------------------------------------------------
    const passed = results.filter((r) => r.ok).length;
    console.log('\n' + '='.repeat(74));
    console.log(`结果：${passed}/${results.length} 通过`);
    console.log('='.repeat(74));
    fs.writeFileSync(
      path.resolve('outputs/ep10_docs_report.json'),
      JSON.stringify({ browser: target.name, api: API, passed, total: results.length, results }, null, 2),
      'utf-8',
    );
    code = passed === results.length ? 0 : 1;
  } catch (e) {
    console.error(`[FATAL] ${e.message}`);
    code = 2;
  } finally {
    try { spawn('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await sleep(1500);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* 残留无碍 */ }
  }
  process.exit(code);
}

main();
