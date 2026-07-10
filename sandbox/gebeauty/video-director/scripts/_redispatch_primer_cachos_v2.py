"""Re-dispatch the 3 base shots of primer-cachos-definidos-v1 with v2 prompts.

v2 direction (locked 2026-06-08):
  - Unified cream void (no surface) shared across all 3 shots, identical seed image
  - Completely static camera (no zoom, dolly, pan)
  - Completely static product (no rotation, drift, wobble)
  - Day-arc carried by lighting + per-shot environmental event
  - All Veo 3, 6s each, native 9:16

After successful download, archives v1 clips to clips/_v1/ and writes new
clips to clips/<shot_id>.mp4.
"""

from __future__ import annotations
import sys
import shutil
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
    set_shot_status,
    utcnow_iso,
)

CONCEPT_ID = "primer-cachos-definidos-v1"
MODEL_LABEL = "veo-3"
MODEL_SLUG = "fal-ai/veo3/image-to-video"
SEED_IMAGE = "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/freepik__reframe-the-image-to-br-maintain-the-whitelight-gr__63444.png"
SHOT_COST_USD = 0.60

PROMPTS = {
    "01-morning-styling": (
        "A frosted glass bottle of haircare product stands perfectly still in the right portion of frame, "
        "suspended in a soft cream-colored void with NO visible surface, NO floor, NO marble, NO table — "
        "only a soft warm cream tonal background with subtle radial vignette. "
        "Cool morning light from upper-left, soft slightly blue-tinted neutral white. "
        "From the left side of frame, a chrome hair dryer slowly enters, its sleek metallic form gliding in horizontally, "
        "coming to rest with its nozzle pointed at the bottle. The dryer stays steady for the remainder of the shot. "
        "The bottle is COMPLETELY MOTIONLESS throughout: no rotation, no drift, no tilt, no wobble, no movement of any kind, "
        "perfectly locked from frame 1 to frame N. "
        "The camera is COMPLETELY LOCKED: no zoom, no dolly, no pan, no tilt, no drift, no shake. "
        "Camera position is identical at frame 1 and frame N. Aesop-style minimalism, calm mature mood. "
        "NEGATIVE: no marble surface, no defined floor, no counter, no table, no water, no mist, no fog, "
        "no field, no bubble, no dome, no shield, no halo, no aura, no transparent substance, no refractive distortion, "
        "no flames, no smoke, no orange light, no orange tint, no fire, no people, no faces, no hair, no hands, "
        "no logos other than what is on the product, no camera movement, no rotation of the bottle, no drift, no wobble."
    ),
    "02-afternoon-rain": (
        "A frosted glass bottle of haircare product stands perfectly still in the center of frame, "
        "suspended in a soft cream-colored void with NO visible surface, NO floor, NO marble, NO table — "
        "only soft cool cream tonal background with subtle radial vignette. "
        "Cool overcast afternoon light, slight blue-grey tint, soft diffused from above. "
        "TORRENTIAL DOWNPOUR fills the surrounding space — dense sheets of water, hundreds of droplets per second, "
        "like a tropical storm, visible as continuous streaks and falling sheets. "
        "The rain visibly deflects around the bottle: cascading sheets arc smoothly to the left and right of the product, "
        "none of it touching the bottle's surface, the deflection clean and dramatic. "
        "The deflection arcs are made of WATER ONLY, no glow, no aura, no membrane, no field. "
        "The bottle is COMPLETELY MOTIONLESS throughout: no rotation, no drift, no tilt, no wobble. "
        "The camera is COMPLETELY LOCKED: no zoom, no dolly, no pan, no tilt, no drift, no shake. "
        "Aesop-style minimalism. "
        "NEGATIVE: no marble surface, no defined floor, no field, no bubble, no dome, no shield, no halo, no aura, "
        "no glowing substance, no people, no faces, no hair, no hands, no camera movement, no rotation of the bottle."
    ),
    "03-evening-arrival": (
        "A frosted glass bottle of haircare product stands perfectly still in the right portion of frame, "
        "suspended in a soft cream-colored void with NO visible surface, NO floor, NO marble, NO table — "
        "only a soft warm cream tonal background with subtle radial vignette. "
        "Over the duration of the shot, warm golden light slowly sweeps from the right side of frame to the left across the bottle, "
        "like late afternoon sunlight through a window. "
        "The cream void transitions from neutral warm at frame 1 to soft golden-hour warmth by frame N. "
        "As the light sweeps, the bottle's gleam emerges: a soft warm highlight runs along the bottle's curved face, "
        "revealing the gloss and clarity of the frosted glass. "
        "The bottle is COMPLETELY MOTIONLESS throughout: no rotation, no drift, no tilt, no wobble. "
        "The camera is COMPLETELY LOCKED: no zoom, no dolly, no pan, no tilt, no drift, no shake. "
        "Aesop-style minimalism, calm mature mood. "
        "NEGATIVE: no marble surface, no defined floor, no orange tint, no fire, no flames, no refractive distortion, "
        "no field, no halo, no aura, no people, no faces, no hair, no hands, no camera movement, no rotation of the bottle."
    ),
}


