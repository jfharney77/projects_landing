import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SORT_OPTIONS = [
    { value: 'recent', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'name', label: 'Name A-Z' },
];

// ── Freshness heatmap ────────────────────────────────────────────────────────
const FRESHNESS_BUCKETS = [
    { label: 'Today',    maxDays: 1,    color: '#30d18b', textColor: '#0a2218' },
    { label: '< 1 week', maxDays: 7,    color: '#27c8b5', textColor: '#05201c' },
    { label: '< 1 month',maxDays: 30,   color: '#3cb6ff', textColor: '#062030' },
    { label: '< 3 months',maxDays: 90,  color: '#f0a940', textColor: '#2a1a00' },
    { label: '< 6 months',maxDays: 180, color: '#e06530', textColor: '#2a0d00' },
    { label: '6 months+', maxDays: Infinity, color: '#7a5060', textColor: '#e0c8d0' },
];
const FRESHNESS_UNKNOWN = { label: 'Unknown', color: '#2a3558', textColor: '#8fa0d8' };

function freshnessFor(epochSeconds) {
    const days = ageInDays(epochSeconds);
    if (days === null) return FRESHNESS_UNKNOWN;
    return FRESHNESS_BUCKETS.find((b) => days < b.maxDays) || FRESHNESS_BUCKETS[FRESHNESS_BUCKETS.length - 1];
}

