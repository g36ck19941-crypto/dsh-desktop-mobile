$ErrorActionPreference = 'Continue'
Write-Host ''
Write-Host '== 1/3 Stopping old dsh web + gzip proxy =='
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'dsh|gzip-proxy' }
if (-not $procs) { Write-Host '  no dsh/gzip-proxy process found' }
foreach ($p in $procs) {
  Write-Host "  killing PID $($p.ProcessId)"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 4

Write-Host ''
Write-Host '== 2/3 Starting gzip proxy (127.0.0.1:3081 -> 127.0.0.1:3080) =='
Start-Process -FilePath 'node' -ArgumentList 'C:\dsh\gzip-proxy.js' -WindowStyle Hidden
Write-Host '  started'

Write-Host ''
Write-Host '== 3/3 Starting dsh web with --trusted-host =='
Write-Host '  success marker:  dsh web: http://127.0.0.1:3080   (Ctrl+C to stop)'
Write-Host ''
& npx.cmd --yes @deepseek-ai/dsh web --trusted-host asus.tail5cb106.ts.net
