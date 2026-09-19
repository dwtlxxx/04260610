/**
 * verify-page.mjs —— 端到端验证脚本（开发期自测用，不参与线上运行）
 *
 * 作用：起一个静态服务器，用无头 Chrome 真实加载 index.html，
 *       确认 ES Module 能正确加载、页面渲染出真实内容（而不是停在"正在加载"）。
 *
 * 用法：node tools/verify-page.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8931;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function findChrome() {
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return cands.find((c) => fs.existsSync(c)) || null;
}

server.listen(PORT, '127.0.0.1', () => {
  const chrome = findChrome();
  if (!chrome) {
    console.log('未找到 Chrome/Edge，跳过浏览器验证；服务器仍在运行。');
    return;
  }
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const r = spawnSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=6000',
    '--dump-dom', url,
  ], { encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 });

  const dom = r.stdout || '';
  const checks = [
    ['页面已渲染（不再是加载中）', !dom.includes('正在加载校园机会数据') && dom.length > 3000],
    ['渲染出卡片或表格', /class="card |class="dtable"/.test(dom)],
    ['出现真实数据标题', dom.includes('蓝桥杯') || dom.includes('羽毛球')],
    ['状态徽章已生成', /class="badge st-/.test(dom)],
    ['完整度进度条已生成', dom.includes('meter-fill')],
    ['风险提示已生成', dom.includes('risk-list') || dom.includes('建议核实')],
    ['顶部导航已生成', dom.includes('校园机会雷达')],
  ];

  console.log(`浏览器: ${path.basename(chrome)}`);
  console.log(`DOM 长度: ${dom.length}`);
  console.log('');
  let fail = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
    if (!ok) fail++;
  }
  if (r.stderr && /error|Error/.test(r.stderr)) {
    const lines = r.stderr.split('\n').filter((l) => /error|Error|Uncaught/.test(l)).slice(0, 6);
    if (lines.length) { console.log('\n  浏览器报错：'); lines.forEach((l) => console.log('    ' + l.trim())); }
  }
  console.log(`\n结果：${fail === 0 ? '全部通过' : fail + ' 项未通过'}`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
});
