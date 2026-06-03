// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Shared - Node Help panel                            ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// A reusable "Help" affordance for Pixaroma nodes. ComfyUI's built-in Info tab
// is plain-text and cramped; this gives each node a small ? button (the bundled
// question.svg) that opens a themed, scrollable card explaining the node.
//
// Usage in a node:
//   import { createHelpButton } from "../shared/index.mjs";
//   someRow.appendChild(createHelpButton(MY_HELP));   // drop the ? button in
//
// where MY_HELP is a help-definition object:
//   {
//     title:   "My Node Pixaroma",          // shown in the header
//     tagline: "One line: what it is.",      // optional, under the title
//     sections: [
//       { heading: "What it does", body: "A paragraph. \n\n New para on blank line." },
//       { heading: "How to use",   bullets: ["do this", "then this"] },
//       { heading: "The toggles",  defs: [ ["Term", "what it means"], ... ] },
//       { heading: "Examples",     table: { headers: ["A","B"], rows: [["1","2"]] } },
//     ],
//     footer: "Optional tip line shown at the bottom.",
//   }
//
// Any string (body / bullet / def term+desc / table cell / tagline / footer)
// may contain inline `code` (backticks) which renders as a monospace chip.
// All text is HTML-escaped first, so node-authored content is safe to write
// in plain prose. Blocks render in the order listed.
//
// Public API:
//   createHelpButton(helpDef, opts?)  -> HTMLButtonElement (opens the popup)
//   openHelpPopup(helpDef)            -> opens the popup directly
//   injectHelpCSS()                   -> inject styles once (called lazily)
//
// Teardown: a consumer SHOULD call closeHelpPopup() in its node's onRemoved so
// deleting the node closes any open panel. As a universal safety net this module
// also auto-closes the panel on any workflow load/switch/undo (it wraps
// app.loadGraphData once, the first time a panel is opened).

import { app } from "/scripts/app.js";

const CSS_ID = "pix-help-css";
const QUESTION_ICON = "/pixaroma/assets/icons/note/question.svg";
const BRAND = "#f66744";

const CSS = `
/* ---- the ? button nodes drop into their body ---- */
.pix-help-btn {
  width: 16px; height: 16px; flex: none; padding: 0; border: none;
  background-color: rgba(255,255,255,0.5);
  -webkit-mask: url("${QUESTION_ICON}") center / contain no-repeat;
  mask: url("${QUESTION_ICON}") center / contain no-repeat;
  cursor: pointer; align-self: center;
  transition: background-color 0.12s;
}
.pix-help-btn:hover { background-color: ${BRAND}; }

/* ---- popup ---- */
.pix-help-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000; font-family: inherit; -webkit-font-smoothing: antialiased;
}
.pix-help-card {
  background: #1d1d1d; border: 1px solid #333; border-radius: 8px;
  width: min(680px, 92vw); max-height: 82vh; display: flex; flex-direction: column;
  box-shadow: 0 14px 52px rgba(0,0,0,0.6); overflow: hidden; color: #cfcfcf;
  animation: pix-help-in 0.14s ease;
}
@keyframes pix-help-in {
  from { opacity: 0; transform: translateY(10px) scale(0.985); }
  to   { opacity: 1; transform: none; }
}
.pix-help-header {
  display: flex; align-items: center; gap: 10px;
  padding: 13px 14px 13px 16px; border-bottom: 1px solid #2c2c2c; flex: none;
}
.pix-help-h-icon {
  width: 18px; height: 18px; flex: none; background-color: ${BRAND};
  -webkit-mask: url("${QUESTION_ICON}") center / contain no-repeat;
  mask: url("${QUESTION_ICON}") center / contain no-repeat;
}
.pix-help-h-title { flex: 1; font-size: 15px; font-weight: 600; color: #fff; line-height: 1.2; }
.pix-help-close {
  flex: none; width: 26px; height: 26px; border-radius: 4px; border: none;
  background: rgba(255,255,255,0.05); color: #aaa; cursor: pointer;
  font-size: 15px; line-height: 1; display: flex; align-items: center; justify-content: center;
  transition: background 0.12s, color 0.12s;
}
.pix-help-close:hover { background: ${BRAND}; color: #fff; }

.pix-help-body { padding: 14px 16px 16px 16px; overflow-y: auto; font-size: 12.5px; line-height: 1.55; }
.pix-help-section { margin-bottom: 15px; }
.pix-help-section:last-child { margin-bottom: 0; }
.pix-help-h {
  margin: 0 0 6px 0; font-size: 11px; font-weight: 700; color: ${BRAND};
  text-transform: uppercase; letter-spacing: 0.5px;
}
.pix-help-p { margin: 0 0 6px 0; white-space: pre-wrap; color: #cfcfcf; }
.pix-help-p:last-child { margin-bottom: 0; }
.pix-help-ul { margin: 0; padding-left: 18px; }
.pix-help-ul li { margin: 0 0 4px 0; }
.pix-help-defs { display: grid; grid-template-columns: auto 1fr; gap: 5px 14px; align-items: baseline; }
.pix-help-defs dt { color: #fff; font-weight: 600; white-space: nowrap; }
.pix-help-defs dd { margin: 0; color: #bcbcbc; }
.pix-help-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pix-help-table th {
  text-align: left; padding: 5px 8px; color: #9a9a9a; font-weight: 600;
  border-bottom: 1px solid #3a3a3a; text-transform: uppercase; font-size: 10px; letter-spacing: 0.4px;
}
.pix-help-table td { padding: 5px 8px; border-bottom: 1px solid #262626; vertical-align: top; color: #cfcfcf; }
.pix-help-table tr:last-child td { border-bottom: none; }
.pix-help code {
  background: rgba(255,255,255,0.08); border-radius: 3px; padding: 1px 5px;
  font-family: monospace; font-size: 11.5px; color: #ffd2c4;
}
.pix-help-tip {
  margin-top: 4px; padding: 8px 11px; background: rgba(246,103,68,0.1);
  border-left: 2px solid ${BRAND}; border-radius: 3px; color: #ddd; font-size: 12px;
}
`;

