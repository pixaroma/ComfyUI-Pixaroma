"""Check _safe_prefix (filename_prefix sanitizer) behavior.

Run: python scripts/save_prefix_check.py
Exits 0 on PREFIX PASS, 1 on any mismatch.

Locks in the June-2026 fix for the Korean filename_prefix report: the
sanitizer must only neutralize genuinely dangerous characters (Windows-
illegal chars, control chars, path traversal) and let every other
character through verbatim - non-Latin scripts, accented letters, and
spaces included - matching native ComfyUI SaveImage, which does no
character filtering at all (folder_paths.get_save_image_path only
enforces that the final path stays inside output/).
"""
import os
import sys
import time

# Import the helper directly off the nodes/ dir. Do NOT use `from nodes._save...`
# - `nodes` collides with ComfyUI's top-level nodes.py when it's on sys.path.
# _save_helpers.py has no relative imports, so loading it standalone is safe.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "nodes"))
from _save_helpers import _safe_prefix  # noqa: E402

_today = time.strftime("%Y-%m-%d")

# (input, expected) - expected None means "unrecoverable, caller falls back"
CASES = [
    # ── The reported Korean cases (parity with native SaveImage) ──────────
    ("프로젝트/테스트/이미지", "프로젝트/테스트/이미지"),
    ("project/te 스 st/image", "project/te 스 st/image"),

    # ── Unicode + spaces survive verbatim ─────────────────────────────────
    ("café/naïve", "café/naïve"),
    ("日本語/画像", "日本語/画像"),
    ("Bunny WithCubes - Copy.png", "Bunny WithCubes - Copy.png"),
    ("a  b", "a  b"),                      # interior spaces untouched
    ("  padded  /img", "padded/img"),      # segment-edge whitespace trimmed

    # ── Windows-illegal characters are neutralized to '_' ─────────────────
    ('a<b>c:d"e|f?g*h', "a_b_c_d_e_f_g_h"),
    ("a\tb", "a_b"),                       # control chars too
    ("C:\\Users\\x", "C/Users/x"),         # drive colon neutralized, \ -> /

    # ── Windows reserved device names get a '_' suffix ────────────────────
    ("CON/img", "CON_/img"),
    ("nul.txt/img", "nul.txt_/img"),
    ("com1", "com1_"),

    # ── Windows trailing-dot/space rule (OS strips them silently) ─────────
    ("test.../img", "test/img"),
    ("teasda......////", "teasda"),        # docstring example, must keep working

    # ── Unchanged ASCII behavior (regression guards) ──────────────────────
    ("img", "img"),
    ("SDXL/portrait", "SDXL/portrait"),
    ("a__b", "a_b"),                       # underscore collapse retained
    ("_edge_", "edge"),                    # edge-underscore strip retained
    ("???", None),                         # nothing usable -> fallback

    # ── Tokens ────────────────────────────────────────────────────────────
    ("%date:yyyy-MM-dd%/img", _today + "/img"),
    ("%year%-%month%/img", "%year%-%month%/img"),  # native tokens preserved

    # ── Traversal / absolute / garbage rejection (must stay rejected) ─────
    ("../evil", None),
    ("a/../b", None),
    ("/absolute", None),
    ("", None),
    ("   ", None),
    (None, None),
    (123, None),
    ("a" * 300, None),                     # input length cap
]


def main():
    failures = []
    for raw, expected in CASES:
        got = _safe_prefix(raw)
        if got != expected:
            failures.append((raw, expected, got))

    # Output-length cap: 121-char input truncates to 100
    long_in = "x" * 60 + "/" + "y" * 60
    long_got = _safe_prefix(long_in)
    if long_got is None or len(long_got) > 100 or not long_got.startswith("x" * 60 + "/"):
        failures.append((long_in, "<=100 chars keeping x.../y...", long_got))

    if failures:
        print(f"PREFIX FAIL - {len(failures)} case(s):")
        for raw, expected, got in failures:
            # ascii() so a cp1252 Windows console can't choke on Korean output
            print(f"  input={ascii(raw)}\n    expected={ascii(expected)}\n    got     ={ascii(got)}")
        return 1

    print(f"PREFIX PASS ({len(CASES) + 1} cases)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
