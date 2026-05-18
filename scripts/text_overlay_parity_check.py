"""Text Overlay parity check.

Renders ~10 reference layer configs through nodes/_text_render_helpers.py and
diffs against committed goldens in tests/text_overlay_parity_goldens/.

The goldens lock the Python output. Browser-vs-PIL pixel match is impossible
(different rasterizers); the editor's in-node thumbnail is the visual check
that JS stays in step with Python.

Usage:
    python scripts/text_overlay_parity_check.py              # diff vs goldens
    python scripts/text_overlay_parity_check.py --regenerate # overwrite goldens
"""
import argparse
import json
import sys
import types
import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
GOLDENS_DIR = REPO_ROOT / "tests" / "text_overlay_parity_goldens"
MANIFEST_PATH = GOLDENS_DIR / "manifest.json"


def _load_helpers():
    """Load nodes/_text_render_helpers.py into a synthetic 'nodes' package."""
    nodes_pkg = types.ModuleType("nodes")
    nodes_pkg.__path__ = [str(REPO_ROOT / "nodes")]
    sys.modules["nodes"] = nodes_pkg
    spec = importlib.util.spec_from_file_location(
        "nodes._text_render_helpers",
        REPO_ROOT / "nodes" / "_text_render_helpers.py",
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["nodes._text_render_helpers"] = mod
    spec.loader.exec_module(mod)
    return mod


# 10 reference configs covering simplified v2 schema (no effects)
REFERENCE_CASES = [
    ("01_plain_single.png", (512, 256), "#1a2a4a", [
        {"text": "Hello", "font": "Inter", "weight": 400, "italic": False,
         "fontSize": 48, "lineHeight": 1.2, "letterSpacing": 0, "align": "left",
         "color": "#FFFFFF", "opacity": 1.0, "x": 50, "y": 80, "rotation": 0}
    ]),
    ("02_multiline_center.png", (512, 256), "#2a1a3a", [
        {"text": "Line One\nLine Two", "font": "Inter", "weight": 700, "italic": False,
         "fontSize": 36, "lineHeight": 1.3, "letterSpacing": 0, "align": "center",
         "color": "#FFFFFF", "opacity": 1.0, "x": 100, "y": 50, "rotation": 0}
    ]),
    ("03_bold_italic.png", (512, 256), "#3a1a2a", [
        {"text": "Bold Italic", "font": "PlayfairDisplay", "weight": 700, "italic": True,
         "fontSize": 56, "lineHeight": 1.2, "letterSpacing": 0, "align": "center",
         "color": "#FFFFFF", "opacity": 1.0, "x": 80, "y": 80, "rotation": 0}
    ]),
    ("04_bg_pill.png", (512, 256), "#5a5a5a", [
        {"text": "BG Pill", "font": "Montserrat", "weight": 800, "italic": False,
         "fontSize": 42, "lineHeight": 1.2, "letterSpacing": 0, "align": "center",
         "color": "#FFFFFF", "opacity": 1.0, "bgColor": "#f66744",
         "x": 120, "y": 95, "rotation": 0}
    ]),
    ("05_rotated_30.png", (512, 256), "#1a4a3a", [
        {"text": "Rotated", "font": "Anton", "weight": 400, "italic": False,
         "fontSize": 56, "lineHeight": 1.2, "letterSpacing": 0, "align": "left",
         "color": "#FFFFFF", "opacity": 1.0,
         "x": 120, "y": 90, "rotation": 30}
    ]),
    ("06_letter_spacing.png", (512, 256), "#3a3a3a", [
        {"text": "WIDE TEXT", "font": "Oswald", "weight": 600, "italic": False,
         "fontSize": 48, "lineHeight": 1.0, "letterSpacing": 12, "align": "center",
         "color": "#FFFFFF", "opacity": 1.0, "x": 60, "y": 90, "rotation": 0}
    ]),
    ("07_handwriting_opacity.png", (512, 256), "#2a3a4a", [
        {"text": "Soft", "font": "Caveat", "weight": 500, "italic": False,
         "fontSize": 80, "lineHeight": 1.0, "letterSpacing": 0, "align": "left",
         "color": "#FFFFFF", "opacity": 0.5, "x": 180, "y": 70, "rotation": -10}
    ]),
    ("08_bg_pill_multiline.png", (512, 320), "#1a1a1a", [
        {"text": "Multi\nLine\nPill", "font": "Inter", "weight": 700, "italic": False,
         "fontSize": 36, "lineHeight": 1.2, "letterSpacing": 0, "align": "center",
         "color": "#FFFFFF", "opacity": 1.0, "bgColor": "#222244",
         "x": 180, "y": 70, "rotation": 0}
    ]),
    ("09_right_align.png", (512, 256), "#3a2a1a", [
        {"text": "Long line\nShort", "font": "Lora", "weight": 700, "italic": False,
         "fontSize": 36, "lineHeight": 1.2, "letterSpacing": 0, "align": "right",
         "color": "#FFFFFF", "opacity": 1.0, "x": 80, "y": 80, "rotation": 0}
    ]),
    ("10_monospace.png", (512, 256), "#1a1a1a", [
        {"text": "code()", "font": "JetBrainsMono", "weight": 500, "italic": False,
         "fontSize": 48, "lineHeight": 1.2, "letterSpacing": 2, "align": "left",
         "color": "#00ff88", "opacity": 1.0, "x": 80, "y": 90, "rotation": 0}
    ]),
]


def render_case(helpers, canvas_size, bg_color, layers):
    r, g, b = int(bg_color[1:3], 16), int(bg_color[3:5], 16), int(bg_color[5:7], 16)
    img = Image.new("RGBA", canvas_size, (r, g, b, 255))
    for layer in layers:
        helpers.render_text_layer(img, layer)
    return img


def delta_e(a, b):
    diff = a.astype(np.int32) - b.astype(np.int32)
    return np.sqrt((diff * diff).sum(axis=-1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--regenerate", action="store_true")
    args = ap.parse_args()

    helpers = _load_helpers()
    GOLDENS_DIR.mkdir(parents=True, exist_ok=True)

    if args.regenerate:
        manifest = []
        for filename, canvas, bg, layers in REFERENCE_CASES:
            img = render_case(helpers, canvas, bg, layers)
            out = GOLDENS_DIR / filename
            img.save(out)
            manifest.append({"file": filename, "canvas": list(canvas), "bg": bg, "layers": layers})
            print(f"wrote {filename}")
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))
        print(f"\nWrote {len(manifest)} goldens + manifest")
        return

    if not MANIFEST_PATH.is_file():
        print("No goldens. Run with --regenerate first.")
        sys.exit(1)
    manifest = json.loads(MANIFEST_PATH.read_text())

    total_failures = 0
    for entry in manifest:
        gold_path = GOLDENS_DIR / entry["file"]
        if not gold_path.is_file():
            print(f"MISSING: {entry['file']}")
            total_failures += 1
            continue
        gold = np.array(Image.open(gold_path).convert("RGB"))
        rendered = np.array(render_case(helpers, tuple(entry["canvas"]), entry["bg"], entry["layers"]).convert("RGB"))
        if gold.shape != rendered.shape:
            print(f"FAIL {entry['file']}: shape mismatch {gold.shape} vs {rendered.shape}")
            total_failures += 1
            continue
        d = delta_e(gold, rendered)
        bad = (d > 10).sum()
        bad_frac = bad / d.size
        if bad_frac > 0.02:
            print(f"FAIL {entry['file']}: {bad_frac*100:.2f}% pixels exceed DeltaE=10 (limit 2%)")
            total_failures += 1
        else:
            print(f"OK   {entry['file']}: {bad_frac*100:.3f}% deviation")

    if total_failures:
        print(f"\n{total_failures} parity failure(s)")
        sys.exit(1)
    print(f"\nAll {len(manifest)} parity checks pass")


if __name__ == "__main__":
    main()
