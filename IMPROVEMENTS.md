# Projects Landing — Improvements

## Project Activity Feed (live recent file changes)

Added a live feed showing recent file changes across all top-level projects, so
you can see at a glance which project is actively being worked on.

### Backend (`backend/main.py`)
- New `ActivityEvent` model (project, file path, ISO timestamp, epoch, age in seconds).
- New `scan_recent_files()` helper: walks a project tree with `os.walk`, pruning
  noisy/hidden directories in-place (`.git`, `node_modules`, `.venv`, `__pycache__`,
  `dist`, `build`, etc.) and skipping generated file suffixes (`.pyc`, `.log`,
  `.lock`, `.map`, …). Returns each project's most-recently-modified files.
- New `GET /api/activity` endpoint: merges per-project recent files into a single
  newest-first feed.
  - Query params: `limit` (total events, default 40, clamped 1–200) and
    `per_project` (cap per project before merge, default 15, clamped 1–100) so one
    busy project can't crowd out the rest.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- New `#activity` hash route with an `ActivityFeedPage` rendering a compact,
  timeline-style list (project label + monospaced relative file path + relative age).
- `formatRelativeAge()` helper renders "just now / Ns / Nm / Nh / Nd ago".
- **Live polling**: auto-refreshes every 10s while the page is open, with a
  toggle ("● Live" / "▶ Resume Live") and a "last updated" timestamp. The poll
  interval is cleaned up on unmount/route change and pauses when toggled off.
- Header summary shows total recent changes, distinct project count, and the
  most active project.
- Added an "⚡ Activity Feed" button to the dashboard hero for navigation.

### How to use
1. Run backend and frontend as documented in `README.md`.
2. From the dashboard, click **⚡ Activity Feed** (or open `#activity`).
3. Edit a file in any project — within ~10s it appears at the top of the feed.

### Notes / remaining work
- Detection is mtime-based (filesystem), not git-aware, so it reflects all saves,
  not just commits — intentional, to catch in-progress work. A future toggle could
  filter to git-tracked changes only.
- Polling is client-side (10s). Could be upgraded to Server-Sent Events / WebSocket
  for true push if lower latency is needed.
- For very large trees the walk is bounded only by skip-dir pruning; a depth cap or
  caching layer could be added if scanning ever becomes slow.
