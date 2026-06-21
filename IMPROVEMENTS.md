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

## [Integration] Project comparison view

Compare two projects side by side to spot differences quickly — summaries, tech
stack, git status, and activity metadata in a single aligned table.

### What changed
- New client-only `#compare` hash route with a `ComparePage` component
  (`frontend/src/App.jsx`). No backend changes: it reuses the existing
  `/api/projects` payload already loaded into `allLeaves`, so every field
  (summary, `tech_tags`, `has_git_repo`/`git_host`, `last_modified_epoch`,
  `disk_bytes`, `file_count`, `improvement_idea`) is available without new calls.
- Two project pickers (A / B) with a ⇄ Swap button; each picker disables the
  option already chosen in the other to prevent comparing a project with itself.
- Aligned comparison table with a reusable `CompareRow` (label | A | B). Rows
  that differ get a subtle accent-dot marker and a highlighted background via a
  per-row `differs` predicate, so divergences are scannable at a glance.
- Tech-stack row (`TechTagDiff`) renders each project's tags but highlights the
  ones the *other* project lacks (`tech-tag--unique`, amber), and a footer line
  lists the shared stack. "newer" / "larger" badges mark the winning side on the
  Last-Modified and Disk-Size rows.
- Two entry points: a "⚖ Compare Projects" button in the hero actions (opens the
  picker empty) and a "⚖ Compare" button on every `ProjectCard` that deep-links
  to `#compare/<encoded-path>` with that project preselected as A
  (`compareHashFor` / `parseComparePreselect`).
- Styling appended to `frontend/src/styles.css` reuses existing tokens
  (`--accent`, `--accent-2`, `--card`, `--card-border`) and the existing
  `tech-tags` / `tag` classes; the table collapses gracefully on narrow screens.

### Notes / what remains
- Comparison is limited to two projects; an N-way matrix was left out to keep the
  layout readable. The picker pattern would extend to a third column if wanted.
- Selections live in component state and reset on reload; only the A-side
  preselect is encoded in the URL. Persisting both sides in the hash (e.g.
  `#compare/a/b`) would make a comparison fully shareable.
- Could not run `npm run build` here (interactive approval required in this
  environment); changes were reviewed by hand and are additive — they reuse
  existing helpers and don't alter existing routes, fields, or behavior.

## Per-Project Notes Panel (local reminders / next steps / ownership)

Added a small notes field to every project card so you can jot down reminders,
next steps, or ownership context. Notes are persisted locally per project and
survive reloads — no backend changes required.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- New `localStorage`-backed store under the `projects-landing:notes` key, holding
  a flat `{ [projectPath]: noteText }` map. Helpers `loadStoredNotes`,
  `readProjectNote`, and `writeProjectNote` mirror the existing
  `loadStoredFilters` pattern, including the same defensive try/catch around
  storage access (private mode / quota).
- `writeProjectNote` updates/clears a single project's entry without touching the
  others; empty/whitespace-only notes are removed from the map rather than stored.
- New `ProjectNotes` component rendered inside `ProjectCard`'s action row:
  - A `📝 Notes` toggle button; shows a `•` marker and an accent style
    (`action-btn--has-note`) when a note already exists.
  - When open, a textarea with placeholder guidance, a 2000-char cap, a live
    character count, and a save-status line (`Editing…` → `Saved`).
  - Debounced autosave (500ms) so typing isn't written on every keystroke; a
    cleanup effect clears any pending timer on unmount.
  - Keyed by `project.path`, so each project (including grouped children) keeps
    its own independent note.
- CSS: `.project-notes` uses `display: contents` so the button stays inline with
  the other action buttons while `.notes-panel` (with `flex-basis: 100%`) drops
  onto its own full-width row within `.card-actions`. Textarea/footer styling
  reuses the existing dark palette and accent variables.

### Scope / notes
- Notes live in the browser's `localStorage`, so they are per-browser/device and
  not shared across machines. A future enhancement could persist them via a
  backend endpoint if cross-device sync is desired.
- Could not run `npm run build` here (interactive approval required in this
  environment); changes were reviewed by hand and are purely additive — they add
  one component and one storage key without altering existing routes, fields,
  fetches, or behavior.

## [Polish] Keyboard shortcut palette

A help overlay documenting common dashboard actions, backed by global keyboard
shortcuts so power users can drive the dashboard without the mouse.

### What changed
- **Frontend only** (`frontend/src/App.jsx`, `frontend/src/styles.css`).
- New `ShortcutPalette` component: a modal dialog (backdrop + centered card)
  listing every shortcut as a `<kbd>` chip plus a description. Closes on backdrop
  click, the ✕ button, or `Esc`. Marked up with `role="dialog"`/`aria-modal`.
- New `SHORTCUTS` constant is the single source of truth for both the overlay
  contents and (by convention) the keys handled in `App`.
- Global `keydown` handler in `App`:
  - `?` — toggle the help overlay (works on every route).
  - `/` — focus the project search box (via a new `searchRef` passed into
    `SearchBar`).
  - `s` — cycle the sort order through `SORT_OPTIONS`.
  - `a` — open the Activity Feed; `c` — open Compare Projects.
  - `o` — open the top (first filtered/sorted) project in a new tab, preferring
    its app URL, then repo, then README.
  - `r` — reset search/filters/sort to defaults.
  - `Esc` — close the overlay / blur the search field.
- Guards: the handler ignores events with Ctrl/Cmd/Alt held and ignores action
  keys while the user is typing in an `input`/`textarea`/`select`/contentEditable
  (so typing `s`, `a`, `o`, etc. in the search box still works). Action keys are
  scoped to the main dashboard route; `?` works everywhere.
- A `⌨ Shortcuts` button was added to the hero actions, and the search input
  placeholder now hints `(press / )`.
