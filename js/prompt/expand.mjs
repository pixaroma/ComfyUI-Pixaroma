// Prompt Pixaroma - @tag -> snippet-text expansion (one level, no nesting).
//
// Used by BOTH the node body (live "Show expanded" preview + orange/red
// highlighting) and the app.graphToPrompt hook (the real swap at queue time).
// Keep it pure so the two never disagree.

import { getTags } from "./library.mjs";

// A tag is @ followed by letters/digits/_/- . The @ must not sit right after a
// word char or another @, so an email like user@oilpainting is left alone.
const TAG_RE = /@([a-zA-Z0-9_\-]+)/g;

function boundaryOk(prev) {
  return !(prev && /[\w@]/.test(prev));
}

// Expand every @tag in `text`. Returns { out, unknown, known }. `unknown` lists
// tag names with no matching snippet (left literal in `out`); `known` lists the
// names that were expanded. Pass `tags` to reuse a snapshot; else the live list.
export function expandTags(text, tags) {
  if (typeof text !== "string" || text.indexOf("@") === -1) {
    return { out: typeof text === "string" ? text : "", unknown: [], known: [] };
  }
  const list = tags || getTags();
  const map = new Map();
  for (const t of list) map.set(t.name.toLowerCase(), t.text);

  const unknown = [];
  const known = [];
  const out = text.replace(TAG_RE, (m, name, offset, full) => {
    if (!boundaryOk(offset > 0 ? full[offset - 1] : "")) return m;
    const v = map.get(name.toLowerCase());
    if (v == null) { unknown.push(name); return m; }
    known.push(name);
    return v;
  });
  return { out, unknown, known };
}

// Does this text reference at least one @tag (known or not)? Decides whether the
// expanded-preview line is worth showing.
export function hasTags(text) {
  if (typeof text !== "string" || text.indexOf("@") === -1) return false;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text))) {
    if (boundaryOk(m.index > 0 ? text[m.index - 1] : "")) return true;
  }
  return false;
}
