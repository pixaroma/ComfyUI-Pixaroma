"""Standalone checks for nodes/_font_catalog.py — runs without ComfyUI.
Run with the ComfyUI python (it has PIL):  python scripts/font_catalog_check.py
Exits 0 and prints CATALOG PASS on success; raises AssertionError otherwise.
"""
import os
import sys
import shutil
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "nodes"))
import _font_catalog as fc  # noqa: E402

# 1) weight derivation
assert fc.derive_weight("Thin") == 100
assert fc.derive_weight("ExtraLight") == 200
assert fc.derive_weight("Light") == 300
assert fc.derive_weight("Regular") == 400
assert fc.derive_weight("") == 400
assert fc.derive_weight("Medium") == 500
assert fc.derive_weight("SemiBold") == 600
assert fc.derive_weight("Semi Bold") == 600
assert fc.derive_weight("Bold") == 700
assert fc.derive_weight("Extra Bold") == 800
assert fc.derive_weight("Black") == 900
assert fc.derive_weight("Heavy") == 900

# 2) italic detection
assert fc.derive_italic("Bold Italic") is True
assert fc.derive_italic("Oblique") is True
assert fc.derive_italic("Regular") is False

# 3) builtin catalog has Inter and tags source=builtin
builtin = fc.builtin_catalog()
assert any(f["id"] == "Inter" for f in builtin), "Inter missing from builtin catalog"
assert all(f["source"] == "builtin" for f in builtin)

# 4) scan a temp dir containing two real bundled fonts -> two custom families
tmp = tempfile.mkdtemp(prefix="pixfonts_")
try:
    shutil.copy(str(fc.BUILTIN_FONTS_DIR / "Anton-Regular.ttf"), os.path.join(tmp, "Anton-Regular.ttf"))
    shutil.copy(str(fc.BUILTIN_FONTS_DIR / "BebasNeue-Regular.ttf"), os.path.join(tmp, "BebasNeue-Regular.ttf"))
    scanned = fc.scan_custom_dirs([tmp])
    assert len(scanned) == 2, f"expected 2 custom families, got {len(scanned)}"
    assert all(f["source"] == "custom" and f["category"] == "custom" for f in scanned)
    assert all(len(f["weights"]) >= 1 for f in scanned)

    # 5) fingerprint cache: same object back on second call, new after invalidate
    a = fc.custom_catalog([tmp])
    b = fc.custom_catalog([tmp])
    assert a is b, "custom_catalog should return the cached list unchanged"
    fc.invalidate()
    c = fc.custom_catalog([tmp])
    assert c is not a, "after invalidate, a fresh list should be built"
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# 6) id collision: a custom family named 'Inter' must NOT reuse the builtin id
custom_fake = [{
    "id": None, "label": "Inter", "category": "custom", "source": "custom",
    "_family": "Inter", "weights": [{"weight": 400, "italic": False, "file": "x.ttf"}],
}]
merged = fc._assign_ids_and_sort(fc.builtin_catalog(), custom_fake)
inter_ids = [f["id"] for f in merged if f["label"] == "Inter"]
assert "Inter" in inter_ids and any(i != "Inter" for i in inter_ids), \
    f"collision not resolved: {inter_ids}"

# 7) custom group sorts last
cats = [f["category"] for f in merged]
last_non_custom = max((i for i, c in enumerate(cats) if c != "custom"), default=-1)
first_custom = min((i for i, c in enumerate(cats) if c == "custom"), default=len(cats))
assert first_custom > last_non_custom, "custom fonts should sort after builtins"

print("CATALOG PASS")
