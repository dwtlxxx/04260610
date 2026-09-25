/**
 * decor.js —— 节奏与滚动的"视觉驱动"（不含具体绘制）
 *
 * 两个职责：
 *   ① 把当前响度写进 :root 的 --beat，由 CSS 消费（底部光晕呼吸 + 卡片律动）。
 *      这样 26 张卡片也只有一次样式计算，不会变成 26 个定时器。
 *   ② 滚动时按卡片与视口中心的距离设置 --sc / --op（缩放与淡入淡出）。
 *
 * 为什么不再用 canvas 画线：用户反馈"细线还是太丑，换一个方案"，
 * 改成一层柔和色块光晕（纯 CSS），更干净也更省电（没有逐帧绘制）。
 *
 * 这里所有 DOM 写入都走 setVar，并且先确认 style.setProperty 真的存在：
 * 自检脚本里跑的是极简 DOM 桩，缺这个方法时应当安静跳过，而不是把整个 app 拖崩。
 */
const REDUCED = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

const setVar = (el, key, value) => {
  const s = el && el.style;
  if (!s || typeof s.setProperty !== 'function') return;
  s.setProperty(key, value);
};

/** 跟随音乐响度写 --beat；没在播放时收敛到 0（光晕退回静态底色） */
export function startBeat(opts) {
  const getLevel = typeof opts.getLevel === 'function' ? opts.getLevel : () => 0;
  const isOn = typeof opts.isOn === 'function' ? opts.isOn : () => false;
  if (REDUCED()) { setVar(document.documentElement, '--beat', '0'); return () => {}; }
  let raf = 0;
  let running = false;   // 防重入：自检桩里 requestAnimationFrame 是同步执行的，
                         // 不挡一下会瞬间递归到爆栈（浏览器里 rAF 异步，不受影响）
  const tick = () => {
    if (running) return;
    running = true;
    const lv = isOn() ? getLevel() : 0;
    setVar(document.documentElement, '--beat', lv.toFixed(3));
    raf = requestAnimationFrame(tick);
    running = false;
  };
  tick();
  const onVis = () => {
    if (document.hidden) { window.cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) tick();
  };
  document.addEventListener('visibilitychange', onVis);
  return () => { window.cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
}

/**
 * 滚动特效：卡片越靠近视口中心越"大而实"，越靠近边缘越"小而淡"。
 * 只写两个自定义属性（--sc / --op），transform/opacity 由 CSS 组合，
 * 因此不会与 hover 的位移、以及入场动画打架。
 */
export function startScrollEffect(getCards) {
  if (REDUCED()) return () => {};
  let raf = 0;
  const update = () => {
    raf = 0;
    const vh = window.innerHeight || 800;
    const mid = vh / 2;
    const cards = getCards ? getCards() : [];
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.bottom < -120 || r.top > vh + 120) continue;   // 屏外的不算，省开销
      const d = Math.min(1, Math.abs((r.top + r.height / 2) - mid) / (vh * 0.66));
      setVar(c, '--sc', (1 - d * 0.05).toFixed(4));
      setVar(c, '--op', (1 - d * 0.34).toFixed(3));
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
  return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
}
