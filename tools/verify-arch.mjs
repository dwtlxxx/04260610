/**
 * verify-arch.mjs —— 架构自检（无需浏览器，纯 Node 运行）
 *
 * 为什么需要它：
 *   本次开发中遇到过"页面永远停在正在加载"的故障，根因是
 *   app.js 从 logic.js 导入了并不存在的导出名（ITEMS），
 *   导致 ES Module 解析失败、app.js 整文件不执行、页面无任何提示。
 *   浏览器只在控制台报错，肉眼难以发现。
 *
 * 本脚本做两件事：
 *   1. 静态校验所有 import 的导出名在目标模块中真实存在（提前抓出上述故障）
 *   2. 用 DOM 桩实际加载全部模块并渲染，确认能产出真实内容
 *
 * 用法：node tools/verify-arch.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'assets', 'js');

/* ============================================================
 * 一、静态检查：导出名一致性
 * ============================================================ */

function exportedNames(src) {
  const names = new Set();
  const reDecl = /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of src.matchAll(reDecl)) names.add(m[1]);
  const reList = /export\s*\{([^}]+)\}/g;
  for (const m of src.matchAll(reList)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  return names;
}

function importedNames(src) {
  const out = [];
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const from = m[2];
    if (!from.startsWith('./') && !from.startsWith('../')) continue;
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      out.push({ name: t.split(/\s+as\s+/)[0].trim(), from });
    }
  }
  return out;
}

const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
const exportsMap = {};
for (const f of files) {
  exportsMap['./' + f] = exportedNames(fs.readFileSync(path.join(jsDir, f), 'utf8'));
}

let problems = 0;
console.log('=== 1. 导入 / 导出一致性检查 ===');
for (const f of files) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  for (const imp of importedNames(src)) {
    const target = exportsMap[imp.from];
    if (!target) {
      console.log(`  [失败] ${f}: 找不到模块 ${imp.from}`);
      problems++;
    } else if (!target.has(imp.name)) {
      console.log(`  [失败] ${f}: 从 ${imp.from} 导入的 '${imp.name}' 并未导出`);
      problems++;
    }
  }
}
console.log(problems ? `  ✗ ${problems} 处不匹配` : '  ✓ 全部匹配');

/* ============================================================
 * 一之二、跨模块调用检查
 *
 * 背景：曾出现 `ReferenceError: aiInDetail is not defined`
 *   —— app.js 调用了定义在 views.js 的函数，但忘了 import。
 *   这类错误只在运行时（打开弹层时）才暴露，静态看代码很难发现。
 *
 * 做法：对每个模块，收集"疑似视图/逻辑层函数"的调用名，
 *       检查它是否满足以下任一条件，否则报警：
 *         ① 在本文件中定义（function xxx / const xxx = / class xxx）
 *         ② 已从其他模块 import
 *         ③ 是浏览器或 JS 内置（白名单 + 常见 DOM API 前缀）
 * ============================================================ */

const BUILTIN = new Set([
  // JS 内置
  'console', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'Date',
  'Map', 'Set', 'Promise', 'Error', 'RegExp', 'Symbol', 'parseInt', 'parseFloat',
  'isNaN', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'encodeURIComponent', 'decodeURIComponent', 'requestAnimationFrame', 'structuredClone',
  // DOM / BOM
  'document', 'window', 'localStorage', 'sessionStorage', 'CSS', 'history', 'location',
  'alert', 'confirm', 'prompt', 'getComputedStyle', 'matchMedia', 'URL', 'URLSearchParams',
  'Element', 'Node', 'Event', 'CustomEvent', 'FormData', 'Blob', 'File', 'FileReader',
  // 本项目自定义的全局（由 index.html 注入）
  '__showFatal',
]);

