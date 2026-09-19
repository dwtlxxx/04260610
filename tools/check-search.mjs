/**
 * check-search.mjs —— 搜索能力自检（开发期使用）
 *
 * 用法：node tools/check-search.mjs
 *
 * 分两部分：
 *   ① 必须命中（召回）：中文、拼音、首字母、错字、近义词、多词
 *   ② 必须不命中（精度）：无关词、跨体系噪声
 * 两部分都必须全过，避免"提高召回却引入噪声"。
 */
const base = new URL('../assets/js/', import.meta.url).href;
const L = await import(base + 'logic.js');
const LEX = await import(base + 'lexicon.js');

const now = new Date('2026-09-19T14:30');
const all = L.buildDataset(now);
const search = (kw) => all
  .map((i) => ({ i, s: L.itemFuzzyScore(i, kw) }))
  .filter((x) => x.s > 0)
  .sort((a, b) => b.s - a.s);
const idsOf = (kw) => search(kw).map((x) => String(x.i.id));

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
}

console.log('=== ① 中文检索（必须命中）===');
for (const [kw, id] of [['蓝桥杯', '1'], ['羽毛球', '22'], ['程序设计', '1'], ['科研助理', '13'], ['网络安全', '18']]) {
  const ids = idsOf(kw);
  ok(`「${kw}」命中 #${id}`, ids.includes(id), `结果 ${ids.slice(0, 5).join(',') || '空'}`);
}

console.log('');
console.log('=== ② 拼音检索（必须命中）===');
for (const [kw, id, label] of [
  ['lanqiao', '1', '全拼'], ['lanqiaobei', '1', '全拼'],
  ['yumaoqiu', '22', '全拼'], ['keyanzhuli', '13', '全拼'],
  ['lqb', '1', '首字母'], ['ymq', '22', '首字母'],
  ['kyzl', '13', '首字母'], ['wlaq', '18', '首字母'],
  ['sxjm', '4', '首字母'], ['cxsj', '1', '首字母'],
]) {
  const ids = idsOf(kw);
  ok(`${label}「${kw}」命中 #${id}`, ids.includes(id), `结果 ${ids.slice(0, 5).join(',') || '空'}`);
}

console.log('');
console.log('=== ③ 错字容忍（必须命中）===');
for (const [kw, id, label] of [
  ['兰桥杯', '1', '同音字'],
  ['羽毛球赛', '22', '多字'],
  ['蓝桥杯赛', '1', '多字'],
]) {
  const ids = idsOf(kw);
  ok(`${label}「${kw}」命中 #${id}`, ids.includes(id), `结果 ${ids.slice(0, 5).join(',') || '空'}`);
}

console.log('');
console.log('=== ④ 近义词（必须命中）===');
for (const [kw, id] of [['运动', '22'], ['讲座', '2'], ['比赛', '4'], ['招人', '13'], ['培训', '1']]) {
  const ids = idsOf(kw);
  ok(`「${kw}」扩展到 #${id}`, ids.includes(id), `结果 ${ids.slice(0, 5).join(',') || '空'}`);
}

console.log('');
console.log('=== ⑤ 多词检索（必须命中）===');
for (const [kw, id] of [['竞赛 组队', '7'], ['零基础 程序', '1'], ['lanqiao 训练', '1']]) {
  const ids = idsOf(kw);
  ok(`「${kw}」命中 #${id}`, ids.includes(id), `结果 ${ids.slice(0, 5).join(',') || '空'}`);
}

console.log('');
console.log('=== ⑥ 无关词（必须全部 0 条）===');
/* 注意：「aa」不在这里 —— 数据里有标签「费用AA」，aa 命中它是正确的字面匹配，
   见 ⑦ 的收敛性检查。噪声词的定义是"语料里根本不存在、也不是任何词的
   拼音/首字母"，⑨ 会为这个定义做自检。 */
const noise = ['zzz', 'zz', 'qq', 'xxx', 'aaa', 'qwerty', 'asdf', 'www',
  'ttt', 'bbb', 'abc', '123', '999', 'xyzzy', '###', 'asdfgh'];
let noisy = 0;
for (const kw of noise) {
  const ids = idsOf(kw);
  if (ids.length) { noisy++; console.log(`  ✗ 「${kw}」误命中 ${ids.length} 条: ${ids.slice(0, 4).join(',')}`); }
}
ok('无关词全部 0 命中', noisy === 0, noisy ? `${noisy}/${noise.length} 个词有噪声` : `已测 ${noise.length} 个词`);

