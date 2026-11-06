@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Vtuber-Live

cd /d "D:\Vtuber-Live"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo [提示] 正在请求管理员权限，请在弹出的 UAC 窗口中点击“是”...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    echo.
    echo [提示] 已在新窗口以管理员身份启动本脚本。
    echo        本窗口会保留，关闭它不影响新窗口里运行的程序。
    pause
    exit /b
)

echo [信息] 当前已是管理员权限
echo [信息] 工作目录: %CD%
echo.

".venv\Scripts\python.exe" main.py --browser-ui
set "EXITCODE=%errorlevel%"

echo.
echo [信息] 程序已退出，退出码: %EXITCODE%
echo [信息] 按任意键关闭本窗口...
pause >nul