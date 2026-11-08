@echo off
rem Puts a CWC bulletin PDF into inbox\ and pushes it, so the cwc-feed job updates data\cwc-latest.json.
rem   scripts\cwc-add.cmd C:\Users\you\Downloads\CFCR_CWC_DFB_06.11.2026.pdf [remote]
rem The remote defaults to "mine" (your own GitHub repository). Run it from the project folder.
if "%~1"=="" (
  echo Usage: scripts\cwc-add.cmd path\to\bulletin.pdf [remote]
  exit /b 1
)
if not exist "%~1" (
  echo File not found: %~1
  exit /b 1
)
set REMOTE=%~2
if "%REMOTE%"=="" set REMOTE=mine
if not exist inbox mkdir inbox
copy /Y "%~1" inbox\ >nul
if errorlevel 1 exit /b 1
git add inbox
git commit -m "Add CWC bulletin %~nx1"
if errorlevel 1 (
  echo Nothing new to commit: that file is already in inbox.
  exit /b 1
)
git push %REMOTE% main
