/**
 * music.js —— 全局背景音乐的"音频引擎"（不含任何绘制）
 *
 * 职责边界：只负责加载、播放/暂停、用 Web Audio 取出频谱，并把用户选择持久化。
 * 具体画什么（律动装饰）在 decor.js，两者通过"取频谱的函数"连接，
 * 因此换掉视觉不需要动音频逻辑，反之亦然。
 *
 * 三个必须处理的现实约束（浏览器策略，不是可选项）：
 *   ① 带声音的自动播放会被拦：进入页面先尝试 play()，失败就等【第一次用户手势】
 *      （pointerdown/keydown）再开始 —— 这就是"进入就尝试播放、被拦则首次点击开始"。
 *      也正因如此，AudioContext 必须懒创建：手势之前创建会处于 suspended。
 *   ② createMediaElementSource 对同一个 <audio> 只能调用一次，重复调用会抛错，故加锁。
 *   ③ preload='none' + 显式 play 时才真正下载：12MB 音频不该在首屏抢带宽。
 */
import * as store from './store.js';

const KEY = 'music';
let audio = null;
let ctx = null;
let analyser = null;
let freq = null;
let wired = false;
let on = false;
let ready = false;

/** 是否处于"开启"状态（用户意图，不是"此刻是否真的在响"） */
export function musicOn() { return on; }
/** 音频是否已经能取到频谱（用于判断要不要画律动） */
export function musicReady() { return ready; }

/** 当前整体响度 0..1，供视觉层使用；没在播放时返回 0 */
export function getLevel() {
  if (!analyser || audio.paused) return 0;
  analyser.getByteFrequencyData(freq);
  let sum = 0;
  for (let i = 0; i < freq.length; i++) sum += freq[i];
  return Math.min(1, sum / (freq.length * 140));
}

/** 取频谱字节数组（低→高），供 canvas 画随节奏起伏的曲线 */
export function getSpectrum() {
  if (!analyser || audio.paused) return null;
  analyser.getByteFrequencyData(freq);
  return freq;
}

/** 低频/中频/高频三段能量，用于让装饰的形态随节奏变化 */
export function getBands() {
  const s = getSpectrum();
  if (!s) return null;
  const n = s.length;
  const avg = (a, b) => {
    let t = 0;
    for (let i = a; i < b; i++) t += s[i];
    return t / Math.max(1, b - a) / 255;
  };
  return { low: avg(0, Math.max(1, Math.floor(n * 0.12))), mid: avg(Math.floor(n * 0.12), Math.floor(n * 0.4)), high: avg(Math.floor(n * 0.4), n) };
}

/** 创建 <audio> 并接线；返回当前是否开启 */
export function initMusic(src) {
  /* ⚠ 背景音乐是【可选增强】：任何一步失败都必须静默降级，绝不能拖垮整个应用。
     实测踩到：测试桩（没有 Audio 构造器）里 `new Audio()` 直接抛错，
     结果 init() 整体失败、页面停在加载态 —— 一个附加功能把主功能弄挂了。
     所以这里整体包 try/catch，失败就返回 false，按钮仍是关闭态、装饰不画。 */
  try {
    audio = new Audio();
  } catch { audio = null; on = false; return false; }
  try {
    audio.src = src;
    audio.loop = true;
    audio.volume = 0.45;
    audio.preload = 'none';
    audio.crossOrigin = 'anonymous';
  } catch { audio = null; on = false; return false; }

  let prefs = {};
  try { prefs = store.getUiPrefs() || {}; } catch { prefs = {}; }
  on = prefs.music !== false;            // 默认开启；用户关过就记住
  if (on) tryStart();
  // 被浏览器拦下时的兜底：第一次手势再试一次（只试一次）
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    if (on && audio.paused) tryStart();
  };
  try {
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  } catch { /* 无 window（测试环境）时忽略 */ }
  return on;
}

/** 尝一次播放；成功后再接 Web Audio（必须等有声音上下文可用） */
function tryStart() {
  if (!audio) return;
  try {
    const p = audio.play();
    if (p && p.catch) p.catch(() => { /* 被策略拦下，等用户手势 */ });
  } catch { /* 播放失败不影响其他功能 */ }
  wire();
}

function wire() {
  if (wired) return;                     // createMediaElementSource 只能用一次
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
    const src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;
    freq = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(ctx.destination);
    wired = true;
    ready = true;
  } catch { ready = false; }
}

/** 切换开关；返回切换后的状态 */
export function toggleMusic() {
  on = !on;
  if (!audio) { on = false; try { store.setUiPrefs({ ...store.getUiPrefs(), music: false }); } catch { /* 忽略 */ } return false; }
  if (on) {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    tryStart();
  } else {
    audio.pause();
  }
  store.setUiPrefs({ ...store.getUiPrefs(), music: on });
  return on;
}