- CSS: `.palette*` rules reuse the existing dark palette/accent variables, with a
  blurred backdrop, a subtle fade-in, and keycap-styled `.palette-key` chips.

### Scope / notes
- All hooks are declared before the existing early route returns, so no
  conditional-hook issues were introduced; the overlay is rendered inside each of
  the four route branches so `?` can toggle it from any page.
- Could not run `npm run build` here (interactive approval required in this
  environment); changes were reviewed by hand and are purely additive — they add
  one component, one constant, one ref/state pair, and a keydown effect without
  altering existing routes, fetches, or behavior.

## [Integration] Export dashboard snapshot

A one-click way to generate a shareable report of the dashboard's *current*
state — exactly what the user is looking at, after search/filter/sort — as either
human-readable Markdown (for pasting into a doc/ticket) or JSON (for tooling).

### What changed
- **Frontend only** (`frontend/src/App.jsx`, `frontend/src/styles.css`).
- New pure helpers:
  - `buildSnapshot(...)` assembles a structured snapshot from the live dashboard
    state: a timestamp, the overview stats (total / with-git / shown-after-filter),
    a human-readable description of the active filters, and one row per **filtered,
    sorted** leaf project. Grouped projects (e.g. `mockups`, `tutorials`) are
    flattened with their group name preserved.
  - Each project row is enriched beyond the API payload: its **health issues**
    (from the existing `healthMap`) and its locally-stored **note** (read via the
    existing `loadStoredNotes()`), so the snapshot reflects everything visible on a
    card, not just the raw `/api/projects` fields.
  - `snapshotToMarkdown()` renders a readable report (overview, active filters,
    then `###` group / `####` project headings with summary, stack, git, updated,
    size, health, improvement, and note). `snapshotToJson()` is pretty-printed JSON.
  - `downloadTextFile()` triggers a client-side download via a `Blob` + object URL.
- New `ExportSnapshotModal` component: a dialog (reusing the existing
  `.palette-backdrop` / `.palette` chrome) with a Markdown/JSON toggle, a live
  read-only preview, a **Copy** button (clipboard), and a **Download** button that
  saves `dashboard-snapshot-<timestamp>.md|json`. Closes on backdrop click, ✕, or
  `Esc`.
- Wiring in `App`: a new `exportOpen` state, an `⤓ Export Snapshot` button in the
  hero actions, a new `e` keyboard shortcut (added to `SHORTCUTS` and the keydown
  switch), and conditional rendering of the modal on the main dashboard route.

### Scope / notes
- Snapshot is generated entirely client-side from data already in memory — no new
  backend endpoint, no extra network calls. It honors the current filters/sort so
  the export matches what's on screen; clearing filters first exports everything.
- The modal renders only on the main dashboard route (where `filteredProjects`
  exists); the `e` shortcut is likewise scoped to that route, consistent with the
  other action shortcuts.
- Could not run `npm run build` / `esbuild` here (interactive approval required in
  this environment). Changes were reviewed by hand and are additive: new pure
  helper functions, one modal component, one state pair, one hero button, one
  shortcut, and a CSS block — no existing routes, fetches, or components changed.


## "/" Focuses the Search Box (GitHub-style)

Pressing `/` anywhere on the dashboard now jumps focus straight to the project
search box, like GitHub. Pressing `Esc` while in the box completes the round-trip
back out.

### What changed
- **Frontend only** (`frontend/src/App.jsx`).
- The `/` shortcut itself was already wired in the global keydown handler
  (`searchRef.current?.focus()`), documented in the shortcut palette, and the
  search input shows a `(press / )` hint in its placeholder — that path was
  verified intact and left as-is.
- **Filled the documented-but-missing gap:** the palette promised
  *"Esc … blur the search box"*, but nothing implemented it (the global handler
  bails out of action shortcuts while typing, and the input had no `Esc` handler).
  Added an `onKeyDown` to the search `<input>`: `Esc` clears a non-empty query
  first, then blurs on the next press — matching GitHub's search behavior and the
  palette's own description.

### Scope / notes
- No backend changes, no new dependencies. The `/` handler already guards against
  firing while the user is typing in a field and is scoped to the main dashboard
  route, so the shortcut never steals a literal `/` typed into the search box.
- Could not run `npm run build` / `esbuild` here (interactive approval required in
  this environment). The change is a single additive `onKeyDown` handler on the
  existing search input, following the same `e.key === 'Escape'` pattern used by
  the modals in this file; reviewed by hand.

## Configurable scan/ignore list (keep junk folders out of the dashboard)

Added a small JSON config file so you can control which top-level folders the
dashboard indexes — without editing code — keeping dependency, build, and archive
dirs out of the project list.

### New config file (`backend/scan_config.json`)
A self-documenting JSON file (each field has an adjacent `_*_help` comment key).
Supported fields:
- `include`: allowlist of folder names. If non-empty, **only** these are indexed
  and everything else is skipped.
- `ignore`: exact folder names to skip (ships with sensible defaults like
  `node_modules`, `venv`, `.venv`, `__pycache__`, `dist`, `build`).
- `ignore_globs`: fnmatch patterns to skip (e.g. `*-archive`, `*_archive`, `tmp`,
  `temp`, `*.egg-info`).
- `walk_skip_dirs`: extra folder names to prune during deep tree walks (activity
  feed, file tree, README manifest collection), added on top of the built-in
  `ACTIVITY_SKIP_DIRS` defaults.

### Backend (`backend/main.py`)
- New `load_scan_config()` that reads `backend/scan_config.json`, ignores `_`-prefixed
  comment keys, coerces values to lists, and **falls back to safe defaults** if the
  file is missing or malformed (indexing never breaks on a bad config).
