"""Find & Replace Pixaroma - intercept a STRING and apply find/replace rules.

Backend contract:
- 1 required STRING input (text, forceInput) carrying the upstream text.
- 1 hidden STRING input (FindReplaceState) carrying the rules + global toggles.
- 1 STRING output (text) carrying the edited result.

The replace logic mirrors js/find_replace/core.mjs (applyRulesJS) so the on-node
live preview matches the real output. THIS Python implementation is the
authoritative one; literal mode is exact, regex backref syntax differs (\\1 here
vs $1 in JS) and is a documented preview-parity carve-out.
"""
import json
import re

# Chars of input/output stored + sent for the on-node preview. The actual STRING
# output passed downstream is NEVER capped - only the preview sample is bounded
# so it can't bloat the workflow file or the websocket payload.
_PREVIEW_CAP = 4000


class PixaromaFindReplace:
    DESCRIPTION = (
        "Find and Replace Pixaroma - sit this node in the wire between a text "
        "source (an LLM node, Show Text, Text Pixaroma, any STRING output) and "
        "whatever uses the text. It intercepts the text, applies your "
        "find/replace rules, and passes the edited result on. It also previews "
        "the before/after right on the node.\n\n"
        "Add one rule per edit: type what to find and what to replace it with. "
        "Leave the replace side empty to delete the found text. Toggle a rule "
        "off to skip it without deleting it; drag the handle to reorder. Rules "
        "apply top to bottom.\n\n"
        "Global toggles: Case (match upper/lowercase exactly), Whole word (only "
        "match whole words, so 'art' does not hit 'artist'), Regex (treat find "
        "as a regular expression), and Tidy (after the edits, collapse double "
        "spaces and fix stray or double commas)."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "The text to edit. Wire a STRING output (an LLM "
                            "node, Show Text Pixaroma, Text Pixaroma, etc.) into "
                            "this input. The node edits it on the way through."
                        ),
                    },
                ),
            },
            "hidden": {"FindReplaceState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = (
        "The text after all your find/replace rules (and Tidy) are applied.",
    )
    FUNCTION = "apply"
    CATEGORY = "👑 Pixaroma"
    OUTPUT_NODE = True

    def apply(self, text, FindReplaceState="{}"):
        text = text if isinstance(text, str) else ("" if text is None else str(text))
        state = self._parse_state(FindReplaceState)
        result, warnings = _apply_rules(text, state)
        ui = {
            "pixaroma_find_replace": [
                {
                    "input": text[:_PREVIEW_CAP],
                    "output": result[:_PREVIEW_CAP],
                    "truncated": len(text) > _PREVIEW_CAP or len(result) > _PREVIEW_CAP,
                    "warnings": warnings,
                }
            ]
        }
        return {"ui": ui, "result": (result,)}

    @staticmethod
    def _parse_state(raw):
        try:
            s = json.loads(raw) if isinstance(raw, str) else {}
            return s if isinstance(s, dict) else {}
        except (ValueError, TypeError):
            return {}


def _unbounded_quant_at(src, j):
    """True if an unbounded quantifier (* + or {n,}) starts at index j."""
    if j >= len(src):
        return False
    c = src[j]
    if c == "*" or c == "+":
        return True
    return re.match(r"\{\d*,\}", src[j:]) is not None


