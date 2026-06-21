"""Smoke tests for README content search.

Calls the endpoint/helper functions directly so it needs no extra test deps
(no pytest / httpx) — just the backend's own runtime. Run from the backend dir:

    ./.venv/bin/python test_readme_search.py

It points main.ROOT_DIR at a temp workspace of fake projects, so the real
project tree is never scanned.
"""
import tempfile
from pathlib import Path

import main
from main import (
    README_SEARCH_MIN_QUERY,
    search_readme_content,
    search_readmes,
)


def make_workspace():
    """Build a temp ROOT_DIR with a few projects + READMEs and point main at it."""
    root = Path(tempfile.mkdtemp())

    alpha = root / "alpha"
    alpha.mkdir()
    (alpha / "README.md").write_text(
        "# Alpha\n\nA FastAPI service that talks to PostgreSQL.\n"
        "Uses Redis for caching.\n",
        encoding="utf-8",
    )

    beta = root / "beta"
    beta.mkdir()
    (beta / "readme.md").write_text(
        "# Beta\n\nA React dashboard. No database here.\n",
        encoding="utf-8",
    )

    # A project with no README at all — must never match.
    (root / "gamma").mkdir()

    # Expandable group with two children, each with a README.
    mockups = root / "mockups"
    mockups.mkdir()
    (mockups / "landing").mkdir()
    (mockups / "landing" / "README.md").write_text(
        "Landing page mockup built with Redis-backed sessions.\n",
        encoding="utf-8",
    )
    (mockups / "pricing").mkdir()
    (mockups / "pricing" / "README.md").write_text(
        "Pricing table mockup. Pure HTML/CSS.\n",
        encoding="utf-8",
    )

    main.ROOT_DIR = root
    return root


def test_min_query_length():
    make_workspace()
    # Below the minimum -> no search performed.
    assert search_readmes(q="r", limit=50) == []
    assert search_readmes(q="", limit=50) == []
    assert len("r") < README_SEARCH_MIN_QUERY


def test_content_match_and_ranking():
    make_workspace()
    results = search_readmes(q="redis", limit=50)
    paths = {m.path for m in results}
    # alpha and the mockups/landing child both mention Redis; beta/pricing don't.
    assert "alpha" in paths
    assert str(Path("mockups") / "landing") in paths
    assert "beta" not in paths
    assert str(Path("mockups") / "pricing") not in paths
    # gamma has no README -> never present.
    assert "gamma" not in paths

    # Case-insensitive.
    assert {m.path for m in search_readmes(q="REDIS", limit=50)} == paths


def test_snippet_and_count():
    make_workspace()
    results = search_readmes(q="database", limit=50)
    assert len(results) == 1
    match = results[0]
    assert match.path == "beta"
    assert "database" in match.snippet.lower()
    assert match.match_count == 1


def test_multiple_matches_counted():
    make_workspace()
    results = search_readmes(q="mockup", limit=50)
    by_path = {m.path for m in results}
    assert str(Path("mockups") / "landing") in by_path
    assert str(Path("mockups") / "pricing") in by_path


def test_helper_on_missing_readme():
    root = make_workspace()
    assert search_readme_content(root / "gamma", "anything") is None
    match = search_readme_content(root / "alpha", "postgresql")
    assert match is not None
    assert match.match_count >= 1


def run():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} tests passed")


if __name__ == "__main__":
    run()
