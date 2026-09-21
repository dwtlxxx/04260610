/**
 * report-arch.mjs —— 架构度量报告（只读，不改任何文件）
 *
 * 回答的问题："现在的解耦度如何？" —— 用数字回答，而不是凭印象。
 *
 * 检查项：
 *   1. 模块体积、导出数、依赖数
 *   2. 循环依赖（有环 = 强耦合）
 *   3. 分层方向（是否只向下依赖）
 *   4. 各层纯净度：领域层不许碰 DOM/存储，持久层不许碰 DOM，视图层不许碰 DOM/存储
 *   5. 被依赖次数（耦合枢纽：改动影响面）
 *   6. 死导出（app 与 tools 都不用的导出）
 *   7. 控制器集中度（分支数 / 监听数 / state 字段数）
 *   8. 样式令牌纪律（硬编码色值 vs 令牌）
 *
 * ⚠ 两个必须避免的误报（首版都踩到了）：
 *   · 统计 DOM / localStorage 访问时必须先去掉注释，否则"注释里提到 localStorage"会被计数；
 *   · 判断导出是否"没人用"时，必须把 tools/ 里的脚本也算进来，
 *     因为有些导出（如 fuzzyScore / toPinyin）是专门给自检脚本用的。
 *
 * 用法：node tools/report-arch.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const JS_DIR = 'assets/js';
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const files = readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
const raw = new Map(files.map((f) => [f, readFileSync(join(JS_DIR, f), 'utf8')]));
const code = new Map(files.map((f) => [f, stripComments(raw.get(f))]));
const toolsSrc = readdirSync('tools').filter((f) => f.endsWith('.mjs'))
  .map((f) => readFileSync(join('tools', f), 'utf8')).join('\n');

const imports = new Map();
const exportsMap = new Map();
const rows = [];

for (const f of files) {
  const src = code.get(f);
  const deps = [...src.matchAll(/from\s+'\.\/([\w.-]+\.js)'/g)].map((m) => m[1]);
  imports.set(f, [...new Set(deps)]);
  const exps = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1]);
  exportsMap.set(f, exps);
  rows.push({
    文件: f,
    行数: raw.get(f).split('\n').length,
    导出: exps.length,
    依赖: deps.length,
    碰DOM: (src.match(/\bdocument\b|\bwindow\b/g) || []).length,
    碰存储: (src.match(/\blocalStorage\b/g) || []).length,
  });
}

console.log('=== 1. 模块体积与纯净度 ===');
console.table(rows);

const color = new Map();
const cycles = [];
const dfs = (node, stack) => {
  color.set(node, 1);
  for (const d of imports.get(node) || []) {
    if (!imports.has(d)) continue;
    if (color.get(d) === 1) cycles.push([...stack, node, d].join(' → '));
    else if (!color.get(d)) dfs(d, [...stack, node]);
  }
  color.set(node, 2);
};
for (const f of files) if (!color.get(f)) dfs(f, []);
console.log('\n=== 2. 循环依赖 ===');
console.log(cycles.length ? cycles.map((c) => '  ✗ ' + c).join('\n') : '  未发现循环依赖 ✓');

const ORDER = ['data.js', 'pinyin.js', 'lexicon.js', 'logic.js', 'store.js', 'theme.js', 'ui.js', 'views.js', 'app.js'];
const rank = (f) => ORDER.indexOf(f);
const violations = [];
for (const [f, deps] of imports) {
  for (const d of deps) if (rank(d) > rank(f)) violations.push(`  ✗ ${f} → ${d}（反向依赖）`);
}
console.log('\n=== 3. 分层方向（应只向下依赖）===');
console.log(violations.length ? violations.join('\n') : '  全部单向向下 ✓');

console.log('\n=== 4. 各层纯净度（应为 0）===');
for (const [f, list] of [['logic.js', ['碰DOM', '碰存储']], ['store.js', ['碰DOM']], ['views.js', ['碰DOM', '碰存储']]]) {
  const row = rows.find((r) => r.文件 === f);
  console.log(`  ${f.padEnd(12)} ${list.map((k) => `${k}=${row[k]}`).join('  ')}${list.every((k) => row[k] === 0) ? '  ✓' : '  ✗'}`);
}
console.log(`  views.js 调用 store.*: ${(code.get('views.js').match(/\bstore\./g) || []).length}（应为 0）`);

const inDeg = new Map(files.map((f) => [f, 0]));
for (const [, deps] of imports) for (const d of deps) if (inDeg.has(d)) inDeg.set(d, inDeg.get(d) + 1);
console.log('\n=== 5. 被依赖次数（越高=改动影响面越大）===');
[...inDeg].sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`  ${f.padEnd(14)} ${n}`));

console.log('\n=== 6. 死导出（app 与 tools 都不用）===');
let dead = 0;
for (const [f, exps] of exportsMap) {
  const others = files.filter((x) => x !== f).map((x) => code.get(x)).join('\n') + toolsSrc;
  const unused = exps.filter((e) => !new RegExp(`\\b${e}\\b`).test(others));
  dead += unused.length;
  console.log(`  ${f.padEnd(14)} ${String(exps.length).padStart(2)} 导出，无引用 ${unused.length}${unused.length ? ' → ' + unused.join(', ') : ''}`);
}
console.log(`  合计死导出：${dead}`);

const app = code.get('app.js');
console.log('\n=== 7. 控制器集中度（app.js）===');
console.log('  switch 分支:', (app.match(/^\s*case '/gm) || []).length);
console.log('  addEventListener:', (app.match(/addEventListener\(/g) || []).length);
console.log('  state 字段:', (app.match(/^\s{2}\w+:/gm) || []).length);

const css = stripComments(readFileSync('assets/css/style.css', 'utf8'));
const tokens = readFileSync('assets/css/tokens.css', 'utf8');
const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
const rgba = css.match(/rgba?\(/g) || [];
console.log('\n=== 8. 样式令牌纪律 ===');
console.log('  tokens.css 令牌:', (tokens.match(/^\s+--[\w-]+:/gm) || []).length);
console.log('  style.css 行数:', css.split('\n').length);
console.log('  非令牌色值:', hex.length + rgba.length,
  '（组件级令牌定义属正常；关键看是否存在散落的字面色值）');
if (hex.length) console.log('  例:', hex.slice(0, 8).join(' '));
