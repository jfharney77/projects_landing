import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SORT_OPTIONS = [
    { value: 'recent', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'name', label: 'Name A-Z' },
];

const RUNS_HASH = '#last-second-runs';
const ACTIVITY_HASH = '#activity';
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

const FILTER_STORAGE_KEY = 'projects-landing:filters';
const DEFAULT_FILTERS = { query: '', repoFilter: 'all', techFilter: 'all', sortBy: 'recent' };

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

function SkeletonCard() {
    return (
        <article className="project-card skeleton-card" aria-hidden="true">
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

function SkeletonList({ count = 6 }) {
    return (
        <div className="top-list" aria-busy="true" aria-label="Loading projects">
            {Array.from({ length: count }, (_, i) => (
                <SkeletonCard key={i} />
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

function ProjectCard({ project, onOpenRuns, healthIssues }) {
    const readmeHref = project.readme_url || (project.has_readme
        ? `${API_BASE}/api/readme/${encodeProjectPath(project.path)}`
        : '');

    const copyPath = async () => {
        try {
            await navigator.clipboard.writeText(project.path);
        } catch {
            // Ignore clipboard failures silently to avoid noisy UX.
        }
    };

    const hasBackend = project.tech_tags && (
        project.tech_tags.includes('FastAPI') ||
        project.tech_tags.includes('Python')
    );
    const hasFrontend = project.tech_tags && (
        project.tech_tags.includes('React') ||
        project.tech_tags.includes('Node')
    );

    return (
        <article className="project-card">
            <div className="card-top">
                <h2>{project.name}</h2>
                <div className="tag-group">
                    <GitTags project={project} />
                    <HealthBadge issues={healthIssues} />
                </div>
            </div>
            <p>{project.summary}</p>
            {project.improvement_idea && (
                <p className="improvement-note">
                    <strong>Improvement:</strong> {project.improvement_idea}
                </p>
            )}
            <p className="updated-at">{formatLastUpdated(project.last_modified)}</p>
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
                <button className="action-btn" type="button" onClick={copyPath}>Copy Path</button>
            </div>
        </article>
    );
}

function ProjectGroup({ project, onOpenRuns, healthMap }) {
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
                    {project.children.map((child) => (
                        <ProjectCard key={child.name} project={child} onOpenRuns={onOpenRuns} healthIssues={healthMap[child.path]} />
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
    resultCount,
    totalCount,
    onReset,
    canReset,
}) {
    return (
        <div className="search-bar">
            <div className="search-input-wrap">
                <span className="search-icon">⌕</span>
                <input
                    type="search"
                    className="search-input"
                    placeholder="Search projects…"
                    value={query}
                    onChange={(e) => onQuery(e.target.value)}
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
                p.summary.toLowerCase().includes(q);
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
    }, [projects, query, repoFilter, techFilter, sortBy]);

    const filteredLeafCount = useMemo(() =>
        filteredProjects.flatMap((p) => p.children && p.children.length > 0 ? p.children : [p]).length,
        [filteredProjects]);

    const stats = useMemo(() => {
        const total = allLeaves.length;
        const withGit = allLeaves.filter((p) => p.has_git_repo).length;
        return { total, withGit };
    }, [allLeaves]);

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
                </div>
            </header>

            {loading && <p className="status">Loading projects...</p>}
            {error && <p className="status error">{error}</p>}

            {!loading && !error && (
                <>
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
                        resultCount={filteredLeafCount}
                        totalCount={allLeaves.length}
                        onReset={resetFilters}
                        canReset={!filtersAtDefault}
                    />
                    <main className="top-list">
                        {filteredProjects.length === 0 && (
                            <p className="status">No projects match your search.</p>
                        )}
                        {filteredProjects.map((project) =>
                            project.children && project.children.length > 0
                                ? <ProjectGroup key={project.name} project={project} onOpenRuns={() => { window.location.hash = RUNS_HASH; }} healthMap={healthMap} />
                                : <ProjectCard key={project.name} project={project} onOpenRuns={() => { window.location.hash = RUNS_HASH; }} healthIssues={healthMap[project.path]} />
                        )}
                    </main>
                </>
            )}
        </div>
    );
}

export default App;
