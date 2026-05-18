"""Download the 10 bundled fonts from the google/fonts GitHub repository.

These are SIL Open Font License (and Apache 2.0 for Roboto) - free for
commercial use and redistribution. Re-runs are safe (overwrites existing).

Variable fonts where available (one file per font name supports many weights);
static TTFs where the font has no variable axis (Bebas Neue, Anton). The
catalog in nodes/_text_render_helpers.py and server_routes.py maps each
weight/italic combo to one of these files; the renderer picks the wght
axis at draw time for variable fonts.

Usage:
    python scripts/download_fonts.py
"""
import urllib.request
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = REPO_ROOT / "assets" / "fonts"

# (output filename, raw URL) - filenames are cleaned (no brackets) for portability.
FONTS = [
    ("Inter-Variable.ttf",
     "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf"),
    ("Roboto-Variable.ttf",
     "https://github.com/google/fonts/raw/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf"),
    ("Montserrat-Variable.ttf",
     "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf"),
    ("Oswald-Variable.ttf",
     "https://github.com/google/fonts/raw/main/ofl/oswald/Oswald%5Bwght%5D.ttf"),
    ("PlayfairDisplay-Variable.ttf",
     "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf"),
    ("PlayfairDisplay-Italic-Variable.ttf",
     "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf"),
    ("Lora-Variable.ttf",
     "https://github.com/google/fonts/raw/main/ofl/lora/Lora%5Bwght%5D.ttf"),
    ("Caveat-Variable.ttf",
     "https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf"),
    ("JetBrainsMono-Variable.ttf",
     "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf"),
    ("BebasNeue-Regular.ttf",
     "https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf"),
    ("Anton-Regular.ttf",
     "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf"),
]


def main():
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    failed = []
    for name, url in FONTS:
        dest = FONTS_DIR / name
        print(f"downloading {name} ...", end=" ", flush=True)
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "ComfyUI-Pixaroma-font-fetch/1.0"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            dest.write_bytes(data)
            print(f"OK ({len(data)//1024} KB)")
        except Exception as e:
            print(f"FAIL: {e}")
            failed.append((name, url, str(e)))
    if failed:
        print(f"\n{len(failed)} font(s) failed:")
        for name, url, err in failed:
            print(f"  {name}\n    url: {url}\n    err: {err}")
        sys.exit(1)
    print(f"\nAll {len(FONTS)} fonts downloaded to {FONTS_DIR}")


if __name__ == "__main__":
    main()
