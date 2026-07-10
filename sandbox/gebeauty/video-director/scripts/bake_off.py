"""Run the same heat-deflection prompt across N fal.ai video models in parallel,
download all results to the bakeoff folder. For Phase 2 model comparison.
"""

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fal_wrapper import submit_image_to_video, extract_video_url, download_video


# The pure deflection-via-absence prompt (witness props cut per Lucas).
PROMPT = """The product remains perfectly static in the center of frame on a warm cream-colored surface, never moving, never rotating. Entering from the right edge of frame, the nozzle of a matte chrome professional hair dryer is partially visible, pointed horizontally at the product from about 20 centimeters away, on at full blast. Throughout the entire shot, the product stays completely undisturbed, sharp, evenly lit, perfectly still. The bottle never moves, never tilts, never wavers, never gets warm or discolored. The cream surface immediately around the product is also perfectly still. It is as if the airflow from the dryer simply does not reach the bottle. Camera is static, eye-level, slight forward dolly of about 5 percent over the duration. Lighting stays warm-cream throughout, neutral, never shifts. Calm, mature, Aesop-style minimalism. NO flames, NO fire, NO orange glow, NO red light, NO smoke, NO water, NO liquid, NO mist, NO fog, NO visible haze, NO colored air, NO glowing field, NO transparent dome, NO bubble, NO glass sphere, NO shield, NO halo, NO aura, NO visible barrier of any kind. No people, no hair, no hands, no logos other than what is already on the product."""

# primer cachos definidos featuredMedia (Shopify CDN)
SEED = "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/freepik__reframe-the-image-to-br-maintain-the-whitelight-gr__63444.png"

OUT_DIR = Path("inputs/video-prototypes/primers-resistance/bakeoff")

# (label, slug, extra_args)
# extra_args lets us pass model-specific params (some models reject duration/aspect/etc).
MODELS = [
    ("kling-2.5-pro", "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", {}),
    # Veo 3 wants '4s'/'6s'/'8s' for duration
    ("veo-3",          "fal-ai/veo3/image-to-video",                       {"duration": "6s"}),
    # Hailuo wants duration '6' or '10', resolution '512P' or '768P'
    ("hailuo-02",      "fal-ai/minimax/hailuo-02/standard/image-to-video", {"duration": "6", "resolution": "768P"}),
]


def run_one(label: str, slug: str, extra: dict) -> tuple[str, str, Path | None, str | None]:
    """Run a single model. Returns (label, slug, mp4_path_or_None, error_or_None)."""
    out_path = OUT_DIR / f"{label}_heat-deflection.mp4"
    try:
        result = submit_image_to_video(
            model_slug=slug,
            prompt=PROMPT,
            image_url=SEED,
            duration_s=5,
            aspect_ratio="9:16",
            resolution="1080p",
            extra_args=extra,
        )
        url = extract_video_url(result)
        if not url:
            return (label, slug, None, f"no video URL in result keys: {list(result.keys()) if isinstance(result, dict) else type(result)}")
        download_video(url, out_path)
        return (label, slug, out_path, None)
    except Exception as e:
        return (label, slug, None, f"{type(e).__name__}: {str(e)[:300]}")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[bake-off] running {len(MODELS)} models in parallel...")
    t0 = time.time()

    results = []
    with ThreadPoolExecutor(max_workers=len(MODELS)) as ex:
        futures = {ex.submit(run_one, *m): m[0] for m in MODELS}
        for fut in as_completed(futures):
            label, slug, mp4, err = fut.result()
            results.append((label, slug, mp4, err))
            if err:
                print(f"[bake-off] {label}: FAILED -- {err}")
            else:
                print(f"[bake-off] {label}: OK -> {mp4}")

    elapsed = time.time() - t0
    print(f"\n[bake-off] all done in {elapsed:.1f}s")
    print("\n=== SUMMARY ===")
    for label, slug, mp4, err in results:
        status = "OK" if mp4 else "FAIL"
        detail = str(mp4) if mp4 else err
        print(f"  {status:5} {label:20} {detail}")


if __name__ == "__main__":
    main()
