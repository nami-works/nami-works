"""scripts/download.py — generic URL downloader with version archival.

Used after compose (download stills to seeds/v<N>/) and after dispatch
(download motion clips to clips/, archive prior version).

CLI:
    python download.py stills --concept-id <id> --version v9 \\
        --map "01-bathroom_A=https://..." --map "01-bathroom_B=https://..."

    python download.py clips --concept-id <id> --version v9 \\
        --map "01-morning-styling=https://..." --map "02-afternoon-rain=https://..."

The `clips` mode also archives any existing canonical clip to
clips/_<prev-version>/ before overwriting clips/<shot_id>.mp4.

Version naming:
    --version v9    -> seeds saved under seeds/v9/, prior canonical clips
                       archived to clips/_v8/ (or whatever the prior version was).
    If no prior version exists, no archive happens.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from state import (  # noqa: E402
    concept_dir,
    update_state,
    append_event,
    utcnow_iso,
)


def parse_map_args(specs: list[str]) -> dict[str, str]:
    """Parse --map "key=url" specs into {key: url}."""
    out = {}
    for spec in specs:
        if "=" not in spec:
            raise SystemExit(f"--map expects 'key=url', got: {spec}")
        key, url = spec.split("=", 1)
        out[key.strip()] = url.strip()
    return out


def download_url(url: str, dest: Path) -> int:
    """Download URL to dest. Returns size in bytes."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)
    return dest.stat().st_size


def cmd_stills(args):
    """Download Magnific stills to state/<concept>/seeds/<version>/."""
    cd = concept_dir(args.concept_id)
    target = cd / "seeds" / args.version
    target.mkdir(parents=True, exist_ok=True)
    spec_map = parse_map_args(args.map)
    if not spec_map:
        raise SystemExit("at least one --map required")

    saved = {}
    for key, url in spec_map.items():
        out = target / f"{key}.png"
        size = download_url(url, out)
        saved[key] = str(out.relative_to(cd).as_posix())
        print(f"  [download:still] {key}.png ({size/1024:.0f} KB)")

    def m(s):
        s.setdefault("seeds_index", {})[args.version] = saved
        append_event(s, actor="download", event="stills_downloaded",
                     version=args.version, files=list(saved.keys()))
        return s
    update_state(args.concept_id, m)
    print(f"[download] {len(saved)} stills saved to {target}")


def cmd_clips(args):
    """Download Seedance motion clips to clips/<shot_id>.mp4 with archival.

    Behavior:
      1. For each shot_id in --map, archive existing clips/<shot_id>.mp4
         to clips/_<args.archive_to>/<shot_id>.mp4 (if archive_to is set
         and the source exists).
      2. Download URL to clips/<shot_id>.mp4 (canonical path).
      3. Record paths in state.shots[i].clip_path + bump status.
    """
    cd = concept_dir(args.concept_id)
    clips_dir = cd / "clips"
    spec_map = parse_map_args(args.map)
    if not spec_map:
        raise SystemExit("at least one --map required")

    if args.archive_to:
        arch = clips_dir / f"_{args.archive_to}"
        arch.mkdir(parents=True, exist_ok=True)
        for shot_id in spec_map:
            src = clips_dir / f"{shot_id}.mp4"
            if src.exists():
                dst = arch / f"{shot_id}.mp4"
                if not dst.exists():
                    shutil.copy2(src, dst)
                    print(f"  [archive] {shot_id}.mp4 -> _{args.archive_to}/")

    saved = {}
    for shot_id, url in spec_map.items():
        out = clips_dir / f"{shot_id}.mp4"
        size = download_url(url, out)
        saved[shot_id] = size
        print(f"  [download:clip] {shot_id}.mp4 ({size/1024/1024:.2f} MB)")

    def m(s):
        shots_by_id = {sh["shot_id"]: sh for sh in s.get("shots", [])}
        for shot_id in spec_map:
            shot = shots_by_id.get(shot_id)
            if not shot:
                continue
            shot["clip_path"] = f"clips/{shot_id}.mp4"
            shot["clip_downloaded_at"] = utcnow_iso()
            shot.setdefault("history", []).append({
                "timestamp": utcnow_iso(),
                "event": "clip_downloaded",
                "size_bytes": saved[shot_id],
            })
        append_event(s, actor="download", event="clips_downloaded",
                     shots=list(spec_map.keys()),
                     archived_to=args.archive_to)
        return s
    update_state(args.concept_id, m)
    print(f"[download] {len(saved)} clips saved to {clips_dir}")


def main():
    parser = argparse.ArgumentParser(description="Download Magnific stills + motion clips.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("stills", help="Download stills to seeds/<version>/")
    sp.add_argument("--concept-id", required=True)
    sp.add_argument("--version", required=True, help="Subfolder under seeds/")
    sp.add_argument("--map", action="append", default=[],
                    help="Repeatable: filename_without_ext=URL")
    sp.set_defaults(func=cmd_stills)

    cp = sub.add_parser("clips", help="Download motion clips to clips/<shot_id>.mp4")
    cp.add_argument("--concept-id", required=True)
    cp.add_argument("--map", action="append", default=[],
                    help="Repeatable: shot_id=URL")
    cp.add_argument("--archive-to", default=None,
                    help="Version label for archive (e.g. 'v7'); archives existing canonical clips to clips/_<value>/")
    cp.set_defaults(func=cmd_clips)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
