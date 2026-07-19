// Prompt Pixaroma - @tag -> snippet-text expansion (one level, no nesting).
//
// Used by BOTH the node body (live "Show expanded" preview + orange/red
// highlighting) and the app.graphToPrompt hook (the real swap at queue time).
// Keep it pure so the two never disagree.

import { getTags } from "./library.mjs";

// A tag is @ followed by letters/digits/_/- .
const TAG_RE = /@([a-zA-Z0-9_\-]+)/g;

// Is this @ a real tag-start? Yes when it's at the very start, after a NON-word
// char (space, comma, ...), OR immediately after another tag (a chain like
// @a@b). This lets adjacent tags expand while still leaving an email's
// "user@name" alone (its @ sits after a word char with no preceding tag).
function scan(text) {
  const out = [];
  TAG_RE.lastIndex = 0;
  let m, lastEnd = -1;
  while ((m = TAG_RE.exec(text))) {
    const at = m.index;
    const prev = at > 0 ? text[at - 1] : "";
    const isTag = !prev || !/\w/.test(prev) || at === lastEnd;
    if (isTag) {
      out.push({ name: m[1], start: at, end: at + m[0].length, raw: m[0] });
      lastEnd = at + m[0].length; // a following @ can chain off this one
    }
    // a non-tag @token does NOT set lastEnd, so it can't start a chain
  }
  return out;
}

// Expand every @tag in `text`. Returns { out, unknown, known }.
export function expandTags(text, tags) {
  if (typeof text !== "string" || text.indexOf("@") === -1) {
    return { out: typeof text === "string" ? text : "", unknown: [], known: [] };
  }
  const list = tags || getTags();
  const map = new Map();
  for (const t of list) map.set(t.name.toLowerCase(), t.text);

  const hits = scan(text);
  const unknown = [];
  const known = [];
  let out = "";
  let i = 0;
  for (const h of hits) {
    out += text.slice(i, h.start);
    const v = map.get(h.name.toLowerCase());
    if (v != null) { out += v; known.push(h.name); }
    else { out += h.raw; unknown.push(h.name); } // unknown tag left literal
    i = h.end;
  }
  out += text.slice(i);
  return { out, unknown, known };
}

// Does this text reference at least one @tag (known or not)? Decides whether the
// expanded-preview line is worth showing.
export function hasTags(text) {
  if (typeof text !== "string" || text.indexOf("@") === -1) return false;
  return scan(text).length > 0;
}
