@echo off
setlocal
rem One-click setup: publish Draw Advanced 4.6.0, create the exb-i18n-kit GitHub repo,
rem and start the first translation memory build. Safe to run again.
set "GH=%USERPROFILE%\OneDrive - City of Grand Junction\Documents\GitHub"

echo.
echo == 1 of 4: Publish Draw Advanced 4.6.0 to GitHub (no release) ==
pushd "%GH%\draw-advanced-widget" || goto :fail
powershell -NoProfile -ExecutionPolicy Bypass -File .\publish.ps1 -CommitMessage "4.6.0: localization in 39 languages" || goto :fail
popd

echo.
echo == 2 of 4: GitHub Actions workflows ==
pushd "%GH%\exb-i18n-kit" || goto :fail
if not exist ".github\workflows" mkdir ".github\workflows"
copy /Y "docs\memory-workflow.yml" ".github\workflows\memory.yml" >nul || goto :fail
copy /Y "docs\kit-test-workflow.yml" ".github\workflows\test.yml" >nul || goto :fail

echo.
echo == 3 of 4: Create and push the exb-i18n-kit repo ==
if not exist ".git" git init -b main
git add -A
git commit -m "exb-i18n-kit 1.0.0" >nul 2>&1
gh repo view brianmcleer/exb-i18n-kit >nul 2>&1
if errorlevel 1 (
  gh repo create brianmcleer/exb-i18n-kit --public --source . --push || goto :fail
) else (
  git push -u origin main || goto :fail
)

echo.
echo == 4 of 4: Start the translation memory build on GitHub ==
timeout /t 15 /nobreak >nul
gh workflow run memory.yml
if errorlevel 1 (
  echo GitHub has not registered the workflow yet. Run this file again in a minute.
) else (
  echo Started. Watch it at https://github.com/brianmcleer/exb-i18n-kit/actions
)
popd

echo.
echo DONE. When the GitHub run finishes (first run about an hour), double-click sync-draw.cmd.
pause
exit /b 0

:fail
echo.
echo FAILED at the step above. Copy the error and send it to Claude.
pause
exit /b 1
