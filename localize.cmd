@echo off
rem Drag a widget folder (the one with manifest.json) onto this file.
setlocal
if "%~1"=="" (
  set /p "W=Paste your widget folder path: "
) else (
  set "W=%~1"
)
node "%~dp0bin\exb-i18n.js" localize "%W%"
echo.
pause
