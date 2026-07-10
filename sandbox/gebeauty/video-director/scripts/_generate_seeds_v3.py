"""Generate v3 seed images for primer-cachos-definidos-v1.

v3 direction (2026-06-08): grounded slice-of-life environments instead of
abstract cream void. Each shot has its own real-world setting:
  - Shot 1: home bathroom counter (audio-only dryer)
  - Shot 2: cafe table by a window with urban rain behind
  - Shot 3: entryway console at home with keys/handbag implied

Uses fal-ai/nano-banana/edit to place the existing GE Beauty bottle product
photo into each environment while preserving product accuracy.

Outputs URLs (for direct Veo 3 consumption) AND local PNGs under
state/<concept>/seeds/v3/ for inspection.
"""

from __future__ import annotations
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from fal_wrapper import download_video  # reuse downloader (works for any URL)
import fal_client  # noqa: E402
from state import (  # noqa: E402
    concept_dir,
    read_state,
    update_state,
    append_event,
    utcnow_iso,
)

CONCEPT_ID = "primer-cachos-definidos-v1"
MODEL_SLUG = "fal-ai/nano-banana/edit"
SEED_COST_USD = 0.039

# The current v1/v2 seed (freepik whitelight reframe of the actual bottle).
SOURCE_BOTTLE_IMAGE = (
    "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/"
    "freepik__reframe-the-image-to-br-maintain-the-whitelight-gr__63444.png"
)

EDIT_PROMPTS = {
    "01-morning-styling": (
        "Place this haircare bottle on a clean modern bathroom counter, "
        "soft cream-colored marble surface, in a warm minimal Brazilian bathroom. "
        "Soft cool morning light from the upper-left through a window. "
        "Light wood, white subway tile, a subtle hint of steam at the very edge of frame. "
        "The bottle is the focal subject, perfectly upright, centered in the right portion of frame. "
        "Aesop-style minimalism, calm, mature. "
        "NO people, NO faces, NO hair, NO hands, NO blow dryer visible. "
        "Preserve the exact appearance, label, and proportions of the bottle. 9:16 portrait composition."
    ),
    "02-afternoon-rain": (
        "Place this haircare bottle on a small dark wood cafe table positioned directly in front of a tall window. "
        "Behind the window, heavy urban rain streams down the glass in clear streaks, blurred wet city in the background, "
        "soft warm interior cafe lighting mixed with cool grey daylight from outside. "
        "The bottle is centered on the table, perfectly upright. "
        "Aesop-style minimalism, cinematic, cozy. "
        "NO people, NO faces, NO hair, NO hands, NO cups or food. "
        "Preserve the exact appearance, label, and proportions of the bottle. 9:16 portrait composition."
    ),
    "03-evening-arrival": (
        "Place this haircare bottle on an entryway console table in a modern Brazilian home foyer. "
        "Soft warm golden afternoon light spills in from a doorway just out of frame to the right. "
        "Beside the bottle on the console: a small folded handbag, a set of keys, a folded envelope, "
        "implying someone has just arrived home. The bottle is the focal subject, "
        "perfectly upright, centered in the right portion of frame. "
        "Aesop-style minimalism, warm, inviting. "
        "NO people, NO faces, NO hair, NO hands. "
        "Preserve the exact appearance, label, and proportions of the bottle. 9:16 portrait composition."
    ),
}


def generate_one_seed(shot_id: str, prompt: str) -> dict:
    """Send one image-edit request to nano-banana, return {shot_id, url, result}."""
    print(f"[seed] submit {shot_id}", flush=True)
    result = fal_client.subscribe(
        MODEL_SLUG,
        arguments={
            "prompt": prompt,
            "image_urls": [SOURCE_BOTTLE_IMAGE],
            "num_images": 1,
            "output_format": "png",
        },
        with_logs=False,
    )
    # nano-banana returns {'images': [{'url': '...'}], ...}
    url = None
    if isinstance(result, dict):
        images = result.get("images") or []
        if images and isinstance(images[0], dict):
            url = images[0].get("url")
        if not url:
            url = result.get("url")
    if not url:
        raise RuntimeError(f"{shot_id}: no image URL in result: {result}")
    print(f"[seed] {shot_id} URL: {url[:80]}", flush=True)
    return {"shot_id": shot_id, "url": url, "result": result}


def main():
    state = read_state(CONCEPT_ID)
    cdir = concept_dir(CONCEPT_ID)
    seeds_dir = cdir / "seeds" / "v3"
    seeds_dir.mkdir(parents=True, exist_ok=True)

    print(f"[seeds] firing 3 nano-banana image-edits in parallel...")
    results: dict[str, dict] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {ex.submit(generate_one_seed, sid, p): sid for sid, p in EDIT_PROMPTS.items()}
        for f in as_completed(futures):
            sid = futures[f]
            try:
                results[sid] = f.result()
            except Exception as e:
                errors[sid] = str(e)
                print(f"[seed] ERROR {sid}: {e}", flush=True)

    # Download seed images locally for inspection
    for sid, r in results.items():
        out = seeds_dir / f"{sid}.png"
        download_video(r["url"], out)
        print(f"[seed] saved {sid} -> {out}")

    # Persist URLs in state
    def m(s):
        s.setdefault("seeds_v3", {})
        for sid, r in results.items():
            s["seeds_v3"][sid] = {
                "url": r["url"],
                "local_path": str((seeds_dir / f"{sid}.png").relative_to(cdir).as_posix()),
                "edit_prompt": EDIT_PROMPTS[sid],
                "model_slug": MODEL_SLUG,
                "generated_at": utcnow_iso(),
            }
        s.setdefault("budget", {}).setdefault("by_shot", {})
        s["budget"]["by_shot"]["seeds_v3"] = round(len(results) * SEED_COST_USD, 4)
        from state import recompute_spent
        recompute_spent(s)
        append_event(s, actor="director", event="seeds_v3_generated",
                     shots=list(results.keys()), errors=list(errors.keys()))
        return s

    new_state = update_state(CONCEPT_ID, m)
    print(f"\n[state] spent_usd now ${new_state['budget']['spent_usd']}")

    if errors:
        print(f"\n{len(errors)} seed failures: {errors}")
        sys.exit(1)
    print(f"\n[done] {len(results)} seeds ready for review at {seeds_dir}")


if __name__ == "__main__":
    main()
