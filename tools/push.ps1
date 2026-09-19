# ============================================================
#  一键提交并推送（Windows PowerShell 5.1 兼容）
#
#  用法：
#      powershell -ExecutionPolicy Bypass -File "<工作区>\tools\push.ps1"
#      powershell -ExecutionPolicy Bypass -File "<工作区>\tools\push.ps1" -Message "feat: 新增待办勾选功能"
#      powershell -ExecutionPolicy Bypass -File "<工作区>\tools\push.ps1" -Diagnose
#
#  说明：
#      -Diagnose 只做检查，不推送
#      脚本会自动把「系统 ssh + 工作区密钥 + 443 端口」写入仓库配置
#      路径必须用正斜杠，反斜杠会被 git 当成转义符导致写入失败（实际踩过的坑）
#
#  注意：本文件必须保存为 UTF-8 with BOM，否则 PowerShell 5.1 会按 GBK
#        解析中文导致语法错误
# ============================================================

param(
    [string]$Message = '',
    [string]$Remote  = 'origin',
    [string]$Branch  = 'main',
    [switch]$Diagnose
)

$ErrorActionPreference = 'Continue'
$root   = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$key    = Join-Path $root '_keys\id_ed25519_github'
$sysSsh = "$env:SystemRoot\System32\OpenSSH\ssh.exe"
if (-not (Test-Path $sysSsh)) { $sysSsh = 'ssh' }

$fail = 0

function Ok   ($m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "  [警告] $m" -ForegroundColor Yellow }
function Bad  ($m) { Write-Host "  [失败] $m" -ForegroundColor Red; $script:fail++ }
function Head ($m) { Write-Host ""; Write-Host "=== $m ===" -ForegroundColor Cyan }

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
    param([string]$Exe, [string[]]$CmdArgs, [int]$TimeoutSec = 30)
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

Write-Host "仓库路径: $root" -ForegroundColor DarkGray

# ---------- 1. 前置校验 ----------
Head '1. 前置校验'
if (Test-Path $key) { Ok '私钥存在' } else { Bad "找不到私钥: $key"; Write-Host ''; exit 1 }
Ok "ssh 程序: $sysSsh"

$hostsFile = "$env:SystemRoot\System32\drivers\etc\hosts"
$hostsHit = Get-Content $hostsFile -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*127\.0\.0\.1\s+.*github' }
if ($hostsHit) { Bad 'hosts 文件把 github 指向了 127.0.0.1，请关闭 Steam++ 或 Watt Toolkit 的加速并清理 hosts' }
else { Ok 'hosts 未被劫持' }

# ---------- 2. 固化 SSH 命令 ----------
Head '2. 写入 SSH 命令配置'
# 关键：core.sshCommand 的命令行里绝不能出现含空格的路径。
# Git 解析 core.sshCommand 时不做引号处理，只按空格切分参数，
# 而工作区路径 "Computer progream" 含空格，会把 -i 或 -F 的路径截断成 "D:/desktop/Computer"。
#
# 因此方案是：
#   命令行 -> 只用零空格的【相对路径】_keys/gh_ssh_config（git 保证从仓库根目录执行该命令）
#   文件内 -> 密钥、主机密钥用绝对路径 + 引号（ssh 自己会正确解析引号）
$sshConf = '_keys/gh_ssh_config'
if (-not (Test-Path (Join-Path $root $sshConf))) { Bad "缺少 ssh 配置文件: $sshConf"; exit 1 }
& git -C $root config --replace-all core.sshCommand "ssh -F $sshConf"
$saved = & git -C $root config --get core.sshCommand
if ($saved -eq "ssh -F $sshConf") { Ok "core.sshCommand = $saved" } else { Bad "core.sshCommand 异常: $saved" }
Ok 'ssh 配置文件内使用绝对路径，不依赖当前目录'

# ---------- 3. 连通性测试 ----------
# 直接用 git ls-remote 验证：若远端可达，说明 ssh 配置、密钥、认证、网络全部正常
Head '3. 远端连通性测试 (通过 git，与真正 push 完全同一条链路)'
$g = Run-WithTimeout -Exe 'git' -TimeoutSec 30 -CmdArgs @('-C', $root, 'ls-remote', 'origin')
if ($g.TimedOut) {
    Bad '访问远端超时（超过 30 秒）'
} elseif ($g.Code -eq 0) {
    Ok '远端可达，SSH 密钥与认证均正常'
} else {
    Bad '无法访问远端'
    Write-Host "         $($g.Text.Trim())" -ForegroundColor DarkGray
    if ($g.Text -match 'Host key verification failed|not accessible') {
        Write-Host '         指向：ssh 配置文件里的密钥路径无效' -ForegroundColor Yellow
    } elseif ($g.Text -match 'Permission denied') {
        Write-Host '         指向：公钥未添加到 GitHub' -ForegroundColor Yellow
        Write-Host '         把 _keys\PUBKEY_复制这一行.txt 的内容加到 https://github.com/settings/keys' -ForegroundColor Yellow
    } elseif ($g.Text -match 'Connection|timed out|refused|resolve') {
        Write-Host '         指向：网络问题，检查 Steam++ 加速状态' -ForegroundColor Yellow
    }
}

# ---------- 4. 提交 ----------
Head '4. 工作区改动'
$dirty = & git -C $root status --porcelain
if ($dirty) {
    Write-Host $dirty
    if ($Message) {
        & git -C $root add -A
        & git -C $root commit -m $Message
        Ok "已提交: $Message"
    } else {
        Warn '有未提交改动。要一起提交请加参数 -Message "你的提交信息"'
    }
} else {
    Ok '工作区干净，无需提交'
}

# ---------- 5. 推送 ----------
Head '5. 推送'
Write-Host '  提交历史:' -ForegroundColor DarkGray
& git -C $root log --oneline

if ($Diagnose) {
    Head '诊断模式'
    Write-Host '  已跳过推送。' -ForegroundColor Yellow
    Write-Host "  自检失败项数: $fail" -ForegroundColor DarkGray
    exit $fail
}

$p = Run-WithTimeout -Exe 'git' -TimeoutSec 120 -CmdArgs @('-C', $root, 'push', '-u', $Remote, $Branch, '--progress')
if ($p.TimedOut) {
    Head '6. 结果'
    Bad '推送超时（超过 120 秒）'
} elseif ($p.Code -eq 0) {
    Head '6. 结果'
    Ok '推送成功'
    Ok '仓库地址: https://github.com/dwtlxxx/04260610'
    Write-Host '  等约 1 分钟后，Pages 地址: https://dwtlxxx.github.io/04260610/' -ForegroundColor Cyan
} else {
    Head '6. 结果'
    Bad "推送失败，退出码 $($p.Code)"
    Write-Host '  远端返回信息:' -ForegroundColor Yellow
    Write-Host $p.Text
    Write-Host '  排查顺序:' -ForegroundColor Yellow
    Write-Host '   1. 公钥是否已加到 https://github.com/settings/keys' -ForegroundColor Yellow
    Write-Host '   2. 网络是否正常，Steam++ 加速状态是否正常' -ForegroundColor Yellow
    Write-Host '   3. 远端有本地没有的提交，先执行 git pull --rebase origin main' -ForegroundColor Yellow
    Write-Host '   4. 把上面完整报错发给我，我来定位' -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  自检失败项数: $fail" -ForegroundColor DarkGray
