/**
 * =============================================================================
 * `_ep9_bidi_probe.mjs` —— Firefox WebDriver BiDi 协议探针（**辅助脚本，不进校验链**）
 * -----------------------------------------------------------------------------
 * 目的：在把 `CdpOverBidi` 接进 `verify_ep9_browser.mjs` 主流程**之前**，先用
 * **原始报文**把下面这些假设逐条证伪/证实。理由很实在：BiDi 与 CDP 的差异
 * 不在「方法名不同」这一层，而在**返回值形状**——
 * `script.evaluate` 给的是 RemoteValue（对象被拆成 `[[k, rv], …]`），
 * 一旦按 CDP 的习惯去读 `r.value.foo`，拿到的是 `undefined`，
 * 断言会**静默地全绿或全红**，比直接报错危险得多。
 *
 * 逐项验证：
 *   ① `--remote-debugging-port` 是否真能拉起 BiDi（Firefox ≥129 的行为）
 *   ② HTTP 端点 `/json/version` 是否暴露 `webSocketDebuggerUrl`
 *   ③ `session.status` / `session.new` 的先后关系（是否已默认建 session）
 *   ④ `session.subscribe(['log.entryAdded'])` 事件格式
 *   ⑤ `browsingContext.getTree` 的 context 结构
 *   ⑥ `script.evaluate` 的**返回形状**（简单值 / 嵌套对象 / 异常）
 *   ⑦ `browsingContext.setViewport` 是否被支持
 *   ⑧ `browsingContext.captureScreenshot` 的返回字段名
 *
 * 用法（工作区根目录）：
 *   FIREFOX_BIN=<path> node scripts/_ep9_bidi_probe.mjs
 * =============================================================================
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FF = process.env.FIREFOX_BIN
  || [
    path.resolve('data/tmp/browsers/firefox/firefox.exe'),
    path.resolve('data/tmp/browsers/firefox/Firefox/firefox.exe'),
    'C:/Program Files/Mozilla Firefox/firefox.exe',
  ].find((p) => fs.existsSync(p));

const PORT = Number(process.env.BIDI_PORT || 9933);
const PROFILE = path.resolve(`data/tmp/browsers/ff-probe-${Date.now()}`);

if (!FF) {
  console.error('❌ 找不到 firefox.exe（设 FIREFOX_BIN 或先解包 MSI）');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function show(label, v) {
  console.log(`\n----- ${label} -----`);
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
}

let proc = null;
let ws = null;
let nextId = 0;
const pending = new Map();
const seen = [];

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`超时 ${method}`)); }
    }, 20000);
  });
}

try {
  // -------- ① 启动 Firefox ------------------------------------------------
  fs.mkdirSync(PROFILE, { recursive: true });
  proc = spawn(FF, [
    '-headless',
    '-no-remote',
    '-new-instance',
    '-profile', PROFILE,
    '--remote-debugging-port', String(PORT),
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d) => { err += d.toString(); });
  console.log(`启动 Firefox: ${FF}\n  profile=${PROFILE}\n  port=${PORT}`);

  // -------- ② 等 BiDi 端点 ------------------------------------------------
  // 🔴 **两个与 Chromium 都不同的点**（都是实测撞出来的，文档里很难查到）：
  //    ① Firefox 把 BiDi 的 WebSocket **直接监听在 `--remote-debugging-port`
  //       指定的端口上**，没有 `/json/version` 那种 HTTP 发现端点；
  //    ② 而且握手路径是 **`/session`**，不是根路径 `/`
  //       —— 用 `ws://127.0.0.1:PORT`（根路径）会拿到 `HTTP 200 + HTML`，
  //       Node 的 `WebSocket` 只会报一个没有细节的 `non-101 status code`。
  //       裸 TCP 手工握手对比后确认：`GET /session` → `101 Switching Protocols`。
  const WS_URL = `ws://127.0.0.1:${PORT}/session`;
  {
    const t0 = Date.now();
    let lastErr = '';
    while (Date.now() - t0 < 60000) {
      try {
        ws = await new Promise((res, rej) => {
          const w = new WebSocket(WS_URL);
          const timer = setTimeout(() => {
            try { w.close(); } catch { /* ignore */ }
            rej(new Error('open timeout'));
          }, 3000);
          w.addEventListener('open', () => { clearTimeout(timer); res(w); }, { once: true });
          w.addEventListener('error', () => { clearTimeout(timer); rej(new Error('ws error')); }, { once: true });
        });
        break;
      } catch (e) {
        lastErr = e.message;
        await sleep(500);
      }
    }
    if (!ws) throw new Error(`60s 内 ${WS_URL} 未就绪（${lastErr}）\n${err.slice(-800)}`);
    show('② BiDi WebSocket 已连接', WS_URL);
  }
  // 挂消息处理器（必须在 `send()` 之前）
  const msgLog = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.type === 'error') reject(new Error(`${m.error}: ${m.message}`));
      else resolve(m.result ?? {});
    } else if (m.method) {
      msgLog.push(m);
      if (m.method === 'log.entryAdded') seen.push(m.params);
    }
  });
  console.log('✅ WebSocket 已连接');

  // 顺带确认 HTTP 发现端点确实**不存在**（把这个差异钉在证据里）
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(3000) });
    show('② /json/version（对照，Chromium 习惯）', `意外可用：HTTP ${r.status}`);
  } catch (e) {
    show('② /json/version（对照，Chromium 习惯）', `如预期不可用：${e.name}`);
  }

  // -------- ③ session.new（**必须显式建 session**） -----------------------
  // ⚠️ 别被 `session.status` 的 `{ready: true}` 骗了：它只表示「服务端准备好
  //    接受一个新 session」，**不等于当前连接已有 session**。首轮据此跳过
  //    `session.new`，结果下一条 `session.subscribe` 直接报
  //    `invalid session id: WebDriver session does not exist, or is not active`。
  //    故这里**无条件**发 `session.new`；仅在「已存在」这类错误时才忽略。
  try {
    const st = await send('session.status');
    show('③ session.status（仅表示服务端可接受新 session）', st);
  } catch (e) {
    show('③ session.status 不可用', e.message);
  }
  try {
    const nw = await send('session.new', { capabilities: {} });
    show('③ session.new', nw);
  } catch (e) {
    show('③ session.new 失败（若为「已存在」则可忽略）', e.message);
  }

  // -------- ④ 订阅事件 ----------------------------------------------------
  try {
    const sub = await send('session.subscribe', { events: ['log.entryAdded'] });
    show('④ session.subscribe', sub);
  } catch (e) {
    show('④ session.subscribe 失败', e.message);
  }

  // -------- ⑤ browsingContext.getTree -------------------------------------
  let ctx = null;
  const tree = await send('browsingContext.getTree', { maxDepth: 1 });
  show('⑤ browsingContext.getTree', tree);
  if (tree.contexts && tree.contexts.length) ctx = tree.contexts[0].context;
  if (!ctx) {
    const created = await send('browsingContext.create', { type: 'tab' });
    show('⑤ browsingContext.create', created);
    ctx = created.context;
  }
  console.log(`  → context = ${ctx}`);

  // -------- ⑥ script.evaluate 的返回形状 ----------------------------------
  const evalCases = {
    '简单字符串': 'document.readyState',
    '数字': '1 + 41',
    '布尔': 'true',
    '嵌套对象（布局探针的简化版）': '({ a: 1, b: { c: "x", d: [1,2,3] }, e: null, f: true })',
    'undefined 返回': 'localStorage.setItem("probe_k", "v")',
    'localStorage 读回': 'localStorage.getItem("probe_k")',
    '数组': '[1, "two", {three: 3}]',
    '抛异常': '(() => { throw new Error("probe boom"); })()',
    'NaN / Infinity': '({ nan: 0/0, inf: 1/0 })',
  };
  for (const [label, expr] of Object.entries(evalCases)) {
    try {
      const r = await send('script.evaluate', {
        expression: expr,
        target: { context: ctx },
        awaitPromise: false,
        resultOwnership: 'none',
      });
      show(`⑥ ${label}`, r);
    } catch (e) {
      show(`⑥ ${label} 失败`, e.message);
    }
  }

  // -------- ⑦ setViewport -------------------------------------------------
  try {
    const vp = await send('browsingContext.setViewport', {
      context: ctx, viewport: { width: 1366, height: 768 }, devicePixelRatio: 1,
    });
    show('⑦ browsingContext.setViewport', vp);
    const chk = await send('script.evaluate', {
      expression: '({ w: window.innerWidth, h: window.innerHeight })',
      target: { context: ctx }, awaitPromise: false, resultOwnership: 'none',
    });
    show('⑦ 视口回读', chk);
  } catch (e) {
    show('⑦ setViewport 失败', e.message);
  }

  // -------- ⑧ 导航 + 截图 --------------------------------------------------
  try {
    const nav = await send('browsingContext.navigate', {
      context: ctx, url: 'data:text/html,<h1>probe</h1><p>hello bidi</p>', wait: 'none',
    });
    show('⑧ navigate', nav);
    await sleep(1200);
    const rs = await send('script.evaluate', {
      expression: 'document.readyState',
      target: { context: ctx }, awaitPromise: false, resultOwnership: 'none',
    });
    show('⑧ 导航后 readyState', rs);

    const shot = await send('browsingContext.captureScreenshot', {
      context: ctx, format: { type: 'image/png' },
    });
    show('⑧ captureScreenshot 字段', {
      keys: Object.keys(shot),
      dataType: typeof shot.data,
      dataLen: String(shot.data || '').length,
    });
  } catch (e) {
    show('⑧ 导航/截图失败', e.message);
  }

  // -------- ④ 事件验证：制造一条 console.error -----------------------------
  try {
    await send('script.evaluate', {
      expression: 'console.error("probe console error"); undefined',
      target: { context: ctx }, awaitPromise: false, resultOwnership: 'none',
    });
    await send('script.evaluate', {
      expression: 'setTimeout(() => { throw new Error("probe uncaught"); }, 0); undefined',
      target: { context: ctx }, awaitPromise: false, resultOwnership: 'none',
    });
    await sleep(1500);
    show('④ 收到的事件（原始报文）', msgLog.map((m) => ({ method: m.method, params: m.params })));
  } catch (e) {
    show('④ 事件验证失败', e.message);
  }

  console.log('\n===== 探针完成 =====');
} catch (e) {
  console.error('\n[FATAL]', e.message);
} finally {
  try { if (ws) ws.close(); } catch { /* ignore */ }
  try {
    if (proc) spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch { /* ignore */ }
  // ⚠️ 等浏览器真的退出再删 profile —— 进程还活着时删会被文件锁挡住，
  //    留下几十 MB 的残留（正是 `P3-03` 那个问题的成因）。
  // ⚠️ 等浏览器真的退出再删 —— `taskkill` 是**异步**的，立刻删会被文件锁挡住
  //    并静默失败，留下几十 MB 的 profile（`T-26` 的成因）。故带重试。
  await sleep(1500);
  for (let i = 0; i < 6; i += 1) {
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 文件锁，重试 */ }
    if (!fs.existsSync(PROFILE)) break;
    await sleep(1000);
  }
  process.exit(0);
}
