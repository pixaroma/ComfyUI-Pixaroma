"""Render a test image through the JS engine (via node) and the Python engine, compare.

Run: python scripts/fx_parity_check.py   (needs `node` on PATH)
Exits 0 on PARITY PASS, 1 on any mismatch. Grain is exempt (different RNGs).
"""
import base64
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

# Import the engine directly off the nodes/ dir. Do NOT use `from nodes._fx...`
# — `nodes` collides with ComfyUI's top-level nodes.py when it's on sys.path,
# which makes `nodes` resolve to that module ("'nodes' is not a package").
# _fx_adjust_engine.py has no relative imports, so loading it standalone is safe.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "nodes"))
from _fx_adjust_engine import apply_fx, PRESETS  # noqa: E402

W, H = 24, 16
rng = np.random.default_rng(7)
base = (rng.random((H, W, 3)) * 255).astype(np.uint8)  # random RGB test image
_RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fx_js_runner.mjs")


def js_run(adj, amount):
    rgba = np.dstack([base, np.full((H, W, 1), 255, np.uint8)]).reshape(-1).tolist()
    job = {"width": W, "height": H, "adj": adj, "amount": amount, "seed": 0, "pixels": rgba}
    path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(job, f)
            path = f.name
        out = subprocess.run(["node", _RUNNER, path], capture_output=True, check=True)
    finally:
        if path and os.path.exists(path):
            os.unlink(path)
    raw = base64.b64decode(out.stdout)
    arr = np.frombuffer(raw, np.uint8).reshape(H, W, 4)[:, :, :3]
    return arr.astype(np.int16)


def py_run(adj, amount):
    f = base.astype(np.float32) / 255.0
    o = apply_fx(f, adj, amount)
    return np.round(o * 255).astype(np.int16)


SINGLE = [
    ("brightness", 40), ("contrast", 50), ("exposure", 30), ("highlights", -40),
    ("shadows", 40), ("whites", 30), ("blacks", 30), ("saturation", 60), ("vibrance", 50),
    ("temperature", 40), ("tint", 30), ("hue", 45), ("clarity", 50), ("sharpness", 60),
    ("vignette", 60), ("fade", 50),
]
CASES = [(k, {k: v}) for k, v in SINGLE] + [(name, dict(vals)) for name, vals in PRESETS.items()]

fails = 0
for name, adj in CASES:
    if "grain" in adj:  # carve-out: RNGs differ between JS and Python
        print(f"{name:16} SKIP (grain carve-out)")
        continue
    j, p = js_run(adj, 1.0), py_run(adj, 1.0)
    diff = int(np.abs(j - p).max())
    if diff > 1:
        fails += 1
        print(f"{name:16} FAIL (max diff {diff})")
    else:
        print(f"{name:16} OK")

print("\nPARITY", "PASS" if fails == 0 else f"FAIL ({fails})")
sys.exit(1 if fails else 0)
