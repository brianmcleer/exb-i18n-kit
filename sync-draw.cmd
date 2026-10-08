@echo off
rem Refresh Draw Advanced's 39 language files (Esri + CLDR + shared GitHub memory).
cd /d "%~dp0"
node bin\exb-i18n.js sync "C:\arcgis-experience-builder-1.21\client\your-extensions\widgets\draw-advanced"
pause
