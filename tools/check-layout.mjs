/**
 * check-layout.mjs —— 真实布局检测（无头 Edge + Chrome DevTools Protocol）
 *
 * 为什么需要它：本地那些自检脚本只能验证"结构对不对"（标签配平、类名、id、
 * 交互是否生效），**没法治布局问题**。而"某个元素错位 / 横向溢出"恰恰是
 * 渲染审查查不出来的：HTML 完全正确，只是宽度算错了。
 *
 * 这个脚本直接驱动无头 Edge，按多个宽度真实排版，然后：
 *   1. 报告整页是否横向溢出（scrollWidth > clientWidth）
 *   2. 逐个列出"右边界超出视口 / 左边界跑到视口外"的元素及其选择器
 *   3. 报告固定定位元素的横向范围是否与视口一致
 *
 * 用法：
 *   node tools/check-layout.mjs                     # 用内置宽度清单
 *   node tools/check-layout.mjs 375 768 1024        # 指定宽度
 *   node tools/check-layout.mjs --url http://127.0.0.1:8123/
 *
 * 前置：需要本地静态服务器（node tools/serve.cjs "<仓库绝对路径>" 8123）
 * 退出码：0 = 无溢出；1 = 发现溢出（可直接接进 CI）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const URL_ = urlIdx >= 0 ? argv[urlIdx + 1] : 'http://127.0.0.1:8123/';
const widths = argv.filter((a) => /^\d+$/.test(a)).map(Number);
const WIDTHS = widths.length ? widths : [320, 360, 375, 414, 480, 768, 1024, 1280, 1440, 1920];
const PORT = 9333;

const browser = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('未找到 Edge / Chrome，无法进行布局检测');
  process.exit(2);
}

/* ---------- CDP 最小客户端（Node 22 自带 WebSocket，无需依赖） ---------- */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} 超时`)); }
      }, 20000);
    });
  }
}

async function waitForEndpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('调试端口未就绪');
}

/** 生成一个便于定位的选择器（取 tag + 关键类名 + 第几个子元素） */
const PATH_FN = `
function pathOf(el) {
  const parts = [];
  let node = el;
  for (let i = 0; i < 4 && node && node.nodeType === 1; i++) {
    let s = node.tagName.toLowerCase();
    const cls = (node.className && typeof node.className === 'string')
      ? node.className.split(/\\s+/).filter(Boolean).slice(0, 2) : [];
    if (cls.length) s += '.' + cls.join('.');
    const parent = node.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === node.tagName);
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
    }
    parts.unshift(s);
    node = node.parentElement;
  }
  return parts.join(' > ');
}`;

const PROBE_FN = `
(() => {
  const vw = document.documentElement.clientWidth;
  const isScrollBox = (cs) => ['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX);

  /** 该元素是否位于某个"横向可滚动/已裁剪"的容器里 —— 那种越界是刻意设计 */
  const insideScrollBox = (el) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      if (isScrollBox(getComputedStyle(n))) return true;
      n = n.parentElement;
    }
    return false;
  };

  const over = [];      // 真正不该越界的元素
  const strip = [];     // 横向滚动条内的元素（设计如此，仅统计数量）
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (cs.position === 'fixed') continue;
    if (r.right > vw + 1 || r.left < -1) {
      const item = { sel: pathOf(el), left: Math.round(r.left), right: Math.round(r.right),
        width: Math.round(r.width), over: Math.round(Math.max(r.right - vw, -r.left)) };
      if (insideScrollBox(el)) strip.push(item); else over.push(item);
    }
  }

  /* 真正的溢出源：自身内容比自身盒子宽、且自己没有裁剪行为的元素。
     这类元素会把祖先的滚动区域撑大，进而让整页出现横向滚动。 */
  const hosts = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    if (isScrollBox(cs)) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      hosts.push({ sel: pathOf(el), scrollW: el.scrollWidth, clientW: el.clientWidth,
        diff: el.scrollWidth - el.clientWidth, overflowX: cs.overflowX });
    }
  }

  const fixed = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1) continue;
    fixed.push({ sel: pathOf(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
  }

  return JSON.stringify({
    vw,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    overflowX: Math.max(0, document.documentElement.scrollWidth - vw),
    items: over.slice(0, 30),
    total: over.length,
    stripCount: strip.length,
    stripSample: strip.slice(0, 3),
    hosts: hosts.slice(0, 20),
    hostCount: hosts.length,
    fixed,
  });
})()`;

let pass = 0;
let fail = 0;
const note = (ok, name, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
};

/* ---------- 启动浏览器 ---------- */
const userDir = `${process.env.TEMP}\\dsh-cdp-profile`;
mkdirSync(userDir, { recursive: true });
const proc = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  await waitForEndpoint();
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await created.json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  /* ⚠ 必须禁用缓存：GitHub Pages 会带 Cache-Control 缓存静态文件，
     而调试用的浏览器 profile 是复用的 —— 不清缓存就可能拿旧版 app.js/ui.js 跑测试，
     得出与线上当前版本无关的结论（实测踩到：线上收起动画"看起来"没生效，
     其实是浏览器在用十分钟前的旧构建）。 */
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  console.log(`检测地址：${URL_}`);
  console.log(`检测宽度：${WIDTHS.join(', ')}px\n`);

  const report = [];
  for (const w of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768,
    });
    await cdp.send('Page.navigate', { url: URL_ });
    await sleep(1200);                       // 等应用渲染 + 断点重算完成
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `${PATH_FN}\n${PROBE_FN}`, returnByValue: true,
    });
    const data = JSON.parse(result.value);
    report.push({ w, ...data });

    console.log(`=== ${w}px ===`);
    note(data.overflowX === 0, '整页无横向溢出',
      `scrollWidth=${data.docScrollW} clientWidth=${data.vw} 超出=${data.overflowX}px`);
    note(data.total === 0, '没有元素越出视口',
      data.total
        ? `${data.total} 个元素越界`
        : (data.stripCount ? `（另有 ${data.stripCount} 个元素在横向滚动条内，属设计如此）` : ''));
    for (const it of data.items.slice(0, 6)) {
      console.log(`      · ${it.sel}`);
      console.log(`        left=${it.left} right=${it.right} width=${it.width} 超出=${it.over}px`);
    }
    // 真正的溢出源：自身内容撑破自身盒子、且没有裁剪行为的元素
    if (data.hostCount) {
      console.log(`      ⚠ 溢出源（内容比盒子宽且未裁剪）${data.hostCount} 个：`);
      for (const h of data.hosts.slice(0, 6)) {
        console.log(`        · ${h.sel}  scrollWidth=${h.scrollW} clientWidth=${h.clientW} 超出=${h.diff}px`);
      }
    }
    for (const f of data.fixed) {
      if (f.left < -1 || f.right > data.vw + 1) {
        console.log(`      · [fixed] ${f.sel} left=${f.left} right=${f.right} width=${f.width}（视口 ${data.vw}）`);
      }
    }
    console.log('');
  }

  const bad = report.filter((r) => r.overflowX > 0 || r.total > 0);
  console.log('=== 汇总 ===');
  if (!bad.length) console.log('  所有宽度均无横向溢出、无元素越界 ✓');
  else for (const b of bad) {
    console.log(`  ${b.w}px：整页溢出 ${b.overflowX}px，越界元素 ${b.total} 个`);
  }
  const outFile = `${process.env.TEMP}\\dsh-layout-report.json`;
  writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n完整报告：${outFile}`);
  console.log(`结论：${fail === 0 ? '布局检测通过' : `发现 ${fail} 处问题`}（通过 ${pass} 项）`);
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
}
process.exit(fail ? 1 : 0);
