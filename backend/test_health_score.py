"""Smoke tests for the per-project health score.

Calls the scoring helpers directly so it needs no extra test deps (no pytest /
httpx) — just the backend's own runtime. Run from the backend dir:

    ./.venv/bin/python test_health_score.py

Port reachability is stubbed so the tests don't depend on any running service,
and git timestamps are stubbed so they don't depend on the local repo state.
"""
import main
from main import compute_health_score


def _signals_by_key(signals):
    return {s.key: s for s in signals}


def _patch(monkey):
    """Apply a dict of attribute overrides to `main`, returning a restore fn."""
    saved = {k: getattr(main, k) for k in monkey}
    for k, v in monkey.items():
        setattr(main, k, v)
    return lambda: [setattr(main, k, v) for k, v in saved.items()]


def test_perfect_score():
    now = main.datetime.now(tz=main.timezone.utc).timestamp()
    restore = _patch({
        "git_last_commit_epoch": lambda _d: now,             # committed just now
        "project_known_ports": lambda _d: [9999],
        "_port_is_in_use": lambda _p: True,                  # port responding
    })
    try:
        score, signals = compute_health_score(
            main.ROOT_DIR, has_readme=True, git_dirty=False, has_git=True,
        )
        assert score == 100, score
        keyed = _signals_by_key(signals)
        assert all(keyed[k].applicable for k in ("freshness", "clean_tree", "readme", "port"))
        assert keyed["freshness"].score == 1.0
    finally:
        restore()


def test_worst_score():
    old = main.datetime.now(tz=main.timezone.utc).timestamp() - 400 * 86400
    restore = _patch({
        "git_last_commit_epoch": lambda _d: old,             # ancient commit
        "project_known_ports": lambda _d: [9999],
        "_port_is_in_use": lambda _p: False,                 # port dead
    })
    try:
        score, signals = compute_health_score(
            main.ROOT_DIR, has_readme=False, git_dirty=True, has_git=True,
        )
        assert score == 0, score
    finally:
        restore()


def test_inapplicable_signals_are_not_penalised():
    # No git repo and no known port: scored only on the README signal, which
    # is present — so a clean 100 rather than being docked for what can't be seen.
    restore = _patch({
        "git_last_commit_epoch": lambda _d: None,
        "project_known_ports": lambda _d: [],
    })
    try:
        score, signals = compute_health_score(
            main.ROOT_DIR, has_readme=True, git_dirty=False, has_git=False,
        )
        keyed = _signals_by_key(signals)
        assert keyed["freshness"].applicable is False
        assert keyed["port"].applicable is False
        assert keyed["clean_tree"].applicable is False  # no repo → not measured
        assert keyed["readme"].applicable is True
        assert score == 100, score
    finally:
        restore()


def test_partial_freshness_decays():
    midpoint_days = (main.HEALTH_FRESH_DAYS + main.HEALTH_STALE_DAYS) / 2
    ts = main.datetime.now(tz=main.timezone.utc).timestamp() - midpoint_days * 86400
    restore = _patch({
        "git_last_commit_epoch": lambda _d: ts,
        "project_known_ports": lambda _d: [],
    })
    try:
        _, signals = compute_health_score(
            main.ROOT_DIR, has_readme=True, git_dirty=False, has_git=True,
        )
        fresh = _signals_by_key(signals)["freshness"].score
        assert 0.45 < fresh < 0.55, fresh  # roughly halfway through the decay band
    finally:
        restore()


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("All health-score tests passed.")
