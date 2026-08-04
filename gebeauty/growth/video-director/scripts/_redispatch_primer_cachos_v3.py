"""Re-dispatch primer-cachos-definidos-v1 v3 video renders using approved v3 seed images.

v3 direction (2026-06-08): grounded slice-of-life environments.
  Shot 1: bathroom counter (dryer audio off-frame)
  Shot 2: cafe table by window with urban rain
  Shot 3: entryway console with door audio

Seeds were generated in _generate_seeds_v3.py and are stored in
state.seeds_v3.<shot_id>.url. This script consumes those URLs.

Archives the prior (v2) clips to clips/_v2/ before writing v3 clips.
"""

from __future__ import annotations
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from fal_wrapper import submit_image_to_video, extract_video_url, download_video  # noqa: E402
from state import (  # noqa: E402
    concept_dir,
    read_state,
    update_state,
    transition,
    append_event,
    recompute_spent,
    utcnow_iso,
)

CONCEPT_ID = "primer-cachos-definidos-v1"
MODEL_LABEL = "veo-3"
MODEL_SLUG = "fal-ai/veo3/image-to-video"
SHOT_COST_USD = 0.60

VIDEO_PROMPTS = {
    "01-morning-styling": (
        "The frosted glass GE Beauty haircare bottle stands perfectly still on the cream marble bathroom counter in the right portion of frame, "
        "exactly as in the seed image. Over the duration of the shot, NOTHING in the scene physically moves except for very subtle ambient micro-motion: "
        "a faint wisp of steam at the very edge of frame on the left, a barely-perceptible drift of light intensity. "
        "The bottle is COMPLETELY MOTIONLESS: no rotation, no drift, no tilt, no wobble, no movement whatsoever, perfectly locked from frame 1 to frame N. "
        "The camera is COMPLETELY LOCKED: no zoom, no dolly, no pan, no tilt, no drift, no shake. "
        "The bathroom counter, tile, and wood remain identical from frame 1 to frame N. "
        "Audio: warm continuous hum of a hair dryer off-frame, subtle bathroom tile reverb, no speech. Aesop-style minimalism. "
        "NEGATIVE: no people, no faces, no hair, no hands, no visible hair dryer in frame, no rotation of bottle, "
        "no camera movement, no environment changes, no flickering."
    ),
    "02-afternoon-rain": (
        "The frosted glass GE Beauty haircare bottle stands perfectly still on the dark wood cafe table by the rain-streaked window, "
        "exactly as in the seed image. Over the duration of the shot, RAIN visibly streams down the window behind the bottle: "
        "large droplets traveling down the glass, the city beyond softly blurred and wet. "
        "The bottle is COMPLETELY MOTIONLESS: no rotation, no drift, no tilt, no wobble. "
        "The camera is COMPLETELY LOCKED: no zoom, no dolly, no pan. "
        "The cafe interior remains identical from frame 1 to frame N. "
        "Audio: rain on glass with droplet impacts, wet street ambience underneath, soft distant cafe murmur. "
        "Aesop-style minimalism. "
        "NEGATIVE: no people, no faces, no hair, no hands, no cups, no condensation on the bottle, "
        "no rotation of bottle, no camera movement, no flickering."
    ),
    "03-evening-arrival": (
        "The frosted glass GE Beauty haircare bottle stands perfectly still on the entryway console table beside the handbag and keys, "
        "exactly as in the seed image. Over the duration of the shot, warm golden afternoon light SLIGHTLY INCREASES intensity, "
        "as if a front door has just opened just out of frame to the right, casting more warm light onto the bottle. "
        "The light shift is subtle but felt. "
        "The bottle is COMPLETELY MOTIONLESS: no rotation, no drift, no tilt, no wobble. "
        "The camera is COMPLETELY LOCKED: no zoom, no dolly, no pan. "
        "The entryway environment remains identical from frame 1 to frame N. "
        "Audio: front door opening with a soft creak, brief footsteps on tile, front door closing with a soft thud, then quiet home ambience. "
        "Aesop-style minimalism. "
        "NEGATIVE: no people, no faces, no hair, no hands, no rotation of bottle, no camera movement, no flickering."
    ),
}


def dispatch_one(shot_id: str, prompt: str, seed_url: str) -> dict:
    print(f"[dispatch] submit {shot_id}", flush=True)
    result = submit_image_to_video(
        model_slug=MODEL_SLUG,
        prompt=prompt,
        image_url=seed_url,
        duration_s=None,
        aspect_ratio="9:16",
        resolution="1080p",
        extra_args={"duration": "6s"},
    )
    url = extract_video_url(result)
    if not url:
        raise RuntimeError(f"{shot_id}: no video URL in result")
    print(f"[dispatch] {shot_id} URL: {url[:80]}", flush=True)
    return {"shot_id": shot_id, "url": url, "result": result}


