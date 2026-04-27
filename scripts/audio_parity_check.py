# scripts/audio_parity_check.py
"""Audio React / AudioReact parity check.

Renders 64 reference frames using engine.generate_video() and
diffs against committed goldens in tests/audio_parity_goldens/.

Usage:
    python scripts/audio_parity_check.py              # diff vs goldens, exit non-zero on fail
    python scripts/audio_parity_check.py --regenerate # overwrite goldens (intentional, never default)
"""
import argparse
import importlib.util
import json
import sys
import types
from pathlib import Path

import numpy as np
import torch
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "tests" / "audio_parity_goldens" / "manifest.json"
GOLDENS_DIR  = REPO_ROOT / "tests" / "audio_parity_goldens"


# The plugin folder is named ComfyUI-Pixaroma (dash, invalid Python package
# name) so we can't import via the regular package machinery. We create a
# synthetic 'nodes' package in sys.modules and load only the engine module —
# no need to load node_audio_react.py; the engine is the public API now.
def _load_engine_module():
    """Load nodes/_audio_react_engine.py into a synthetic 'nodes' package
    so its `from __future__ import annotations` and any internal imports
    resolve. We don't need node_audio_react.py — the engine is the public
    API now."""
    nodes_pkg = types.ModuleType("nodes")
    nodes_pkg.__path__ = [str(REPO_ROOT / "nodes")]
    sys.modules["nodes"] = nodes_pkg
    spec = importlib.util.spec_from_file_location(
        "nodes._audio_react_engine",
        REPO_ROOT / "nodes" / "_audio_react_engine.py",
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["nodes._audio_react_engine"] = mod
    spec.loader.exec_module(mod)
    return mod


_engine = _load_engine_module()
Params = _engine.Params
generate_video = _engine.generate_video


def load_test_image(path):
    img = np.array(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(img).unsqueeze(0)  # [1, H, W, 3]


def synthesize_audio(duration_s, sample_rate, seed, fps):
    """Deterministic test audio: sine sweep + onset spikes at known frames.

    Uses np.random.RandomState (NOT default_rng) — RandomState is the legacy
    bit-stream guaranteed stable across NumPy versions, required for
    parity-test reproducibility. Do NOT "modernize" to default_rng.
    """
    n = int(duration_s * sample_rate)
    t = np.arange(n) / sample_rate
    f0, f1 = 100.0, 2000.0
    phase = 2 * np.pi * (f0 * t + (f1 - f0) * t * t / (2 * duration_s))
    sweep = 0.3 * np.sin(phase)
    spike_envelope = np.zeros(n, dtype=np.float32)
    for fr in (30, 60, 90):
        center = int(fr / fps * sample_rate)
        for i in range(max(0, center - 200), min(n, center + 200)):
            x = (i - center) / 200.0
            spike_envelope[i] += np.exp(-x * x * 8.0) * 0.7
    spikes = spike_envelope * np.random.RandomState(seed).randn(n) * 0.5
    waveform = (sweep + spikes).astype(np.float32)
    waveform = np.clip(waveform, -1.0, 1.0)
    return {
        "waveform": torch.from_numpy(waveform).view(1, 1, -1),
        "sample_rate": sample_rate,
    }


def render_frames(image, audio, params_dict, motion_mode, glitch=0.0, bloom=0.0,
                  vignette=0.0, hue_shift=0.0):
    """Build a Params from the manifest's shared_params + the per-test
    overrides, call engine.generate_video, return the [F, H, W, 3] tensor.

    NOTE: Params field names are stable engine API. If they change in the
    engine, update both here AND regenerate goldens with --regenerate.
    """
    p = Params(
        motion_mode=motion_mode,
        intensity=params_dict["intensity"],
        audio_band=params_dict["audio_band"],
        motion_speed=params_dict["motion_speed"],
        smoothing=params_dict["smoothing"],
        loop_safe=params_dict["loop_safe"],
        fps=params_dict["fps"],
        glitch_strength=glitch,
        bloom_strength=bloom,
        vignette_strength=vignette,
        hue_shift_strength=hue_shift,
        aspect_ratio=params_dict["aspect_ratio"],
        custom_width=params_dict["custom_width"],
        custom_height=params_dict["custom_height"],
    )
    return generate_video(image, audio, p)


def save_frame(tensor_hw3, path):
    arr = (tensor_hw3.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
    Image.fromarray(arr).save(path)


def diff_rmse(a_path, b_tensor_hw3):
    a = np.array(Image.open(a_path).convert("RGB"), dtype=np.float32)
    b = b_tensor_hw3.cpu().numpy() * 255.0
    return float(np.sqrt(((a - b) ** 2).mean()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--regenerate", action="store_true",
                    help="Overwrite goldens instead of diffing.")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text())
    # Defensive consistency check — synth-time fps and node-render fps must
    # match, or audio onset spikes land on the wrong frames during analysis.
    assert manifest["audio"]["fps"] == manifest["shared_params"]["fps"], (
        f"manifest fps mismatch: audio.fps={manifest['audio']['fps']} "
        f"!= shared_params.fps={manifest['shared_params']['fps']}"
    )
    image = load_test_image(REPO_ROOT / manifest["test_image"])
    audio = synthesize_audio(
        manifest["audio"]["duration_s"],
        manifest["audio"]["sample_rate"],
        manifest["audio"]["seed"],
        manifest["audio"]["fps"],
    )

    params = manifest["shared_params"]

    fails = []
    GOLDENS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"== Audio parity check: {len(manifest['motion_tests'])} motion modes "
          f"+ {len(manifest['overlay_tests'])} overlay tests ==")

    # Motion tests
    for test in manifest["motion_tests"]:
        mode = test["mode"]
        approximate = test.get("approximate", False)
        frames = render_frames(image, audio, params, motion_mode=mode)
        for fr in test["frames"]:
            golden_path = GOLDENS_DIR / f"motion_{mode}_{fr:03d}.png"
            if args.regenerate:
                save_frame(frames[fr], golden_path)
                print(f"  WROTE {golden_path.name}")
            else:
                if not golden_path.exists():
                    fails.append(f"MISSING {golden_path.name}")
                    continue
                rmse = diff_rmse(golden_path, frames[fr])
                tol = manifest["tolerance"]["rmse_max_python_to_python_release"]
                marker = " (approximate)" if approximate else ""
                if rmse > tol:
                    fails.append(f"FAIL {golden_path.name}: rmse={rmse:.3f} > {tol}{marker}")
                    print(f"  FAIL {golden_path.name}: rmse={rmse:.3f}{marker}")
                else:
                    print(f"  OK   {golden_path.name}: rmse={rmse:.3f}{marker}")

    # Overlay tests (each overlay alone, scale_pulse motion underneath)
    for test in manifest["overlay_tests"]:
        name = test["name"]
        strength = test["strength"]
        frames = render_frames(
            image, audio, params, motion_mode="scale_pulse",
            glitch=strength if name == "glitch" else 0.0,
            bloom=strength if name == "bloom" else 0.0,
            vignette=strength if name == "vignette" else 0.0,
            hue_shift=strength if name == "hue_shift" else 0.0,
        )
        for fr in test["frames"]:
            golden_path = GOLDENS_DIR / f"overlay_{name}_{fr:03d}.png"
            if args.regenerate:
                save_frame(frames[fr], golden_path)
                print(f"  WROTE {golden_path.name}")
            else:
                if not golden_path.exists():
                    fails.append(f"MISSING {golden_path.name}")
                    continue
                rmse = diff_rmse(golden_path, frames[fr])
                tol = manifest["tolerance"]["rmse_max_python_to_python_release"]
                if rmse > tol:
                    fails.append(f"FAIL {golden_path.name}: rmse={rmse:.3f} > {tol}")
                    print(f"  FAIL {golden_path.name}: rmse={rmse:.3f}")
                else:
                    print(f"  OK   {golden_path.name}: rmse={rmse:.3f}")

    print("==", "ALL OK" if not fails else f"{len(fails)} FAILS", "==")
    if fails and not args.regenerate:
        sys.exit(1)


if __name__ == "__main__":
    main()
