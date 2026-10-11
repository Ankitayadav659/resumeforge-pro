@echo off
title ResumeForge Pro - setup
cd /d "%~dp0"

set PY=
where python >nul 2>nul && set PY=python
if not defined PY ( where py >nul 2>nul && set PY=py )
if not defined PY (
  echo Python was not found. Install it from https://www.python.org/downloads/
  pause
  exit /b 1
)

echo.
echo  Installing the AI package (anthropic) from PyPI...
echo.
%PY% -m pip install --upgrade -r requirements.txt
if errorlevel 1 (
  echo.
  echo  Installation failed. Check your internet connection and try again.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo  Created .env - opening it now. Paste your Anthropic API key after ANTHROPIC_API_KEY=
  echo  then save the file and run start.bat.
  start notepad ".env"
) else (
  echo.
  echo  .env already exists. Make sure ANTHROPIC_API_KEY is filled in, then run start.bat.
)
echo.
pause
