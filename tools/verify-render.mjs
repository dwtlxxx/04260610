/**
 * verify-render.mjs —— 渲染问题审查器
 *
 * 用途：在浏览器之外，用静态分析 + 实际渲染结果，找出容易被忽略的渲染缺陷。
 * 检查项：
 *   1. CSS 变量：引用了但未定义（会导致颜色回退为 inherit/透明，界面看起来很"怪"）
 *   2. CSS 类：JS 里用到的 class 是否真的在 CSS 中定义（写了但没样式 = 白写）
 *   3. HTML 标签配平：渲染结果中 div/section/article 等是否成对
 *   4. 重复 id：同一份渲染结果中出现重复 id（会导致 label/getElementById 取错）
 *   5. 空链接 / 空按钮：href="#"、无文本按钮
 *   6. 转义检查：用户可控内容是否可能造成 HTML 破损
 *   7. 特定路径渲染：我的 / 说明 / 各板块 / 时间线 均能渲染出内容
 *
 * 用法：node tools/verify-render.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'assets', 'js');
const cssDir = path.join(root, 'assets', 'css');

const css = fs.readdirSync(cssDir).map((f) => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n');
const jsAll = fs.readdirSync(jsDir).map((f) => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');

const issues = [];
const note = (level, msg) => issues.push({ level, msg });

/* ============================================================
 * 1. CSS 变量：定义了哪些、用了哪些
 * ============================================================ */
const definedVars = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const usedVars = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
const undefinedVars = [...usedVars].filter((v) => !definedVars.has(v));
console.log('=== 1. CSS 变量检查 ===');
console.log(`  定义 ${definedVars.size} 个，使用 ${usedVars.size} 个`);
if (undefinedVars.length) {
  undefinedVars.forEach((v) => note('error', `CSS 变量 ${v} 被使用但未定义`));
  console.log(`  ✗ 未定义: ${undefinedVars.join(', ')}`);
} else {
  console.log('  ✓ 无未定义变量');
}

/* ============================================================
 * 1.5 CSS 动画名：animation 引用的 @keyframes 必须存在
 *
 * 为什么要单独查这条：CSS 对"引用了不存在的 keyframes"是**完全静默**的 ——
 * 不报错、不警告，元素只是不再有动画。清理 .modal 动画时就误删过 sheetIn/slideUp，
 * 导致手机端 AI 抽屉打开变成"啪"地出现，直到用无头浏览器逐帧测量才发现。
 * 同时倒查"定义了但没人用"的 keyframes，避免死代码堆积。
 * ============================================================ */
const definedKeyframes = new Set([...css.matchAll(/@keyframes\s+([A-Za-z][\w-]*)/g)].map((m) => m[1]));
const usedAnimations = new Set(
  [...css.matchAll(/animation\s*:\s*([^;{}]+)/g)]
    .flatMap((m) => m[1].split(','))
    .map((part) => part.trim().split(/\s+/)[0])
    // 过滤掉 none / 变量 / 时间值等非动画名
    .filter((n) => n && /^[A-Za-z][\w-]*$/.test(n) && !['none', 'inherit', 'initial', 'unset'].includes(n)),
);
const missingKeyframes = [...usedAnimations].filter((n) => !definedKeyframes.has(n));
const unusedKeyframes = [...definedKeyframes].filter((n) => !usedAnimations.has(n));
console.log('');
console.log('=== 1.5 CSS 动画名检查 ===');
console.log(`  定义 ${definedKeyframes.size} 个，引用 ${usedAnimations.size} 个`);
if (missingKeyframes.length) {
  missingKeyframes.forEach((n) => note('error', `animation 引用了不存在的 @keyframes: ${n}`));
  console.log(`  ✗ 引用了但未定义: ${missingKeyframes.join(', ')}（该动画会静默失效）`);
} else {
  console.log('  ✓ 所有 animation 都有对应的 @keyframes');
}
if (unusedKeyframes.length) {
  console.log(`  ! 定义了但没被引用（可清理）: ${unusedKeyframes.join(', ')}`);
}

/* ============================================================
 * 2. JS 中用到的 class 是否在 CSS 中有定义
 * ============================================================ */
