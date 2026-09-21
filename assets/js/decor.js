/**
 * decor.js —— 随音乐节奏起伏的装饰（canvas 波浪 + 卡片律动）
 *
 * 视觉参照用户给的图：极细的几条流动曲线互相交错、左侧一个圆环节点、散布的细小光点，
 * 整体是"暗底 + 单色细线"的克制风格 —— 所以这里不用柱状频谱那种吵闹的画法。
 *
 * 分工与性能考虑：
 *   · 只开【一个】requestAnimationFrame 循环，同时负责画 canvas 和写 --beat 变量；
 *   · 卡片的律动不逐个用 JS 操作，而是把响度写进 :root 的 --beat，
 *     由 CSS 消费 —— 26 张卡片也只有一次样式计算，不会变成 26 个定时器；
 *   · 页面切到后台时停掉循环（省电），回到前台再继续；
 *   · 尊重"减少动效"：不跑循环，只画一帧静态曲线。
 */
const REDUCED = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * @param {HTMLCanvasElement} canvas 底部波形画布
 * @param {() => number} getLevel 0..1 响度
 * @param {() => Uint8Array|null} getSpectrum 频谱
 * @param {() => object|null} getBands 三段能量
 * @param {() => boolean} isOn 音乐是否开启（关闭时波形收敛成一条静线）
 */
export function startDecor(opts) {
  const { canvas, getLevel, getSpectrum, getBands } = opts;
  if (!canvas) return () => {};
  const ctx2d = canvas.getContext('2d');
  let raf = 0;
  let t = 0;
  const blips = Array.from({ length: 18 }, (_, i) => ({
    x: (i + 0.5) / 18 + (Math.random() - 0.5) * 0.02,
    y: 0.15 + Math.random() * 0.7,
    r: Math.random() < 0.3 ? 1.8 : 1.1,
    ph: Math.random() * Math.PI * 2,
  }));

  const fit = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || 120;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { w, h };
  };

  /** 画一帧：三条细曲线 + 左端节点 + 散布光点 */
  const draw = () => {
    const { w, h } = fit();
    const level = opts.isOn() ? getLevel() : 0;
    const bands = opts.isOn() ? getBands() : null;
    const spec = opts.isOn() ? getSpectrum() : null;

    ctx2d.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const line = css.getPropertyValue('--wave-line').trim() || 'rgba(140,150,165,.5)';
    const dot = css.getPropertyValue('--wave-dot').trim() || 'rgba(140,150,165,.6)';

    // 三条曲线：不同相位与振幅，互相交错（对应图里交叉的细线）
    for (let k = 0; k < 3; k++) {
      const amp = h * (0.06 + k * 0.05) * (0.6 + level * 2.4);
      const speed = 0.5 + k * 0.22;
      const yBase = h * (0.5 + (k - 1) * 0.1);
      ctx2d.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const p = x / w;
        // 频谱驱动：取该位置对应的频段作为该点的起伏量
        const si = spec ? Math.floor((k * 0.25 + p * 0.5) * (spec.length - 1)) : 0;
        const specAmp = spec ? spec[si] / 255 : 0;
        const y = yBase
          + Math.sin(p * Math.PI * (2 + k) + t * speed) * amp * 0.5
          + Math.sin(p * Math.PI * 5.5 + t * speed * 1.7) * amp * 0.18
          + (specAmp - 0.2) * h * 0.22 * (k === 0 ? 1 : 0.55);
        if (x === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
      }
      ctx2d.strokeStyle = line;
      ctx2d.globalAlpha = 0.75 - k * 0.16;
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
    }
    ctx2d.globalAlpha = 1;

    // 左端节点：一个圆环 + 上面一个小点（对应图左）
    const cx = w * 0.035;
    const cy = h * 0.52;
    const rr = 7 + level * 10;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx2d.strokeStyle = line;
    ctx2d.globalAlpha = 0.85;
    ctx2d.lineWidth = 1.2;
    ctx2d.stroke();
    ctx2d.beginPath();
    ctx2d.arc(cx, cy - rr - 6, 2.4, 0, Math.PI * 2);
    ctx2d.fillStyle = dot;
    ctx2d.fill();
    ctx2d.globalAlpha = 1;

    // 散布光点：亮度与大小随低频能量呼吸
    const low = bands ? bands.low : 0;
    for (const b of blips) {
      const a = 0.18 + (low * 0.9 + level * 0.4) * (0.5 + 0.5 * Math.sin(t * 1.6 + b.ph));
      ctx2d.globalAlpha = Math.min(0.75, a);
      ctx2d.beginPath();
      ctx2d.arc(b.x * w, b.y * h, b.r + low * 2.2, 0, Math.PI * 2);
      ctx2d.fillStyle = dot;
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;

    // 把响度写到 :root，交给 CSS 驱动卡片律动（每帧只改一个变量）
    document.documentElement.style.setProperty('--beat', String(level.toFixed(3)));
  };

  const loop = () => { t += 0.016; draw(); raf = requestAnimationFrame(loop); };

  if (REDUCED()) { draw(); return () => {}; }
  loop();
  const onVis = () => {
    if (document.hidden) { window.cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) loop();
  };
  document.addEventListener('visibilitychange', onVis);
  const onResize = () => { draw(); };
  window.addEventListener('resize', onResize);
  return () => {
    window.cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', onResize);
  };
}
