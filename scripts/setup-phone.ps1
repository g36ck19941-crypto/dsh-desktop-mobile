# setup-phone.ps1 — 一键配置手机连接（tailscale serve -> gzip 代理 -> dsh web）
# 需要管理员权限运行（UAC）。结果写到 C:\dsh\phone-url.txt
$ErrorActionPreference = 'Continue'
$log = 'C:\dsh\phone-setup.log'
$out = 'C:\dsh\phone-url.txt'

function Log($m) { $m | Out-File -FilePath $log -Append -Encoding utf8; Write-Host $m }
"=== setup started $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8

# 1. 找 tailscale
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path $ts)) { $ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source }
if (-not $ts) { Log 'ERR: 未找到 tailscale，请先安装并登录'; exit 1 }

$status = & $ts status 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $status -match 'Logged out|NeedsLogin') {
  Log '尚未登录 Tailscale，请先运行 tailscale up 登录后，再点一次“手机连接”。'
  exit 1
}

# 2. 取 MagicDNS 名
$dnsName = $null
try {
  $json = & $ts status --json 2>$null | Out-String
  $dnsName = ($json | ConvertFrom-Json).Self.DNSName
} catch {}
$dnsName = ($dnsName -replace '\.$','').Trim()
if (-not $dnsName) { $dnsName = "$env:COMPUTERNAME.tail5cb106.ts.net" }
Log "MagicDNS: $dnsName"

# 3. tailscale serve -> gzip 代理 (127.0.0.1:3081)
& $ts serve reset 2>$null
& $ts serve --bg 3081 2>&1 | Out-String | ForEach-Object { Log $_ }
Log "serve: https://$dnsName -> 127.0.0.1:3081"

# 4. 写 trusted-host.txt（桌面 App 读取它来拼 --trusted-host）
$cfg = Join-Path $env:USERPROFILE '.dsh'
New-Item -ItemType Directory -Force -Path $cfg | Out-Null
Set-Content -Path (Join-Path $cfg 'trusted-host.txt') -Value $dnsName -Encoding Ascii
Log "trusted-host.txt -> $dnsName"

# 5. 输出手机地址
"https://$dnsName" | Out-File -FilePath $out -Encoding ascii
Log 'DONE'
Log "手机 App 地址: https://$dnsName"
