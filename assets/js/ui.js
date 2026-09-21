/**
 * ui.js —— 视图层公共模块
 *
 * 架构说明（对应"双端 × 双主题"设计）：
 *   - 本文件提供与设备无关的公共渲染件（状态徽章、风险条、完整度条…）
 *   - mobile.js / desktop.js 只负责"同一批数据用不同结构呈现"
 *   - 主题完全由 CSS 变量承载，视图层不关心深浅色
 *
 * 安全：所有插入文本统一经 esc() 转义，避免用户发布内容造成 XSS
 */

import {
  STATUS, STATUS_LABEL, KIND_LABEL, SOURCE_LABEL, RISK_LEVEL,
} from './logic.js';

export { STATUS, STATUS_LABEL, KIND_LABEL, SOURCE_LABEL };

/* ============================================================
 * 基础工具
 * ============================================================ */

export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function h(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '');
}

/* ============================================================
 * 状态 → CSS 修饰类
 * ============================================================ */

const STATUS_CLASS = {
  [STATUS.OPEN]: 'open',
  [STATUS.CLOSING]: 'closing',
  [STATUS.CLOSED]: 'closed',
  [STATUS.STANDBY]: 'standby',
  [STATUS.RECURRING]: 'recurring',
  [STATUS.UPCOMING]: 'open',
  [STATUS.ENDED]: 'closed',
  [STATUS.REPLAY]: 'replay',
};

export function statusClass(status) {
  return `st-${STATUS_CLASS[status] || 'open'}`;
}

/* ============================================================
 * 公共渲染件
 * ============================================================ */

/** 状态徽章：颜色 + 文字双通道，保证深色模式与色觉障碍下都可辨
 *  容错：若传入的对象没有派生状态（例如未经 decorate 的原始条目），
 *        直接返回空串，避免渲染出"只有圆点、没有文字"的空徽章。 */
export function statusBadge(item, { withCountdown = true } = {}) {
  if (!item || !item.status || !item.statusLabel) return '';
  const cd = item.deadlineCountdown || item.startCountdown || '';
  const showCd = withCountdown && cd && item.status !== STATUS.ENDED;
  return h`<span class="badge ${statusClass(item.status)}">
    <span class="badge-dot" aria-hidden="true"></span>${esc(item.statusLabel)}${showCd ? h`<span class="badge-cd">${esc(cd)}</span>` : ''}
  </span>`;
}

/** 可信度徽章（同样需要容错：原始条目没有 credibility 字段） */
export function credibilityBadge(item) {
  if (!item || !item.credibility || !item.credibilityLabel) return '';
  return h`<span class="cred cred-${esc(item.credibility)}">${esc(item.credibilityLabel)}</span>`;
}

/** 来源标签 */
export function sourceTag(item) {
  const cls = item.source === 'student' ? 'student' : 'official';
  const label = item.org && item.org !== '学生个人发布' ? item.org : SOURCE_LABEL[item.source];
  return h`<span class="src src-${cls}">${esc(label)}</span>`;
}

/** 类型标签 */
export function kindTag(item) {
  return h`<span class="kind">${esc(KIND_LABEL[item.kind] || '')}</span>`;
}

/** 完整度进度条 —— 用可量化的方式帮用户判断信息是否足够做决定 */
export function completenessMeter(item) {
  const v = item.completeness;
  const level = v >= 75 ? 'high' : v >= 50 ? 'mid' : 'low';
  const title = item.missingFields.length
    ? `信息完整度 ${v}/100，缺少：${item.missingFields.join('、')}`
    : `信息完整度 ${v}/100，字段齐全`;
  return h`<div class="meter" title="${esc(title)}">
    <div class="meter-bar"><i class="meter-fill meter-${level}" style="width:${v}%"></i></div>
    <span class="meter-text">完整度 <b>${v}</b></span>
  </div>`;
}

