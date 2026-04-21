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
  attachCanvasClickDelegation(body);
  return wrap;
}

export function renderContent(node, bodyEl) {
  const cfg = node._noteCfg || {};
  bodyEl.style.setProperty("--pix-note-accent", cfg.accentColor || "#f66744");
  // Default to the editor's interior gray (#151515) so the on-canvas body
  // matches what the user sees while editing. "transparent" is still
  // honored if explicitly set (user may pick it from the bg color picker
  // once Task 17 lands, to let ComfyUI's node colour show through).
  if (cfg.backgroundColor === "transparent") {
    bodyEl.style.background = "transparent";
  } else {
    bodyEl.style.background = cfg.backgroundColor || "#151515";
  }

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
    return;
  }
  injectCopyButtons(bodyEl);
}

function injectCopyButtons(bodyEl) {
  bodyEl.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(":scope > .pix-note-copybtn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pix-note-copybtn";
    btn.title = "Copy code";
    btn.contentEditable = "false";
    const icon = document.createElement("img");
    icon.src = "/pixaroma/assets/icons/ui/copy.svg";
    icon.draggable = false;
    btn.appendChild(icon);
    pre.appendChild(btn);
  });
  if (bodyEl._pixCopyBound) return;
  bodyEl._pixCopyBound = true;
  bodyEl.addEventListener("click", (e) => {
    const cb = e.target.closest?.(".pix-note-copybtn");
    if (!cb || !bodyEl.contains(cb)) return;
    e.stopPropagation();
    e.preventDefault();
    const pre = cb.closest("pre");
    if (!pre) return;
    const code = pre.querySelector("code");
    const text = (code ? code.textContent : pre.textContent) || "";
    const flash = () => {
      cb.classList.add("copied");
      setTimeout(() => cb.classList.remove("copied"), 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(() => {});
    } else {
      // Fallback for older browsers / non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); flash(); } catch {}
      ta.remove();
    }
  });
}

export function attachCanvasClickDelegation(bodyEl) {
  // Pills are plain links — the browser handles navigation via target=_blank.
  // The only side-effect we need here is stopping propagation so a click
  // inside the note body doesn't initiate a LiteGraph node drag underneath.
  bodyEl.addEventListener("click", (e) => {
    if (e.target.closest("a")) e.stopPropagation();
  }, true);
  bodyEl.addEventListener("mousedown", (e) => {
    if (e.target.closest("a")) e.stopPropagation();
  }, true);
}
