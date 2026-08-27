"""Release preflight: catches invisible junk and version drift before a release ships.

Run from the repo root:

    python scripts/release_preflight.py

Exits 0 when everything is clean, 1 with a report otherwise.

Why this exists: v1.4.72 shipped a pyproject.toml carrying a UTF-8 BOM (EF BB BF).
The BOM is invisible in every editor, in grep and in a diff, but tomllib refuses the
file with "Invalid statement (at line 1, column 1)", so every tool that reads the pack
metadata (ComfyUI core, ComfyUI-Manager, the Comfy Registry, pip) sees a broken pack.
It came from a Windows shell redirect, which defaults to UTF-8-WITH-BOM here.
Same family as the literal-control-character trap recorded in CLAUDE.md convention #25.
"""

import ast
import glob
import io
import os
import re
import subprocess
import sys

try:
    import tomllib
except ModuleNotFoundError:  # python < 3.11
    tomllib = None

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BOM = b"\xef\xbb\xbf"

# Control bytes that are never legitimate in our source, and that a shell heredoc or a
# mangled escape can inject invisibly. TAB (09), LF (0A) and CR (0D) are excluded.
BAD_CTRL = {
    0x00: "NUL",
    0x08: "BACKSPACE",
    0x0B: "VERTICAL TAB",
    0x0C: "FORM FEED",
    0x1B: "ESC",
}

# Extensions we treat as text. Anything else is assumed binary and skipped.
TEXT_EXT = {
    ".py", ".js", ".mjs", ".json", ".toml", ".md", ".css", ".html", ".svg",
    ".txt", ".yml", ".yaml", ".cfg", ".ini",
}

failures = []
checked = 0


def tracked_files():
    out = subprocess.run(
        ["git", "-C", REPO, "ls-files", "-z"], capture_output=True, check=True
    )
    return [p for p in out.stdout.decode("utf-8").split("\0") if p]


def check_files():
    """No BOM anywhere; no stray control bytes in text files."""
    global checked
    for rel in tracked_files():
        path = os.path.join(REPO, rel)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(rel)[1].lower()
        try:
            with open(path, "rb") as f:
                head = f.read(3)
                if head.startswith(BOM):
                    failures.append(
                        "%s starts with a UTF-8 BOM (EF BB BF). Rewrite it without one."
                        % rel
                    )
                if ext not in TEXT_EXT:
                    continue
                checked += 1
                data = head + f.read()
        except OSError as e:
            failures.append("%s could not be read: %s" % (rel, e))
            continue

        for i, b in enumerate(data):
            if b in BAD_CTRL:
                line = data[:i].count(b"\n") + 1
                failures.append(
                    "%s line %d contains a literal %s byte (0x%02X). "
                    "It is invisible in an editor and in grep." % (rel, line, BAD_CTRL[b], b)
                )
                break  # one report per file is enough


def check_pyproject():
    """It must parse, and its license file must exist."""
    path = os.path.join(REPO, "pyproject.toml")
    if not os.path.isfile(path):
        failures.append("pyproject.toml is missing.")
        return None
    if tomllib is None:
        failures.append("python is older than 3.11, cannot verify pyproject.toml parses.")
        return None
    try:
        with open(path, "rb") as f:
            data = tomllib.load(f)
    except Exception as e:
        failures.append(
            "pyproject.toml does not parse: %s: %s\n"
            "        Every tool that reads the pack metadata will reject it."
            % (type(e).__name__, e)
        )
        return None

    project = data.get("project", {})
    lic = project.get("license")
    if isinstance(lic, dict) and "file" in lic:
        lic_path = os.path.join(REPO, lic["file"])
        if not os.path.isfile(lic_path):
            failures.append(
                'pyproject.toml points license at "%s", which does not exist in the repo.'
                % lic["file"]
            )

    comfy = data.get("tool", {}).get("comfy", {})
    for key in ("PublisherId", "DisplayName"):
        if not comfy.get(key):
            failures.append("pyproject.toml [tool.comfy] is missing %s." % key)
    if not project.get("name"):
        failures.append("pyproject.toml [project] is missing name.")
    return data


