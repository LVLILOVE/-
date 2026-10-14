/**
 * 定点截图：打开某个页面，滚动到指定选择器，截取该元素区域。
 * 用法：node shoot_section.mjs <page> <selector> <outName> [waitMs]
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('prototype');
const OUT = path.resolve('outputs/prototype-shots');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end('nf'); }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find((p) => fs.existsSync(p));

const srv = await serve();
const port = srv.address().port;
const dbgPort = 9344;
const proc = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${dbgPort}`,
  '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,1000', '--force-device-scale-factor=1', 'about:blank',
], { stdio: 'ignore' });

async function cdpJson(p, method = 'GET') {
  const r = await fetch(`http://127.0.0.1:${dbgPort}${p}`, { method });
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error('非JSON: ' + t.slice(0, 80)); }
}
let target;
for (let i = 0; i < 60; i++) {
  try { const l = await cdpJson('/json/list'); target = l.find((t) => t.type === 'page'); if (target) break; } catch {}
  await new Promise((r) => setTimeout(r, 300));
}

const { WebSocket } = await import('node:worker_threads').then(() => ({ WebSocket: globalThis.WebSocket }));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const [page, selector, outName, waitMs] = process.argv.slice(2);
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/${page}` });
await new Promise((r) => setTimeout(r, Number(waitMs) || 2200));

// 取元素 bounding box
const r = await send('Runtime.evaluate', {
  expression: `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(!el)return 'NOTFOUND';var b=el.getBoundingClientRect();return JSON.stringify({x:b.x+scrollX,y:b.y+scrollY,w:b.width,h:b.height});})()`,
  returnByValue: true,
});
const box = JSON.parse(r.result.result.value);
const shot = await send('Page.captureScreenshot', {
  format: 'png', captureBeyondViewport: true,
  clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 },
});
const out = path.join(OUT, outName);
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('✓', out, JSON.stringify(box));

ws.close(); proc.kill(); srv.close();
process.exit(0);
