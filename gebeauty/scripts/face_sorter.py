"""
face_sorter.py — Find all Drive images containing a specific person.

Usage:
    python face_sorter.py --reference DRIVE_FILE_ID [--folder DRIVE_FOLDER_ID] [--threshold 0.5] [--dry-run]

Steps:
    1. Downloads reference image(s) from Drive and extracts face embeddings.
    2. Lists all image files in the target Drive folder (recursively).
    3. For each image: downloads temporarily, detects faces, compares embeddings.
    4. Writes results to face_sorter_results.csv.

Auth:
    First run opens a browser for Google OAuth consent.
    Credentials are saved to token.json for subsequent runs.
    Place your OAuth credentials JSON at: gebeauty/scripts/google_oauth_credentials.json
"""

import argparse
import csv
import io
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

# Force UTF-8 output so Portuguese/accented filenames don't crash on Windows cp1252 consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
CREDENTIALS_FILE = SCRIPT_DIR / "google_oauth_credentials.json"
TOKEN_FILE = SCRIPT_DIR / "token.json"
RESULTS_FILE = SCRIPT_DIR / "face_sorter_results.csv"

# ---------------------------------------------------------------------------
# Google Drive API scopes (read-only is enough for listing + downloading)
# ---------------------------------------------------------------------------
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# ---------------------------------------------------------------------------
# Default folder: GE Beauty photo library parent
# ---------------------------------------------------------------------------
DEFAULT_FOLDER_ID = "1YmOf2BVK-T7rsgKESxHnX5R9h7bKkld_"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def get_drive_service():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                sys.exit(
                    f"[ERROR] Credentials file not found: {CREDENTIALS_FILE}\n"
                    "See the script docstring for setup instructions."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())

    return build("drive", "v3", credentials=creds)


# ---------------------------------------------------------------------------
# Drive helpers
# ---------------------------------------------------------------------------
def list_images_in_folder(service, folder_id: str, recursive: bool = True, _depth: int = 0) -> list[dict]:
    """Return all image files under folder_id, optionally recursive."""
    results = []
    page_token = None
    query = f"'{folder_id}' in parents and trashed = false"

    while True:
        response = service.files().list(
            q=query,
            fields="nextPageToken, files(id, name, mimeType, webViewLink, size, thumbnailLink)",
            pageSize=1000,
            pageToken=page_token,
            includeItemsFromAllDrives=True,
            supportsAllDrives=True,
        ).execute()

        items = response.get("files", [])
        if _depth == 0:
            print(f"  Top-level items in folder: {len(items)}")

        for f in items:
            mime = f.get("mimeType", "")
            if mime.startswith("image/"):
                results.append(f)
            elif mime == "application/vnd.google-apps.folder" and recursive:
                results.extend(list_images_in_folder(service, f["id"], recursive=True, _depth=_depth + 1))

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return results


def download_thumbnail(thumbnail_url: str, size: int = 1000) -> Optional[Image.Image]:
    """Download a Drive thumbnail at the requested pixel size (fast, ~20-80KB)."""
    import urllib.request
    import re
    try:
        # Drive thumbnailLink URLs end in =s220 — bump to requested size
        url = re.sub(r"=s\d+$", f"=s{size}", thumbnail_url)
        if "=s" not in url:
            url = url + f"=s{size}"
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = resp.read()
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as e:
        return None


def download_image(service, file_id: str) -> Optional[Image.Image]:
    """Download a full Drive file and return a PIL Image (slow for large files)."""
    try:
        from googleapiclient.http import MediaIoBaseDownload

        request = service.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        buf.seek(0)
        return Image.open(buf).convert("RGB")
    except Exception as e:
        print(f"  [WARN] Could not download {file_id}: {e}")
        return None


# ---------------------------------------------------------------------------
# Face analysis with insightface
# ---------------------------------------------------------------------------
_face_app = None


def get_face_app():
    global _face_app
    if _face_app is None:
        import insightface
        from insightface.app import FaceAnalysis

        _face_app = FaceAnalysis(providers=["CPUExecutionProvider"])
        _face_app.prepare(ctx_id=0, det_size=(640, 640))
    return _face_app


def get_face_embeddings(image: Image.Image) -> list[np.ndarray]:
    """Return a list of face embeddings (L2-normalised) from a PIL Image."""
    app = get_face_app()
    img_array = np.array(image)
    # insightface expects BGR
    img_bgr = img_array[:, :, ::-1]
    faces = app.get(img_bgr)
    embeddings = []
    for face in faces:
        emb = face.normed_embedding  # already L2-normalised
        embeddings.append(emb)
    return embeddings


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))  # both are already normalised


