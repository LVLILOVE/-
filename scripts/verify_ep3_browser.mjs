/**
 * =============================================================================
 * `EP-3` 浏览器端校验（DOD-EP3 动态部分）
 * -----------------------------------------------------------------------------
 * 用系统自带 Edge（`--headless=new`）+ 原生 CDP 驱动，不需要 playwright：
 * 本机无法访问 googleapis，装不上 playwright 的浏览器内核（内网限制）。
 *
 * 覆盖 DOD-EP3 中**只能靠真实渲染判定**的三条：
 *   ② 🔒 首页展示的硬指标与 outputs/eval_report.json 逐项一致
 *        —— 读 DOM 的 `data-value`，与 JSON 逐项比对（不是眼看）
 *   ③ 🔒 免责声明在任意页面可见 —— 走查 4 个不同模板的页面：
 *        `/`（模板 D 营销）、`/login`（模板 C 认证）、
 *        `/upload`（模板 B 主内容+右栏）、`/dashboard`（模板 A 应用页）
 *        每页断言：存在 / 可见（offsetHeight>0、display≠none）/
 *        **未被折叠或截断**（scrollHeight ≤ clientHeight+1、无 details/summary）/
 *        文案完整
 *   ⑤ 深浅主题切换后图表颜色随之变化（UX-GOV-02a）
 *        —— 读 ECharts(SVG) 的 stroke/fill 签名 + `--c1` 令牌 + localStorage
 *
 * 另外每页都断言 `consoleErrors` 为空（含 warning 与未捕获异常）。
 *
 * 用法：
 *   EDGE_BIN="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
 *   APP_URL=http://localhost:5173 \
 *   OUT_DIR=outputs/ep3-shots \
 *   node scripts/verify_ep3_browser.mjs
 *
 * ⚠️ `/dashboard` 需要登录态：探针先用 `API-01/02` 注册一个一次性账号
 *    （邮箱带时间戳），拿到 Token 后写入 localStorage 再导航。
 *    后端请用**独立库**启动，避免污染 data/app.db：
 *      DB_PATH=data/tmp/ep3_probe/app.db uvicorn app.main:app --port 8000
 * =============================================================================
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE = process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.env.CDP_PORT || 9444);
const APP = process.env.APP_URL || 'http://localhost:5173';
const OUT = process.env.OUT_DIR || 'outputs/ep3-shots';
const EVAL_JSON = process.env.EVAL_JSON || 'outputs/eval_report.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(EDGE)) {
  console.error(`找不到 Edge：${EDGE}\n可用 EDGE_BIN 环境变量指定。`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const edge = spawn(
  EDGE,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    // 🔴 **必须绕过系统代理**（`EP-9` 实测踩坑）：本机 `HTTP_PROXY/HTTPS_PROXY`
    //    指向 `127.0.0.1:51141`，Edge 无头会继承它 → 连本地地址也走代理，
    //    拿到 502、页面全白，极易被误判成「前端崩了」。见 EP-9 测试报告 §1.2。
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    '--window-size=1600,1400',
    `--user-data-dir=${path.resolve(OUT, '.edge-profile')}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let edgeErr = '';
edge.stderr.on('data', (d) => {
  edgeErr += d.toString();
});

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
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) {
      throw new Error(`页面内 JS 异常：${r.exceptionDetails.text} ${JSON.stringify(r.result?.value ?? '')}`);
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

/* ------------------------------------------------------------------ 页面探针 */

const DISCLAIMER_KEYS = ['不构成任何经营决策依据', '不具备预测能力', '不作其他用途'];

