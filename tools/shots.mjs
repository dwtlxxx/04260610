/**
 * shots.mjs —— 真实截图（无头 Edge + CDP 设备模拟）
 *
 * 为什么不用 `msedge --window-size=320 --screenshot`：
 *   Windows 对真实窗口有最小宽度限制，--window-size 设 320 时窗口并不会真的变成
 *   320 CSS px，结果页面按更宽的视口排版、截图却只裁了左边 320px ——
 *   看起来像"内容被切掉/错位"，其实是截图工具的假象（我一开始就被它骗过）。
 *   正确做法是用 CDP 的 Emulation.setDeviceMetricsOverride 精确指定视口。
 *
 * 用法：
 *   node tools/shots.mjs                       # 按内置宽度清单截图
 *   node tools/shots.mjs 320 375 768 1440      # 指定宽度
 *   node tools/shots.mjs --anim 375            # 慢放并逐帧截取"卡片展开"动画
 *
 * 前置：node tools/serve.cjs "<仓库绝对路径>" 8123
 * 输出：%TEMP%\dsh-shots\ 下的 PNG（每个宽度一张；--anim 时是动画帧序列）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const argv = process.argv.slice(2);
const animMode = argv.includes('--anim');
const urlIdx = argv.indexOf('--url');
const URL_ = urlIdx >= 0 ? argv[urlIdx + 1] : 'http://127.0.0.1:8123/';
const widths = argv.filter((a) => /^\d+$/.test(a)).map(Number);
const WIDTHS = widths.length ? widths : [320, 375, 414, 768, 1024, 1440, 1920];
const OUT = `${process.env.TEMP}\\dsh-shots`;
const PORT = 9334;

const browser = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browser) { console.error('未找到 Edge / Chrome'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')); } }, 30000);
    });
  }
}

const userDir = `${process.env.TEMP}\\dsh-cdp-shots`;
mkdirSync(userDir, { recursive: true });
const proc = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, 'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  let ready = null;
  for (let i = 0; i < 60 && !ready; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) ready = await r.json(); } catch { /* 等待 */ }
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error('调试端口未就绪');
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  /* ⚠ 必须禁用缓存：GitHub Pages 会带 Cache-Control 缓存静态文件，
     而调试用的浏览器 profile 是复用的 —— 不清缓存就可能拿旧版 app.js/ui.js 跑测试，
     得出与线上当前版本无关的结论（实测踩到：线上收起动画"看起来"没生效，
     其实是浏览器在用十分钟前的旧构建）。 */
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  /* ⚠ 无头浏览器默认 prefers-reduced-motion: reduce，而本产品所有动画都尊重该偏好
     （开启时直接不播）。不显式覆盖，截出来的"动画帧"全是静止稳态，
     等于只在验证"减少动效"分支 —— 我一开始就被这点骗过，以为动画没生效。
     这里强制 no-preference，看到的才是真实用户的动画。 */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });

  const shoot = async (file) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}\\${file}`, Buffer.from(data, 'base64'));
    return `${OUT}\\${file}`;
  };

  if (animMode) {
    /* 动画逐帧：把动画播放速度放慢 10 倍，就能在真实渲染下看清"面板从卡片长出来"的过程。 */
    const w = WIDTHS[0] || 375;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 812, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.navigate', { url: URL_ });
    await sleep(1500);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });

    const before = await shoot(`anim-${w}-0-before.png`);
    console.log('截图：' + before);
    // 点第 1 张卡片（手机端信息流没有 .feed-grid 包裹层，直接用 .card）
    const clicked = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const c = document.querySelector('.card');
        if (!c) return null;
        c.scrollIntoView({ block: 'center' });   // 让卡片进入视野，动画才能拍全
        const r = c.getBoundingClientRect();
        return Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
      })()`,
      returnByValue: true,
    });
    console.log('被点卡片矩形：' + clicked.result.value);
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.card').click()` });
    for (const [i, wait] of [[1, 350], [2, 350], [3, 500], [4, 800], [5, 1600]]) {
      await sleep(wait);
      const f = await shoot(`anim-${w}-${i}.png`);
      console.log('截图：' + f);
    }
    // 关闭动画
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.modal [data-action="close-modal"]').click()` });
    for (const [i, wait] of [[1, 400], [2, 600], [3, 1200]]) {
      await sleep(wait);
      const f = await shoot(`anim-${w}-close-${i}.png`);
      console.log('截图：' + f);
    }
  } else {
    for (const w of WIDTHS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: w < 768 ? 812 : 900, deviceScaleFactor: 1, mobile: w < 768,
      });
      await cdp.send('Page.navigate', { url: URL_ });
      await sleep(1200);
      const f = await shoot(`w${w}.png`);
      console.log('截图：' + f);
    }
  }
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
}
