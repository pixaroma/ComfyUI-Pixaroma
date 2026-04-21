// Code view support: HTML tokenizer, pretty-printer, and the
// <pre>-overlay-under-<textarea> DOM builder used by core.mjs for the
// Code toggle. No external dependencies — the tokenizer is a narrow
// regex-driven scanner tuned for the sanitized HTML shapes our editor
// produces (no script, no comments, no DOCTYPE, no CDATA).

// Top-level block tags. Each of these goes on its own line with one
// blank line between them when we pretty-print. Inline tags (<a>, <b>,
// <span>, …) stay on their parent's line.
const TOP_LEVEL_BLOCK_TAGS = new Set([
  "p","h1","h2","h3","ul","ol","pre","blockquote","hr","div","table",
]);

// <span class="pix-note-btnblock"> is also treated as a top-level block
// because renderButtonHTML() emits it as a standalone unit — pretty-
// printing it on its own line keeps button blocks visually grouped.
function isTopLevelBlockNode(el) {
  if (el.nodeType !== 1) return false;
  const tag = el.tagName.toLowerCase();
  if (TOP_LEVEL_BLOCK_TAGS.has(tag)) return true;
  if (tag === "span" && el.classList.contains("pix-note-btnblock")) return true;
  return false;
}

// Tokenize sanitized HTML into a flat array of { type, text } tokens.
// The overlay renderer maps each type to a CSS class; css.mjs defines
// the color per class. Token types:
//
//   "tag-punct"   – "<", ">", "</", "/>"
//   "tag-name"    – element names inside brackets
//   "whitespace"  – any whitespace run inside a tag or between tokens
//   "attr-name"   – attribute name
//   "attr-equals" – literal "="
//   "attr-value"  – quoted attribute value (quotes included)
//   "pix-class"   – a single pix-note-* class token inside a class=""
//                    value — split out so it can be bold-orange
//   "text"        – plain text content between tags
//   "entity"      – "&nbsp;", "&amp;", …
//
// Any input character that doesn't match a known pattern falls through
// as plain "text" so we never drop user content even if the tokenizer
// encounters something weird.
export function tokenizeHTML(html) {
  const out = [];
  const src = String(html || "");
  // Scan for a tag opening, entity, or run of text.
  const chunkRe = /<\/?[a-zA-Z][^>]*>|&[a-zA-Z#][a-zA-Z0-9]*;|[^<&]+|./g;
  let m;
  while ((m = chunkRe.exec(src)) !== null) {
    const s = m[0];
    if (s.startsWith("</")) {
      emitCloseTag(out, s);
    } else if (s.startsWith("<") && s.endsWith(">")) {
      emitOpenTag(out, s);
    } else if (s.startsWith("&") && s.endsWith(";")) {
      out.push({ type: "entity", text: s });
    } else {
      out.push({ type: "text", text: s });
    }
  }
  return out;
}

function emitCloseTag(out, raw) {
  // raw: "</tagname>" — we split into punct + name + punct.
  const inner = raw.slice(2, -1).trim();
  out.push({ type: "tag-punct", text: "</" });
  if (inner) out.push({ type: "tag-name", text: inner });
  out.push({ type: "tag-punct", text: ">" });
}

function emitOpenTag(out, raw) {
  // raw: "<tagname attr1=\"val\" attr2='v'>" or "<br/>"
  const selfClose = /\/\s*>$/.test(raw);
  const bodyEnd = selfClose ? raw.lastIndexOf("/") : raw.length - 1;
  const inner = raw.slice(1, bodyEnd);
  out.push({ type: "tag-punct", text: "<" });

  // Element name.
  const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(inner);
  if (!nameMatch) {
    // Malformed — emit the whole rest as text so nothing is lost.
    out.push({ type: "text", text: inner });
    out.push({ type: "tag-punct", text: selfClose ? "/>" : ">" });
    return;
  }
  out.push({ type: "tag-name", text: nameMatch[1] });
  let rest = inner.slice(nameMatch[1].length);

  // Attribute scanner. Greedy: whitespace, name, optional (=, value).
  const attrRe = /(\s+)|([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let am;
  while ((am = attrRe.exec(rest)) !== null) {
    if (am[1]) {
      out.push({ type: "whitespace", text: am[1] });
      continue;
    }
    const name = am[2];
    const assign = am[3];
    const rawValue = am[4];
    out.push({ type: "attr-name", text: name });
    if (assign !== undefined) {
      const eqIdx = assign.indexOf("=");
      const beforeEq = assign.slice(0, eqIdx);
      const afterEq = assign.slice(eqIdx + 1, assign.length - (rawValue ? rawValue.length : 0));
      if (beforeEq) out.push({ type: "whitespace", text: beforeEq });
      out.push({ type: "attr-equals", text: "=" });
      if (afterEq) out.push({ type: "whitespace", text: afterEq });
      if (rawValue !== undefined) {
        emitAttrValue(out, name.toLowerCase(), rawValue);
      }
    }
  }

  out.push({ type: "tag-punct", text: selfClose ? "/>" : ">" });
}

function emitAttrValue(out, name, raw) {
  // Only class="…" gets the pix-note-* class split; everything else is
  // one "attr-value" token so URLs etc. highlight as a unit.
  if (name !== "class" || !/pix-note-/.test(raw)) {
    out.push({ type: "attr-value", text: raw });
    return;
  }
  // Split the class list while preserving the surrounding quote chars.
  const firstChar = raw[0];
  const lastChar = raw[raw.length - 1];
  const hasQuotes = (firstChar === '"' || firstChar === "'") && firstChar === lastChar;
  const quote = hasQuotes ? firstChar : "";
  const inner = hasQuotes ? raw.slice(1, -1) : raw;
  if (quote) out.push({ type: "attr-value", text: quote });
  const partRe = /(\s+)|(pix-note-[a-zA-Z0-9-]+)|([^\s]+)/g;
  let pm;
  while ((pm = partRe.exec(inner)) !== null) {
    if (pm[1]) out.push({ type: "whitespace", text: pm[1] });
    else if (pm[2]) out.push({ type: "pix-class", text: pm[2] });
    else if (pm[3]) out.push({ type: "attr-value", text: pm[3] });
  }
  if (quote) out.push({ type: "attr-value", text: quote });
}

// Pretty-print sanitized HTML:
//   - Each top-level block on its own line.
//   - Exactly one blank line between top-level blocks.
//   - Inline children (<a>, <span>, <b>, …) stay on their parent line.
//   - <pre> content is preserved verbatim (never touch user code).
//
// Runs once on entering Code view. Does NOT reformat as the user types.
export function prettyFormatHTML(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${html}</body>`, "text/html"
  );
  const body = doc.body;
  const parts = [];
  for (const child of Array.from(body.childNodes)) {
    const piece = serializeBlock(child);
    if (piece !== null) parts.push(piece);
  }
  // One blank line between blocks = join with "\n\n".
  return parts.join("\n\n");
}

function serializeBlock(node) {
  if (node.nodeType === 3) {
    const t = node.textContent.trim();
    return t ? escapeText(t) : null;
  }
  if (node.nodeType !== 1) return null;
  // <pre> — preserve inner verbatim.
  if (node.tagName.toLowerCase() === "pre") {
    return node.outerHTML;
  }
  if (isTopLevelBlockNode(node)) {
    return node.outerHTML;
  }
  // Non-block top-level (rare after sanitize) — emit as-is.
  return node.outerHTML;
}

function escapeText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Build the Code-view DOM: a container wrapping a <pre> highlight overlay
// and an editable <textarea>. Both share the same font, padding, and
// line-height so the overlay spans align exactly with the text the
// user types. The textarea is transparent (color: transparent via CSS,
// caret stays visible via CSS caret-color); the overlay has
// pointer-events: none so clicks pass through to the textarea.
//
// Returns an object { root, textarea, overlay, setValue, destroy }.
//
// Caller wires:
//   - scroll sync (we set up the listener in attachScrollSync below)
//   - live re-render on `input` (task 3 plugs in the colored renderer)
//
// Task 2 uses renderTokensPlain: one text node, no colors. Task 3
// replaces it with renderTokensColored.
export function buildCodeViewDOM(initialHtml, opts) {
  const root = document.createElement("div");
  root.className = "pix-note-codewrap";

  const overlay = document.createElement("pre");
  overlay.className = "pix-note-hl";
  overlay.setAttribute("aria-hidden", "true");
  root.appendChild(overlay);

  const textarea = document.createElement("textarea");
  textarea.className = "pix-note-raw";
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.setAttribute("wrap", "soft");
  root.appendChild(textarea);

  const formatted = prettyFormatHTML(initialHtml || "");
  textarea.value = formatted;
  renderTokensColored(overlay, formatted);

  // Scroll sync — overlay follows the textarea, one direction only
  // (overlay has no scrollbar of its own thanks to overflow: hidden).
  const syncScroll = () => {
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
  };
  textarea.addEventListener("scroll", syncScroll, { passive: true });

  // Live re-render with colored tokens.
  const onInput = () => {
    renderTokensColored(overlay, textarea.value);
    // Optional caller hook (kept inside the same listener so `destroy`
    // cleans it up with no extra bookkeeping).
    if (opts && typeof opts.onInput === "function") opts.onInput();
  };
  textarea.addEventListener("input", onInput);

  const destroy = () => {
    textarea.removeEventListener("scroll", syncScroll);
    textarea.removeEventListener("input", onInput);
    root.remove();
  };

  return { root, textarea, overlay, destroy };
}

// Plain text renderer — used by task 2 scaffolding. Task 3 replaces
// this with renderTokensColored, which emits colored spans.
export function renderTokensPlain(overlay, text) {
  overlay.textContent = text + "\n"; // trailing newline so the last
                                     // line of textarea scroll lines
                                     // up with the overlay
}

// Colored token renderer: tokenize `text` and emit one <span> per token
// with a class per type. Must be the ONLY child-setter on `overlay` so
// repeated renders don't leak DOM.
export function renderTokensColored(overlay, text) {
  // Tokenize the raw textarea contents (not sanitized — we want to color
  // even malformed drafts the user is mid-typing).
  const tokens = tokenizeHTML(text);
  // Build a fragment; swap in one go so we never paint half-updated
  // overlay state.
  const frag = document.createDocumentFragment();
  for (const t of tokens) {
    const span = document.createElement("span");
    span.className = "tk-" + t.type;
    span.textContent = t.text;
    frag.appendChild(span);
  }
  // Trailing newline space so the last visible line of the textarea
  // aligns with the overlay when the textarea has just scrolled.
  frag.appendChild(document.createTextNode("\n"));
  overlay.textContent = "";
  overlay.appendChild(frag);
}