function FreshnessHeatmap({ leaves }) {
    const [open, setOpen] = useState(true);

    const bucketCounts = useMemo(() => {
        const counts = new Array(FRESHNESS_BUCKETS.length).fill(0);
        let unknown = 0;
        for (const p of leaves) {
            const days = ageInDays(p.last_modified_epoch);
            if (days === null) { unknown++; continue; }
            const idx = FRESHNESS_BUCKETS.findIndex((b) => days < b.maxDays);
            if (idx >= 0) counts[idx]++;
            else counts[counts.length - 1]++;
        }
        return { counts, unknown };
    }, [leaves]);

    const freshCount = bucketCounts.counts[0] + bucketCounts.counts[1];
    const staleCount = bucketCounts.counts[4] + bucketCounts.counts[5] + bucketCounts.unknown;

    return (
        <div className="freshness-heatmap">
            <button
                className="heatmap-toggle"
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
            >
                <span className="heatmap-toggle-icon">{open ? '▾' : '▸'}</span>
                <span className="heatmap-toggle-label">Freshness Map</span>
                <span className="heatmap-toggle-meta">
                    {freshCount > 0 && <span className="heatmap-pill heatmap-pill--fresh">{freshCount} fresh</span>}
                    {staleCount > 0 && <span className="heatmap-pill heatmap-pill--stale">{staleCount} stale</span>}
                </span>
            </button>
            {open && (
                <div className="heatmap-body">
                    <div className="heatmap-grid" role="list" aria-label="Project freshness grid">
                        {leaves.map((p) => {
                            const bucket = freshnessFor(p.last_modified_epoch);
                            const days = ageInDays(p.last_modified_epoch);
                            const ageLabel = days === null ? 'unknown age'
                                : days < 1 ? 'today'
                                : `${Math.round(days)}d ago`;
                            return (
                                <div
                                    key={p.path}
                                    className="heatmap-cell"
                                    role="listitem"
                                    style={{ '--cell-bg': bucket.color, '--cell-text': bucket.textColor }}
                                    title={`${p.name} · ${ageLabel}`}
                                >
                                    <span className="heatmap-cell-name">{p.name}</span>
                                    <span className="heatmap-cell-age">{ageLabel}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="heatmap-legend" aria-label="Freshness color scale">
                        {FRESHNESS_BUCKETS.map((b) => (
                            <span key={b.label} className="heatmap-legend-item">
                                <span className="heatmap-legend-swatch" style={{ background: b.color }} />
                                <span className="heatmap-legend-label">{b.label}</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Stack overlap matrix ─────────────────────────────────────────────────────
function StackOverlapMatrix({ leaves, onCompare }) {
    const [open, setOpen] = useState(false);

    const { tagMap, uniqueCount } = useMemo(() => {
        const map = new Map();
        for (const p of leaves) {
            for (const tag of (p.tech_tags || [])) {
                if (!map.has(tag)) map.set(tag, []);
                map.get(tag).push(p);
            }
        }
        const entries = [...map.entries()]
            .filter(([, projects]) => projects.length >= 2)
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
        const seen = new Set();
        for (const [, ps] of entries) for (const p of ps) seen.add(p.path);
        return { tagMap: entries, uniqueCount: seen.size };
    }, [leaves]);

    if (tagMap.length === 0) return null;

    return (
        <div className="stack-matrix">
            <button
                className="heatmap-toggle"
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
            >
                <span className="heatmap-toggle-icon">{open ? '▾' : '▸'}</span>
                <span className="heatmap-toggle-label">Stack Overlap Matrix</span>
                <span className="heatmap-toggle-meta">
                    <span className="heatmap-pill heatmap-pill--fresh">
                        {tagMap.length} shared {tagMap.length === 1 ? 'tag' : 'tags'}
                    </span>
                    <span className="heatmap-pill stack-matrix-pill-count">
                        {uniqueCount} projects
                    </span>
                </span>
            </button>
            {open && (
                <div className="heatmap-body stack-matrix-body">
                    <p className="stack-matrix-hint">
                        Tags used by 2+ projects. Click a project to open it in the compare view.
                    </p>
                    <div className="stack-matrix-rows">
                        {tagMap.map(([tag, projects]) => (
                            <div key={tag} className="stack-matrix-row">
                                <div className="stack-matrix-tag-col">
                                    <span className="tech-tag">{tag}</span>
                                    <span className="stack-matrix-count">{projects.length}</span>
                                </div>
                                <div className="stack-matrix-projects">
                                    {projects.map((p) => (
                                        <button
                                            key={p.path}
                                            className="stack-matrix-project"
                                            type="button"
                                            onClick={() => onCompare(p.path)}
                                            title={`Compare ${p.name}`}
                                        >
                                            {p.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

const RUNS_HASH = '#last-second-runs';
const ACTIVITY_HASH = '#activity';
const COMPARE_HASH = '#compare';
const ACTIVITY_POLL_MS = 10000;

const SERVICE_STATUS_LABELS = {
    started: { text: 'Launched', color: 'var(--accent-2)' },
    already_running: { text: 'Already running', color: 'var(--accent)' },
    not_found: { text: 'Not found', color: 'var(--danger)' },
    error: { text: 'Error', color: 'var(--danger)' },
};

function encodeProjectPath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
}

function formatRelativeAge(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return s <= 5 ? 'just now' : `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

function formatLastUpdated(iso) {
    if (!iso) return 'Unknown update time';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Unknown update time';
    return `Updated ${date.toLocaleString()}`;
}

function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = n / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function formatCount(count) {
    const n = Number(count) || 0;
    return `${n.toLocaleString()} file${n === 1 ? '' : 's'}`;
}

// Days since a project's last modification, or null if unknown.
function ageInDays(epochSeconds) {
    const t = Number(epochSeconds);
    if (!t) return null;
    return (Date.now() / 1000 - t) / 86400;
}

const STALE_DAYS = 30;          // no edits in this long → flagged stale
const BLOAT_BYTES = 250 * 1024 * 1024;  // 250 MB → flagged bloated

function leafSortValue(project, sortBy) {
    if (sortBy === 'name') return project.name.toLowerCase();
    return Number(project.last_modified_epoch || 0);
}

function groupSortValue(project, sortBy) {
    if (!project.children || project.children.length === 0) {
        return leafSortValue(project, sortBy);
    }
    if (sortBy === 'name') return project.name.toLowerCase();
    const timestamps = project.children.map((child) => Number(child.last_modified_epoch || 0));
    return sortBy === 'oldest' ? Math.min(...timestamps) : Math.max(...timestamps);
}

function compareProjects(a, b, sortBy, isGroupSort = false) {
    const aValue = isGroupSort ? groupSortValue(a, sortBy) : leafSortValue(a, sortBy);
    const bValue = isGroupSort ? groupSortValue(b, sortBy) : leafSortValue(b, sortBy);

    if (sortBy === 'name') return aValue.localeCompare(bValue);
    if (sortBy === 'oldest') return aValue - bValue;
    return bValue - aValue;
}

function currentHashRoute() {
    return window.location.hash || '';
}

// The compare route may carry a preselected project as `#compare/<encoded-path>`.
function compareHashFor(projectPath) {
    if (!projectPath) return COMPARE_HASH;
    return `${COMPARE_HASH}/${encodeProjectPath(projectPath)}`;
}

function parseComparePreselect(route) {
    if (!route.startsWith(`${COMPARE_HASH}/`)) return '';
    const raw = route.slice(`${COMPARE_HASH}/`.length);
    if (!raw) return '';
    try {
        return raw.split('/').map(decodeURIComponent).join('/');
    } catch {
        return '';
    }
}

// Keyboard shortcuts surfaced in the help overlay (and handled globally on the
// main dashboard). `keys` are display labels; the matching logic lives in App.
const SHORTCUTS = [
    { keys: ['?'], label: 'Toggle this shortcut help' },
    { keys: ['/'], label: 'Focus the project search box' },
    { keys: ['s'], label: 'Cycle sort order' },
    { keys: ['a'], label: 'Open the activity feed' },
    { keys: ['c'], label: 'Open project comparison' },
    { keys: ['e'], label: 'Export a dashboard snapshot' },
    { keys: ['o'], label: 'Open the top project (app, repo, or README)' },
    { keys: ['r'], label: 'Reset search, filters, and sort' },
    { keys: ['Esc'], label: 'Close this help / blur the search box' },
];

// ── Dashboard snapshot export ────────────────────────────────────────────────
// Builds a shareable, self-contained report of what the dashboard is currently
// showing (stats + active filters + the filtered/sorted project list, enriched
// with each project's health issues and locally-stored note). Two formats are
// offered: human-readable Markdown for pasting into docs/tickets, and JSON for
// machine consumption.

function describeFilters({ query, repoFilter, techFilter, sortBy }) {
    const repoLabel = (REPO_FILTERS.find((f) => f.value === repoFilter) || {}).label || repoFilter;
    const sortLabel = (SORT_OPTIONS.find((o) => o.value === sortBy) || {}).label || sortBy;
    return {
        search: query.trim() || null,
        repo: repoLabel,
        stack: techFilter === 'all' ? 'All' : techFilter,
        sort: sortLabel,
    };
}

// Flatten one (possibly grouped) filtered project into report-ready leaf rows,
// attaching the group name, health issues, and any locally-stored note.
function snapshotLeaf(project, group, healthMap, notes) {
    return {
        name: project.name,
        path: project.path,
        group: group || null,
        summary: project.summary || '',
        tech_tags: project.tech_tags || [],
        has_git_repo: !!project.has_git_repo,
        git_host: project.git_host || '',
        git_remote_url: project.git_remote_url || '',
        last_modified: project.last_modified || '',
        disk_bytes: Number(project.disk_bytes) || 0,
        file_count: Number(project.file_count) || 0,
        improvement_idea: project.improvement_idea || '',
        health_issues: (healthMap[project.path] || []).map((i) => i.message),
        note: (notes[project.path] || '').trim(),
    };
}

function buildSnapshot({ filteredProjects, stats, filters, healthMap }) {
    const notes = loadStoredNotes();
    const leaves = [];
    for (const project of filteredProjects) {
        if (project.children && project.children.length > 0) {
            for (const child of project.children) {
                leaves.push(snapshotLeaf(child, project.name, healthMap, notes));
            }
        } else {
            leaves.push(snapshotLeaf(project, null, healthMap, notes));
        }
    }
    return {
        title: 'Fable5 Projects Dashboard',
        generated_at: new Date().toISOString(),
        overview: {
            total_projects: stats.total,
            with_git_repo: stats.withGit,
            shown_in_snapshot: leaves.length,
        },
        filters: describeFilters(filters),
        projects: leaves,
    };
}

function snapshotToJson(snapshot) {
    return JSON.stringify(snapshot, null, 2);
}

function snapshotToMarkdown(snapshot) {
    const lines = [];
    const when = new Date(snapshot.generated_at);
    lines.push(`# ${snapshot.title} — Snapshot`, '');
    lines.push(`_Generated ${when.toLocaleString()}_`, '');

    lines.push('## Overview', '');
    lines.push(`- **Total projects:** ${snapshot.overview.total_projects}`);
    lines.push(`- **With Git repo:** ${snapshot.overview.with_git_repo}`);
    lines.push(`- **Shown in this snapshot:** ${snapshot.overview.shown_in_snapshot}`, '');

    const f = snapshot.filters;
    lines.push('### Active filters', '');
    lines.push(`- **Search:** ${f.search ? `"${f.search}"` : '—'}`);
    lines.push(`- **Repo:** ${f.repo}`);
    lines.push(`- **Stack:** ${f.stack}`);
    lines.push(`- **Sort:** ${f.sort}`, '');

    lines.push('## Projects', '');
    if (snapshot.projects.length === 0) {
        lines.push('_No projects match the current filters._', '');
    }

    let currentGroup = null;
    for (const p of snapshot.projects) {
        if (p.group && p.group !== currentGroup) {
            currentGroup = p.group;
            lines.push(`### ${p.group}`, '');
        } else if (!p.group) {
            currentGroup = null;
        }

        lines.push(`#### ${p.name}`);
        if (p.summary) lines.push(p.summary);
        const meta = [];
        if (p.tech_tags.length) meta.push(`**Stack:** ${p.tech_tags.join(', ')}`);
        meta.push(`**Git:** ${p.has_git_repo
            ? (p.git_remote_url || p.git_host || 'repo')
            : 'No repo'}`);
        if (p.last_modified) {
            meta.push(`**Updated:** ${new Date(p.last_modified).toLocaleString()}`);
        }
        meta.push(`**Size:** ${formatBytes(p.disk_bytes)} · ${formatCount(p.file_count)}`);
        for (const m of meta) lines.push(`- ${m}`);
        if (p.health_issues.length) {
            lines.push(`- **Health:** ${p.health_issues.join('; ')}`);
        }
        if (p.improvement_idea) lines.push(`- **Improvement:** ${p.improvement_idea}`);
        if (p.note) lines.push(`- **Note:** ${p.note}`);
        lines.push('');
    }

    return lines.join('\n');
}

function downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function ExportSnapshotModal({ snapshot, onClose }) {
    const [format, setFormat] = useState('markdown');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        function onKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const content = useMemo(
        () => (format === 'json' ? snapshotToJson(snapshot) : snapshotToMarkdown(snapshot)),
        [format, snapshot],
    );

    const stamp = snapshot.generated_at.slice(0, 19).replace(/[:T]/g, '-');
    const filename = `dashboard-snapshot-${stamp}.${format === 'json' ? 'json' : 'md'}`;
    const mime = format === 'json' ? 'application/json' : 'text/markdown';

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Ignore clipboard failures silently.
        }
    };

    return (
        <div className="palette-backdrop" onClick={onClose} role="presentation">
            <div
                className="palette export-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Export dashboard snapshot"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="palette-head">
                    <h2>Export Dashboard Snapshot</h2>
                    <button className="palette-close" type="button" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className="export-controls">
                    <div className="filter-group">
                        <button
                            className={`filter-btn${format === 'markdown' ? ' active' : ''}`}
                            type="button"
                            onClick={() => setFormat('markdown')}
                        >
                            Markdown
                        </button>
                        <button
                            className={`filter-btn${format === 'json' ? ' active' : ''}`}
                            type="button"
                            onClick={() => setFormat('json')}
                        >
                            JSON
                        </button>
                    </div>
                    <span className="export-meta">
                        {snapshot.overview.shown_in_snapshot} project
                        {snapshot.overview.shown_in_snapshot === 1 ? '' : 's'} · {filename}
                    </span>
                </div>
                <textarea
                    className="export-preview"
                    value={content}
                    readOnly
                    spellCheck={false}
                    aria-label="Snapshot preview"
                />
                <div className="export-actions">
                    <button className="action-btn" type="button" onClick={handleCopy}>
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                        className="action-btn action-btn--run"
                        type="button"
                        onClick={() => downloadTextFile(filename, content, mime)}
                    >
                        ⤓ Download
                    </button>
                </div>
            </div>
        </div>
    );
}

function ShortcutFooter({ onOpenPalette }) {
    return (
        <footer className="shortcut-footer">
            <span className="shortcut-footer-label">Keyboard shortcuts</span>
            <ul className="shortcut-footer-list" aria-label="Keyboard shortcuts quick reference">
                {SHORTCUTS.map((s) => (
                    <li className="shortcut-footer-item" key={s.label}>
                        <span className="shortcut-footer-keys">
                            {s.keys.map((k) => (
                                <kbd className="shortcut-footer-key" key={k}>{k}</kbd>
                            ))}
                        </span>
                        <span className="shortcut-footer-desc">{s.label}</span>
                    </li>
                ))}
            </ul>
            <button
                className="shortcut-footer-more"
                type="button"
                onClick={onOpenPalette}
                title="Show keyboard shortcuts overlay"
            >
                ? full help
            </button>
        </footer>
    );
}

function ShortcutPalette({ onClose }) {
    // Close on Escape regardless of focus while the overlay is mounted.
    useEffect(() => {
        function onKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="palette-backdrop" onClick={onClose} role="presentation">
            <div
                className="palette"
                role="dialog"
                aria-modal="true"
                aria-label="Keyboard shortcuts"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="palette-head">
                    <h2>Keyboard Shortcuts</h2>
                    <button className="palette-close" type="button" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <ul className="palette-list">
                    {SHORTCUTS.map((s) => (
                        <li className="palette-row" key={s.label}>
                            <span className="palette-keys">
                                {s.keys.map((k) => (
                                    <kbd className="palette-key" key={k}>{k}</kbd>
                                ))}
                            </span>
                            <span className="palette-desc">{s.label}</span>
                        </li>
                    ))}
                </ul>
                <p className="palette-foot">Shortcuts work on the dashboard while you're not typing in a field.</p>
            </div>
        </div>
    );
}

const NOTES_STORAGE_KEY = 'projects-landing:notes';
const NOTES_MAX_LENGTH = 2000;
const NOTES_SAVE_DEBOUNCE_MS = 500;

// Notes are a flat { [projectPath]: noteText } map persisted in localStorage so
// per-project reminders / next steps / ownership context survive reloads.
function loadStoredNotes() {
    try {
        const raw = window.localStorage.getItem(NOTES_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function readProjectNote(path) {
    const note = loadStoredNotes()[path];
    return typeof note === 'string' ? note : '';
}

// Persist (or clear, when empty) a single project's note without disturbing others.
function writeProjectNote(path, text) {
    try {
        const all = loadStoredNotes();
        const trimmed = text.trim();
        if (trimmed) {
            all[path] = text;
        } else {
            delete all[path];
        }
        window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(all));
    } catch {
        // Storage may be unavailable (private mode / quota) — ignore.
    }
}

const FILTER_STORAGE_KEY = 'projects-landing:filters';
const DEFAULT_FILTERS = { query: '', repoFilter: 'all', techFilter: 'all', sortBy: 'recent' };
// Minimum query length before searching README content (matches the backend).
const README_SEARCH_MIN_QUERY = 2;

function loadStoredFilters() {
    try {
        const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_FILTERS };
        const parsed = JSON.parse(raw);
        return {
            query: typeof parsed.query === 'string' ? parsed.query : DEFAULT_FILTERS.query,
            repoFilter: REPO_FILTERS.some((f) => f.value === parsed.repoFilter)
                ? parsed.repoFilter
                : DEFAULT_FILTERS.repoFilter,
            techFilter: typeof parsed.techFilter === 'string' ? parsed.techFilter : DEFAULT_FILTERS.techFilter,
            sortBy: SORT_OPTIONS.some((o) => o.value === parsed.sortBy)
                ? parsed.sortBy
                : DEFAULT_FILTERS.sortBy,
        };
    } catch {
        return { ...DEFAULT_FILTERS };
    }
}

function SkeletonCard({ index = 0 }) {
    return (
        <article
            className="project-card skeleton-card"
            aria-hidden="true"
            style={{ '--skeleton-delay': `${index * 0.08}s` }}
        >
            <div className="card-top">
                <span className="skeleton-line skeleton-title" />
                <span className="skeleton-line skeleton-tag" />
            </div>
            <span className="skeleton-line skeleton-text" />
            <span className="skeleton-line skeleton-text short" />
            <span className="skeleton-line skeleton-meta" />
            <div className="card-actions">
                <span className="skeleton-line skeleton-pill" />
                <span className="skeleton-line skeleton-pill" />
                <span className="skeleton-line skeleton-pill" />
            </div>
        </article>
    );
}

function SkeletonList({ count = 8 }) {
    return (
        <div className="top-list skeleton-list" aria-busy="true" aria-label="Loading projects">
            {Array.from({ length: count }, (_, i) => (
                <SkeletonCard key={i} index={i} />
            ))}
        </div>
    );
}

function RunCard({ run }) {
    return (
        <article className="project-card run-card">
            <div className="card-top">
                <h2>{run.name}</h2>
                <div className="tag-group">
                    {run.related_project && (
                        <span className="tag project-ref" title="Associated project">{run.related_project}</span>
                    )}
                    {run.session_limit_hit && (
                        <span className="tag limit-hit" title="Session limit was reached during this run">Limit Hit</span>
                    )}
                </div>
            </div>
            <p>{run.summary}</p>
            <p className="updated-at">{formatLastUpdated(run.last_modified)}</p>
            <div className="card-actions">
                <button
                    className="action-btn"
                    type="button"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(run.path);
                        } catch {
                            // Ignore clipboard failures silently.
                        }
                    }}
                >
                    Copy Path
                </button>
            </div>
        </article>
    );
}

function ActivityRow({ event }) {
    return (
        <li className="activity-row">
            <span className="activity-dot" aria-hidden="true" />
            <div className="activity-body">
                <div className="activity-line">
                    <span className="activity-project">{event.project}</span>
                    <span className="activity-file">{event.file}</span>
                </div>
                <span className="activity-age">{formatRelativeAge(event.age_seconds)}</span>
            </div>
        </li>
    );
}

function ActivityFeedPage({ events, loading, error, live, onToggleLive, lastUpdated, onBack }) {
    const projectCount = useMemo(
        () => new Set(events.map((e) => e.project)).size,
        [events],
    );
    const mostActive = useMemo(() => {
        const counts = {};
        for (const e of events) counts[e.project] = (counts[e.project] || 0) + 1;
        let best = '';
        let bestN = 0;
        for (const [name, n] of Object.entries(counts)) {
            if (n > bestN) { best = name; bestN = n; }
        }
        return best;
    }, [events]);

    return (
        <div className="runs-page activity-page">
            <header className="hero">
                <p className="eyebrow">Activity Feed</p>
                <h1>Recent Project Activity</h1>
                <p className="subtitle">
                    {events.length > 0
                        ? `${events.length} recent file changes across ${projectCount} projects${mostActive ? ` · most active: ${mostActive}` : ''}`
                        : 'Live feed of recent file changes across all projects.'}
                </p>
                <div className="card-actions">
                    <button className="action-btn" type="button" onClick={onBack}>Back To Projects</button>
                    <button
                        className={`action-btn${live ? ' action-btn--live' : ''}`}
                        type="button"
                        onClick={onToggleLive}
                        title="Toggle automatic refresh"
                    >
                        {live ? '● Live' : '▶ Resume Live'}
                    </button>
                    {lastUpdated && (
                        <span className="activity-updated">Updated {lastUpdated.toLocaleTimeString()}</span>
                    )}
                </div>
            </header>

            {loading && events.length === 0 && <p className="status">Loading activity…</p>}
            {error && <p className="status error">{error}</p>}

            {!error && (events.length > 0 || !loading) && (
                <main className="activity-main">
                    {events.length === 0 && <p className="status">No recent activity found.</p>}
                    <ul className="activity-list">
                        {events.map((event) => (
                            <ActivityRow key={event.rel_path} event={event} />
                        ))}
                    </ul>
                </main>
            )}
        </div>
    );
}

function LastSecondRunsPage({ runs, loading, error, onBack }) {
    const limitCount = runs.filter((r) => r.session_limit_hit).length;
    return (
        <div className="runs-page">
            <header className="hero">
                <p className="eyebrow">Run Explorer</p>
                <h1>last_second_usage Runs</h1>
                <p className="subtitle">
                    {runs.length > 0
                        ? `${runs.length} experimental runs · ${limitCount} hit the session limit`
                        : 'Experimental run directories from last_second_usage/runs.'}
                </p>
                <div className="card-actions">
                    <button className="action-btn" type="button" onClick={onBack}>Back To Projects</button>
                </div>
            </header>

            {loading && <p className="status">Loading runs...</p>}
            {error && <p className="status error">{error}</p>}

            {!loading && !error && (
                <main className="grid runs-grid">
                    {runs.length === 0 && <p className="status">No runs found.</p>}
                    {runs.map((run) => (
                        <RunCard key={run.path} run={run} />
                    ))}
                </main>
            )}
        </div>
    );
}

function HealthBadge({ issues }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        function handleClick(e) {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    if (!issues || issues.length === 0) return null;

    return (
        <div className="health-badge-wrap" ref={ref}>
            <button
                className="health-badge"
                type="button"
                onClick={() => setOpen((o) => !o)}
                title={`${issues.length} issue${issues.length !== 1 ? 's' : ''}`}
            >
                ⚠ {issues.length}
            </button>
            {open && (
                <div className="health-popover">
                    <p className="health-popover-title">Health Issues</p>
                    <ul className="health-issue-list">
                        {issues.map((issue, i) => (
                            <li key={i} className={`health-issue health-issue--${issue.level}`}>
                                {issue.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

// Map a 0–100 health score to a colour band: green (healthy), amber (so-so), red (poor).
function healthBand(score) {
    if (score >= 75) return { className: 'good', color: '#3fb950' };
    if (score >= 50) return { className: 'warn', color: '#d29922' };
    return { className: 'poor', color: '#f85149' };
}

// Coloured ring badge summarising a project's weighted 0–100 health score.
// Click to reveal the per-signal breakdown behind the number.
function HealthRing({ score, signals }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        function handleClick(e) {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    if (score === null || score === undefined) return null;

    const value = Math.max(0, Math.min(100, Math.round(score)));
    const band = healthBand(value);
    // SVG ring geometry — 36px box, stroke arc length driven by the score.
    const radius = 15;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - value / 100);

    return (
        <div className="health-ring-wrap" ref={ref}>
            <button
                className={`health-ring health-ring--${band.className}`}
                type="button"
                onClick={() => setOpen((o) => !o)}
                title={`Health score: ${value}/100`}
                aria-label={`Health score ${value} of 100. Click for breakdown.`}
            >
                <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
                    <circle className="health-ring-track" cx="18" cy="18" r={radius} />
                    <circle
                        className="health-ring-value"
                        cx="18" cy="18" r={radius}
                        stroke={band.color}
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                    />
                </svg>
                <span className="health-ring-score" style={{ color: band.color }}>{value}</span>
            </button>
            {open && (
                <div className="health-popover health-ring-popover">
                    <p className="health-popover-title">Health score: {value}/100</p>
                    <ul className="health-signal-list">
                        {(signals || []).map((s) => (
                            <li
                                key={s.key}
                                className={`health-signal${s.applicable ? '' : ' health-signal--na'}`}
                            >
                                <span className="health-signal-dot" aria-hidden="true">
                                    {!s.applicable ? '—' : s.score >= 0.75 ? '✓' : s.score >= 0.5 ? '~' : '✕'}
                                </span>
                                <span className="health-signal-label">{s.label}</span>
                                <span className="health-signal-detail">
                                    {s.applicable ? s.detail : `${s.detail} (n/a)`}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function RunServiceButton({ project, service, label }) {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleClick = useCallback(async () => {
        setLoading(true);
        setStatus(null);
        try {
            const params = new URLSearchParams({ project_path: project.path, service });
            const res = await fetch(`${API_BASE}/api/run-service?${params}`, { method: 'POST' });
            if (!res.ok) throw new Error(`${res.status}`);
            const data = await res.json();
            setStatus(data.status);
        } catch {
            setStatus('error');
        } finally {
            setLoading(false);
        }
        setTimeout(() => setStatus(null), 4000);
    }, [project.path, service]);

    const statusInfo = status ? SERVICE_STATUS_LABELS[status] : null;

    return (
        <span className="run-service-wrap">
            <button
                className="action-btn action-btn--run"
                type="button"
                onClick={handleClick}
                disabled={loading}
                title={`Launch ${label}`}
            >
                {loading ? '…' : `▶ ${label}`}
            </button>
            {statusInfo && (
                <span className="run-status-pill" style={{ color: statusInfo.color }}>
                    {statusInfo.text}
                </span>
            )}
        </span>
    );
}

function GitTags({ project }) {
    if (!project.has_git_repo) return <span className="tag no">No Repo</span>;
    return (
        <>
            <span className="tag yes">Git Repo</span>
            {project.git_host === 'github' && <span className="tag github">GitHub</span>}
            {project.git_host === 'gitlab' && <span className="tag gitlab">GitLab</span>}
            {project.git_host === 'other' && <span className="tag other">Other Remote</span>}
        </>
    );
}

// Collapsible per-project notes field with debounced autosave to localStorage.
function ProjectNotes({ project }) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState(() => readProjectNote(project.path));
    const [saved, setSaved] = useState(false);
    const saveTimer = useRef(null);

    const hasNote = text.trim().length > 0;

    const handleChange = (e) => {
        const next = e.target.value.slice(0, NOTES_MAX_LENGTH);
        setText(next);
        setSaved(false);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            writeProjectNote(project.path, next);
            setSaved(true);
        }, NOTES_SAVE_DEBOUNCE_MS);
    };

    // Flush any pending save when the component unmounts.
    useEffect(() => () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
    }, []);

    return (
        <div className="project-notes">
            <button
                className={`action-btn${hasNote ? ' action-btn--has-note' : ''}`}
                type="button"
                onClick={() => setOpen((o) => !o)}
                title={hasNote ? 'Edit project notes' : 'Add a project note'}
                aria-expanded={open}
            >
                📝 Notes{hasNote ? ' •' : ''}
            </button>
            {open && (
                <div className="notes-panel">
                    <textarea
                        className="notes-textarea"
                        value={text}
                        onChange={handleChange}
                        placeholder="Reminders, next steps, ownership context…"
                        rows={4}
                        maxLength={NOTES_MAX_LENGTH}
                        aria-label={`Notes for ${project.name}`}
                    />
                    <div className="notes-footer">
                        <span className="notes-status">
                            {saved ? 'Saved' : text.trim() ? 'Editing…' : 'Stored locally in this browser'}
                        </span>
                        <span className="notes-count">{text.length}/{NOTES_MAX_LENGTH}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

const MILESTONE_TITLE_MAX = 200;

// Format an ISO 'YYYY-MM-DD' due date as a short, friendly label.
function formatDueDate(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Today's date as 'YYYY-MM-DD' (local) — used to flag overdue goals in the UI.
function todayIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Per-project goal tracker. Self-contained like ProjectNotes, but server-backed
// (goals persist across browsers via the /api/milestones endpoints). Loads on
// mount so the button can show live done/total progress without being opened.
function ProjectMilestones({ project }) {
    const [open, setOpen] = useState(false);
    const [milestones, setMilestones] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const [title, setTitle] = useState('');
    const [due, setDue] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await fetch(
                `${API_BASE}/api/milestones?project_path=${encodeURIComponent(project.path)}`,
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setMilestones(await res.json());
            setError('');
        } catch {
            setError('Could not load goals');
        } finally {
            setLoaded(true);
        }
    }, [project.path]);

    useEffect(() => { load(); }, [load]);

    const total = milestones.length;
    const doneCount = milestones.filter((m) => m.done).length;
    const today = todayIso();
    const overdue = milestones.filter((m) => !m.done && m.due_date && m.due_date < today).length;
    const pct = total ? Math.round((doneCount / total) * 100) : 0;

    const addGoal = async (e) => {
        e.preventDefault();
        const text = title.trim();
        if (!text || busy) return;
        setBusy(true);
        try {
            const res = await fetch(`${API_BASE}/api/milestones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project_path: project.path, title: text, due_date: due }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const created = await res.json();
            setMilestones((prev) => [...prev, created]);
            setTitle('');
            setDue('');
            setError('');
        } catch {
            setError('Could not add goal');
        } finally {
            setBusy(false);
        }
    };

    const toggleGoal = async (m) => {
        // Optimistic flip; revert on failure.
        setMilestones((prev) => prev.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)));
        try {
            const res = await fetch(`${API_BASE}/api/milestones/${m.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: !m.done }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const updated = await res.json();
            setMilestones((prev) => prev.map((x) => (x.id === m.id ? updated : x)));
        } catch {
            setMilestones((prev) => prev.map((x) => (x.id === m.id ? m : x)));
            setError('Could not update goal');
        }
    };

    const deleteGoal = async (m) => {
        const prev = milestones;
        setMilestones((cur) => cur.filter((x) => x.id !== m.id));
        try {
            const res = await fetch(`${API_BASE}/api/milestones/${m.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch {
            setMilestones(prev);
            setError('Could not delete goal');
        }
    };

    const hasGoals = total > 0;
    const label = hasGoals ? `🎯 Goals ${doneCount}/${total}` : '🎯 Goals';

    return (
        <div className="project-milestones">
            <button
                className={`action-btn${hasGoals ? ' action-btn--has-note' : ''}${overdue ? ' action-btn--overdue' : ''}`}
                type="button"
                onClick={() => setOpen((o) => !o)}
                title={overdue ? `${overdue} overdue goal${overdue === 1 ? '' : 's'}` : 'Set and track goals for this project'}
                aria-expanded={open}
            >
                {label}{overdue ? ' ⚠' : ''}
            </button>
            {open && (
                <div className="milestones-panel">
                    {hasGoals && (
                        <div className="milestones-progress" aria-label={`${doneCount} of ${total} goals complete`}>
                            <div className="milestones-bar">
                                <span className="milestones-bar-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="milestones-progress-label">{pct}%</span>
                        </div>
                    )}
                    <ul className="milestones-list">
                        {milestones.map((m) => {
                            const isOverdue = !m.done && m.due_date && m.due_date < today;
                            return (
                                <li key={m.id} className={`milestone-item${m.done ? ' milestone-item--done' : ''}`}>
                                    <label className="milestone-check">
                                        <input
                                            type="checkbox"
                                            checked={m.done}
                                            onChange={() => toggleGoal(m)}
                                            aria-label={`Mark "${m.title}" ${m.done ? 'not done' : 'done'}`}
                                        />
                                        <span className="milestone-title">{m.title}</span>
                                    </label>
                                    {m.due_date && (
                                        <span className={`milestone-due${isOverdue ? ' milestone-due--overdue' : ''}`}>
                                            {isOverdue ? 'Overdue ' : 'Due '}{formatDueDate(m.due_date)}
                                        </span>
                                    )}
                                    <button
                                        className="milestone-delete"
                                        type="button"
                                        onClick={() => deleteGoal(m)}
                                        title="Delete goal"
                                        aria-label={`Delete goal "${m.title}"`}
                                    >
                                        ✕
                                    </button>
                                </li>
                            );
                        })}
                        {loaded && !hasGoals && (
                            <li className="milestones-empty">No goals yet — add one below.</li>
                        )}
                    </ul>
                    <form className="milestone-add" onSubmit={addGoal}>
                        <input
                            className="milestone-input"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value.slice(0, MILESTONE_TITLE_MAX))}
                            placeholder="New goal…"
                            maxLength={MILESTONE_TITLE_MAX}
                            aria-label={`New goal for ${project.name}`}
                        />
                        <input
                            className="milestone-date"
                            type="date"
                            value={due}
                            onChange={(e) => setDue(e.target.value)}
                            title="Optional target date"
                            aria-label="Optional target date"
                        />
                        <button className="action-btn" type="submit" disabled={busy || !title.trim()}>
                            Add
                        </button>
                    </form>
                    {error && <span className="milestones-error">{error}</span>}
                </div>
            )}
        </div>
    );
}

// Render a README snippet with the matched query term highlighted. Splits on
// the (case-insensitive) query and wraps each hit in a <mark>.
function highlightSnippet(snippet, query) {
    const q = (query || '').trim();
    if (!q) return snippet;
    const lower = snippet.toLowerCase();
    const needle = q.toLowerCase();
    const parts = [];
    let i = 0;
    let key = 0;
    while (i < snippet.length) {
        const hit = lower.indexOf(needle, i);
        if (hit === -1) {
            parts.push(snippet.slice(i));
            break;
        }
        if (hit > i) parts.push(snippet.slice(i, hit));
        parts.push(<mark key={key++} className="readme-match-hit">{snippet.slice(hit, hit + needle.length)}</mark>);
        i = hit + needle.length;
    }
    return parts;
}

function ProjectCard({ project, onOpenRuns, healthIssues, cardIndex = 0, readmeMatch = null, query = '' }) {
    const readmeHref = project.readme_url || (project.has_readme
        ? `${API_BASE}/api/readme/${encodeProjectPath(project.path)}`
        : '');

    const [pathCopied, setPathCopied] = useState(false);

    const copyPath = async () => {
        try {
            await navigator.clipboard.writeText(project.path);
            setPathCopied(true);
            setTimeout(() => setPathCopied(false), 1800);
        } catch {
            // Ignore clipboard failures silently to avoid noisy UX.
        }
    };

    const days = ageInDays(project.last_modified_epoch);
    const isStale = days !== null && days >= STALE_DAYS;
    const isBloated = Number(project.disk_bytes) >= BLOAT_BYTES;

    const hasBackend = project.tech_tags && (
        project.tech_tags.includes('FastAPI') ||
        project.tech_tags.includes('Python')
    );
    const hasFrontend = project.tech_tags && (
        project.tech_tags.includes('React') ||
        project.tech_tags.includes('Node')
    );

    const cardDelay = `${Math.min(cardIndex * 50, 450)}ms`;

    return (
        <article className="project-card" style={{ '--card-delay': cardDelay }}>
            <div className="card-top">
                <h2>
                    {project.name}
                    {project.git_dirty && (
                        <span
                            className="git-dirty-dot"
                            title="Uncommitted changes"
                            aria-label="Uncommitted changes"
                        />
                    )}
                    <button
                        className={`copy-path-btn${pathCopied ? ' copy-path-btn--copied' : ''}`}
                        type="button"
                        onClick={copyPath}
                        title={pathCopied ? 'Copied!' : `Copy path: ${project.path}`}
                        aria-label={`Copy filesystem path of ${project.name}`}
                    >
                        {pathCopied ? '✓' : '⎘'}
                    </button>
                </h2>
                <div className="tag-group">
                    <GitTags project={project} />
                    <HealthBadge issues={healthIssues} />
                    <HealthRing score={project.health_score} signals={project.health_signals} />
                </div>
            </div>
            <p>{project.summary}</p>
            {project.improvement_idea && (
                <p className="improvement-note">
                    <strong>Improvement:</strong> {project.improvement_idea}
                </p>
            )}
            {readmeMatch && readmeMatch.snippet && (
                <p className="readme-match" title={`${readmeMatch.matchCount} matching line${readmeMatch.matchCount === 1 ? '' : 's'} in README`}>
                    <span className="readme-match-label" aria-hidden="true">📄 README</span>
                    <span className="readme-match-snippet">“{highlightSnippet(readmeMatch.snippet, query)}”</span>
                    {readmeMatch.matchCount > 1 && (
                        <span className="readme-match-count">+{readmeMatch.matchCount - 1} more</span>
                    )}
                </p>
            )}
            <p className="updated-at">{formatLastUpdated(project.last_modified)}</p>
            <div className="resource-usage" aria-label="Resource usage">
                <span
                    className={`resource-metric${isBloated ? ' resource-metric--alert' : ''}`}
                    title={isBloated ? 'Large on-disk footprint — possibly bloated' : 'Total on-disk size'}
                >
                    <span className="resource-icon" aria-hidden="true">💾</span>
                    {formatBytes(project.disk_bytes)}
                </span>
                <span className="resource-metric" title="Number of files in the project tree">
                    <span className="resource-icon" aria-hidden="true">🗂</span>
                    {formatCount(project.file_count)}
                </span>
                <span
                    className={`resource-metric${isStale ? ' resource-metric--alert' : ''}`}
                    title={isStale ? `No changes in ${Math.round(days)} days — possibly stale` : 'Time since last modification'}
                >
                    <span className="resource-icon" aria-hidden="true">🕑</span>
                    {days === null ? 'unknown' : `${formatRelativeAge(days * 86400)}`}
                </span>
            </div>
            {project.tech_tags && project.tech_tags.length > 0 && (
                <div className="tech-tags" aria-label="Technology tags">
                    {project.tech_tags.map((tag) => (
                        <span className="tech-tag" key={`${project.name}-${tag}`}>{tag}</span>
                    ))}
                </div>
            )}
            <div className="card-actions">
                {project.git_remote_url && (
                    <a className="action-link" href={project.git_remote_url} target="_blank" rel="noreferrer">Repo</a>
                )}
                {readmeHref && (
                    <a className="action-link" href={readmeHref} target="_blank" rel="noreferrer">README</a>
                )}
                {project.app_url && (
                    <a className="action-link" href={project.app_url} target="_blank" rel="noreferrer">Open App</a>
                )}
                {project.path === 'last_second_usage' && (
                    <button className="action-btn" type="button" onClick={onOpenRuns}>View Runs</button>
                )}
                {hasBackend && <RunServiceButton project={project} service="backend" label="Backend" />}
                {hasFrontend && <RunServiceButton project={project} service="frontend" label="Frontend" />}
                <button
                    className="action-btn"
                    type="button"
                    onClick={() => { window.location.hash = compareHashFor(project.path); }}
                    title="Compare this project against another"
                >
                    ⚖ Compare
                </button>
                <ProjectMilestones project={project} />
                <ProjectNotes project={project} />
            </div>
        </article>
    );
}

// ── Custom grouping rules ────────────────────────────────────────────────────
// Beyond the folder-based grouping, users can define rules that bucket leaf
// projects into their own named groups (e.g. "AI Agents", "Web Apps"). Rules are
// persisted server-side (shared across browsers) and applied here, in priority
// order, against the already-filtered leaf list. Each project lands in the first
// enabled rule it matches; anything unmatched falls into "Ungrouped".
const GROUP_MODE_STORAGE_KEY = 'projects-landing:group-mode';
const UNGROUPED_LABEL = 'Ungrouped';

const MATCH_TYPE_OPTIONS = [
    { value: 'tag', label: 'Tech tag', placeholder: 'e.g. React' },
    { value: 'name', label: 'Name contains', placeholder: 'e.g. agent' },
    { value: 'path', label: 'Path is / under', placeholder: 'e.g. mockups' },
];

function matchTypeLabel(type) {
    return (MATCH_TYPE_OPTIONS.find((o) => o.value === type) || {}).label || type;
}

// Does a single leaf project satisfy one grouping rule?
function leafMatchesRule(leaf, rule) {
    const value = (rule.value || '').trim().toLowerCase();
    if (!value) return false;
    if (rule.match_type === 'tag') {
        return (leaf.tech_tags || []).some((t) => t.toLowerCase() === value);
    }
    if (rule.match_type === 'name') {
        return leaf.name.toLowerCase().includes(value);
    }
    if (rule.match_type === 'path') {
        const path = (leaf.path || '').toLowerCase();
        return path === value || path.startsWith(`${value}/`);
    }
    return false;
}

// Bucket leaves into rule-defined groups (priority order), with an "Ungrouped"
// catch-all appended last. Empty groups are dropped. Children within each group
// are sorted with the active sort; groups themselves keep their rule priority,
// with Ungrouped always last. Returns ProjectGroup-shaped objects.
function groupLeavesByRules(leaves, rules, sortBy) {
    const active = rules.filter((r) => r.enabled !== false);
    const buckets = new Map();        // rule.id -> { name, children }
    for (const rule of active) {
        if (!buckets.has(rule.name)) buckets.set(rule.name, { name: rule.name, children: [] });
    }
    const ungrouped = [];

    for (const leaf of leaves) {
        const rule = active.find((r) => leafMatchesRule(leaf, r));
        if (rule) buckets.get(rule.name).children.push(leaf);
        else ungrouped.push(leaf);
    }

    const groups = [];
    // Preserve rule priority order, de-duplicating groups that share a name.
    const seen = new Set();
    for (const rule of active) {
        if (seen.has(rule.name)) continue;
        seen.add(rule.name);
        const bucket = buckets.get(rule.name);
        if (bucket && bucket.children.length > 0) {
            groups.push({
                ...bucket,
                children: [...bucket.children].sort((a, b) => compareProjects(a, b, sortBy)),
            });
        }
    }
    if (ungrouped.length > 0) {
        groups.push({
            name: UNGROUPED_LABEL,
            children: [...ungrouped].sort((a, b) => compareProjects(a, b, sortBy)),
        });
    }
    return groups;
}

function GroupRuleEditor({ rules, busy, error, onAdd, onUpdate, onDelete, onMove }) {
    const [name, setName] = useState('');
    const [matchType, setMatchType] = useState('tag');
    const [value, setValue] = useState('');

    const placeholder = (MATCH_TYPE_OPTIONS.find((o) => o.value === matchType) || {}).placeholder || '';

    const submit = (e) => {
        e.preventDefault();
        if (!name.trim() || !value.trim() || busy) return;
        onAdd({ name: name.trim(), match_type: matchType, value: value.trim() });
        setName('');
        setValue('');
    };

    return (
        <div className="group-rules">
            <ul className="group-rules-list">
                {rules.length === 0 && (
                    <li className="group-rules-empty">
                        No grouping rules yet. Add one below — projects matching it are bucketed
                        together; anything left over shows as “{UNGROUPED_LABEL}”.
                    </li>
                )}
                {rules.map((rule, i) => (
                    <li key={rule.id} className={`group-rule-item${rule.enabled === false ? ' group-rule-item--off' : ''}`}>
                        <span className="group-rule-order">
                            <button
                                className="group-rule-move"
                                type="button"
                                onClick={() => onMove(i, -1)}
                                disabled={i === 0 || busy}
                                title="Higher priority"
                                aria-label={`Move "${rule.name}" up`}
                            >▲</button>
                            <button
                                className="group-rule-move"
                                type="button"
                                onClick={() => onMove(i, 1)}
                                disabled={i === rules.length - 1 || busy}
                                title="Lower priority"
                                aria-label={`Move "${rule.name}" down`}
                            >▼</button>
                        </span>
                        <span className="group-rule-name">{rule.name}</span>
                        <span className="group-rule-crit">
                            {matchTypeLabel(rule.match_type)}: <code>{rule.value}</code>
                        </span>
                        <label className="group-rule-toggle" title="Enable / disable this rule">
                            <input
                                type="checkbox"
                                checked={rule.enabled !== false}
                                onChange={() => onUpdate(rule.id, { enabled: !(rule.enabled !== false) })}
                                disabled={busy}
                                aria-label={`Enable rule "${rule.name}"`}
                            />
                        </label>
                        <button
                            className="group-rule-delete"
                            type="button"
                            onClick={() => onDelete(rule.id)}
                            disabled={busy}
                            title="Delete rule"
                            aria-label={`Delete rule "${rule.name}"`}
                        >✕</button>
                    </li>
                ))}
            </ul>
            <form className="group-rule-add" onSubmit={submit}>
                <input
                    className="group-rule-input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 80))}
                    placeholder="Group name (e.g. AI Agents)"
                    aria-label="New group name"
                />
                <select
                    className="stack-filter group-rule-type"
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value)}
                    aria-label="Match type"
                >
                    {MATCH_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
                <input
                    className="group-rule-input"
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value.slice(0, 200))}
                    placeholder={placeholder}
                    aria-label="Match value"
                />
                <button className="action-btn" type="submit" disabled={busy || !name.trim() || !value.trim()}>
                    Add Rule
                </button>
            </form>
            {error && <p className="group-rules-error">{error}</p>}
        </div>
    );
}

function GroupRulesModal({ rules, busy, error, onAdd, onUpdate, onDelete, onMove, onClose }) {
    useEffect(() => {
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="palette-backdrop" onClick={onClose} role="presentation">
            <div
                className="palette group-rules-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Manage custom grouping rules"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="palette-head">
                    <h2>Custom Grouping Rules</h2>
                    <button className="palette-close" type="button" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <p className="group-rules-intro">
                    Define your own project groups that cut across top-level folders. Each project
                    joins the first enabled rule it matches (top to bottom). Use the arrows to set
                    priority. Switch the dashboard’s <strong>Group</strong> control to “Custom” to
                    see them applied.
                </p>
                <GroupRuleEditor
                    rules={rules}
                    busy={busy}
                    error={error}
                    onAdd={onAdd}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    onMove={onMove}
                />
            </div>
        </div>
    );
}

function ProjectGroup({ project, onOpenRuns, healthMap, baseIndex = 0, readmeMatches = {}, query = '' }) {
    const [open, setOpen] = useState(true);
    return (
        <section className="project-group">
            <button className="group-header" onClick={() => setOpen((o) => !o)}>
                <span className="group-chevron">{open ? '▾' : '▸'}</span>
                <span className="group-name">{project.name}</span>
                <span className="group-count">{project.children.length} projects</span>
            </button>
            {open && (
                <div className="group-grid">
                    {project.children.map((child, j) => (
                        <ProjectCard key={child.name} project={child} onOpenRuns={onOpenRuns} healthIssues={healthMap[child.path]} cardIndex={baseIndex + j} readmeMatch={readmeMatches[child.path]} query={query} />
                    ))}
                </div>
            )}
        </section>
    );
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

const REPO_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'yes', label: 'Has Repo' },
    { value: 'no', label: 'No Repo' },
];

function SearchBar({
    query,
    onQuery,
    repoFilter,
    onRepoFilter,
    techFilter,
    onTechFilter,
    techOptions,
    sortBy,
    onSortBy,
    groupMode,
    onGroupMode,
    onManageGroups,
    resultCount,
    totalCount,
    onReset,
    canReset,
    searchRef,
}) {
    return (
        <div className="search-bar">
            <div className="search-input-wrap">
                <span className="search-icon">⌕</span>
                <input
                    ref={searchRef}
                    type="search"
                    className="search-input"
                    placeholder="Search names, summaries & README content… (press / )"
                    value={query}
                    onChange={(e) => onQuery(e.target.value)}
                    onKeyDown={(e) => {
                        // Esc mirrors GitHub: clear a non-empty query first, then
                        // blur so keyboard focus returns to the page.
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            if (query) onQuery('');
                            else e.currentTarget.blur();
                        }
                    }}
                    aria-label="Search projects"
                />
                {query && (
                    <button className="search-clear" onClick={() => onQuery('')} aria-label="Clear search">✕</button>
                )}
            </div>
            <div className="filter-group">
                {REPO_FILTERS.map((f) => (
                    <button
                        key={f.value}
                        className={`filter-btn${repoFilter === f.value ? ' active' : ''}`}
                        onClick={() => onRepoFilter(f.value)}
                    >
                        {f.label}
                    </button>
                ))}
            </div>
            <label className="stack-filter-wrap">
                <span className="stack-filter-label">Stack</span>
                <select
                    className="stack-filter"
                    value={techFilter}
                    onChange={(e) => onTechFilter(e.target.value)}
                    aria-label="Filter by tech stack"
                >
                    <option value="all">All</option>
                    {techOptions.map((tag) => (
                        <option key={tag} value={tag}>{tag}</option>
                    ))}
                </select>
            </label>
            <label className="stack-filter-wrap">
                <span className="stack-filter-label">Sort</span>
                <select
                    className="stack-filter"
                    value={sortBy}
                    onChange={(e) => onSortBy(e.target.value)}
                    aria-label="Sort projects"
                >
                    {SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </label>
            <label className="stack-filter-wrap group-mode-wrap">
                <span className="stack-filter-label">Group</span>
                <select
                    className="stack-filter"
                    value={groupMode}
                    onChange={(e) => onGroupMode(e.target.value)}
                    aria-label="Group projects"
                >
                    <option value="folder">Folder</option>
                    <option value="custom">Custom</option>
                </select>
            </label>
            <button
                className="filter-btn group-manage-btn"
                type="button"
                onClick={onManageGroups}
                title="Define custom grouping rules"
            >
                ⚙ Groups
            </button>
            {(query || repoFilter !== 'all' || techFilter !== 'all') && (
                <span className="search-results-count">
                    {resultCount} / {totalCount} shown
                </span>
            )}
            <button
                className="filter-reset"
                type="button"
                onClick={onReset}
                disabled={!canReset}
                title="Reset search, filters, and sort to defaults"
            >
                ↺ Reset
            </button>
        </div>
    );
}

function ComparePicker({ label, value, onChange, options, excludePath }) {
    return (
        <label className="compare-picker">
            <span className="compare-picker-label">{label}</span>
            <select
                className="stack-filter compare-select"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-label={label}
            >
                <option value="">Select a project…</option>
                {options.map((p) => (
                    <option key={p.path} value={p.path} disabled={p.path === excludePath}>
                        {p.name}
                    </option>
                ))}
            </select>
        </label>
    );
}

// One labelled metadata row rendered as three columns: label | A | B.
function CompareRow({ label, a, b, render, differs }) {
    const isDiff = typeof differs === 'function'
        ? differs(a, b)
        : JSON.stringify(a) !== JSON.stringify(b);
    return (
        <div className={`compare-row${isDiff ? ' compare-row--diff' : ''}`}>
            <div className="compare-cell compare-cell--label">
                {label}
                {isDiff && <span className="compare-diff-dot" title="Values differ" aria-hidden="true" />}
            </div>
            <div className="compare-cell">{render(a)}</div>
            <div className="compare-cell">{render(b)}</div>
        </div>
    );
}

// Render a project's tech tags, highlighting the ones the other project lacks.
function TechTagDiff({ tags, otherTags }) {
    const others = new Set(otherTags || []);
    if (!tags || tags.length === 0) return <span className="compare-empty">None detected</span>;
    return (
        <div className="tech-tags">
            {tags.map((tag) => (
                <span
                    className={`tech-tag${others.has(tag) ? '' : ' tech-tag--unique'}`}
                    key={tag}
                    title={others.has(tag) ? 'Shared' : 'Only in this project'}
                >
                    {tag}
                </span>
            ))}
        </div>
    );
}

function ComparePage({ leaves, preselect, onBack }) {
    const sorted = useMemo(
        () => [...leaves].sort((a, b) => a.name.localeCompare(b.name)),
        [leaves],
    );

    const [aPath, setAPath] = useState(() => preselect || '');
    const [bPath, setBPath] = useState('');

    // Adopt a freshly-supplied preselect (e.g. arriving from a card's Compare button).
    useEffect(() => {
        if (preselect) setAPath(preselect);
    }, [preselect]);

    const a = useMemo(() => sorted.find((p) => p.path === aPath) || null, [sorted, aPath]);
    const b = useMemo(() => sorted.find((p) => p.path === bPath) || null, [sorted, bPath]);

    const swap = useCallback(() => {
        setAPath(bPath);
        setBPath(aPath);
    }, [aPath, bPath]);

    const sharedTags = useMemo(() => {
        if (!a || !b) return [];
        const bset = new Set(b.tech_tags || []);
        return (a.tech_tags || []).filter((t) => bset.has(t));
    }, [a, b]);

    const ready = a && b;

    return (
        <div className="runs-page compare-page">
            <header className="hero">
                <p className="eyebrow">Project Comparison</p>
                <h1>Compare Projects</h1>
                <p className="subtitle">
                    Put two projects side by side to spot differences in summary, tech stack, and activity.
                </p>
                <div className="card-actions">
                    <button className="action-btn" type="button" onClick={onBack}>Back To Projects</button>
                </div>
            </header>

            <div className="compare-controls">
                <ComparePicker
                    label="Project A"
                    value={aPath}
                    onChange={setAPath}
                    options={sorted}
                    excludePath={bPath}
                />
                <button
                    className="action-btn compare-swap"
                    type="button"
                    onClick={swap}
                    disabled={!aPath && !bPath}
                    title="Swap A and B"
                >
                    ⇄ Swap
                </button>
                <ComparePicker
                    label="Project B"
                    value={bPath}
                    onChange={setBPath}
                    options={sorted}
                    excludePath={aPath}
                />
            </div>

            {!ready && (
                <p className="status">Select two projects to compare them side by side.</p>
            )}

            {ready && (
                <main className="compare-table">
                    <div className="compare-row compare-row--head">
                        <div className="compare-cell compare-cell--label" />
                        <div className="compare-cell compare-cell--name">{a.name}</div>
                        <div className="compare-cell compare-cell--name">{b.name}</div>
                    </div>

                    <CompareRow
                        label="Summary"
                        a={a}
                        b={b}
                        differs={(x, y) => x.summary !== y.summary}
                        render={(p) => <p className="compare-summary">{p.summary}</p>}
                    />
                    <CompareRow
                        label="Tech Stack"
                        a={a}
                        b={b}
                        differs={(x, y) =>
                            JSON.stringify([...(x.tech_tags || [])].sort())
                            !== JSON.stringify([...(y.tech_tags || [])].sort())}
                        render={(p) => (
                            <TechTagDiff
                                tags={p.tech_tags}
                                otherTags={p === a ? b.tech_tags : a.tech_tags}
                            />
                        )}
                    />
                    <CompareRow
                        label="Git Repo"
                        a={a}
                        b={b}
                        differs={(x, y) => x.has_git_repo !== y.has_git_repo || x.git_host !== y.git_host}
                        render={(p) =>
                            p.has_git_repo
                                ? <span className="tag yes">{p.git_host || 'Git'}{p.git_host ? '' : ' Repo'}</span>
                                : <span className="tag no">No Repo</span>}
                    />
                    <CompareRow
                        label="Last Modified"
                        a={a}
                        b={b}
                        differs={(x, y) => x.last_modified_epoch !== y.last_modified_epoch}
                        render={(p) => {
                            const days = ageInDays(p.last_modified_epoch);
                            const newer = a.last_modified_epoch !== b.last_modified_epoch
                                && p.last_modified_epoch === Math.max(a.last_modified_epoch, b.last_modified_epoch);
                            return (
                                <span>
                                    {days === null ? 'unknown' : formatRelativeAge(days * 86400)}
                                    {newer && <span className="compare-badge" title="More recently updated"> · newer</span>}
                                </span>
                            );
                        }}
                    />
                    <CompareRow
                        label="Disk Size"
                        a={a}
                        b={b}
                        differs={(x, y) => Number(x.disk_bytes) !== Number(y.disk_bytes)}
                        render={(p) => {
                            const larger = Number(a.disk_bytes) !== Number(b.disk_bytes)
                                && Number(p.disk_bytes) === Math.max(Number(a.disk_bytes), Number(b.disk_bytes));
                            return (
                                <span>
                                    {formatBytes(p.disk_bytes)}
                                    {larger && <span className="compare-badge" title="Larger footprint"> · larger</span>}
                                </span>
                            );
                        }}
                    />
                    <CompareRow
                        label="Files"
                        a={a}
                        b={b}
                        differs={(x, y) => Number(x.file_count) !== Number(y.file_count)}
                        render={(p) => formatCount(p.file_count)}
                    />
                    <CompareRow
                        label="Improvement Idea"
                        a={a}
                        b={b}
                        differs={(x, y) => x.improvement_idea !== y.improvement_idea}
                        render={(p) => (
                            <p className="compare-summary">{p.improvement_idea || '—'}</p>
                        )}
                    />

                    {sharedTags.length > 0 && (
                        <p className="compare-shared-note">
                            Shared stack: {sharedTags.join(', ')}
                        </p>
                    )}
                </main>
            )}
        </div>
    );
}

function App() {
    const [route, setRoute] = useState(currentHashRoute);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [runs, setRuns] = useState([]);
    const [runsLoading, setRunsLoading] = useState(false);
    const [runsError, setRunsError] = useState('');
    const [healthMap, setHealthMap] = useState({});
    const [activity, setActivity] = useState([]);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityError, setActivityError] = useState('');
    const [activityLive, setActivityLive] = useState(true);
    const [activityUpdated, setActivityUpdated] = useState(null);
    const [query, setQuery] = useState(() => loadStoredFilters().query);
    const [repoFilter, setRepoFilter] = useState(() => loadStoredFilters().repoFilter);
    const [techFilter, setTechFilter] = useState(() => loadStoredFilters().techFilter);
    const [sortBy, setSortBy] = useState(() => loadStoredFilters().sortBy);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    // Custom grouping: rules are server-backed; the active mode is local-only.
    const [groupMode, setGroupMode] = useState(() => {
        try {
            return window.localStorage.getItem(GROUP_MODE_STORAGE_KEY) === 'custom' ? 'custom' : 'folder';
        } catch {
            return 'folder';
        }
    });
    const [groupRules, setGroupRules] = useState([]);
    const [groupRulesOpen, setGroupRulesOpen] = useState(false);
    const [groupBusy, setGroupBusy] = useState(false);
    const [groupError, setGroupError] = useState('');
    // README content-search results, keyed by project path: { snippet, match_count }.
    const [readmeMatches, setReadmeMatches] = useState({});
    const searchRef = useRef(null);

    const filtersAtDefault =
        query === DEFAULT_FILTERS.query &&
        repoFilter === DEFAULT_FILTERS.repoFilter &&
        techFilter === DEFAULT_FILTERS.techFilter &&
        sortBy === DEFAULT_FILTERS.sortBy;

    const resetFilters = useCallback(() => {
        setQuery(DEFAULT_FILTERS.query);
        setRepoFilter(DEFAULT_FILTERS.repoFilter);
        setTechFilter(DEFAULT_FILTERS.techFilter);
        setSortBy(DEFAULT_FILTERS.sortBy);
    }, []);

    // Persist sort/filter/search settings so they survive reloads.
    useEffect(() => {
        try {
            window.localStorage.setItem(
                FILTER_STORAGE_KEY,
                JSON.stringify({ query, repoFilter, techFilter, sortBy }),
            );
        } catch {
            // Storage may be unavailable (private mode / quota) — ignore.
        }
    }, [query, repoFilter, techFilter, sortBy]);

    // Persist the active grouping mode (folder vs. custom) across reloads.
    useEffect(() => {
        try {
            window.localStorage.setItem(GROUP_MODE_STORAGE_KEY, groupMode);
        } catch {
            // Storage may be unavailable — ignore.
        }
    }, [groupMode]);

    // Load the persisted custom grouping rules once on mount.
    const reloadGroupRules = useCallback(async (signal) => {
        try {
            const res = await fetch(`${API_BASE}/api/grouping-rules`, signal ? { signal } : undefined);
            if (!res.ok) return;
            setGroupRules(await res.json());
        } catch {
            // Non-critical — folder grouping still works if rules can't load.
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        reloadGroupRules(controller.signal);
        return () => controller.abort();
    }, [reloadGroupRules]);

    // ── Grouping-rule mutations (optimistic where cheap, else reload) ──────────
    const addGroupRule = useCallback(async (payload) => {
        setGroupBusy(true);
        setGroupError('');
        try {
            const res = await fetch(`${API_BASE}/api/grouping-rules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const created = await res.json();
            setGroupRules((prev) => [...prev, created]);
        } catch {
            setGroupError('Could not add rule');
        } finally {
            setGroupBusy(false);
        }
    }, []);

    const updateGroupRule = useCallback(async (id, patch) => {
        setGroupBusy(true);
        setGroupError('');
        try {
            const res = await fetch(`${API_BASE}/api/grouping-rules/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const updated = await res.json();
            setGroupRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
        } catch {
            setGroupError('Could not update rule');
        } finally {
            setGroupBusy(false);
        }
    }, []);

    const deleteGroupRule = useCallback(async (id) => {
        setGroupBusy(true);
        setGroupError('');
        try {
            const res = await fetch(`${API_BASE}/api/grouping-rules/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setGroupRules((prev) => prev.filter((r) => r.id !== id));
        } catch {
            setGroupError('Could not delete rule');
        } finally {
            setGroupBusy(false);
        }
    }, []);

    // Move a rule up (delta -1) or down (delta +1) in priority, then persist the
    // new order to the backend and adopt its canonical ordering on success.
    const moveGroupRule = useCallback(async (index, delta) => {
        const target = index + delta;
        if (target < 0 || target >= groupRules.length) return;
        const next = [...groupRules];
        [next[index], next[target]] = [next[target], next[index]];
        setGroupRules(next);
        setGroupBusy(true);
        setGroupError('');
        try {
            const res = await fetch(`${API_BASE}/api/grouping-rules/reorder`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order: next.map((r) => r.id) }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setGroupRules(await res.json());
        } catch {
            setGroupError('Could not reorder rules');
            await reloadGroupRules();
        } finally {
            setGroupBusy(false);
        }
    }, [groupRules, reloadGroupRules]);

    // Search inside README content (backend) and merge the results into the
    // client-side filter. Debounced so each keystroke doesn't hit the API; an
    // AbortController cancels in-flight requests when the query changes again.
    useEffect(() => {
        const q = query.trim();
        if (q.length < README_SEARCH_MIN_QUERY) {
            setReadmeMatches({});
            return undefined;
        }
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(
                    `${API_BASE}/api/search-readmes?q=${encodeURIComponent(q)}`,
                    { signal: controller.signal },
                );
                if (!res.ok) return;
                const data = await res.json();
                const next = {};
                for (const m of data) {
                    next[m.path] = { snippet: m.snippet, matchCount: m.match_count };
                }
                setReadmeMatches(next);
            } catch {
                // Aborted or network error — leave matches as-is; name/summary
                // search still works, so README search degrades gracefully.
            }
        }, 250);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    useEffect(() => {
        const onHashChange = () => setRoute(currentHashRoute());
        window.addEventListener('hashchange', onHashChange);

        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    useEffect(() => {
        const controller = new AbortController();

        async function loadProjects() {
            setLoading(true);
            setError('');

            try {
                const response = await fetch(`${API_BASE}/api/projects`, {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(`Request failed with status ${response.status}`);
                }
                const data = await response.json();
                setProjects(data);
            } catch (err) {
                if (err.name === 'AbortError') return;
                setError(err.message || 'Failed to load projects');
            } finally {
                setLoading(false);
            }
        }

        async function loadHealth() {
            try {
                const response = await fetch(`${API_BASE}/api/projects/health`, {
                    signal: controller.signal,
                });
                if (!response.ok) return;
                const data = await response.json();
                const map = {};
                for (const item of data) {
                    map[item.path] = item.issues;
                }
                setHealthMap(map);
            } catch {
                // Non-critical — silently ignore
            }
        }

        loadProjects();
        loadHealth();

        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (route !== RUNS_HASH) return;

        const controller = new AbortController();

        async function loadRuns() {
            setRunsLoading(true);
            setRunsError('');
            try {
                const response = await fetch(`${API_BASE}/api/last-second-runs`, {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(`Request failed with status ${response.status}`);
                }
                const data = await response.json();
                setRuns(data);
            } catch (err) {
                if (err.name === 'AbortError') return;
                setRunsError(err.message || 'Failed to load runs');
            } finally {
                setRunsLoading(false);
            }
        }

        loadRuns();
        return () => controller.abort();
    }, [route]);

    useEffect(() => {
        if (route !== ACTIVITY_HASH) return;

        let cancelled = false;
        let timer = null;

        async function loadActivity(initial) {
            if (initial) setActivityLoading(true);
            try {
                const response = await fetch(`${API_BASE}/api/activity`);
                if (!response.ok) {
                    throw new Error(`Request failed with status ${response.status}`);
                }
                const data = await response.json();
                if (cancelled) return;
                setActivity(data);
                setActivityUpdated(new Date());
                setActivityError('');
            } catch (err) {
                if (!cancelled) setActivityError(err.message || 'Failed to load activity');
            } finally {
                if (!cancelled && initial) setActivityLoading(false);
            }
        }

        loadActivity(true);
        if (activityLive) {
            timer = setInterval(() => loadActivity(false), ACTIVITY_POLL_MS);
        }

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
        };
    }, [route, activityLive]);

    // Flatten all leaf projects (children or top-level) for filter/search.
    const allLeaves = useMemo(() =>
        projects.flatMap((p) => p.children && p.children.length > 0 ? p.children : [p]),
        [projects]);

    const techOptions = useMemo(() => {
        const tags = new Set();
        for (const p of allLeaves) {
            for (const t of (p.tech_tags || [])) tags.add(t);
        }
        return [...tags].sort((a, b) => a.localeCompare(b));
    }, [allLeaves]);

    const filteredProjects = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matchesLeaf = (p) => {
            const passesRepo =
                repoFilter === 'all' ||
                (repoFilter === 'yes' && p.has_git_repo) ||
                (repoFilter === 'no' && !p.has_git_repo);
            const passesTech =
                techFilter === 'all' ||
                (p.tech_tags || []).includes(techFilter);
            const passesQuery =
                !q ||
                p.name.toLowerCase().includes(q) ||
                p.summary.toLowerCase().includes(q) ||
                // README content match comes from the backend search endpoint.
                Boolean(readmeMatches[p.path]);
            return passesRepo && passesTech && passesQuery;
        };

        const matched = projects.reduce((acc, p) => {
            if (p.children && p.children.length > 0) {
                const matchedChildren = [...p.children]
                    .filter(matchesLeaf)
                    .sort((a, b) => compareProjects(a, b, sortBy));
                if (matchedChildren.length > 0) {
                    acc.push({ ...p, children: matchedChildren });
                }
            } else if (matchesLeaf(p)) {
                acc.push(p);
            }
            return acc;
        }, []);

        return matched.sort((a, b) => compareProjects(a, b, sortBy, true));
    }, [projects, query, repoFilter, techFilter, sortBy, readmeMatches]);

    const filteredLeaves = useMemo(() =>
        filteredProjects.flatMap((p) => p.children && p.children.length > 0 ? p.children : [p]),
        [filteredProjects]);

    const filteredLeafCount = filteredLeaves.length;

    // In custom mode, re-bucket the filtered leaves by the user's rules instead
    // of by folder. Falls back to folder grouping when no rules are defined.
    const customGroups = useMemo(
        () => groupLeavesByRules(filteredLeaves, groupRules, sortBy),
        [filteredLeaves, groupRules, sortBy],
    );
    const useCustomGrouping = groupMode === 'custom' && groupRules.length > 0;

    const stats = useMemo(() => {
        const total = allLeaves.length;
        const withGit = allLeaves.filter((p) => p.has_git_repo).length;
        return { total, withGit };
    }, [allLeaves]);

    // The first project in the current (filtered, sorted) list — target of the
    // "open top project" shortcut.
    const topLeaf = useMemo(() => {
        const first = filteredProjects[0];
        if (!first) return null;
        return first.children && first.children.length > 0 ? first.children[0] : first;
    }, [filteredProjects]);

    const openTopProject = useCallback(() => {
        if (!topLeaf) return;
        const href = topLeaf.app_url || topLeaf.git_remote_url || topLeaf.readme_url
            || (topLeaf.has_readme ? `${API_BASE}/api/readme/${encodeProjectPath(topLeaf.path)}` : '');
        if (href) window.open(href, '_blank', 'noopener');
    }, [topLeaf]);

    // Global keyboard shortcuts. `?` toggles help everywhere; the action keys are
    // only live on the main dashboard and are ignored while typing in a field.
    useEffect(() => {
        function onKeyDown(e) {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const el = e.target;
            const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
                || el.tagName === 'SELECT' || el.isContentEditable);

            if (e.key === '?') {
                e.preventDefault();
                setPaletteOpen((o) => !o);
                return;
            }
            if (typing) return;
            // Action shortcuts only apply on the main dashboard route.
            if (route !== '' && route !== '#') return;

            switch (e.key) {
                case '/':
                    e.preventDefault();
                    searchRef.current?.focus();
                    break;
                case 's':
                    setSortBy((prev) => {
                        const i = SORT_OPTIONS.findIndex((o) => o.value === prev);
                        return SORT_OPTIONS[(i + 1) % SORT_OPTIONS.length].value;
                    });
                    break;
                case 'a':
                    window.location.hash = ACTIVITY_HASH;
                    break;
                case 'c':
                    window.location.hash = COMPARE_HASH;
                    break;
                case 'e':
                    setExportOpen(true);
                    break;
                case 'r':
                    resetFilters();
                    break;
                case 'o':
                    openTopProject();
                    break;
                default:
                    break;
            }
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [route, resetFilters, openTopProject]);

    if (route === COMPARE_HASH || route.startsWith(`${COMPARE_HASH}/`)) {
        return (
            <div className="page">
                <ComparePage
                    leaves={allLeaves}
                    preselect={parseComparePreselect(route)}
                    onBack={() => {
                        window.location.hash = '';
                        setRoute('');
                    }}
                />
                {paletteOpen && <ShortcutPalette onClose={() => setPaletteOpen(false)} />}
            </div>
        );
    }

    if (route === ACTIVITY_HASH) {
        return (
            <div className="page">
                <ActivityFeedPage
                    events={activity}
                    loading={activityLoading}
                    error={activityError}
                    live={activityLive}
                    onToggleLive={() => setActivityLive((v) => !v)}
                    lastUpdated={activityUpdated}
                    onBack={() => {
                        window.location.hash = '';
                        setRoute('');
                    }}
                />
                {paletteOpen && <ShortcutPalette onClose={() => setPaletteOpen(false)} />}
            </div>
        );
    }

    if (route === RUNS_HASH) {
        return (
            <div className="page">
                <LastSecondRunsPage
                    runs={runs}
                    loading={runsLoading}
                    error={runsError}
                    onBack={() => {
                        window.location.hash = '';
                        setRoute('');
                    }}
                />
                {paletteOpen && <ShortcutPalette onClose={() => setPaletteOpen(false)} />}
            </div>
        );
    }

    return (
        <div className="page">
            <header className="hero">
                <p className="eyebrow">Workspace Navigator</p>
                <h1>Fable5 Projects Dashboard</h1>
                <p className="subtitle">
                    A first-pass landing page for the top-level projects and idea folders in this workspace.
                </p>
                <div className="stats">
                    <div className="stat-card">
                        <span>Total Projects</span>
                        <strong>{stats.total}</strong>
                    </div>
                    <div className="stat-card">
                        <span>With Git Repo</span>
                        <strong>{stats.withGit}</strong>
                    </div>
                </div>
                <div className="card-actions hero-actions">
                    <button
                        className="action-btn"
                        type="button"
                        onClick={() => { window.location.hash = ACTIVITY_HASH; }}
                    >
                        ⚡ Activity Feed
                    </button>
                    <button
                        className="action-btn"
                        type="button"
                        onClick={() => { window.location.hash = COMPARE_HASH; }}
                    >
                        ⚖ Compare Projects
                    </button>
                    <button
                        className="action-btn"
                        type="button"
                        onClick={() => setExportOpen(true)}
                        title="Export a shareable snapshot of the current dashboard (press e)"
                    >
                        ⤓ Export Snapshot
                    </button>
                    <button
                        className="action-btn"
                        type="button"
                        onClick={() => setPaletteOpen(true)}
                        title="Show keyboard shortcuts (press ?)"
                    >
                        ⌨ Shortcuts
                    </button>
                </div>
            </header>

            {error && <p className="status error">{error}</p>}

            {!error && loading && <SkeletonList />}

            {!error && !loading && (
                <div className="dashboard-content">
                    <FreshnessHeatmap leaves={allLeaves} />
                    <StackOverlapMatrix
                        leaves={allLeaves}
                        onCompare={(path) => { window.location.hash = compareHashFor(path); }}
                    />
                    <SearchBar
                        query={query}
                        onQuery={setQuery}
                        repoFilter={repoFilter}
                        onRepoFilter={setRepoFilter}
                        techFilter={techFilter}
                        onTechFilter={setTechFilter}
                        techOptions={techOptions}
                        sortBy={sortBy}
                        onSortBy={setSortBy}
                        groupMode={groupMode}
                        onGroupMode={setGroupMode}
                        onManageGroups={() => setGroupRulesOpen(true)}
                        resultCount={filteredLeafCount}
                        totalCount={allLeaves.length}
                        onReset={resetFilters}
                        canReset={!filtersAtDefault}
                        searchRef={searchRef}
                    />
                    {groupMode === 'custom' && groupRules.length === 0 && (
                        <p className="group-hint">
                            No grouping rules defined yet — showing the folder view. Click
                            {' '}<button className="link-btn" type="button" onClick={() => setGroupRulesOpen(true)}>⚙ Groups</button>{' '}
                            to create custom groups.
                        </p>
                    )}
                    <main className="top-list">
                        {filteredProjects.length === 0 && (
                            <p className="status">No projects match your search.</p>
                        )}
                        {useCustomGrouping
                            ? customGroups.map((group, gi) => (
                                <ProjectGroup
                                    key={group.name}
                                    project={group}
                                    onOpenRuns={() => { window.location.hash = RUNS_HASH; }}
                                    healthMap={healthMap}
                                    baseIndex={gi}
                                    readmeMatches={readmeMatches}
                                    query={query}
                                />
                            ))
                            : filteredProjects.map((project, i) =>
                                project.children && project.children.length > 0
                                    ? <ProjectGroup key={project.name} project={project} onOpenRuns={() => { window.location.hash = RUNS_HASH; }} healthMap={healthMap} baseIndex={i} readmeMatches={readmeMatches} query={query} />
                                    : <ProjectCard key={project.name} project={project} onOpenRuns={() => { window.location.hash = RUNS_HASH; }} healthIssues={healthMap[project.path]} cardIndex={i} readmeMatch={readmeMatches[project.path]} query={query} />
                            )}
                    </main>
                </div>
            )}
            {groupRulesOpen && (
                <GroupRulesModal
                    rules={groupRules}
                    busy={groupBusy}
                    error={groupError}
                    onAdd={addGroupRule}
                    onUpdate={updateGroupRule}
                    onDelete={deleteGroupRule}
                    onMove={moveGroupRule}
                    onClose={() => setGroupRulesOpen(false)}
                />
            )}
            {paletteOpen && <ShortcutPalette onClose={() => setPaletteOpen(false)} />}
            <ShortcutFooter onOpenPalette={() => setPaletteOpen(true)} />
            {exportOpen && (
                <ExportSnapshotModal
                    snapshot={buildSnapshot({
                        filteredProjects,
                        stats,
                        filters: { query, repoFilter, techFilter, sortBy },
                        healthMap,
                    })}
                    onClose={() => setExportOpen(false)}
                />
            )}
        </div>
    );
}

export default App;
