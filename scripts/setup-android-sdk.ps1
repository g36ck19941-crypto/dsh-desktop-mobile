$ErrorActionPreference = 'Continue'
$sdkRoot = 'C:\dsh\android-sdk'
$tools = 'C:\dsh\android-tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$zip = "$tools\cmdline-tools.zip"

Write-Host '=== download cmdline-tools ==='
Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $zip
Write-Host "download-exit=$LASTEXITCODE size=$((Get-Item $zip -ErrorAction SilentlyContinue).Length)"

Write-Host '=== expand ==='
Expand-Archive -Path $zip -DestinationPath $tools -Force

$clt = "$sdkRoot\cmdline-tools\latest"
New-Item -ItemType Directory -Force -Path $clt | Out-Null
Copy-Item "$tools\cmdline-tools\*" $clt -Recurse -Force

$env:ANDROID_HOME = $sdkRoot
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot'
$sdkmanager = "$clt\bin\sdkmanager.bat"

Write-Host '=== accept licenses ==='
$yes = 1..40 | ForEach-Object { 'y' }
$yes | & $sdkmanager --licenses 2>&1 | Select-Object -Last 4

Write-Host '=== install SDK packages ==='
& $sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" 2>&1 | Select-Object -Last 15
Write-Host "sdkmanager-exit=$LASTEXITCODE"

Write-Host '=== sdk root ==='
Get-ChildItem $sdkRoot -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
