/**
 * 浅色主题渲染校验（CDP + 无头 Edge）
 * 用法: node scripts/shoot_light.mjs <page.html> [selector] [outName.png]
 *   selector 省略时默认截取整页 main 容器
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('prototype');
const OUT = path.resolve('outputs/prototype-shots');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const srv = await new Promise((r) => {
  const s = http.createServer((q, res) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  s.listen(0, '127.0.0.1', () => r(s));
});

const port = srv.address().port;
const dbg = 9346;
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const proc = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${dbg}`, '--disable-gpu',
  '--hide-scrollbars', '--no-first-run', '--window-size=1440,1200', 'about:blank',
], { stdio: 'ignore' });

async function cj(p) {
  const r = await fetch(`http://127.0.0.1:${dbg}${p}`);
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(t.slice(0, 60)); }
}

let target;
for (let i = 0; i < 60; i++) {
  try { const l = await cj('/json/list'); target = l.find((t) => t.type === 'page'); if (target) break; } catch {}
  await new Promise((r) => setTimeout(r, 300));
}
if (!target) { console.error('✗ 无法连接无头 Edge'); proc.kill(); srv.close(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push((m.params.args || []).map((a) => a.value).join(' '));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });

await send('Page.enable');
await send('Runtime.enable');

const [page, selArg, outArg] = process.argv.slice(2);
if (!page) { console.error('用法: node scripts/shoot_light.mjs <page.html> [selector] [outName.png]'); proc.kill(); srv.close(); process.exit(1); }
const sel = selArg || 'main';
const out = outArg || `${page.replace(/\.html$/, '')}-light.png`;

// 先写入浅色偏好，再导航，避免闪一下深色
await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });  // 同源，先拿到 localStorage 权限
await new Promise((r) => setTimeout(r, 400));
await send('Runtime.evaluate', { expression: `localStorage.setItem('sp_theme','light')` });
await send('Page.navigate', { url: `http://127.0.0.1:${port}/${page}` });
await new Promise((r) => setTimeout(r, 1600));

// 兜底：强制摘掉 dark 类并重绘图表
const state = await send('Runtime.evaluate', {
  expression: `(function(){
    document.documentElement.classList.remove('dark');
    var redrawn = [];
    ['renderAllCharts','renderChart','renderHist','renderSelList','renderTable'].forEach(function(fn){
      if (typeof window[fn] === 'function') { try { window[fn](); redrawn.push(fn); } catch(e){} }
    });
    return JSON.stringify({
      theme: document.documentElement.className,
      bg: getComputedStyle(document.body).backgroundColor,
      redrawn: redrawn
    });
  })()`,
  returnByValue: true,
});
await new Promise((r) => setTimeout(r, 1000));

const b = await send('Runtime.evaluate', {
  expression: `(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return JSON.stringify({ notfound: true });
    var x = el.getBoundingClientRect();
    return JSON.stringify({ x: x.x + scrollX, y: x.y + scrollY, w: x.width, h: Math.min(x.height, 2400) });
  })()`,
  returnByValue: true,
});

let box;
try { box = JSON.parse(b.result.result.value); } catch { box = { notfound: true }; }
if (box.notfound) {
  console.error(`✗ 选择器未命中: ${sel}  → 页面 ${page}`);
  ws.close(); proc.kill(); srv.close(); process.exit(2);
}

const shot = await send('Page.captureScreenshot', {
  format: 'png', captureBeyondViewport: true,
  clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 },
});
fs.writeFileSync(path.join(OUT, out), Buffer.from(shot.result.data, 'base64'));

console.log(`✓ ${out}  (${Math.round(box.w)}×${Math.round(box.h)})`);
console.log(`  主题状态: ${state.result.result.value}`);
console.log(`  异常: ${errors.length}${errors.length ? '  ' + errors.slice(0, 3).join(' | ') : ''}`);

ws.close(); proc.kill(); srv.close(); process.exit(errors.length ? 3 : 0);
