@echo off
title ResumeForge Pro - server (keep this window open)
cd /d "%~dp0"

set PY=
where python >nul 2>nul && set PY=python
if not defined PY ( where py >nul 2>nul && set PY=py )
if not defined PY (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during setup.
  pause
  exit /b 1
)

echo.
echo  Starting ResumeForge Pro...
echo  Your browser will open http://localhost:8000
echo  KEEP THIS WINDOW OPEN while you use the app. Close it to stop.
echo.
%PY% server.py --open
echo.
echo  The server stopped. If you saw an error above, send it to your developer.
pause
