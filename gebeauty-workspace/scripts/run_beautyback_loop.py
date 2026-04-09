"""
Repeatedly runs the beautyback combinesWith updater until all codes are done.
Stops when a run finds 0 codes needing update.
"""

import subprocess
import sys
import time

SCRIPT = "c:/Users/Lucas Guimarães/Desktop/cpg-labs/gebeauty-workspace/scripts/update_beautyback_combines.py"
PYTHON = "C:/Python314/python.exe"

run = 1
while True:
    print(f"\n{'='*60}")
    print(f"=== PASS {run} ===")
    print(f"{'='*60}\n")
    sys.stdout.flush()

    result = subprocess.run(
        [PYTHON, "-u", SCRIPT],
        capture_output=False,
    )

    if result.returncode == 2:
        print(f"\n[loop] Pass {run}: all codes updated. Done!")
        break
    elif result.returncode != 0:
        print(f"\n[loop] Pass {run} exited with code {result.returncode}, stopping.")
        break

    run += 1
    print(f"\n[loop] Pass {run - 1} complete. Starting next pass in 5s...")
    sys.stdout.flush()
    time.sleep(5)

print(f"\n[loop] Finished after {run} passes.")
