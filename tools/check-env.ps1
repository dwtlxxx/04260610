# ============================================================
#  面试环境自检脚本（Windows PowerShell 5.1 兼容）
#
#  用法：
#      powershell -ExecutionPolicy Bypass -File "<工作区>\tools\check-env.ps1"
#
#  作用：一次性确认「网络 / SSH / 密钥 / Git / 远端仓库 / Pages」是否就绪
#
#  注意：本文件必须保存为 UTF-8 with BOM，否则 PowerShell 5.1 会按 GBK
#        解析中文导致语法错误（这是实际踩过的坑）
# ============================================================

$ErrorActionPreference = 'Continue'
$root   = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$kd     = Join-Path $root '_keys'
$key    = Join-Path $kd 'id_ed25519_github'
$sysSsh = "$env:SystemRoot\System32\OpenSSH\ssh.exe"
if (-not (Test-Path $sysSsh)) { $sysSsh = 'ssh' }

$fail = 0

function Ok   ($m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "  [警告] $m" -ForegroundColor Yellow }
function Bad  ($m) { Write-Host "  [失败] $m" -ForegroundColor Red; $script:fail++ }
function Info ($m) { Write-Host "  [信息] $m" -ForegroundColor Cyan }
function Head ($m) { Write-Host ""; Write-Host "=== $m ===" -ForegroundColor Cyan }

# 带超时执行外部命令：输出重定向到临时文件，避免管道挂起
function Quote-CmdArgs {
    param([string[]]$Items)
    $out = @()
    foreach ($i in $Items) {
        if ($null -eq $i) { continue }
        if ($i -match '\s' -and -not ($i.StartsWith('"') -and $i.EndsWith('"'))) { $out += '"' + $i + '"' }
        else { $out += $i }
    }
    return $out
}

