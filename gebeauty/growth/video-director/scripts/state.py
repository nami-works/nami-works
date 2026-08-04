"""state.json helpers for /video-director.

Every component (brain, fal client, poller, reviewer, assembler) reads from
and writes to a single state.json file per video concept. This module:

  - Owns the file layout and lock discipline
  - Validates state transitions
  - Appends to the events audit log

Schema is documented in docs/video-director-state-schema.md.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from filelock import FileLock

SCHEMA_VERSION = 1
STATE_DIR_ROOT = Path(__file__).resolve().parent.parent / "state"
LOCK_TIMEOUT_S = 30

# Top-level state enum, in lifecycle order.
ALLOWED_STATES = [
    "DRAFT",
    "BRIEF_LOCKED",
    "STORYBOARD",
    "QUEUED",
    "RENDERING",
    "AUTO_REVIEW",
    "REGEN_QUEUED",
    "ALL_PASS",
    "ASSEMBLED",
    "DELIVERED",
    "FAILED",
]

# Per-shot status enum.
ALLOWED_SHOT_STATUSES = [
    "PENDING",
    "QUEUED",
    "RENDERING",
    "DOWNLOADING",
    "AUTO_REVIEW",
    "PASS",
    "REGEN_QUEUED",
    "ERROR",
]


# ──────────────────────────────────────────────────────────────────────────────
# Time helpers
# ──────────────────────────────────────────────────────────────────────────────


def utcnow_iso() -> str:
    """ISO 8601 UTC timestamp, suffixed Z, second precision."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ──────────────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────────────


def state_path(concept_id: str) -> Path:
    return STATE_DIR_ROOT / concept_id / "state.json"


def lock_path(concept_id: str) -> Path:
    return STATE_DIR_ROOT / concept_id / "state.json.lock"


def concept_dir(concept_id: str) -> Path:
    return STATE_DIR_ROOT / concept_id


# ──────────────────────────────────────────────────────────────────────────────
# Init
# ──────────────────────────────────────────────────────────────────────────────


def init_state(concept_id: str, concept_label: str) -> dict:
    """Create a fresh state.json at DRAFT. Refuses if one already exists.

    Caller should immediately invoke update_state to populate product + brief
    and transition to BRIEF_LOCKED.
    """
    p = state_path(concept_id)
    if p.exists():
        raise FileExistsError(f"state.json already exists at {p}")
    p.parent.mkdir(parents=True, exist_ok=True)
    now = utcnow_iso()
    state = {
        "schema_version": SCHEMA_VERSION,
        "concept_id": concept_id,
        "concept_label": concept_label,
        "created_at": now,
        "updated_at": now,
        "state": "DRAFT",
        "events": [
            {
                "ts": now,
                "actor": "brain",
                "event": "state_init",
                "from": None,
                "to": "DRAFT",
            }
        ],
    }
    p.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    return state


# ──────────────────────────────────────────────────────────────────────────────
# Read / write (lock-discipline)
# ──────────────────────────────────────────────────────────────────────────────