/** 缺失字段行：显式告诉用户"缺什么"，而不是假装没有 */
export function missingLine(item) {
  if (!item.missingFields.length) return '';
  return h`<div class="missing"><span class="missing-icon" aria-hidden="true">?</span>
    未提供：${esc(item.missingFields.join(' · '))}</div>`;
}

/** 风险提示图标 */
const RISK_ICON = {
  [RISK_LEVEL.DANGER]: '!',
  [RISK_LEVEL.WARN]: '!',
  [RISK_LEVEL.INFO]: 'i',
};

/**
 * 风险提示列表
 *
 *  mode='fact' —— 只显示客观事实（如"原文未提供活动地点"），用于详情页顶部。
 *                 刻意不含任何建议或判断，保证顶部忠实呈现原文内容。
 *  mode='full' —— 显示解读与建议，供 AI 模块使用。
 *
 * 这样区分的原因：详情页顶部一旦混入"建议…""请谨慎…"，
 * 用户就分不清哪句来自原文、哪句是产品推断。
 */
export function riskList(item, { compact = false, mode = 'fact' } = {}) {
  if (!item.risks || !item.risks.length) return '';
  const list = compact ? item.risks.slice(0, 2) : item.risks;
  const rows = list.map((r) => {
    const body = mode === 'full' ? (r.detail || r.fact || '') : (r.fact || '');
    return h`<div class="risk risk-${esc(r.level)}">
      <span class="risk-icon" aria-hidden="true">${RISK_ICON[r.level] || 'i'}</span>
      <div class="risk-body">
        <div class="risk-title">${esc(r.title)}</div>
        ${body ? h`<div class="risk-detail">${esc(body)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  const more = compact && item.risks.length > 2
    ? h`<div class="risk-more">另有 ${item.risks.length - 2} 项，展开详情查看</div>` : '';
  return h`<div class="risk-list">${rows}${more}</div>`;
}

/** 关键字段的两列信息（手机详情与电脑详情共用） */
export function fieldGrid(item) {
  const rows = [
    ['活动时间', item.startText ? esc(item.startText) + (item.startAtApprox ? '（原文仅注明「晚间」）' : '') : null, item.recurring],
    ['报名截止', item.deadlineText ? esc(item.deadlineText) + (item.deadlineCountdown ? `（${esc(item.deadlineCountdown)}）` : '') : null, item.deadlineNote],
    ['地点', item.place ? esc(item.place) : (item.placeStatus ? `待确认（${esc(item.placeStatus)}）` : null)],
    ['面向对象', item.audience ? esc(item.audience) : null],
    ['人数限制', item.capacity ? (item.capacityMin ? `${item.capacityMin}—${item.capacity} 人` : `${item.capacity} 人`) : null],
    ['费用', item.cost ? esc(item.cost) : null],
    ['每周投入', item.weeklyHours ? `约 ${item.weeklyHours} 小时` : null],
  ].filter((r) => r[1] || r[2]);

  const html = rows.map(([label, value, extra]) => h`<div class="fld">
      <div class="fld-k">${esc(label)}</div>
      <div class="fld-v">${value || '<span class="fld-none">未注明</span>'}${extra ? h`<span class="fld-extra">${esc(extra)}</span>` : ''}</div>
    </div>`).join('');

  return h`<div class="field-grid">${html}</div>`;
}

/** 系列更新说明 —— 让用户知道"这条被改过" */
export function seriesNote(item) {
  if (!item.supplements || !item.supplements.length) return '';
  const ids = item.supplements.map((s) => `#${s.id}`).join('、');
  return h`<div class="series-note">
    <span class="series-icon" aria-hidden="true">↻</span>
    <div>
      <b>本条已被补充通知更新（${esc(ids)}）</b>
      <div class="series-detail">上方显示的已是生效后的最新时间与地点。原始信息中「每周六训练」的计划已变更，请以本页为准。</div>
    </div>
  </div>`;
}

/** 角色名额提示（题 03 + 20：开发已满，只补设计与材料） */
export function roleNote(item) {
  if (!item.closedRoles && !item.openRoles) return '';
  return h`<div class="role-note">
    ${item.closedRoles ? h`<span class="role-closed">已满：${esc(item.closedRoles.join('、'))}</span>` : ''}
    ${item.openRoles ? h`<span class="role-open">仍在招：${esc(item.openRoles.join('、'))}</span>` : ''}
  </div>`;
}

/* ============================================================
 * 图标（内联 SVG，使用 currentColor 以自动适配深浅主题）
 * ============================================================ */

export const ICON = {
  search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  filter: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z"/></svg>',
  theme: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/></svg>',
  device: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="4.5" width="13" height="10" rx="1.5"/><path d="M6.5 18.5h5"/><rect x="17" y="10" width="4.5" height="9.5" rx="1.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3.5l9 16H3z"/><path d="M12 10v5M12 18h.01"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s6.5-5.6 6.5-10.5A6.5 6.5 0 0 0 5.5 10.5C5.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.4" r="2.4"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4-1 0-2-.2-2.9-.5L4 20.5l1.5-3.9C4.3 15.3 3.5 13.7 3.5 12 3.5 7.9 7.3 4.6 12 4.6s8.5 3.3 8.5 7.4z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 21V4.2M5.5 4.8h11l-1.8 3.6 1.8 3.6h-11"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>',
};

/* ============================================================
 * 动画与交互反馈
 *
 * 用 Web Animations API 实现，不依赖 CSS 类，因此任何元素都能直接调用。
 * 所有动画都尊重"减少动效"偏好（系统设置 reduce motion 时自动跳过）。
 * ============================================================ */

function reduceMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 元素弹一下（用于点击、收藏、发送成功等即时反馈） */
export function pulse(el, { scale = 0.94, duration = 180 } = {}) {
  if (!el || reduceMotion() || typeof el.animate !== 'function') return;
  try {
    el.animate(
      [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }],
      { duration, easing: 'cubic-bezier(.34,1.56,.64,1)' },
    );
  } catch { /* 浏览器不支持则静默跳过 */ }
}

/** 元素闪一下背景（用于"已加入/已提交"状态确认） */
export function flash(el, color = 'currentColor', duration = 520) {
  if (!el || reduceMotion() || typeof el.animate !== 'function') return;
  try {
    el.animate(
      [{ backgroundColor: color, opacity: 0.28 }, { backgroundColor: 'transparent', opacity: 0 }],
      { duration, easing: 'ease-out' },
    );
  } catch { /* 忽略 */ }
}

/** 数字/内容变化时轻微上浮淡入（用于列表刷新） */
export function fadeInUp(el, { duration = 220, distance = 6 } = {}) {
  if (!el || reduceMotion() || typeof el.animate !== 'function') return;
  try {
    el.animate(
      [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'translateY(0)' }],
      { duration, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
  } catch { /* 忽略 */ }
}

/** 按钮进入"处理中"状态，返回恢复函数 */
export function busy(btn, text = '处理中…') {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.innerHTML = h`<span class="spinner" aria-hidden="true"></span>${esc(text)}`;
  return () => {
    btn.disabled = wasDisabled;
    btn.classList.remove('is-busy');
    btn.innerHTML = original;
  };
}

/** 滚动到某个条目并高亮，用于"我刚发布/我刚收藏"的定位反馈 */
export function scrollToItem(id, { highlight = true } = {}) {
  const node = document.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
  if (!node) return false;
  try {
    node.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
  } catch {
    node.scrollIntoView();
  }
  if (highlight) {
    node.classList.add('is-just-updated');
    setTimeout(() => node.classList.remove('is-just-updated'), 1600);
  }
  return true;
}

/**
 * 错落入场：给一组元素依次播放上浮淡入。
 *
 * 用途：双列信息流在筛选/切换板块后重新排列时，
 *       让用户感知到"内容变了"，而不是生硬替换。
 * 落差来自每项延迟不同（stagger），高度不一致时视觉上自然形成错落感。
 */
export function staggerIn(nodes, { duration = 260, distance = 10, step = 42, maxDelay = 420 } = {}) {
  if (!nodes || !nodes.length || reduceMotion()) return;
  nodes.forEach((el, i) => {
    if (!el || typeof el.animate !== 'function') return;
    const delay = Math.min(i * step, maxDelay);
    try {
      el.animate(
        [
          { opacity: 0, transform: `translateY(${distance}px)` },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' },
      );
    } catch { /* 忽略个别元素失败 */ }
  });
}

/** 淡出：用于切换筛选前让旧内容"上隐"，避免闪烁式替换 */
export function fadeOut(el, { duration = 130 } = {}) {
  if (!el || reduceMotion() || typeof el.animate !== 'function') return null;
  try {
    const anim = el.animate(
      [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }],
      { duration, easing: 'ease-in', fill: 'forwards' },
    );
    return anim;
  } catch {
    return null;
  }
}

/* ============================================================
 * 容器变换：点卡片 → 详情面板"从卡片长出来"，收起时缩回那张卡片
 *
 * 为什么必须用 JS 而不是 CSS keyframes：
 *   入场动画需要知道"点的是哪张卡片、它在屏幕的哪个位置"，
 *   这个信息只有 JS 读得到（CSS 拿不到另一个元素的坐标）。
 *
 * 三个关键细节（都是实际实现时必须处理的坑）：
 *   ① .modal 自己的 CSS 入场动画必须先去掉。CSS animation 与 WAAPI 同时
 *      改 transform/opacity 会互相打架，表现为动画抽搐或完全不动。
 *   ② transform-origin 必须是 0 0，否则 translate+scale 的坐标换算不成立。
 *   ③ 非等比缩放（卡片 320×180 → 面板 980×800）会把文字压扁。
 *      这是设计上的取舍：面板内容同时做淡入，动画前半段根本看不见字，
 *      观众看到的是"一张卡片的表面长大成了详情面板"，而不是被压扁的文字。
 *      因此这里只动 transform / opacity / border-radius，其余一律不碰。
 * ============================================================ */

/** 单位矩阵（读不到变换时的兜底） */
const NO_MATRIX = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** 读取元素当前的计算样式，失败返回 null */
function computedStyle(el) {
  try {
    return window.getComputedStyle ? window.getComputedStyle(el) : null;
  } catch {
    return null;
  }
}

/** 读取元素当前生效的变换矩阵（含正在播放的动画；无变换时为单位矩阵） */
function currentMatrix(el) {
  const cs = computedStyle(el);
  const t = cs && cs.transform;
  if (!t || t === 'none') return NO_MATRIX;
  const m2 = /matrix\(([^)]+)\)/.exec(t);
  if (m2) {
    const [a, b, c, d, e, f] = m2[1].split(',').map(Number);
    return { a, b, c, d, e, f };
  }
  const m3 = /matrix3d\(([^)]+)\)/.exec(t);
  if (m3) {
    const v = m3[1].split(',').map(Number);
    return { a: v[0], b: v[1], c: v[4], d: v[5], e: v[12], f: v[13] };
  }
  return NO_MATRIX;
}

/** 把矩阵序列化成 transform 字符串 */
function matrixCSS(m) {
  return `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
}

/** 把 "12px" / "var(--x)" 之类解析成数字，解析不出返回 null */
function px(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 读取元素的屏幕矩形与四角圆角；读不到（元素不存在 / 尺寸为 0 / 无 DOM）时返回 null。
 * 拿到的是"快照"而不是元素引用 —— 因为弹层内的关联跳转会重建 DOM，
 * 那时原元素已经脱离文档，再 measure 只会得到 0。
 */
export function captureRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  let r;
  try {
    r = el.getBoundingClientRect();
  } catch {
    return null;
  }
  if (!r || !r.width || !r.height) return null;
  const cs = computedStyle(el);
  const rad = (k) => (cs ? px(cs[k]) : null);
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    radius: [
      rad('borderTopLeftRadius'), rad('borderTopRightRadius'),
      rad('borderBottomRightRadius'), rad('borderBottomLeftRadius'),
    ],
  };
}

/** 面板自己的四角圆角（动画终点用） */
function ownRadius(el) {
  const cs = computedStyle(el);
  if (!cs) return [null, null, null, null];
  return [
    px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius),
    px(cs.borderBottomRightRadius), px(cs.borderBottomLeftRadius),
  ];
}

/**
 * 计算"把面板变换到目标矩形"所需的 transform。
 *
 * 从当前矩形反推"未变换时的布局矩形"（cur 减去矩阵里的位移、除以缩放），
 * 这样即使关闭动画是在入场动画播放到一半时触发的（用户点了遮罩），
 * 也能从"当前看到的画面"平滑接上，而不是先跳回原位再收缩。
 */
function transformToRect(panelEl, rect) {
  let cur;
  try {
    cur = panelEl.getBoundingClientRect();
  } catch {
    return null;
  }
  if (!cur || !cur.width || !cur.height) return null;
  const m = currentMatrix(panelEl);
  const baseLeft = cur.left - m.e;
  const baseTop = cur.top - m.f;
  const baseW = m.a ? cur.width / m.a : cur.width;
  const baseH = m.d ? cur.height / m.d : cur.height;
  const dx = rect.left - baseLeft;
  const dy = rect.top - baseTop;
  const sx = baseW ? rect.width / baseW : 1;
  const sy = baseH ? rect.height / baseH : 1;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

/** 组装圆角关键帧字段；任一侧读不到具体数值就整体不加圆角动画 */
function radiusFrame(fromRad, toRad) {
  const keys = [
    'borderTopLeftRadius', 'borderTopRightRadius',
    'borderBottomRightRadius', 'borderBottomLeftRadius',
  ];
  const frame = {};
  for (let i = 0; i < 4; i++) {
    if (fromRad[i] === null || toRad[i] === null) return {};
    frame[keys[i]] = `${fromRad[i]}px`;
  }
  return frame;
}

/** 动画是否可用（减少动效 / 无 WAAPI / 元素不存在 → 不可用） */
function canAnimate(el) {
  return !!el && !reduceMotion() && typeof el.animate === 'function';
}

/** 统一收尾：动画结束或出错都要 resolve，绝不阻塞弹层的关闭清理 */
function settle(anims) {
  return Promise.all(anims.map((a) => (a && a.finished ? a.finished.catch(() => {}) : Promise.resolve())));
}

/** 让面板的内容淡入/淡出（盖住非等比缩放期间的形变） */
function fadeChildren(panelEl, { duration, to, delay = 0 }) {
  if (!panelEl || !panelEl.children) return [];
  const frames = to === 0
    ? [{ opacity: 1 }, { opacity: 0, offset: 0.55 }, { opacity: 0 }]
    : [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }];
  // 展开：只需要盖住延时那段（backwards），结束后交还给正常样式
  // 收起：必须保持到 DOM 被移除（forwards），否则最后一帧会闪回不透明
  const opts = { duration, easing: 'ease-out', delay, fill: to === 0 ? 'forwards' : 'backwards' };
  return [...panelEl.children].map((kid) => {
    try { return kid.animate(frames, opts); } catch { return null; }
  }).filter(Boolean);
}

/**
 * 展开：面板从 rect（卡片的位置与尺寸）长大到自己的最终位置。
 * @returns {Promise} 动画结束（或无需动画）后 resolve
 */
export function expandFromRect(rect, panelEl, { duration = 320 } = {}) {
  if (!rect || !canAnimate(panelEl)) return Promise.resolve();

  /* ⚠ 顺序很关键：先把 transform-origin 改成 0 0，再测量与计算。
     否则"未变换布局矩形"的反推（cur - 矩阵位移）不成立。 */
  const prevOrigin = panelEl.style ? panelEl.style.transformOrigin : '';
  if (panelEl.style) panelEl.style.transformOrigin = '0 0';

  const panelRadius = ownRadius(panelEl);
  const from = transformToRect(panelEl, rect);
  if (!from) {
    if (panelEl.style) panelEl.style.transformOrigin = prevOrigin;
    return Promise.resolve();
  }
  const rest = matrixCSS(currentMatrix(panelEl));   // 面板自己的常态（通常就是单位矩阵）

  const frames = [
    /* 面板【表面】全程保持不透明：看起来就是"那张卡片的表面长大了"。
       ⚠ 一开始把整块面板也做了透明度渐入，结果用无头浏览器逐帧截图发现：
       动画前半段能透过面板看到背后的信息流，像重影，很脏。
       正确做法（Material 容器变换同款）：表面不透明，只让【内容】淡入 ——
       内容的淡入既遮挡了非等比缩放造成的形变，又不会让面板变透明。 */
    { transform: from, opacity: 1, ...radiusFrame(rect.radius, panelRadius) },
    { transform: rest, opacity: 1, ...radiusFrame(panelRadius, panelRadius) },
  ];

  let anim;
  try {
    anim = panelEl.animate(frames, { duration, easing: 'cubic-bezier(.22,1,.36,1)' });
  } catch {
    if (panelEl.style) panelEl.style.transformOrigin = prevOrigin;
    return Promise.resolve();
  }
  // 内容稍微延后淡入：先看到"表面长大"，再看到文字
  const kids = fadeChildren(panelEl, { duration, to: 1, delay: Math.round(duration * 0.22) });

  return settle([anim, ...kids]).then(() => {
    // 动画结束后还原内联 transform-origin，避免影响后续布局与测量
    if (panelEl.style) panelEl.style.transformOrigin = prevOrigin || '';
  });
}

/**
 * 收起：面板缩回 rect（那张卡片）。
 * @param {object|null} rect 目标卡片矩形；为 null 时退化为"原地缩一下再淡出"
 */
export function collapseToRect(rect, panelEl, { duration = 260 } = {}) {
  if (!canAnimate(panelEl)) return Promise.resolve();

  const prevOrigin = panelEl.style ? panelEl.style.transformOrigin : '';
  if (panelEl.style) panelEl.style.transformOrigin = '0 0';

  const panelRadius = ownRadius(panelEl);
  const now = matrixCSS(currentMatrix(panelEl));
  const target = rect ? transformToRect(panelEl, rect) : null;

  const frames = target
    ? [
      /* 表面同样保持不透明：缩回卡片后由真实卡片接上（两者位置/尺寸/圆角一致，
         所以移除面板的那一瞬间不会闪）。内容在缩的过程中先淡出，避免整段内容被压扁时还在读字。 */
      { transform: now, opacity: 1, ...radiusFrame(panelRadius, rect.radius) },
      { transform: target, opacity: 1, ...radiusFrame(rect.radius, rect.radius) },
    ]
    // 找不到来源卡片（已被筛选掉 / 滚出屏幕）：缩回一点点 + 淡出
    : [
      { transform: now, opacity: 1 },
      { transform: 'scale(.97)', opacity: 0 },
    ];

  let anim;
  try {
    anim = panelEl.animate(frames, { duration, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  } catch {
    if (panelEl.style) panelEl.style.transformOrigin = prevOrigin;
    return Promise.resolve();
  }
  const kids = fadeChildren(panelEl, { duration, to: 0 });
  return settle([anim, ...kids]);
}


let toastTimer = null;

export function toast(message, type = 'info') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  host.innerHTML = h`<div class="toast toast-${esc(type)}">${esc(message)}</div>`;
  host.hidden = false;
  requestAnimationFrame(() => host.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    host.classList.remove('show');
    setTimeout(() => { host.hidden = true; }, 220);
  }, 2200);
}
