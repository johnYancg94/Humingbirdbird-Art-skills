@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0payload\installer\install.ps1" (
  echo [ERROR] Installer payload is missing.
  pause
  exit /b 2
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0payload\installer\install.ps1" -PayloadRoot "%~dp0payload"
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
  echo Installation completed.
  echo Open Window ^> Extensions ^(Legacy^) ^> Photoshop Codex Bridge in Photoshop.
) else (
  echo Installation failed. See the message above.
)
pause
exit /b %CODE%
