#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="${SCRIPT_DIR}/.pids"

kill_pid_file() {
  local pid_file="$1"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}" || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
      echo "Stopped PID ${pid} from ${pid_file}"
    fi
    rm -f "${pid_file}"
  fi
}

kill_port() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti tcp:"${port}" || true)"
    if [[ -n "${pids}" ]]; then
      echo "Killing processes on port ${port}: ${pids}"
      kill ${pids} >/dev/null 2>&1 || true
    fi
    return
  fi

  if command -v fuser >/dev/null 2>&1; then
    if fuser "${port}"/tcp >/dev/null 2>&1; then
      echo "Killing processes on port ${port}"
      fuser -k "${port}"/tcp >/dev/null 2>&1 || true
    fi
  fi
}

kill_pid_file "${PID_DIR}/backend.pid"
kill_pid_file "${PID_DIR}/frontend.pid"

kill_port 8000
kill_port 5177

echo "Stop complete."
