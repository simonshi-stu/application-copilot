@echo off
setlocal
cd /d "%~dp0"
node scripts\standalone-hud.mjs %*