console.log('');
console.log('=== ⑦ 字面命中必须收敛（不得顺着拼音扩散）===');
/* 「aa」应当命中 #22（标签就是「费用AA」，raw 里也写了费用AA），
   但只能命中"真的含这两个字母"的条目，不能扩散到拼音/首字母。 */
const textOf = (it) => ['title', 'org', 'place', 'audience', 'notes', 'raw']
  .map((f) => it[f]).filter(Boolean).join(' ') + ' ' + (it.tags || []).join(' ');
for (const kw of ['aa', 'ctf', 'git']) {
  const hits = search(kw);
  const stray = hits.filter((x) => !textOf(x.i).toLowerCase().includes(kw)).map((x) => String(x.i.id));
  ok(`「${kw}」命中项都真的含有这串字母`,
    stray.length === 0,
    `命中 ${hits.length} 条${stray.length ? '，越界: ' + stray.join(',') : ''}`);
}

console.log('');
console.log('=== ⑧ 空查询与边界 ===');
ok('空关键词不过滤条目', all.filter((i) => L.matchesFilters(i, { keyword: '' }, now)).length === all.length);
ok('纯空格不过滤条目', all.filter((i) => L.matchesFilters(i, { keyword: '   ' }, now)).length === all.length);
ok('单字符查询不会命中全部', idsOf('a').length < all.length);

console.log('');
console.log('=== ⑨ 噪声词用例自检（保证 ⑥ 的用例本身成立）===');
/* ⑥ 要成立，前提是这些词确实"不该命中"。两个前提：
   1) 它们不是语料里的字面子串；
   2) 它们不是词库任何词的拼音/首字母 —— 否则词库扩容会悄悄破坏 ⑥，
      而那时应该改的是用例，不是去调匹配阈值。 */
const corpus = all.map(textOf).join(' ').toLowerCase();
const litClash = noise.filter((w) => corpus.includes(w));
ok('噪声词都不是语料字面子串', litClash.length === 0, litClash.length ? `冲突: ${litClash.join(',')}` : '');

const allTerms = new Set();
for (const it of all) for (const f of ['title', 'notes', 'raw']) {
  if (it[f]) for (const t of LEX.termsIn(String(it[f]))) allTerms.add(t);
}
const termClash = noise.filter((w) => {
  for (const t of allTerms) {
    if (L.toPinyin(t) === w || L.toInitials(t) === w) return true;
  }
  return false;
});
ok('噪声词不撞词库词语音', termClash.length === 0,
  termClash.length ? `冲突: ${termClash.join(',')}` : `词库命中 ${allTerms.size} 个词`);
ok('词库非空', allTerms.size > 0);

console.log('');
console.log('=== ⑩ 搜索可解释性（搜索理解条的数据来源）===');
/* 拼音/首字母/近义词/容错会让结果"看起来对不上输入"，界面必须能解释清楚。
   explainSearch 就是那句解释的数据来源，这里固定它的行为。 */
const itemsOf = (kw) => search(kw).map((x) => x.i);
const ex = (kw) => L.explainSearch(kw, itemsOf(kw));
ok('首字母命中 → pinyin', (ex('ymq') || {}).modes?.includes('pinyin'));
ok('拼音命中 → pinyin', (ex('yumaoqiu') || {}).modes?.includes('pinyin'));
ok('字面命中 → direct', (ex('羽毛球') || {}).modes?.includes('direct'));
ok('错字容错 → fuzzy', (ex('兰桥杯') || {}).modes?.includes('fuzzy'));
const exSyn = ex('招人') || {};
ok('近义词命中 → synonym 且带对照说明',
  exSyn.modes?.includes('synonym') && (exSyn.synonyms || []).some((s) => s.includes('→')),
  (exSyn.synonyms || []).join('、'));
ok('解释里的条数与实际命中一致', (ex('运动') || {}).count === itemsOf('运动').length);
ok('空关键词不产生解释', L.explainSearch('', itemsOf('羽毛球')) === null);
ok('无结果时解释的条数为 0', (L.explainSearch('zzz', []) || {}).count === 0);

console.log('');
console.log(`结论：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