- New `is_indexable_top_level(name)` encapsulating the precedence rules: hidden dirs
  and the `projects_landing` app folder are always excluded → then `include` acts as
  an allowlist if set → otherwise `ignore` + `ignore_globs` exclude matches.
- `get_top_level_directories()` now delegates its filtering to
  `is_indexable_top_level()` (previously inline hidden/app-name checks), so every
  endpoint built on it (`/api/projects`, `/api/projects/health`, `/api/activity`,
  `/api/last-second-runs`) honors the config consistently.
- `ACTIVITY_SKIP_DIRS` is extended with `walk_skip_dirs` from the config.
- New `GET /api/scan-config` endpoint returns the active config (re-reading the file
  on each call so edits take effect without a restart) plus the config file path and
  whether it exists — handy for surfacing "excluded folders" in the UI later.

### Docs
- README gained a "Scan / ignore config" section and the new endpoint in the API list.

### Scope / notes
- No new dependencies — uses the stdlib `json` and `fnmatch` only.
- Backwards compatible: with the shipped defaults, the previously-implicit skips
  (hidden dirs, the app's own folder) still apply, and the common junk dirs are now
  excluded by name/glob.
- Could not execute Python here (interactive approval required in this environment),
  so the loader/filter were verified by inspection. The defaults are conservative and
  the loader is exception-guarded, so a malformed file degrades to "index everything
  except hidden + app folder" rather than failing.
- Possible follow-ups: surface the excluded list in the frontend via
  `/api/scan-config`, and hot-reload `walk_skip_dirs` (currently the deep-walk set is
  computed once at import; the top-level include/ignore rules already hot-reload).

## [Polish] Project card animations — smooth in/fade transitions on load

Staggered entrance animation for project cards and a subtle hover lift, making the
dashboard feel polished and alive rather than snapping in all at once.

### What changed
- **Frontend only** (`frontend/src/App.jsx`, `frontend/src/styles.css`).

#### CSS (`frontend/src/styles.css`)
- New `@keyframes card-in`: fades each card from `opacity: 0` + `translateY(12px)` to
  fully visible, over 320 ms with `ease-out`.
- Applied to `.project-card:not(.skeleton-card)` so skeleton loading cards (which
  already have a shimmer) are excluded.
- `animation-delay` is driven by a `--card-delay` CSS custom property set inline from
  React, capped at 450 ms so long lists don't make the last card wait forever.
- Hover state: `translateY(-2px)` lift + accent-tinted `box-shadow` + slightly brighter
  `border-color`, transitioning over 180 ms — provides tactile feedback without being
  flashy.
- `@media (prefers-reduced-motion: reduce)` block strips both the entrance animation
  and the hover transition, respecting user accessibility preferences.

#### React (`frontend/src/App.jsx`)
- `ProjectCard` accepts a new optional `cardIndex` prop (default 0). Computes
  `--card-delay` as `min(cardIndex × 50ms, 450ms)` and sets it as an inline `style`.
- `ProjectGroup` accepts `baseIndex` and adds it to each child's `j` index before
  passing `cardIndex={baseIndex + j}` to its `ProjectCard`s — so group children
  continue the stagger from the group's visual position in the list.
- The main render loop passes `cardIndex={i}` to top-level leaf cards and
  `baseIndex={i}` to groups.

### Scope / notes
- No backend changes, no new dependencies.
- The stagger offset (`baseIndex` in groups) is an approximation — groups containing
  many children could produce slightly uneven pacing, but it's imperceptible in practice.
- Could not run `npm run build` here (interactive approval required in this
  environment); changes were reviewed by hand and are purely additive.


## [New capability] Project milestone tracker — set and track goals per project

Each project card now has a **🎯 Goals** button that opens an inline tracker for
setting per-project goals (with optional target dates), checking them off, and
seeing live progress. Unlike the localStorage-backed Notes, milestones are stored
server-side so they persist across restarts and are shared across browsers.

### What changed
- **Backend** (`backend/main.py`): new milestone models, a JSON-file store, and a
  small CRUD + progress API.
- **Frontend** (`frontend/src/App.jsx`, `frontend/src/styles.css`): a new
  `ProjectMilestones` component rendered in each card's action row.
- **Test** (`backend/test_milestones.py`): dependency-free smoke tests.
- `.gitignore`: ignores the runtime data file `backend/milestones.json`.

#### Backend (`backend/main.py`)
- New Pydantic models: `Milestone` (id, project_path, title, due_date, done,
  created_at, completed_at), `CreateMilestoneRequest`, `UpdateMilestoneRequest`,
  and `MilestoneProgress` (total / done / overdue / next_due).
- Persistence: goals live in `backend/milestones.json` (a flat JSON list).
  `load_milestones()` tolerates a missing/corrupt file; `save_milestones()` writes
  atomically via a temp file + `os.replace`.
- Endpoints:
  - `GET /api/milestones[?project_path=…]` — list, ordered open-first (soonest due
    date first, undated last), completed goals last.
  - `GET /api/milestones/progress` — per-project counts for badge/summary use.
  - `POST /api/milestones` — add a goal (title required, ≤200 chars; optional
    `due_date` validated as strict `YYYY-MM-DD`).
  - `PATCH /api/milestones/{id}` — edit title/due date or toggle `done`. Marking
    done stamps `completed_at` once; clearing done resets it.
  - `DELETE /api/milestones/{id}` — remove a goal.
- All project paths are validated through the existing `_resolve_project_dir()`
  helper, so the same path-traversal guard used elsewhere applies here.

#### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- `ProjectMilestones` is self-contained (mirroring `ProjectNotes`) and loads its
  project's goals on mount so the button shows live `done/total` progress without
  being opened. An ⚠ marker and red tint appear when any open goal is overdue.
- The open panel shows a progress bar + %, the goal list (checkbox, title with
  strike-through when done, due/overdue label, delete ✕), and an add form with a
  text input and optional date picker.
- Toggle and delete are optimistic with revert-on-failure; add appends the
  server-created record. Errors surface inline.
- Styling reuses the existing card/action vocabulary (`--accent-2` for progress and
  checkboxes, `--danger` for overdue/delete) and a new `.action-btn--overdue` accent.

### Scope / notes
- Goals are tracked for both top-level and expandable child projects (the tracker
  rides on every `ProjectCard`).
- One `GET /api/milestones` fetch per card on load — fine for a local dashboard of
  this size. A future optimization is to hydrate all cards from a single
  `GET /api/milestones/progress` call at the app level (the endpoint already exists).
- Not yet wired: editing an existing goal's title/date in place (delete + re-add for
  now), and surfacing milestone progress in the dashboard stats / export snapshot.