def read_state(concept_id: str) -> dict:
    """Read state.json without taking the lock. Safe for read-only inspection."""
    p = state_path(concept_id)
    if not p.exists():
        raise FileNotFoundError(f"no state.json at {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def update_state(concept_id: str, mutator: Callable[[dict], dict]) -> dict:
    """Read-modify-write the state file under a file lock.

    mutator receives the current state dict and returns the new state dict.
    The helper validates the new state and writes it atomically.

    Returns the new state dict.
    """
    p = state_path(concept_id)
    if not p.exists():
        raise FileNotFoundError(f"no state.json at {p}")

    lock = FileLock(str(lock_path(concept_id)), timeout=LOCK_TIMEOUT_S)
    with lock:
        current = json.loads(p.read_text(encoding="utf-8"))
        new = mutator(current)
        if not isinstance(new, dict):
            raise TypeError(f"mutator must return a dict, got {type(new)}")
        new["updated_at"] = utcnow_iso()
        validate(new)
        # Atomic write: write to .tmp then rename
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(new, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(p)
    return new


# ──────────────────────────────────────────────────────────────────────────────
# Events log
# ──────────────────────────────────────────────────────────────────────────────


def append_event(state: dict, actor: str, event: str, **extra: Any) -> dict:
    """Append an event to state['events'] in-place. Pure helper, no I/O."""
    entry = {"ts": utcnow_iso(), "actor": actor, "event": event}
    entry.update(extra)
    state.setdefault("events", []).append(entry)
    return state


# ──────────────────────────────────────────────────────────────────────────────
# State transitions
# ──────────────────────────────────────────────────────────────────────────────


def transition(state: dict, new_state: str, actor: str, **extra: Any) -> dict:
    """Move the top-level state to new_state, logging the transition. In-place."""
    if new_state not in ALLOWED_STATES:
        raise ValueError(f"unknown state {new_state}")
    old_state = state.get("state")
    state["state"] = new_state
    append_event(state, actor=actor, event="state_transition", **{
        "from": old_state, "to": new_state, **extra
    })
    return state


# ──────────────────────────────────────────────────────────────────────────────
# Shot helpers
# ──────────────────────────────────────────────────────────────────────────────


def get_shot(state: dict, shot_id: str) -> dict:
    """Return the shot dict by id. Raises if not found."""
    for shot in state.get("shots", []):
        if shot.get("shot_id") == shot_id:
            return shot
    raise KeyError(f"shot_id {shot_id} not in state.shots[]")


def update_shot(state: dict, shot_id: str, **updates: Any) -> dict:
    """Patch a single shot in-place. Returns the updated shot."""
    shot = get_shot(state, shot_id)
    shot.update(updates)
    return shot


def set_shot_status(state: dict, shot_id: str, status: str, actor: str = "system", **extra: Any) -> dict:
    """Change a shot's status, logging the transition to events[]."""
    if status not in ALLOWED_SHOT_STATUSES:
        raise ValueError(f"unknown shot status {status}")
    shot = get_shot(state, shot_id)
    old = shot.get("status")
    shot["status"] = status
    shot.setdefault("history", []).append({
        "timestamp": utcnow_iso(),
        "event": f"status_{status.lower()}",
        "from": old,
        **extra,
    })
    append_event(state, actor=actor, event="shot_status_change",
                 shot_id=shot_id, **{"from": old, "to": status, **extra})
    return shot


# ──────────────────────────────────────────────────────────────────────────────
# Validation
# ──────────────────────────────────────────────────────────────────────────────


def validate(state: dict) -> None:
    """Validate the state dict. Raises ValueError on any failure."""
    # Required top-level fields
    for required in ("schema_version", "concept_id", "state", "events", "created_at", "updated_at"):
        if required not in state:
            raise ValueError(f"state missing required field: {required}")

    # Schema version
    if state["schema_version"] != SCHEMA_VERSION:
        raise ValueError(f"schema_version {state['schema_version']} != {SCHEMA_VERSION}")

    # Top-level state enum
    if state["state"] not in ALLOWED_STATES:
        raise ValueError(f"state '{state['state']}' is not allowed")

    # Shot enum + consistency
    shots = state.get("shots", [])
    for shot in shots:
        sid = shot.get("shot_id")
        if not sid:
            raise ValueError(f"shot missing shot_id: {shot}")
        if shot.get("status") and shot["status"] not in ALLOWED_SHOT_STATUSES:
            raise ValueError(f"shot {sid} has invalid status {shot['status']}")

    # Lifecycle invariants
    top_state = state["state"]

    if top_state in ("QUEUED", "RENDERING", "AUTO_REVIEW", "REGEN_QUEUED", "ALL_PASS", "ASSEMBLED", "DELIVERED"):
        if not shots:
            raise ValueError(f"state is {top_state} but shots[] is empty")

    if top_state in ("QUEUED", "RENDERING", "AUTO_REVIEW", "REGEN_QUEUED", "ALL_PASS"):
        budget = state.get("budget", {})
        if not budget.get("approved_at"):
            raise ValueError(f"state is {top_state} but budget.approved_at is not set")

    if top_state in ("ALL_PASS", "ASSEMBLED", "DELIVERED"):
        for shot in shots:
            if shot.get("status") != "PASS":
                raise ValueError(f"state is {top_state} but shot {shot.get('shot_id')} is not PASS")

    if top_state == "DELIVERED":
        delivery = state.get("delivery", {})
        if not delivery.get("delivered_at"):
            raise ValueError("state is DELIVERED but delivery.delivered_at is not set")


# ──────────────────────────────────────────────────────────────────────────────
# Cost rollup
# ──────────────────────────────────────────────────────────────────────────────


def recompute_spent(state: dict) -> dict:
    """Recompute budget.spent_usd from budget.by_shot. In-place."""
    by_shot = state.get("budget", {}).get("by_shot", {})
    state.setdefault("budget", {})["spent_usd"] = round(sum(by_shot.values()), 4)
    return state


# ──────────────────────────────────────────────────────────────────────────────
# Convenience: example DRAFT
# ──────────────────────────────────────────────────────────────────────────────


def example_draft(concept_id: str, concept_label: str) -> dict:
    """Build (in memory only, no file write) a DRAFT state for testing."""
    now = utcnow_iso()
    return {
        "schema_version": SCHEMA_VERSION,
        "concept_id": concept_id,
        "concept_label": concept_label,
        "created_at": now,
        "updated_at": now,
        "state": "DRAFT",
        "events": [{
            "ts": now, "actor": "brain", "event": "state_init", "from": None, "to": "DRAFT",
        }],
    }


if __name__ == "__main__":
    # Smoke test: init a temp state, push it through a few transitions, validate.
    import sys, tempfile, shutil

    test_concept = "test-state-smoke"
    test_dir = STATE_DIR_ROOT / test_concept
    if test_dir.exists():
        shutil.rmtree(test_dir)

    print("1. init")
    s = init_state(test_concept, "smoke test")
    validate(s)
    print(f"   state: {s['state']}, events: {len(s['events'])}")

    print("2. populate brief + transition to BRIEF_LOCKED")
    def m1(s):
        s["brief"] = {"audience": "test", "platform": "meta-reels"}
        return transition(s, "BRIEF_LOCKED", actor="brain")
    s = update_state(test_concept, m1)
    validate(s)
    print(f"   state: {s['state']}, events: {len(s['events'])}")

    print("3. add shots + transition to STORYBOARD")
    def m2(s):
        s["shots"] = [
            {"shot_id": "01-test", "status": "PENDING", "model": "fal-ai/test"},
        ]
        return transition(s, "STORYBOARD", actor="brain")
    s = update_state(test_concept, m2)
    validate(s)

    print("4. budget approve + transition to QUEUED")
    def m3(s):
        s["budget"] = {"cap_usd": 5.0, "approved_at": utcnow_iso(), "approved_by": "test", "by_shot": {}, "spent_usd": 0}
        return transition(s, "QUEUED", actor="human")
    s = update_state(test_concept, m3)
    validate(s)

    print("5. set shot status PASS via helper")
    def m4(s):
        set_shot_status(s, "01-test", "PASS", actor="reviewer", score="15/15")
        return s
    s = update_state(test_concept, m4)
    print(f"   shot status: {s['shots'][0]['status']}")

    print("6. transition to ALL_PASS")
    s = update_state(test_concept, lambda s: transition(s, "ALL_PASS", actor="system"))
    validate(s)

    print("7. negative validation: try to set DELIVERED without delivery.delivered_at")
    try:
        update_state(test_concept, lambda s: transition(s, "DELIVERED", actor="system"))
        print("   FAIL: validation did not catch missing delivery.delivered_at")
        sys.exit(1)
    except ValueError as e:
        print(f"   PASS: caught -- {e}")

    print("8. cleanup")
    shutil.rmtree(test_dir)
    print("\nstate.py smoke test PASSED")
