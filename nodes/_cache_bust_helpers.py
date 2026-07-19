"""Import-URL version stamping for the plugin's own ES modules.

Why: "Cache-Control: no-store" on our .mjs responses (server_routes.py) only
helps when the browser actually REQUESTS the file. A browser that heuristically
cached a pre-fix .mjs treats it as fresh and never asks the server again, so
users stayed stale until a manual hard refresh (and lazily-imported modules
needed MORE hard refreshes). The only server-side move that defeats an
already-poisoned cache is changing the URL itself: stamp ?v=<plugin version>
onto every RELATIVE .mjs import specifier as the file is served. After an
update the version bumps, every internal module URL is one the browser has
never seen, and the whole tree is fetched fresh with zero user action - on
plain browsers, ComfyUI Desktop, and Mac alike.

Kept dependency-free so it can be unit-tested standalone (no ComfyUI imports).

Scope rules (each deliberate - do not widen):
- Only specifiers starting "./" or "../" AND ending ".mjs" are stamped. That is
  exactly our own module convention. Core files ("/scripts/app.js", relative
  "../../../../scripts/app.js") end in .js and are NEVER stamped - stamping one
  would make the browser load a second instance of ComfyUI's app module.
- The vendored three.js tree is loaded via absolute "/pixaroma/vendor/..." URLs
  (computed, not string literals), so it is naturally out of reach; it has its
  own immutable-cache headers.
- Every importer must receive the SAME version string in one page load, or two
  URLs for one module would create two module instances (duplicate registries).
  The caller passes one version per request; pyproject.toml only changes when
  files on disk change, so a mid-session mix cannot happen in practice.
"""

import re

# The module specifier of a relative .mjs import, in every form we write:
#   import { x } from "./a.mjs";      import "../b.mjs";
#   export * from "./c.mjs";          const m = await import("./d.mjs");
# Multi-line dynamic imports match too (\s covers newlines). Alternation order
# matters: the dynamic-import branch (with the paren) is tried before the bare
# static-import branch.
_IMPORT_RE = re.compile(
    r"""(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\.?/[^"'\n]+?\.mjs)\2"""
)

_SAFE_VERSION_RE = re.compile(r"[^A-Za-z0-9._-]")


def stamp_import_urls(text, version):
    """Return `text` with ?v=<version> appended to every relative .mjs import."""
    v = _SAFE_VERSION_RE.sub("-", str(version or "")) or "0"
    return _IMPORT_RE.sub(
        lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={v}{m.group(2)}", text
    )
