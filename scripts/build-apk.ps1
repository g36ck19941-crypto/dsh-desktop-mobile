$ErrorActionPreference = 'Continue'
$sdkRoot = 'C:\dsh\android-sdk'
$env:ANDROID_HOME = $sdkRoot
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot'
$env:Path = "$env:JAVA_HOME\bin;$sdkRoot\platform-tools;$env:Path"

# local.properties（sdk 路径）
$sdkDir = $sdkRoot.Replace('\', '\\')
Set-Content -Path 'C:\dsh\android\local.properties' -Value "sdk.dir=$sdkDir" -Encoding Ascii

$gradle = 'C:\dsh\android-tools\gradle-8.5\bin\gradle.bat'
if (-not (Test-Path $gradle)) {
  Write-Host '=== download gradle 8.5 ==='
  Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-8.5-bin.zip' -OutFile 'C:\dsh\android-tools\gradle-8.5-bin.zip'
  Expand-Archive -Path 'C:\dsh\android-tools\gradle-8.5-bin.zip' -DestinationPath 'C:\dsh\android-tools' -Force
  Write-Host "gradle-ready=$([bool](Test-Path $gradle))"
} else {
  Write-Host 'gradle already present'
}

Set-Location 'C:\dsh\android'
Write-Host '=== gradle assembleRelease ==='
& $gradle --no-daemon assembleRelease 2>&1 | Select-Object -Last 60
Write-Host "gradle-exit=$LASTEXITCODE"

Write-Host '=== apk 产物 ==='
Get-ChildItem 'C:\dsh\android\app\build\outputs\apk\release' -ErrorAction SilentlyContinue | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize

New-Item -ItemType Directory -Force -Path 'C:\dsh\dist' | Out-Null
$apk = Get-ChildItem 'C:\dsh\android\app\build\outputs\apk\release\*.apk' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($apk) { Copy-Item $apk.FullName 'C:\dsh\dist\DSH-Mobile-0.1.0.apk' -Force; Write-Host "copied-to-dist=$($apk.Name)" }
