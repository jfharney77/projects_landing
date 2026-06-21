#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
PID_DIR="${SCRIPT_DIR}/.pids"

mkdir -p "${PID_DIR}"

# Start backend in background.
(
  cd "${BACKEND_DIR}"
  if [[ ! -d ".venv" ]]; then
    python3 -m venv .venv
  fi
  # shellcheck source=/dev/null
  source .venv/bin/activate
  if [[ ! -f ".venv/.deps_installed" ]]; then
    pip install -r requirements.txt
    touch .venv/.deps_installed
  fi
  exec uvicorn main:app --reload --port 8000
) > "${PID_DIR}/backend.log" 2>&1 &
BACKEND_PID=$!
echo "${BACKEND_PID}" > "${PID_DIR}/backend.pid"

# Start frontend in background.
(
  cd "${FRONTEND_DIR}"
  if [[ ! -d "node_modules" ]]; then
    npm install
  fi
  exec npm run dev
) > "${PID_DIR}/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "${FRONTEND_PID}" > "${PID_DIR}/frontend.pid"

echo "Started backend PID ${BACKEND_PID} on port 8000"
echo "Started frontend PID ${FRONTEND_PID} on port 5177"
echo "Logs: ${PID_DIR}/backend.log and ${PID_DIR}/frontend.log"
