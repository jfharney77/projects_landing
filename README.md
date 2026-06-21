# Projects Landing

First-pass web application that lists top-level project directories in the `fable5` workspace.

## Quick Directory Summary

This directory contains a small full-stack app:

- `backend/`: FastAPI API that scans the top-level folders in `/home/john/fable5`, generates a summary for each project, and reports whether each project has its own git repo.
- `frontend/`: React + Vite UI that calls the backend and renders project cards.
- `README.md`: setup, run instructions, and API notes.

## Structure

- `backend/`: FastAPI service exposing project metadata.
- `frontend/`: React + Vite UI for browsing project summaries.

## How To Run

Use two terminals: one for backend, one for frontend.

### 1) Run backend (FastAPI)

```bash
cd /home/john/fable5/projects_landing/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend URL: `http://localhost:8000`

### 2) Run frontend (React + Vite)

```bash
cd /home/john/fable5/projects_landing/frontend
npm install
npm run dev
```

Frontend URL is printed by Vite (usually `http://localhost:5177`).

### 3) Open the app

Open the frontend URL in your browser. The UI will request project data from:

- `GET http://localhost:8000/api/projects`

If your backend runs elsewhere, set `VITE_API_BASE` before starting frontend:

```bash
export VITE_API_BASE="http://localhost:8000"
npm run dev
```

## What You Should See

- A dashboard with all top-level folders in `/home/john/fable5`.
- A summary for each project.
- A git status badge (`Git Repo` or `No Repo`).
- Special summary behavior for `last_second_usage` describing its cron-style token-expiry idea execution purpose.

## Scripts

Scripts are in `scripts/`.

Linux/macOS (bash):

- `./scripts/run_backend.sh`: run backend only
- `./scripts/run_frontend.sh`: run frontend only
- `./scripts/run_both.sh`: start backend and frontend in background and write logs/pids in `scripts/.pids/`
- `./scripts/stop_both.sh`: stop both using pid files and by killing processes on ports 8000 and 5177

Windows (batch):

- `scripts\\run_backend.bat`: run backend only
- `scripts\\run_frontend.bat`: run frontend only
- `scripts\\run_both.bat`: start backend and frontend in separate command windows
- `scripts\\stop_both.bat`: stop processes listening on ports 8000 and 5177

## Scan / ignore config

Which top-level folders the dashboard indexes is controlled by
`backend/scan_config.json` — edit that file (no code change needed) to keep junk
folders out of the project list:

- `include`: allowlist of folder names. If non-empty, **only** these are indexed.
- `ignore`: exact folder names to skip (e.g. `node_modules`, `dist`).
- `ignore_globs`: fnmatch patterns to skip (e.g. `*-archive`, `tmp`).
- `walk_skip_dirs`: extra folder names pruned during deep tree walks
  (activity feed, file tree, README manifest collection).

Hidden dirs (starting with `.`) and the `projects_landing` app folder are always
skipped regardless of config. A missing or malformed file falls back to safe
defaults. `GET /api/scan-config` returns the active config (re-read on each call).

## API

- `GET /api/health`: service health
- `GET /api/scan-config`: active scan/ignore configuration
- `GET /api/projects`: list of top-level folders with summary and git repo flag
- `GET /api/readme/{project_path}`: raw README content for a project
- `GET /api/search-readmes?q=…`: search README *content* across all projects (returns per-project match count + first-line snippet)