def main():
    state = read_state(CONCEPT_ID)
    seeds = state.get("seeds_v3") or {}
    missing = [sid for sid in VIDEO_PROMPTS if sid not in seeds]
    if missing:
        raise RuntimeError(f"missing seeds for {missing}; run _generate_seeds_v3.py first")

    cdir = concept_dir(CONCEPT_ID)
    clips_dir = cdir / "clips"
    archive_dir = clips_dir / "_v2"
    archive_dir.mkdir(parents=True, exist_ok=True)

    # Archive v2 clips before overwriting
    for shot_id in VIDEO_PROMPTS.keys():
        src = clips_dir / f"{shot_id}.mp4"
        if src.exists():
            dst = archive_dir / f"{shot_id}.mp4"
            if not dst.exists():
                shutil.copy2(src, dst)
                print(f"[archive] {src.name} -> _v2/")

    # Pre-state update
    def mutator_pre(s):
        if s["state"] not in ("REGEN_QUEUED",):
            transition(s, "REGEN_QUEUED", actor="director", reason="v3-grounded-environments-pivot")
        for shot_id, new_prompt in VIDEO_PROMPTS.items():
            shot = next((sh for sh in s["shots"] if sh["shot_id"] == shot_id), None)
            if shot:
                shot.setdefault("history", []).append({
                    "timestamp": utcnow_iso(),
                    "event": "prompt_rewrite_v3",
                    "old_prompt": shot.get("prompt"),
                    "new_prompt": new_prompt,
                    "old_seed_image_url": shot.get("seed_image_url"),
                    "new_seed_image_url": seeds[shot_id]["url"],
                })
                shot["prompt"] = new_prompt
                shot["seed_image_url"] = seeds[shot_id]["url"]
                shot["model_label"] = MODEL_LABEL
                shot["model_slug"] = MODEL_SLUG
                shot["extra_args"] = {"duration": "6s"}
                shot["status"] = "QUEUED"
                shot["attempts"] = (shot.get("attempts", 0)) + 1
        append_event(s, actor="director", event="redispatch_v3", shots=list(VIDEO_PROMPTS.keys()))
        return s

    update_state(CONCEPT_ID, mutator_pre)

    print("[dispatch] firing 3 Veo 3 jobs in parallel...")
    results: dict[str, dict] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {
            ex.submit(dispatch_one, sid, p, seeds[sid]["url"]): sid
            for sid, p in VIDEO_PROMPTS.items()
        }
        for f in as_completed(futures):
            sid = futures[f]
            try:
                results[sid] = f.result()
            except Exception as e:
                errors[sid] = str(e)
                print(f"[dispatch] ERROR {sid}: {e}", flush=True)

    # Download
    for sid, r in results.items():
        out = clips_dir / f"{sid}.mp4"
        download_video(r["url"], out)
        print(f"[download] {sid} -> {out}")

    # Post-state update
    def mutator_post(s):
        for sid in results.keys():
            shot = next((sh for sh in s["shots"] if sh["shot_id"] == sid), None)
            if shot:
                shot["status"] = "AUTO_REVIEW"
                shot["fal_url"] = results[sid]["url"]
                shot["downloaded_at"] = utcnow_iso()
                shot.setdefault("history", []).append({
                    "timestamp": utcnow_iso(),
                    "event": "rendered_v3",
                })
        for sid, err in errors.items():
            shot = next((sh for sh in s["shots"] if sh["shot_id"] == sid), None)
            if shot:
                shot["status"] = "ERROR"
                shot.setdefault("history", []).append({
                    "timestamp": utcnow_iso(),
                    "event": "render_error_v3",
                    "error": err,
                })
        s.setdefault("budget", {}).setdefault("by_shot", {})
        for sid in results.keys():
            s["budget"]["by_shot"][f"{sid}_v3_redispatch"] = SHOT_COST_USD
        recompute_spent(s)
        append_event(s, actor="director", event="redispatch_v3_complete",
                     successes=list(results.keys()), errors=list(errors.keys()))
        return s

    new_state = update_state(CONCEPT_ID, mutator_post)
    print(f"\n[state] spent_usd now ${new_state['budget']['spent_usd']}")

    if errors:
        print(f"FAILED: {errors}")
        sys.exit(1)
    print("[done] all 3 v3 clips downloaded; status=AUTO_REVIEW")


if __name__ == "__main__":
    main()
