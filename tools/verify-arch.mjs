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
const isDesktop = Number(process.env.VW || 1440) >= 1024;
const checks = [
  ['页面已脱离加载态', !html.includes('正在加载') && html.length > 1000],
  ['未出现致命错误提示', !html.includes('页面加载失败') && !html.includes('启动失败')],
  ['顶部栏已渲染', html.includes('校园机会雷达')],
  isDesktop ? ['表格视图已渲染', /class="dtable"/.test(html)]
            : ['卡片视图已渲染', /class="card /.test(html)],
  ['状态徽章已生成', /badge st-/.test(html)],
  ['完整度进度条已生成', /meter-fill/.test(html)],
  ['数据已进入列表', /【示例】|蓝桥杯|羽毛球|role-closed/.test(html)],
  // —— 本轮新增功能 ——
  ['官方 / 学生标识已渲染', /off-mark is-official/.test(html) && /off-mark is-student/.test(html)],
  ['置顶区已渲染', /pin-zone/.test(html) && /pin-card|pin-notice/.test(html)],
  ['置顶理由已显示', /置顶理由：/.test(html)],
  isDesktop ? ['板块侧栏已渲染', /panel-title">板块/.test(html) || /nav-board-icon/.test(html)]
            : ['圆形板块入口已渲染', /board-circles/.test(html) && /board-circle/.test(html)],
  isDesktop ? ['标签栏已渲染', /class="tag-row"/.test(html)]
            : ['工具宫格已渲染', /tool-grid/.test(html) && /tool-item/.test(html)],
  ['板块头部已渲染', /board-header/.test(html)],
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
