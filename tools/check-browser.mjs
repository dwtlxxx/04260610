/**
 * check-browser.mjs —— 真实浏览器端到端冒烟测试（无头 Edge + CDP）
 *
 * 为什么需要它：有些缺陷只在真实浏览器里才现形，本地 DOM 桩测不出来。
 * 典型就是刚修掉的那个收藏 bug —— 数据里的 id 是数字 1、DOM 读出来是字符串 "1"，
 * 存储层自己跟自己比当然通过，但页面上星标不亮、"我的日程"永远为空。
 * 桩测试当时断言的是 store.isFavorite('1')，属于"自己验证自己"。
 *
 * 所以这里用真浏览器走一遍用户路径，并断言【界面上看得见的结果】：
 *   1. 点卡片上的收藏 → 卡片文案变为「已收藏」
 *   2. 切到「我的」→ 我的日程计数为 1，且列表里确实有那一条
 *   3. 刷新页面（重新打开）→ 仍然是 1（对应题目"重要操作结果要保留"）
 *   4. 取消收藏 → 回到 0
 *   5. 搜索 ymq → 命中羽毛球约球（拼音/首字母链路在真实浏览器可用）
 *   6. 点卡片 → 详情弹层打开；关闭 → 弹层消失且页面滚动锁被解除
 *
 * 用法：
 *   node tools/serve.cjs "<仓库绝对路径>" 8123     # 先起服务器
 *   node tools/check-browser.mjs
 *   node tools/check-browser.mjs --url http://127.0.0.1:8123/ --width 375
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const argv = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const URL_ = getArg('--url', 'http://127.0.0.1:8123/');
const WIDTH = Number(getArg('--width', '375'));
const PORT = 9335;

const browser = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browser) { console.error('未找到 Edge / Chrome'); process.exit(2); }

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

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
}

const userDir = `${process.env.TEMP}\\dsh-cdp-e2e`;
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: 812, deviceScaleFactor: 1, mobile: true,
  });

  /** 在页面里求值并取回结果；异常会被抛成可见错误，避免"静默通过" */
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text || '页面内求值失败');
    return result.value;
  };

  const load = async (fresh = false) => {
    if (fresh) {
      await cdp.send('Page.navigate', { url: 'about:blank' });
      await sleep(200);
    }
    await cdp.send('Page.navigate', { url: URL_ });
    await sleep(1300);
  };

  console.log(`地址：${URL_}　视口：${WIDTH}px\n`);
  console.log('=== 1. 启动 ===');
  await load(true);
  ok('页面已渲染（未停在加载态）',
    await evaluate(`return document.querySelector('.card') !== null && !/正在加载/.test(document.body.innerText);`));

  console.log('');
  console.log('=== 2. 收藏 → 我的日程（用户报告的缺陷）===');
  const firstTitle = await evaluate(`return document.querySelector('.card .card-title').textContent.trim();`);
  await evaluate(`return document.querySelector('.card [data-action="toggle-fav"]').click() || true;`);
  await sleep(400);
  ok('卡片文案变为「已收藏」',
    await evaluate(`return /已收藏/.test(document.querySelector('.card [data-action="toggle-fav"]').textContent);`));
  ok('本地存储里确实写入了收藏', await evaluate(`return JSON.parse(localStorage.getItem('zhku-opportunity:favorites') || '[]').length === 1;`));

  await evaluate(`return document.querySelector('.bottomnav [data-action="nav"][data-route="mine"]').click() || true;`);
  await sleep(400);
  const mineCount = await evaluate(`
    const t = document.querySelector('.section-title');
    return t ? t.textContent : '';`);
  ok('「我的」页的日程计数为 1 条', /1\s*条/.test(mineCount), JSON.stringify(mineCount));
  ok('日程列表里确实是刚收藏的那条',
    await evaluate(`return document.body.innerText.includes(${JSON.stringify(firstTitle)});`), firstTitle);
  ok('没有出现"还没有收藏"的空状态', !(await evaluate(`return /还没有收藏/.test(document.body.innerText);`)));

  console.log('');
  console.log('=== 3. 刷新后仍然保留（题目要求：重要操作结果要保留）===');
  await load(true);
  await evaluate(`return document.querySelector('.bottomnav [data-action="nav"][data-route="mine"]').click() || true;`);
  await sleep(400);
  ok('重新打开后日程仍是 1 条',
    /1\s*条/.test(await evaluate(`const t = document.querySelector('.section-title'); return t ? t.textContent : '';`)));

  console.log('');
  console.log('=== 4. 取消收藏 ===');
  await evaluate(`return document.querySelector('.bottomnav [data-action="nav"][data-route="feed"]').click() || true;`);
  await sleep(300);
  await evaluate(`return document.querySelector('.card [data-action="toggle-fav"]').click() || true;`);
  await sleep(400);
  ok('取消后卡片文案回到「收藏」',
    await evaluate(`return !/已收藏/.test(document.querySelector('.card [data-action="toggle-fav"]').textContent);`));
  ok('本地存储已清空收藏',
    await evaluate(`return JSON.parse(localStorage.getItem('zhku-opportunity:favorites') || '[]').length === 0;`));

  console.log('');
  console.log('=== 5. 搜索在真实浏览器里可用（拼音/首字母链路）===');
  await evaluate(`
    const i = document.getElementById('search-input');
    i.value = 'ymq';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;`);
  await sleep(600);
  const found = await evaluate(`return document.body.innerText.includes('羽毛球');`);
  ok('搜索 ymq 命中「周末羽毛球约球」', found);
  ok('结果区给出搜索理解说明',
    await evaluate(`return /拼音|首字母/.test(document.body.innerText);`));
  // 清空搜索，避免影响后续
  await evaluate(`
    const i = document.getElementById('search-input');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;`);
  await sleep(500);

  console.log('');
  console.log('=== 6. 详情弹层（容器变换动画的落点）===');
  await evaluate(`return document.querySelector('.card').click() || true;`);
  await sleep(700);
  ok('详情弹层已打开', await evaluate(`return !!document.querySelector('.modal');`));
  ok('页面滚动被锁定（防止弹层背后滚动）',
    await evaluate(`return document.body.style.overflow === 'hidden';`));
  ok('面板的 transform-origin 在动画结束后已还原（不残留内联样式）',
    await evaluate(`
      const m = document.querySelector('.modal');
      return !m.style.transformOrigin || m.style.transformOrigin === '';`));
  await evaluate(`return document.querySelector('.modal [data-action="close-modal"]').click() || true;`);
  await sleep(800);
  ok('关闭后弹层被移除', await evaluate(`return !document.querySelector('.modal-host .modal');`));
  ok('关闭后滚动锁已解除', await evaluate(`return document.body.style.overflow !== 'hidden';`));

  console.log('');
  console.log('=== 7. 左侧栏：鼠标移到左边缘自动滑出（电脑端）===');
  /* 这一段只能在真浏览器里测：展开完全由 CSS 的
     `.sidebar-hotzone:hover ~ .sidebar` 驱动，DOM 桩没有样式引擎。
     用 CDP 派发真实的 mouseMoved，浏览器才会真正套用 :hover。 */
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await load(true);

  /** 侧栏当前状态：位移、不透明度、右边界（判断是否真的滑出来了） */
  const sidebarState = () => evaluate(`
    const s = document.querySelector('.sidebar');
    if (!s) return null;
    const cs = getComputedStyle(s);
    const r = s.getBoundingClientRect();
    return { opacity: Number(cs.opacity), transform: cs.transform,
      right: Math.round(r.right), left: Math.round(r.left), width: Math.round(r.width),
      pointerEvents: cs.pointerEvents };`);

  const moveMouse = (x, y) => cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, button: 'none', clickCount: 0,
  });

  ok('顶栏右上角的侧栏开关按钮已移除',
    await evaluate(`return !document.querySelector('.sidebar-toggle') && !document.querySelector('[data-action="toggle-sidebar"]');`));
  ok('存在左边缘感应热区', await evaluate(`return !!document.querySelector('.sidebar-hotzone');`));

  const idle = await sidebarState();
  ok('默认收起（滑出屏幕外、且不吃鼠标事件）',
    !!idle && idle.opacity === 0 && idle.right <= 0 && idle.pointerEvents === 'none',
    idle ? `opacity=${idle.opacity} right=${idle.right} pointer-events=${idle.pointerEvents}` : '侧栏不存在');

  await moveMouse(6, 400);              // 鼠标移到最左边缘
  await sleep(500);                     // 等 260ms 过渡结束
  const hovered = await sidebarState();
  ok('鼠标移到左边缘后侧栏滑出',
    !!hovered && hovered.opacity === 1 && hovered.right > 100,
    hovered ? `opacity=${hovered.opacity} right=${hovered.right} 宽度=${hovered.width}` : '侧栏不存在');
  ok('滑出后可以正常点击（恢复鼠标事件）',
    !!hovered && hovered.pointerEvents === 'auto', hovered ? hovered.pointerEvents : '');
  /* 侧栏贴齐屏幕左边缘（而不是对齐居中的内容区）：
     它是"鼠标扫到左边缘就滑出"的，若在超宽屏上被推到内容左边缘，
     指针停在 x=6 时面板却出现在 260px 之外，反而更别扭。
     这条同时保证收起时能完全移出屏幕（right 必须为 0）。 */
  ok('滑出的侧栏贴齐屏幕左边缘（鼠标停在哪就从哪滑出）',
    await evaluate(`
      const sb = document.querySelector('.sidebar').getBoundingClientRect();
      return Math.abs(sb.left) <= 1;`));

  await moveMouse(120, 400);            // 从热区移到侧栏本体上
  await sleep(400);
  const onSidebar = await sidebarState();
  ok('鼠标从热区移到侧栏上不会闪回（两个 hover 条件有重叠）',
    !!onSidebar && onSidebar.right > 100 && onSidebar.opacity === 1,
    onSidebar ? `right=${onSidebar.right} opacity=${onSidebar.opacity}` : '');

  await moveMouse(900, 500);            // 移开
  await sleep(600);
  const away = await sidebarState();
  ok('鼠标移开后侧栏自动收回',
    !!away && away.right <= 0 && away.opacity === 0,
    away ? `right=${away.right} opacity=${away.opacity}` : '');

  /* 键盘可达性：只用鼠标的话，Tab 进侧栏会把焦点落在屏幕外，
     所以 :focus-within 也必须能展开。 */
  await evaluate(`
    const a = document.querySelector('.sidebar a, .sidebar button, .sidebar input');
    if (a) { a.focus(); return true; }
    return false;`);
  await sleep(500);
  const focused = await sidebarState();
  ok('键盘焦点进入侧栏时同样展开（焦点不会落在屏幕外）',
    !!focused && focused.right > 100 && focused.opacity === 1,
    focused ? `right=${focused.right} opacity=${focused.opacity}` : '');

  console.log('');
  console.log(`结论：通过 ${pass} 项，失败 ${fail} 项`);
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
}
process.exit(fail ? 1 : 0);
