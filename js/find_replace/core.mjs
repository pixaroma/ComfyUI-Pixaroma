// Find & Replace Pixaroma - state + replace logic + word-diff.
//
// State lives on node.properties.findReplaceState:
//   { version:1, caseSensitive, wholeWord, regex, tidy, rules:[{id,enabled,find,replace}] }
// LiteGraph serializes node.properties natively. The graphToPrompt hook in
// index.js packs this (minus the preview) into the hidden FindReplaceState input.
//
// The on-node preview is driven by applyRulesJS(), a 1:1 mirror of
// nodes/node_find_replace.py::_apply_rules. Python is authoritative; literal
// mode is exact, regex backrefs differ in syntax (\1 Python / $1 JS) and JS
// converts them best-effort.

export const STATE_PROP = "findReplaceState";
export const PREVIEW_PROP = "findReplacePreview";

let _idCounter = 0;
function nextId() {
  _idCounter += 1;
  return `fr${Date.now().toString(36)}_${_idCounter}`;
}

export function freshRule(overrides = {}) {
  return { id: nextId(), enabled: true, find: "", replace: "", ...overrides };
}

export function defaultState() {
  return {
    version: 1,
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    tidy: true,
    rules: [freshRule()],
  };
}

export function readState(node) {
  const s = node.properties?.[STATE_PROP];
  if (!s || typeof s !== "object") return defaultState();
  if (!Array.isArray(s.rules) || s.rules.length === 0) return defaultState();
  if (typeof s.caseSensitive !== "boolean") s.caseSensitive = false;
  if (typeof s.wholeWord !== "boolean") s.wholeWord = false;
  if (typeof s.regex !== "boolean") s.regex = false;
  if (typeof s.tidy !== "boolean") s.tidy = true;
  for (const row of s.rules) {
    if (typeof row.id !== "string" || !row.id) row.id = nextId();
    if (typeof row.enabled !== "boolean") row.enabled = true;
    if (typeof row.find !== "string") row.find = "";
    if (typeof row.replace !== "string") row.replace = "";
  }
  return s;
}

export function writeState(node, state) {
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = state;
}

export function restoreFromProperties(node) {
  writeState(node, readState(node));
}

// ---- mutators -------------------------------------------------------------

export function addRule(node) {
  const state = readState(node);
  state.rules.push(freshRule());
  writeState(node, state);
}

export function deleteRule(node, id) {
  const state = readState(node);
  if (state.rules.length <= 1) return;
  state.rules = state.rules.filter((r) => r.id !== id);
  writeState(node, state);
}

export function toggleRuleEnabled(node, id) {
  const state = readState(node);
  const row = state.rules.find((r) => r.id === id);
  if (row) row.enabled = !row.enabled;
  writeState(node, state);
}

export function setFind(node, id, v) {
  const state = readState(node);
  const row = state.rules.find((r) => r.id === id);
  if (row) row.find = String(v || "");
  writeState(node, state);
}

export function setReplace(node, id, v) {
  const state = readState(node);
  const row = state.rules.find((r) => r.id === id);
  if (row) row.replace = String(v || "");
  writeState(node, state);
}

export function setToggle(node, key) {
  const state = readState(node);
  if (key in state) state[key] = !state[key];
  writeState(node, state);
}

export function reorderRules(node, fromIdx, toIdx) {
  const state = readState(node);
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= state.rules.length) return;
  if (toIdx < 0 || toIdx >= state.rules.length) return;
  const [moved] = state.rules.splice(fromIdx, 1);
  state.rules.splice(toIdx, 0, moved);
  writeState(node, state);
}

export function resetToDefault(node) {
  writeState(node, defaultState());
}

// ---- preview persistence --------------------------------------------------
// Stored separately from the rules state so it is NOT injected into the prompt.

export function getPreviewInput(node) {
  const p = node.properties?.[PREVIEW_PROP];
  if (!p || typeof p !== "object" || typeof p.input !== "string") return null;
  return p;
}

const PREVIEW_CAP = 4000;
export function setPreviewInput(node, input, truncated) {
  node.properties = node.properties || {};
  // Self-protecting cap (Python already caps at 4000, but never trust the
  // caller): the sample is serialized into the workflow JSON, so bound it here
  // too so a future uncapped caller can't bloat the saved file.
  const s = String(input == null ? "" : input);
  const over = s.length > PREVIEW_CAP;
  node.properties[PREVIEW_PROP] = {
    input: over ? s.slice(0, PREVIEW_CAP) : s,
    truncated: !!truncated || over,
  };
}

// ---- replace logic (mirror of node_find_replace.py::_apply_rules) ---------

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tidy(s) {
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/[ \t]+,/g, ",");
  s = s.replace(/,(?:[ \t]*,)+/g, ",");
  s = s.replace(/[ \t]+(\r?\n)/g, "$1");
  s = s.replace(/^[ \t]*,[ \t]*/, "");
  s = s.replace(/,[ \t]*$/, "");
  return s.trim();
}

