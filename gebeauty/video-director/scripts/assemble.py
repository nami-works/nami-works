"""scripts/assemble.py — Phase 6 ffmpeg assembler.

Takes a concept at ALL_PASS, concatenates its rendered shots in narrative_arc
order, 9:16-conforms each, burns captions, appends a closing card with the
locked tagline + logo, and writes the ship-ready creative.mp4 + thumbnail +
captions.srt to state/<concept>/output/<variant>/.

CLI:
    python gebeauty/video-director/scripts/assemble.py \\
        --concept-id primer-cachos-definidos-v1 \\
        [--variant base|variant-a|variant-b] \\
        [--no-audio]                     # build the silent pass

State transition: ALL_PASS ->ASSEMBLED on first successful base build.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

import imageio_ffmpeg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from state import (
    concept_dir,
    read_state,
    update_state,
    transition,
    append_event,
    utcnow_iso,
)

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# Path index relative to this script
SCRIPT_DIR = Path(__file__).resolve().parent
GEBEAUTY_DIR = SCRIPT_DIR.parents[1]  # …/gebeauty
BRAND_ASSETS = GEBEAUTY_DIR / ".brand-assets"
LOGO = BRAND_ASSETS / "Logo" / "ge_beauty_logo-01.png"
FONT_DIR = BRAND_ASSETS / "fonts" / "fonts"  # zip nested an extra fonts/
FONT_TAGLINE = FONT_DIR / "Italian Plate No2 Expanded Extrabold.ttf"
FONT_OFFER = FONT_DIR / "Italian Plate No2 Expanded Bold.ttf"
FONT_HOOK = FONT_DIR / "Italian Plate No2 Expanded Extrabold.ttf"

# Output spec (Meta Reels 9:16)
TARGET_W = 1080
TARGET_H = 1920
TARGET_FPS = 24
AUDIO_SR = 48000
CLOSING_CARD_S = 2.5
CROSSFADE_S = 0.6  # overlap between consecutive segments
ZOOM_END_SCALE = 1.06  # final zoom factor at end of sequence (6% in)

# Captions
HOOK_START = 0.5  # into shot 01 (kept for SRT, NOT burned into video)
HOOK_END = 2.5

# Palette (locked)
CREAM = "#f8f7f3"
CORAL = "#df3630"
INK = "#1a1a1a"

# Variant directions (concept-specific overrides may live in state later)
VARIANTS = {
    "base": {
        "label": "base — narrative order",
        "shot_order": "narrative_arc",  # follow position field
        "copy_key": "ad_copy",
    },
    "variant-a": {
        "label": "variant A — reverse-teaser arc",
        # primer-cachos-specific: 03 ->01 ->02
        "shot_order_explicit": ["03-evening-arrival", "01-morning-styling", "02-afternoon-rain"],
        "copy_key": "ad_copy",
    },
    "variant-b": {
        "label": "variant B — alternative copy angle",
        "shot_order": "narrative_arc",
        "copy_key": "ad_copy_variant_b",
    },
}


# ──────────────────────────────────────────────────────────────────────────────
# ffmpeg helpers
# ──────────────────────────────────────────────────────────────────────────────


def _esc_path(p: Path) -> str:
    """Escape a Windows path for use INSIDE an ffmpeg filter (drawtext fontfile etc)."""
    return str(p).replace("\\", "/").replace(":", r"\:")


def _esc_drawtext(text: str) -> str:
    """Escape user text for drawtext's text= field (single-quoted)."""
    # Backslash-escape: backslash, single quote, percent, colon
    return (
        text.replace("\\", r"\\")
            .replace(":", r"\:")
            .replace("'", r"\'")
            .replace("%", r"\%")
    )


