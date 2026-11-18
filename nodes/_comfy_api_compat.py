"""ComfyUI's node API (comfy_api), reached through a PINNED version first.

ComfyUI ships its node API in numbered versions beside `comfy_api.latest`
(comfy_api/version_list.py lists the ones it keeps). `latest` is documented as
unstable: it "will point to the latest numbered API that is still under
development" (docs.comfy.org, V3 migration), and a V4 API was in draft in
November 2026. So every name the pack takes from comfy_api is looked up in the
pinned version first and only then in `latest`, and a name that no version has
comes back as None, for the caller to handle with its own fallback or its own
clear message.

Measured 2026-11-18 on ComfyUI 0.45.2: v0_0_2 subclasses latest's Types and
InputImpl and re-exports its io, so today both routes give the SAME objects.
That matters: core's own 3D nodes isinstance-check Types.File3D.

The lookup goes NAME by name, never "the first module that imports": a pinned
version that exists but lacks a name (an older ComfyUI from before the 3D
types) still falls through to `latest` for that name.

Nothing is imported at module level, so importing this file can never stop the
pack loading. Guarded by D:\\Claude Tests\\_comfy_api_guard\\guard_test.py.
"""
from __future__ import annotations

import importlib

# Pinned first, `latest` last.
API_MODULES = ("comfy_api.v0_0_2", "comfy_api.latest")


def _lookup(module_name, path):
    value = importlib.import_module(module_name)
    for part in path.split("."):
        value = getattr(value, part)
    return value


def api_attr(path, modules=API_MODULES):
    """The object at the dotted `path` ("Types.File3D", "io") in the first of
    `modules` that has it, or None when none does."""
    for module_name in modules:
        try:
            return _lookup(module_name, path)
        except Exception:
            continue
    return None


def api_attrs(path, modules=API_MODULES):
    """Every DIFFERENT object at `path` across `modules`, in order, for an
    isinstance check that has to accept whichever class made the value."""
    found = []
    for module_name in modules:
        try:
            value = _lookup(module_name, path)
        except Exception:
            continue
        if not any(value is seen for seen in found):
            found.append(value)
    return found
