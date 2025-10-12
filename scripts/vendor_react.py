"""
Utility to download React UMD bundles for offline use.

Run:
    python scripts/vendor_react.py
"""

from __future__ import annotations

import subprocess
import urllib.error
import urllib.request
from shutil import which
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET_DIR = ROOT / "frontend" / "static" / "vendor"

FILES = {
    "react.production.min.js": "https://unpkg.com/react@18/umd/react.production.min.js",
    "react-dom.production.min.js": "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
}


def main() -> None:
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []

    for filename, url in FILES.items():
        dest = TARGET_DIR / filename
        print(f"Downloading {filename}…")
        try:
            urllib.request.urlretrieve(url, dest)  # nosec B310
            continue
        except urllib.error.URLError as err:
            print(f"  urllib failed: {err.reason}")

        curl_bin = which("curl")
        if curl_bin:
            print("  Retrying with curl…")
            result = subprocess.run(
                [curl_bin, "-L", url, "-o", str(dest)],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            if result.returncode == 0:
                continue
            print("  curl failed:\n", result.stdout.strip())

        failures.append(filename)

    if failures:
        print(
            "Warning: Failed to vendor the following React bundles locally:",
            ", ".join(failures),
        )
        print(
            "The app will fall back to the public CDN at runtime. "
            "To fix certificate issues on macOS, run "
            "'/Applications/Python 3.12/Install Certificates.command' and re-run setup."
        )
    else:
        print(f"React bundles copied to {TARGET_DIR}")


if __name__ == "__main__":
    main()
