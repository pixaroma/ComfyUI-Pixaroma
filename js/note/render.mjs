import { injectCSS } from "./css.mjs";
import { sanitize } from "./sanitize.mjs";

const PLACEHOLDER_TEXT = "Add your workflow notes here\u2026";

// Darken a #rgb or #rrggbb hex by `amount` in 0..1 range. Used to
// derive a title-bar color from the body background so the title is
// always a visually distinct (darker) shade. Matches the contrast
// ComfyUI's native right-click Colors menu produces.
function darken(hex, amount) {
  if (!hex || typeof hex !== "string") return hex;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s, 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

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
  // Two independent pickers after the Btn/Ln split. Both CSS vars are
  // written up-front so on-canvas rendering matches the editor view.
  bodyEl.style.setProperty("--pix-note-btn", cfg.buttonColor || "#f66744");
  bodyEl.style.setProperty("--pix-note-line", cfg.lineColor || "#f66744");

  // Bg picker drives the node's visual background. Three-state logic
  // designed to (a) give fresh notes our dark #111111 default instead
  // of the lighter LiteGraph theme gray, and (b) not clobber
  // ComfyUI's native right-click Colors menu every time the user
  // saves text edits:
  //
  //   - hex string              → user picked a color in OUR Bg picker.
  //     node.bgcolor = hex (body), node.color = darken(hex, 0.3)
  //     (title). The darkened title matches the contrast native
  //     Colors-menu produces so the title strip always reads against
  //     the body.
  //   - null OR "transparent"   → user clicked Clear in OUR Bg picker.
  //     Reset to our #111111 default (flat, no darken — the default is
  //     already almost black, darkening further would be invisible).
  //   - undefined / key missing → fresh note OR user has never touched
  //     OUR Bg picker. If node.bgcolor is still null (LiteGraph default,
  //     brand-new node), apply our #111111 default so fresh notes are
  //     dark-gray like the editor interior. If node.bgcolor has a value,
  //     leave it alone — that means ComfyUI's native Colors menu set
  //     it, and our override would clobber the user's pick on every
  //     save (this was the bug that made us rework the pattern).
  //
  // node.setDirtyCanvas(true, true) forces LiteGraph to repaint the
  // node frame with the new colours; without it the graph keeps the
  // old colour until the user pans/zooms.
  const bg = cfg.backgroundColor;
  if (typeof bg === "string" && bg && bg !== "transparent") {
    node.color = darken(bg, 0.3);
    node.bgcolor = bg;
  } else if (bg === null || bg === "transparent") {
    node.color = "#111111";
    node.bgcolor = "#111111";
  } else if (!node.bgcolor) {
    node.color = "#111111";
    node.bgcolor = "#111111";
  }
  // else (undefined AND node.bgcolor already set): no-op, preserve
  // native Colors-menu pick.
  if (typeof node.setDirtyCanvas === "function") {
    node.setDirtyCanvas(true, true);
  }
  bodyEl.style.background = "transparent";

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