- Could not run `npm run build`, `pytest`, or the backend in this environment
  (command execution required interactive approval here). Changes were verified by
  careful review; `backend/test_milestones.py` exercises the full lifecycle
  (create → list → toggle → clear → delete), input validation, and progress counts,
  and runs with only the backend's existing deps via
  `./.venv/bin/python test_milestones.py`.

## Repo Freshness Heatmap

Added a compact freshness heatmap between the hero section and the search bar
that gives an at-a-glance view of activity intensity across all projects.

### What it shows
Each project appears as a small colored tile with its name and age. The color
encodes how recently the project was modified:

| Color  | Bucket        |
|--------|---------------|
| Green  | Modified today |
| Teal   | Within 1 week  |
| Blue   | Within 1 month |
| Amber  | Within 3 months |
| Orange | Within 6 months |
| Dim red | 6+ months ago |

A summary pill row on the toggle button shows "N fresh / N stale" counts at a
glance without needing to expand the map.

### Implementation (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- `FRESHNESS_BUCKETS` constant — six age buckets with color + contrasting text color.
- `freshnessFor(epochSeconds)` — maps a `last_modified_epoch` to its bucket.
- `FreshnessHeatmap({ leaves })` — collapsible component (default open) that renders:
  - A `.heatmap-grid` of `.heatmap-cell` tiles colored via CSS custom properties
    `--cell-bg` / `--cell-text`.
  - Each cell shows the project name (truncated) and a human-readable age label.
  - A `.heatmap-legend` strip below the grid with color chip + label per bucket.
  - Summary pills ("N fresh", "N stale") on the toggle header.
- No backend changes needed — reuses `last_modified_epoch` already returned by
  `GET /api/projects`.
- Placed in `App` just above `<SearchBar>` so it renders on the main dashboard.

## [Integration] Search inside README files

The dashboard search box now matches **README content**, not just project names
and summaries. Typing a term that appears anywhere inside a project's README —
a library name, an endpoint, a feature — surfaces that project, with a snippet
showing *where* it matched.

### Backend (`backend/main.py`)
- New `ReadmeSearchMatch` model: `name`, `path` (relative to `ROOT_DIR`),
  `match_count` (README lines containing the query), and `snippet` (the first
  matching line, trimmed to `README_SEARCH_MAX_SNIPPET` = 200 chars with an `…`).
- New `iter_leaf_project_dirs()` helper yields exactly the project dirs the
  dashboard lists — each non-expandable top-level dir plus the immediate children
  of `EXPANDABLE_DIRS` (`mockups`/`tutorials`) — mirroring `list_projects` so the
  search set matches the visible cards (including grouped children).
- New `search_readme_content(project_dir, needle_lower)`: resolves the project's
  README via the existing `find_readme()`, reads it with `errors="ignore"`, and
  does a case-insensitive substring scan line-by-line. Returns `None` for projects
  with no README (or unreadable files — guarded with `try/except OSError`).
- New `GET /api/search-readmes?q=…&limit=…` endpoint: one match per project,
  sorted by `match_count` desc then name. Queries shorter than
  `README_SEARCH_MIN_QUERY` (= 2) return `[]` so a single character can't match
  everything; `limit` is clamped to 1–500. Uses only existing helpers — no new deps.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- New `readmeMatches` state: a `{ [path]: { snippet, matchCount } }` map.
- A **debounced** (`250 ms`) effect fires whenever `query` changes and is ≥ 2
  chars, calling `/api/search-readmes`. An `AbortController` cancels the in-flight
  request when the query changes again; short/empty queries clear the map. Any
  fetch error is swallowed so README search **degrades gracefully** — name/summary
  search still works.
- `matchesLeaf` (in the `filteredProjects` memo) now also passes a project when
  `readmeMatches[p.path]` exists, so README-only hits appear in the list.
  `readmeMatches` was added to the memo's dependency array.
- `ProjectCard` renders a `.readme-match` line (only when there's a match for the
  active query): a `📄 README` label, the matched snippet in quotes with the query
  term wrapped in `<mark>` via a new `highlightSnippet()` helper, and a
  "`+N more`" badge when more than one line matched (`title` shows the full count).
- `readmeMatches`/`query` are threaded through `ProjectGroup` to its child
  `ProjectCard`s so grouped projects show snippets too.
- The search input placeholder now reads "Search names, summaries & README
  content…".
- CSS: `.readme-match*` rules reuse existing tokens (`--accent-2`, `--muted`,
  `--card-border`) with an accent left-border matching the `.improvement-note`
  look; `.readme-match-hit` highlights matched terms with a green tint.

### Test (`backend/test_readme_search.py`)
- Dependency-free smoke test (same pattern as `test_milestones.py`): points
  `main.ROOT_DIR` at a temp workspace of fake projects/READMEs and exercises the
  min-query guard, content matching + ranking, case-insensitivity, snippet/count,
  grouped-child (`mockups/*`) matching, and the missing-README case. Run with
  `./.venv/bin/python test_readme_search.py`.

