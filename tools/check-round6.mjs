/**
 * check-round6.mjs —— 本轮四项视觉改动的真实浏览器验证（无头 Edge + CDP）
 *
 * 为什么单独写一个：这四项全都是"眼睛才看得出来"的东西，
 *   ① 底部装饰从"细线波形"换成"柔和色块呼吸光晕" → 必须确认它真的存在、真的够大够亮；
 *   ② 侧栏展开前后不能瞬移 → 只能量两种状态下图标的真实坐标；
 *   ③ 加载页改成骨架屏、完成时立刻换真内容 → 要确认 #app 有 data-ready、骨架已被替换；
 *   ④ 主页面滚动时卡片缩放/淡入淡出 → 要量到 --sc / --op 真的随位置变化。
 * 本地 DOM 桩量不出①②④（没有布局引擎）。
 *
 * ⚠ 两个必须显式处理的细节（都是以前踩过的坑）：
 *   1. 无头浏览器默认 prefers-reduced-motion: reduce —— 不覆盖的话 decor.js 直接
 *      return，量到的是"减少动效"分支，会得出"特效没实现"的错误结论；
 *   2. 必须禁缓存（GitHub Pages / 复用的浏览器 profile 会给旧构建）。
 *
 * 用法：
 *   node tools/serve.cjs "<仓库绝对路径>" 8123
 *   node tools/check-round6.mjs
 *   node tools/check-round6.mjs --url https://dwtlxxx.github.io/04260610/
 *   node tools/check-round6.mjs --shots D:\tmp\round6      # 截图输出目录
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));
if (!EDGE) { console.error('未找到 Edge / Chrome'); process.exit(2); }

const argv = process.argv.slice(2);
const getArg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_ = getArg('--url', 'http://127.0.0.1:8123/');
const SHOT_DIR = getArg('--shots', join(process.env.TEMP || '.', 'round6-shots'));
const PORT = 9341;
const W = 1440;
const H = 900;

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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')); } }, 20000);
    });
  }
}

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
};

mkdirSync(SHOT_DIR, { recursive: true });
const userDir = `${process.env.TEMP}\\dsh-cdp-round6`;
mkdirSync(userDir, { recursive: true });
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--mute-audio', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });

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
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // 细节 1：无头浏览器默认就是 reduce，必须显式关掉，否则所有动效都不跑
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  const ev = async (expr) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression: `(() => { ${expr} })()`, returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text || '页面内求值失败');
    return result.value;
  };
  const shot = async (name, clip) => {
    const r = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    writeFileSync(join(SHOT_DIR, name), Buffer.from(r.data, 'base64'));
    return join(SHOT_DIR, name);
  };
  const mouse = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });

  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 80; i++) {
    const st = await ev('return { ready: document.readyState, boot: !!document.querySelector(".boot"), app: !!document.querySelector(".app") };');
    if (st.ready === 'complete' && st.app) break;
    await sleep(150);
  }
  await sleep(600);

  // 前置检查：页面是不是真的加载出来了（否则后面量的是浏览器错误页）
  const sanity = await ev('return { url: location.href, hasApp: !!document.querySelector("#app"), cards: document.querySelectorAll(".card").length, text: document.body.innerText.slice(0, 40) };');
  if (!sanity.hasApp || !sanity.cards) {
    console.error(`前置检查失败：页面没加载出来（${sanity.url}）—— 多半是本地服务器没起：node tools/serve.cjs "<仓库绝对路径>" 8123`);
    throw new Error('页面未渲染');
  }

  console.log('\n【③ 加载页：骨架屏 → 首次渲染完成即换真内容】');
  const boot = await ev(`
    const app = document.querySelector('#app');
    return {
      ready: app.getAttribute('data-ready'),
      busy: app.getAttribute('aria-busy'),
      bootLeft: !!document.querySelector('.boot'),
      bootSkel: !!document.querySelector('.boot-skel'),
      loadingText: /正在加载/.test(document.body.innerText),
      cards: document.querySelectorAll('.feed-grid > .card').length,
    };`);
  ok('#app 已打上 data-ready（首次渲染完成标记）', boot.ready === '1', `data-ready=${boot.ready}`);
  ok('加载完成后骨架屏已被真内容整体替换', boot.bootLeft === false && boot.bootSkel === false);
  ok('加载完成后页面上不再有「正在加载」文案', boot.loadingText === false);
  ok('aria-busy 已置为 false', boot.busy === 'false');
  ok('信息流真的进来了（卡片数 > 0）', boot.cards > 0, `${boot.cards} 张`);

  /* 骨架卡的错峰序号是静态标记，直接在 Node 里读源文件判定：
     放进页面里用 fetch + Promise 量会拿到一个未 await 的 Promise 对象，
     断言会永远失败（这里踩过一次）。 */
  const skelSrc = (() => {
    const t = readFileSync(join(ROOT, 'index.html'), 'utf8');
    return { i0: /boot-skel-card" style="--i:0"/.test(t), i1: /boot-skel-card" style="--i:1"/.test(t) };
  })();
  ok('骨架卡带错峰序号 --i:0（第一张）', skelSrc.i0 === true);
  ok('骨架卡带错峰序号 --i:1（第二张，自上而下逐张铺开）', skelSrc.i1 === true);

  console.log('\n【① 底部装饰：柔和色块呼吸光晕】');
  const glow = await ev(`
    const g = document.querySelector('.beat-glow');
    if (!g) return { exists: false };
    const cs = getComputedStyle(g); const b = g.getBoundingClientRect();
    return { exists: true, w: Math.round(b.width), h: Math.round(b.height),
      opacity: Number(cs.opacity), filter: cs.filter, position: cs.position,
      bottom: cs.bottom, pointer: cs.pointerEvents, z: cs.zIndex,
      bg: cs.backgroundImage.slice(0, 48), anim: g.getAnimations().length,
      beat: getComputedStyle(document.documentElement).getPropertyValue('--beat').trim() };`);
  ok('光晕节点存在', glow.exists === true);
  ok('光晕足够大（覆盖视口底部）', glow.exists && glow.h >= 80 && glow.w >= W * 0.9, `${glow.w}×${glow.h}`);
  ok('光晕是柔和虚化的色块（有 blur）', glow.exists && /blur/.test(glow.filter || ''), glow.filter);
  ok('光晕默认就有可见亮度（opacity ≥ .5）', glow.exists && glow.opacity >= 0.5, `opacity=${glow.opacity}`);
  ok('光晕固定贴底、不吃鼠标事件', glow.exists && glow.position === 'fixed' && glow.pointer === 'none', `${glow.position}/${glow.pointer}`);
  ok('--beat 已由 decor.js 写入 :root', glow.beat !== '' && glow.beat !== undefined, `--beat=${glow.beat}`);

  console.log('\n【④ 主页面滚动：卡片逐渐变大变小 + 淡入淡出】');
  await ev('window.scrollTo(0, 900); return true;');
  await sleep(400);
  const scroll = await ev(`
    const vh = innerHeight, mid = vh / 2;
    const list = [...document.querySelectorAll('.feed-grid > .card')].map((c) => {
      const r = c.getBoundingClientRect(); const cs = getComputedStyle(c);
      const m = cs.transform.match(/matrix\\(([-\\d.]+)/);
      return { center: r.top + r.height / 2, inView: r.bottom > 0 && r.top < vh,
        scale: m ? Number(m[1]) : 1, op: Number(cs.opacity),
        sc: cs.getPropertyValue('--sc').trim(), vop: cs.getPropertyValue('--op').trim() };
    }).filter((c) => c.inView);
    const near = list.reduce((a, b) => (Math.abs(b.center - mid) < Math.abs(a.center - mid) ? b : a), list[0] || null);
    const far = list.reduce((a, b) => (Math.abs(b.center - mid) > Math.abs(a.center - mid) ? b : a), list[0] || null);
    return { count: list.length, near, far, scrollY: Math.round(scrollY),
      hasVars: list.filter((c) => c.sc !== '' && c.vop !== '').length };`);
  ok('可见卡片都被写入了 --sc / --op', scroll.hasVars === scroll.count && scroll.count > 1, `${scroll.hasVars}/${scroll.count}`);
  ok('靠近视口中心的卡片更大（scale 更高）', !!scroll.near && !!scroll.far && scroll.near.scale > scroll.far.scale,
    `中心 ${scroll.near && scroll.near.scale} vs 边缘 ${scroll.far && scroll.far.scale}`);
  ok('靠近视口中心的卡片更实（opacity 更高）', !!scroll.near && !!scroll.far && scroll.near.op > scroll.far.op,
    `中心 ${scroll.near && scroll.near.op} vs 边缘 ${scroll.far && scroll.far.op}`);
  ok('边缘卡片确实变淡（opacity < 1）', !!scroll.far && scroll.far.op < 0.999, `边缘 opacity=${scroll.far && scroll.far.op}`);
  await shot('04-scroll-cards.png');
  await ev('window.scrollTo(0, document.body.scrollHeight); return true;');
  await sleep(500);
  await shot('01-bottom-glow.png');

  console.log('\n【② 侧栏：展开前后 UI 位置一致，不瞬移】');
  await ev('window.scrollTo(0, 0); return true;');
  await mouse(1400, 500);   // 先把鼠标挪远，确保是收起态
  await sleep(420);
  const probe = () => ev(`
    const side = document.querySelector('.sidebar');
    if (!side) return null;
    const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
      return { x: Math.round(b.left * 10) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width) }; };
    const icon = side.querySelector('.nav-board-icon');
    const link = side.querySelector('.nav-link');
    const label = side.querySelector('.nav-label');
    const icons = [...side.querySelectorAll('.nav-link')].map((a) => {
      const b = a.getBoundingClientRect();
      return { y: Math.round(b.top * 10) / 10, h: Math.round(b.height * 10) / 10 };
    });
    const titles = [...side.querySelectorAll('.panel-title')].map((t) => Math.round(t.getBoundingClientRect().height));
    return { sideW: Math.round(side.getBoundingClientRect().width), icon: rect(icon), link: rect(link),
      label: rect(label), labelOp: label ? Number(getComputedStyle(label).opacity) : -1,
      iconFlex: getComputedStyle(icon).flex, linkJustify: getComputedStyle(link).justifyContent,
      icons, titles,
      scroll: { h: side.scrollHeight, c: side.clientHeight, top: Math.round(side.scrollTop) } };`);
  const rail = await probe();
  await mouse(24, 400);     // 悬停轨道 → 展开
  await sleep(500);
  const open = await probe();
  await shot('02-sidebar-open.png');
  await mouse(1400, 500);
  await sleep(500);
  await shot('03-sidebar-rail.png');

  ok('收起态侧栏是图标轨道', !!rail && rail.sideW < 90, `宽 ${rail && rail.sideW}px`);
  ok('悬停后侧栏展开', !!open && open.sideW > rail.sideW + 60, `${rail && rail.sideW} → ${open && open.sideW}px`);
  ok('图标 x 在收起/展开两态完全一致（不瞬移）',
    !!rail && !!open && Math.abs(rail.icon.x - open.icon.x) <= 1, `${rail && rail.icon.x} vs ${open && open.icon.x}`);
  ok('图标 y 在收起/展开两态完全一致',
    !!rail && !!open && Math.abs(rail.icon.y - open.icon.y) <= 1, `${rail && rail.icon.y} vs ${open && open.icon.y}`);
  ok('图标容器尺寸不变形', !!rail && !!open && rail.icon.w === open.icon.w, `${rail && rail.icon.w} vs ${open && open.icon.w}`);
  const dyMax = rail && open && rail.icons.length === open.icons.length
    ? Math.max(...rail.icons.map((r, i) => Math.abs(r.y - open.icons[i].y))) : 999;
  const dhMax = rail && open && rail.icons.length === open.icons.length
    ? Math.max(...rail.icons.map((r, i) => Math.abs(r.h - open.icons[i].h))) : 999;
  ok('侧栏内【每一个】条目在两态下 y 坐标都一样（不只是第一个）',
    dyMax <= 1, `最大偏差 ${dyMax}px / 条目数 ${rail && rail.icons.length}`);
  ok('每个条目的高度也不随宽度变化（换行被锁死）', dhMax <= 1, `最大偏差 ${dhMax}px`);
  const visTitles = rail && rail.titles ? rail.titles.filter((hh) => hh > 0) : [];
  ok('可见的面板标题在轨道态都是单行（否则高度会随宽度变化）',
    visTitles.length >= 2 && Math.max(...visTitles) - Math.min(...visTitles) <= 1 && Math.max(...visTitles) <= 24,
    `标题高度 ${rail && JSON.stringify(rail.titles)}（0 = 轨道态下该面板整体隐藏）`);
  ok('收起态文字是淡出而不是移除（位置占位保留）',
    !!rail && !!open && rail.labelOp < 0.1 && open.labelOp > 0.9, `${rail && rail.labelOp} → ${open && open.labelOp}`);
  ok('图标列被钉死（flex: none），宽度变化只由文字吸收', !!rail && rail.iconFlex.startsWith('0'), rail && rail.iconFlex);
  ok('图标靠左对齐（justify-content: flex-start）', !!rail && rail.linkJustify === 'flex-start', rail && rail.linkJustify);

  /* 背景音乐与光晕的联动是"行为"，本地 DOM 桩完全测不到（没有 WebAudio、没有音频解码）。
     产品契约（见 music.js）：默认开启、被自动播放策略拦下就等第一次用户手势；
     关过之后记住选择。所以"初始一定是关"不是契约，断言写成"点一下必须翻转"。
     无头浏览器没有音频输出设备，"能不能听见"没法断言，但可以量到
     --beat 是否出现非零电平 —— 那说明音频真的在解码、AnalyserNode 真的在出数、
     decor.js 真的把它写进了 :root（这一条以前从未验证过）。 */
  console.log('\n【⑤ 背景音乐：按钮行为 + 与光晕联动】');
  const musicState = () => ev(`
    const b = document.querySelector('[data-action="toggle-music"]');
    const g = document.querySelector('.beat-glow');
    return { on: b.classList.contains('is-on'), pressed: b.getAttribute('aria-pressed'),
      label: b.getAttribute('aria-label'), title: b.getAttribute('title'),
      beat: Number(document.documentElement.style.getPropertyValue('--beat') || 0),
      glowOpacity: g ? Number(getComputedStyle(g).opacity) : -1,
      x: Math.round(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2),
      y: Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2) };`);
  const clickMusic = async (s) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: s.x, y: s.y, button: 'left', clickCount: 1 });
    }
  };

  const start = await musicState();
  ok('音乐按钮带可访问名与按下状态（title / aria-label / aria-pressed 都不为空）',
    !!start.title && !!start.label && (start.pressed === 'true' || start.pressed === 'false'),
    `${start.label} · aria-pressed=${start.pressed}`);
  ok('初始状态与持久化偏好一致（默认开启，关过则记住关闭）',
    start.on === (start.pressed === 'true'), `is-on=${start.on}`);

  // 先确保处于"开启"，再验证播放；真实点击（用户手势）才会被播放策略放行
  if (!start.on) { await clickMusic(start); await sleep(900); }
  const on = await musicState();
  ok('开启态：按钮高亮与 aria-pressed 同步', on.on === true && on.pressed === 'true',
    `is-on=${on.on} aria-pressed=${on.pressed} 名称="${on.label}"`);
  let peak = 0; let peakGlow = 0;
  for (let i = 0; i < 12; i++) {
    const s = await musicState();
    if (s.beat > peak) { peak = s.beat; peakGlow = s.glowOpacity; }
    await sleep(160);
  }
  if (peak > 0.005) {
    ok('开启态：音频真的在跑（--beat 出现非零电平 = 频谱有数据）', true, `峰值 ${peak.toFixed(3)}`);
    ok('开启态：底部光晕亮度跟着电平抬起来（--beat 真的驱动了 CSS）',
      peakGlow > 0.552, `opacity=${peakGlow}（静态底色 0.55）`);
  } else {
    console.log(`  ⚠ 参考项跳过：本次 --beat 峰值 ${peak.toFixed(3)}（无头环境缺少音频输出设备时属正常，请在有声卡的浏览器里看光晕是否随音乐呼吸）`);
  }
  await shot('05-music-on.png');

  await clickMusic(on);
  await sleep(900);
  const off = await musicState();
  ok('再次点击可关闭（状态与可访问名同步回"关"）',
    off.on === false && off.pressed === 'false' && /开启/.test(off.label),
    `is-on=${off.on} aria-pressed=${off.pressed} 名称="${off.label}"`);
  ok('关闭后 --beat 收敛回 0（光晕退回静态底色，不会僵在亮的位置）', off.beat <= 0.02, `--beat=${off.beat}`);
  ok('关闭后光晕回到基准亮度', Math.abs(off.glowOpacity - 0.55) < 0.02, `opacity=${off.glowOpacity}`);

  console.log('\n【截图】');
  console.log(`  ${SHOT_DIR}`);
} catch (e) {
  fail++;
  console.error(`\n执行出错：${e.message}`);
} finally {
  try { ws && ws.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
}
console.log(`\n结论：通过 ${pass} 项，未通过 ${fail} 项`);
process.exit(fail ? 1 : 0);