def check_version_lockstep(data):
    """pyproject version and PIXAROMA_JS_VERSION must match (the dual-bump rule)."""
    if not data:
        return
    py_ver = data.get("project", {}).get("version")
    if not py_ver:
        failures.append("pyproject.toml [project] is missing version.")
        return

    shared = os.path.join(REPO, "js", "shared", "index.mjs")
    try:
        with open(shared, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        failures.append("js/shared/index.mjs could not be read: %s" % e)
        return

    marker = "PIXAROMA_JS_VERSION"
    idx = text.find(marker)
    if idx == -1:
        failures.append("js/shared/index.mjs does not define %s." % marker)
        return
    line = text[idx : text.find("\n", idx)]
    js_ver = line.split('"')[1] if '"' in line else None
    if js_ver != py_ver:
        failures.append(
            "version drift: pyproject.toml says %s but PIXAROMA_JS_VERSION says %s.\n"
            "        Users would see a false 'browser cache outdated' warning."
            % (py_ver, js_ver)
        )


def check_changelog(data):
    """The README changelog must mention THIS version, and the day being shipped
    must stay inside its size budget.

    Why this is a preflight gate and not a note somewhere: the dual version bump
    has never once drifted across 110 releases because THIS SCRIPT refuses the
    release when it does. The changelog rule has drifted five times in four
    months while living only in a memory note. The difference is not how well
    the rule is written, it is that one of them is executed and the other has to
    be remembered.

    Measured drift, median words per bullet by month: Apr 15, May 20, Jun 21,
    Jul 24, Aug 33 (worst 79). It climbs steadily and each hand-condense resets
    the totals without changing the writing habit, so it regrows.

    Only the NEWEST day is checked. This is a release gate, not a history audit:
    it must never block a release over an entry written months ago.
    """
    if not data:
        return
    version = data.get("project", {}).get("version")
    path = os.path.join(REPO, "README.md")
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError as e:
        failures.append("README.md could not be read: %s" % e)
        return

    heads = [n for n, l in enumerate(lines)
             if l.startswith("### **") and re.match(r"^### \*\*\w+ \d+, \d{4}", l)]
    if not heads:
        failures.append("README.md has no changelog day headings to check.")
        return

    start = heads[0]
    end = heads[1] - 1 if len(heads) > 1 else len(lines) - 1
    head = lines[start]
    body = [l for l in lines[start + 1:end + 1] if l.strip()]
    bullets = [l for l in body if l.startswith("- ")]

    if version and version not in head:
        failures.append(
            'README.md changelog does not mention v%s. Its newest entry is "%s".\n'
            "        Add this release to that day's entry (one heading per DAY, so\n"
            "        extend its version range and merge into the bullets already there)."
            % (version, head.strip("# *")[:48])
        )

    nums = [int(m.group(1)) for m in re.finditer(r"v\d+\.\d+\.(\d+)", head)]
    spanned = (max(nums) - min(nums) + 1) if nums else 1
    chars = sum(len(l) for l in body)
    per_version = chars // max(spanned, 1)
    words = sum(len(l.split()) for l in bullets)
    per_bullet = words // max(len(bullets), 1)

    # TWO caps, and they are complementary - either one alone has a hole.
    #
    # DAY TOTAL is the one the user actually asked for: "adjust so per total are
    # small for that day". A per-version budget alone lets a busy day grow
    # without limit, which is exactly the complaint - Aug 4 reached 1602 chars
    # over 6 releases while every per-version number looked healthy at 267.
    # Across 88 days the median total is 357 and the 90th percentile 914, so
    # 1000 passes nine days in ten, including tightly-written 6-release days
    # (Jul 21 = 914 across six).
    #
    # PER VERSION catches the opposite hole: a SINGLE release that is bloated on
    # its own would sit under the day cap (Aug 12 = 828 for one version). Healthy
    # is 190-270 and a new-node day earns ~300 more, so 600 cannot fire on a
    # normal release.
    if chars > 1000:
        failures.append(
            "README.md changelog for this day is %d characters (%d bullets, %d release(s)),\n"
            "        over the 1000 budget for a DAY. Re-read the WHOLE day and condense it -\n"
            "        merge your change into the bullets already there rather than appending.\n"
            "        One feature is one bullet, target ~25 words: what changed for the user,\n"
            "        not how it was built." % (chars, len(bullets), spanned)
        )
    elif per_version > 600:
        failures.append(
            "README.md changelog entry for this day is %d characters across %d version(s)\n"
            "        = %d per version, over the 600 budget. Condense it: one feature is one\n"
            "        bullet, and the target is ~25 words per bullet. What changed for the\n"
            "        user, not how it was built." % (chars, spanned, per_version)
        )
    elif per_bullet > 30:
        # Advisory only: the char budget is the hard line, this is the early
        # warning that the writing is getting wordy before the totals show it.
        print("  note: changelog bullets average %d words (target ~25). %d bullets, "
              "%d per version." % (per_bullet, len(bullets), per_version))



def check_at_mentions():
    """A bare @word in a tracked .md TAGS A REAL PERSON once GitLab/GitHub renders it.

    Found live 2026-08-26: the v1.4.120 changelog line "NEW: @tags in Music
    Prompt" rendered on GitLab as a link to an actual user account called
    @tags, complete with avatar and a Follow button - so every reader of our
    README was being shown a stranger's profile, and that account was being
    notified. We meant the @tag SYNTAX of Prompt Pixaroma, not a username.

    The fix is a code span: `@tags` renders as code and is never auto-linked.
    Every other mention of the syntax in the README already did this; exactly
    one had been written bare, which is precisely the kind of single slip a
    gate catches and a habit does not.

    Deliberately NOT flagged: an @ inside a URL (youtube.com/@pixaroma) or
    inside an existing code span, neither of which auto-links.
    """
    pat = re.compile(r'(?<![\w/])@([A-Za-z][A-Za-z0-9_.-]{1,})')
    for rel in tracked_files():
        if not rel.lower().endswith(".md"):
            continue
        try:
            with open(os.path.join(REPO, rel), "r", encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        # blank out what cannot auto-link, so only real mentions survive
        text = re.sub(r'`[^`\n]*`', " ", text)
        text = re.sub(r'https?://\S+', " ", text)
        for m in pat.finditer(text):
            line = text[:m.start()].count("\n") + 1
            failures.append(
                "%s:%d has a bare @%s, which GitLab and GitHub render as a link to the\n"
                "        USER of that name (it tagged a real stranger's account in the\n"
                "        changelog). Wrap it in backticks so it stays code: `@%s`."
                % (rel, line, m.group(1), m.group(1))
            )


def check_css_prefix_collisions():
    """Two node directories DEFINING the same .pix-xx- prefix share a namespace.

    Every node's CSS is injected into ONE shared page, once per node type on
    first instantiation, and it STAYS after the node is removed. So two nodes
    on the same prefix are two nodes writing the same rules, and the only
    thing deciding which wins is INJECTION ORDER (identical specificity means
    the later rule wins per-property).

    Found live 2026-08-27, after being reported twice as "Prompt Multi rows
    crushed and overlapping". Monitor used .pix-pm- for performance monitor
    while Prompt Multi used .pix-pm- for prompt multi, and Monitor's
    `.pix-pm-row { height: calc(13px * var(--pm-s,1)) }` - correct for its own
    13px VRAM readout lines - collapsed Prompt Multi's rows to 13px whenever a
    Monitor node happened to load first. It presented as an environment bug:
    it came and went, changing workflows triggered it, a refresh cleared it,
    and it would not reproduce on a canvas holding only a Prompt Multi. Two
    plausible-but-wrong theories were shipped before the real cause was found.

    A convention drifts; a gate does not. Monitor is now .pix-mon-.

    Directories that legitimately publish shared classes are exempt.
    """
    SHARED = {"shared", "framework", "help_toolbar", "node_colors"}
    # a RULE DEFINITION, not a mention in a comment or a querySelector call
    rule = re.compile(r"(\.pix-[a-z0-9]+-)[a-z0-9_-]*[^{}\n]{0,80}\{")
    owners = {}
    for rel in tracked_files():
        parts = rel.replace("\\", "/").split("/")
        if len(parts) < 2 or parts[0] != "js":
            continue
        if not (rel.endswith(".mjs") or rel.endswith(".js")):
            continue
        node_dir = parts[1]
        if node_dir in SHARED:
            continue
        try:
            with open(os.path.join(REPO, rel), "r", encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        for m in rule.finditer(text):
            owners.setdefault(m.group(1), set()).add(node_dir)
    for prefix, dirs in sorted(owners.items()):
        if len(dirs) > 1:
            failures.append(
                "CSS prefix %s is defined by more than one node: %s.\n"
                "        They share one namespace on the page, so whichever node loads\n"
                "        LAST silently restyles the other. Give each its own prefix\n"
                "        (prefer the node's short NAME over initials, e.g. pix-mon-\n"
                "        not pix-pm-). See CLAUDE.md node UI convention #38."
                % (prefix, ", ".join(sorted(dirs)))
            )


def _module_int(tree, want):
    """Module-level `want = <int literal>` in an already-parsed tree, else None."""
    for stmt in tree.body:
        if (isinstance(stmt, ast.Assign) and len(stmt.targets) == 1
                and getattr(stmt.targets[0], "id", None) == want
                and isinstance(stmt.value, ast.Constant)
                and isinstance(stmt.value.value, int)
                and not isinstance(stmt.value.value, bool)):
            return stmt.value.value
    return None


def _resolve_int(tree, name):
    """Resolve a bare NAME to an int: defined here, or imported from a sibling.

    Only a module-level int LITERAL counts, in this file or in the one relative
    import that names it. Anything else returns None and the caller skips the
    value, so this can never invent a length and fail a clean release.

    KNOWN LIMIT: the FIRST module-level binding wins. A later rebind, an
    `x += 1`, or a class-body shadow of the same name would be read wrong and
    could fail a clean release. Left as is deliberately - every count constant
    in the pack (NUM, MAX_SLIDERS, MAX_ROWS, MAX_OUTS) is bound exactly once at
    module level, and a binding-counter to close it is easy to get subtly wrong
    in the direction that blocks a good release.
    """
    here = _module_int(tree, name)
    if here is not None:
        return here
    for stmt in tree.body:
        if not isinstance(stmt, ast.ImportFrom) or stmt.level != 1 or not stmt.module:
            continue
        if not any(a.name == name and a.asname is None for a in stmt.names):
            continue
        sib = os.path.join(REPO, "nodes", stmt.module + ".py")
        try:
            with io.open(sib, encoding="utf-8") as fh:
                return _module_int(ast.parse(fh.read()), name)
        except (SyntaxError, ValueError, UnicodeDecodeError, OSError):
            return None
    return None


def _static_len(value, tree):
    """Length of a RETURN_* value when it can be known statically, else None."""
    if isinstance(value, (ast.Tuple, ast.List)):
        return len(value.elts)
    # `(ANY,) * MAX_OUTS` - the shape Dropdown Pixaroma uses. Without this the
    # check silently skips the ONE list that moves when the cap is raised, which
    # is measurably the mistake it was written to catch: setting MAX_OUTS to 5
    # left RETURN_NAMES and OUTPUT_TOOLTIPS at 4 and preflight still said OK.
    if isinstance(value, ast.BinOp) and isinstance(value.op, ast.Mult):
        for seq, other in ((value.left, value.right), (value.right, value.left)):
            if not isinstance(seq, (ast.Tuple, ast.List)):
                continue
            if isinstance(other, ast.Constant) and isinstance(other.value, int) \
                    and not isinstance(other.value, bool):
                return len(seq.elts) * other.value
            if isinstance(other, ast.Name):
                n = _resolve_int(tree, other.id)
                if n is not None:
                    return len(seq.elts) * n
    return None


def check_output_arity():
    """A node's RETURN_TYPES / RETURN_NAMES / OUTPUT_TOOLTIPS must be the same length.

    ComfyUI sends the three lists to the browser separately and zips them BY
    INDEX, so a mismatch is silent: outputs simply lose their names or their
    tooltips. Dropdown Pixaroma builds RETURN_TYPES from a MAX_OUTS constant
    while the other two are literals, so raising the cap without editing them is
    an easy mistake to make and an invisible one to ship.

    This lives HERE rather than as an assert in the module, deliberately. The
    node is imported by __init__.py with no try/except, and ComfyUI's
    load_custom_node catches the failure with a logging.warning and moves on -
    so an assert would make every node in the pack disappear over a console line
    nobody reads. Failing the RELEASE instead costs nothing, covers every node
    rather than the one that carried the assert, and survives `python -O`.

    Parsed rather than imported: this script must not need torch or ComfyUI.
    """
    for path in sorted(glob.glob(os.path.join(REPO, "nodes", "node_*.py"))):
        try:
            with io.open(path, encoding="utf-8") as fh:
                tree = ast.parse(fh.read())
        except (SyntaxError, ValueError, UnicodeDecodeError, OSError) as exc:
            # NOT just SyntaxError. check_files() runs first but reads in BINARY
            # and only tests for a UTF-8 BOM plus a small control-byte set, so a
            # stray \xff sails past it and lands here as a UnicodeDecodeError.
            # A raw traceback in exactly the invisible-byte scenario this script
            # exists to explain would be the worst possible output. ValueError
            # is belt-and-braces for older interpreters: measured, BOTH 3.12.10
            # and 3.14.4 raise SyntaxError for a null byte, and
            # UnicodeDecodeError is itself a ValueError subclass.
            failures.append("%s could not be parsed (%s): %s"
                            % (os.path.basename(path), type(exc).__name__, exc))
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            lens = {}
            for stmt in node.body:
                if not isinstance(stmt, ast.Assign) or len(stmt.targets) != 1:
                    continue
                name = getattr(stmt.targets[0], "id", None)
                if name not in ("RETURN_TYPES", "RETURN_NAMES", "OUTPUT_TOOLTIPS"):
                    continue
                # A literal tuple/list, or a `(X,) * N` repeat whose N resolves
                # to a module-level int. Anything else is skipped, so a value
                # this script cannot read is never guessed at.
                n = _static_len(stmt.value, tree)
                if n is not None:
                    lens[name] = n
            counted = set(lens.values())
            if len(counted) > 1:
                failures.append(
                    "%s.%s: %s disagree in length (%s). ComfyUI zips them by index, "
                    "so outputs would silently lose names or tooltips."
                    % (os.path.basename(path), node.name, " / ".join(sorted(lens)),
                       ", ".join("%s=%d" % kv for kv in sorted(lens.items()))))


def main():
    check_files()
    data = check_pyproject()
    check_version_lockstep(data)
    check_changelog(data)
    check_at_mentions()
    check_output_arity()
    check_css_prefix_collisions()

    if failures:
        print("RELEASE PREFLIGHT FAILED (%d problem%s)\n"
              % (len(failures), "" if len(failures) == 1 else "s"))
        for f in failures:
            print("  - %s" % f)
        print("\nDo not release until these are clean.")
        return 1

    ver = (data or {}).get("project", {}).get("version", "?")
    print("Release preflight OK. %d text files checked, version %s in lockstep." % (checked, ver))
    return 0


if __name__ == "__main__":
    sys.exit(main())
