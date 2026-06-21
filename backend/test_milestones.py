"""Smoke tests for the project milestone tracker.

Calls the endpoint functions directly so it needs no extra test deps (no
pytest / httpx) — just the backend's own runtime. Run from the backend dir:

    ./.venv/bin/python test_milestones.py

It redirects the milestone store to a temp file, so the real milestones.json
is never touched.
"""
import tempfile
from pathlib import Path

import main
from main import (
    CreateMilestoneRequest,
    UpdateMilestoneRequest,
    create_milestone,
    delete_milestone,
    list_milestones,
    milestones_progress,
    update_milestone,
)
from fastapi import HTTPException


def use_temp_store():
    main.MILESTONES_FILE = Path(tempfile.mkdtemp()) / "milestones.json"


def expect_http(status, fn):
    try:
        fn()
    except HTTPException as exc:
        assert exc.status_code == status, f"expected {status}, got {exc.status_code}"
        return
    raise AssertionError(f"expected HTTPException {status}, none raised")


def test_create_list_toggle_delete():
    use_temp_store()
    created = create_milestone(
        CreateMilestoneRequest(project_path="projects_landing", title="Ship v1", due_date="2026-09-01")
    )
    assert created.title == "Ship v1"
    assert created.done is False and created.completed_at == ""
    mid = created.id

    listing = list_milestones(project_path="projects_landing")
    assert [m.id for m in listing] == [mid]

    patched = update_milestone(mid, UpdateMilestoneRequest(done=True))
    assert patched.done is True and patched.completed_at

    cleared = update_milestone(mid, UpdateMilestoneRequest(done=False))
    assert cleared.done is False and cleared.completed_at == ""

    assert delete_milestone(mid)["status"] == "deleted"
    assert list_milestones() == []


def test_validation():
    use_temp_store()
    expect_http(400, lambda: create_milestone(
        CreateMilestoneRequest(project_path="projects_landing", title="x", due_date="09-2026")))
    expect_http(400, lambda: create_milestone(
        CreateMilestoneRequest(project_path="projects_landing", title="   ")))
    expect_http(404, lambda: create_milestone(
        CreateMilestoneRequest(project_path="does-not-exist", title="nope")))
    expect_http(404, lambda: delete_milestone("missing-id"))


def test_progress():
    use_temp_store()
    proj = "projects_landing"
    create_milestone(CreateMilestoneRequest(project_path=proj, title="past", due_date="2000-01-01"))
    create_milestone(CreateMilestoneRequest(project_path=proj, title="future", due_date="2999-01-01"))
    done = create_milestone(CreateMilestoneRequest(project_path=proj, title="done"))
    update_milestone(done.id, UpdateMilestoneRequest(done=True))

    progress = {p.project_path: p for p in milestones_progress()}
    p = progress[proj]
    assert p.total == 3 and p.done == 1 and p.overdue == 1
    assert p.next_due == "2999-01-01"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("All milestone tests passed.")
