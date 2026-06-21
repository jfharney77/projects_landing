@echo off
setlocal

call :KillPort 8000
call :KillPort 5177

echo Stop complete.
exit /b 0

:KillPort
set PORT=%~1
echo Checking port %PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  echo Killing PID %%P on port %PORT%
  taskkill /PID %%P /F >nul 2>&1
)
exit /b 0
