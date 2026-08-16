$ErrorActionPreference = 'Continue'
$env:npm_config_cache = 'C:\dsh\.npmcache'
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
Set-Location 'C:\dsh\desktop'
Write-Host '=== npm install (electron + electron-builder) ==='
npm install --no-audit --no-fund 2>&1 | Select-Object -Last 15
Write-Host "npm-install-exit=$LASTEXITCODE"
Write-Host '=== electron-builder build ==='
npm run build 2>&1 | Select-Object -Last 50
Write-Host "build-exit=$LASTEXITCODE"
Write-Host '=== dist 产物 ==='
Get-ChildItem 'C:\dsh\dist' -ErrorAction SilentlyContinue | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
