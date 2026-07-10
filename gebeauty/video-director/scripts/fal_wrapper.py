"""Thin wrapper around fal.ai client SDK for image-to-video generation.

Loaded by Phase 2 bake-off and (eventually) the /video-director skill.
"""

import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# GE Beauty workspace canonical creds location (per sandbox/gebeauty/CLAUDE.md).
# Load BEFORE importing fal_client so the SDK sees FAL_KEY at module init.
_GEBEAUTY_ENV = Path(__file__).resolve().parents[2] / ".env"
if _GEBEAUTY_ENV.exists():
    load_dotenv(_GEBEAUTY_ENV)
load_dotenv()  # fall through to repo-root .env if present

import fal_client  # noqa: E402  (must come after load_dotenv)


def submit_image_to_video(
    model_slug: str,
    prompt: str,
    image_url: str,
    duration_s: int = 5,
    aspect_ratio: str = "9:16",
    resolution: str = "1080p",
    seed: Optional[int] = None,
    extra_args: Optional[dict] = None,
) -> dict:
    """Submit an image-to-video job to fal.ai and block until complete.

    Returns the full result dict. Different models return different shapes
    (some have result["video"]["url"], some have result["url"], etc.).
    Caller should extract the URL based on the model.
    """
    arguments = {
        "prompt": prompt,
        "image_url": image_url,
    }
    # Most fal models accept these; some won't and will be silently ignored.
    if duration_s:
        arguments["duration"] = str(duration_s)
    if aspect_ratio:
        arguments["aspect_ratio"] = aspect_ratio
    if resolution:
        arguments["resolution"] = resolution
    if seed is not None:
        arguments["seed"] = seed
    if extra_args:
        arguments.update(extra_args)

    print(f"[fal] submit {model_slug}", flush=True)
    print(f"[fal]   prompt: {len(prompt)} chars", flush=True)
    print(f"[fal]   image:  {image_url[:90]}", flush=True)
    print(f"[fal]   args:   duration={duration_s}s aspect={aspect_ratio} res={resolution}", flush=True)

    t0 = time.time()

    def _on_update(update):
        kind = type(update).__name__
        logs_attr = getattr(update, "logs", None)
        if logs_attr:
            for log in logs_attr:
                msg = log.get("message", "") if isinstance(log, dict) else str(log)
                print(f"[fal:{model_slug}] {kind}: {msg}", flush=True)

    result = fal_client.subscribe(
        model_slug,
        arguments=arguments,
        with_logs=True,
        on_queue_update=_on_update,
    )

    elapsed = time.time() - t0
    print(f"[fal] done {model_slug} in {elapsed:.1f}s", flush=True)
    return result


def extract_video_url(result: dict) -> Optional[str]:
    """Try the common shapes for the output URL field."""
    if isinstance(result, dict):
        if "video" in result and isinstance(result["video"], dict):
            return result["video"].get("url")
        if "url" in result:
            return result["url"]
        if "output" in result and isinstance(result["output"], dict):
            return result["output"].get("url")
    return None


def download_video(url: str, out_path: Path) -> Path:
    """Download a video URL to a local path."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"[fal] download -> {out_path}", flush=True)
    urllib.request.urlretrieve(url, out_path)
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"[fal] downloaded {size_mb:.1f} MB", flush=True)
    return out_path
