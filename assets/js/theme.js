/**
 * theme.js —— 主题解析与应用
 *
 * 需求：默认跟随系统、浅色优先；支持手动三态切换（跟随系统 / 浅色 / 深色）
 *
 * 优先级：用户手动选择  >  系统偏好
 * 实现：在 <html> 上设置 data-theme="light|dark"，
 *       CSS 只消费变量，因此主题切换成本极低、且不影响任何结构。
 */

import { getTheme, setTheme } from './store.js';

export const THEME_MODE = {
  AUTO: 'auto',
  LIGHT: 'light',
  DARK: 'dark',
};

export const THEME_MODE_LABEL = {
  [THEME_MODE.AUTO]: '跟随系统',
  [THEME_MODE.LIGHT]: '浅色',
  [THEME_MODE.DARK]: '深色',
};

const listeners = new Set();

function systemPrefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** 依据「手动选择 > 系统偏好」解析出最终生效的主题 */
export function resolveTheme() {
  const mode = getTheme();
  if (mode === THEME_MODE.LIGHT || mode === THEME_MODE.DARK) return mode;
  return systemPrefersDark() ? THEME_MODE.DARK : THEME_MODE.LIGHT;
}

function apply(resolved) {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  // 同步通知浏览器原生控件与滚动条配色
  root.style.colorScheme = resolved;
  listeners.forEach((fn) => {
    try {
      fn(resolved);
    } catch {
      /* 单个订阅者出错不影响其他订阅者 */
    }
  });
}

/** 初始化：应用主题并监听系统偏好变化 */
export function initTheme() {
  apply(resolveTheme());

  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      // 仅在「跟随系统」模式下响应系统切换
      if (getTheme() === THEME_MODE.AUTO) apply(resolveTheme());
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch {
    /* 不支持 matchMedia 时静默降级 */
  }
}

/** 三态循环：跟随系统 → 浅色 → 深色 → 跟随系统 */
export function cycleTheme() {
  const order = [THEME_MODE.AUTO, THEME_MODE.LIGHT, THEME_MODE.DARK];
  const cur = getTheme();
  const next = order[(order.indexOf(cur) + 1) % order.length];
  setTheme(next);
  apply(resolveTheme());
  return next;
}

export function getCurrentMode() {
  return getTheme();
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