// 仅检查形如 class="a b c" 的静态字符串中出现的自定义类（排除框架/工具类与动态拼接）
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const jsClassAttrs = [...jsAll.matchAll(/class="([^"$`]+)"/g)].map((m) => m[1]);
const jsClasses = new Set();
for (const attr of jsClassAttrs) {
  for (const c of attr.split(/\s+/)) {
    if (c) jsClasses.add(c);
  }
}
const orphanClasses = [...jsClasses].filter((c) => !cssClasses.has(c));
console.log('');
console.log('=== 2. JS 使用但 CSS 未定义的 class ===');
if (orphanClasses.length) {
  orphanClasses.forEach((c) => note('warn', `class "${c}" 在 JS 中使用但 CSS 中无定义`));
  console.log(`  ! ${orphanClasses.join(', ')}`);
} else {
  console.log('  ✓ 全部有定义');
}

/* ============================================================
 * 3. DOM 桩 + 真实渲染（覆盖各路由与板块）
 * ============================================================ */
function makeEl() {
  return {
    innerHTML: '', hidden: false, style: {}, dataset: {}, value: '', checked: false,
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, getAttribute: () => null, addEventListener() {}, removeEventListener() {},
    appendChild() {}, contains: () => true, closest: () => null,
    focus() {}, setSelectionRange() {}, scrollIntoView() {},
    querySelector: () => null, querySelectorAll: () => [],
  };
}
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
};
globalThis.window = {
  innerWidth: 1440, scrollY: 0, scrollTo() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  addEventListener() {},
};
const appEl = makeEl();
globalThis.document = {
  documentElement: makeEl(), body: makeEl(),
  getElementById: (id) => (id === 'app' ? appEl : makeEl()),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, activeElement: null,
};
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.setInterval = () => 0;
globalThis.setTimeout = () => {};

const base = pathToFileURL(jsDir).href + '/';
const logic = await import(base + 'logic.js');
const views = await import(base + 'views.js');
const store = await import(base + 'store.js');

const now = new Date('2026-09-19T14:30');
const data = logic.visibleItems(logic.buildDataset(now));

function makeState(patch = {}) {
  const s = {
    route: 'feed', board: logic.BOARD.ALL, device: 'desktop', viewMode: 'auto',
    quick: 'all', activeTags: [], filters: { keyword: '' }, sort: { key: 'smart', dir: 'asc' },
    favorites: [], selected: [], now, modal: null,
    totalCount: data.length, tagCloud: logic.tagCloud(data),
    summarize: logic.summarize, getResolvedTheme: () => 'light', themeModeLabel: '跟随系统',
    ...patch,
  };
  return s;
}

function renderWith(patch, device) {
  const s = makeState(patch);
  return device === 'mobile' ? views.renderMobile(s, data) : views.renderDesktop(s, data);
}

const scenarios = [
  ['电脑端-全部', {}, 'desktop'],
  ['电脑端-官方板块', { board: logic.BOARD.OFFICIAL }, 'desktop'],
  ['电脑端-学生自发板块', { board: logic.BOARD.STUDENT }, 'desktop'],
  ['电脑端-时间线', { board: logic.BOARD.TIMELINE }, 'desktop'],
  ['电脑端-我的', { route: 'mine' }, 'desktop'],
  ['电脑端-说明', { route: 'about' }, 'desktop'],
  ['电脑端-紧急筛选', { quick: 'urgent' }, 'desktop'],
  ['电脑端-带标签', { activeTags: ['竞赛'] }, 'desktop'],
  ['电脑端-搜索无结果', { filters: { keyword: 'zzzz不存在' } }, 'desktop'],
  ['手机端-全部', {}, 'mobile'],
  ['手机端-官方板块', { board: logic.BOARD.OFFICIAL }, 'mobile'],
  ['手机端-时间线', { board: logic.BOARD.TIMELINE }, 'mobile'],
  ['手机端-我的', { route: 'mine' }, 'mobile'],
  ['手机端-说明', { route: 'about' }, 'mobile'],
];

console.log('');
console.log('=== 3. 各路径渲染结果 ===');
let emptyCount = 0;
const results = {};
for (const [name, patch, device] of scenarios) {
  let html = '';
  try {
    html = renderWith(patch, device);
  } catch (e) {
    note('error', `${name} 渲染抛异常: ${e.message}`);
    console.log(`  ✗ ${name} 抛异常: ${e.message}`);
    continue;
  }
  results[name] = html;
  const hasContent = html.length > 500;
  const isEmpty = /class="empty"/.test(html) && !/card |dtable/.test(html);
  if (!hasContent) { note('error', `${name} 渲染结果过短(${html.length})`); }
  if (isEmpty) emptyCount++;
  console.log(`  ${hasContent ? '✓' : '✗'} ${name.padEnd(18)} ${String(html.length).padStart(7)} 字节${isEmpty ? '  (空状态)' : ''}`);
}
if (emptyCount > 6) note('warn', `有 ${emptyCount} 个路径显示空状态，可能筛选逻辑过严`);

/* ============================================================
 * 4. 标签配平
 * ============================================================ */
console.log('');
console.log('=== 4. HTML 标签配平检查 ===');
const PAIRED = ['div', 'section', 'article', 'nav', 'aside', 'header', 'footer', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'span', 'form'];
for (const [name, html] of Object.entries(results)) {
  const bad = [];
  for (const tag of PAIRED) {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) bad.push(`${tag}(${open}/${close})`);
  }
  if (bad.length) {
    note('error', `${name} 标签不配平: ${bad.join(' ')}`);
    console.log(`  ✗ ${name}: ${bad.join(' ')}`);
  }
}
if (!issues.some((i) => i.msg.includes('标签不配平'))) console.log('  ✓ 全部路径标签配平');

/* ============================================================
 * 5. 重复 id
 * ============================================================ */
console.log('');
console.log('=== 5. 重复 id 检查 ===');
let dupFound = false;
for (const [name, html] of Object.entries(results)) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) { note('error', `${name} 重复 id: ${[...new Set(dup)].join(', ')}`); dupFound = true; }
}
console.log(dupFound ? '  ✗ 存在重复 id（见上）' : '  ✓ 无重复 id');

/* ============================================================
 * 6. 空链接与无文本按钮
 * ============================================================ */
console.log('');
console.log('=== 6. 空链接 / 空按钮检查 ===');
let emptyInteractive = 0;
for (const [name, html] of Object.entries(results)) {
  const emptyA = (html.match(/<a\s[^>]*href="#"[^>]*>\s*<\/a>/g) || []).length;
  if (emptyA) { note('warn', `${name} 有 ${emptyA} 个空链接`); emptyInteractive += emptyA; }
}
console.log(emptyInteractive ? `  ! 发现 ${emptyInteractive} 个空链接` : '  ✓ 无空链接');

/* ============================================================
 * 7. 转义安全性
 * ============================================================ */
console.log('');
console.log('=== 7. 转义安全性 ===');
const evil = {
  ...data[0], id: 'evil&1', title: '<img src=x onerror=alert(1)>', raw: '"><script>alert(2)</script>',
  notes: '<b>x</b>', org: '<i>org</i>', place: '<u>p</u>', audience: '<s>a</s>',
  tags: ['<script>t</script>'], isUserPost: true, completeness: 50, missingFields: [],
};
const evilHtml = views.renderDesktop(makeState(), [evil]) + views.renderMobile(makeState({ device: 'mobile' }), [evil]);
const evilIssues = [];
if (/<img src=x/.test(evilHtml)) evilIssues.push('title 未转义');
if (/<script>alert\(2\)/.test(evilHtml)) evilIssues.push('raw 未转义');
if (/<i>org<\/i>/.test(evilHtml)) evilIssues.push('org 未转义');
if (/<s>a<\/s>/.test(evilHtml)) evilIssues.push('audience 未转义');
if (/<script>t<\/script>/.test(evilHtml)) evilIssues.push('tags 未转义');
if (evilIssues.length) {
  evilIssues.forEach((m) => note('error', `转义缺陷: ${m}`));
  console.log(`  ✗ ${evilIssues.join('; ')}`);
} else {
  console.log('  ✓ 用户可控内容全部正确转义');
}

/* ============================================================
 * 8. 未使用的导出（清理提示，非错误）
 * ============================================================ */
console.log('');
console.log('=== 8. 未被使用的导出（可清理） ===');
const unused = [];
for (const f of fs.readdirSync(jsDir)) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  const names = [...src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  for (const n of names) {
    const refs = (jsAll.match(new RegExp(`\\b${n}\\b`, 'g')) || []).length;
    if (refs <= 1) unused.push(`${f}:${n}`);
  }
}
console.log(unused.length ? `  ! ${unused.join(', ')}` : '  ✓ 无');

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('');
const errors = issues.filter((i) => i.level === 'error');
const warns = issues.filter((i) => i.level === 'warn');
if (errors.length) {
  console.log('=== 必须修复 ===');
  errors.forEach((i) => console.log(`  ✗ ${i.msg}`));
}
if (warns.length) {
  console.log('=== 建议修复 ===');
  warns.forEach((i) => console.log(`  ! ${i.msg}`));
}
console.log('');
console.log(`结论：错误 ${errors.length} 项，警告 ${warns.length} 项`);
process.exit(errors.length ? 1 : 0);
