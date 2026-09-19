/**
 * verify-interaction.mjs —— 交互逻辑验证（不需要浏览器）
 *
 * 目的：真正"点"一遍按钮，验证交互逻辑确实生效（而不只是渲染出了按钮）。
 *
 * 做法：
 *   1. 造一个最小但可用的 DOM 桩：支持 innerHTML 赋值、querySelector/querySelectorAll、
 *      classList、animate（记录动画调用）、scrollIntoView、closest
 *   2. 加载 app.js（它会绑定事件）
 *   3. 取出绑定的事件处理器，构造事件对象调用，等价于用户点击
 *   4. 检查 localStorage 中的数据是否真的变化
 *
 * 用法：node tools/verify-interaction.mjs
 */

/* ============================================================
 * 最小 DOM 桩
 * ============================================================ */

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this._html = '';
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollHeight = 100;
    this.classList = {
      _s: new Set(['']),
      add: (...c) => c.forEach((x) => this.classList._s.add(x)),
      remove: (...c) => c.forEach((x) => this.classList._s.delete(x)),
      contains: (c) => this.classList._s.has(c),
      toggle: (c) => (this.classList._s.has(c) ? this.classList._s.delete(c) : this.classList._s.add(c)),
    };
    this._listeners = {};
    this.animations = [];
  }
  set innerHTML(v) {
    this._html = String(v);
    this._cachedAll = null;
    this._cachedSel = {};
  }
  get innerHTML() { return this._html; }
  setAttribute(k, v) { this['_attr_' + k] = v; }
  getAttribute(k) { return this['_attr_' + k] ?? null; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  appendChild() {}
  contains() { return true; }
  closest() { return null; }
  focus() {}
  setSelectionRange() {}
  scrollIntoView() { this._scrolled = true; }
  animate(frames, opts) { this.animations.push({ frames, opts }); return { finished: Promise.resolve() }; }
  /** 极简选择器：支持 .class / #id / [attr="v"] 组合 */
  querySelectorAll(sel) {
    if (this._cachedSel?.[sel]) return this._cachedSel[sel];
    const res = [];
    // 从 HTML 中解析出带 data-action 的伪元素，便于 count 类断言
    const actions = [...this._html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
    for (const a of actions) {
      const e = new El('button');
      e.dataset.action = a;
      res.push(e);
    }
    this._cachedSel = this._cachedSel || {};
    this._cachedSel[sel] = res;
    return res;
  }
  querySelector(sel) {
    if (sel === '.modal') { this._modal = this._modal || new El('div'); return this._modal; }
    if (sel === '.modal-mask') { this._mask = this._mask || new El('div'); return this._mask; }
    if (sel === '.main-col') { this._main = this._main || new El('div'); return this._main; }
    return null;
  }
}

const registry = {
  app: new El('div'),
  'modal-host': new El('div'),
  'toast-host': new El('div'),
  'comment-input': new El('input'),
  'p-title': new El('input'),
  'p-startAt': new El('input'),
  'p-kind': new El('select'),
  'p-place': new El('input'),
  'p-audience': new El('input'),
  'p-capacity': new El('input'),
  'p-cost': new El('input'),
  'p-notes': new El('textarea'),
  'p-deadline': new El('input'),
  'p-weeklyHours': new El('input'),
  'publish-error': new El('div'),
  'live-check': new El('div'),
  'search-input': new El('input'),
};
registry['p-kind'].value = 'meetup';

const ls = new Map();
/** 专门用于观察动画调用的桩元素（document.querySelectorAll 会返回它） */
const animationProbe = new El('button');
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
};
globalThis.CSS = { escape: (s) => String(s) };
globalThis.window = {
  innerWidth: 1440, scrollY: 0, scrollTo() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  addEventListener() {},
};
globalThis.document = {
  documentElement: new El('html'), body: new El('body'),
  getElementById: (id) => registry[id] || null,
  querySelector(sel) {
    const m = /\[data-id="([^"]+)"\]/.exec(sel);
    if (m) {
      const e = new El('div');
      e.dataset.id = m[1];
      return e;
    }
    return null;
  },
  querySelectorAll(sel) {
    // 动画验证需要拿到真实节点：对 toggle-fav 选择器返回可记录动画的桩元素
    if (sel.includes('toggle-fav')) return [animationProbe];
    return [];
  },
  addEventListener(type, fn) { (this._l ||= {})[type] = fn; },
  activeElement: null,
};
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.setTimeout = (fn) => { try { fn(); } catch {} return 0; };
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 0;

/* ============================================================
 * 加载应用
 * ============================================================ */