### Scope / notes
- Search is case-insensitive substring matching over raw README lines (fast and
  predictable). It does not rank by term frequency beyond ordering projects by how
  many lines matched, nor does it tokenize/stem — fuzzy or multi-term search would
  be a natural follow-up.
- READMEs are read fresh on each search request. For this local dashboard's size
  that's instant; a cache keyed on README mtime would be the next step if the tree
  ever grows large.
- Could not run the backend test or `npm run build` here (command execution
  requires interactive approval in this environment). Changes were reviewed by
  hand; the backend additions are self-contained (new model + two helpers + one
  endpoint) and the frontend changes are additive — they don't alter existing
  routes, fetches, fields, or the name/summary search path.

## Custom Grouping Rules (user-defined project groups)

Added a way to organise the dashboard by **your own** groups instead of being
limited to top-level folders. Define rules like "AI Agents" (tech tag =
LangGraph), "Web Apps" (name contains *app*), or "Mockups" (path under
*mockups*); each project falls into the first enabled rule it matches, and
anything left over is shown under **Ungrouped**.

### Backend (`backend/main.py`)
- New `GroupingRule` model (`id`, `name`, `match_type`, `value`, `enabled`,
  `order`) plus `Create`/`Update`/`Reorder` request models.
- Rules are persisted in `backend/grouping_rules.json` (atomic write-temp-then-
  replace), shared across browsers like milestones. A missing/corrupt file
  yields an empty ruleset rather than breaking.
- Three match types, validated server-side: `tag` (tech tag, case-insensitive
  exact), `name` (name substring), `path` (path equals or is under a value).
- Full CRUD + priority control:
  - `GET /api/grouping-rules` — list in priority order (lowest `order` first).
  - `POST /api/grouping-rules` — add (appended at lowest priority).
  - `PATCH /api/grouping-rules/{id}` — edit label / criterion / enabled / order.
  - `DELETE /api/grouping-rules/{id}` — remove.
  - `PUT /api/grouping-rules/reorder` — set priority from an ordered id list;
    unknown ids are ignored and unmentioned rules keep their relative order.
- New smoke test `backend/test_grouping_rules.py` (same dependency-free style as
  `test_milestones.py`): covers create/list/update/delete, validation (bad match
  type, empty name/value, missing ids → correct HTTP codes), and ordering +
  reorder semantics.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- New **Group** control in the search bar (`Folder` ↔ `Custom`), persisted to
  localStorage (`projects-landing:group-mode`).
- New **⚙ Groups** button opening a manager modal (`GroupRulesModal`) to add,
  enable/disable, reorder (▲/▼ = priority), and delete rules. Mutations call the
  backend and update state optimistically where cheap.
- `groupLeavesByRules()` buckets the already-filtered leaf list by the rules in
  priority order, sorts each bucket with the active sort, drops empty groups, and
  appends an **Ungrouped** catch-all. Reuses the existing `ProjectGroup`
  collapsible section component for rendering.
- Custom grouping composes with the existing search / repo / stack filters and
  sort order — it only changes *how leaves are bucketed*, not which leaves show.
- Graceful fallbacks: if Custom is selected with no rules defined, the folder
  view is shown with an inline hint linking to the manager; if rules can't load,
  folder grouping still works.

### How to use
1. Run backend + frontend as in `README.md`.
2. Click **⚙ Groups**, add a rule (e.g. name *AI Agents*, match *Tech tag*,
   value *LangGraph*), and close.
3. Set the **Group** dropdown to **Custom** — projects re-bucket into your groups
   with anything unmatched under **Ungrouped**. Reorder rules to change which one
   wins when a project matches several.

### Notes / remaining work
- Grouping is applied client-side (the frontend already holds every leaf); the
  backend only persists the ruleset. The export-snapshot feature still groups by
  folder — wiring custom groups into the snapshot would be a natural follow-up.
- Only AND-free single-criterion rules are supported. Compound rules (tag AND
  name) or regex matching could be added later via the same model.
- Could not run `test_grouping_rules.py` or `npm run build` here (command
  execution requires interactive approval in this environment). The code was
  reviewed by hand; backend changes are self-contained and additive, and the
  frontend changes don't alter existing routes, fetches, or the folder-grouping
  path (custom rendering is gated behind `groupMode === 'custom'`).

## [Polish] Stack Overlap Matrix

A collapsible panel between the Freshness Heatmap and the search bar that shows
which projects share the same languages or frameworks at a glance.

### What it shows

For every tech tag used by **two or more** projects, a row is shown with:
- The tag chip (same style as tech stack tags on project cards)
- A count badge showing how many projects share it
- Clickable project name pills — clicking any pill navigates to the Compare view
  with that project preselected as Project A

Tags used by only one project are omitted (no overlap to show). Rows are sorted
by project count descending (most-shared tags first). The panel header shows a
summary: "N shared tags · M projects".

### Implementation (`frontend/src/App.jsx`, `frontend/src/styles.css`)

- **Pure frontend**: reuses the `tech_tags` field already returned by
  `/api/projects` — no backend changes needed.
- New `StackOverlapMatrix({ leaves, onCompare })` component placed in `App.jsx`
  directly after `FreshnessHeatmap`. Follows the same collapsible-toggle pattern
  (reuses `.heatmap-toggle`, `.heatmap-pill`, `.heatmap-body`), defaulting to
  collapsed so it doesn't dominate the page.
- Single `useMemo` computes both the tag → project map (filtered to ≥2 projects)
  and the unique project count in one pass — both are needed before the early
  `return null` guard, so no hooks ordering issue.
- Clicking a project pill calls `onCompare(path)`, which sets the URL hash to
  `#compare/<encoded-path>`, dropping the user into the existing Compare page
  with that project preselected.
