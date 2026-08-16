$log = 'C:\dsh\restart-log.txt'
"restart started at $(Get-Date -Format o)" | Out-File -FilePath $log -Encoding ascii
Start-Sleep -Seconds 10
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'dsh|gzip-proxy' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
"killed PIDs: $($procs.ProcessId -join ',')" | Out-File -FilePath $log -Append -Encoding ascii
Start-Sleep -Seconds 5
Start-Process -FilePath 'node' -ArgumentList 'C:\dsh\gzip-proxy.js' -WindowStyle Hidden
"started: node C:\dsh\gzip-proxy.js" | Out-File -FilePath $log -Append -Encoding ascii
Start-Process -FilePath 'npx.cmd' -ArgumentList @('--yes','@deepseek-ai/dsh','web','--trusted-host','asus.tail5cb106.ts.net') -WindowStyle Normal
"launched: npx --yes @deepseek-ai/dsh web --trusted-host asus.tail5cb106.ts.net" | Out-File -FilePath $log -Append -Encoding ascii
