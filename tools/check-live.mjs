/**
 * check-live.mjs —— 线上 GitHub Pages 实测（交付前必须跑一次）
 *
 * 为什么需要：本地全绿 ≠ 线上能打开。Pages 有几个只在线上才会暴露的坑：
 *   · 新增的 JS 模块没被推上去 → 线上 import 404 → 页面永远停在"正在加载"
 *   · 资源写成绝对路径 /assets/... → 指向 dwtlxxx.github.io/assets/... → 全 404
 *   · 线上还是旧数据（演示数据 / 缺条目）
 *   · Pages 还没构建完成，或构建失败
 *
 * 用法：
 *   node tools/check-live.mjs
 *   node tools/check-live.mjs https://dwtlxxx.github.io/04260610
 *
 * 说明（TLS 踩坑记录）：
 *   本机开着 Steam++（Watt Toolkit）时它可能对部分域名做 TLS 中间人，
 *   所以脚本会把 _keys/steamtools-ca.pem 追加为受信任 CA —— 证书校验保持开启。
 *
 *   ⚠ 但要注意 https 的 `ca` 选项是"整体替换"而不是"追加"：
 *     直接写 ca: steamtoolsCA 会让 Node 丢掉内置根证书，连正常的
 *     Let's Encrypt 证书都会报 "unable to get local issuer certificate"。
 *     正确写法是 ca: [...tls.rootCertificates, steamtoolsCA]。
 */
import { readFileSync, existsSync } from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';

const SITE = (process.argv[2] || 'https://dwtlxxx.github.io/04260610').replace(/\/$/, '');
const caFile = new URL('../_keys/steamtools-ca.pem', import.meta.url);
const opts = {
  headers: { 'cache-control': 'no-cache', 'user-agent': 'check-live' },
  // 内置根证书 + 本机加速工具的自签 CA（追加，不能替换）
  ca: [...tls.rootCertificates],
};
if (existsSync(caFile)) opts.ca.push(readFileSync(caFile, 'utf8'));

/** 发一次 GET，返回 { status, text, lastModified } */
function get(path) {
  return new Promise((resolve, reject) => {
    const url = SITE + path;
    const req = https.get(url, opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8'),
        lastModified: res.headers['last-modified'] || '',
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('超时 30s')));
  });
}

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
}

console.log(`站点：${SITE}\n`);

/* ── 1. 入口与静态资源可达 ── */
console.log('=== 1. 入口与资源可达 ===');
const ASSETS = [
  '/index.html',
  '/assets/css/tokens.css',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/js/views.js',
  '/assets/js/ui.js',
  '/assets/js/logic.js',
  '/assets/js/data.js',
  '/assets/js/store.js',
  '/assets/js/theme.js',
  '/assets/js/pinyin.js',
  '/assets/js/lexicon.js',
];
const bodies = {};
for (const p of ASSETS) {
  try {
    const r = await get(p);
    bodies[p] = r.text;
    ok(`${p}`, r.status === 200 && r.text.length > 0,
      `HTTP ${r.status}　${r.text.length} 字节${r.lastModified ? '　' + r.lastModified : ''}`);
  } catch (e) {
    bodies[p] = '';
    ok(`${p}`, false, `请求失败：${e.message}`);
  }
}

/* ── 2. 资源引用必须是相对路径 ── */
console.log('');
console.log('=== 2. index.html 的资源引用方式 ===');
const html = bodies['/index.html'] || '';
ok('引用了 app.js', html.includes('assets/js/app.js'));
ok('没有把资源写成绝对路径（/assets/...）', !/(src|href)="\/assets\//.test(html),
  /(src|href)="\/assets\//.test(html) ? '存在绝对路径，线上会 404' : '');
ok('入口容器存在', html.includes('id="app"'));

/* ── 3. 线上内容是否与本地提交一致 ── */
console.log('');
console.log('=== 3. 线上内容是否就是本地这一版 ===');
/* Pages 有 CDN 缓存，刚推完可能还是旧文件。逐文件比对"去掉换行差异"后的内容，
   比只查"某个字符串在不在"更能说明问题。 */
const LOCAL = {
  '/index.html': '../index.html',
  '/assets/css/tokens.css': '../assets/css/tokens.css',
  '/assets/css/style.css': '../assets/css/style.css',
  '/assets/js/app.js': '../assets/js/app.js',
  '/assets/js/views.js': '../assets/js/views.js',
  '/assets/js/ui.js': '../assets/js/ui.js',
  '/assets/js/logic.js': '../assets/js/logic.js',
  '/assets/js/data.js': '../assets/js/data.js',
  '/assets/js/store.js': '../assets/js/store.js',
  '/assets/js/theme.js': '../assets/js/theme.js',
  '/assets/js/pinyin.js': '../assets/js/pinyin.js',
  '/assets/js/lexicon.js': '../assets/js/lexicon.js',
};
const norm = (s) => s.replace(/\r\n/g, '\n').trim();
let same = 0;
let diff = [];
for (const [p, rel] of Object.entries(LOCAL)) {
  const local = norm(readFileSync(new URL(rel, import.meta.url), 'utf8'));
  if (norm(bodies[p] || '') === local) same++;
  else diff.push(p);
}
ok('全部文件与本地一致', diff.length === 0,
  diff.length ? `不一致（可能仍在 CDN 缓存，等 1~2 分钟重跑）：${diff.join(', ')}`
    : `共比对 ${same} 个文件`);

ok('拼音模块已上线', (bodies['/assets/js/pinyin.js'] || '').includes('CHAR_PINYIN'));
ok('词库模块已上线', (bodies['/assets/js/lexicon.js'] || '').includes('CAMPUS_TERMS'));
ok('logic.js 已引用词库', (bodies['/assets/js/logic.js'] || '').includes("from './lexicon.js'"));
ok('views.js 已包含搜索理解条', (bodies['/assets/js/views.js'] || '').includes('search-hint'));
ok('style.css 已包含搜索理解条样式', (bodies['/assets/css/style.css'] || '').includes('.search-hint'));
ok('线上没有启用演示数据', !/USE_DEMO_DATA\s*=\s*true/.test(bodies['/assets/js/logic.js'] || ''));

/* ── 4. 模块 import 图闭合（防"永远加载中"）── */
console.log('');
console.log('=== 4. 线上模块 import 图闭合 ===');
const seen = new Set();
const queue = ['/assets/js/app.js'];
let broken = [];
while (queue.length) {
  const p = queue.shift();
  if (seen.has(p)) continue;
  seen.add(p);
  const src = bodies[p];
  if (src === undefined) {
    // 之前没抓过的依赖，现抓一次
    try {
      const r = await get(p);
      bodies[p] = r.status === 200 ? r.text : '';
    } catch { bodies[p] = ''; }
  }
  const text = bodies[p] || '';
  if (!text) { broken.push(p); continue; }
  for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) {
    const next = new URL(m[1], 'https://x' + p).pathname;
    if (!seen.has(next)) queue.push(next);
  }
}
ok('app.js 的依赖链在线上全部可达', broken.length === 0,
  broken.length ? `缺失：${broken.join(', ')}` : `共 ${seen.size} 个模块`);

console.log('');
console.log(`结论：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
