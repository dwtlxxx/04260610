# ============================================================
#  远端仓库核验脚本（Steam++ 加速开启时也可用）
#
#  用法：
#      powershell -ExecutionPolicy Bypass -File "<工作区>\tools\check-remote.ps1"
#
#  背景：
#      Steam++（Watt Toolkit）会用自签证书对 GitHub 做中间人加速，
#      导致 git / Node / 浏览器之外的工具有两种反应：
#        - 认证书的工具（浏览器）→ 正常
#        - 不认证书的工具（Node 默认）→ UNABLE_TO_VERIFY_LEAF_SIGNATURE
#      本脚本对 Node 关闭证书校验，并优先使用 api.github.com
#      （该域名通常不被 hosts 劫持，比 raw.githubusercontent.com 稳定）。
#
#  注意：本文件必须保存为 UTF-8 with BOM
# ============================================================

$ErrorActionPreference = 'Continue'
$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'

$owner = 'dwtlxxx'
$repo  = '04260610'

$js = @'
const https = require("https");
const OWNER = "dwtlxxx", REPO = "04260610";
function get(u){
  return new Promise(r=>{
    https.get(u, {timeout:20000, headers:{"User-Agent":"check-remote","Accept":"application/vnd.github+json"}}, s=>{
      let b=""; s.on("data",d=>b+=d); s.on("end",()=>r({s:s.statusCode,b:b}));
    }).on("error",e=>r({s:0,b:"",err:e.code||e.message}));
  });
}
(async()=>{
  const base = "https://api.github.com/repos/" + OWNER + "/" + REPO;
  const r = await get(base);
  if (r.s !== 200) { console.log("API=" + r.s + " " + (r.err||"")); return; }
  const j = JSON.parse(r.b);
  console.log("REPO=" + j.full_name);
  console.log("VIS=" + (j.private ? "Private" : "Public"));
  console.log("BRANCH=" + j.default_branch);
  console.log("PAGES=" + (j.has_pages ? "on" : "off"));
  console.log("SIZE_KB=" + j.size);

  const c = await get(base + "/commits?per_page=30");
  if (c.s === 200) {
    const arr = JSON.parse(c.b);
    console.log("COMMITS=" + arr.length);
    arr.forEach(x=>console.log("C|" + x.sha.slice(0,7) + "|" + x.commit.message.split("\n")[0] + "|" + x.commit.author.name));
  } else { console.log("COMMITS=ERR" + c.s); }

  const t = await get(base + "/git/trees/" + j.default_branch + "?recursive=1");
  if (t.s === 200) {
    const tj = JSON.parse(t.b);
    const blobs = (tj.tree||[]).filter(x=>x.type==="blob");
    console.log("FILES=" + blobs.length);
    blobs.forEach(x=>console.log("F|" + x.size + "|" + x.path));
  } else { console.log("FILES=ERR" + t.s); }
})();
'@

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($js))
$raw = & node -e "eval(Buffer.from(process.argv[1],'base64').toString('utf8'))" $b64 2>$null

if (-not $raw) { Write-Host "[失败] 无法取得远端信息，请检查网络与 Node 是否可用" -ForegroundColor Red; exit 1 }

$data = @{}
$commitLines = New-Object System.Collections.ArrayList
$fileLines   = New-Object System.Collections.ArrayList
foreach ($line in $raw) {
    if ($line -match '^([A-Z_]+)=(.*)$') { $data[$Matches[1]] = $Matches[2] }
    elseif ($line -match '^C\|(.+)$') { [void]$commitLines.Add(($Matches[1] -split '\|')) }
    elseif ($line -match '^F\|(.+)$') { [void]$fileLines.Add(($Matches[1] -split '\|')) }
}
$commits = @($commitLines)
$files   = @($fileLines)

function Ok   ($m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "  [警告] $m" -ForegroundColor Yellow }
function Bad  ($m) { Write-Host "  [失败] $m" -ForegroundColor Red }
function Head ($m) { Write-Host ""; Write-Host "=== $m ===" -ForegroundColor Cyan }

Head '1. 仓库基本信息'
Ok "仓库: $($data['REPO'])"
if ($data['VIS'] -eq 'Public') { Ok '可见性: Public' } else { Bad "可见性: $($data['VIS'])（考核要求 Public）" }
Ok "默认分支: $($data['BRANCH'])"
if ($data['PAGES'] -eq 'on') { Ok 'GitHub Pages: 已开启' } else { Warn 'GitHub Pages: 未开启 → 打开仓库 Settings → Pages → Deploy from a branch → main / (root)' }

Head '2. 远端提交记录'
if ($commits.Count -gt 0) {
    Ok "共 $($commits.Count) 个提交"
    foreach ($c in $commits) { Write-Host "         $($c[0])  $($c[1])   <$($c[2])>" -ForegroundColor DarkGray }
    if ($commits.Count -lt 3) { Warn "考核要求至少 3 次有实际意义的 Commit，当前 $($commits.Count) 次" }
} else { Bad '未取得提交记录' }

Head '3. 远端文件清单'
Ok "共 $($files.Count) 个文件"
foreach ($f in $files) { Write-Host ("         {0,8}  {1}" -f $f[0], $f[1]) -ForegroundColor DarkGray }

Head '4. 敏感文件泄露检查'
$leak = $files | Where-Object { $_[1] -match '_keys|\.env|\.pem$|id_ed25519|PUBKEY|00-考核' }
if ($leak) { Bad "发现敏感文件: $(($leak | ForEach-Object { $_[1] }) -join ', ')" } else { Ok '未发现密钥、环境变量或个人资料文件' }

Head '5. 关键文件是否就位'
foreach ($need in @('README.md', '.nojekyll', '.gitignore')) {
    if ($files | Where-Object { $_[1] -eq $need }) { Ok "$need 已推送" } else { Warn "$need 缺失" }
}
if ($files | Where-Object { $_[1] -eq 'index.html' }) { Ok 'index.html 已就位（Pages 首页）' }
else { Warn '根目录暂无 index.html —— Pages 目前会返回 404，属正常，页面写好即生效' }

Write-Host ""
Write-Host "  Pages 地址: https://$($data['REPO'].Split('/')[0]).github.io/$($data['REPO'].Split('/')[1])/" -ForegroundColor Cyan
Write-Host ""