/** 免责声明探针：存在 / 可见 / 未折叠 / 未截断 / 文案完整 */
const DISCLAIMER_PROBE = `(() => {
  const el = document.querySelector('.disclaimer');
  const footer = document.querySelector('[data-testid="site-footer"]');
  if (!el) return { found: false };
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const text = norm(el.innerText);
  return {
    found: true,
    footerFound: !!footer,
    display: cs.display,
    visibility: cs.visibility,
    offsetHeight: el.offsetHeight,
    offsetWidth: el.offsetWidth,
    rectHeight: Math.round(rect.height),
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    textLen: text.length,
    keys: ${JSON.stringify(DISCLAIMER_KEYS)}.map((k) => ({ k, hit: text.includes(k) })),
    detailsCount: el.querySelectorAll('details, summary').length,
    ariaHidden: el.getAttribute('aria-hidden'),
    footerTextLen: footer ? norm(footer.innerText).length : 0,
  };
})()`;

/** 硬指标探针：读出 .eval-metrics 各项的 data-* 钩子 */
const METRICS_PROBE = `(() => {
  const box = document.querySelector('[data-testid="eval-metrics"]');
  if (!box) return { found: false };
  const rows = [...box.querySelectorAll('[data-metric]')].map((r) => ({
    key: r.getAttribute('data-metric'),
    value: r.getAttribute('data-value'),
    limit: r.getAttribute('data-limit'),
    ok: r.getAttribute('data-ok'),
    text: r.innerText.replace(/\\s+/g, ' ').trim(),
  }));
  const hero = [...document.querySelectorAll('[data-hero-measured]')].map((e) => ({
    index: e.getAttribute('data-hero-measured'),
    text: e.innerText.trim(),
  }));
  return {
    found: true,
    source: box.getAttribute('data-eval-source'),
    horizon: box.getAttribute('data-eval-horizon'),
    allOk: box.getAttribute('data-eval-all-ok'),
    rows,
    hero,
  };
})()`;

/** 页面结构计数探针（把「布局没被改坏」也纳入回归） */
const STRUCT_PROBE = `(() => {
  const q = (s) => document.querySelectorAll(s).length;
  return {
    bodyTextLen: document.body.innerText.replace(/\\s+/g, '').length,
    heroFacts: q('.hero-facts .hero-fact'),
    feats: q('.feat'),
    steps: q('.steps .step'),
    datasetCard: q('.dataset-card'),
    evalMetricRows: q('.eval-metrics [data-metric]'),
    loginEmail: q('#login-email'),
    loginPassword: q('#login-password'),
    submitBtn: q('button[type="submit"]'),
    sidebar: q('aside'),
    header: q('header'),
    footer: q('[data-testid="site-footer"]'),
  };
})()`;

/** 主题签名：html.dark / --c1 令牌 / 图表 SVG 的 stroke+fill / 落盘值 */const THEME_PROBE = `(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const chart = document.querySelector('[data-testid="hero-chart"]');
  const svg = chart ? chart.querySelector('svg') : null;
  const strokes = svg ? [...svg.querySelectorAll('[stroke]')].map((e) => e.getAttribute('stroke')) : [];
  const fills = svg ? [...svg.querySelectorAll('[fill]')].map((e) => e.getAttribute('fill')) : [];
  const uniq = (a) => [...new Set(a.filter((x) => x && x !== 'none'))].sort();
  return {
    chartReady: !!svg,
    svgPathCount: svg ? svg.querySelectorAll('path').length : 0,
    dark: root.classList.contains('dark'),
    c1: cs.getPropertyValue('--c1').trim(),
    c2: cs.getPropertyValue('--c2').trim(),
    textColor: cs.getPropertyValue('--text').trim(),
    bg: cs.getPropertyValue('--bg').trim(),
    strokeSig: uniq(strokes).join(' | '),
    fillSig: uniq(fills).join(' | '),
    stored: localStorage.getItem('sp_theme'),
  };
})()`;

/* ---------------------------------------------------------------------- 主流程 */

const report = { pages: {}, theme: {}, metricCompare: [], checks: [] };
let failed = 0;

function assert(name, ok, detail = '') {
  report.checks.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
}