export function injectHelpCSS() {
  if (document.getElementById(CSS_ID)) return;
  const el = document.createElement("style");
  el.id = CSS_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// Escape HTML, then turn `inline code` (backticks) into <code> chips.
function fmt(s) {
  const esc = String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
}

function buildSection(section) {
  const sec = document.createElement("div");
  sec.className = "pix-help-section";

  if (section.heading) {
    const h = document.createElement("div");
    h.className = "pix-help-h";
    h.textContent = section.heading;
    sec.appendChild(h);
  }

  if (section.body) {
    // Blank line -> new paragraph; single \n stays (white-space: pre-wrap).
    for (const para of String(section.body).split(/\n\s*\n/)) {
      const p = document.createElement("p");
      p.className = "pix-help-p";
      p.innerHTML = fmt(para);
      sec.appendChild(p);
    }
  }

  if (Array.isArray(section.bullets) && section.bullets.length) {
    const ul = document.createElement("ul");
    ul.className = "pix-help-ul";
    for (const item of section.bullets) {
      const li = document.createElement("li");
      li.innerHTML = fmt(item);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
  }

  if (Array.isArray(section.defs) && section.defs.length) {
    const dl = document.createElement("dl");
    dl.className = "pix-help-defs";
    for (const entry of section.defs) {
      // Tolerate a malformed entry (a bare string instead of [term, desc]).
      const [term, desc] = Array.isArray(entry) ? entry : [entry, ""];
      const dt = document.createElement("dt");
      dt.innerHTML = fmt(term);
      const dd = document.createElement("dd");
      dd.innerHTML = fmt(desc);
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    sec.appendChild(dl);
  }

  if (section.table && Array.isArray(section.table.rows)) {
    const table = document.createElement("table");
    table.className = "pix-help-table";
    if (Array.isArray(section.table.headers)) {
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      for (const h of section.table.headers) {
        const th = document.createElement("th");
        th.innerHTML = fmt(h);
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      table.appendChild(thead);
    }
    const tbody = document.createElement("tbody");
    for (const row of section.table.rows) {
      const tr = document.createElement("tr");
      const cells = Array.isArray(row) ? row : [row]; // tolerate a non-array row
      for (const cell of cells) {
        const td = document.createElement("td");
        td.innerHTML = fmt(cell);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    sec.appendChild(table);
  }

  return sec;
}

let _openCleanup = null;

export function closeHelpPopup() {
  if (_openCleanup) _openCleanup();
}

// Universal safety net: close any open help panel when the workflow changes
// (open / switch tab / undo all funnel through app.loadGraphData), so a panel
// left open while its node is torn down can't leak its document-level Esc
// listener and swallow Escape app-wide. Wrapped once, lazily, the first time a
// panel opens. Idempotent; composes with other loadGraphData wrappers.
let _graphHookInstalled = false;
function ensureGraphCloseHook() {
  if (_graphHookInstalled) return;
  if (!app || typeof app.loadGraphData !== "function") return;
  _graphHookInstalled = true;
  const orig = app.loadGraphData.bind(app);
  app.loadGraphData = function (...args) {
    closeHelpPopup();
    return orig(...args);
  };
}

export function openHelpPopup(helpDef) {
  helpDef = helpDef || {};
  injectHelpCSS();
  ensureGraphCloseHook();
  closeHelpPopup(); // only one at a time

  const backdrop = document.createElement("div");
  backdrop.className = "pix-help-backdrop";

  const card = document.createElement("div");
  card.className = "pix-help-card pix-help";
  backdrop.appendChild(card);

  // header
  const header = document.createElement("div");
  header.className = "pix-help-header";
  const icon = document.createElement("span");
  icon.className = "pix-help-h-icon";
  const title = document.createElement("div");
  title.className = "pix-help-h-title";
  title.textContent = helpDef.title || "Help";
  const close = document.createElement("button");
  close.className = "pix-help-close";
  close.type = "button";
  close.textContent = "✕";
  close.title = "Close (Esc)";
  header.appendChild(icon);
  header.appendChild(title);
  header.appendChild(close);
  card.appendChild(header);

  // body
  const body = document.createElement("div");
  body.className = "pix-help-body";
  if (helpDef.tagline) {
    const tag = document.createElement("p");
    tag.className = "pix-help-p";
    tag.style.color = "#e6e6e6";
    tag.innerHTML = fmt(helpDef.tagline);
    body.appendChild(tag);
  }
  for (const section of helpDef.sections || []) {
    // A malformed section (authored by a node) must not kill the whole panel.
    try {
      body.appendChild(buildSection(section));
    } catch (e) {
      console.warn("Pixaroma help: skipped a malformed section", e);
    }
  }
  if (helpDef.footer) {
    const tip = document.createElement("div");
    tip.className = "pix-help-tip";
    tip.innerHTML = fmt(helpDef.footer);
    body.appendChild(tip);
  }
  card.appendChild(body);

  // --- close wiring ---
  let mouseDownOnBackdrop = false;
  const cleanup = () => {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    if (_openCleanup === cleanup) _openCleanup = null;
  };
  _openCleanup = cleanup;

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      cleanup();
    }
  };
  document.addEventListener("keydown", onKey, true);

  close.addEventListener("click", (e) => { e.stopPropagation(); cleanup(); });
  // Click-outside to close, but only when the press STARTED on the backdrop
  // (so a text drag-select that releases on the backdrop doesn't dismiss it -
  // same guard Text Overlay #12 documents).
  backdrop.addEventListener("mousedown", (e) => { mouseDownOnBackdrop = e.target === backdrop; });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && mouseDownOnBackdrop) cleanup();
    mouseDownOnBackdrop = false;
  });
  // Don't let clicks inside the card bubble to the canvas / node.
  card.addEventListener("mousedown", (e) => e.stopPropagation());

  document.body.appendChild(backdrop);
  return cleanup;
}

// Returns a small ? button wired to open the given help. Drop it into a node's
// DOM body. opts.title overrides the hover tooltip.
export function createHelpButton(helpDef, opts = {}) {
  injectHelpCSS();
  const btn = document.createElement("button");
  btn.className = "pix-help-btn";
  btn.type = "button";
  btn.title = opts.title || `Help: learn how ${helpDef.title || "this node"} works`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    openHelpPopup(helpDef);
  });
  // Block the mousedown from starting a node drag / selection underneath.
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  return btn;
}
