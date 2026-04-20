import { injectCSS } from "./css.mjs";
import { sanitize } from "./sanitize.mjs";

const PLACEHOLDER_TEXT = "Add your workflow notes here\u2026";

export function attachEditButton(wrap, onClick) {
  const btn = document.createElement("button");
  btn.className = "pix-note-editbtn";
  btn.type = "button";
  const icon = document.createElement("img");
  icon.src = "/pixaroma/assets/icons/layers/edit.svg";
  icon.draggable = false;
  icon.className = "pix-note-editbtn-icon";
  btn.appendChild(icon);
  btn.appendChild(document.createTextNode(" Edit"));
  btn.addEventListener("mousedown", (e) => {
    // Prevent LiteGraph from starting a node drag from the button
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  wrap.appendChild(btn);
  return btn;
}

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
  try {
    bodyEl.innerHTML = sanitize(html);
  } catch (e) {
    // Malformed content (e.g. nested <pre><code>) could trip sanitize or the
    // parser. Fall back to a readable error message rather than leaving the
    // body blank — blank content can make the on-canvas node visually vanish.
    console.error("[pix-note] renderContent failed, falling back", e);
    bodyEl.innerHTML = `<div class="pix-note-placeholder">Note content could not be rendered. Click Edit to fix.</div>`;
  }
}
