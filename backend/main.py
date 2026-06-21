from __future__ import annotations

import os
import json
import uuid
import fnmatch
import subprocess
import shutil
from pathlib import Path
from datetime import datetime, timezone
from typing import Iterable

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT_DIR = Path(__file__).resolve().parents[2]
APP_DIR_NAME = "projects_landing"
SPECIAL_SUMMARIES = {
    "last_second_usage": (
        "Runs a cron-oriented idea execution workflow that triggers selected beta ideas "
        "when token expiry time is close or has passed."
    )
}

README_CANDIDATES = ["README.md", "readme.md", "README.txt", "README"]

# Directories whose immediate subdirectories should be expanded as child cards.
EXPANDABLE_DIRS = {"mockups", "tutorials"}

APP_URL_HINTS = {
    "projects_landing": "http://localhost:5177",
}

IMPROVEMENTS_FILE = ROOT_DIR / "IMPROVEMENTS.md"

# ── README auto-generation config ────────────────────────────────────────────
# Default Claude model used to draft READMEs; override with ANTHROPIC_MODEL.
README_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
# Manifest files worth feeding to the model verbatim (dependency / project meta).
MANIFEST_FILES = [
    "package.json", "requirements.txt", "pyproject.toml", "setup.py", "setup.cfg",
    "Pipfile", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "composer.json",
    "Gemfile", "Dockerfile", "docker-compose.yml", "vite.config.js", "vite.config.ts",
]
# Bound the prompt so a huge project can't blow up token usage.
README_MAX_TREE_ENTRIES = 300
README_MAX_MANIFEST_CHARS = 4000

# ── README content search config ─────────────────────────────────────────────
# Ignore trivially short queries so a single character doesn't match everything.
README_SEARCH_MIN_QUERY = 2
# Cap the returned snippet so one long line can't bloat the response.
README_SEARCH_MAX_SNIPPET = 200


class ProjectSummary(BaseModel):
    name: str
    path: str
    summary: str
    has_git_repo: bool
    git_host: str  # 'github', 'gitlab', 'other', or '' if no repo
    git_remote_url: str = ""
    readme_url: str = ""
    app_url: str = ""
    has_readme: bool = False
    last_modified: str = ""
    last_modified_epoch: float = 0.0
    disk_bytes: int = 0      # total on-disk size of the project tree
    file_count: int = 0      # number of files in the project tree
    tech_tags: list[str] = []
    improvement_idea: str = ""
    git_dirty: bool = False  # True when the repo has uncommitted changes
    children: list["ProjectSummary"] = []


class HealthIssue(BaseModel):
    level: str  # 'warning' | 'error'
    message: str


class ProjectHealth(BaseModel):
    name: str
    path: str
    issues: list[HealthIssue]


class ServiceStatus(BaseModel):
    project: str
    service: str  # 'backend' | 'frontend'
    status: str   # 'started' | 'already_running' | 'error' | 'not_found'
    message: str
    port: int | None = None


class ActivityEvent(BaseModel):
    project: str          # top-level project name the file belongs to
    project_path: str     # top-level project path, relative to ROOT_DIR
    file: str             # file path relative to its project dir
    rel_path: str         # file path relative to ROOT_DIR
    modified: str         # ISO timestamp
    modified_epoch: float
    age_seconds: float    # how long ago, relative to scan time


class CodeownersRule(BaseModel):
    pattern: str          # path glob the rule applies to (e.g. '*', '/docs/')
    owners: list[str]     # owners for that pattern (@user, @org/team, or email)


class ProjectOwnership(BaseModel):
    name: str
    path: str                              # relative to ROOT_DIR
    has_codeowners: bool = False
    codeowners_path: str = ""              # location of the file, relative to project
    codeowners_rules: list[CodeownersRule] = []
    codeowners_owners: list[str] = []      # distinct owners parsed from CODEOWNERS
    maintainers: list[str] = []            # manually assigned (persisted sidecar)
    source: str = "none"                   # 'codeowners' | 'manual' | 'both' | 'none'


class AssignMaintainersRequest(BaseModel):
    project_path: str
    maintainers: list[str] = []            # full replacement list for the project


class LastSecondRunSummary(BaseModel):
    name: str
    path: str
    summary: str
    session_limit_hit: bool
    related_project: str  # best-guess project name, 'multiple', or ''
    last_modified: str
    last_modified_epoch: float


class ReadmeSearchMatch(BaseModel):
    name: str
    path: str               # project path relative to ROOT_DIR
    match_count: int        # number of README lines containing the query
    snippet: str            # first matching line, trimmed for display


class GenerateReadmeRequest(BaseModel):
    project_path: str
    overwrite: bool = False  # allow regenerating even if a README already exists


class GenerateReadmeResponse(BaseModel):
    project: str
    path: str
    readme: str          # drafted markdown
    model: str           # model that produced it
    already_existed: bool  # whether a README was already present


class SaveReadmeRequest(BaseModel):
    project_path: str
    content: str
    overwrite: bool = False  # guard: refuse to clobber an existing README unless set


class SaveReadmeResponse(BaseModel):
    project: str
    path: str           # path of the written README, relative to ROOT_DIR
    bytes_written: int


class Milestone(BaseModel):
    id: str
    project_path: str          # project the goal belongs to, relative to ROOT_DIR
    title: str
    due_date: str = ""         # optional YYYY-MM-DD target date ('' if none)
    done: bool = False
    created_at: str            # ISO timestamp
    completed_at: str = ""     # ISO timestamp set when first marked done


class CreateMilestoneRequest(BaseModel):
    project_path: str
    title: str
    due_date: str = ""


class UpdateMilestoneRequest(BaseModel):
    # All optional — only provided fields are changed.
    title: str | None = None
    due_date: str | None = None
    done: bool | None = None


class MilestoneProgress(BaseModel):
    project_path: str
    total: int
    done: int
    overdue: int               # open milestones whose due_date is in the past
    next_due: str = ""         # earliest upcoming due_date among open milestones