// Translate a Python re.sub() replacement template into a JS String.replace
// replacement string, so the preview matches the authoritative Python run.
// Handles: \1..\99 and \g<name>/\g<number> backreferences, the \n \t \r \f \v
// and \\ character escapes (Python processes these in the replacement; JS does
// NOT), and a literal $ (special in JS, literal in Python -> escaped to $$).
function pyTemplateToJs(repl) {
  let out = "";
  for (let i = 0; i < repl.length; i++) {
    const ch = repl[i];
    if (ch === "$") { out += "$$"; continue; }      // literal $ (Python keeps it)
    if (ch !== "\\") { out += ch; continue; }
    const nx = repl[i + 1];
    if (nx === undefined) { out += "\\"; break; }    // trailing backslash -> literal
    if (nx === "\\") { out += "\\"; i++; continue; } // \\ -> one literal backslash
    if (nx >= "1" && nx <= "9") {                    // \1..\99 group reference
      let num = nx; i++;
      if (repl[i + 1] >= "0" && repl[i + 1] <= "9") { num += repl[i + 1]; i++; }
      out += "$" + num;
      continue;
    }
    if (nx === "g") {                                // \g<name> or \g<number>
      const m = /^\\g<([^>]+)>/.exec(repl.slice(i));
      if (m) {
        const ref = m[1];
        out += /^\d+$/.test(ref) ? "$" + ref : "$<" + ref + ">";
        i += m[0].length - 1;
        continue;
      }
      out += "g"; i++; continue;                     // malformed \g -> best effort
    }
    const map = { n: "\n", t: "\t", r: "\r", f: "\f", v: "\v" };
    if (nx in map) { out += map[nx]; i++; continue; }
    out += nx; i++;                                   // unknown escape -> literal char
  }
  return out;
}

// Python's \b/\w are Unicode-aware for str patterns; JS's \b is ASCII-only.
// For whole-word literal matching we build explicit Unicode-aware boundary
// assertions so accented / non-Latin words match the same as the Python run.
const _WORD = "\\p{L}\\p{N}_";
function isWordChar(c) {
  return /[\p{L}\p{N}_]/u.test(c || "");
}

// Returns { output, warnings:[string] }.
export function applyRulesJS(text, state) {
  const rules = Array.isArray(state.rules) ? state.rules : [];
  const cs = !!state.caseSensitive;
  const ww = !!state.wholeWord;
  const rx = !!state.regex;
  const td = state.tidy !== false;
  const warnings = [];
  let out = String(text == null ? "" : text);
  const baseFlags = "g" + (cs ? "" : "i");

  rules.forEach((rule, idx) => {
    if (!rule || rule.enabled === false) return;
    const find = rule.find || "";
    if (!find) return;
    const repl = rule.replace || "";
    try {
      if (rx) {
        const re = new RegExp(find, baseFlags);
        out = out.replace(re, pyTemplateToJs(repl));
      } else {
        let pat = escapeRegex(find);
        let flags = baseFlags;
        if (ww) {
          // Mirror Python's \bTERM\b: the assertion on each side depends on
          // whether the edge char is itself a word char, so it matches Python
          // for any TERM (incl. punctuation edges), with Unicode word chars.
          const lead = isWordChar(find[0]) ? `(?<![${_WORD}])` : `(?<=[${_WORD}])`;
          const tail = isWordChar(find[find.length - 1]) ? `(?![${_WORD}])` : `(?=[${_WORD}])`;
          pat = lead + pat + tail;
          flags += "u";
        }
        const re = new RegExp(pat, flags);
        // Literal replacement: insert repl verbatim (only $ is special in JS;
        // backslash is literal, matching Python's backslash-doubled safe_repl).
        out = out.replace(re, repl.replace(/\$/g, "$$$$"));
      }
    } catch (_e) {
      warnings.push(`Rule ${idx + 1}: invalid regex`);
    }
  });

  if (td) out = tidy(out);
  return { output: out, warnings };
}

// ---- word-level diff for the before/after highlight -----------------------

function tokenize(s) {
  return s.match(/\s+|[^\s]+/g) || [];
}

// LCS-based token diff. Returns [{t:'eq'|'del'|'ins', s}].
export function diffTokens(aStr, bStr) {
  const a = tokenize(aStr);
  const b = tokenize(bStr);
  const n = a.length;
  const m = b.length;
  // Guard against pathological sizes (preview input is capped, but be safe).
  if (n * m > 4_000_000) {
    return [{ t: "del", s: aStr }, { t: "ins", s: bStr }];
  }
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: "eq", s: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ t: "del", s: a[i] });
      i++;
    } else {
      out.push({ t: "ins", s: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ t: "del", s: a[i++] });
  while (j < m) out.push({ t: "ins", s: b[j++] });
  return out;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
