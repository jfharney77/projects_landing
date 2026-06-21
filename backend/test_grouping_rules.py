"""Smoke tests for custom grouping rules.

Calls the endpoint functions directly so it needs no extra test deps (no
pytest / httpx) — just the backend's own runtime. Run from the backend dir:

    ./.venv/bin/python test_grouping_rules.py

It redirects the rule store to a temp file, so the real grouping_rules.json
is never touched.
"""
import tempfile
from pathlib import Path

import main
from main import (
    CreateGroupingRuleRequest,
    ReorderGroupingRulesRequest,
    UpdateGroupingRuleRequest,
    create_grouping_rule,
    delete_grouping_rule,
    list_grouping_rules,
    reorder_grouping_rules,
    update_grouping_rule,
)
from fastapi import HTTPException


def use_temp_store():
    main.GROUPING_RULES_FILE = Path(tempfile.mkdtemp()) / "grouping_rules.json"


def expect_http(status, fn):
    try:
        fn()
    except HTTPException as exc:
        assert exc.status_code == status, f"expected {status}, got {exc.status_code}"
        return
    raise AssertionError(f"expected HTTPException {status}, none raised")


def test_create_list_update_delete():
    use_temp_store()
    created = create_grouping_rule(
        CreateGroupingRuleRequest(name="AI Agents", match_type="tag", value="LangGraph")
    )
    assert created.name == "AI Agents"
    assert created.match_type == "tag" and created.value == "LangGraph"
    assert created.enabled is True and created.order == 0
    rid = created.id

    listing = list_grouping_rules()
    assert [r.id for r in listing] == [rid]

    patched = update_grouping_rule(rid, UpdateGroupingRuleRequest(name="Agents", enabled=False))
    assert patched.name == "Agents" and patched.enabled is False
    # Untouched fields stay put.
    assert patched.match_type == "tag" and patched.value == "LangGraph"

    assert delete_grouping_rule(rid)["status"] == "deleted"
    assert list_grouping_rules() == []


def test_validation():
    use_temp_store()
    expect_http(400, lambda: create_grouping_rule(
        CreateGroupingRuleRequest(name="x", match_type="bogus", value="y")))
    expect_http(400, lambda: create_grouping_rule(
        CreateGroupingRuleRequest(name="   ", match_type="tag", value="y")))
    expect_http(400, lambda: create_grouping_rule(
        CreateGroupingRuleRequest(name="x", match_type="tag", value="   ")))
    expect_http(404, lambda: delete_grouping_rule("missing-id"))
    expect_http(404, lambda: update_grouping_rule(
        "missing-id", UpdateGroupingRuleRequest(name="z")))


def test_ordering_and_reorder():
    use_temp_store()
    a = create_grouping_rule(CreateGroupingRuleRequest(name="A", match_type="name", value="a"))
    b = create_grouping_rule(CreateGroupingRuleRequest(name="B", match_type="name", value="b"))
    c = create_grouping_rule(CreateGroupingRuleRequest(name="C", match_type="name", value="c"))
    # Newly created rules append at the lowest priority (increasing order).
    assert [r.order for r in (a, b, c)] == [0, 1, 2]

    reordered = reorder_grouping_rules(ReorderGroupingRulesRequest(order=[c.id, a.id]))
    # c, a are pinned first; b (unmentioned) keeps its place and trails them.
    assert [r.id for r in reordered] == [c.id, a.id, b.id]
    assert [r.order for r in reordered] == [0, 1, 2]

    # Unknown ids in a reorder request are ignored, not fatal.
    safe = reorder_grouping_rules(ReorderGroupingRulesRequest(order=["ghost", b.id]))
    assert b.id in [r.id for r in safe]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("All grouping-rule tests passed.")
