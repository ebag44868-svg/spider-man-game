@echo off
cd /d "%~dp0"
start "spider-server" cmd /c "node serve.js"
timeout /t 1 >nul
start "" http://localhost:8173/game3d.html
