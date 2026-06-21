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

