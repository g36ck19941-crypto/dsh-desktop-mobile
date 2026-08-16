$ErrorActionPreference = 'Continue'
$sdkRoot = 'C:\dsh\android-sdk'
$tools = 'C:\dsh\android-tools'
$env:ANDROID_HOME = $sdkRoot
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot'
$env:Path = "$env:JAVA_HOME\bin;$sdkRoot\platform-tools;$sdkRoot\cmdline-tools\latest\bin;$env:Path"

New-Item -ItemType Directory -Force -Path $tools | Out-Null

# ---- 1. cmdline-tools ----
$zip = "$tools\cmdline-tools.zip"
if (-not (Test-Path "$sdkRoot\cmdline-tools\latest\bin\sdkmanager.bat")) {
  Write-Host '=== download cmdline-tools ==='
  Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $zip
  Write-Host "download-exit=$LASTEXITCODE size=$((Get-Item $zip -ErrorAction SilentlyContinue).Length)"
  Expand-Archive -Path $zip -DestinationPath $tools -Force
  $clt = "$sdkRoot\cmdline-tools\latest"
  New-Item -ItemType Directory -Force -Path $clt | Out-Null
  Copy-Item "$tools\cmdline-tools\*" $clt -Recurse -Force
}

$sdkmanager = "$sdkRoot\cmdline-tools\latest\bin\sdkmanager.bat"

# ---- 2. licenses + packages ----
if (-not (Test-Path "$sdkRoot\platforms\android-34")) {
  Write-Host '=== accept licenses ==='
  $yes = 1..40 | ForEach-Object { 'y' }
  $yes | & $sdkmanager --licenses 2>&1 | Select-Object -Last 3
  Write-Host '=== install SDK packages ==='
  & $sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" 2>&1 | Select-Object -Last 8
  Write-Host "sdkmanager-exit=$LASTEXITCODE"
}

# ---- 3. gradle ----
$gradle = "$tools\gradle-8.5\bin\gradle.bat"
if (-not (Test-Path $gradle)) {
  Write-Host '=== download gradle 8.5 ==='
  Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-8.5-bin.zip' -OutFile "$tools\gradle-8.5-bin.zip"
  Expand-Archive -Path "$tools\gradle-8.5-bin.zip" -DestinationPath $tools -Force
}

# ---- 4. local.properties + build ----
$sdkDir = $sdkRoot.Replace('\', '\\')
Set-Content -Path 'C:\dsh\android\local.properties' -Value "sdk.dir=$sdkDir" -Encoding Ascii

Set-Location 'C:\dsh\android'
Write-Host '=== gradle assembleRelease ==='
& $gradle --no-daemon assembleRelease 2>&1 | Select-Object -Last 60
Write-Host "gradle-exit=$LASTEXITCODE"

# ---- 5. copy to dist ----
New-Item -ItemType Directory -Force -Path 'C:\dsh\dist' | Out-Null
Get-ChildItem 'C:\dsh\android\app\build\outputs\apk\release' -ErrorAction SilentlyContinue | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
$apk = Get-ChildItem 'C:\dsh\android\app\build\outputs\apk\release\*.apk' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($apk) { Copy-Item $apk.FullName 'C:\dsh\dist\DSH-Mobile-0.1.0.apk' -Force; Write-Host "copied-to-dist=$($apk.Name)" }
