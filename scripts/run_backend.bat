@echo off
setlocal

set SCRIPT_DIR=%~dp0
for %%I in ("%SCRIPT_DIR%..") do set PROJECT_ROOT=%%~fI
set BACKEND_DIR=%PROJECT_ROOT%\backend

cd /d "%BACKEND_DIR%"

if not exist ".venv" (
  py -3 -m venv .venv
)

call .venv\Scripts\activate.bat
if errorlevel 1 goto :error

if not exist ".venv\.deps_installed" (
  pip install -r requirements.txt
  if errorlevel 1 goto :error
  type nul > .venv\.deps_installed
)

echo Starting backend on http://localhost:8000
uvicorn main:app --reload --port 8000
goto :eof

:error
echo Failed to run backend.
exit /b 1
