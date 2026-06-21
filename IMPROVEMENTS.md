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

## Persist sort/filter settings (localStorage + reset control)

The dashboard's search query, repo filter, tech-stack filter, and sort order now
survive a page reload, and there's a one-click control to clear them back to
defaults.

### Frontend (`frontend/src/App.jsx`)
- New `FILTER_STORAGE_KEY` and `DEFAULT_FILTERS` constants define the persisted
  shape (`query`, `repoFilter`, `techFilter`, `sortBy`) and its defaults.
- New `loadStoredFilters()` reads/validates the saved blob from `localStorage`:
  - Each field is validated before use — `repoFilter`/`sortBy` must match a known
    option (`REPO_FILTERS`/`SORT_OPTIONS`), strings are type-checked — so stale or
    tampered storage can't put the UI in an invalid state.
  - Wrapped in `try/catch`; falls back to `DEFAULT_FILTERS` if storage is
    unavailable (private mode, quota) or the JSON is corrupt.
- The four filter `useState` calls now lazily initialize from `loadStoredFilters()`,
  so saved settings apply on first render with no flash of defaults.
- A new `useEffect` writes the current settings to `localStorage` whenever any of
  them change (also `try/catch`-guarded).
- `resetFilters()` (memoized with `useCallback`) restores all four to defaults; the
  persistence effect then clears the stored blob on the next tick.
- `filtersAtDefault` drives a disabled state so the reset button is only active when
  something is actually set.

### Frontend (`frontend/src/styles.css`)
- New `.filter-reset` button styled to match the existing pill `.filter-btn`s, with
  `margin-left: auto` to right-align it, plus hover and `:disabled` (dimmed) states.

### How to use
1. Run backend and frontend as documented in `README.md`.
2. On the dashboard, type a search, pick a Stack/Sort, or toggle a repo filter.
3. Reload the page — your selections are restored automatically.
4. Click **↺ Reset** (right side of the search bar) to clear everything back to
   defaults; the button is greyed out when already at defaults.

### Notes / remaining work
- Build verification (`vite build`) could not be run in this sandbox; the change is
  confined to existing hooks/constants and was reviewed by hand.
- Settings are per-browser (localStorage), not synced across devices. A future
  enhancement could also reflect filters in the URL hash for shareable views.
- The activity-feed "Live" toggle is intentionally *not* persisted, to avoid a tab
  silently polling forever after a reload; could be added if desired.

## Resource usage cards (disk size, file count, staleness)

Added per-project resource metrics to each project card so it's easy to spot
**bloated** (large on-disk footprint) or **stale** (untouched for a long time)
projects at a glance.

### Backend (`backend/main.py`)
- `ProjectSummary` gained two fields: `disk_bytes` (total on-disk size of the
  project tree) and `file_count` (number of files in the tree).
- New `compute_disk_usage()` helper: an iterative, stack-based `os.scandir` walk
  returning `(total_bytes, file_count)`. It intentionally walks the **entire**
  tree — including `node_modules`, `dist`, and `.git` — because those are exactly
  what make a project bloated, so they belong in the footprint. Symlinks are not
  followed (`follow_symlinks=False`), and unreadable entries are skipped rather
  than raising.
- `build_project()` now populates the two new fields, so they flow through
  `GET /api/projects` for both top-level and expandable child cards.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- New formatters: `formatBytes()` (B/KB/MB/GB/TB with 1-decimal precision under
  10), `formatCount()` (pluralized, locale-grouped file count), and `ageInDays()`.
- `ProjectCard` renders a `.resource-usage` row below the "Updated …" line with
  three metrics: 💾 disk size, 🗂 file count, 🕑 time since last change (reusing
  the existing `formatRelativeAge` helper).
- Threshold-based highlighting: disk size ≥ 250 MB (`BLOAT_BYTES`) and no changes
  in ≥ 30 days (`STALE_DAYS`) get the `resource-metric--alert` style (danger
  color, bold) with an explanatory tooltip, making bloated/stale projects pop.
- Styling matches the card's existing muted-metadata look; alerts reuse the
  existing `--danger` token.

### Notes / what remains
- Disk-usage is computed synchronously on each `/api/projects` request. For the
  current workspace this is fast, but a project with a very large `node_modules`
  could add latency; a cache keyed on directory mtime would be the natural next
  step if it ever becomes noticeable.
- The bloat/stale thresholds are fixed constants; they could be made
  user-configurable or sort options (e.g. "largest first", "stalest first") in a
  follow-up.
- Could not run the backend (`python3`)/frontend (`npm run build`) here because
  those commands require interactive approval in this environment; changes were
  reviewed by hand and are self-contained additions that don't alter existing
  fields or behavior.
