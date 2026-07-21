// Prompt Pixaroma - @tag -> snippet-text expansion AND *category -> random-tag
// wildcards (one level, no nesting).
//
// Used by BOTH the node body (live "Show expanded" preview + coloured highlighting)
// and the app.graphToPrompt hook (the real swap at queue time). Keep it pure so the
// two never disagree. The RANDOMNESS for *wildcards does NOT live here - the caller
// passes a resolveWild() callback (a random pick at run time, a stable placeholder
// in the preview), so expand.mjs stays deterministic + testable.

import { getTags } from "./library.mjs";

// @name = a saved tag; *name = a random-from-category wildcard. name = letters /
// digits / _ / - .
const TOKEN_RE = /([@*])([a-zA-Z0-9_\-]+)/g;

// Left-to-right scan for @tag and *wild tokens. A token counts when it's at the
// very start, after a NON-word char (space, comma, ...), OR immediately after
// another token (a chain like @a@b / @a*b). This lets adjacent tokens work while
// leaving an email's "user@name" (and arithmetic like "2*2") alone - their symbol
// sits after a word char with no preceding token. Returns
// [{kind:'tag'|'wild', sym, name, start, end, raw}]. Shared by scanTags / scanWilds
// / expandAll AND the node's highlight backdrop so all of them agree on exactly
// which tokens count.
export function scanTokens(text) {
  const out = [];
  if (typeof text !== "string" || !/[@*]/.test(text)) return out;
  TOKEN_RE.lastIndex = 0;
  let m, lastEnd = -1;
  while ((m = TOKEN_RE.exec(text))) {
    const at = m.index;
    const prev = at > 0 ? text[at - 1] : "";
    // Unicode-aware: a letter/number/combining-mark/_ before the symbol (incl.
    // accented / CJK, precomposed OR decomposed) means it's an email local part or
    // arithmetic, not a token - unless we're chaining off a real token.
    const isTok = !prev || !/[\p{L}\p{N}\p{M}_]/u.test(prev) || at === lastEnd;
    if (isTok) {
      out.push({ kind: m[1] === "@" ? "tag" : "wild", sym: m[1], name: m[2], start: at, end: at + m[0].length, raw: m[0] });
      lastEnd = at + m[0].length; // a following @/* can chain off this one
    }
    // a non-token @/* does NOT set lastEnd, so it can't start a chain
  }
  return out;
}

// @tags only (back-compat: same shape the highlight/preview/run used before).
export function scanTags(text) { return scanTokens(text).filter((t) => t.kind === "tag"); }
// *wildcards only.
export function scanWilds(text) { return scanTokens(text).filter((t) => t.kind === "wild"); }

// Expand @tags AND resolve *wildcards. `resolveWild(name)` returns the replacement
// string, or null/undefined to leave the *token literal (unknown / empty category);
// omit it to leave every *wildcard literal (pure @tag expansion). The caller owns
// the randomness. Returns { out, knownTags, unknownTags, knownWilds, unknownWilds }.
export function expandAll(text, opts = {}) {
  const { tags, resolveWild } = opts;
  if (typeof text !== "string" || !/[@*]/.test(text)) {
    return { out: typeof text === "string" ? text : "", knownTags: [], unknownTags: [], knownWilds: [], unknownWilds: [] };
  }
  const list = tags || getTags();
  const map = new Map();
  for (const t of list) map.set(t.name.toLowerCase(), t.text);
  const toks = scanTokens(text);
  const knownTags = [], unknownTags = [], knownWilds = [], unknownWilds = [];
  let out = "";
  let i = 0;
  for (const h of toks) {
    out += text.slice(i, h.start);
    if (h.kind === "tag") {
      const v = map.get(h.name.toLowerCase());
      if (v != null) { out += v; knownTags.push(h.name); }
      else { out += h.raw; unknownTags.push(h.name); } // unknown tag left literal
    } else {
      const rep = typeof resolveWild === "function" ? resolveWild(h.name) : null;
      if (rep != null) { out += rep; knownWilds.push(h.name); }
      else { out += h.raw; unknownWilds.push(h.name); } // unknown / empty category left literal
    }
    i = h.end;
  }
  out += text.slice(i);
  return { out, knownTags, unknownTags, knownWilds, unknownWilds };
}

// Expand @tags only (deterministic). Kept as the single @-only path; delegates to
// expandAll with no wildcard resolver. Returns { out, unknown, known }.
export function expandTags(text, tags) {
  const r = expandAll(text, { tags, resolveWild: null });
  return { out: r.out, unknown: r.unknownTags, known: r.knownTags };
}

// Does this text reference at least one @tag (known or not)?
export function hasTags(text) {
  if (typeof text !== "string" || text.indexOf("@") === -1) return false;
  return scanTags(text).length > 0;
}
// Does this text reference at least one *wildcard?
export function hasWilds(text) {
  if (typeof text !== "string" || text.indexOf("*") === -1) return false;
  return scanWilds(text).length > 0;
}