def best_match_score(candidate_embeddings: list[np.ndarray], reference_embeddings: list[np.ndarray]) -> float:
    """Return the highest similarity between any candidate face and any reference face."""
    if not candidate_embeddings or not reference_embeddings:
        return 0.0
    best = 0.0
    for cand in candidate_embeddings:
        for ref in reference_embeddings:
            score = cosine_similarity(cand, ref)
            best = max(best, score)
    return best


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Find Drive images containing a specific person.")
    parser.add_argument("--reference", required=True, nargs="+", metavar="FILE_ID",
                        help="Drive file ID(s) of reference image(s) of the target person.")
    parser.add_argument("--folder", default=DEFAULT_FOLDER_ID,
                        help=f"Drive folder ID to scan (default: GE Beauty library {DEFAULT_FOLDER_ID}).")
    parser.add_argument("--threshold", type=float, default=0.45,
                        help="Cosine similarity threshold for a match (0–1, default 0.45).")
    parser.add_argument("--dry-run", action="store_true",
                        help="List files that would be processed, don't do face analysis.")
    parser.add_argument("--max", type=int, default=None,
                        help="Process at most N images (for testing).")
    parser.add_argument("--resume", action="store_true",
                        help="Skip files already in results CSV and append new results.")
    args = parser.parse_args()

    print("[1/4] Authenticating with Google Drive …")
    service = get_drive_service()

    print("[2/4] Loading reference image(s) and extracting embeddings …")
    reference_embeddings: list[np.ndarray] = []
    for ref in args.reference:
        local_path = Path(ref)
        if local_path.exists():
            try:
                img = Image.open(local_path).convert("RGB")
                print(f"  Loaded local file: {local_path.name}")
            except Exception as e:
                print(f"  [ERROR] Could not open local file {ref}: {e}")
                sys.exit(1)
        else:
            img = download_image(service, ref)
            if img is None:
                print(f"  [ERROR] Could not load reference image {ref}")
                sys.exit(1)
        embeddings = get_face_embeddings(img)
        if not embeddings:
            print(f"  [WARN] No face detected in reference image {ref} — skipping.")
        else:
            print(f"  Found {len(embeddings)} face(s) in reference {ref}.")
            reference_embeddings.extend(embeddings)

    if not reference_embeddings:
        sys.exit("[ERROR] No faces found in any reference image. Cannot continue.")

    # Load already-processed file IDs if resuming
    already_done: set[str] = set()
    prior_results: list[dict] = []
    if args.resume and RESULTS_FILE.exists():
        with open(RESULTS_FILE, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                already_done.add(row["file_id"])
                prior_results.append(row)
        print(f"  Resuming: {len(already_done)} files already processed, skipping them.")

    print(f"[3/4] Listing images in folder {args.folder} ...")
    all_images = list_images_in_folder(service, args.folder)
    print(f"  Found {len(all_images)} image files.")

    if args.dry_run:
        print("\n[DRY RUN] Would process these files:")
        for f in all_images[:20]:
            print(f"  {f['name']}  ({f.get('size', '?')} bytes)  {f.get('webViewLink', '')}")
        if len(all_images) > 20:
            print(f"  … and {len(all_images) - 20} more.")
        return

    # Filter out already-done files when resuming
    if already_done:
        all_images = [f for f in all_images if f["id"] not in already_done]
        print(f"  {len(all_images)} images remaining after skipping already-processed.")

    if args.max:
        all_images = all_images[:args.max]
        print(f"  (Limited to first {args.max} images for testing.)")

    total = len(all_images)
    print(f"[4/4] Scanning {total} images for matches (threshold={args.threshold}) ...")
    print("      Strategy: thumbnail first (~50KB) -> full download only if no thumbnail")
    results = list(prior_results)  # start with already-done results when resuming
    matches = sum(1 for r in prior_results if r.get("match") == "yes")
    no_thumb = 0

    for i, f in enumerate(all_images, 1):
        name = f["name"]
        file_id = f["id"]
        url = f.get("webViewLink", f"https://drive.google.com/file/d/{file_id}/view")
        thumb_url = f.get("thumbnailLink")

        print(f"  [{i}/{total}] {name} ", end="", flush=True)

        # Phase 1: try thumbnail (fast, ~50KB)
        img = None
        used_thumb = False
        if thumb_url:
            img = download_thumbnail(thumb_url, size=1000)
            used_thumb = img is not None

        # Phase 2: fall back to full download if no thumbnail
        if img is None:
            no_thumb += 1
            img = download_image(service, file_id)

        if img is None:
            print("-> download error, skipped")
            results.append({"file_name": name, "file_id": file_id, "url": url,
                            "faces_found": 0, "best_score": 0.0, "match": "error"})
            continue

        embeddings = get_face_embeddings(img)
        if not embeddings:
            print("-> no faces")
            results.append({"file_name": name, "file_id": file_id, "url": url,
                            "faces_found": 0, "best_score": 0.0, "match": "no_faces"})
            continue

        score = best_match_score(embeddings, reference_embeddings)
        is_match = score >= args.threshold
        if is_match:
            matches += 1

        src = "thumb" if used_thumb else "full"
        match_tag = " *** MATCH ***" if is_match else ""
        print(f"-> {len(embeddings)} face(s), score={score:.3f} [{src}]{match_tag}")
        results.append({
            "file_name": name,
            "file_id": file_id,
            "url": url,
            "faces_found": len(embeddings),
            "best_score": round(score, 4),
            "match": "yes" if is_match else "no",
        })

    if no_thumb:
        print(f"\n  Note: {no_thumb} images had no thumbnail and required full download.")

    # Write CSV
    with open(RESULTS_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["file_name", "file_id", "url", "faces_found", "best_score", "match"])
        writer.writeheader()
        writer.writerows(results)

    total_scanned = len(results)
    print(f"\n{'='*60}")
    print(f"Done. {matches}/{total_scanned} images matched the reference person.")
    print(f"Results saved to: {RESULTS_FILE}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
