import { injectCSS } from "./css.mjs";

const PLACEHOLDER_TEXT = "Add your workflow notes here\u2026";

export function createNoteDOMWidget(node) {
  injectCSS();
  const wrap = document.createElement("div");
  wrap.className = "pix-note-wrap";

  const body = document.createElement("div");
  body.className = "pix-note-body";
  wrap.appendChild(body);

  renderContent(node, body);
  return wrap;
}

export function renderContent(node, bodyEl) {
  const cfg = node._noteCfg || {};
  bodyEl.style.setProperty("--pix-note-accent", cfg.accentColor || "#f66744");
  bodyEl.style.background = cfg.backgroundColor && cfg.backgroundColor !== "transparent"
    ? cfg.backgroundColor : "transparent";

  const html = (cfg.content || "").trim();
  if (!html) {
    bodyEl.innerHTML = `<div class="pix-note-placeholder">${PLACEHOLDER_TEXT}</div>`;
    return;
  }
  // Sanitization is added in Task 5. For now, set innerHTML directly from
  // the trusted default (empty). This is safe because content is empty at
  // this point; Task 5 wraps this call with sanitize().
  bodyEl.innerHTML = html;
}
