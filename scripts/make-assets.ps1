# 生成桌面端图标（512 应用图标 / 256 / 32 托盘）+ Android 签名 keystore + 输出 JDK17 路径与局域网 IP
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$desktop = 'C:\dsh\desktop\assets'
New-Item -ItemType Directory -Force -Path $desktop | Out-Null
$androidKeystore = 'C:\dsh\android\keystore'
New-Item -ItemType Directory -Force -Path $androidKeystore | Out-Null

function New-RoundedIcon([int]$size, [string]$path, [bool]$glyph) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  $r = $size * 0.22
  $d = 2 * $r
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc(0, 0, $d, $d, 180, 90)
  $gp.AddArc($size - $d, 0, $d, $d, 270, 90)
  $gp.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $gp.AddArc(0, $size - $d, $d, $d, 90, 90)
  $gp.CloseFigure()

  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.Color]::FromArgb(255, 96, 148, 254),
    [System.Drawing.Color]::FromArgb(255, 41, 84, 168), 90)
  $g.FillPath($brush, $gp)

  if ($glyph) {
    $fontSize = [int]($size * 0.5)
    $font = New-Object System.Drawing.Font('Microsoft YaHei', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $layout = New-Object System.Drawing.RectangleF(0, [float]($size * -0.02), [float]$size, [float]$size)
    $g.DrawString('鲸', $font, $white, $layout, $sf)
    $font.Dispose(); $sf.Dispose(); $white.Dispose()
  } else {
    $dot = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $dr = [float]($size * 0.22)
    $g.FillEllipse($dot, [float]($size / 2 - $dr / 2), [float]($size / 2 - $dr / 2), $dr, $dr)
    $dot.Dispose()
  }

  $g.Dispose(); $brush.Dispose(); $gp.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "icon -> $path"
}

New-RoundedIcon 512 "$desktop\icon.png" $true
New-RoundedIcon 256 "$desktop\icon256.png" $true
New-RoundedIcon 32  "$desktop\tray.png" $false

# Android keystore
$javaExe = (Get-Command java).Source
$binDir = Split-Path $javaExe -Parent
$jdkHome = Split-Path $binDir -Parent
$keytool = Join-Path $binDir 'keytool.exe'
$ks = "$androidKeystore\dsh-release.keystore"
if (Test-Path $ks) { Remove-Item $ks -Force }
& $keytool -genkeypair -v -keystore $ks -alias dsh -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass dsh123456 -keypass dsh123456 `
  -dname "CN=DSH Mobile, OU=Dev, O=DeepSeek, L=Beijing, ST=Beijing, C=CN" 2>&1 | Out-Null
Write-Host "keystore -> $ks"

# JDK17 路径
Write-Host "JDK17_HOME=$jdkHome"
Write-Host "JDK17_KEYTOOL=$keytool"

# 局域网 IP
$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.InterfaceAlias -notlike '*Loopback*'
} | Select-Object -First 1 -ExpandProperty IPAddress
Write-Host "LAN_IP=$ip"