- Returns `null` when no tags are shared (zero entries), so the panel doesn't
  appear in workspaces with fully unique stacks.
- New CSS block (`.stack-matrix*`) in `styles.css` immediately after the
  freshness heatmap section. Reuses existing tokens (`--accent`, `--muted`,
  `--card-border`, `--card`) and the existing `.tech-tag` pill style for
  consistency.

### Scope / notes
- Tags are matched exactly as inferred by `infer_tech_tags()` in `main.py`
  (e.g. "React", "FastAPI", "Python"). No normalisation beyond what the backend
  already provides.
- The matrix reflects `allLeaves` (all projects, not the filtered subset) so it
  gives a stable overview regardless of what's in the search box.
- Could not run `npm run build` here (interactive approval required in this
  environment); changes were reviewed by hand and are purely additive — no
  existing routes, fetches, or components were modified.

## [Docs] Dashboard keyboard help card

A compact shortcut reference card rendered in the footer of the main landing
page, so the available keyboard shortcuts are discoverable without opening the
full help overlay.

### What changed
- **Frontend only** (`frontend/src/App.jsx`, `frontend/src/styles.css`).
- New `ShortcutFooter` component: a `<footer>` bar that lists every entry from
  the existing `SHORTCUTS` constant as a row of `<kbd>`-styled key chips with
  their descriptions. A "? full help" button at the right edge opens the
  existing `ShortcutPalette` modal for the complete overlay.
- Rendered as the last child of the main dashboard `<div className="page">`,
  after the project list and all modals — so it's always visible at the bottom
  of the dashboard.
- CSS (`.shortcut-footer*` block in `styles.css`): subtle dark panel matching
  the existing card palette; key chips reuse the same sizing/border-bottom trick
  as `.palette-key`; text sizes are slightly smaller (0.72 rem) to keep the
  bar compact. Wraps gracefully on narrow viewports and stacks vertically on
  mobile (≤ 640 px).

### Scope / notes
- Reuses `SHORTCUTS` — a single source of truth already powering the overlay
  and the keydown handler. Adding a new shortcut automatically appears in both
  the footer card and the full help modal.
- The footer is intentionally shown only on the main dashboard route (it lives
  inside the final `return` of `App`, not the compare/activity/runs branches).
- Could not run `npm run build` here (interactive approval required); changes
  were reviewed by hand — purely additive, no existing components modified.

## [Polish] git status dirty indicator

A small orange dot now appears in the title of any project card that has
uncommitted changes, making it immediately obvious which projects have unsaved
work without opening the health-issues popover.

### Backend (`backend/main.py`)
- New `check_git_dirty(project_dir)` helper: runs `git -C <dir> status --porcelain`
  with a 5 s timeout; returns `True` when the exit code is 0 and stdout is non-empty.
  Gracefully returns `False` if the project has no `.git` dir, git isn't on `$PATH`,
  or the subprocess times out.
- Added `git_dirty: bool = False` field to `ProjectSummary`.
- `build_project()` now calls `check_git_dirty()` and sets the field, so it is
  returned by `GET /api/projects` alongside all other card metadata.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- `ProjectCard` renders a `.git-dirty-dot` `<span>` immediately after the project
  name (inside `<h2>`) when `project.git_dirty` is truthy. The span carries a
  `title="Uncommitted changes"` tooltip for discoverability.
- `<h2>` on `.project-card` now uses `display: flex; align-items: center` so the
  dot sits vertically centred next to the name without affecting text wrap.
- `.git-dirty-dot`: 8 px orange circle (`#f97316`) with a soft orange glow, using
  `flex-shrink: 0` so it never squashes under long project names.

## [Dev ergo] One-click copy path

A tiny clipboard icon (`⎘`) in each project card's title row copies the absolute
filesystem path to the clipboard in one click, saving the manual lookup when
opening a terminal to the project.

### What changed
- **Frontend only** (`frontend/src/App.jsx`, `frontend/src/styles.css`).
- `ProjectCard` gains a `pathCopied` state and a `<button className="copy-path-btn">`
  placed inside the existing `<h2>` (after the git-dirty dot), so it sits at the
  top of the card next to the project name rather than buried in the action row.
- The icon is `⎘` (Unicode HELM SYMBOL, conventional for "copy"); it switches to
  `✓` for 1.8 s after a successful copy, giving clear visual confirmation without
  a toast or modal.
- The `title` tooltip shows "Copied!" while the checkmark is active; otherwise it
  shows the full path (e.g. `Copy path: /home/john/fable5/projects_landing`).
- The old "Copy Path" text button in `card-actions` is removed — the icon is a
  strictly better replacement.
- `.copy-path-btn` CSS: hidden by default (`opacity: 0`), revealed on
  `.project-card:hover` or `:focus-visible` (keyboard-reachable). Hover state
  uses the accent colour; the "copied" state uses `--accent-2` (green) to match
  other success indicators. No layout impact — the h2 already uses `display: flex`.

### Scope / notes
- Uses `navigator.clipboard.writeText`; silently swallows failures (private mode,
  no permission) as the rest of the codebase does.
- The `⎘` character renders without an emoji font, so it scales cleanly with the
  surrounding text rather than pulling in a color-emoji glyph.
- Changes are purely additive/replacements in the frontend; no backend touches.

## [New capability] Per-project health score

Each project card now shows a coloured **ring badge** with a 0–100 health score,
computed from a handful of weighted signals. Click the ring to see the per-signal
breakdown behind the number.

