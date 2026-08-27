// Prompt Each Pixaroma - the BROWSER MIRROR of nodes/_prompt_each_helpers.py.
//
// The node face has to show the same count the executor will produce, so this
// file and the Python one implement the SAME rules and must be changed together.
// Parity is pinned by D:\Claude Tests\_prompt_each_parity.py, which runs the same
// table of inputs through both and diffs the output.
//
// Order of operations, and it matters:
//     split -> trim -> drop empties -> expand [a|b] -> cap
//
// Bracket semantics are deliberately the opposite of the braces on Text
// Pixaroma: {a|b} picks ONE at random, [a|b] yields BOTH.

// Private-use-area placeholders for escaped brackets, so they survive the parse
// as literals. Built with fromCharCode so this file stays pure ASCII
// (CLAUDE.md convention #25 - a literal invisible character is undebuggable).
const ESC_OPEN = String.fromCharCode(0xe002);
const ESC_CLOSE = String.fromCharCode(0xe003);

export const SPLIT_LINE = "line";
export const SPLIT_BLANK = "blank";
export const SPLIT_MODES = [SPLIT_LINE, SPLIT_BLANK];

export const DEFAULT_CAP = 200;

// A hard rail, NOT the user-facing cap. Nine groups of ten options is a billion
// combinations and a person can type that by accident; expansion truncates as it
// goes so the browser can never be asked to build the whole product.
const CEILING = 4096;

const BLANK_SPLIT_RE = /\n[ \t]*\n+/;

function normaliseNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function splitText(text, mode) {
  if (typeof text !== "string" || !text) return [];
  const s = normaliseNewlines(text);
  if (mode === SPLIT_BLANK) return s.split(BLANK_SPLIT_RE);
  return s.split("\n");
}

function protectEscapes(s) {
  return s.split("\\[").join(ESC_OPEN).split("\\]").join(ESC_CLOSE);
}

function restoreEscapes(s) {
  return s.split(ESC_OPEN).join("[").split(ESC_CLOSE).join("]");
}

// True when every [ has a matching ] after it and nothing closes early. An
// unbalanced string is left completely alone rather than half-expanded: eating
// half of somebody's prompt over one stray bracket is far worse than not
// expanding it.
function balanced(s) {
  let depth = 0;
  for (const c of s) {
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// Parse literals and groups until a stop character or the end.
// A part is ["lit", string] or ["grp", [parts, ...]].
function parseSeq(s, i, stops) {
  const parts = [];
  let buf = "";
  while (i < s.length) {
    const c = s[i];
    if (stops.indexOf(c) !== -1) break;
    if (c === "[") {
      if (buf) {
        parts.push(["lit", buf]);
        buf = "";
      }
      const r = parseGroup(s, i + 1);
      parts.push(r.group);
      i = r.i;
      continue;
    }
    buf += c;
    i += 1;
  }
  if (buf) parts.push(["lit", buf]);
  return { parts, i };
}

// i points just past the '['. Returns { group, i } with i past the ']'.
function parseGroup(s, i) {
  const alts = [];
  for (;;) {
    const r = parseSeq(s, i, "|]");
    alts.push(r.parts);
    i = r.i;
    if (i >= s.length) {
      // Only reachable on an unbalanced string, which `balanced` already
      // refused, but returning cleanly beats a hang if that stops being true.
      return { group: ["grp", alts], i };
    }
    if (s[i] === "|") {
      i += 1;
      continue;
    }
    return { group: ["grp", alts], i: i + 1 };
  }
}

// Cartesian product over every group, truncating at CEILING as it goes. The
// LATER group varies fastest (odometer order), so "[red|blue] over [sand|snow]"
// reads red/sand, red/snow, blue/sand, blue/snow rather than interleaving.
function expandParts(parts, ceiling) {
  let results = [""];
  for (const part of parts) {
    if (part[0] === "lit") {
      const lit = part[1];
      results = results.map((r) => r + lit);
      continue;
    }
    let alts = [];
    for (const alt of part[1]) {
      alts = alts.concat(expandParts(alt, ceiling));
      if (alts.length >= ceiling) break;
    }
    const out = [];
    outer: for (const r of results) {
      for (const a of alts) {
        out.push(r + a);
        if (out.length >= ceiling) break outer;
      }
    }
    results = out;
  }
  return results;
}

export function expandBrackets(text) {
  if (typeof text !== "string") return [""];
  if (text.indexOf("[") === -1 && text.indexOf("]") === -1) return [text];
  const protectedText = protectEscapes(text);
  if (!balanced(protectedText)) return [restoreEscapes(protectedText)];
  const { parts } = parseSeq(protectedText, 0, "");
  return expandParts(parts, CEILING).map(restoreEscapes);
}

// Turn typed text into the prompt list.
// Returns { prompts, pieces, truncated }; `pieces` is how many prompts there
// were BEFORE expansion, which is the left half of the node's count chip.
export function buildPrompts(text, opts = {}) {
  const split = SPLIT_MODES.indexOf(opts.split) !== -1 ? opts.split : SPLIT_LINE;
  const expand = opts.expand !== false;
  const trim = opts.trim !== false;
  const skipEmpty = opts.skipEmpty !== false;

  let cap = opts.cap;
  cap = cap == null || typeof cap !== "number" || !isFinite(cap)
    ? DEFAULT_CAP
    : Math.floor(cap);
  if (cap < 0) cap = 0;

  const raw = splitText(text, split);

  const pieces = [];
  for (let piece of raw) {
    if (trim) piece = piece.trim();
    if (skipEmpty && !piece) continue;
    pieces.push(piece);
  }

  const prompts = [];
  let truncated = false;
  for (const piece of pieces) {
    const variants = expand ? expandBrackets(piece) : [piece];
    for (let variant of variants) {
      if (trim) variant = variant.trim();
      if (skipEmpty && !variant) continue;
      if (prompts.length >= cap) {
        truncated = true;
        break;
      }
      prompts.push(variant);
    }
    if (truncated) break;
  }

  return { prompts, pieces: pieces.length, truncated };
}
