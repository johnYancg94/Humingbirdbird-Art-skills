@echo off
setlocal
set "UNINSTALLER=%LOCALAPPDATA%\Humingbirdbird\PhotoshopCodexBridge\uninstall.ps1"

if not exist "%UNINSTALLER%" (
  echo Photoshop Codex Bridge is not installed for the current user.
  pause
  exit /b 2
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%UNINSTALLER%"
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" echo Uninstall failed. See the message above.
pause
exit /b %CODE%