function Run-WithTimeout {
    [CmdletBinding()]
    param([string]$Exe, [string[]]$CmdArgs, [int]$TimeoutSec = 25)
    $outFile = [System.IO.Path]::GetTempFileName()
    $errFile = [System.IO.Path]::GetTempFileName()
    try {
        $quoted = Quote-CmdArgs -Items $CmdArgs
        $p = Start-Process -FilePath $Exe -ArgumentList $quoted -NoNewWindow -PassThru `
                           -RedirectStandardOutput $outFile -RedirectStandardError $errFile -ErrorAction Stop
        if (-not $p.WaitForExit($TimeoutSec * 1000)) {
            try { $p.Kill() } catch {}
            return @{ TimedOut = $true; Text = ''; Code = -1 }
        }
        $text = ''
        try { $text += (Get-Content $outFile -Raw -ErrorAction SilentlyContinue) } catch {}
        try { $text += (Get-Content $errFile -Raw -ErrorAction SilentlyContinue) } catch {}
        return @{ TimedOut = $false; Text = $text; Code = $p.ExitCode }
    } catch {
        return @{ TimedOut = $false; Text = "启动失败: $($_.Exception.Message)"; Code = -1 }
    } finally {
        Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
    }
}

Head '1. 工作区与密钥文件'
if (Test-Path $root) { Ok "工作区: $root" } else { Bad '工作区不存在' }
if (Test-Path $key)  { Ok '私钥存在' } else { Bad "私钥缺失: $key" }
if (Test-Path $sysSsh) { Ok "ssh 程序: $sysSsh" } else { Warn '未找到系统 ssh.exe，将使用 PATH 中的 ssh' }

Head '2. 加速工具（Steam++ / Watt Toolkit）状态'
$hostsFile = "$env:SystemRoot\System32\drivers\etc\hosts"
$hostsHit = Get-Content $hostsFile -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*127\.0\.0\.1\s+.*github' }
$proxyOn = (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'Steam\+\+' }).Count -gt 0
if ($hostsHit -and $proxyOn) {
    Info "检测到加速工具正在运行，hosts 中 $($hostsHit.Count) 条 github 域名指向 127.0.0.1"
    Info '这是加速的正常工作方式，无需关闭 —— 推送走 SSH（不经 TLS），不受影响'
} elseif ($hostsHit) {
    Warn "hosts 中有 $($hostsHit.Count) 条 github 劫持，但未检测到加速工具进程"
} elseif ($proxyOn) {
    Info '加速工具在运行，但 hosts 未被改写'
} else {
    Ok '无加速工具干扰，直连 GitHub'
}

Head '3. GitHub 域名解析'
try {
    $ips = (Resolve-DnsName github.com -Type A -ErrorAction Stop |
            Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress)
    if ($ips -contains '127.0.0.1') {
        Info 'github.com -> 127.0.0.1（加速工具的本地代理，浏览器与 SSH 均正常）'
    } else {
        Ok "github.com -> $($ips[0])（直连真实 IP）"
    }
} catch { Warn "DNS 解析失败: $($_.Exception.Message)" }

Head '4. SSH 免密认证 (经 443 端口，与仓库实际推送链路一致)'
$confFwd = (Join-Path $root '_keys\gh_ssh_config').Replace('\', '/')
$r = Run-WithTimeout -Exe $sysSsh -TimeoutSec 25 -CmdArgs @(
    '-T', '-F', $confFwd, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'git@github.com'
)
if ($r.TimedOut) {
    Bad 'SSH 连接超时（超过 25 秒无响应）'
} elseif ($r.Text -match 'successfully authenticated') {
    Ok 'SSH 认证成功'
} elseif ($r.Text -match 'Permission denied') {
    Bad 'SSH 认证失败，公钥未添加到 GitHub'
    Write-Host '         把 _keys\PUBKEY_复制这一行.txt 的内容加到 https://github.com/settings/keys' -ForegroundColor Yellow
} elseif ($r.Text -match 'Connection|timed out|refused|resolve') {
    Bad "SSH 连接失败: $($r.Text.Trim())"
} else {
    Warn "SSH 输出异常: $($r.Text.Trim())"
}

Head '5. Git 仓库状态'
Push-Location $root
$branch = & git rev-parse --abbrev-ref HEAD 2>$null
if ($branch) { Ok "当前分支: $branch" } else { Bad '不是 Git 仓库' }
$name = & git config user.name
$mail = & git config user.email
if ($name -and $mail) { Ok "提交身份: $name <$mail>" } else { Bad '未配置 user.name / user.email' }
$remote = & git remote get-url origin 2>$null
if ($remote) { Ok "远端: $remote" } else { Bad '未配置 origin' }
$log = & git log --oneline 2>$null
$n = 0
if ($log) { $n = ($log | Measure-Object).Count }
if ($n -gt 0) { Ok "本地已有 $n 个提交" } else { Warn '本地尚无提交' }
Pop-Location

Head '6. 远端仓库可达性'
$g = Run-WithTimeout -Exe 'git' -TimeoutSec 30 -CmdArgs @('-C', $root, 'ls-remote', 'origin')
if ($g.TimedOut) {
    Bad '访问远端超时'
} elseif ($g.Code -eq 0) {
    if ([string]::IsNullOrWhiteSpace($g.Text)) {
        Ok '远端连通，目前为空仓库（提交还没推上去）'
    } else {
        Ok '远端连通，已有提交'
    }
} else {
    Bad '无法访问远端'
    Write-Host "         $($g.Text.Trim())" -ForegroundColor DarkGray
}

Head '7. 敏感文件保护'
Push-Location $root
$tracked = & git ls-files 2>$null
$leak = $tracked | Where-Object { $_ -match '_keys|\.env$|\.pem$|PUBKEY' }
if ($leak) { Bad "以下敏感文件已被 Git 跟踪: $($leak -join ', ')" } else { Ok '密钥与 .env 均未被 Git 跟踪' }
Pop-Location

Head '8. GitHub Pages 域名解析'
try {
    $pips = (Resolve-DnsName dwtlxxx.github.io -Type A -ErrorAction Stop |
             Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress)
    Ok "dwtlxxx.github.io -> $($pips[0])"
} catch { Warn 'Pages 域名暂未解析（首次发布后才会生效，属正常）' }

Head '自检结果'
if ($fail -eq 0) {
    Write-Host '  全部通过，可以开始开发与推送。' -ForegroundColor Green
} else {
    Write-Host "  有 $fail 项未通过，请按上面的提示处理后重跑。" -ForegroundColor Red
}
Write-Host ""