function localDefined(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // 函数参数与解构（粗略）
  for (const m of src.matchAll(/function\s+[\w$]*\s*\(([^)]*)\)/g)) {
    m[1].split(',').forEach((p) => { const t = p.trim().split(/[=:]/)[0].trim().replace(/^\.\.\./, ''); if (t) names.add(t); });
  }
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)) {
    m[1].split(',').forEach((p) => { const t = p.trim().split(/[=:]/)[0].trim().replace(/^\.\.\./, ''); if (t) names.add(t); });
  }
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
    m[1].split(',').forEach((p) => { const t = p.trim().split(':').pop().trim(); if (t) names.add(t); });
  }
  return names;
}

function importedAll(src) {
  const names = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    m[1].split(',').forEach((p) => {
      const t = p.trim();
      if (!t) return;
      names.add(t.split(/\s+as\s+/).pop().trim());
    });
  }
  for (const m of src.matchAll(/import\s+\*\s+as\s+([\w$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/import\s+([\w$]+)\s+from/g)) names.add(m[1]);
  return names;
}

/* 只检查"本项目的命名风格"：小驼峰且非全大写的调用名，避免误报 DOM API */
const CSS_FUNCS = new Set([
  'var', 'calc', 'rgb', 'rgba', 'hsl', 'color', 'colorMix', 'linear', 'gradient',
  'scale', 'scaleY', 'scaleX', 'translate', 'translateY', 'translateX', 'rotate',
  'blur', 'brightness', 'saturate', 'cubic', 'bezier', 'inset', 'min', 'max', 'clamp',
  'repeat', 'fit', 'content', 'url', 'format', 'local', 'minmax', 'matrix',
]);

function calledNames(src) {
  const names = new Map();
  // 排除方法调用（obj.fn()）与 CSS 函数；也排除 new X() 里的构造名
  const re = /(^|[^.\w$])([a-z][A-Za-z0-9_$]*)\s*\(/g;
  for (const m of src.matchAll(re)) {
    const n = m[2];
    if (n.length < 3) continue;
    if (CSS_FUNCS.has(n)) continue;
    names.set(n, (names.get(n) || 0) + 1);
  }
  // new Foo() 与 typeof/instanceof 后的标识符单独收集，避免误判为函数调用
  const ctorRe = /new\s+([A-Za-z_$][\w$]*)/g;
  const ctors = new Set([...src.matchAll(ctorRe)].map((m) => m[1]));
  for (const c of ctors) names.delete(c);
  return names;
}

console.log('');
console.log('=== 1b. 跨模块调用检查（未定义 / 未导入 的函数调用）===');
let crossProblems = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  const local = localDefined(src);
  const imported = importedAll(src);
  const unknown = [];
  for (const [name, count] of calledNames(src)) {
    if (BUILTIN.has(name) || local.has(name) || imported.has(name)) continue;
    // 常见关键字与 DOM 方法名过滤
    if (/^(if|for|while|switch|catch|return|typeof|await|new|function|super|this|item|list|state|dataset|events|text|name|value|key|id|type|el|fn|cb|res|req|acc|cur|next|prev|row|col|node|tag|attr|sel|args|opts|out|str|num|arr|obj|tmp|v|k|i|j|n|s|t|x|y|e|p|a|b|c|d|f|g|h|m|o|q|r|u|w|z)$/.test(name)) continue;
    unknown.push(`${name}×${count}`);
  }
  if (unknown.length) {
    console.log(`  [失败] ${f}: 可能未定义/未导入的调用 → ${unknown.join(', ')}`);
    crossProblems += unknown.length;
  }
}
console.log(crossProblems ? `  ✗ ${crossProblems} 处可疑调用` : '  ✓ 未发现未定义调用');
problems += crossProblems;

/* ============================================================
 * 二、运行时检查：DOM 桩 + 实际渲染
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
  innerWidth: Number(process.env.VW || 1440), scrollY: 0, scrollTo() {},
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

console.log('');
console.log('=== 2. 模块加载 ===');
let loadFail = 0;
for (const m of ['data.js', 'logic.js', 'store.js', 'theme.js', 'ui.js', 'views.js', 'app.js']) {
  try {
    await import(pathToFileURL(path.join(jsDir, m)).href);
  } catch (e) {
    console.log(`  [失败] ${m} :: ${e.message || e}`);
    loadFail++;
  }
}
if (!loadFail) console.log('  ✓ 全部模块加载成功');

console.log('');
console.log('=== 3. 渲染结果检查 ===');
const html = appEl.innerHTML;
const vw = Number(process.env.VW || 1440);
const isDesktop = vw >= 1024;
const isWide = vw >= 1280;
const checks = [
  ['页面已脱离加载态', !html.includes('正在加载') && html.length > 1000],
  ['未出现致命错误提示', !html.includes('页面加载失败') && !html.includes('启动失败')],
  ['顶部栏已渲染', html.includes('校园机会雷达')],
  // 电脑端信息流默认是双列卡片（feed-grid）；手机端为单列卡片流。
  // 表格模式需用户手动切换，因此这里不再断言 dtable。
  isDesktop ? ['双列信息流已渲染', /data-feed-grid/.test(html) && /class="card /.test(html)]
            : ['卡片视图已渲染', /class="card /.test(html)],
  ['状态徽章已生成', /badge st-/.test(html)],
  // 完整度进度条：
  //   卡片模式（默认）任何宽度都显示完整度条；
  //   表格模式在窄屏会隐藏"完整度"列（属预期）。
  isDesktop ? ['完整度进度条已生成（卡片模式）', /meter-fill/.test(html)]
            : ['完整度进度条已生成', /meter-fill/.test(html)],
  ['数据已进入列表', /【示例】|蓝桥杯|羽毛球|role-closed/.test(html)],
  ['官方 / 学生标识已渲染', /off-mark is-official/.test(html) && /off-mark is-student/.test(html)],
  ['置顶区已渲染', /pin-zone/.test(html) && /pin-card|pin-notice/.test(html)],
  ['置顶理由已显示', /置顶理由：/.test(html)],
  isDesktop ? ['板块侧栏已渲染', /panel-title">板块/.test(html) || /nav-board-icon/.test(html)]
            : ['圆形板块入口已渲染', /board-circles/.test(html) && /board-circle/.test(html)],
  isDesktop ? ['标签栏已渲染', /class="tag-row"/.test(html)]
            : ['工具宫格已渲染', /tool-grid/.test(html) && /tool-item/.test(html)],
  ['板块头部已渲染', /board-header|timeline/.test(html)],
  ['高层级视图切换已渲染', /view-switch/.test(html) && /机会列表/.test(html) && /时间线/.test(html)],
  isDesktop
    ? ['AI 常驻侧栏已渲染且带标注', /ai-dock/.test(html) && /ai-mark/.test(html)]
    : ['AI 悬浮入口已渲染', /ai-fab/.test(html)],
  ...(isDesktop ? [
    ['显示方式切换栏已渲染', /viewmode-bar/.test(html) && /双列卡片/.test(html)],
    ['侧栏开关已渲染', /sidebar-toggle/.test(html)],
  ] : []),
];

// 时间线是独立视图，需单独验证
process.env.FORCE_TIMELINE = '';
const timelineOk = await (async () => {
  try {
    const logic = await import(pathToFileURL(path.join(jsDir, 'logic.js')).href);
    const now = new Date('2026-09-19T14:30');
    const data = logic.buildDataset(now);
    const groups = logic.buildTimeline(data, now);
    return groups.length > 0 && groups.every((g) => g.label && Array.isArray(g.items));
  } catch { return false; }
})();
checks.push(['时间线分组可用', timelineOk]);

let renderFail = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) renderFail++;
}

console.log('');
console.log(`HTML 长度: ${html.length}　形态: ${isDesktop ? '电脑端' : '手机端'}`);
const total = problems + loadFail + renderFail;
console.log(total === 0 ? '结论：架构自检全部通过' : `结论：${total} 项未通过`);
process.exit(total === 0 ? 0 : 1);
