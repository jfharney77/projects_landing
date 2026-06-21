@echo off
setlocal

set SCRIPT_DIR=%~dp0
for %%I in ("%SCRIPT_DIR%..") do set PROJECT_ROOT=%%~fI
set FRONTEND_DIR=%PROJECT_ROOT%\frontend

cd /d "%FRONTEND_DIR%"

if not exist "node_modules" (
  npm install
  if errorlevel 1 goto :error
)

echo Starting frontend on http://localhost:5177
npm run dev
goto :eof

:error
echo Failed to run frontend.
exit /b 1
