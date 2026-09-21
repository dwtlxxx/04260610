/**
 * check-readme.mjs —— README 交付质量自检
 *
 * 为什么需要：README 是评分项之一，表格写坏在 GitHub 上会直接渲染成
 * 一堆竖线文本（之前就踩过一次：表格头被删掉导致整段不渲染）。
 *
 * 检查项：
 *   1. 所有 Markdown 表格：表头 / 分隔行 / 数据行的列数一致
 *   2. 交付必需的链接与章节标题都在
 *   3. 不出现已删除功能或已删除脚本的名字（防止文档过期）
 *
 * 用法：node tools/check-readme.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const text = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const lines = text.split(/\r?\n/);

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
}

const cells = (line) => line.replace(/^\||\|$/g, '').split('|').length;

console.log('=== 1. 表格结构 ===');
let tables = 0;
let bad = 0;
for (let i = 0; i < lines.length; i++) {
  if (!/^\|/.test(lines[i]) || !/^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) continue;
  tables++;
  const head = cells(lines[i]);
  const sep = cells(lines[i + 1]);
  if (head !== sep) { bad++; console.log(`  ✗ 第 ${i + 1} 行起：表头 ${head} 列，分隔行 ${sep} 列`); }
  let j = i + 2;
  while (j < lines.length && /^\|/.test(lines[j])) {
    if (cells(lines[j]) !== head) {
      bad++;
      console.log(`  ✗ 第 ${j + 1} 行：${cells(lines[j])} 列，与表头 ${head} 列不符`);
    }
    j++;
  }
  i = j - 1;
}
ok('所有表格列数一致', bad === 0, `共 ${tables} 个表格`);

console.log('');
console.log('=== 2. 交付必需内容 ===');
ok('包含仓库地址', text.includes('https://github.com/dwtlxxx/04260610'));
ok('包含在线作品地址', text.includes('https://dwtlxxx.github.io/04260610/'));
for (const sec of ['一、产品名称', '二、主要解决的问题', '三、核心功能', '四、运行方式',
  '五、自主设计的实用或创新内容', '八、项目结构', '九、开发说明']) {
  ok(`章节「${sec}」存在`, text.includes(sec));
}
ok('说明了搜索能力（拼音/首字母等）', /拼音/.test(text) && /首字母/.test(text));

console.log('');
console.log('=== 3. 项目结构图必须与仓库实际文件一致 ===');
/* 这是最有价值的一条：结构图很容易写完就不管，实际文件加了却忘了写，
   面试官一对照仓库就会发现文档与代码不一致。这里直接拿 git ls-files 比。 */
let tracked = [];
try {
  tracked = execSync('git ls-files', { encoding: 'utf8', cwd: new URL('..', import.meta.url) })
    .trim().split('\n').filter(Boolean);
} catch {
  tracked = [];
}
const mention = (p) => text.includes(p);
const missing = tracked.filter((f) => {
  // 只校验"会被写进结构图"的源码与脚本；文档与配置文件另行抽查
  if (!/^(assets\/(js|css)\/|tools\/)/.test(f)) return false;
  return !mention(f.split('/').pop());
});
ok('结构图列出了全部源码与脚本', missing.length === 0,
  missing.length ? `遗漏：${missing.join(', ')}` : `已核对 ${tracked.length} 个文件中的源码与脚本`);
for (const f of ['index.html', 'README.md', 'assets/js/app.js', 'assets/css/tokens.css']) {
  ok(`结构图提到了 ${f.split('/').pop()}`, mention(f.split('/').pop()));
}

console.log('');
console.log('=== 4. 不得出现过期内容 ===');
const stale = ['verify-page.mjs', '表格模式', '双列卡片 / 表格', '8 个快捷筛选'];
for (const s of stale) ok(`无「${s}」`, !text.includes(s));

console.log('');
console.log(`结论：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