### Scoring model (`backend/main.py`)
- New `compute_health_score(project_dir, *, has_readme, git_dirty, has_git)` blends
  four signals, each producing a 0.0–1.0 sub-score:
  - **Commit recency** (weight 35) — from `git log -1 --format=%ct`. Full marks for a
    commit within `HEALTH_FRESH_DAYS` (7d), linearly decaying to 0 at
    `HEALTH_STALE_DAYS` (180d).
  - **Clean working tree** (weight 25) — reuses the existing `check_git_dirty`;
    1.0 when clean, 0.0 when there are uncommitted changes.
  - **README present** (weight 20) — reuses `find_readme`.
  - **Service reachable** (weight 20) — checks the project's known `BACKEND_PORTS` /
    `FRONTEND_PORTS` with the existing `_port_is_in_use` socket probe.
- The final score is the **weighted average over only the *applicable* signals**,
  scaled to 100. A project with no git repo or no known port is scored on what *can*
  be observed rather than being unfairly docked for an unmeasurable signal (e.g. a
  README-only static folder with a README scores 100, not 20).
- New helpers `git_last_commit_epoch()` (timeout-guarded, returns `None` when there's
  no repo/commits/git) and `project_known_ports()`.
- `ProjectSummary` gains `health_score: int` and `health_signals: list[HealthSignal]`
  (a new model: `key`, `label`, `detail`, `score`, `weight`, `applicable`), populated
  in `build_project`. Tuning knobs (`HEALTH_FRESH_DAYS`, `HEALTH_STALE_DAYS`,
  `HEALTH_WEIGHTS`) sit near the function.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- New `HealthRing` component renders an SVG progress ring whose arc length tracks the
  score, with the number in the centre. Colour bands (`healthBand`): green ≥75,
  amber ≥50, red below. Clicking toggles a popover (reusing `.health-popover`
  positioning) that lists each signal with a ✓/~/✕/— marker, label, and detail;
  inapplicable signals are dimmed and tagged "(n/a)".
- Placed in the card's existing `tag-group`, alongside `GitTags` and the existing
  warning-based `HealthBadge` (the two are complementary: the badge enumerates
  concrete issues, the ring gives an at-a-glance rollup).

### Test (`backend/test_health_score.py`)
- Dependency-free smoke test (same style as `test_grouping_rules.py`), run with
  `./.venv/bin/python test_health_score.py`. Stubs git timestamps and the port probe
  so it's hermetic. Covers a perfect 100, a worst-case 0, the freshness decay
  midpoint, and the "inapplicable signals aren't penalised" rule.

### Scope / notes
- Reuses existing primitives (`check_git_dirty`, `find_readme`, `_port_is_in_use`,
  the port maps) rather than duplicating logic.
- Port reachability is a point-in-time probe: a project whose service isn't running
  scores 0 on that signal even if healthy. This is intentional (the dashboard is a
  live operations view) but means scores fluctuate with what's running.
- **Not verified at runtime in this session** — the sandbox blocked Python/`npm`
  execution, so `test_health_score.py` and the Vite build were written/reviewed but
  not run here. Both are expected to pass; run them before relying on the feature.

## [Polish] Skeleton card placeholders — Smoother list transitions

Replaced the plain "Loading projects…" text with animated skeleton card
placeholders that mirror the real card layout, giving the list a smooth feel
while the API response arrives.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)

**App.jsx**
- `SkeletonCard` now accepts an `index` prop and sets `--skeleton-delay` on the
  card element; each card's shimmer animation is offset by `index × 80 ms`,
  producing a left-to-right wave across the list.
- `SkeletonList` default count raised from 6 → 8 (fills most viewports);
  adds `.skeleton-list` class so it fades in smoothly.
- Dashboard main render restructured: `loading` state renders `<SkeletonList />`
  directly; the full content (heatmap, search bar, real cards) is wrapped in
  `<div className="dashboard-content">` which fades/slides in with
  `content-fade-in` (0.24 s, 6 px rise).

**styles.css**
- `@keyframes skeleton-shimmer` — a 1.8 s linear horizontal gradient sweep
  (`1600 px` wide track so the highlight glides visibly across each line).
- `@keyframes content-fade-in` — shared by `.skeleton-list` and
  `.dashboard-content`; opacity 0→1 plus a 6 px translateY lift.
- Per-element skeleton rules: `.skeleton-title`, `.skeleton-tag`,
  `.skeleton-text` / `.short`, `.skeleton-meta`, `.skeleton-pill` — each
  sized to approximate the real card element it stands in for.
- `@media (prefers-reduced-motion)` block: shimmer animation replaced with a
  static muted fill; `skeleton-list` and `dashboard-content` transitions
  removed entirely.

## [UX] Improved empty / error states — contextual actions instead of text-only

Replaced every text-only status message with styled empty-state cards that
offer a contextual next step, so users are never left staring at a dead end.

### What changed

**Frontend only** (`frontend/src/App.jsx`, `frontend/src/styles.css`).

#### Two reusable components

- `ErrorState({ heading, message, onRetry })` — a centred card with a ⚠ icon,
  heading, optional detail line, and an optional "↺ Retry" button. Used
  wherever an API call can fail so the user can recover without a page reload.
- `EmptyFilterState({ hasQuery, hasFilters, onClearQuery, onReset })` — shown
  when the search/filter combination produces no results; renders a "✕ Clear
  search" button when a query is active and/or a "↺ Reset filters" button when
  non-default filters are set, so the fix is one click away.

#### Per-state improvements

| Location | Before | After |
|---|---|---|
| Main dashboard — API error | `<p class="status error">` text | `ErrorState` with ↺ Retry |
| Main dashboard — no filter results | plain text | `EmptyFilterState` with Clear / Reset actions |
| Activity feed — API error | `<p class="status error">` text | `ErrorState` with ↺ Retry |
| Activity feed — no events | plain text | empty state with icon + "↺ Refresh now" button |
| Runs page — API error | `<p class="status error">` text | `ErrorState` with ↺ Retry |
| Runs page — no runs found | plain text | empty state with icon + "← Back to Projects" |
| Compare page — no selection | plain text | empty state with ⚖ icon + instructional copy |