app = FastAPI(title="Projects Landing API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Scan / ignore configuration ──────────────────────────────────────────────
# A small JSON file (backend/scan_config.json) lets you control which top-level
# folders get indexed without touching code, so junk dirs (node_modules, build
# output, archives, …) stay out of the dashboard. See that file for field docs.
SCAN_CONFIG_FILE = Path(__file__).resolve().parent / "scan_config.json"

DEFAULT_SCAN_CONFIG = {
    "include": [],
    "ignore": [],
    "ignore_globs": [],
    "walk_skip_dirs": [],
}


def load_scan_config() -> dict:
    """Load backend/scan_config.json, falling back to safe defaults.

    Keys prefixed with '_' (comments/help text) are ignored. A missing or
    malformed file never breaks indexing — we just use the defaults.
    """
    config = {key: list(value) for key, value in DEFAULT_SCAN_CONFIG.items()}
    if not SCAN_CONFIG_FILE.exists():
        return config
    try:
        raw = json.loads(SCAN_CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return config
    if not isinstance(raw, dict):
        return config
    for key in DEFAULT_SCAN_CONFIG:
        value = raw.get(key)
        if isinstance(value, list):
            config[key] = [str(item) for item in value]
    return config


SCAN_CONFIG = load_scan_config()


def is_indexable_top_level(name: str) -> bool:
    """Decide whether a top-level directory name should be indexed.

    Order of precedence:
      1. Hidden dirs and this app's own folder are always excluded.
      2. If 'include' is non-empty, it's an allowlist — only those are kept.
      3. Otherwise, exclude names in 'ignore' or matching any 'ignore_globs'.
    """
    if name.startswith(".") or name == APP_DIR_NAME:
        return False

    include = SCAN_CONFIG.get("include") or []
    if include:
        return name in include

    if name in (SCAN_CONFIG.get("ignore") or []):
        return False
    for pattern in SCAN_CONFIG.get("ignore_globs") or []:
        if fnmatch.fnmatch(name, pattern):
            return False
    return True


def get_top_level_directories() -> Iterable[Path]:
    for child in ROOT_DIR.iterdir():
        if not child.is_dir():
            continue
        if not is_indexable_top_level(child.name):
            continue
        yield child


def has_own_git_repo(project_dir: Path) -> bool:
    return (project_dir / ".git").exists()


def detect_git_host(project_dir: Path) -> str:
    git_config = project_dir / ".git" / "config"
    if not git_config.exists():
        return ""
    text = git_config.read_text(encoding="utf-8", errors="ignore").lower()
    if "github.com" in text:
        return "github"
    if "gitlab.com" in text or "gitlab" in text:
        return "gitlab"
    return "other"


def normalize_git_remote(url: str) -> str:
    clean = url.strip()
    if clean.startswith("git@") and ":" in clean:
        # git@github.com:owner/repo.git -> https://github.com/owner/repo
        host_part, path_part = clean.split(":", 1)
        host = host_part.replace("git@", "", 1)
        path = path_part[:-4] if path_part.endswith(".git") else path_part
        return f"https://{host}/{path}"
    if clean.startswith("http://") or clean.startswith("https://"):
        return clean[:-4] if clean.endswith(".git") else clean
    return ""


def detect_git_remote_url(project_dir: Path) -> str:
    git_config = project_dir / ".git" / "config"
    if not git_config.exists():
        return ""

    lines = git_config.read_text(encoding="utf-8", errors="ignore").splitlines()
    in_origin = False
    for raw in lines:
        line = raw.strip()
        if line.startswith("["):
            in_origin = line.lower() in {"[remote \"origin\"]", "[remote 'origin']"}
            continue
        if in_origin and line.lower().startswith("url") and "=" in line:
            _, value = line.split("=", 1)
            return normalize_git_remote(value)

    # Fallback: first remote URL in config.
    for raw in lines:
        line = raw.strip()
        if line.lower().startswith("url") and "=" in line:
            _, value = line.split("=", 1)
            return normalize_git_remote(value)

    return ""


def find_readme(project_dir: Path) -> Path | None:
    for name in README_CANDIDATES:
        candidate = project_dir / name
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def infer_readme_url(project_dir: Path, git_remote_url: str) -> str:
    if not git_remote_url:
        return ""
    if "github.com" in git_remote_url:
        return f"{git_remote_url}/blob/main/README.md"
    if "gitlab" in git_remote_url:
        return f"{git_remote_url}/-/blob/main/README.md"
    return ""


def iso_modified(project_dir: Path) -> tuple[str, float]:
    ts = project_dir.stat().st_mtime
    iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    return iso, ts


def compute_disk_usage(project_dir: Path) -> tuple[int, int]:
    """Return (total_bytes, file_count) for a project's full on-disk tree.

    Walks the entire tree — including dependency/build dirs and .git — because
    those are exactly what make a project "bloated", so they belong in the
    footprint shown on the card. Symlinks are not followed (size of the link
    itself), and unreadable entries are skipped rather than raising.
    """
    total_bytes = 0
    file_count = 0
    stack = [project_dir]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                for entry in it:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(Path(entry.path))
                        elif entry.is_file(follow_symlinks=False):
                            total_bytes += entry.stat(follow_symlinks=False).st_size
                            file_count += 1
                    except OSError:
                        continue
        except OSError:
            continue
    return total_bytes, file_count


# Keywords per project for run-association scoring.
# Each entry: project_name -> list of keyword strings (all lowercase).
PROJECT_KEYWORDS: dict[str, list[str]] = {
    "slides2video": ["slides2video", "slides to video", "pptx", "powerpoint", "narrat", "mp4 slide", "slide video"],
    "context_window": ["context_window", "context-window", "context window", "langgraph", "token", "visuali"],
    "sim_digrading": ["sim_digrading", "sim-digrading", "mast", "failure mode", "digrad", "degrading", "multi-agent failure"],
    "stock-agents": ["stock-agent", "stock agent", "stock", "buy-timing", "analyst", "researcher", "writer agent"],
    "triptris": ["triptris", "tripris", "triptri", "packing", "closet", "suitcase", "itinerary"],
    "last_second_usage": ["last_second", "last second", "last-second", "fine-tun", "fine tun", "token expir", "ccusage"],
    "tutorials": ["tutorial", "beginner", "step-by-step", "confluence", "recipe", "habit", "excel budget"],
    "devin-session": ["devin", "devin desktop", "devin session"],
    "devin_tutorials": ["devin tutorial"],
    "context_window": ["context_window", "context-window", "context window", "token breakdown"],
    "mockups": ["mockup", "dell", "pomodoro", "flask api", "flask-api", "html timer"],
}

# Runs that cover all/multiple projects rather than one specific one.
MULTI_PROJECT_SLUGS = [
    "for-each-of-the-projects",
    "for-each-project",
    "for-each-of-the-project",
    "per-project-deep-review",
    "deep-architectural-review",
]


def detect_related_project(run_dir: Path) -> str:
    """Return the most likely associated project name, or '' if unclear."""
    name_lower = run_dir.name.lower()

    # Check if this is a multi-project run first.
    if any(slug in name_lower for slug in MULTI_PROJECT_SLUGS):
        return "multiple"

    # Score each project by keyword hits in the run dir name and first 500 chars of output.
    output_preview = ""
    for fname in ("claude_output.md", "SUMMARY.md"):
        candidate = run_dir / fname
        if candidate.exists():
            output_preview = candidate.read_text(encoding="utf-8", errors="ignore")[:600].lower()
            break

    search_text = name_lower + " " + output_preview
    scores: dict[str, int] = {}
    for project, keywords in PROJECT_KEYWORDS.items():
        score = sum(search_text.count(kw) for kw in keywords)
        if score:
            scores[project] = score

    if not scores:
        return ""

    best = max(scores, key=lambda k: scores[k])
    # Only return if there's a clear winner (score >= 1).
    return best if scores[best] >= 1 else ""


SESSION_LIMIT_PHRASES = [
    "you've hit your session limit",
    "you have hit your session limit",
    "session limit",
    "usage limit",
]


def _check_session_limit(run_dir: Path) -> bool:
    """Return True if any run file indicates the session limit was hit."""
    for fname in ("claude_output.md", "claude_error.log", "SUMMARY.md"):
        candidate = run_dir / fname
        if not candidate.exists():
            continue
        text = candidate.read_text(encoding="utf-8", errors="ignore").lower()
        if any(phrase in text for phrase in SESSION_LIMIT_PHRASES):
            return True
    return False


def _extract_rich_summary(run_dir: Path) -> str | None:
    """
    Try to extract a meaningful paragraph from the run's output files.
    Priority: SUMMARY.md first paragraph > claude_output.md first substantive paragraph.
    Returns None if nothing useful is found.
    """
    for fname in ("SUMMARY.md", "claude_output.md"):
        path = run_dir / fname
        if not path.exists():
            continue

        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        buffer: list[str] = []
        in_code = False

        for raw in lines:
            line = raw.strip()
            if line.startswith("```"):
                in_code = not in_code
                continue
            if in_code or not line:
                if buffer:
                    break
                continue
            if line.startswith("#"):
                if buffer:
                    break
                continue
            # Skip bare session-limit lines — they're noise, not content.
            if any(phrase in line.lower() for phrase in SESSION_LIMIT_PHRASES):
                continue
            buffer.append(line)

        if buffer:
            text = " ".join(buffer)
            # Truncate at a sentence boundary within 300 chars.
            if len(text) > 300:
                for sep in (". ", "! ", "? "):
                    idx = text.rfind(sep, 0, 300)
                    if idx != -1:
                        text = text[: idx + 1]
                        break
                else:
                    text = text[:297].rstrip() + "…"
            return text

    return None


def summarize_run_name(run_dir: Path) -> tuple[str, bool]:
    """
    Returns (summary_text, session_limit_hit).
    """
    session_limit_hit = _check_session_limit(run_dir)

    rich = _extract_rich_summary(run_dir)
    if rich:
        return rich, session_limit_hit

    # Fallback: derive from folder slug.
    parts = run_dir.name.split("-", 2)
    prompt_slug = parts[2] if len(parts) >= 3 else run_dir.name
    prompt_text = prompt_slug.replace("-", " ").strip()
    if prompt_text:
        prompt_text = prompt_text[0].upper() + prompt_text[1:]
    else:
        prompt_text = "Experiment run"
    if len(prompt_text) > 120:
        prompt_text = f"{prompt_text[:117].rstrip()}…"

    return f"Experimental run: {prompt_text}.", session_limit_hit


def read_readme_summary(project_dir: Path) -> str | None:
    readme_path = find_readme(project_dir)

    if readme_path is None:
        return None

    lines = readme_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    filtered: list[str] = []
    in_code_block = False

    for raw in lines:
        line = raw.strip()
        if line.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
        if not line:
            if filtered:
                break
            continue
        if line.startswith("#"):
            continue
        filtered.append(line)

    if filtered:
        return " ".join(filtered)
    return None


def iter_leaf_project_dirs() -> Iterable[Path]:
    """Yield every leaf project directory the dashboard actually lists.

    Mirrors ``list_projects``: each non-expandable top-level dir, plus the
    immediate child dirs of EXPANDABLE_DIRS (mockups/tutorials). Expandable
    parents themselves are containers, not leaves, so they're skipped.
    """
    for project_dir in sorted(get_top_level_directories(), key=lambda p: p.name.lower()):
        if project_dir.name in EXPANDABLE_DIRS:
            for child in sorted(project_dir.iterdir(), key=lambda p: p.name.lower()):
                if child.is_dir() and not child.name.startswith("."):
                    yield child
        else:
            yield project_dir


def search_readme_content(project_dir: Path, needle_lower: str) -> ReadmeSearchMatch | None:
    """Return a match if the project's README contains ``needle_lower``.

    Case-insensitive substring search over README lines; the first matching
    line (trimmed and length-capped) becomes the snippet shown in the UI.
    """
    readme_path = find_readme(project_dir)
    if readme_path is None:
        return None
    try:
        text = readme_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None

    match_count = 0
    snippet = ""
    for raw in text.splitlines():
        if needle_lower in raw.lower():
            match_count += 1
            if not snippet:
                trimmed = raw.strip()
                snippet = trimmed[:README_SEARCH_MAX_SNIPPET]
                if len(trimmed) > README_SEARCH_MAX_SNIPPET:
                    snippet = snippet.rstrip() + "…"

    if match_count == 0:
        return None
    return ReadmeSearchMatch(
        name=project_dir.name,
        path=str(project_dir.relative_to(ROOT_DIR)),
        match_count=match_count,
        snippet=snippet,
    )


def infer_summary(project_dir: Path) -> str:
    if project_dir.name in SPECIAL_SUMMARIES:
        return SPECIAL_SUMMARIES[project_dir.name]

    readme_summary = read_readme_summary(project_dir)
    if readme_summary:
        return readme_summary

    entries = {p.name.lower() for p in project_dir.iterdir()}
    has_backend = "backend" in entries
    has_frontend = "frontend" in entries

    if has_backend and has_frontend:
        return "Full-stack project with separate backend and frontend directories."
    if "index.html" in entries:
        return "Static web prototype or mockup centered around a standalone HTML page."
    if any(name.endswith(".py") for name in entries):
        return "Python-focused project with scripts or application modules."
    if any(name.endswith(".md") for name in entries):
        return "Documentation-centric project with notes or tutorials."

    return "Project directory with source files and assets."


def infer_tech_tags(project_dir: Path) -> list[str]:
    tags: list[str] = []
    entries = {p.name.lower() for p in project_dir.iterdir()}

    if "package.json" in entries:
        tags.append("Node")
        pkg_text = (project_dir / "package.json").read_text(encoding="utf-8", errors="ignore").lower()
        if "react" in pkg_text:
            tags.append("React")
        if "vite" in pkg_text or "vite.config.js" in entries or "vite.config.ts" in entries:
            tags.append("Vite")

    if "requirements.txt" in entries or any(name.endswith(".py") for name in entries):
        tags.append("Python")
        req_text = ""
        req_path = project_dir / "requirements.txt"
        if req_path.exists():
            req_text = req_path.read_text(encoding="utf-8", errors="ignore").lower()
        if "fastapi" in req_text:
            tags.append("FastAPI")
        if "langgraph" in req_text:
            tags.append("LangGraph")
        if "langchain" in req_text:
            tags.append("LangChain")

    if "index.html" in entries and "package.json" not in entries:
        tags.append("Static HTML")

    if "dockerfile" in entries:
        tags.append("Docker")

    if "readme.md" in entries:
        tags.append("Docs")

    # Keep insertion order and avoid duplicates.
    return list(dict.fromkeys(tags))


def load_project_improvements() -> dict[str, str]:
    """Read one improvement suggestion per project section from IMPROVEMENTS.md."""
    if not IMPROVEMENTS_FILE.exists():
        return {}

    section = ""
    improvements: dict[str, str] = {}

    for raw in IMPROVEMENTS_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if line.startswith("## "):
            section = line[3:].strip()
            continue
        if not section or section in improvements:
            continue
        if not line or line.startswith("#"):
            continue
        text = line
        if text.startswith("- "):
            text = text[2:].strip()
        if len(text) > 320:
            text = text[:317].rstrip() + "..."
        improvements[section] = text

    return improvements


PROJECT_IMPROVEMENTS = load_project_improvements()


# ── Port hints per project service ───────────────────────────────────────────
BACKEND_PORTS: dict[str, int] = {
    "context_window":   8000,
    "slides2video":     8001,
    "stock-agents":     8002,
    "triptris":         8003,
    "sim_digrading":    8004,
    "last_second_usage": 8400,
    "projects_landing": 8000,
    "tutorials":        8000,
}

FRONTEND_PORTS: dict[str, int] = {
    "context_window":   5173,
    "slides2video":     5174,
    "triptris":         5175,
    "projects_landing": 5177,
}


def check_project_health(project_dir: Path) -> list[HealthIssue]:
    """Return a list of health issues for a project directory."""
    issues: list[HealthIssue] = []
    entries = {p.name.lower() for p in project_dir.iterdir()}

    # Missing README
    has_readme = any(name in entries for name in [c.lower() for c in README_CANDIDATES])
    if not has_readme:
        issues.append(HealthIssue(level="warning", message="Missing README"))

    # Detect backend / frontend subdirs
    has_backend_dir = (project_dir / "backend").is_dir()
    has_frontend_dir = (project_dir / "frontend").is_dir()

    # Missing requirements.txt for Python projects
    if has_backend_dir:
        backend_dir = project_dir / "backend"
        req_file = backend_dir / "requirements.txt"
        py_files = list(backend_dir.glob("*.py"))
        if py_files and not req_file.exists():
            issues.append(HealthIssue(level="warning", message="Backend missing requirements.txt"))
    elif any(name.endswith(".py") for name in entries):
        if "requirements.txt" not in entries:
            issues.append(HealthIssue(level="warning", message="Missing requirements.txt"))

    # Missing package.json for Node/frontend projects
    if has_frontend_dir:
        if not (project_dir / "frontend" / "package.json").exists():
            issues.append(HealthIssue(level="warning", message="Frontend missing package.json"))
    elif "index.html" in entries and "package.json" not in entries:
        pass  # static HTML — no package.json expected

    # Uncommitted git changes
    if (project_dir / ".git").exists() and shutil.which("git"):
        try:
            result = subprocess.run(
                ["git", "-C", str(project_dir), "status", "--porcelain"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                lines = result.stdout.strip().splitlines()
                issues.append(HealthIssue(
                    level="warning",
                    message=f"{len(lines)} uncommitted change{'s' if len(lines) != 1 else ''}"
                ))
        except (subprocess.TimeoutExpired, OSError):
            pass

    return issues


def _find_start_script(project_dir: Path, service: str) -> Path | None:
    """Return the start script path for 'backend' or 'frontend', or None."""
    scripts_dir = project_dir / "scripts"
    candidates = [
        scripts_dir / f"run_{service}.sh",
        project_dir / f"run_{service}.sh",
        project_dir / "start.sh",
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def _port_is_in_use(port: int) -> bool:
    """Quick check if a TCP port is already bound."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def infer_improvement_idea(project_dir: Path, tech_tags: list[str]) -> str:
    name = project_dir.name
    if name in PROJECT_IMPROVEMENTS:
        return PROJECT_IMPROVEMENTS[name]

    entries = {p.name.lower() for p in project_dir.iterdir()}
    has_backend = "backend" in entries
    has_frontend = "frontend" in entries

    if has_backend and has_frontend:
        return "Add a basic end-to-end smoke test and a CI pipeline so frontend/backend changes are validated together."
    if "Static HTML" in tech_tags:
        return "Improve mobile responsiveness and accessibility (landmarks, keyboard navigation, and contrast) for the static UI."
    if "React" in tech_tags:
        return "Add component-level tests for core flows and split larger UI components for easier maintenance."
    if "FastAPI" in tech_tags:
        return "Add request/response schema validation tests and clearer error responses for common failure paths."
    if "Python" in tech_tags:
        return "Add automated tests for the primary script paths and include a short usage section with concrete examples."
    if "Docs" in tech_tags:
        return "Add a quick-start section with one copy/paste runnable example to reduce onboarding friction."

    return "Define one high-impact user workflow and add a testable success metric to guide the next iteration."


# ── Activity feed: recent file changes across all projects ───────────────────
# Directory and file names ignored when scanning for recent changes — they're
# noise (dependencies, build output, VCS internals) and slow the walk down.
ACTIVITY_SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build",
    ".next", ".cache", ".pytest_cache", ".mypy_cache", "target", ".idea", ".vscode",
}
# Let scan_config.json extend the deep-walk prune list without code changes.
ACTIVITY_SKIP_DIRS |= set(SCAN_CONFIG.get("walk_skip_dirs") or [])
ACTIVITY_SKIP_SUFFIXES = (".pyc", ".pyo", ".log", ".lock", ".map")


def scan_recent_files(project_dir: Path, limit: int) -> list[tuple[Path, float]]:
    """Walk a project tree and return its (path, mtime) pairs, skipping noise.

    Returns the `limit` most-recently-modified files for this project.
    """
    import os

    found: list[tuple[Path, float]] = []
    for current_root, dirnames, filenames in os.walk(project_dir):
        # Prune noisy / hidden directories in-place so os.walk skips them.
        dirnames[:] = [
            d for d in dirnames
            if d not in ACTIVITY_SKIP_DIRS and not d.startswith(".")
        ]
        for fname in filenames:
            if fname.startswith(".") or fname.endswith(ACTIVITY_SKIP_SUFFIXES):
                continue
            fpath = Path(current_root) / fname
            try:
                mtime = fpath.stat().st_mtime
            except OSError:
                continue
            found.append((fpath, mtime))

    found.sort(key=lambda pair: pair[1], reverse=True)
    return found[:limit]


@app.get("/api/activity", response_model=list[ActivityEvent])
def list_activity(limit: int = 40, per_project: int = 15) -> list[ActivityEvent]:
    """Return recent file changes across all projects, newest first.

    `per_project` caps how many recent files each project contributes before
    the global merge, so one busy project can't crowd out the rest.
    `limit` caps the total number of events returned.
    """
    limit = max(1, min(limit, 200))
    per_project = max(1, min(per_project, 100))

    now = datetime.now(tz=timezone.utc).timestamp()
    events: list[ActivityEvent] = []

    for project_dir in get_top_level_directories():
        for fpath, mtime in scan_recent_files(project_dir, per_project):
            events.append(
                ActivityEvent(
                    project=project_dir.name,
                    project_path=str(project_dir.relative_to(ROOT_DIR)),
                    file=str(fpath.relative_to(project_dir)),
                    rel_path=str(fpath.relative_to(ROOT_DIR)),
                    modified=datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
                    modified_epoch=mtime,
                    age_seconds=max(0.0, now - mtime),
                )
            )

    events.sort(key=lambda e: e.modified_epoch, reverse=True)
    return events[:limit]


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/scan-config")
def get_scan_config() -> dict:
    """Expose the active scan/ignore config so the UI can show what's excluded.

    Re-reads the file on each call so edits take effect without a restart.
    """
    global SCAN_CONFIG
    SCAN_CONFIG = load_scan_config()
    return {
        "config_file": str(SCAN_CONFIG_FILE),
        "config_exists": SCAN_CONFIG_FILE.exists(),
        **SCAN_CONFIG,
    }


@app.get("/api/projects/health", response_model=list[ProjectHealth])
def list_project_health() -> list[ProjectHealth]:
    """Return health issues for every top-level project."""
    results: list[ProjectHealth] = []
    for project_dir in sorted(get_top_level_directories(), key=lambda p: p.name.lower()):
        issues = check_project_health(project_dir)
        results.append(ProjectHealth(
            name=project_dir.name,
            path=str(project_dir.relative_to(ROOT_DIR)),
            issues=issues,
        ))
        # Also check children for expandable dirs
        if project_dir.name in EXPANDABLE_DIRS:
            for child in sorted(project_dir.iterdir(), key=lambda p: p.name.lower()):
                if child.is_dir() and not child.name.startswith("."):
                    child_issues = check_project_health(child)
                    results.append(ProjectHealth(
                        name=child.name,
                        path=str(child.relative_to(ROOT_DIR)),
                        issues=child_issues,
                    ))
    return results


@app.post("/api/run-service", response_model=ServiceStatus)
def run_service(project_path: str, service: str) -> ServiceStatus:
    """Launch a project's backend or frontend service in a detached process."""
    if service not in ("backend", "frontend"):
        raise HTTPException(status_code=400, detail="service must be 'backend' or 'frontend'")

    target = (ROOT_DIR / project_path).resolve()
    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found")
    if ROOT_DIR.resolve() not in target.parents and target != ROOT_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid project path")

    project_name = target.name
    port_map = BACKEND_PORTS if service == "backend" else FRONTEND_PORTS
    port = port_map.get(project_name)

    # Check if already running
    if port and _port_is_in_use(port):
        return ServiceStatus(
            project=project_name,
            service=service,
            status="already_running",
            message=f"{service.capitalize()} already running on port {port}",
            port=port,
        )

    script = _find_start_script(target, service)
    if script is None:
        # Fall back to conventional start commands
        if service == "backend":
            backend_dir = target / "backend"
            if backend_dir.is_dir() and (backend_dir / "main.py").exists():
                cmd = ["bash", "-c",
                    f"cd {backend_dir} && "
                    f"([ -d .venv ] || python3 -m venv .venv) && "
                    f".venv/bin/pip install -q -r requirements.txt 2>/dev/null; "
                    f".venv/bin/uvicorn main:app --reload &"]
            else:
                return ServiceStatus(
                    project=project_name, service=service,
                    status="not_found",
                    message="No backend/main.py or run script found"
                )
        else:
            frontend_dir = target / "frontend"
            if frontend_dir.is_dir() and (frontend_dir / "package.json").exists():
                cmd = ["bash", "-c",
                    f"cd {frontend_dir} && "
                    f"([ -d node_modules ] || npm install -q) && "
                    f"npm run dev &"]
            else:
                return ServiceStatus(
                    project=project_name, service=service,
                    status="not_found",
                    message="No frontend/package.json or run script found"
                )
    else:
        cmd = ["bash", str(script)]

    try:
        subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return ServiceStatus(
            project=project_name,
            service=service,
            status="started",
            message=f"{service.capitalize()} service launched{f' (port {port})' if port else ''}",
            port=port,
        )
    except OSError as exc:
        return ServiceStatus(
            project=project_name,
            service=service,
            status="error",
            message=str(exc)
        )


@app.get("/api/readme/{project_path:path}", response_class=PlainTextResponse)
def get_project_readme(project_path: str) -> str:
    target = (ROOT_DIR / project_path).resolve()
    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found")
    if ROOT_DIR.resolve() not in target.parents and target != ROOT_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid project path")

    readme = find_readme(target)
    if readme is None:
        raise HTTPException(status_code=404, detail="README not found")

    return readme.read_text(encoding="utf-8", errors="ignore")


@app.get("/api/search-readmes", response_model=list[ReadmeSearchMatch])
def search_readmes(q: str = "", limit: int = 200) -> list[ReadmeSearchMatch]:
    """Search README *content* across all listed projects.

    Complements the dashboard's name/summary filter: a query can now surface a
    project by what's written inside its README, not just its name. Returns one
    match per project (with a hit count + first-line snippet), ordered by the
    number of matching lines so the most relevant projects come first. Queries
    shorter than ``README_SEARCH_MIN_QUERY`` return nothing.
    """
    needle = q.strip().lower()
    if len(needle) < README_SEARCH_MIN_QUERY:
        return []

    limit = max(1, min(limit, 500))
    matches: list[ReadmeSearchMatch] = []
    for project_dir in iter_leaf_project_dirs():
        match = search_readme_content(project_dir, needle)
        if match is not None:
            matches.append(match)

    matches.sort(key=lambda m: (-m.match_count, m.name.lower()))
    return matches[:limit]


def build_file_tree(project_dir: Path, max_entries: int = README_MAX_TREE_ENTRIES) -> str:
    """Render an indented file tree for a project, skipping dependency/build noise.

    Reuses the activity-feed skip lists so vendored and generated files don't
    drown out the source. Output is bounded to `max_entries` lines.
    """
    lines: list[str] = [f"{project_dir.name}/"]
    count = 0
    truncated = False

    for current_root, dirnames, filenames in os.walk(project_dir):
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in ACTIVITY_SKIP_DIRS and not d.startswith(".")
        )
        rel = Path(current_root).relative_to(project_dir)
        depth = 0 if rel == Path(".") else len(rel.parts)

        for fname in sorted(filenames):
            if fname.startswith(".") or fname.endswith(ACTIVITY_SKIP_SUFFIXES):
                continue
            if count >= max_entries:
                truncated = True
                break
            indent = "  " * (depth + 1)
            rel_file = fname if rel == Path(".") else f"{rel.as_posix()}/{fname}"
            lines.append(f"{indent}{rel_file}")
            count += 1
        if truncated:
            break

    if truncated:
        lines.append("  … (tree truncated)")
    return "\n".join(lines)


def collect_manifests(project_dir: Path) -> str:
    """Concatenate dependency/project manifest files found anywhere in the tree.

    Each manifest is labelled with its path (relative to the project) so the
    model can tell, e.g., a frontend package.json from a backend one.
    """
    blocks: list[str] = []
    for current_root, dirnames, filenames in os.walk(project_dir):
        dirnames[:] = [
            d for d in dirnames
            if d not in ACTIVITY_SKIP_DIRS and not d.startswith(".")
        ]
        for fname in filenames:
            if fname not in MANIFEST_FILES:
                continue
            fpath = Path(current_root) / fname
            try:
                text = fpath.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if len(text) > README_MAX_MANIFEST_CHARS:
                text = text[:README_MAX_MANIFEST_CHARS].rstrip() + "\n… (truncated)"
            rel = fpath.relative_to(project_dir).as_posix()
            blocks.append(f"### {rel}\n```\n{text}\n```")

    if not blocks:
        return "(No dependency manifests found.)"
    return "\n\n".join(blocks)


def draft_readme_with_llm(project_dir: Path) -> str:
    """Draft a README.md for a project by feeding its tree + manifests to Claude.

    Raises HTTPException(503) when the API key is unset or the SDK is missing,
    and HTTPException(502) when the upstream call fails.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY is not set on the backend; cannot draft a README.",
        )

    try:
        import anthropic
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="The 'anthropic' package is not installed; run pip install -r requirements.txt.",
        )

    tree = build_file_tree(project_dir)
    manifests = collect_manifests(project_dir)
    existing_tags = ", ".join(infer_tech_tags(project_dir)) or "unknown"

    user_prompt = (
        f"Draft a clear, well-structured README.md for the project '{project_dir.name}'.\n\n"
        f"Detected tech tags: {existing_tags}\n\n"
        f"## File tree\n```\n{tree}\n```\n\n"
        f"## Dependency / project manifests\n{manifests}\n\n"
        "Infer the project's purpose, tech stack, and how to run it from the evidence above. "
        "Include sensible sections (title, short description, features if inferable, "
        "tech stack, setup/install, how to run, and project structure). "
        "Use fenced code blocks for commands. If something is genuinely unknowable, add a brief "
        "TODO placeholder rather than inventing specifics. Return ONLY the markdown content of "
        "the README — no preamble, no surrounding code fence."
    )

    client = anthropic.Anthropic(api_key=api_key)
    try:
        message = client.messages.create(
            model=README_MODEL,
            max_tokens=2048,
            system=(
                "You are a senior engineer who writes concise, accurate README files. "
                "You only state what the provided evidence supports."
            ),
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception as exc:  # anthropic.APIError and friends
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}")

    parts = [block.text for block in message.content if getattr(block, "type", "") == "text"]
    readme = "".join(parts).strip()
    if not readme:
        raise HTTPException(status_code=502, detail="LLM returned no content.")
    return readme


def _resolve_project_dir(project_path: str) -> Path:
    """Resolve & validate a project path under ROOT_DIR, or raise HTTPException."""
    target = (ROOT_DIR / project_path).resolve()
    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found")
    if ROOT_DIR.resolve() not in target.parents and target != ROOT_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid project path")
    return target


@app.post("/api/generate-readme", response_model=GenerateReadmeResponse)
def generate_readme(req: GenerateReadmeRequest) -> GenerateReadmeResponse:
    """Draft a README.md for a project missing one, using an LLM.

    By default this refuses projects that already have a README (the feature
    targets missing ones); pass overwrite=true to draft anyway.
    """
    target = _resolve_project_dir(req.project_path)

    existing = find_readme(target)
    if existing is not None and not req.overwrite:
        raise HTTPException(
            status_code=409,
            detail="Project already has a README; pass overwrite=true to draft a new one.",
        )

    readme = draft_readme_with_llm(target)
    return GenerateReadmeResponse(
        project=target.name,
        path=str(target.relative_to(ROOT_DIR)),
        readme=readme,
        model=README_MODEL,
        already_existed=existing is not None,
    )


@app.post("/api/save-readme", response_model=SaveReadmeResponse)
def save_readme(req: SaveReadmeRequest) -> SaveReadmeResponse:
    """Write generated README content to a project's README.md.

    Guards against silently clobbering an existing README unless overwrite=true.
    """
    target = _resolve_project_dir(req.project_path)
    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Refusing to write empty README content.")

    existing = find_readme(target)
    if existing is not None and not req.overwrite:
        raise HTTPException(
            status_code=409,
            detail="Project already has a README; pass overwrite=true to replace it.",
        )

    dest = existing if (existing is not None and req.overwrite) else (target / "README.md")
    try:
        written = dest.write_text(content + "\n", encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write README: {exc}")

    return SaveReadmeResponse(
        project=target.name,
        path=str(dest.relative_to(ROOT_DIR)),
        bytes_written=written,
    )


@app.get("/api/last-second-runs", response_model=list[LastSecondRunSummary])
def list_last_second_runs() -> list[LastSecondRunSummary]:
    runs_root = ROOT_DIR / "last_second_usage" / "runs"
    if not runs_root.exists() or not runs_root.is_dir():
        return []

    runs: list[LastSecondRunSummary] = []
    for run_dir in sorted(
        [d for d in runs_root.iterdir() if d.is_dir() and not d.name.startswith(".")],
        key=lambda p: p.name,
        reverse=True,
    ):
        modified_iso, modified_epoch = iso_modified(run_dir)
        summary, limit_hit = summarize_run_name(run_dir)
        runs.append(
            LastSecondRunSummary(
                name=run_dir.name,
                path=str(run_dir.relative_to(ROOT_DIR)),
                summary=summary,
                session_limit_hit=limit_hit,
                related_project=detect_related_project(run_dir),
                last_modified=modified_iso,
                last_modified_epoch=modified_epoch,
            )
        )

    return runs


# ── Milestone tracker: per-project goals with optional due dates ─────────────
# Goals are persisted in a single JSON file next to the backend so they survive
# restarts and are shared across browsers (unlike the localStorage-backed notes).
MILESTONES_FILE = Path(__file__).resolve().parent / "milestones.json"
MILESTONE_TITLE_MAX = 200


def load_milestones() -> list[dict]:
    """Read all milestones from disk; a missing/corrupt file yields an empty list."""
    if not MILESTONES_FILE.exists():
        return []
    try:
        raw = json.loads(MILESTONES_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return raw if isinstance(raw, list) else []


def save_milestones(milestones: list[dict]) -> None:
    """Atomically persist milestones to disk (write-temp-then-replace)."""
    tmp = MILESTONES_FILE.with_suffix(".json.tmp")
    try:
        tmp.write_text(json.dumps(milestones, indent=2), encoding="utf-8")
        tmp.replace(MILESTONES_FILE)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to persist milestones: {exc}")


def _validate_due_date(due_date: str) -> str:
    """Normalise an optional due date; accept '' or a strict YYYY-MM-DD string."""
    due_date = (due_date or "").strip()
    if not due_date:
        return ""
    try:
        datetime.strptime(due_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="due_date must be in YYYY-MM-DD format.")
    return due_date


def _progress_for(project_rel: str, milestones: list[dict]) -> MilestoneProgress:
    """Compute the progress summary for a single project's milestones."""
    today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    total = done = overdue = 0
    upcoming: list[str] = []
    for m in milestones:
        if m.get("project_path") != project_rel:
            continue
        total += 1
        if m.get("done"):
            done += 1
            continue
        due = m.get("due_date") or ""
        if due:
            if due < today:
                overdue += 1
            else:
                upcoming.append(due)
    return MilestoneProgress(
        project_path=project_rel,
        total=total,
        done=done,
        overdue=overdue,
        next_due=min(upcoming) if upcoming else "",
    )


@app.get("/api/milestones", response_model=list[Milestone])
def list_milestones(project_path: str | None = None) -> list[Milestone]:
    """List milestones, optionally filtered to a single project.

    Results are ordered: open goals first (soonest due date first, undated last),
    then completed goals — so the most actionable items surface at the top.
    """
    milestones = load_milestones()
    if project_path is not None:
        rel = str(_resolve_project_dir(project_path).relative_to(ROOT_DIR))
        milestones = [m for m in milestones if m.get("project_path") == rel]

    def sort_key(m: dict) -> tuple:
        done = bool(m.get("done"))
        due = m.get("due_date") or "9999-99-99"  # undated goals sink below dated ones
        return (done, due, m.get("created_at", ""))

    return [Milestone(**m) for m in sorted(milestones, key=sort_key)]


@app.get("/api/milestones/progress", response_model=list[MilestoneProgress])
def milestones_progress() -> list[MilestoneProgress]:
    """Return per-project goal progress for every project that has milestones."""
    milestones = load_milestones()
    projects = {m.get("project_path", "") for m in milestones if m.get("project_path")}
    return [_progress_for(p, milestones) for p in sorted(projects)]


@app.post("/api/milestones", response_model=Milestone)
def create_milestone(req: CreateMilestoneRequest) -> Milestone:
    """Add a goal to a project."""
    rel = str(_resolve_project_dir(req.project_path).relative_to(ROOT_DIR))
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Milestone title cannot be empty.")
    if len(title) > MILESTONE_TITLE_MAX:
        title = title[:MILESTONE_TITLE_MAX].rstrip()

    milestone = Milestone(
        id=uuid.uuid4().hex,
        project_path=rel,
        title=title,
        due_date=_validate_due_date(req.due_date),
        done=False,
        created_at=datetime.now(tz=timezone.utc).isoformat(),
    )
    milestones = load_milestones()
    milestones.append(milestone.model_dump())
    save_milestones(milestones)
    return milestone


@app.patch("/api/milestones/{milestone_id}", response_model=Milestone)
def update_milestone(milestone_id: str, req: UpdateMilestoneRequest) -> Milestone:
    """Edit a goal's title/due date or toggle its done state.

    Marking a goal done stamps completed_at the first time; clearing done resets it.
    """
    milestones = load_milestones()
    for m in milestones:
        if m.get("id") != milestone_id:
            continue
        if req.title is not None:
            title = req.title.strip()
            if not title:
                raise HTTPException(status_code=400, detail="Milestone title cannot be empty.")
            m["title"] = title[:MILESTONE_TITLE_MAX].rstrip()
        if req.due_date is not None:
            m["due_date"] = _validate_due_date(req.due_date)
        if req.done is not None:
            m["done"] = bool(req.done)
            if req.done:
                if not m.get("completed_at"):
                    m["completed_at"] = datetime.now(tz=timezone.utc).isoformat()
            else:
                m["completed_at"] = ""
        save_milestones(milestones)
        return Milestone(**m)
    raise HTTPException(status_code=404, detail="Milestone not found")


@app.delete("/api/milestones/{milestone_id}")
def delete_milestone(milestone_id: str) -> dict[str, str]:
    """Remove a goal."""
    milestones = load_milestones()
    remaining = [m for m in milestones if m.get("id") != milestone_id]
    if len(remaining) == len(milestones):
        raise HTTPException(status_code=404, detail="Milestone not found")
    save_milestones(remaining)
    return {"status": "deleted", "id": milestone_id}


# ── Custom grouping rules: user-defined project groupings ────────────────────
# By default the dashboard groups projects only by their top-level folder. These
# rules let a user define their own buckets (e.g. "AI Agents", "Web Apps") that
# cut across folders. Each rule matches leaf projects by tech tag, name substring,
# or path, and rules are applied in priority order (lowest `order` wins) so a
# project lands in the first rule it matches. The grouping itself is applied in
# the frontend (it already holds every leaf project); the backend just persists
# the ruleset so it's shared across browsers, like milestones.
GROUPING_RULES_FILE = Path(__file__).resolve().parent / "grouping_rules.json"
GROUP_NAME_MAX = 80
GROUP_VALUE_MAX = 200
GROUPING_MATCH_TYPES = {"tag", "name", "path"}


class GroupingRule(BaseModel):
    id: str
    name: str                  # the group label matched projects are bucketed under
    match_type: str            # 'tag' | 'name' | 'path'
    value: str                 # criterion: tag name, name substring, or path
    enabled: bool = True
    order: int = 0             # priority; lower numbers are evaluated first


class CreateGroupingRuleRequest(BaseModel):
    name: str
    match_type: str
    value: str
    enabled: bool = True


class UpdateGroupingRuleRequest(BaseModel):
    # All optional — only provided fields are changed.
    name: str | None = None
    match_type: str | None = None
    value: str | None = None
    enabled: bool | None = None
    order: int | None = None


class ReorderGroupingRulesRequest(BaseModel):
    order: list[str] = []      # rule ids in the desired priority order


def load_grouping_rules() -> list[dict]:
    """Read all grouping rules from disk; a missing/corrupt file yields []."""
    if not GROUPING_RULES_FILE.exists():
        return []
    try:
        raw = json.loads(GROUPING_RULES_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return raw if isinstance(raw, list) else []


def save_grouping_rules(rules: list[dict]) -> None:
    """Atomically persist grouping rules (write-temp-then-replace)."""
    tmp = GROUPING_RULES_FILE.with_suffix(".json.tmp")
    try:
        tmp.write_text(json.dumps(rules, indent=2), encoding="utf-8")
        tmp.replace(GROUPING_RULES_FILE)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to persist grouping rules: {exc}")


def _validate_match_type(match_type: str) -> str:
    match_type = (match_type or "").strip().lower()
    if match_type not in GROUPING_MATCH_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"match_type must be one of: {', '.join(sorted(GROUPING_MATCH_TYPES))}.",
        )
    return match_type


def _clean_group_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name cannot be empty.")
    return name[:GROUP_NAME_MAX].rstrip()


def _clean_group_value(value: str) -> str:
    value = (value or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Match value cannot be empty.")
    return value[:GROUP_VALUE_MAX].rstrip()


def _sorted_rules(rules: list[dict]) -> list[dict]:
    """Order rules by priority (order asc), breaking ties on group name."""
    return sorted(rules, key=lambda r: (r.get("order", 0), str(r.get("name", "")).lower()))


@app.get("/api/grouping-rules", response_model=list[GroupingRule])
def list_grouping_rules() -> list[GroupingRule]:
    """Return all custom grouping rules in priority order (lowest order first)."""
    return [GroupingRule(**r) for r in _sorted_rules(load_grouping_rules())]


@app.post("/api/grouping-rules", response_model=GroupingRule)
def create_grouping_rule(req: CreateGroupingRuleRequest) -> GroupingRule:
    """Add a custom grouping rule; it's appended at the lowest priority."""
    rules = load_grouping_rules()
    next_order = (max((r.get("order", 0) for r in rules), default=-1) + 1)
    rule = GroupingRule(
        id=uuid.uuid4().hex,
        name=_clean_group_name(req.name),
        match_type=_validate_match_type(req.match_type),
        value=_clean_group_value(req.value),
        enabled=bool(req.enabled),
        order=next_order,
    )
    rules.append(rule.model_dump())
    save_grouping_rules(rules)
    return rule


@app.patch("/api/grouping-rules/{rule_id}", response_model=GroupingRule)
def update_grouping_rule(rule_id: str, req: UpdateGroupingRuleRequest) -> GroupingRule:
    """Edit a grouping rule's label, criterion, enabled state, or priority."""
    rules = load_grouping_rules()
    for r in rules:
        if r.get("id") != rule_id:
            continue
        if req.name is not None:
            r["name"] = _clean_group_name(req.name)
        if req.match_type is not None:
            r["match_type"] = _validate_match_type(req.match_type)
        if req.value is not None:
            r["value"] = _clean_group_value(req.value)
        if req.enabled is not None:
            r["enabled"] = bool(req.enabled)
        if req.order is not None:
            r["order"] = int(req.order)
        save_grouping_rules(rules)
        return GroupingRule(**r)
    raise HTTPException(status_code=404, detail="Grouping rule not found")


@app.delete("/api/grouping-rules/{rule_id}")
def delete_grouping_rule(rule_id: str) -> dict[str, str]:
    """Remove a grouping rule."""
    rules = load_grouping_rules()
    remaining = [r for r in rules if r.get("id") != rule_id]
    if len(remaining) == len(rules):
        raise HTTPException(status_code=404, detail="Grouping rule not found")
    save_grouping_rules(remaining)
    return {"status": "deleted", "id": rule_id}


@app.put("/api/grouping-rules/reorder", response_model=list[GroupingRule])
def reorder_grouping_rules(req: ReorderGroupingRulesRequest) -> list[GroupingRule]:
    """Set rule priority from an ordered list of ids.

    Ids in the request are assigned increasing `order` values in the order given;
    any rules not mentioned keep their relative order and are appended after.
    Unknown ids are ignored so a stale client can't corrupt the store.
    """
    rules = load_grouping_rules()
    by_id = {r.get("id"): r for r in rules}
    ranked = [by_id[rid] for rid in req.order if rid in by_id]
    leftover = [r for r in _sorted_rules(rules) if r.get("id") not in set(req.order)]
    for i, rule in enumerate([*ranked, *leftover]):
        rule["order"] = i
    save_grouping_rules(rules)
    return [GroupingRule(**r) for r in _sorted_rules(rules)]


def check_git_dirty(project_dir: Path) -> bool:
    """Return True when the project's git repo has uncommitted changes."""
    if not (project_dir / ".git").exists() or not shutil.which("git"):
        return False
    try:
        result = subprocess.run(
            ["git", "-C", str(project_dir), "status", "--porcelain"],
            capture_output=True, text=True, timeout=5,
        )
        return result.returncode == 0 and bool(result.stdout.strip())
    except (subprocess.TimeoutExpired, OSError):
        return False


def build_project(project_dir: Path) -> ProjectSummary:
    has_git = has_own_git_repo(project_dir)
    git_remote_url = detect_git_remote_url(project_dir) if has_git else ""
    has_readme = find_readme(project_dir) is not None
    modified_iso, modified_epoch = iso_modified(project_dir)
    disk_bytes, file_count = compute_disk_usage(project_dir)
    rel_path = str(project_dir.relative_to(ROOT_DIR))
    tech_tags = infer_tech_tags(project_dir)
    return ProjectSummary(
        name=project_dir.name,
        path=rel_path,
        summary=infer_summary(project_dir),
        has_git_repo=has_git,
        git_host=detect_git_host(project_dir) if has_git else "",
        git_remote_url=git_remote_url,
        readme_url=infer_readme_url(project_dir, git_remote_url),
        app_url=APP_URL_HINTS.get(rel_path, ""),
        has_readme=has_readme,
        last_modified=modified_iso,
        last_modified_epoch=modified_epoch,
        disk_bytes=disk_bytes,
        file_count=file_count,
        tech_tags=tech_tags,
        improvement_idea=infer_improvement_idea(project_dir, tech_tags),
        git_dirty=check_git_dirty(project_dir),
    )


@app.get("/api/projects", response_model=list[ProjectSummary])
def list_projects() -> list[ProjectSummary]:
    projects: list[ProjectSummary] = []

    for project_dir in sorted(get_top_level_directories(), key=lambda p: p.name.lower()):
        entry = build_project(project_dir)
        if project_dir.name in EXPANDABLE_DIRS:
            children = [
                build_project(child)
                for child in sorted(project_dir.iterdir(), key=lambda p: p.name.lower())
                if child.is_dir() and not child.name.startswith(".")
            ]
            entry.children = children
        projects.append(entry)

    return projects
