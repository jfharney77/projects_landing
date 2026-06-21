#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"

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

echo "Starting backend on http://localhost:8000"
exec uvicorn main:app --reload --port 8000
