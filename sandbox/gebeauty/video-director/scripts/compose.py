"""scripts/compose.py — Phase 4 still composition orchestrator.

Renders the per-shot composition prompts for Magnific Nano Banana Pro from the
fields the 9-step brain has written to state.json, and records which stills
were picked back into state.

Doctrine encoded (per SKILL.md v2):
  - Step 3.65 material accuracy (material_phrase per product)
  - Step 3.6 sensation maximization (kinetic_still_effect OR partial_signifier)
  - Step 3.7 proportion anchoring (cm + frame-fill + familiar-object)
  - Step 3.75 realistic grounding (5 mandatory clauses)
  - Banned-noun filter (locked list in [docs/ip.md])

CLI subcommands:
    python compose.py build-prompts --concept-id <id>
        Reads state.shots[] and prints 3 ready-to-paste composition prompts
        as JSON: [{"shot_id": "...", "prompt": "..."}, ...]

    python compose.py record-stills --concept-id <id>
        --pick "01-morning-styling:CHTQn3yEEy" --pick "02-...:..."
        Records the picked Magnific creation identifiers per shot back into
        state.shots[i].seed_image_creation_id and bumps state.events[].

    python compose.py status --concept-id <id>
        Prints which shots have prompts built, which have stills picked.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from state import (  # noqa: E402
    read_state,
    update_state,
    append_event,
    transition,
    utcnow_iso,
)

# ──────────────────────────────────────────────────────────────────────────────
# Locked palette + banned-noun filter (per [docs/ip.md])
# ──────────────────────────────────────────────────────────────────────────────

BANNED_NOUNS = [
    "field",
    "bubble",
    "dome",
    "boundary",
    "shield",
    "barrier",
    "halo",
    "aura",
]

# ──────────────────────────────────────────────────────────────────────────────
# Prompt sections
# ──────────────────────────────────────────────────────────────────────────────


def section_scene(shot: dict, material_phrase: str) -> str:
    """SCENE block: surface + environment + must-have props.

    Reads from shot.scene_description (free-text from the brain).
    """
    scene = shot.get("scene_description", "").strip()
    if not scene:
        raise ValueError(
            f"shot {shot.get('shot_id')} missing scene_description — "
            "the brain must populate this in Step 3.5 (situational depth pass)"
        )
    # Inject material_phrase at the front so the bottle's material is the first thing the model reads
    return f"SCENE: A {material_phrase} (the referenced product) {scene}"


def section_proportion(shot: dict) -> str:
    """PROPORTION block: cm + frame-fill + familiar-object (Step 3.7)."""
    p = shot.get("proportion_directive", "").strip()
    if not p:
        raise ValueError(
            f"shot {shot.get('shot_id')} missing proportion_directive — "
            "the brain must populate this in Step 3.7 (proportion anchoring pass)"
        )
    return f"PROPORTION: {p}"


def section_grounding(shot: dict) -> str:
    """REALISTIC GROUNDING block (Step 3.75) — 5 mandatory clauses."""
    g = shot.get("realistic_grounding", "").strip()
    if not g:
        raise ValueError(
            f"shot {shot.get('shot_id')} missing realistic_grounding — "
            "the brain must populate this in Step 3.75 (realistic grounding pass)"
        )
    return f"REALISTIC GROUNDING: {g}"


def section_sensation(shot: dict) -> str:
    """KINETIC STILL EFFECT block (Step 3.6) OR IN-FRAME PARTIAL SIGNIFIER (fallback).

    If shot.kinetic_still_effect is set, use it. Else if shot.partial_signifier
    is set, use the fallback wording. If neither, return empty string (some
    shots may legitimately have no kinetic element).
    """
    if k := shot.get("kinetic_still_effect", "").strip():
        return f"KINETIC STILL EFFECT: {k}"
    if s := shot.get("partial_signifier", "").strip():
        return f"IN-FRAME PARTIAL SIGNIFIER: {s}"
    return ""


def section_lighting(shot: dict) -> str:
    """LIGHTING block."""
    light = shot.get("lighting_description", "").strip()
    if not light:
        raise ValueError(
            f"shot {shot.get('shot_id')} missing lighting_description"
        )
    return f"LIGHTING: {light}"


def section_negatives(shot: dict, material_phrase: str) -> str:
    """NEGATIVES block — composes the shot's must-NOT-haves with the universal banned-noun filter + material accuracy negation.

    Reads shot.negatives (free-text) + appends the universal locked rules.
    """
    shot_negs = shot.get("negatives", "").strip()
    # Material accuracy negatives — invert the material phrase
    if "opaque" in material_phrase.lower():
        material_negs = (
            "no frosted glass, no translucent bottle, no see-through, "
            "no glass material"
        )
    else:
        material_negs = ""
    # Banned-noun list applied to the bottle
    banned = ", ".join(f"no {n}" for n in BANNED_NOUNS)
    banned_clause = f"{banned} around the bottle"
    parts = [p for p in [material_negs, shot_negs, banned_clause] if p]
    return f"NEGATIVES: {' | '.join(parts)}"


def section_style() -> str:
    return (
        "STYLE: 9:16 portrait, Aesop-style minimalism, candid slice-of-life "
        "premium beauty editorial, NOT showcase product photography."
    )


# ──────────────────────────────────────────────────────────────────────────────
# Build prompts
# ──────────────────────────────────────────────────────────────────────────────


def build_prompt_for_shot(shot: dict, material_phrase: str) -> str:
    """Assemble the full composition prompt for one shot.

    Order follows SKILL.md Step 4:
        SCENE → PROPORTION → REALISTIC GROUNDING → KINETIC EFFECT → LIGHTING → NEGATIVES → STYLE
    """
    sections = [
        section_scene(shot, material_phrase),
        section_proportion(shot),
        section_grounding(shot),
        section_sensation(shot),
        section_lighting(shot),
        section_negatives(shot, material_phrase),
        section_style(),
    ]
    return "\n\n".join(s for s in sections if s)


def build_all_prompts(state: dict) -> list[dict]:
    """Build prompts for every shot in state.narrative_arc[] order.

    Returns a list of {shot_id, prompt, magnific_library_id}.
    """
    material_phrase = state.get("product", {}).get("material_phrase")
    if not material_phrase:
        raise ValueError(
            "state.product.material_phrase missing — "
            "the brain must populate this in Step 3.65 (material accuracy pass)"
        )
    library_id = state.get("product", {}).get("magnific_library_id")
    if not library_id:
        raise ValueError(
            "state.product.magnific_library_id missing — "
            "bootstrap the library asset before composing"
        )

    arc = sorted(state.get("narrative_arc", []), key=lambda a: a.get("position", 0))
    shots_by_id = {s["shot_id"]: s for s in state.get("shots", [])}

    output = []
    for arc_entry in arc:
        sid = arc_entry["shot_id"]
        shot = shots_by_id.get(sid)
        if not shot:
            raise ValueError(f"narrative_arc references unknown shot_id {sid}")
        prompt = build_prompt_for_shot(shot, material_phrase)
        output.append({
            "shot_id": sid,
            "prompt": prompt,
            "magnific_library_id": library_id,
            "aspect_ratio": shot.get("aspect_ratio", "9:16"),
        })
    return output


# ──────────────────────────────────────────────────────────────────────────────
# Record picked stills
# ──────────────────────────────────────────────────────────────────────────────


def record_stills(concept_id: str, picks: dict[str, str]) -> dict:
    """Record the picked Magnific creation identifiers per shot.

    picks: {shot_id: magnific_creation_id}
    """
    def m(s):
        shots_by_id = {sh["shot_id"]: sh for sh in s.get("shots", [])}
        for sid, cid in picks.items():
            shot = shots_by_id.get(sid)
            if not shot:
                raise ValueError(f"unknown shot_id {sid}")
            shot["seed_image_creation_id"] = cid
            shot.setdefault("history", []).append({
                "timestamp": utcnow_iso(),
                "event": "still_picked",
                "magnific_creation_id": cid,
            })
        append_event(s, actor="compose", event="stills_recorded", picks=picks)
        return s

    return update_state(concept_id, m)


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────


def cmd_build_prompts(args):
    state = read_state(args.concept_id)
    prompts = build_all_prompts(state)
    print(json.dumps(prompts, indent=2, ensure_ascii=False))


def cmd_record_stills(args):
    picks = {}
    for spec in args.pick:
        if ":" not in spec:
            raise SystemExit(f"--pick expects 'shot_id:creation_id', got: {spec}")
        sid, cid = spec.split(":", 1)
        picks[sid.strip()] = cid.strip()
    if not picks:
        raise SystemExit("at least one --pick required")
    record_stills(args.concept_id, picks)
    print(f"[compose] recorded {len(picks)} still picks for {args.concept_id}")
    for sid, cid in picks.items():
        print(f"  {sid} -> {cid}")


def cmd_status(args):
    state = read_state(args.concept_id)
    print(f"concept: {args.concept_id}")
    print(f"state:   {state.get('state')}")
    print(f"product: {state.get('product', {}).get('handle', '?')}")
    print(f"library_id: {state.get('product', {}).get('magnific_library_id', '?')}")
    print(f"material_phrase: {state.get('product', {}).get('material_phrase', 'NOT SET')}")
    print()
    print("Shots:")
    for shot in state.get("shots", []):
        sid = shot["shot_id"]
        has_scene = bool(shot.get("scene_description"))
        has_proportion = bool(shot.get("proportion_directive"))
        has_grounding = bool(shot.get("realistic_grounding"))
        has_sensation = bool(shot.get("kinetic_still_effect") or shot.get("partial_signifier"))
        picked = shot.get("seed_image_creation_id", "—")
        flags = []
        flags.append("scene" if has_scene else "NO-scene")
        flags.append("prop" if has_proportion else "NO-prop")
        flags.append("ground" if has_grounding else "NO-ground")
        flags.append("sens" if has_sensation else "NO-sens")
        print(f"  {sid}: [{' '.join(flags)}] picked={picked}")


def main():
    parser = argparse.ArgumentParser(description="Compose Magnific stills for /video-director.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("build-prompts", help="Render 3 composition prompts as JSON")
    sp.add_argument("--concept-id", required=True)
    sp.set_defaults(func=cmd_build_prompts)

    rp = sub.add_parser("record-stills", help="Record picked Magnific creation IDs per shot")
    rp.add_argument("--concept-id", required=True)
    rp.add_argument("--pick", action="append", default=[],
                    help="Repeatable: shot_id:creation_id")
    rp.set_defaults(func=cmd_record_stills)

    st = sub.add_parser("status", help="Print composition readiness per shot")
    st.add_argument("--concept-id", required=True)
    st.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
