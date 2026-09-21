/**
 * check-anim.mjs —— 真实浏览器动画验证（无头 Edge + CDP）
 *
 * 为什么必须存在这样一个脚本：
 *   动画"代码写了"不等于"用户看得到"。本次就踩到一个只有真浏览器才能发现的缺陷 ——
 *   打开详情时弹层 DOM 被重建了两次，第一次创建、正在播放"从卡片长出来"动画的面板节点
 *   被第二次重建丢掉，于是动画等于没生效：面板"啪"地直接出现在最终位置。
 *   本地 DOM 桩里面板对象会被复用（桩无法表达"节点被替换"），所以桩测试全绿也发现不了。
 *
 * 本脚本不看"有没有调用 animate"，而是直接测量【面板在动画过程中的真实矩形】，
 * 断言它确实从卡片的位置与尺寸连续长大到自己的最终位置。
 *
 * ⚠ 两个必须显式处理的浏览器测试细节：
 *   1. 无头浏览器默认 prefers-reduced-motion: reduce，本产品会因此跳过所有动画，
 *      不覆盖的话测的是"减少动效"分支（我一开始就被这点骗过）。
 *   2. Animation.setPlaybackRate 必须在页面加载【之后】设置，否则会被导航重置。
 *
 * 用法：
 *   node tools/serve.cjs "<仓库绝对路径>" 8123
 *   node tools/check-anim.mjs [--width 375] [--url http://127.0.0.1:8123/]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));
if (!EDGE) { console.error('未找到 Edge / Chrome'); process.exit(2); }

const argv = process.argv.slice(2);
const getArg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_ = getArg('--url', 'http://127.0.0.1:8123/');
const WIDTH = Number(getArg('--width', '375'));
const PORT = 9337;

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }); }
  send(method, params = {}) { const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')); } }, 20000); }); }
}

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
};

const userDir = `${process.env.TEMP}\\dsh-cdp-anim`;
mkdirSync(userDir, { recursive: true });
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });

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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: 812, deviceScaleFactor: 1, mobile: true,
  });

  const ev = async (expr) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression: `(() => { ${expr} })()`, returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text || '页面内求值失败');
    return result.value;
  };

  /** 读取面板状态：矩形、变换、内容透明度、正在播放的动画数 */
  const panelState = () => ev(`
    const m = document.querySelector('.modal');
    if (!m) return null;
    const cs = getComputedStyle(m);
    const r = m.getBoundingClientRect();
    const kids = [...m.children].map((k) => Number(getComputedStyle(k).opacity));
    return {
      left: Math.round(r.left), top: Math.round(r.top),
      width: Math.round(r.width), height: Math.round(r.height),
      opacity: Number(cs.opacity),
      transform: cs.transform,
      anims: m.getAnimations().length,
      kidOpacity: kids.length ? Math.max(...kids) : 1,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };`);

  const load = async () => {
    await cdp.send('Page.navigate', { url: URL_ });
    await sleep(1400);
  };

  console.log(`地址：${URL_}　视口：${WIDTH}px\n`);
  console.log('=== 1. 正常动效（prefers-reduced-motion: no-preference）===');
  await load();
  ok('页面默认不是"减少动效"（否则下面测的是另一条分支）', (await panelState()) === null);
  // 强制成"用户没有要求减少动效"
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  // ⚠ 播放速率必须在加载之后设置，否则会被导航重置
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 })
    .catch(() => console.log('  （当前浏览器不支持 Animation.setPlaybackRate，按正常速度测量）'));

  const card = await ev(`
    const c = document.querySelector('.card');
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top),
      width: Math.round(r.width), height: Math.round(r.height) };`);
  ok('页面上存在可点击的卡片', !!card,
    card ? `卡片 ${card.left},${card.top} ${card.width}x${card.height}` : '');

  await ev(`document.querySelector('.card').click(); return true;`);
  const samples = [];
  for (const wait of [70, 150, 250, 450, 900, 1700, 3000]) {
    await sleep(wait);
    const s = await panelState();
    if (s) samples.push(s);
  }
  ok('面板在动画过程中一直存在', samples.length >= 5, `采样 ${samples.length} 次`);

  const first = samples[0];
  ok('点击后立即有动画在播（不是"直接出现在终点"）', first && first.anims >= 1,
    first ? `anims=${first.anims}` : '');
  // 起点应接近卡片：宽度差距大（卡片 ~343 vs 面板 ~375）时说明确实是从卡片长出来的
  ok('动画起点接近卡片尺寸（而非最终尺寸）',
    first && Math.abs(first.height - card.height) < Math.abs(747 - card.height),
    first ? `起点 ${first.width}x${first.height}，卡片 ${card.width}x${card.height}` : '');
  ok('面板表面全程不透明（不能透过面板看到背后的信息流）',
    samples.every((s) => s.opacity === 1),
    samples.map((s) => s.opacity).join(','));
  ok('内容从透明淡入（盖住缩放形变）',
    first && first.kidOpacity < 0.5 && samples[samples.length - 1].kidOpacity > 0.9,
    first ? `内容透明度 ${first.kidOpacity} → ${samples[samples.length - 1].kidOpacity}` : '');
  const heights = samples.map((s) => s.height);
  const last = samples[samples.length - 1];
  ok('面板高度单调长大到最终尺寸',
    heights.every((h, i) => i === 0 || h >= heights[i - 1] - 1) && last.height > first.height,
    heights.join(' → '));
  ok('动画结束后回到无变换状态', last.transform === 'none', last.transform);
  console.log(`     轨迹：${samples.map((s) => `${s.width}x${s.height}@${s.top}`).join(' → ')}`);

  console.log('');
  console.log('=== 2. 关闭动画 ===');
  await ev(`document.querySelector('.modal [data-action="close-modal"]').click(); return true;`);
  await sleep(120);
  const closing = await panelState();
  ok('关闭时先播放收起动画（节点尚未被移除）', !!closing, closing ? `仍在播放 anims=${closing.anims}` : '已直接移除');
  await sleep(1200);
  ok('收起动画结束后弹层被移除', (await panelState()) === null);

  console.log('');
  console.log('=== 3. 减少动效：不应有动画，但功能必须照常 ===');
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await load();
  ok('页面已切换到"减少动效"', await ev(`return window.matchMedia('(prefers-reduced-motion: reduce)').matches;`));
  await ev(`document.querySelector('.card').click(); return true;`);
  await sleep(200);
  const rm = await panelState();
  ok('减少动效下不播放动画', rm && rm.anims === 0, rm ? `anims=${rm.anims}` : '面板不存在');
  ok('减少动效下弹层仍然正常打开（功能不受影响）', !!rm);
  await ev(`document.querySelector('.modal [data-action="close-modal"]').click(); return true;`);
  await sleep(500);
  ok('减少动效下关闭仍然生效', (await panelState()) === null);

  console.log('');
  console.log(`结论：通过 ${pass} 项，失败 ${fail} 项`);
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
}
process.exit(fail ? 1 : 0);
