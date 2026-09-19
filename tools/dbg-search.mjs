/* 调试脚本：定位"无关词误命中"的来源（哪个条目 / 哪个字段 / 哪个片段 / 多少分）。
   只在排查搜索精度时手动运行：node tools/dbg-search.mjs                */
const base = new URL('../assets/js/', import.meta.url).href;
const L = await import(base + 'logic.js');
const all = L.buildDataset(new Date('2026-09-19T14:30'));

const split = (s) =>
  String(s)
    .split(/[\s·,，。、；;:：/|｜\\()（）\[\]【】「」『』“”"'']+/)
    .filter(Boolean);

const FIELDS = ['title', 'tags', 'org', 'place', 'audience', 'notes', 'raw'];
const words = process.argv.slice(2).length ? process.argv.slice(2) : ['zzz', 'zz', 'xxx', 'aa', 'asdf'];

for (const kw of words) {
  console.log(`\n########## 关键词「${kw}」 ##########`);
  for (const it of all) {
    const total = L.itemFuzzyScore(it, kw);
    if (total <= 0) continue;
    console.log(`\n  #${it.id} 总分 ${total}  ${String(it.title).slice(0, 40)}`);
    for (const f of FIELDS) {
      let v = it[f];
      if (f === 'tags') v = (it.tags || []).join(' ');
      if (!v) continue;
      const s = L.fuzzyScore(kw, v);
      if (s <= 0) continue;
      console.log(`    [${f}] 整字段 ${s}`);
      for (const seg of split(v)) {
        const s2 = L.fuzzyScore(kw, seg);
        if (s2 > 0) console.log(`       片段「${seg}」→ ${s2}`);
      }
    }
  }
}
