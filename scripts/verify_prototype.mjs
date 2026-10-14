/**
 * 原型渲染自检：用系统自带 Edge（Chromium 内核）无头加载每个页面，
 * 收集控制台错误、未捕获异常，并输出页面标题、节点数与首屏截图。
 *
 * 用法：
 *   node scripts/verify_prototype.mjs
 *
 * 依赖：本机已安装 Microsoft Edge（Windows 10/11 默认自带），无需下载浏览器。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROTOTYPE_DIR = join(ROOT, 'prototype');
const SHOT_DIR = join(ROOT, 'outputs', 'prototype-shots');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findEdge() {
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('未找到 Microsoft Edge，请确认已安装');
}

/* ---------- 1. 起一个静态服务器 ---------- */
function startServer(dir) {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8',
  };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(dir, p);
    if (!file.startsWith(dir) || !existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

/* ---------- 2. 通过 CDP 驱动 Edge ---------- */
async function cdpJson(port, path, method = 'GET') {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  const txt = await r.text();
  try { return JSON.parse(txt); }
  catch { throw new Error(`非 JSON 响应: ${txt.slice(0, 80)}`); }
}

async function checkPage(baseUrl, page, port) {
  // 复用启动时创建的那个标签页（/json/new 在部分版本会立刻关闭旧 target）
  const list = await cdpJson(port, '/json/list');
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('没有可用的页面 target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const errors = [];
  let nodeCount = 0, title = '', textLen = 0;

  await new Promise((res) => (ws.onopen = res));

  let id = 0;
  const send = (method, params = {}) =>
    new Promise((res) => {
      const myId = ++id;
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === myId) { ws.removeEventListener('message', onMsg); res(m.result); }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('未捕获异常: ' + (d.exception?.description || d.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const t = m.params.entry.text || '';
      // 忽略 favicon 之类无关请求
      if (!/favicon/i.test(t)) errors.push('网络/日志错误: ' + t);
      // favicon 404 属无害噪声，已在页面中显式声明 favicon.svg
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  // 导航到目标页并等待加载完成
  await send('Page.navigate', { url: baseUrl + '/' + page });
  await new Promise((r) => setTimeout(r, 1500));

  const r1 = await send('Runtime.evaluate', {
    expression: 'document.title + "||" + document.querySelectorAll("*").length + "||" + document.body.innerText.length',
    returnByValue: true,
  });
  const parts = String(r1.result?.value || '').split('||');
  title = parts[0] || '';
  nodeCount = Number(parts[1] || 0);
  textLen = Number(parts[2] || 0);

  // 截图
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (shot?.data) {
    if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });
    writeFileSync(join(SHOT_DIR, page.replace(/\.html$/, '.png')), Buffer.from(shot.data, 'base64'));
  }

  ws.close();
  return { page, title, nodeCount, textLen, errors };
}

/* ---------- 3. 主流程 ---------- */
const { server, port: httpPort } = await startServer(PROTOTYPE_DIR);
const edge = findEdge();
const debugPort = 9333;
const base = `http://127.0.0.1:${httpPort}`;

const child = spawn(edge, [
  '--headless=new',
  `--remote-debugging-port=${debugPort}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--disable-extensions',
  '--user-data-dir=' + join(ROOT, 'outputs', '.edge-profile'),
  'about:blank',
], { stdio: 'ignore' });

// 等 DevTools 端口就绪
let ready = false;
for (let i = 0; i < 40; i++) {
  try { await cdpJson(debugPort, '/json/version'); ready = true; break; }
  catch { await new Promise((r) => setTimeout(r, 300)); }
}
if (!ready) { child.kill(); server.close(); throw new Error('Edge 调试端口未就绪'); }

const pages = readdirSync(PROTOTYPE_DIR).filter((f) => f.endsWith('.html')).sort();
const results = [];
for (const p of pages) {
  try {
    results.push(await checkPage(base, p, debugPort));
  } catch (e) {
    results.push({ page: p, error: String(e.message || e) });
  }
}

child.kill();
server.close();

/* ---------- 4. 报告 ---------- */
console.log('\n===== 原型渲染自检 =====\n');
let bad = 0;
for (const r of results) {
  if (r.error) { bad++; console.log(`✗ ${r.page}  加载失败: ${r.error}`); continue; }
  const ok = r.errors.length === 0 && r.nodeCount > 40 && r.textLen > 200;
  if (!ok) bad++;
  console.log(
    `${ok ? '✓' : '✗'} ${r.page.padEnd(22)} 节点 ${String(r.nodeCount).padStart(4)}  ` +
    `文本 ${String(r.textLen).padStart(5)} 字  「${r.title}」`
  );
  r.errors.slice(0, 6).forEach((e) => console.log(`     ! ${e}`));
}
console.log(`\n共 ${results.length} 页，异常 ${bad} 页`);
console.log(`截图输出：${SHOT_DIR}`);
process.exit(bad ? 1 : 0);
