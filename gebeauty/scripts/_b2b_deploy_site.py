"""Deploy the two B2B portfolio decks to b2b.gebeauty.com.br (S3 + CloudFront).

Replaces _b2b_publish_pages.py (Shopify pages, retired per the migration
handoff §7) now that the decks are self-contained static HTML served from
their own subdomain instead of the storefront theme.

Steps:
  1. (Optional) regenerate the neutral/partner deck from the current
     commercial deck via _b2b_make_neutral.py -- run that yourself first if
     you edited inputs/mockups/gebeauty-b2b-portfolio-v6.html; this script
     does not re-run it automatically (keeps this script's job to "ship
     whatever's already built" only).
  2. Run _b2b_build_site.py to font-inline both decks into
     gebeauty/b2b-site/{comercial,parceiros}/index.html (again, run
     separately -- this script ships the already-built output as-is so a
     dry-run preview reflects exactly what a real deploy would sync).
  3. Sync gebeauty/b2b-site/{comercial,parceiros} to the bucket.
  4. Invalidate the CloudFront cache for the changed paths.

Resolves the bucket name + distribution ID from Terraform outputs
(gebeauty/b2b-site/infra/terraform) -- run `terraform apply` there first.

DRY by default (prints the sync/invalidation plan, runs nothing). Pass
--apply to actually push.

Usage:
  C:/Python314/python.exe gebeauty/scripts/_b2b_deploy_site.py           # dry run
  C:/Python314/python.exe gebeauty/scripts/_b2b_deploy_site.py --apply   # real deploy
"""
import subprocess
import sys
from pathlib import Path

APPLY = "--apply" in sys.argv
ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "gebeauty" / "b2b-site"
TF_DIR = SITE / "infra" / "terraform"
ROUTES = ["comercial", "parceiros"]


def tf_output(name: str) -> str:
    r = subprocess.run(
        ["terraform", f"-chdir={TF_DIR}", "output", "-no-color", "-raw", name],
        capture_output=True, text=True,
    )
    out = r.stdout.strip()
    # terraform prints its "no outputs found" notice to stdout (not stderr)
    # with exit code 0 when the state has no matching output yet -- treat
    # that the same as a hard failure rather than returning it as a value.
    if r.returncode != 0 or not out or "Warning:" in out or "Error:" in out:
        raise RuntimeError(
            f"terraform output {name} unavailable -- has terraform apply run in {TF_DIR}?\n{r.stderr or out}"
        )
    return out


def run(cmd, label):
    print(f"{'[APPLY]' if APPLY else '[DRY]  '} {label}: {' '.join(cmd)}")
    if APPLY:
        subprocess.run(cmd, check=True)


def main():
    for route in ROUTES:
        idx = SITE / route / "index.html"
        if not idx.exists():
            raise FileNotFoundError(f"{idx} missing -- run _b2b_build_site.py first.")

    try:
        bucket = tf_output("site_bucket_name")
        dist_id = tf_output("site_cloudfront_distribution_id")
        if not bucket or not dist_id:
            raise RuntimeError("empty output")
    except Exception:
        bucket = "<bucket -- run terraform apply first>"
        dist_id = "<distribution id -- run terraform apply first>"

    for route in ROUTES:
        run(
            ["aws", "s3", "sync", str(SITE / route), f"s3://{bucket}/{route}",
             "--delete", "--cache-control", "no-cache"],
            f"sync {route}/",
        )

    og_image = SITE / "og-image.jpg"
    if og_image.exists():
        run(
            ["aws", "s3", "cp", str(og_image), f"s3://{bucket}/og-image.jpg",
             "--content-type", "image/jpeg", "--cache-control", "max-age=86400"],
            "sync og-image.jpg (public, unauthenticated -- see viewer-request.js)",
        )

    run(
        ["aws", "cloudfront", "create-invalidation",
         "--distribution-id", dist_id, "--paths", "/*"],
        "invalidate CloudFront cache",
    )

    if not APPLY:
        print("\nDry run only -- pass --apply to actually sync + invalidate.")


if __name__ == "__main__":
    main()