const base = new URL('../assets/js/', import.meta.url).href;
await import(base + 'app.js');
const store = await import(base + 'store.js');
const logic = await import(base + 'logic.js');

const appEl = registry.app;
const modalHost = registry['modal-host'];

/**
 * 模拟点击。
 *
 * 桩与真实 DOM 的两处关键差异必须显式处理，否则会产生假失败：
 *   ① closest('input,button,...')：真实 DOM 中卡片是 div 容器、按钮是内部子元素；
 *      桩无法表达父子关系，因此按标签名区分——button 视为"卡片内的嵌套动作"。
 *   ② modalHost.querySelector('.modal-mask') 与 e.target 的关系：
 *      真实 DOM 中弹层内部点击时二者不相等（不应触发"点遮罩关闭"）；
 *      桩里让 querySelector 返回独立对象即可保证语义一致。
 */
function click(el, { onApp = true } = {}) {
  const target = onApp ? appEl : modalHost;
  const fns = target._listeners?.click || [];
  const INTERACTIVE = new Set(['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'A']);
  el.closest = (sel) => {
    if (sel.startsWith('[data-action')) return el.dataset.action ? el : null;
    if (sel === 'input,button,select,textarea,a') return INTERACTIVE.has(el.tagName) ? el : null;
    if (sel === '.modal') return null;
    return null;
  };
  // 确保 querySelector('.modal-mask') 不会返回 el 自身
  modalHost._mask = modalHost._mask || new El('div');
  modalHost._mask.dataset.role = 'mask';
  const ev = { target: el, stopPropagation() {}, preventDefault() {} };
  fns.forEach((f) => f(ev));
}

/** 构造一个"弹层内的按钮" */
function mkBtn(action, id) {
  const b = new El('button');
  b.dataset.action = action;
  if (id !== undefined) b.dataset.id = String(id);
  return b;
}

/**
 * 构造一个"卡片/表格行"（真实场景中它们是 div，不是 button）。
 * 这点很关键：open-detail 处理器用 closest('input,button,...') 判断
 * 点击是否落在卡片内的嵌套按钮上；若桩元素自身是 button，
 * 会被误判为嵌套按钮而提前返回，导致测试假失败。
 */
function mkCard(id) {
  const d = new El('div');
  d.dataset.action = 'open-detail';
  d.dataset.id = String(id);
  return d;
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
}

console.log('=== 1. 应用启动 ===');
check('应用渲染出内容', appEl.innerHTML.length > 1000, `(${appEl.innerHTML.length} 字节)`);
check('未停留在加载态', !appEl.innerHTML.includes('正在加载'));

console.log('');
console.log('=== 2. 发布功能（模拟填写表单并提交）===');
const before = store.getUserItems().length;
registry['p-title'].value = '【测试】周五晚自习组队刷题';
registry['p-startAt'].value = '2026-09-25T19:00';
registry['p-place'].value = '图书馆 3 楼研讨间';
registry['p-capacity'].value = '6';
registry['p-cost'].value = 'AA';
registry['p-notes'].value = '欢迎零基础，报名后拉群';
click(mkBtn('submit-publish'), { onApp: false });
const after = store.getUserItems().length;
check('发布后数据写入本地存储', after === before + 1, `(${before} → ${after})`);
const created = store.getUserItems()[0];
check('新条目标题正确', created?.title === '【测试】周五晚自习组队刷题', `("${created?.title}")`);
check('新条目标记为学生自发', created?.source === 'student');
check('新条目时间字段正确', created?.startAt === '2026-09-25T19:00');
check('新条目地点字段正确', created?.place === '图书馆 3 楼研讨间');

console.log('');
console.log('=== 3. 发布校验（缺少必填项时应阻止）===');
registry['p-title'].value = '';
registry['p-startAt'].value = '';
const beforeInvalid = store.getUserItems().length;
click(mkBtn('submit-publish'), { onApp: false });
check('缺少标题与时间时不予发布', store.getUserItems().length === beforeInvalid);
check('显示校验错误提示', registry['publish-error'].innerHTML.includes('请填写'));

console.log('');
console.log('=== 4. 收藏逻辑 ===');
const favTarget = 'demo-1';
check('初始未收藏', !store.isFavorite(favTarget));
click(mkBtn('toggle-fav', favTarget));
check('点击后变为已收藏', store.isFavorite(favTarget));
click(mkBtn('toggle-fav', favTarget));
check('再次点击取消收藏', !store.isFavorite(favTarget));

console.log('');
console.log('=== 5. 留言逻辑 ===');
registry['comment-input'].value = '场地确认了吗？还缺人吗？';
click(mkBtn('add-comment', 'demo-2'), { onApp: false });
const comments = store.getComments('demo-2');
check('留言已写入', comments.length === 1, `(${comments.length} 条)`);
check('留言内容正确', comments[0]?.text === '场地确认了吗？还缺人吗？');

console.log('');
console.log('=== 6. 空留言应被拒绝 ===');
registry['comment-input'].value = '   ';
click(mkBtn('add-comment', 'demo-2'), { onApp: false });
check('空白留言不写入', store.getComments('demo-2').length === 1);

console.log('');
console.log('=== 7. 举报逻辑 ===');
check('初始未举报', !store.hasReported('demo-2'));
click(mkBtn('report', 'demo-2'), { onApp: false });
check('举报已记录', store.hasReported('demo-2'));
check('重复举报不叠加', store.getReports().filter((r) => r.itemId === 'demo-2').length === 1);

console.log('');
console.log('=== 8. 删除自己的发布 ===');
const mineCount = store.getUserItems().length;
const mineId = store.getUserItems()[0]?.id;
click(mkBtn('delete-mine', mineId), { onApp: false });
check('删除后数量减少', store.getUserItems().length === mineCount - 1, `(${mineCount} → ${store.getUserItems().length})`);

console.log('');
console.log('=== 9. 界面偏好持久化 ===');
click(mkBtn('board', 'official'));
check('板块选择已保存', store.getUiPrefs().board === 'official');
click(mkBtn('timeline-scope', 'all'));

console.log('');
console.log('=== 10. 动画是否真的被触发 ===');
const animTotal = () => appEl.animations.length + modalHost.animations.length
  + animationProbe.animations.length
  + (registry.app.querySelector('.modal')?.animations.length || 0);
const before10 = animTotal();
click(mkBtn('toggle-fav', 'demo-3'));
const after10 = animTotal();
check('收藏操作触发了动画调用', after10 > before10, `(${before10} → ${after10} 次)`);

// 弹层关闭也应带动画（先加 is-closing，再清理）
registry['modal-host']._listeners.click?.forEach(() => {});
const mask = modalHost.querySelector('.modal-mask');
const beforeClose = mask.animations.length;
click(mkBtn('close-modal'), { onApp: false });
check('关闭弹层先播放退场动画', mask.classList.contains('is-closing') || mask.animations.length > beforeClose,
  `(is-closing=${mask.classList.contains('is-closing')})`);

console.log('');
console.log('=== 11. 打开详情弹层（此前 ReferenceError 就在这条路径上）===');
// 先恢复筛选：第 9 项把板块切成了「官方」，而 demo-2 / demo-4 属于学生自发，
// 不在筛选结果内会导致"弹层找不到条目"而无法打开——那是数据被筛掉，不是 bug。
click(mkBtn('board', 'all'));
let opened = 0, openFailed = [];
for (const id of ['demo-1', 'demo-2', 'demo-3', 'demo-4', 'demo-5']) {
  try {
    modalHost.innerHTML = '';
    modalHost._cachedSel = {};
    click(mkCard(id));                     // 卡片用 div，模拟真实结构
    const html = modalHost.innerHTML;
    if (html.length > 300) opened++;
    else openFailed.push(`${id}(过短 ${html.length})`);
  } catch (err) {
    openFailed.push(`${id}(${err.message})`);
  }
}
check('五条信息均能打开详情弹层', opened === 5 && openFailed.length === 0,
  `成功 ${opened}/5${openFailed.length ? ' 失败: ' + openFailed.join(', ') : ''}`);

// 含 AI 条目的详情：
// 注意 AI 模块按设计默认折叠（"非主动点击不触发"），
// 因此未展开时只有折叠入口，展开后才渲染内容。
modalHost.innerHTML = '';
modalHost._cachedSel = {};
click(mkCard('demo-1'));
const collapsed = modalHost.innerHTML;
check('详情内 AI 折叠入口已渲染', /ai-embed/.test(collapsed) && /ai-embed-head/.test(collapsed));
check('折叠态下不渲染 AI 内容（非主动点击不触发）', !/ai-embed-body/.test(collapsed));

// 展开 AI 区块。注意 ai-toggle 是"开关"：点一次展开、再点一次折叠，
// 因此这里只能点一次，否则会折叠回去导致断言失败。
const toggle = mkBtn('ai-toggle');
toggle.dataset.panel = 'detail';
modalHost._cachedSel = {};
click(toggle, { onApp: false });
const expanded = modalHost.innerHTML;
check('展开后渲染 AI 内容', /ai-embed-body/.test(expanded));
check('AI 内容带生成标注', /ai-mark/.test(expanded));

console.log('');
console.log(`结论：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
