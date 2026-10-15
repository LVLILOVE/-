/**
 * 修复验证：截首页 + 检查布局关键量（辅助脚本，非交付物）
 * 用法：node scripts/_shot_home.mjs
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE = process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.env.CDP_PORT || 9761);
const APP = process.env.APP_URL || 'http://localhost:5173';
const OUT = process.env.OUT_DIR || 'outputs/review-probe';
const PROFILE = path.resolve(OUT, `.edge-shot-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

let edge = null;
let edgeErr = '';
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
      } else if (m.method) for (const l of [...this.listeners]) l(m);
    });
  }
  on(fn) { this.listeners.push(fn); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 120000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}
async function waitDevtools(t = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return await r.json(); } catch {}
    await sleep(400);
  }
  throw new Error('devtools not ready\n' + edgeErr.slice(-800));
}

const CHECK = `(() => {
  const q = (s) => document.querySelector(s);
  const hero = q('.hero');
  const heroCS = hero ? getComputedStyle(hero) : null;
  const grid = hero ? getComputedStyle(hero).gridTemplateColumns : null;
  const facts = document.querySelector('.hero-facts');
  const factCS = facts ? getComputedStyle(facts) : null;
  const chart = q('[data-testid="hero-chart"], .hero canvas, .hero svg');
  const twApplied = (() => {
    const d = document.createElement('div');
    d.className = 'flex';
    document.body.appendChild(d);
    const v = getComputedStyle(d).display;
    d.remove();
    return v;
  })();
  return {
    theme: document.documentElement.className,
    tailwindDisplayFlex: twApplied,
    heroDisplay: heroCS ? heroCS.display : null,
    heroGridCols: grid,
    heroMaxWidth: hero ? hero.getBoundingClientRect().width : null,
    factsDisplay: factCS ? factCS.display : null,
    factsWrap: factCS ? factCS.flexWrap : null,
    bodyScrollWidth: document.body.scrollWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    h1: (() => { const e = q('h1'); return e ? e.innerText.replace(/\\s+/g, ' ').trim().slice(0, 40) : null; })(),
    h1Left: (() => { const e = q('h1'); return e ? Math.round(e.getBoundingClientRect().left) : null; })(),
    chartW: chart ? Math.round(chart.getBoundingClientRect().width) : null,
    metricVerdicts: [...document.querySelectorAll('[data-testid^="metric-verdict-"]')]
      .map((e) => e.innerText.trim()),
    metricVerdictColors: [...document.querySelectorAll('[data-testid^="metric-verdict-"]')]
      .map((e) => getComputedStyle(e).color),
    overallBadge: (() => {
      const e = [...document.querySelectorAll('span')].find((s) => /全部达标|存在未达标项/.test(s.innerText));
      return e ? e.innerText.trim() : null;
    })(),
  };
})()`;

(async () => {
  edge = spawn(EDGE, [
    '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--disable-dev-shm-usage','--hide-scrollbars','--disable-extensions',
    '--disable-component-extensions-with-background-pages','--disable-background-networking',
    '--no-proxy-server','--proxy-bypass-list=<-loopback>','--window-size=1440,2400',
    `--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  edge.stderr.on('data', (d) => (edgeErr += d.toString()));
  const ver = await waitDevtools();
  console.log('browser:', ver.Browser);

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((x) => x.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
  const cdp = new CDP(ws);

  const msgs = [];
  cdp.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      const t = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (!/chrome-extension:\/\/|\/hybridaction\//.test(t)) msgs.push(t.slice(0, 200));
    }
    if (m.method === 'Runtime.exceptionThrown') msgs.push('EXC: ' + String(m.params.exceptionDetails.text).slice(0, 200));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  await cdp.send('Page.navigate', { url: `${APP}/` });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try { if ((await cdp.eval('document.readyState')) === 'complete') break; } catch {}
    await sleep(150);
  }
  await sleep(3500);

  const res = await cdp.eval(CHECK);
  console.log('\n=== 首页布局检查 ===');
  console.log(JSON.stringify(res, null, 2));
  console.log('\nconsole 消息:', msgs.length, JSON.stringify(msgs).slice(0, 400));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const out = path.join(OUT, 'home-after-fix.png');
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('\n截图 ->', out);
})()
  .catch((e) => console.error('[FATAL]', e))
  .finally(() => {
    try { if (edge) { const pid = edge.pid; edge.kill('SIGKILL'); try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch {} } } catch {}
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
    process.exit(0);
  });
