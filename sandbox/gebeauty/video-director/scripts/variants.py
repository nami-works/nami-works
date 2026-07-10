"""scripts/variants.py — Phase 7 variant generator.

After base assembly succeeds, runs the assembler twice more:
  - variant-a: reverse-teaser arc (same shots in reverse order, same copy)
  - variant-b: alternative copy angle (same shot order, alt ad_copy)

Both variants are zero-render-cost (no new Magnific dispatch needed). Variant-a
relies on the assembler's existing `--variant variant-a` mode (defined in
assemble.py VARIANTS dict). Variant-b requires state.ad_copy_variant_b to be
populated (the brain re-runs Step 8 with a constraint twist before calling this).

CLI:
    python variants.py --concept-id <id> [--skip-a] [--skip-b]

State transition: ASSEMBLED stays ASSEMBLED until deliver.py promotes to DELIVERED.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

# Force UTF-8 on stdout/stderr so subprocess output (Unicode arrows / em-dashes) survives Windows cp1252.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from state import (  # noqa: E402
    read_state,
    update_state,
    append_event,
    utcnow_iso,
    concept_dir,
)

ASSEMBLE_SCRIPT = SCRIPT_DIR / "assemble.py"


def run_assembler(concept_id: str, variant: str) -> int:
    cmd = [
        sys.executable, str(ASSEMBLE_SCRIPT),
        "--concept-id", concept_id,
        "--variant", variant,
        # Allow run on non-ALL_PASS states (variants run after motion review, before deliver)
        "--force",
    ]
    print(f"[variants] -> assemble.py --variant {variant}")
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        print(f"[variants] FAIL on {variant} (exit {res.returncode}):")
        print(res.stderr[-1000:] if res.stderr else "(no stderr)")
        return res.returncode
    # Print just the last few lines of stdout
    tail = "\n".join((res.stdout or "").splitlines()[-6:])
    print(tail)
    return 0


def cmd_run(args):
    state = read_state(args.concept_id)
    if state.get("state") not in ("ASSEMBLED", "DELIVERED"):
        print(
            f"[variants] WARN: state is {state.get('state')}, normally need ASSEMBLED. "
            f"Proceeding anyway (assemble.py has its own --force)."
        )

    # Verify base exists
    assembly = state.get("assembly", {})
    if "base" not in assembly:
        raise SystemExit(
            "state.assembly.base missing — run scripts/assemble.py --variant base first"
        )

    results = {}

    # Variant A: reverse arc, same copy — no preconditions beyond base assembly
    if not args.skip_a:
        rc = run_assembler(args.concept_id, "variant-a")
        results["variant-a"] = "ok" if rc == 0 else f"fail({rc})"

    # Variant B: requires ad_copy_variant_b to be populated
    if not args.skip_b:
        if not state.get("ad_copy_variant_b"):
            print(
                "[variants] WARN: state.ad_copy_variant_b not set — variant-b will fall back "
                "to the base ad_copy. To get a true alt-copy variant, populate state.ad_copy_variant_b "
                "via the brain's Step 8 re-run with constraint twist."
            )
        rc = run_assembler(args.concept_id, "variant-b")
        results["variant-b"] = "ok" if rc == 0 else f"fail({rc})"

    def m(s):
        append_event(s, actor="variants", event="variants_run", results=results)
        return s
    update_state(args.concept_id, m)

    print()
    print("[variants] summary:")
    for k, v in results.items():
        print(f"  {k}: {v}")

    failed = [k for k, v in results.items() if v != "ok"]
    if failed:
        sys.exit(1)


def cmd_status(args):
    state = read_state(args.concept_id)
    print(f"concept: {args.concept_id}")
    print(f"state:   {state.get('state')}")
    print()
    print("Assembly status:")
    for variant in ("base", "variant-a", "variant-b"):
        if entry := state.get("assembly", {}).get(variant):
            dur = entry.get("duration_s", "?")
            path = entry.get("creative_path", "?")
            print(f"  {variant}: {dur}s -> {path}")
        else:
            print(f"  {variant}: not assembled")
    print()
    has_alt_copy = bool(state.get("ad_copy_variant_b"))
    print(f"ad_copy_variant_b: {'SET' if has_alt_copy else 'NOT SET (variant-b will fall back to base copy)'}")


def main():
    parser = argparse.ArgumentParser(description="Generate variant-a + variant-b for /video-director.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    rp = sub.add_parser("run", help="Run the assembler for variant-a and variant-b")
    rp.add_argument("--concept-id", required=True)
    rp.add_argument("--skip-a", action="store_true", help="Skip variant-a")
    rp.add_argument("--skip-b", action="store_true", help="Skip variant-b")
    rp.set_defaults(func=cmd_run)

    st = sub.add_parser("status", help="Print variant-assembly readiness")
    st.add_argument("--concept-id", required=True)
    st.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
