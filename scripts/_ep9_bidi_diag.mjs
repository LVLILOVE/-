/**
 * `_ep9_bidi_diag.mjs` —— Firefox BiDi 握手诊断（辅助脚本，不进校验链）
 *
 * 目的：`WebDriver BiDi listening on ws://127.0.0.1:PORT` 已经打印了，
 * 但 Node 内置 `WebSocket` 连不上（只报一个没有细节的 `ws error`）。
 * 这里用**裸 TCP + 手工 HTTP Upgrade 握手**，把 Firefox 真实返回的
 * 状态行与响应头打出来 —— WebSocket 握手失败时服务端通常会回一个
 * 非 101 的 HTTP 响应，那里面才有原因（Host 校验 / Origin 校验 / 路径不对）。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FF = process.env.FIREFOX_BIN || path.resolve('data/tmp/browsers/firefox/firefox.exe');
const PORT = 9934;
const PROFILE = path.resolve(`data/tmp/browsers/ff-diag-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(PROFILE, { recursive: true });
const p = spawn(FF, [
  '-headless', '-no-remote', '-new-instance',
  '-profile', PROFILE,
  '--remote-debugging-port', String(PORT),
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
p.stdout.on('data', (d) => process.stdout.write(`[ff out] ${d}`));
p.stderr.on('data', (d) => process.stdout.write(`[ff err] ${d}`));

await sleep(12000);

// ---------- ① 端口是否真的在听 ----------
await new Promise((res) => {
  const s = net.connect(PORT, '127.0.0.1');
  s.on('connect', () => { console.log(`① 127.0.0.1:${PORT} TCP 可连 ✅`); s.destroy(); res(); });
  s.on('error', (e) => { console.log(`① TCP 连接失败 ❌ ${e.code}`); res(); });
});

// ---------- ② 手工 WebSocket 握手，打印服务端响应 ----------
async function handshake(hostHeader, pathStr = '/') {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(PORT, '127.0.0.1', () => {
      sock.write(
        `GET ${pathStr} HTTP/1.1\r\n`
        + `Host: ${hostHeader}\r\n`
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + `Sec-WebSocket-Key: ${key}\r\n`
        + 'Sec-WebSocket-Version: 13\r\n'
        + '\r\n',
      );
    });
    let buf = '';
    const done = (tag) => {
      const head = buf.split('\r\n\r\n')[0];
      console.log(`\n----- ② 握手 Host=${hostHeader} path=${pathStr} → ${tag} -----`);
      console.log(head || '(空响应)');
      try { sock.destroy(); } catch { /* ignore */ }
      resolve();
    };
    sock.on('data', (d) => { buf += d.toString('binary'); if (buf.includes('\r\n\r\n')) done('有响应'); });
    sock.on('error', (e) => { console.log(`② Host=${hostHeader} 错误：${e.code}`); resolve(); });
    sock.on('close', () => { if (!buf) done('连接被关闭且无响应'); });
    setTimeout(() => done('超时无响应'), 5000);
  });
}

await handshake(`127.0.0.1:${PORT}`);
await handshake(`localhost:${PORT}`);
await handshake(`127.0.0.1:${PORT}`, '/session');

// ---------- ③ Node 内置 WebSocket，打印完整错误 ----------
await new Promise((resolve) => {
  const w = new WebSocket(`ws://127.0.0.1:${PORT}`);
  w.addEventListener('open', () => { console.log('\n③ Node WebSocket 连接成功 ✅'); w.close(); resolve(); });
  w.addEventListener('error', (e) => {
    console.log('\n③ Node WebSocket 失败 ❌');
    console.log('  message =', e.message);
    console.log('  error   =', e.error && (e.error.code || e.error.message));
    console.log('  keys    =', Object.keys(e));
    resolve();
  });
  w.addEventListener('close', (e) => console.log('  close code =', e.code, 'reason =', e.reason));
  setTimeout(() => resolve(), 8000);
});

// ---------- ④ 对照：Chromium 的 HTTP 发现端点 ----------
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(3000) });
  console.log(`\n④ HTTP /json/version → HTTP ${r.status}`);
} catch (e) {
  console.log(`\n④ HTTP /json/version → ${e.name}: ${e.message}`);
}

try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
// ⚠️ 等浏览器真的退出再删（`taskkill` 异步；立刻删会被文件锁挡住，`T-26`），带重试
await sleep(1500);
for (let i = 0; i < 6; i += 1) {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 文件锁，重试 */ }
  if (!fs.existsSync(PROFILE)) break;
  await sleep(1000);
}
process.exit(0);
