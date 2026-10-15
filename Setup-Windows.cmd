@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org first.
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 (
  pause
  exit /b 1
)
call npm run setup:speech
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo Setup complete. Run Start-Windows.cmd.
echo In Setup, prepare speech recognition and enter your OpenAI API key.
pause