def dispatch_one(shot_id: str, prompt: str) -> dict:
    """Submit one Veo 3 job and return {shot_id, url, raw_result}."""
    print(f"[dispatch] submit {shot_id}", flush=True)
    result = submit_image_to_video(
        model_slug=MODEL_SLUG,
        prompt=prompt,
        image_url=SEED_IMAGE,
        duration_s=None,  # Veo uses extra_args
        aspect_ratio="9:16",
        resolution="1080p",
        extra_args={"duration": "6s"},
    )
    url = extract_video_url(result)
    if not url:
        raise RuntimeError(f"{shot_id}: no video URL in result: {list(result.keys()) if isinstance(result, dict) else type(result)}")
    print(f"[dispatch] {shot_id} URL: {url[:80]}", flush=True)
    return {"shot_id": shot_id, "url": url, "result": result}


def main():
    state = read_state(CONCEPT_ID)
    print(f"[state] concept={CONCEPT_ID} state={state['state']}")
    if state["state"] not in ("ALL_PASS", "ASSEMBLED", "REGEN_QUEUED"):
        print(f"WARN: state {state['state']} is unusual for a re-dispatch but proceeding.")

    cdir = concept_dir(CONCEPT_ID)
    clips_dir = cdir / "clips"
    archive_dir = clips_dir / "_v1"
    archive_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: archive existing v1 clips
    for shot_id in PROMPTS.keys():
        src = clips_dir / f"{shot_id}.mp4"
        if src.exists():
            dst = archive_dir / f"{shot_id}.mp4"
            if not dst.exists():
                shutil.copy2(src, dst)
                print(f"[archive] {src.name} -> _v1/")

    # Step 2: mark shots REGEN_QUEUED in state + record v2 prompts
    def mutator_pre(s):
        if s["state"] not in ("REGEN_QUEUED",):
            transition(s, "REGEN_QUEUED", actor="director", reason="user-requested-v2-direction")
        for shot_id, new_prompt in PROMPTS.items():
            shot = next((sh for sh in s["shots"] if sh["shot_id"] == shot_id), None)
            if shot:
                shot.setdefault("history", []).append({
                    "timestamp": utcnow_iso(),
                    "event": "prompt_rewrite_v2",
                    "model_label": MODEL_LABEL,
                    "model_slug": MODEL_SLUG,
                    "old_prompt": shot.get("prompt"),
                    "new_prompt": new_prompt,
                })
                shot["prompt"] = new_prompt
                shot["model_label"] = MODEL_LABEL
                shot["model_slug"] = MODEL_SLUG
                shot["extra_args"] = {"duration": "6s"}
                shot["status"] = "QUEUED"
                shot["attempts"] = (shot.get("attempts", 0)) + 1
        append_event(s, actor="director", event="redispatch_v2", shots=list(PROMPTS.keys()))
        return s

    update_state(CONCEPT_ID, mutator_pre)

    # Step 3: dispatch all 3 in parallel
    print("[dispatch] firing 3 Veo 3 jobs in parallel...")
    results: dict[str, dict] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {ex.submit(dispatch_one, sid, p): sid for sid, p in PROMPTS.items()}
        for f in as_completed(futures):
            sid = futures[f]
            try:
                results[sid] = f.result()
            except Exception as e:
                errors[sid] = str(e)
                print(f"[dispatch] ERROR {sid}: {e}", flush=True)

    if errors:
        print(f"\n[dispatch] {len(errors)} failures, {len(results)} successes")

    # Step 4: download successful URLs to clips/<shot_id>.mp4
    for sid, r in results.items():
        out = clips_dir / f"{sid}.mp4"
        download_video(r["url"], out)
        print(f"[download] {sid} -> {out}")

    # Step 5: update state with cost + status
    def mutator_post(s):
        for sid in results.keys():
            shot = next((sh for sh in s["shots"] if sh["shot_id"] == sid), None)
            if shot:
                shot["status"] = "AUTO_REVIEW"
                shot["fal_url"] = results[sid]["url"]
                shot["downloaded_at"] = utcnow_iso()
                shot.setdefault("history", []).append({
                    "timestamp": utcnow_iso(),
                    "event": "rendered_v2",
                    "model_label": MODEL_LABEL,
                })
        for sid, err in errors.items():
            shot = next((sh for sh in s["shots"] if sh["shot_id"] == sid), None)
            if shot:
                shot["status"] = "ERROR"
                shot.setdefault("history", []).append({
                    "timestamp": utcnow_iso(),
                    "event": "render_error_v2",
                    "error": err,
                })
        s.setdefault("budget", {}).setdefault("by_shot", {})
        for sid in results.keys():
            key = f"{sid}_v2_redispatch"
            s["budget"]["by_shot"][key] = SHOT_COST_USD
        from state import recompute_spent
        recompute_spent(s)
        append_event(s, actor="director", event="redispatch_v2_complete",
                     successes=list(results.keys()), errors=list(errors.keys()))
        return s

    new_state = update_state(CONCEPT_ID, mutator_post)
    print(f"\n[state] spent_usd now ${new_state['budget']['spent_usd']}")
    print(f"[state] clips in {clips_dir}:")
    for f in sorted(clips_dir.glob("*.mp4")):
        print(f"   {f.name}  ({f.stat().st_size/1024/1024:.2f} MB)")

    if errors:
        print(f"\nFINAL: {len(results)} succeeded, {len(errors)} failed")
        sys.exit(1)
    print("\n[done] All 3 v2 clips downloaded; status=AUTO_REVIEW")


if __name__ == "__main__":
    main()
