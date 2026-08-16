@echo off
title DeepSeek Harness Server
cd /d %USERPROFILE%
set "TH="
if exist "%USERPROFILE%\.dsh\trusted-host.txt" set /p TH=<"%USERPROFILE%\.dsh\trusted-host.txt"
echo ============================================================
if defined TH (
  echo Starting: npx --yes @deepseek-ai/dsh web --trusted-host %TH%
  echo ============================================================
  npx --yes @deepseek-ai/dsh web --trusted-host %TH%
) else (
  echo Starting: npx --yes @deepseek-ai/dsh web
  echo ============================================================
  npx --yes @deepseek-ai/dsh web
)
echo.
echo dsh web 已退出。按任意键关闭此窗口...
pause >nul
