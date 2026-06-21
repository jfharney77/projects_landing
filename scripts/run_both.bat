@echo off
setlocal

set SCRIPT_DIR=%~dp0

echo Starting backend in a new window...
start "projects-landing-backend" cmd /k "%SCRIPT_DIR%run_backend.bat"

echo Starting frontend in a new window...
start "projects-landing-frontend" cmd /k "%SCRIPT_DIR%run_frontend.bat"

echo Both startup commands were launched.
