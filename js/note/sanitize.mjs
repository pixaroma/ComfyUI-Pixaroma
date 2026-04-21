// Allowlist-based HTML sanitizer. No external dependencies.
// Input: arbitrary HTML string. Output: sanitized HTML string.
// Drops tags/attributes not on the allowlist. Forces target/rel on anchors.

const ALLOWED_TAGS = new Set([
  "h1","h2","h3","p","br","hr","ul","ol","li","b","i","u","s","strike","strong","em",
  "code","pre","span","div","a","blockquote","label",
]);

// Tags whose content is ALSO discarded when removed (vs. unwrapped).
// Anything not in ALLOWED_TAGS and not here is unwrapped so inner text/nodes
// survive — e.g. Chrome wraps strikeThrough in <strike>; if that tag weren't
// allowed we'd still want the wrapped text to remain.
const DANGEROUS_TAGS = new Set([
  "script","style","iframe","object","embed","link","meta",
  "form","button","select","textarea","svg","math",
  "applet","frame","frameset","base",
]);

// Pixaroma block classes are the ONLY allowed class values.
const ALLOWED_CLASS_VALUES = new Set([
  "pix-note-dl","pix-note-yt","pix-note-discord",
  "pix-note-vp","pix-note-rm",
  // Wrapper + decoration pieces for the Button Design output
  "pix-note-btnblock","pix-note-folderhint","pix-note-btnsize",
]);

// Inline-style properties we allow. Values are validated separately.
const ALLOWED_STYLE_PROPS = new Set([
  "color", "background-color", "text-align",
]);

// Color pattern: #abc, #aabbcc, rgb(), rgba(), or a narrow set of named colors.
const COLOR_RE = /^(#[0-9a-f]{3}([0-9a-f]{3})?|rgba?\([^)]+\)|transparent|inherit|currentColor|black|white|red|green|blue|yellow|orange|purple|gray|grey)$/i;
const ALIGN_RE = /^(left|right|center|justify)$/i;

const ALLOWED_HREF_PROTOCOLS = ["http:", "https:", "mailto:"];

// Per-tag attribute allowlist. "*" means "any tag".
const ALLOWED_ATTRS = {
  "*": new Set(["class", "style"]),
  a: new Set(["class","style","href","target","rel","data-folder","data-size","data-label"]),
  label: new Set(["class","style"]),
};

function filterClass(value) {
  if (typeof value !== "string") return "";
  return value
    .split(/\s+/)
    .filter((c) => ALLOWED_CLASS_VALUES.has(c))
    .join(" ");
}

function filterStyle(value) {
  if (typeof value !== "string") return "";
  const out = [];
  for (const chunk of value.split(";")) {
    const ix = chunk.indexOf(":");
    if (ix < 0) continue;
    const prop = chunk.slice(0, ix).trim().toLowerCase();
    const val = chunk.slice(ix + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if ((prop === "color" || prop === "background-color") && !COLOR_RE.test(val)) continue;
    if (prop === "text-align" && !ALIGN_RE.test(val)) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.join("; ");
}

function filterHref(value) {
  try {
    const u = new URL(value);  // no base — throws on relative URLs
    if (!ALLOWED_HREF_PROTOCOLS.includes(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) { el.remove(); return []; }
  const kids = Array.from(el.childNodes);
  for (const c of kids) parent.insertBefore(c, el);
  parent.removeChild(el);
  return kids;
}

function filterElement(el) {
  const tag = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    if (DANGEROUS_TAGS.has(tag)) {
      el.remove();
      return;
    }
    // Unknown/benign wrapper: keep children so user text isn't lost.
    const kids = unwrap(el);
    for (const c of kids) {
      if (c.nodeType === 1) filterElement(c);
    }
    return;
  }
  // Scan attributes; mutate list while iterating via snapshot.
  const attrs = Array.from(el.attributes);
  const allowedForTag = ALLOWED_ATTRS[tag] || ALLOWED_ATTRS["*"];

  for (const a of attrs) {
    const name = a.name.toLowerCase();
    // Drop all event handlers unconditionally.
    if (name.startsWith("on")) { el.removeAttribute(a.name); continue; }
    if (!allowedForTag.has(name) && !ALLOWED_ATTRS["*"].has(name)) {
      el.removeAttribute(a.name);
      continue;
    }
    if (name === "class") {
      const cleaned = filterClass(a.value);
      if (cleaned) el.setAttribute("class", cleaned);
      else el.removeAttribute("class");
    } else if (name === "style") {
      const cleaned = filterStyle(a.value);
      if (cleaned) el.setAttribute("style", cleaned);
      else el.removeAttribute("style");
    } else if (name === "href") {
      const cleaned = filterHref(a.value);
      if (cleaned) {
        el.setAttribute("href", cleaned);
      } else {
        // Invalid URL — strip the link but KEEP the inner text. Removing
        // the whole element silently deleted the user's text on save
        // (e.g. if they hit Insert on the link dialog without changing
        // the default 'https://' placeholder, or pasted a relative URL).
        const kids = unwrap(el);
        for (const c of kids) {
          if (c.nodeType === 1) filterElement(c);
        }
        return;
      }
    }
  }

  // All anchors: force safe target/rel
  if (tag === "a" && el.getAttribute("href")) {
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
  }

  // Recurse into children (snapshot before removal)
  const kids = Array.from(el.children);
  for (const c of kids) filterElement(c);
}

export function sanitize(html) {
  if (typeof html !== "string" || html.length === 0) return "";
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${html}</body>`, "text/html"
  );
  const body = doc.body;
  // Walk top-level and descendants
  const topKids = Array.from(body.children);
  for (const c of topKids) filterElement(c);
  return body.innerHTML;
}
