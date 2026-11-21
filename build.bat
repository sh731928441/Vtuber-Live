@echo off
rem Rebuild BiliVoiceBot.exe (requires .venv, see tutorial)
cd /d "%~dp0"
if exist "disco-src\node_modules" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-disco.ps1"
  if errorlevel 1 (echo DISCO BUILD FAILED & pause & exit /b 1)
) else (
  if not exist "web\disco\index.html" (
    echo Disco assets are missing. Run: cd disco-src ^&^& npm install ^&^& npm run build
    pause
    exit /b 1
  )
  echo Disco prebuilt assets found; skipping frontend rebuild.
)
".venv\Scripts\pyinstaller.exe" --noconfirm --clean --onefile --windowed --name Vtuber-Live --icon "web\favicon.ico" --add-data "web;web" --add-data "games.py;srcdata" --collect-all webview --hidden-import clr --hidden-import qrcode.image.svg --hidden-import miniaudio --exclude-module matplotlib --exclude-module PyQt5 main.py
if errorlevel 1 (echo BUILD FAILED & pause & exit /b 1)
echo Build OK: dist\Vtuber-Live.exe
pause
