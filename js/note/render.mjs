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

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "pix-note-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 220);
  }, 1800);
}

// Themed yes/no confirm that matches the editor's modal styling. Resolves
// true if the user accepts, false if they cancel or click the backdrop.
// Uses the same .pix-note-confirm-* classes injected by css.mjs, so it
// looks identical to the editor's unsaved-changes dialog.
function confirmCreateFolder(folder) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-note-confirm-backdrop";
    const box = document.createElement("div");
    box.className = "pix-note-confirm-box";
    const title = document.createElement("div");
    title.className = "pix-note-confirm-title";
    title.textContent = "Folder doesn't exist";
    const msg = document.createElement("div");
    msg.className = "pix-note-confirm-text";
    msg.textContent = `The folder "${folder}" doesn't exist. Create it and open?`;
    const actions = document.createElement("div");
    actions.className = "pix-note-confirm-actions";
    const no = document.createElement("button");
    no.className = "pix-note-btn";
    no.textContent = "No";
    const yes = document.createElement("button");
    yes.className = "pix-note-btn primary";
    yes.textContent = "Yes, create";
    actions.appendChild(no);
    actions.appendChild(yes);
    box.appendChild(title);
    box.appendChild(msg);
    box.appendChild(actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    const finish = (v) => { backdrop.remove(); resolve(v); };
    no.addEventListener("click", () => finish(false));
    yes.addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(false);
    });
  });
}

async function openFolderFlow(folder) {
  let check;
  try {
    const r = await fetch("/pixaroma/api/note/check_folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    });
    check = await r.json();
    if (!r.ok) throw new Error(check?.error || "check_failed");
  } catch (e) {
    showToast("Couldn't reach the ComfyUI backend");
    return;
  }
  const resolved = check.resolved || folder || "models";
  if (check.exists) {
    try {
      await fetch("/pixaroma/api/note/open_folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      showToast(`Opened ${resolved}`);
    } catch (e) {
      showToast("Couldn't open folder");
    }
    return;
  }
  const ok = await confirmCreateFolder(resolved);
  if (!ok) return;
  try {
    const r = await fetch("/pixaroma/api/note/open_folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, create: true }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.msg || "open_failed");
    showToast(`Created and opened ${resolved}`);
  } catch (e) {
    showToast("Couldn't create folder");
  }
}

export function attachCanvasClickDelegation(bodyEl) {
  bodyEl.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    // Download pill: fire the folder-open flow in parallel with the
    // browser's navigation (target=_blank already opens the URL in a new
    // tab to start the actual download). Empty data-folder → backend
    // defaults to "models".
    if (a.classList.contains("pix-note-dl")) {
      const folder = a.getAttribute("data-folder") || "";
      openFolderFlow(folder);
    }
    e.stopPropagation();
  }, true);
  bodyEl.addEventListener("mousedown", (e) => {
    if (e.target.closest("a")) e.stopPropagation();
  }, true);
}