(async () => {
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
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      if (msg.params.type === 'error' || msg.params.type === 'warning') {
        const text = (msg.params.args || [])
          .map((a) => a.value ?? a.description ?? a.type)
          .join(' ');
        consoleErrors.push({ level: msg.params.type, text: String(text).slice(0, 300) });
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push({
        level: 'exception',
        text: String((d.exception && (d.exception.description || d.exception.value)) || d.text).slice(0, 300),
      });
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  async function goto(url, settle = 1600) {
    await cdp.send('Page.navigate', { url });
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      try {
        const st = await cdp.eval('document.readyState');
        if (st === 'complete') break;
      } catch {
        /* 导航中执行上下文被销毁，忽略 */
      }
      await sleep(250);
    }
    await sleep(settle);
  }

  async function shoot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const dir = path.join(OUT, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'app_screenshot.png'), Buffer.from(r.data, 'base64'));
    return `${name}/app_screenshot.png`;
  }

  const PAGES = [
    { name: 'home', url: `${APP}/`, template: 'D 营销页', auth: false },
    { name: 'login', url: `${APP}/login`, template: 'C 认证页', auth: false },
    { name: 'upload', url: `${APP}/upload`, template: 'B 主内容+右栏', auth: false },
    { name: 'dashboard', url: `${APP}/dashboard`, template: 'A 应用页（需登录）', auth: true },
  ];

  /** 每个模板的结构期望：防止「统一页脚」这一步顺手改坏布局 */
  const STRUCT_EXPECT = {
    home: [
      ['首屏 4 个事实数字', (s) => s.heroFacts === 4],
      ['核心能力 4 张特性卡', (s) => s.feats === 4],
      ['五步流程 5 个步骤', (s) => s.steps === 5],
      ['基准数据集卡存在', (s) => s.datasetCard === 1],
      ['硬指标披露条 4 项', (s) => s.evalMetricRows === 4],
    ],
    login: [
      ['EP-2 回归：登录表单三件套（邮箱/密码/提交）', (s) => s.loginEmail === 1 && s.loginPassword === 1 && s.submitBtn === 1],
    ],
    upload: [
      // 模板 B = AppShell 的侧栏 aside + 右侧元信息栏 aside，共 2 个
      ['模板 B：主内容 + 右侧信息栏（侧栏 2 个 aside）', (s) => s.sidebar === 2 && s.header === 1],
    ],
    // ⚠️ `EP-9` 校验链回归（脚本缺陷 `T-21`）：原判据 `header === 1` 已过时 ——
    //    `DashboardPage` 自 `EP-4` 起用语义化 `<header>` 承载页面标题区，
    //    与 `AppShell` 顶栏合计 **2 个**，属**合理结构**（已用截图复核骨架完好）。
    //    改为「侧栏恰好 1 个 + 存在顶栏」，并保留上界防止「整页被塞进 `<header>`」
    //    这类真正的结构破坏。`detail` 会输出全部计数，便于人工复核。
    dashboard: [
      ['模板 A：页头 + 侧栏', (s) => s.sidebar === 1 && s.header >= 1 && s.header <= 4],
    ],
  };

  // ---------- 先拿一个一次性账号的 Token（供 /dashboard 使用） ----------
  let token = null;
  await goto(`${APP}/login`, 800);
  const stamp = Date.now();
  const cred = { email: `ep3probe_${stamp}@example.cn`, password: 'Probe@2026abc' };
  const regResult = await cdp.eval(
    `(async () => {
      const base = '/api/v1';
      const body = { email: ${JSON.stringify(cred.email)}, password: ${JSON.stringify(
        cred.password,
      )}, nickname: 'EP3 探针' };
      const r1 = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j1 = await r1.json();
      const r2 = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: body.email, password: body.password }) });
      const j2 = await r2.json();
      return { register: j1.code, login: j2.code, token: j2.data ? j2.data.access_token : null };
    })()`,
    true,
  );
  token = regResult?.token ?? null;
  report.probeAccount = { email: cred.email, registerCode: regResult?.register, loginCode: regResult?.login, gotToken: !!token };
  assert('探针账号注册+登录成功（/dashboard 前置）', regResult?.register === 0 && !!token, JSON.stringify(report.probeAccount));

  // ---------- 逐页走查 ----------
  // ⚠️ 先清掉探针自己写入的 Token：`LoginPage` 对已登录用户会**按设计**
  //    重定向到工作台（`UX-P02`），带着 Token 去走查 `/login` 会看到工作台，
  //    从而把「登录表单不存在」误判成缺陷（本探针第一版就踩了这个坑）。
  await cdp.eval(`localStorage.removeItem('sp_token'); true`);

  for (const p of PAGES) {
    consoleErrors = [];
    if (p.auth) {
      if (token) await cdp.eval(`localStorage.setItem('sp_token', ${JSON.stringify(token)}); true`);
    } else {
      await cdp.eval(`localStorage.removeItem('sp_token'); true`);
    }
    await goto(p.url, p.name === 'home' ? 2600 : 1800);
    if (p.name === 'home') {
      // 等懒加载的图表挂上（Suspense 分包）
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        const ok = await cdp.eval(
          `!!document.querySelector('[data-testid="hero-chart"] svg')`,
        ).catch(() => false);
        if (ok) break;
        await sleep(300);
      }
      await sleep(800);
    }

    const dis = await cdp.eval(DISCLAIMER_PROBE);
    const struct = await cdp.eval(STRUCT_PROBE);
    const shot = await shoot(p.name);
    report.pages[p.name] = {
      url: p.url,
      template: p.template,
      disclaimer: dis,
      struct,
      screenshot: shot,
      consoleErrors: [...consoleErrors],
    };

    assert(`[${p.name}] 免责声明存在`, dis.found === true, dis.found ? 'ok' : '未找到 .disclaimer');
    if (dis.found) {
      assert(`[${p.name}] 免责声明可见`, dis.display !== 'none' && dis.visibility !== 'hidden' && dis.offsetHeight > 0,
        `display=${dis.display} visibility=${dis.visibility} h=${dis.offsetHeight}`);
      assert(`[${p.name}] 🔒 未被折叠/截断`, dis.scrollHeight <= dis.clientHeight + 1 && dis.detailsCount === 0,
        `scrollH=${dis.scrollHeight} clientH=${dis.clientHeight} details=${dis.detailsCount}`);
      assert(`[${p.name}] 文案完整（3 个关键句）`, dis.keys.every((k) => k.hit), JSON.stringify(dis.keys));
    }
    for (const [label, fn] of STRUCT_EXPECT[p.name] ?? []) {
      assert(`[${p.name}] ${label}`, fn(struct), JSON.stringify(struct));
    }
    assert(`[${p.name}] 页面非空白（正文 ≥ 60 字）`, struct.bodyTextLen >= 60, `bodyTextLen=${struct.bodyTextLen}`);
    assert(`[${p.name}] consoleErrors 为空`, consoleErrors.length === 0,
      consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 3)) : '无 error/warning/exception');
  }

  // ---------- 首页：硬指标与 eval_report.json 逐项比对 ----------
  consoleErrors = [];
  await goto(`${APP}/`, 2600);
  const metrics = await cdp.eval(METRICS_PROBE);
  report.metricsProbe = metrics;
  assert('首页存在 .eval-metrics 披露条', metrics.found === true);
  if (metrics.found) {
    const evalObj = JSON.parse(fs.readFileSync(EVAL_JSON, 'utf8'));
    const expected = evalObj.verdict.checks;
    assert(
      '披露条声明的数据源为 outputs/eval_report.json',
      metrics.source === 'outputs/eval_report.json',
      String(metrics.source),
    );
    assert('披露条项数 = 评测报告判定项数', metrics.rows.length === expected.length,
      `DOM ${metrics.rows.length} vs JSON ${expected.length}`);
    expected.forEach((c, i) => {
      const row = metrics.rows[i];
      const want = c.value.toFixed(2);
      const ok = !!row && row.value === want && row.limit === String(c.limit);
      report.metricCompare.push({ index: i, jsonValue: want, jsonLimit: c.limit, dom: row ?? null, match: ok });
      assert(`🔒 硬指标[${i}] ${row ? row.key : '?'} 与 JSON 一致`, ok,
        ok ? `${want}%（限额 ${c.limit}）` : `JSON ${want}/${c.limit} ≠ DOM ${row ? `${row.value}/${row.limit}` : 'null'}`);
    });

    // 首屏「实测」小字也必须同源
    const m = evalObj.metrics;
    const heroWant = [m.weighted_mape.toFixed(2), m.mae_improve_pct.toFixed(2), (evalObj.timing_ms.total_ms / 1000).toFixed(1)];
    const heroGot = metrics.hero.filter((h) => ['1', '2', '3'].includes(h.index)).map((h) => h.text.replace('%', '').replace(' 秒', ''));
    assert('首屏 3 个「实测」小字与 JSON 同源', JSON.stringify(heroGot) === JSON.stringify(heroWant),
      `DOM ${JSON.stringify(heroGot)} vs JSON ${JSON.stringify(heroWant)}`);
  }

  // ---------- 首页：主题切换 → 图表颜色变化 ----------
  const before = await cdp.eval(THEME_PROBE);
  await cdp.eval(`(() => { const b = document.querySelector('[data-testid="theme-toggle"]'); if (!b) return false; b.click(); return true; })()`);
  await sleep(1200);
  const after = await cdp.eval(THEME_PROBE);
  report.theme = { before, after };

  assert('图表已渲染（SVG 有 path）', before.chartReady && before.svgPathCount > 0, `paths=${before.svgPathCount}`);
  assert('主题切换后 html.dark 翻转', before.dark !== after.dark, `${before.dark} → ${after.dark}`);
  assert('🔒 主题切换后 --c1 令牌变化', before.c1 !== after.c1, `${before.c1} → ${after.c1}`);
  assert('🔒 主题切换后图表 stroke 颜色变化', before.strokeSig !== after.strokeSig,
    `${before.strokeSig.slice(0, 70)} → ${after.strokeSig.slice(0, 70)}`);
  assert('主题选择已持久化到 localStorage', before.stored !== after.stored, `${before.stored} → ${after.stored}`);

  // 浅色态截图留证
  report.pages['home-light'] = { screenshot: await shoot('home-light'), consoleErrors: [...consoleErrors] };
  assert('[home] 主题切换前后 consoleErrors 为空', consoleErrors.length === 0,
    consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 3)) : '无 error/warning/exception');

  // 复位主题，避免影响后续人工查看
  await cdp.eval(`localStorage.setItem('sp_theme','dark'); document.documentElement.classList.add('dark'); true`);

  ws.close();
})()
  .catch((e) => {
    report.error = String(e && e.stack ? e.stack : e);
    failed += 1;
  })
  .finally(async () => {
    try {
      edge.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    report.summary = { total: report.checks.length, failed, passed: report.checks.length - failed };
    fs.writeFileSync(path.join(OUT, 'browser_probe_summary.json'), JSON.stringify(report, null, 2));
    console.log(`浏览器校验：通过 ${report.summary.passed} 项，失败 ${report.summary.failed} 项`);
    for (const c of report.checks) {
      if (!c.ok) console.log(`  [FAIL] ${c.name} —— ${c.detail}`);
    }
    console.log(`报告：${path.join(OUT, 'browser_probe_summary.json')}`);
    await sleep(300);
    process.exit(failed ? 1 : 0);
  });