def probe_clip(clip_path: Path) -> dict:
    """Probe via ffmpeg -i (no separate ffprobe in imageio-ffmpeg).

    Returns {'width': int, 'height': int, 'duration': float, 'has_audio': bool}.
    """
    out = subprocess.run(
        [FFMPEG, "-i", str(clip_path), "-hide_banner"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    stderr = out.stderr or ""
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", stderr)
    if not m:
        raise RuntimeError(f"could not parse duration from {clip_path}\n{stderr[-500:]}")
    duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    mv = re.search(r"Stream #\d+:\d+[^\n]*Video: \S+[^\n]*?,\s*\S+[^\n]*?,\s*(\d+)x(\d+)", stderr)
    if not mv:
        # Try a simpler pattern
        mv = re.search(r"Video:.*?(\d{3,5})x(\d{3,5})", stderr)
    if not mv:
        raise RuntimeError(f"could not parse video dimensions from {clip_path}\n{stderr[-500:]}")
    width, height = int(mv.group(1)), int(mv.group(2))
    has_audio = "Audio:" in stderr
    return {"width": width, "height": height, "duration": duration, "has_audio": has_audio}


def run_ffmpeg(cmd: list[str], step: str) -> None:
    """Run ffmpeg, surface stderr tail on failure."""
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        tail = (res.stderr or "")[-1500:]
        raise RuntimeError(f"ffmpeg failed at step '{step}' (exit {res.returncode})\n{tail}")


# ──────────────────────────────────────────────────────────────────────────────
# Per-shot conform + caption burn
# ──────────────────────────────────────────────────────────────────────────────


def conform_shot(
    in_path: Path,
    out_path: Path,
    src_has_audio: bool,
    hook_text: Optional[str] = None,
    hook_start: float = HOOK_START,
    hook_end: float = HOOK_END,
    audio_overlay: Optional[Path] = None,
) -> None:
    """9:16-conform a single rendered shot, optionally burning a hook caption.

    audio_overlay: if provided, mixes this audio file IN ADDITION to any video audio.
    Silent shots get audio_overlay as primary track.
    """
    # Video filter chain: scale shorter side to fit, center-crop to 1080x1920
    vf = [
        f"scale=w='if(gt(a,{TARGET_W}/{TARGET_H}),-2,{TARGET_W})':h='if(gt(a,{TARGET_W}/{TARGET_H}),{TARGET_H},-2)'",
        f"crop={TARGET_W}:{TARGET_H}",
        "setsar=1",
        f"fps={TARGET_FPS}",
    ]
    if hook_text:
        vf.append(
            f"drawtext=fontfile='{_esc_path(FONT_HOOK)}'"
            f":text='{_esc_drawtext(hook_text)}'"
            f":fontsize=120:fontcolor={INK}"
            f":x=(w-text_w)/2:y=h*0.78"
            f":box=1:boxcolor={CREAM}@0.85:boxborderw=28"
            f":enable='between(t,{hook_start},{hook_end})'"
        )
    vf_str = ",".join(vf)

    cmd = [FFMPEG, "-y", "-i", str(in_path)]
    audio_filter_complex = None

    if audio_overlay is not None and audio_overlay.exists():
        cmd += ["-i", str(audio_overlay)]
        if src_has_audio:
            # Mix video's audio (e.g. Veo native) with overlay at -6dB
            audio_filter_complex = (
                "[0:a]volume=1.0[a0];"
                "[1:a]volume=0.35[a1];"
                "[a0][a1]amix=inputs=2:duration=first:dropout_transition=0,aresample=async=1[aout]"
            )
        else:
            # Use overlay as primary
            audio_filter_complex = "[1:a]aresample=async=1[aout]"
    elif src_has_audio:
        # Keep video's existing audio
        audio_filter_complex = "[0:a]aresample=async=1[aout]"
    else:
        # Generate silent audio matched to video duration
        cmd += [
            "-f", "lavfi",
            "-t", "20",  # we cap via -shortest below
            "-i", f"anullsrc=channel_layout=stereo:sample_rate={AUDIO_SR}",
        ]
        audio_filter_complex = "[1:a]anull[aout]"

    cmd += [
        "-filter_complex", f"[0:v]{vf_str}[vout];{audio_filter_complex}",
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-ar", str(AUDIO_SR),
        "-shortest",
        str(out_path),
    ]
    run_ffmpeg(cmd, f"conform_shot({in_path.name})")


# ──────────────────────────────────────────────────────────────────────────────
# Closing card
# ──────────────────────────────────────────────────────────────────────────────


def make_closing_card(out_path: Path, tagline: str, offer: str) -> None:
    """Generate a 1080×1920 closing card.

    Layout (top → bottom):
      - Logo (360 px wide) at y=22%
      - Offer caption (single line, ink color) at y=46%
      - Tagline split into 2 lines (coral) at y=58% and y=66%

    The tagline is auto-split at the comma if present; the split keeps the comma on
    line 1. Line 2 holds the rest. If no comma, the full tagline goes on a single
    line at y=62% (legacy positioning).
    """
    logo_w = 360
    bg_input = f"color={CREAM}:size={TARGET_W}x{TARGET_H}:rate={TARGET_FPS}:duration={CLOSING_CARD_S}"
    cmd = [
        FFMPEG, "-y",
        "-f", "lavfi", "-i", bg_input,
        "-loop", "1", "-i", str(LOGO),
        "-f", "lavfi", "-t", str(CLOSING_CARD_S),
        "-i", f"anullsrc=channel_layout=stereo:sample_rate={AUDIO_SR}",
    ]

    # Build filter chain
    chain_parts = [
        f"[1:v]scale={logo_w}:-1[logo]",
        f"[0:v][logo]overlay=x=(W-w)/2:y=H*0.22[bg1]",
        (
            f"[bg1]drawtext=fontfile='{_esc_path(FONT_OFFER)}'"
            f":text='{_esc_drawtext(offer)}'"
            f":fontsize=92:fontcolor={INK}"
            f":x=(w-text_w)/2:y=h*0.46[bg2]"
        ),
    ]

    if "," in tagline:
        before, after = tagline.split(",", 1)
        line1 = (before + ",").strip()
        line2 = after.strip()
        chain_parts.append(
            f"[bg2]drawtext=fontfile='{_esc_path(FONT_TAGLINE)}'"
            f":text='{_esc_drawtext(line1)}'"
            f":fontsize=104:fontcolor={CORAL}"
            f":x=(w-text_w)/2:y=h*0.58[bg3]"
        )
        chain_parts.append(
            f"[bg3]drawtext=fontfile='{_esc_path(FONT_TAGLINE)}'"
            f":text='{_esc_drawtext(line2)}'"
            f":fontsize=104:fontcolor={CORAL}"
            f":x=(w-text_w)/2:y=h*0.66[vout]"
        )
    else:
        chain_parts.append(
            f"[bg2]drawtext=fontfile='{_esc_path(FONT_TAGLINE)}'"
            f":text='{_esc_drawtext(tagline)}'"
            f":fontsize=104:fontcolor={CORAL}"
            f":x=(w-text_w)/2:y=h*0.62[vout]"
        )

    fc = ";".join(chain_parts)
    cmd += [
        "-filter_complex", fc,
        "-map", "[vout]", "-map", "2:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-ar", str(AUDIO_SR),
        "-t", str(CLOSING_CARD_S),
        str(out_path),
    ]
    run_ffmpeg(cmd, "make_closing_card")


# ──────────────────────────────────────────────────────────────────────────────
# Concat
# ──────────────────────────────────────────────────────────────────────────────


def concat_with_crossfade(
    segments: list[Path],
    durations: list[float],
    out_path: Path,
    crossfade_s: float = CROSSFADE_S,
) -> float:
    """Concat segments with xfade video + acrossfade audio between consecutive cuts.

    Returns total duration of the output (segment durations summed minus crossfade overlaps).
    All segments must be pre-conformed to identical W×H/fps/sample-rate.
    """
    if len(segments) < 2:
        raise ValueError("need at least 2 segments to crossfade")
    if len(durations) != len(segments):
        raise ValueError("durations must align with segments")

    # Build the input list
    cmd = [FFMPEG, "-y"]
    for seg in segments:
        cmd += ["-i", str(seg)]

    # Build the xfade chain
    # offset_n = sum of durations[0..n-1] minus (n-1) * crossfade_s
    chain_v = []
    chain_a = []
    last_v_label = "[0:v]"
    last_a_label = "[0:a]"
    for i in range(1, len(segments)):
        offset = sum(durations[:i]) - (i - 1) * crossfade_s - crossfade_s
        next_v_in = f"[{i}:v]"
        next_a_in = f"[{i}:a]"
        out_v_label = f"[xv{i}]" if i < len(segments) - 1 else "[outv]"
        out_a_label = f"[xa{i}]" if i < len(segments) - 1 else "[outa]"
        chain_v.append(
            f"{last_v_label}{next_v_in}xfade=transition=fade:duration={crossfade_s}:offset={offset:.3f}{out_v_label}"
        )
        chain_a.append(
            f"{last_a_label}{next_a_in}acrossfade=d={crossfade_s}{out_a_label}"
        )
        last_v_label = out_v_label
        last_a_label = out_a_label

    fc = ";".join(chain_v + chain_a)
    cmd += [
        "-filter_complex", fc,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-ar", str(AUDIO_SR),
        str(out_path),
    ]
    run_ffmpeg(cmd, "concat_with_crossfade")
    return sum(durations) - (len(segments) - 1) * crossfade_s


def apply_continuous_zoom(in_path: Path, out_path: Path, total_duration: float, end_scale: float = ZOOM_END_SCALE) -> None:
    """Apply a smooth continuous zoom-in across the full video length.

    Uses scale + crop with time-varying expression: scale grows linearly from 1.0 → end_scale,
    centered crop keeps output at TARGET_W × TARGET_H. Audio passes through unchanged.
    """
    # Time-varying scale: factor(t) = 1 + (end_scale-1) * t/total
    # We scale the source UP by factor(t) then crop center back to TARGET_W × TARGET_H.
    # ffmpeg's `scale` with `eval=frame` lets the expression evaluate per frame.
    delta = end_scale - 1.0
    # Pre-compute total*1000 in expression to keep float precision
    sw_expr = f"'{TARGET_W}*(1+{delta:.4f}*t/{total_duration:.3f})'"
    sh_expr = f"'{TARGET_H}*(1+{delta:.4f}*t/{total_duration:.3f})'"
    vf = (
        f"scale=w={sw_expr}:h={sh_expr}:eval=frame,"
        f"crop={TARGET_W}:{TARGET_H}:(in_w-{TARGET_W})/2:(in_h-{TARGET_H})/2"
    )
    cmd = [
        FFMPEG, "-y", "-i", str(in_path),
        "-vf", vf,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
        "-c:a", "copy",
        str(out_path),
    ]
    run_ffmpeg(cmd, "apply_continuous_zoom")


# ──────────────────────────────────────────────────────────────────────────────
# Thumbnail
# ──────────────────────────────────────────────────────────────────────────────


def make_thumbnail(in_path: Path, out_path: Path, at_seconds: float = 0.5) -> None:
    """Extract a JPG thumbnail from a position into the source video."""
    cmd = [
        FFMPEG, "-y", "-ss", str(at_seconds), "-i", str(in_path),
        "-frames:v", "1", "-q:v", "2",
        str(out_path),
    ]
    run_ffmpeg(cmd, "make_thumbnail")


# ──────────────────────────────────────────────────────────────────────────────
# Captions sidecar (SRT)
# ──────────────────────────────────────────────────────────────────────────────


def _srt_ts(t: float) -> str:
    hh = int(t // 3600)
    mm = int((t % 3600) // 60)
    ss = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    return f"{hh:02d}:{mm:02d}:{ss:02d},{ms:03d}"


def write_srt(out_path: Path, cues: list[tuple[float, float, str]]) -> None:
    lines = []
    for i, (start, end, text) in enumerate(cues, start=1):
        lines.append(str(i))
        lines.append(f"{_srt_ts(start)} --> {_srt_ts(end)}")
        lines.append(text)
        lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")


# ──────────────────────────────────────────────────────────────────────────────
# Orchestration
# ──────────────────────────────────────────────────────────────────────────────


def resolve_shot_order(state: dict, variant: str) -> list[str]:
    spec = VARIANTS[variant]
    if "shot_order_explicit" in spec:
        return list(spec["shot_order_explicit"])
    arc = state.get("narrative_arc", [])
    ordered = sorted(arc, key=lambda a: a.get("position", 0))
    return [a["shot_id"] for a in ordered]


def resolve_ad_copy(state: dict, variant: str) -> dict:
    spec = VARIANTS[variant]
    key = spec["copy_key"]
    copy = state.get(key)
    if not copy:
        # variant B falls back to base copy if no variant_b is defined yet
        copy = state.get("ad_copy", {})
    return copy


def find_audio_overlay(audio_dir: Path, shot_id: str) -> Optional[Path]:
    """Look for an audio file named after the shot in state/<concept>/audio/."""
    if not audio_dir.exists():
        return None
    for ext in (".mp3", ".m4a", ".wav", ".ogg"):
        candidate = audio_dir / f"{shot_id}{ext}"
        if candidate.exists():
            return candidate
    return None


def assemble(concept_id: str, variant: str = "base", no_audio: bool = False, force: bool = False) -> Path:
    state = read_state(concept_id)
    if state["state"] not in ("ALL_PASS", "ASSEMBLED", "DELIVERED"):
        if force:
            print(f"[assemble] WARNING --force: state is {state['state']}, normally need ALL_PASS")
        else:
            raise RuntimeError(
                f"concept {concept_id} is in state {state['state']}; need ALL_PASS or later (use --force to override)"
            )

    cdir = concept_dir(concept_id)
    clips_dir = cdir / "clips"
    audio_dir = cdir / "audio"
    output_dir = cdir / "output" / variant
    output_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = cdir / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    spec = VARIANTS[variant]
    shot_order = resolve_shot_order(state, variant)
    ad_copy = resolve_ad_copy(state, variant)

    print(f"[assemble] concept={concept_id} variant={variant}")
    print(f"[assemble] shot order: {shot_order}")
    print(f"[assemble] audio: {'disabled' if no_audio else 'enabled'}")

    # Per-shot conform (NO hook caption burn — blow-dryer audio is the hook per Lucas's verdict)
    conformed: list[Path] = []
    durations: list[float] = []
    shot_positions: list[dict] = []  # {shot_id, start_s, duration_s, caption_hook (SRT only)}
    cumulative = 0.0
    for idx, shot_id in enumerate(shot_order):
        clip = clips_dir / f"{shot_id}.mp4"
        if not clip.exists():
            raise FileNotFoundError(f"missing clip for {shot_id}: {clip}")

        probe = probe_clip(clip)
        shot_state = next((s for s in state["shots"] if s["shot_id"] == shot_id), {})
        srt_hook_text = shot_state.get("caption_hook") if idx == 0 else None  # SRT only, never burned

        audio_overlay = None if no_audio else find_audio_overlay(audio_dir, shot_id)

        out = tmp_dir / f"{variant}_conform_{idx:02d}_{shot_id}.mp4"
        conform_shot(
            in_path=clip,
            out_path=out,
            src_has_audio=probe["has_audio"] and not no_audio,
            hook_text=None,  # NEVER burn into video
            audio_overlay=audio_overlay,
        )
        conformed.append(out)
        durations.append(probe["duration"])
        shot_positions.append({
            "shot_id": shot_id,
            "start_s": cumulative,
            "duration_s": probe["duration"],
            "caption_hook": srt_hook_text,
        })
        cumulative += probe["duration"]
        print(f"  [ok] shot {idx+1}/{len(shot_order)} conformed: {shot_id} ({probe['duration']:.2f}s, audio={probe['has_audio']})")

    # Closing card (2.5s, line-broken tagline)
    closing = tmp_dir / f"{variant}_closing.mp4"
    tagline = ad_copy.get("caption_tagline", "no seu tempo, do seu jeito.")
    offer = ad_copy.get("caption_offer", "")
    make_closing_card(closing, tagline=tagline, offer=offer)
    conformed.append(closing)
    durations.append(CLOSING_CARD_S)
    print(f"  [ok] closing card built ({CLOSING_CARD_S:.1f}s)")

    # Crossfade-concat (3 shots + closing → single sequence with smooth transitions)
    intermediate = tmp_dir / f"{variant}_concat.mp4"
    total_duration = concat_with_crossfade(conformed, durations, intermediate, crossfade_s=CROSSFADE_S)
    print(f"  [ok] crossfaded sequence: {total_duration:.2f}s")

    # Continuous zoom-in across the full sequence
    creative = output_dir / "creative.mp4"
    apply_continuous_zoom(intermediate, creative, total_duration, end_scale=ZOOM_END_SCALE)
    print(f"  [ok] continuous zoom applied -> {creative}")

    # closing_start in the post-crossfade timeline: total - closing_card duration (the closing starts after the last crossfade overlap)
    closing_start = total_duration - CLOSING_CARD_S

    # Thumbnail
    thumb = output_dir / "thumbnail.jpg"
    make_thumbnail(creative, thumb, at_seconds=0.6)
    print(f"  [ok]thumbnail ->{thumb}")

    # Captions sidecar
    srt = output_dir / "captions.srt"
    cues: list[tuple[float, float, str]] = []
    if shot_positions and shot_positions[0]["caption_hook"]:
        sp = shot_positions[0]
        cues.append((sp["start_s"] + HOOK_START, sp["start_s"] + HOOK_END, sp["caption_hook"]))
    if offer:
        cues.append((closing_start + 0.0, closing_start + CLOSING_CARD_S, offer))
    if tagline:
        cues.append((closing_start + 0.0, closing_start + CLOSING_CARD_S, tagline))
    write_srt(srt, cues)
    print(f"  [ok]captions.srt ->{srt}")

    # Copy.txt for Meta Ads Manager paste-buffer
    copy_path = output_dir / "copy.txt"
    copy_lines = [
        f"primary_text:    {ad_copy.get('primary_text', '')}",
        f"headline:        {ad_copy.get('headline', '')}",
        f"link_description: {ad_copy.get('link_description', '')}",
        f"cta_button:      {ad_copy.get('cta_button', '')}",
        "",
        f"caption_hook:    {shot_positions[0]['caption_hook'] if shot_positions and shot_positions[0]['caption_hook'] else ''}",
        f"caption_offer:   {offer}",
        f"caption_tagline: {tagline}",
    ]
    copy_path.write_text("\n".join(copy_lines), encoding="utf-8")
    print(f"  [ok]copy.txt ->{copy_path}")

    # State transition for the base variant (variants don't downgrade state)
    def _persist_assembly(s):
        s.setdefault("assembly", {})
        s["assembly"][variant] = {
            "creative_path": str(creative.relative_to(cdir).as_posix()),
            "thumbnail_path": str(thumb.relative_to(cdir).as_posix()),
            "captions_path": str(srt.relative_to(cdir).as_posix()),
            "copy_path": str(copy_path.relative_to(cdir).as_posix()),
            "duration_s": round(total_duration, 2),
            "shots_in_order": shot_order,
            "audio_enabled": not no_audio,
            "crossfade_s": CROSSFADE_S,
            "zoom_end_scale": ZOOM_END_SCALE,
            "assembled_at": utcnow_iso(),
        }
        if variant == "base" and s["state"] == "ALL_PASS":
            transition(s, "ASSEMBLED", actor="assembler", variant=variant)
        else:
            append_event(s, actor="assembler", event="assembled", variant=variant)
        return s

    update_state(concept_id, _persist_assembly)

    return creative


def main():
    parser = argparse.ArgumentParser(description="Assemble a video-director concept into ship-ready Meta packages.")
    parser.add_argument("--concept-id", required=True)
    parser.add_argument("--variant", default="base", choices=list(VARIANTS.keys()))
    parser.add_argument("--no-audio", action="store_true", help="Build silent pass (skip audio overlays)")
    parser.add_argument("--clean-tmp", action="store_true", help="Remove _tmp/ after a successful build")
    parser.add_argument("--force", action="store_true", help="Bypass state guard (dev testing only)")
    args = parser.parse_args()

    # Pre-flight asset checks
    for p in (FONT_TAGLINE, FONT_OFFER, LOGO):
        if not p.exists():
            print(f"[assemble] FAIL: required asset missing: {p}", file=sys.stderr)
            sys.exit(2)

    creative = assemble(args.concept_id, variant=args.variant, no_audio=args.no_audio, force=args.force)
    print(f"\n[assemble] DONE ->{creative}")
    print(f"[assemble] state.assembly.{args.variant} recorded")

    if args.clean_tmp:
        tmp = concept_dir(args.concept_id) / "_tmp"
        if tmp.exists():
            shutil.rmtree(tmp)
            print(f"[assemble] cleaned {tmp}")


if __name__ == "__main__":
    main()