def _is_catastrophic_regex(src):
    """Heuristic ReDoS guard - MIRROR of js/find_replace/core.mjs::isCatastrophicRegex.

    Flags a NESTED unbounded quantifier (an unbounded-quantified group whose body
    also contains an unbounded quantifier, e.g. (a+)+ (a*)* (.*)* (\\w+)+ ), which
    can backtrack exponentially. This runs server-side on every Run with NO
    timeout, so such a pattern would wedge the worker; we skip the rule + warn
    instead. Heuristic, not complete; low false-positive rate (a nested unbounded
    quantifier is always redundant, so real patterns don't use it). Must stay in
    lockstep with the JS version so the on-node preview matches the run.
    """
    stack = []  # one dict per open group; "inner" = body has an unbounded quant
    escaped = False
    in_class = False
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if escaped:
            escaped = False
            i += 1
            continue
        if c == "\\":
            escaped = True
            i += 1
            continue
        if in_class:
            if c == "]":
                in_class = False
            i += 1
            continue
        if c == "[":
            in_class = True
            i += 1
            continue
        if c == "(":
            stack.append({"inner": False})
            i += 1
            continue
        if c == ")":
            grp = stack.pop() if stack else {"inner": False}
            quant = _unbounded_quant_at(src, i + 1)
            if quant and grp["inner"]:
                return True
            if quant and stack:
                stack[-1]["inner"] = True
            i += 1
            continue
        if _unbounded_quant_at(src, i):
            if stack:
                stack[-1]["inner"] = True
            i += 1
            continue
        i += 1
    return False


def _apply_rules(text, state):
    """Apply the enabled rules in order. Returns (result, warnings)."""
    rules = state.get("rules", [])
    case_sensitive = bool(state.get("caseSensitive", False))
    whole_word = bool(state.get("wholeWord", False))
    use_regex = bool(state.get("regex", False))
    tidy = bool(state.get("tidy", True))
    warnings = []

    out = text
    if isinstance(rules, list):
        for idx, rule in enumerate(rules):
            if not isinstance(rule, dict):
                continue
            if not rule.get("enabled", True):
                continue
            # Coerce non-string find/replace to "" (mirrors the JS readState
            # coercion) so a malformed/hand-edited state with a numeric or list
            # find/replace can't crash apply() with a TypeError/AttributeError -
            # the only exception caught below is re.error.
            find = rule.get("find", "")
            if not isinstance(find, str):
                find = ""
            if not find:
                continue
            repl = rule.get("replace", "")
            if not isinstance(repl, str):
                repl = ""
            flags = 0 if case_sensitive else re.IGNORECASE
            try:
                if use_regex:
                    if _is_catastrophic_regex(find):
                        warnings.append(
                            "Rule %d: pattern may be catastrophically slow "
                            "(nested quantifier) - simplify it" % (idx + 1)
                        )
                        continue
                    out = re.sub(find, repl, out, flags=flags)
                else:
                    pattern = re.escape(find)
                    if whole_word:
                        pattern = r"\b" + pattern + r"\b"
                    # Escape backslashes in the replacement so a literal string
                    # containing "\1" or "\g<1>" is not interpreted as a backref.
                    safe_repl = repl.replace("\\", "\\\\")
                    out = re.sub(pattern, safe_repl, out, flags=flags)
            except re.error as exc:
                warnings.append("Rule %d: invalid regex (%s)" % (idx + 1, exc))
                continue

    if tidy:
        out = _tidy(out)
    return out, warnings


def _tidy(s):
    """Conservative cleanup. Mirrors tidy() in js/find_replace/core.mjs.

    Collapses runs of spaces/tabs and fixes comma spacing. Interior newlines
    are preserved (never collapsed); the final strip() trims leading/trailing
    whitespace - including newlines - from the whole string.
    """
    # Collapse runs of spaces/tabs to a single space.
    s = re.sub(r"[ \t]+", " ", s)
    # Space(s)/tab(s) before a comma -> drop them.
    s = re.sub(r"[ \t]+,", ",", s)
    # Collapse repeated commas (optionally space/tab separated) into one.
    s = re.sub(r",(?:[ \t]*,)+", ",", s)
    # Trim trailing spaces/tabs at the end of each line.
    s = re.sub(r"[ \t]+(\r?\n)", r"\1", s)
    # Drop a leading comma left behind by a deletion.
    s = re.sub(r"^[ \t]*,[ \t]*", "", s)
    # Drop a dangling trailing comma left behind by a deletion.
    s = re.sub(r",[ \t]*$", "", s)
    return s.strip()


NODE_CLASS_MAPPINGS = {"PixaromaFindReplace": PixaromaFindReplace}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaFindReplace": "Find and Replace Pixaroma"}
