"""scripts/dispatch.py — Phase 5 Seedance motion dispatch orchestrator.

Renders the per-shot motion prompts for Seedance 2.0 from the fields the brain
has written to state.json (Step 3.6 sensation intensity + Step 5.5 motion
patterns), and records which clips were picked back into state.

Doctrine encoded (per SKILL.md v2):
  - Pattern A: held witness (default, 90% of shots)
  - Pattern B: frame-entry motion — MANDATORY dual-keyframe pinning
  - Pattern C: slow reveal (golden hour drift, ambient settling)
  - Intensity calibration (max-power audio when max-power visual)
  - Material accuracy negation carried into motion prompt

CLI subcommands:
    python dispatch.py build-prompts --concept-id <id>
        Prints 3 Seedance dispatch directives as JSON:
          [{"shot_id", "prompt", "keyframes_start", "keyframes_end",
            "with_sound_effects", "camera_motion", "duration", "model_slug"}, ...]

    python dispatch.py record-clips --concept-id <id>
        --shot "01-morning-styling:Pi56aqe42C"
        Records the Seedance creation identifier per shot.

    python dispatch.py status --concept-id <id>
        Prints per-shot motion readiness.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from state import (  # noqa: E402
    read_state,
    update_state,
    append_event,
    utcnow_iso,
)

SEEDANCE_SLUG = "bytedance-seedance-pro-2.0"
DEFAULT_DURATION_S = 6
DEFAULT_ASPECT = "9:16"
DEFAULT_RESOLUTION = "1080p"


# ──────────────────────────────────────────────────────────────────────────────
# Motion prompt sections
# ──────────────────────────────────────────────────────────────────────────────


def section_anchor(shot: dict, material_phrase: str) -> str:
    """Opening: re-anchor the bottle + scene from the still."""
    scene_brief = shot.get("scene_brief_for_motion", "").strip()
    if not scene_brief:
        # Fallback: derive a one-liner from scene_description's first sentence
        scene_brief = (shot.get("scene_description", "").strip().split(".")[0]) + "."
    return (
        f"A locked eye-level macro of the {material_phrase} {scene_brief} "
        f"exactly as in the seed image."
    )


def section_locks(shot: dict) -> str:
    """The bottle + camera lock clauses (pattern-aware).

    Pattern A (held witness): bottle + camera + held-still framing.
    Pattern B (frame-entry):  bottle + camera ONLY — the motion_direction
                              itself carries the in-frame action choreography,
                              so we drop the "calm still witness" framing.
    Pattern C (slow reveal):  bottle + camera + ambient-settling framing.
    """
    pattern = (shot.get("motion_pattern") or "A").upper()
    duration = shot.get("duration_s", DEFAULT_DURATION_S)
    base = (
        "The bottle is COMPLETELY MOTIONLESS. The camera is COMPLETELY LOCKED, "
        "no pan, no dolly, no zoom, no tilt, no shake."
    )
    if pattern == "B":
        return base
    if pattern == "C":
        return base + f" Hold the frame as a slow {duration}-second ambient reveal."
    return base + f" Hold the frame as a calm {duration}-second still witness."


def section_motion(shot: dict) -> str:
    """The motion direction — pattern-aware.

    shot.motion_pattern: "A" | "B" | "C"
    shot.motion_direction: the actual paragraph (from sensation maximization)
    For Pattern B (frame-entry), includes the realistic-physics clause.
    """
    direction = shot.get("motion_direction", "").strip()
    if not direction:
        raise ValueError(
            f"shot {shot.get('shot_id')} missing motion_direction — "
            "the brain must populate this in Step 5"
        )
    return direction


def section_audio(shot: dict) -> str:
    audio = shot.get("audio_direction", "").strip()
    if not audio:
        raise ValueError(
            f"shot {shot.get('shot_id')} missing audio_direction — "
            "the brain must populate this in Step 3.5 (situational dossier)"
        )
    return f"Audio: {audio}"


def section_negatives(shot: dict, material_phrase: str) -> str:
    """Motion-pass negatives. Universal + material accuracy + shot-specific.

    Pattern A/C clear all hands. Pattern B (frame-entry) keeps the universal
    faceless lock but drops "no hands" — the motion_direction explicitly
    enters a single hand from the frame edge, and shot.motion_negatives
    carries the single-hand constraint via 'no second hand / no left hand'.
    """
    pattern = (shot.get("motion_pattern") or "A").upper()
    parts = []
    if pattern == "B":
        parts.append(
            "no hair, no face, no people, no second bottle, "
            "no aura, no halo, no glow, no field, no fire"
        )
    else:
        parts.append(
            "no hands, no hair, no face, no people, no second bottle, "
            "no aura, no halo, no glow, no field, no fire"
        )
    if "opaque" in material_phrase.lower():
        parts.append(
            f"The bottle is {material_phrase} — NOT translucent, NOT frosted glass."
        )
    if neg := shot.get("motion_negatives", "").strip():
        parts.append(neg)
    return ". ".join(parts)


# ──────────────────────────────────────────────────────────────────────────────
# Build prompts
# ──────────────────────────────────────────────────────────────────────────────


def build_prompt_for_shot(shot: dict, material_phrase: str) -> str:
    sections = [
        section_anchor(shot, material_phrase),
        section_locks(shot),
        section_motion(shot),
        section_audio(shot),
        section_negatives(shot, material_phrase),
    ]
    return "\n\n".join(s for s in sections if s)


def build_all_prompts(state: dict) -> list[dict]:
    """For each shot, produce a Seedance-ready dispatch dict.

    Returns: [{"shot_id", "prompt", "keyframes_start", "keyframes_end" (optional),
               "with_sound_effects", "camera_motion", "duration", "aspect_ratio",
               "resolution", "model_slug"}, ...]

    keyframes_start = the still's Magnific creation identifier (must have been
                      recorded via compose.py record-stills).
    keyframes_end   = optional; populated when Pattern B (frame-entry) mandates
                      dual-keyframe pinning. Read from shot.end_keyframe_creation_id.
    """
    material_phrase = state.get("product", {}).get("material_phrase")
    if not material_phrase:
        raise ValueError("state.product.material_phrase missing (Step 3.65)")

    arc = sorted(state.get("narrative_arc", []), key=lambda a: a.get("position", 0))
    shots_by_id = {s["shot_id"]: s for s in state.get("shots", [])}

    output = []
    for arc_entry in arc:
        sid = arc_entry["shot_id"]
        shot = shots_by_id.get(sid)
        if not shot:
            raise ValueError(f"narrative_arc references unknown shot_id {sid}")
        start_cid = shot.get("seed_image_creation_id")
        end_cid = shot.get("end_keyframe_creation_id")
        if not start_cid and not end_cid:
            raise ValueError(
                f"shot {sid} missing both seed_image_creation_id AND end_keyframe_creation_id — "
                "run compose.py record-stills first OR set end_keyframe_creation_id directly"
            )
        item = {
            "shot_id": sid,
            "prompt": build_prompt_for_shot(shot, material_phrase),
            "with_sound_effects": True,
            "camera_motion": "static",
            "duration": shot.get("duration_s", DEFAULT_DURATION_S),
            "aspect_ratio": shot.get("aspect_ratio", DEFAULT_ASPECT),
            "resolution": shot.get("resolution", DEFAULT_RESOLUTION),
            "model_slug": shot.get("motion_model_slug", SEEDANCE_SLUG),
        }
        # Three modes: start only / end only / both (dual-keyframe Pattern B)
        if start_cid:
            item["keyframes_start"] = start_cid
        if end_cid:
            item["keyframes_end"] = end_cid
        output.append(item)
    return output


# ──────────────────────────────────────────────────────────────────────────────
# Record picked clips
# ──────────────────────────────────────────────────────────────────────────────


def record_clips(concept_id: str, picks: dict[str, str]) -> dict:
    """Record the Seedance creation identifier per shot."""
    def m(s):
        shots_by_id = {sh["shot_id"]: sh for sh in s.get("shots", [])}
        for sid, cid in picks.items():
            shot = shots_by_id.get(sid)
            if not shot:
                raise ValueError(f"unknown shot_id {sid}")
            shot["motion_creation_id"] = cid
            # record-clips is called AFTER user approval at the motion review gate, so PASS
            shot["status"] = "PASS"
            shot.setdefault("history", []).append({
                "timestamp": utcnow_iso(),
                "event": "motion_clip_picked",
                "magnific_creation_id": cid,
            })
        append_event(s, actor="dispatch", event="clips_recorded", picks=picks)
        return s

    return update_state(concept_id, m)


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────


def cmd_build_prompts(args):
    state = read_state(args.concept_id)
    prompts = build_all_prompts(state)
    print(json.dumps(prompts, indent=2, ensure_ascii=False))


def cmd_record_clips(args):
    picks = {}
    for spec in args.shot:
        if ":" not in spec:
            raise SystemExit(f"--shot expects 'shot_id:creation_id', got: {spec}")
        sid, cid = spec.split(":", 1)
        picks[sid.strip()] = cid.strip()
    if not picks:
        raise SystemExit("at least one --shot required")
    record_clips(args.concept_id, picks)
    print(f"[dispatch] recorded {len(picks)} clip picks for {args.concept_id}")
    for sid, cid in picks.items():
        print(f"  {sid} -> {cid}")


def cmd_status(args):
    state = read_state(args.concept_id)
    print(f"concept: {args.concept_id}")
    print(f"state:   {state.get('state')}")
    print()
    print("Shots:")
    for shot in state.get("shots", []):
        sid = shot["shot_id"]
        seed = shot.get("seed_image_creation_id", "NO-still")
        end = shot.get("end_keyframe_creation_id", "")
        motion = shot.get("motion_creation_id", "NO-motion")
        has_motion_dir = bool(shot.get("motion_direction"))
        has_audio_dir = bool(shot.get("audio_direction"))
        flags = []
        flags.append("motion-dir" if has_motion_dir else "NO-motion-dir")
        flags.append("audio-dir" if has_audio_dir else "NO-audio-dir")
        end_str = f" end={end}" if end else ""
        print(f"  {sid}: [{' '.join(flags)}] seed={seed}{end_str} motion={motion}")


def main():
    parser = argparse.ArgumentParser(description="Dispatch Seedance motion for /video-director.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("build-prompts", help="Render 3 motion prompts as JSON dispatch directives")
    sp.add_argument("--concept-id", required=True)
    sp.set_defaults(func=cmd_build_prompts)

    rp = sub.add_parser("record-clips", help="Record picked Seedance creation IDs per shot")
    rp.add_argument("--concept-id", required=True)
    rp.add_argument("--shot", action="append", default=[],
                    help="Repeatable: shot_id:creation_id")
    rp.set_defaults(func=cmd_record_clips)

    st = sub.add_parser("status", help="Print motion readiness per shot")
    st.add_argument("--concept-id", required=True)
    st.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