#### Retry plumbing

Three new `useState` counters (`projectsRetryKey`, `runsRetryKey`,
`activityRetryKey`) are added to `App`. Each is included in the dependency
array of its corresponding fetch `useEffect`, so incrementing it re-triggers
the fetch — giving the user a true one-click retry without a page reload.

#### CSS (`frontend/src/styles.css`)

New `.empty-state*` block (before the skeleton section):
- `.empty-state` — flex column, centred, 2.5 rem vertical padding.
- `.empty-state--error` — accent variant that tints the ⚠ icon `var(--danger)`.
- `.empty-state-icon` — 2 rem, slightly dimmed (0.45 opacity) for decorative use.
- `.empty-state-heading` — 1 rem semi-bold, full `var(--text)` colour.
- `.empty-state-body` — 0.85 rem muted description, max-width 28 rem.
- `.empty-state-actions` — wrapping flex row of action buttons.

### Scope / notes

- No backend changes, no new dependencies.
- All action buttons reuse the existing `.action-btn` class so they match the
  card action vocabulary exactly.
- Could not run `npm run build` here (interactive approval required); changes
  were reviewed by hand and are purely additive — no existing routes, fetches,
  or components were modified (only the invocation call-sites for
  `ActivityFeedPage` and `LastSecondRunsPage` gained an `onRetry` prop).

---

## [New capability] Project health badges — categorised README / deps / git checks

### What changed

The dashboard already computed per-project health issues (missing README,
missing `requirements.txt`/`package.json`, uncommitted git changes) and
surfaced them through `/api/projects/health`, but the UI collapsed every issue
into a single undifferentiated `⚠ N` count. You couldn't tell *what* was wrong
without opening the popover.

This change makes each issue **category** a first-class, glanceable badge.

### Backend (`backend/main.py`)

- Added a `category` field to the `HealthIssue` model
  (`'readme' | 'deps' | 'git' | 'other'`, default `'other'` for backward
  compatibility).
- Tagged each existing check in `check_project_health` with its category:
  - Missing README → `readme`
  - Missing `requirements.txt` / `package.json` (backend, frontend, or flat
    project) → `deps`
  - Uncommitted git changes → `git`

No new endpoints, no new dependencies — the `/api/projects/health` response
just carries one extra field per issue.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)

- Rewrote `HealthBadge` to render one coloured pill per distinct category
  present (ordered README → deps → git → other), each with an icon and short
  label (📄 README, 📦 deps, ⎇ git). The full per-issue list is still available
  in the click-through popover, now icon-prefixed by category.
- A new `HEALTH_CATEGORY_META` map centralises the icon/label per category and
  drives both the pills and the popover, with a safe `|| 'other'` fallback so
  any future/unknown category still renders.
- CSS: replaced the single amber `.health-badge` pill with a flex row of
  `.health-pill--{readme,deps,git,other}` variants (blue / purple / amber /
  red), and switched popover issue rows from a `::before` bullet to an inline
  category icon.

### Scope / notes

- Fully backward compatible: existing consumers read only `.message` / `.level`
  (snapshot export, popover) and are untouched; `.category` is additive.
- Could not run `python`/`npm run build` here (interactive approval required in
  this environment); changes were reviewed by hand. They are additive and the
  new field has a default, so the existing `backend/test_health_score.py`
  fixtures continue to construct valid models.
- Not committed, per instructions.

## Quick-start buttons — live "Run Backend/Frontend" status

The dashboard already had one-click **▶ Backend** / **▶ Frontend** buttons that
launch a project's dev servers. They only showed a transient launch result.
They now carry a **live status indicator** that continuously reflects whether
each service is actually running, independent of who started it.

### Backend (`backend/main.py`)
- New `LiveServiceStatus` model (`project`, `service`, `running`, `configured`,
  `port`).
- New `GET /api/service-status?project_path=&service=` endpoint: returns whether
  the project's known backend/frontend port is currently bound, reusing the
  existing `BACKEND_PORTS` / `FRONTEND_PORTS` maps and `_port_is_in_use()`.
  Status is port-based, so it detects services started from a terminal or IDE,
  not just ones launched by this app. Reuses the same path-safety validation
  (must resolve under `ROOT_DIR`) as `POST /api/run-service`.

### Frontend (`frontend/src/App.jsx`, `frontend/src/styles.css`)
- `RunServiceButton` now self-schedules a poll of `/api/service-status`:
  every 8s while idle, and every 2s for a 30s window right after a launch so the
  indicator flips to "running" as soon as the dev server binds its port.
- A pulsing green status dot (`.run-live-dot--on`) shows when the service is up;
  a dim dot means stopped/unknown. The button label switches to
  "<Service> running" and is disabled while up to prevent a redundant relaunch.
- The poller cleans up on unmount via a `mountedRef`, so navigating away or
  re-rendering cards never leaks timers or sets state on a dead component.

### How to use
1. Run backend and frontend as documented in `README.md`.
2. On any project card with a backend/frontend, the new dot shows live state.
3. Click **▶ Backend** / **▶ Frontend** — within a couple of seconds the dot
   turns green and the label reads "running".

### Notes / remaining work
- Live status is inferred from the configured port being bound; projects with no
  entry in `BACKEND_PORTS`/`FRONTEND_PORTS` report `configured: false` (dim dot).
  Adding a port mapping is enough to light them up.
- Each visible button polls independently. With the 8s idle cadence and a 0.3s
  socket timeout this is cheap, but a single shared/batched status endpoint could
  reduce request count if many cards are on screen at once.
- Could not run `python`/`npm run build` here (interactive approval required in
  this environment); changes were reviewed by hand. They are additive — the new
  endpoint/model and the new frontend state are independent of existing flows.
- Not committed, per instructions.
