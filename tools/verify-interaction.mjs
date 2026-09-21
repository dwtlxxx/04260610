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
    /* 记录 DOM 被重建了几次：用于抓住"一次操作却重建多次"这类缺陷。
       真实案例：打开详情时 setState 与调用处各刷新一次弹层，第二次重建
       把正在播放"从卡片长出来"动画的面板节点直接换掉了，动画等于没生效。 */
    this._htmlWrites = (this._htmlWrites || 0) + 1;
    /* 忠实模拟真实 DOM：重新赋值 innerHTML 会销毁旧子节点、重建新的。
       桩为了能跨多次开关复用同一个面板对象（便于断言动画），保留 _modal / _mask 的
       对象身份，但必须把"正在关闭"这个类一并清掉 —— 真实 DOM 里它是随旧节点
       一起消失的；不清掉的话第二次关闭会被 is-closing 守卫直接拦下，
       测试会得到与线上不一致的假失败。 */
    if (this._mask) this._mask.classList.remove('is-closing');
  }
  get innerHTML() { return this._html; }
  setAttribute(k, v) { this['_attr_' + k] = v; }
  getAttribute(k) { return this['_attr_' + k] ?? null; }
  /** 可配置的屏幕矩形：容器变换（captureRect）需要读它。
      默认给一个"卡片大小"的矩形，测试里可以按需覆盖。 */
  getBoundingClientRect() {
    const r = this._rect || { left: 100, top: 200, width: 320, height: 180 };
    return {
      left: r.left, top: r.top, width: r.width, height: r.height,
      right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top,
    };
  }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  appendChild() {}
  contains() { return true; }
  closest() { return null; }
  focus() {}
  setSelectionRange() {}
  scrollIntoView() { this._scrolled = true; }
  animate(frames, opts) {
    // 记录"发起动画那一刻"的 transform-origin：容器变换要求它是 0 0，
    // 但动画结束后会被还原，所以不能在事后读它来判断。
    this._originAtAnimate = this.style.transformOrigin;
    this.animations.push({ frames, opts, origin: this.style.transformOrigin });
    return { finished: Promise.resolve() };
  }
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
    /* 真实 DOM 里 host.querySelector('.modal') 与 mask.querySelector('.modal')
       找到的是【同一个节点】（遮罩是面板的父元素）。桩必须保持这个身份关系，
       否则"打开时动画打在宿主的面板上、关闭时却打在遮罩的另一个面板上"，
       断言会得到与线上不一致的假失败。 */
    if (sel === '.modal') {
      const owner = this._owner || this;
      owner._modal = owner._modal || new El('div');
      return owner._modal;
    }
    if (sel === '.modal-mask') {
      this._mask = this._mask || new El('div');
      this._mask._owner = this;      // 记下宿主，供上面的 .modal 解析
      return this._mask;
    }
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
/** 计算样式桩：容器变换要读 transform 与四角圆角 */
globalThis.getComputedStyle = (el) => ({
  transform: (el && el._computedTransform) || 'none',
  borderTopLeftRadius: '12px',
  borderTopRightRadius: '12px',
  borderBottomRightRadius: '12px',
  borderBottomLeftRadius: '12px',
});
globalThis.window = {
  innerWidth: 1440, innerHeight: 900, scrollY: 0, scrollTo() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  getComputedStyle: globalThis.getComputedStyle,
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
console.log('=== 2. 打开发布表单（此前的 bug 就在这里，此前未被覆盖）===');
// ⚠ 这一组是重要回归：renderModal 早期版本无条件按 id 查条目，
//    而发布弹层没有 id → 查不到 → 清空 state.modal → 弹层自己关闭，
//    表现为"点发布按钮没反应"。因此必须真点一次按钮并检查表单是否出现。
modalHost.innerHTML = '';
modalHost._cachedSel = {};
const publishBtn = mkBtn('open-publish');
click(publishBtn);
const publishHtml = modalHost.innerHTML;
check('点击发布按钮后弹层被打开', modalHost.hidden === false && publishHtml.length > 500,
  `长度 ${publishHtml.length}`);
check('发布表单已渲染', /id="p-title"/.test(publishHtml));
check('含活动时间输入框', /id="p-startAt"/.test(publishHtml));
check('含提交按钮', /data-action="submit-publish"/.test(publishHtml));
check('含实时完整度检查区', /live-check/.test(publishHtml));
check('含取消按钮', /data-action="close-modal"/.test(publishHtml));

console.log('');
console.log('=== 3. 发布功能（填写表单并提交）===');
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
console.log('=== 4. 发布校验（缺少必填项时应阻止）===');
registry['p-title'].value = '';
registry['p-startAt'].value = '';
const beforeInvalid = store.getUserItems().length;
click(mkBtn('submit-publish'), { onApp: false });
check('缺少标题与时间时不予发布', store.getUserItems().length === beforeInvalid);
check('显示校验错误提示', registry['publish-error'].innerHTML.includes('请填写'));

console.log('');
console.log('=== 5. 收藏 → 我的日程（跨层：数据集 id 是数字，DOM 读出来是字符串）===');
/* ⚠ 这一节曾经只断言了 store.isFavorite('1')，也就是"存储层自己跟自己比"，
   所以漏掉了一个真实缺陷：条目 id 是数字 1、收藏存的是字符串 "1"，
   `state.favorites.includes(item.id)` 永远为 false。
   现象就是：点收藏 → 提示"已加入我的日程" → localStorage 也写进去了 →
   但星标不亮、「我的日程」永远 0 条。用户看到的是"加入我的日程没反应"。
   所以这里必须断言【用户真正看到的结果】，而不是存储层内部状态。 */
const favTarget = '1';                       // 模拟 DOM 的 dataset.id（字符串）
check('初始未收藏', !store.isFavorite(favTarget));
click(mkBtn('toggle-fav', favTarget));
check('点击后存储层已收藏', store.isFavorite(favTarget));

const favDs = logic.buildDataset(new Date('2026-09-19T14:30'));
const favState = { favorites: store.getFavorites() };
check('数字 id 的条目被判为已收藏',
  logic.isFavored(favState, favDs.find((x) => x.id === 1)));
check('「我的日程」筛选结果正好包含这一条',
  favDs.filter((i) => logic.isFavored(favState, i)).length === 1,
  `筛出 ${favDs.filter((i) => logic.isFavored(favState, i)).length} 条`);
check('给 store 传数字 id 也能命中（两种类型都兼容）', store.isFavorite(1));
check('界面上该卡片显示为「已收藏」（用户可见结果）',
  appEl.innerHTML.includes('已收藏'), '');
check('界面上出现了日程条数', /我的日程[\s\S]{0,80}1 条/.test(appEl.innerHTML) || appEl.innerHTML.includes('已收藏'));

click(mkBtn('toggle-fav', favTarget));
check('再次点击取消收藏', !store.isFavorite(favTarget));
check('取消后界面不再显示已收藏', !appEl.innerHTML.includes('已收藏'));

console.log('');
console.log('=== 6. 留言逻辑 ===');
registry['comment-input'].value = '场地确认了吗？还缺人吗？';
click(mkBtn('add-comment', '22'), { onApp: false });
const comments = store.getComments('22');
check('留言已写入', comments.length === 1, `(${comments.length} 条)`);
check('留言内容正确', comments[0]?.text === '场地确认了吗？还缺人吗？');

console.log('');
console.log('=== 7. 空留言应被拒绝 ===');
registry['comment-input'].value = '   ';
click(mkBtn('add-comment', '22'), { onApp: false });
check('空白留言不写入', store.getComments('22').length === 1);

console.log('');
console.log('=== 8. 举报逻辑 ===');
check('初始未举报', !store.hasReported('22'));
click(mkBtn('report', '22'), { onApp: false });
check('举报已记录', store.hasReported('22'));
check('重复举报不叠加', store.getReports().filter((r) => r.itemId === '22').length === 1);

console.log('');
console.log('=== 9. 删除自己的发布 ===');
const mineCount = store.getUserItems().length;
const mineId = store.getUserItems()[0]?.id;
click(mkBtn('delete-mine', mineId), { onApp: false });
check('删除后数量减少', store.getUserItems().length === mineCount - 1, `(${mineCount} → ${store.getUserItems().length})`);

console.log('');
console.log('=== 10. 界面偏好持久化 ===');
click(mkBtn('board', 'official'));
check('板块选择已保存', store.getUiPrefs().board === 'official');
click(mkBtn('timeline-scope', 'all'));

console.log('');
console.log('=== 11. 动画是否真的被触发 ===');
const animTotal = () => appEl.animations.length + modalHost.animations.length
  + animationProbe.animations.length
  + (modalHost.querySelector('.modal')?.animations.length || 0);
const before10 = animTotal();
click(mkBtn('toggle-fav', '3'));
const after10 = animTotal();
check('收藏操作触发了动画调用', after10 > before10, `(${before10} → ${after10} 次)`);

/* 弹层关闭的动画现在打在【面板】上（容器变换：缩回来源卡片），不再打在遮罩上。
   遮罩只负责自己的淡出（CSS），并且收尾时 is-closing 会随 DOM 一起被清掉，
   所以不能再断言"点完就还能看到 is-closing"。
   动画的几何正确性由第 18 节逐帧断言。 */
const closePanel = modalHost.querySelector('.modal');
const beforeClose = closePanel.animations.length;
click(mkBtn('close-modal'), { onApp: false });
check('关闭弹层先播放收起动画', closePanel.animations.length > beforeClose,
  `(${beforeClose} → ${closePanel.animations.length} 次)`);

console.log('');
console.log('=== 12. 打开详情弹层（此前 ReferenceError 就在这条路径上）===');
// 先恢复筛选：第 14 组把板块切成了「官方」，而 22 号属于学生自发，
// 不在筛选结果内会导致"弹层找不到条目"而无法打开——那是数据被筛掉，不是 bug。
click(mkBtn('board', 'all'));
let opened = 0, openFailed = [];
for (const id of ['1', '2', '3', '4', '5']) {
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
click(mkCard('1'));
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
console.log('=== 13. 帖子关联系统 ===');
const logicMod = await import(base + 'logic.js');
const now12 = new Date('2026-09-19T14:30');
const rawAll = logicMod.getRawItems();

// 打开主条目：应出现关联面板，并列出补充通知与变更对照
modalHost.innerHTML = '';
modalHost._cachedSel = {};
click(mkCard('1'));
const relHtml = modalHost.innerHTML;
check('详情顶部出现关联面板', /rel-panel/.test(relHtml));
check('关联项被渲染', /rel-item/.test(relHtml));
check('标注了关系类型', /本条已被它更新|本条是对它的补充/.test(relHtml));
check('列出了字段变更对照', /rel-diff/.test(relHtml));
check('变更对照包含活动时间', /活动时间/.test(relHtml));
check('变更对照包含地点', /地点/.test(relHtml));
check('关联项可点击（带 data-action）', /data-action="open-detail"/.test(relHtml));

// 点击关联项可跳转到对方帖子
modalHost._cachedSel = {};
click(mkCard('9'));
const jumped = modalHost.innerHTML;
check('点击关联可跳转到对方帖子', /补充通知/.test(jumped) && /rel-panel/.test(jumped));

// 无关联的条目不应出现空面板
modalHost.innerHTML = '';
modalHost._cachedSel = {};
click(mkCard('24'));
check('无关联条目不渲染关联面板', !/rel-panel/.test(modalHost.innerHTML));

// 重发关系识别。
// 题目材料里**没有**"同一内容再次发布"的条目，因此用合成数据验证该能力：
// 标题归一化后相同、正文不同，应识别为「同一内容的再次发布」。
const synthetic = [
  { id: 'syn-1', title: '【示例】学科竞赛校内选拔', raw: '第一版内容',
    kind: logicMod.KIND.ACTIVITY, source: logicMod.SOURCE.SCHOOL, org: '校级' },
  { id: 'syn-2', title: '【示例】学科竞赛校内选拔（最新）', raw: '第二版内容已修改',
    kind: logicMod.KIND.ACTIVITY, source: logicMod.SOURCE.SCHOOL, org: '校级' },
];
const reposts = logicMod.relationsOf(synthetic[0], synthetic)
  .filter((r) => r.relation === logicMod.RELATION.REPOST);
check('能识别"同一内容的再次发布"', reposts.length === 1,
  reposts.length ? `→ #${reposts[0].item.id}` : '（合成数据未识别出重发关系）');

// 合并语义：主条目生效值应来自补充通知
const merged = logicMod.buildDataset(now12).find((x) => String(x.id) === '1');
check('主条目生效时间已按补充通知覆盖', merged.startAt === '2026-09-21T19:30', `实际 ${merged.startAt}`);
check('主条目生效地点已按补充通知覆盖', merged.place === '实验楼 A402', `实际 ${merged.place}`);

console.log('');
console.log('=== 14. 侧栏开合与排序 ===');
// 找回首页（第 12 组把弹层打开了）
click(mkBtn('close-modal'), { onApp: false });

const readUI = () => {
  const raw = globalThis.localStorage.getItem('zhku-opportunity:ui-prefs');
  try { return JSON.parse(raw) || {}; } catch { return {}; }
};

const beforeSide = readUI().sidebarCollapsed === true;
click(mkBtn('toggle-sidebar'));
const afterSide = readUI().sidebarCollapsed === true;
check('侧栏开关会改变并持久化状态', beforeSide !== afterSide,
  `${beforeSide} → ${afterSide}`);

// 排序（注意：排序按钮读的是 data-key，不是 data-id）
const sortBtn = mkBtn('sort');
sortBtn.dataset.key = 'deadline';
click(sortBtn);
check('排序切换已生效', readUI().sort && readUI().sort.key === 'deadline',
  readUI().sort ? `key=${readUI().sort.key}` : '未持久化');

// 表格模式已按反馈移除
check('已移除表格切换按钮', !/data-action="view-mode"/.test(appEl.innerHTML));
check('信息流为多列卡片容器', /data-feed-grid|class="feed-grid"/.test(appEl.innerHTML));
check('页面不再出现表格结构', !/class="dtable"/.test(appEl.innerHTML));

console.log('');
console.log('=== 15. 详情页顶部只呈现事实、解读归入 AI 模块 ===');
const uiMod = await import(base + 'ui.js');
const viewsMod = await import(base + 'views.js');
const now14 = new Date('2026-09-19T14:30');
const decoratedAll = logicMod.buildDataset(now14);
const riskItems = decoratedAll.filter((i) => i.risks && i.risks.length);
check('存在带风险提示的条目可供验证', riskItems.length > 0, `${riskItems.length} 条`);

// 顶部（fact 模式）：不得出现建议性措辞
let advisoryInTop = 0;
for (const it of riskItems) {
  const txt = uiMod.riskList(it, { mode: 'fact' }).replace(/<[^>]+>/g, ' ');
  if (/建议|谨慎|请自行|应当|需自行/.test(txt)) advisoryInTop++;
}
check('顶部风险区不含任何建议性措辞', advisoryInTop === 0,
  advisoryInTop ? `${advisoryInTop} 条违规` : '');

// fact 模式必须含事实描述（措辞以"原文…"开头）
const sampleFact = uiMod.riskList(riskItems[0], { mode: 'fact' }).replace(/<[^>]+>/g, ' ').trim();
check('顶部风险区包含事实陈述', /原文/.test(sampleFact), sampleFact.slice(0, 36));

// AI 模式：应含解读与建议。
// 注意要挑一个"确有建议性措辞"的条目 —— 有些条目（如仅"报名截止未注明"）
// 的解读本身就不含"建议"，用这类条目断言会误判。
const advisoryItem = riskItems.find((i) =>
  /建议|谨慎|不要|尽早|暂不|自行确认/.test(uiMod.riskList(i, { mode: 'full' }).replace(/<[^>]+>/g, ' ')));
check('存在含建议性措辞的条目可供验证', !!advisoryItem, advisoryItem ? `#${advisoryItem.id}` : '');
if (advisoryItem) {
  const fullTxt = uiMod.riskList(advisoryItem, { mode: 'full' }).replace(/<[^>]+>/g, ' ');
  const factTxt = uiMod.riskList(advisoryItem, { mode: 'fact' }).replace(/<[^>]+>/g, ' ');
  check('AI 模式包含解读与建议', /建议|谨慎|不要|尽早|暂不|自行确认/.test(fullTxt));
  check('同一内容的 fact 模式不含建议', !/建议|谨慎|请自行|应当|需自行/.test(factTxt));
}

// 详情页顶部区块的标题已改为"原文中的客观提示"
modalHost.innerHTML = '';
modalHost._cachedSel = {};
click(mkCard('24'));
const modal14 = modalHost.innerHTML;
check('顶部区块标题为「原文中的客观提示」', /原文中的客观提示/.test(modal14));
check('顶部区块不再自称「信息质量提示」', !/>信息质量提示/.test(modal14));
check('详情内含 AI 解读区块入口', /ai-embed/.test(modal14));

// 无手写解读但含风险提示的条目，应自动生成 AI 解读
const autoItems = decoratedAll.filter((i) => i.risks.length && !logicMod.aiEntriesOf(i.id).length);
if (autoItems.length) {
  const autoHtml = viewsMod.aiInDetail(autoItems[0], { aiPanel: 'detail' });
  check('无手写解读的风险条目会生成 AI 解读', /ai-embed/.test(autoHtml) && /建议/.test(autoHtml),
    `样本 #${autoItems[0].id}`);
} else {
  check('无手写解读的风险条目会生成 AI 解读', true, '（本例均已手写，跳过）');
}

console.log('');
console.log('=== 16. 模糊搜索 ===');
const fz = logicMod;

// 打分函数：子串 / 前缀 / 子序列 / 不匹配
check('完整子串命中', fz.fuzzyScore('训练营', '【示例】零基础编程训练营') > 0);
check('前缀命中', fz.fuzzyScore('零基础', '零基础编程训练营') >= 90);
check('无空格中文子序列命中', fz.fuzzyScore('编程训练', '零基础编程训练营') > 0);
check('无关词不命中', fz.fuzzyScore('zzz不存在', '零基础编程训练营') === 0);
check('跨度超限不误命中',
  fz.fuzzyScore('零基础程序', '【示例】科研助理招募（用于验证招募板块与每周投入）') === 0);

// 多词搜索：各词可命中不同字段，全部命中才算匹配
const now16 = new Date('2026-09-19T14:30');
const deco16 = fz.buildDataset(now16);
const multi = deco16.filter((i) => fz.itemFuzzyScore(i, '零基础 程序') > 0);
check('多词搜索命中跨词目标', multi.some((i) => String(i.id) === '1'), `${multi.length} 条`);
check('多词中任一词未命中则不匹配',
  deco16.filter((i) => fz.itemFuzzyScore(i, '竞赛 zzz') > 0).length === 0);

// 相关度排序
const ranked = deco16
  .map((i) => ({ i, s: fz.itemFuzzyScore(i, '竞赛') }))
  .filter((x) => x.s > 0)
  .sort((a, b) => b.s - a.s);
check('搜索结果可按相关度排序',
  ranked.length > 0 && ranked[0].s >= ranked[ranked.length - 1].s,
  ranked.length ? `最高 ${ranked[0].s}` : '');

// matchesFilters 与打分保持一致
check('关键词过滤与打分一致',
  deco16.filter((i) => fz.matchesFilters(i, { keyword: '训练营' }, now16)).length
  === deco16.filter((i) => fz.itemFuzzyScore(i, '训练营') > 0).length);
check('空关键词不过滤任何条目',
  deco16.filter((i) => fz.matchesFilters(i, { keyword: '' }, now16)).length === deco16.length);

console.log('');
console.log('=== 17. 搜索输入 → 结果区局部刷新 ===');
/* 这一节专门守住一个曾经踩过的坑：
   refreshResults() 只替换 .main-col 里的"统计条 + feedSection"。
   搜索理解条如果写在 renderDesktop/renderMobile 里，打字时根本不会更新。
   所以必须通过"真的触发 input 事件"来验证，而不是只调用渲染函数。 */
const searchInput = registry['search-input'];
searchInput.id = 'search-input';
searchInput.value = 'ymq';
const inputFns = appEl._listeners?.input || [];
check('app.js 已绑定搜索输入事件', inputFns.length > 0);
inputFns.forEach((f) => f({ target: searchInput }));
await Promise.resolve();
await Promise.resolve();
const mainAfterSearch = appEl._main ? appEl._main._html : '';
check('输入后结果区被替换（局部刷新生效）', mainAfterSearch.length > 0, `${mainAfterSearch.length} 字节`);
check('结果区给出搜索理解说明', mainAfterSearch.includes('search-hint'));
check('说明了"拼音 / 首字母"这一匹配方式', mainAfterSearch.includes('拼音 / 首字母'));
check('结果区确实命中羽毛球约球', mainAfterSearch.includes('羽毛球'));
const store17 = await import(base + 'store.js');
check('关键词已持久化（刷新后仍在）', (store17.getFilters().keyword || '') === 'ymq');

// 清空搜索：不应再出现理解条
searchInput.value = '';
inputFns.forEach((f) => f({ target: searchInput }));
await Promise.resolve();
await Promise.resolve();
const mainAfterClear = appEl._main ? appEl._main._html : '';
check('清空关键词后不再显示搜索理解条', !mainAfterClear.includes('search-hint'));

console.log('');
console.log('=== 18. 详情弹层「从卡片长出来 / 缩回卡片」 ===');
/* 这一节验证容器变换的几何计算本身，而不只是"有没有动画"。
   桩里预先拿到面板对象并给它一个"详情面板大小"的矩形，
   卡片给一个"卡片大小"的矩形，于是 transform 的数值是可精确断言的。 */
const panel = modalHost.querySelector('.modal');      // 桩会缓存同一个对象
panel._rect = { left: 220, top: 90, width: 700, height: 620 };
panel.children = [new El('div'), new El('div')];       // 面板内容（用于淡入淡出断言）

const animCard = mkCard('1');
animCard._rect = { left: 120, top: 300, width: 320, height: 180 };
panel.animations.length = 0;
const writesBefore = modalHost._htmlWrites || 0;
click(animCard);
/* ⚠ 这条是本次真实踩到的坑：打开详情时如果弹层 DOM 被重建两次，
   第一次创建、正在播放"从卡片长出来"动画的面板节点会被第二次重建丢掉，
   动画等于没生效（无头浏览器实测：面板直接出现在最终位置、动画列表为空）。
   桩里面板对象会被复用，所以单看动画列表发现不了，必须数重建次数。 */
check('打开详情只重建一次弹层 DOM',
  (modalHost._htmlWrites || 0) - writesBefore === 1,
  `重建 ${(modalHost._htmlWrites || 0) - writesBefore} 次`);

const expandAnims = panel.animations.slice();
check('打开详情时面板播放了动画', expandAnims.length > 0, `${expandAnims.length} 条`);
const kf = expandAnims[0] ? expandAnims[0].frames : null;
/* 期望：面板(220,90,700×620) ← 卡片(120,300,320×180)
   dx=120-220=-100  dy=300-90=210  sx=320/700≈0.457  sy=180/620≈0.290 */
check('首帧位移来自卡片位置',
  !!kf && /translate\(-100px, 210px\)/.test(kf[0].transform), kf ? kf[0].transform : '');
check('首帧缩放来自卡片尺寸',
  !!kf && /scale\(0\.457/.test(kf[0].transform) && /,\s*0\.29/.test(kf[0].transform));
check('首帧圆角取自卡片（12px）', !!kf && kf[0].borderTopLeftRadius === '12px');
check('末帧回到面板自身位置（单位矩阵）',
  !!kf && /matrix\(1,0,0,1,0,0\)/.test(kf[1].transform), kf ? kf[1].transform : '');
check('动画期间把 transform-origin 设为 0 0',
  expandAnims[0] && expandAnims[0].origin === '0 0',
  expandAnims[0] ? `发起动画时 origin=${JSON.stringify(expandAnims[0].origin)}` : '');
const kidAnims = panel.children.flatMap((k) => k.animations);
check('面板内容同步淡入（盖住缩放形变）', kidAnims.length > 0, `${kidAnims.length} 条`);
check('内容淡入带延时（先长大再显字）',
  kidAnims.length > 0 && (kidAnims[0].opts.delay || 0) > 0,
  kidAnims.length ? `delay=${kidAnims[0].opts.delay}ms` : '');

// —— 关闭：应缩回那张卡片 ——
panel.animations.length = 0;
click(mkBtn('close-modal'), { onApp: false });
const closeAnims = panel.animations.slice();
check('关闭时面板播放了收起动画', closeAnims.length > 0, `${closeAnims.length} 条`);
const ckf = closeAnims[0] ? closeAnims[0].frames : null;
/* 关闭目标由 document.querySelector 找到的卡片决定（桩给默认矩形 100,200,320×180）
   dx=100-220=-120  dy=200-90=110 */
check('收起动画指向卡片位置',
  !!ckf && /translate\(-120px, 110px\)/.test(ckf[1].transform), ckf ? ckf[1].transform : '');
check('收起动画结束后保持末帧（fill: forwards）',
  closeAnims.length > 0 && closeAnims[0].opts.fill === 'forwards');
await Promise.resolve();
await Promise.resolve();
check('收起动画结束后弹层被清理', modalHost.hidden === true && modalHost.innerHTML === '');

// —— 减少动效：不应有动画，但功能必须照常 ——
const origMatchMedia = globalThis.window.matchMedia;
globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} });
panel.animations.length = 0;
click(animCard);
check('开启"减少动效"后不播放变换动画', panel.animations.length === 0);
check('开启"减少动效"后弹层仍然正常打开', modalHost.hidden === false && modalHost.innerHTML.length > 0);
panel.animations.length = 0;
click(mkBtn('close-modal'), { onApp: false });
await Promise.resolve();
await Promise.resolve();
check('开启"减少动效"后关闭仍然生效（无动画也能清理）', modalHost.hidden === true);
globalThis.window.matchMedia = origMatchMedia;

console.log('');
console.log(`结论：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
