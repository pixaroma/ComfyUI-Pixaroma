// Prompt Reader Pixaroma - read the positive prompt saved in a PNG's metadata.
//
// UX mirrors Load Image Pixaroma's input flow (upload button, file combo,
// drag-drop) but renders a read-only text area instead of an image preview.
// The extracted text is fetched live via /pixaroma/api/prompt_reader/extract
// on every file change so the user sees the result before running.
//
// Persistence: filename + extracted text are stored on
// node.properties.promptReaderState so the readout survives workflow save /
// reload and Vue tab switching (CLAUDE.md Vue Compat #9, Preview Pattern #4).

import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

const STATE_PROP = "promptReaderState";

// ── State helpers ──────────────────────────────────────────────────────────

function readState(node) {
  return node.properties?.[STATE_PROP] || {};
}

function writeState(node, patch) {
  if (!node.properties) node.properties = {};
  const cur = node.properties[STATE_PROP] || {};
  node.properties[STATE_PROP] = { ...cur, ...patch };
}

// ── CSS injection ──────────────────────────────────────────────────────────

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.id = "pix-pr-css";
  style.textContent = `
    .pix-pr-root {
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      color: #ddd;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pix-pr-upload-btn {
      width: 100%;
      background: ${BRAND};
      border: none;
      border-radius: 4px;
      padding: 9px 8px;
      font-size: 11px;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.08s;
    }
    .pix-pr-upload-btn:hover { background: #ff7e5a; }
    .pix-pr-hint {
      font-size: 9px;
      color: #777;
      text-align: center;
      letter-spacing: 0.3px;
      margin-top: -3px;
    }
    .pix-pr-dropdown {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 11px;
      color: #ccc;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }
    .pix-pr-dropdown:hover { border-color: #666; }
    .pix-pr-dropdown .name {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pix-pr-dropdown .arrow { color: ${BRAND}; font-size: 10px; margin-left: 6px; }
    .pix-pr-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      color: #888;
      padding: 0 2px;
    }
    .pix-pr-status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #555;
      flex-shrink: 0;
    }
    .pix-pr-status.found .pix-pr-status-dot { background: ${BRAND}; }
    .pix-pr-status.empty .pix-pr-status-dot { background: #555; }
    .pix-pr-status-label { flex: 1; }
    .pix-pr-copy {
      background: transparent;
      border: 1px solid #444;
      color: #aaa;
      border-radius: 3px;
      padding: 2px 8px;
      font-size: 10px;
      cursor: pointer;
      font-family: inherit;
    }
    .pix-pr-copy:hover { color: ${BRAND}; border-color: ${BRAND}; }
    .pix-pr-copy:disabled {
      opacity: 0.4; cursor: default;
    }
    .pix-pr-copy:disabled:hover { color: #aaa; border-color: #444; }
    .pix-pr-readout {
      width: 100%;
      box-sizing: border-box;
      background: #1d1d1d;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 8px;
      color: #ddd;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.45;
      resize: none;
      min-height: 80px;
      flex: 1;
      outline: none;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .pix-pr-readout.empty {
      color: #777;
      font-style: italic;
      font-family: inherit;
    }
    .pix-pr-popup {
      position: fixed;
      z-index: 99999;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      max-height: 300px;
      overflow-y: auto;
      font-size: 11px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      color: #ccc;
      min-width: 200px;
    }
    .pix-pr-popup-item {
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid #2a2a2a;
    }
    .pix-pr-popup-item:hover { background: #2a2a2a; }
    .pix-pr-popup-item.active { color: ${BRAND}; font-weight: 600; }
    .pix-pr-popup-empty { padding: 8px; color: #666; }
  `;
  document.head.appendChild(style);
}

// ── DOM build ──────────────────────────────────────────────────────────────

function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-pr-root";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pix-pr-upload-btn";
  btn.textContent = "Upload Image";
  btn.dataset.role = "upload";
  root.appendChild(btn);

  const hint = document.createElement("div");
  hint.className = "pix-pr-hint";
  hint.textContent = "or drag a PNG here";
  hint.dataset.role = "hint";
  root.appendChild(hint);

  const dd = document.createElement("div");
  dd.className = "pix-pr-dropdown";
  dd.dataset.role = "dropdown";
  dd.innerHTML = `<span class="name">— no image —</span><span class="arrow">▾</span>`;
  root.appendChild(dd);

  const status = document.createElement("div");
  status.className = "pix-pr-status";
  status.dataset.role = "status";
  status.innerHTML = `
    <span class="pix-pr-status-dot"></span>
    <span class="pix-pr-status-label">Pick an image to read its prompt.</span>
    <button class="pix-pr-copy" data-role="copy" disabled>Copy</button>
  `;
  root.appendChild(status);

  const readout = document.createElement("textarea");
  readout.className = "pix-pr-readout empty";
  readout.readOnly = true;
  readout.value = "";
  readout.placeholder = "The positive prompt will appear here.";
  readout.dataset.role = "readout";
  root.appendChild(readout);

  return root;
}

// ── Native combo hiding ────────────────────────────────────────────────────

function hideNativeImageCombo(node) {
  let imageWidget = null;
  for (const w of (node.widgets || [])) {
    if (!w) continue;
    if (w.name === "image") imageWidget = w;
    w.hidden = true;
    w.computeSize = () => [0, -4];
    if (!w.options) w.options = {};
    w.options.canvasOnly = true;
    if (w.element) w.element.style.display = "none";
  }
  requestAnimationFrame(() => {
    for (const w of (node.widgets || [])) {
      if (!w || w.name === "pixaroma_prompt_reader_ui") continue;
      if (w.element) w.element.style.display = "none";
      if (w.inputEl) w.inputEl.style.display = "none";
    }
  });
  return imageWidget;
}

// ── Backend calls ──────────────────────────────────────────────────────────

async function uploadImage(node, file, hintName = null) {
  const form = new FormData();
  if (file instanceof Blob && !(file instanceof File) && hintName) {
    form.append("image", file, hintName);
  } else {
    form.append("image", file);
  }
  const resp = await fetch("/upload/image", { method: "POST", body: form });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Upload failed (${resp.status}): ${t || resp.statusText}`);
  }
  const json = await resp.json();
  const saved = json?.name;
  if (!saved) throw new Error("Upload succeeded but no filename returned");

  const w = node._pixPrImageWidget || (node.widgets || []).find((x) => x.name === "image");
  if (w) {
    if (!w.options) w.options = {};
    const values = w.options.values || [];
    if (!values.includes(saved)) {
      values.push(saved);
      values.sort();
      w.options.values = values;
    }
    w.value = saved;
  }
  node.graph?.setDirtyCanvas?.(true, true);
  return saved;
}

function pickAndUpload(node) {
  return new Promise((resolve, reject) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.style.display = "none";
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      if (!file) { inp.remove(); resolve(null); return; }
      try {
        const saved = await uploadImage(node, file);
        resolve(saved);
      } catch (e) {
        reject(e);
      } finally {
        inp.remove();
      }
    });
    document.body.appendChild(inp);
    inp.click();
  });
}

async function extractPrompt(filename) {
  if (!filename) return { found: false, message: "No image selected." };
  const url = `/pixaroma/api/prompt_reader/extract?filename=${encodeURIComponent(filename)}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { found: false, message: `Server error (${resp.status})` };
    return await resp.json();
  } catch (e) {
    return { found: false, message: `Network error: ${e.message}` };
  }
}

// ── Readout rendering ──────────────────────────────────────────────────────

function applyResult(node, result) {
  const root = node._pixPrRoot;
  if (!root) return;
  const readout = root.querySelector('[data-role="readout"]');
  const status = root.querySelector('[data-role="status"]');
  const statusLabel = status?.querySelector(".pix-pr-status-label");
  const copy = root.querySelector('[data-role="copy"]');
  if (!readout || !status || !statusLabel || !copy) return;

  status.classList.remove("found", "empty");
  if (result?.found) {
    readout.value = result.text || "";
    readout.classList.remove("empty");
    status.classList.add("found");
    const src = result.source === "a1111"
      ? "Found · A1111 / Forge metadata"
      : "Found · ComfyUI workflow";
    statusLabel.textContent = src;
    copy.disabled = !readout.value;
  } else {
    readout.value = "";
    readout.classList.add("empty");
    status.classList.add("empty");
    statusLabel.textContent = result?.message || "No prompt found in this image.";
    copy.disabled = true;
  }

  // Persist (Pattern #9 / Preview Pattern #4) so reload / Vue tab switching
  // brings the same readout back without re-hitting the server.
  writeState(node, {
    filename: node._pixPrImageWidget?.value || "",
    found: !!result?.found,
    text: result?.text || "",
    message: result?.message || "",
    source: result?.source || null,
  });
}

function restoreFromState(node) {
  const s = readState(node);
  if (!s || !s.filename) return;
  if (s.found) {
    applyResult(node, { found: true, text: s.text, source: s.source });
  } else if (s.message) {
    applyResult(node, { found: false, message: s.message });
  }
}

function refreshDropdown(node) {
  const dd = node._pixPrRoot?.querySelector('[data-role="dropdown"] .name');
  if (!dd) return;
  const w = node._pixPrImageWidget;
  dd.textContent = (w?.value && w.value !== "") ? w.value : "— no image —";
}

async function onImageChanged(node) {
  refreshDropdown(node);
  const filename = node._pixPrImageWidget?.value || "";
  if (!filename) {
    applyResult(node, { found: false, message: "Pick an image to read its prompt." });
    return;
  }
  // Show a transient loading state.
  const statusLabel = node._pixPrRoot?.querySelector(".pix-pr-status-label");
  if (statusLabel) statusLabel.textContent = "Reading metadata...";
  const result = await extractPrompt(filename);
  applyResult(node, result);
}

// ── Dropdown popup ─────────────────────────────────────────────────────────

function openDropdown(node, anchorEl) {
  const w = node._pixPrImageWidget;
  if (!w) return;
  const values = w.options?.values || [];

  document.querySelector(".pix-pr-popup")?.remove();
  const popup = document.createElement("div");
  popup.className = "pix-pr-popup";

  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 2}px`;
  popup.style.width = `${rect.width}px`;

  if (values.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pix-pr-popup-empty";
    empty.textContent = "(no images uploaded yet)";
    popup.appendChild(empty);
  } else {
    for (const v of values) {
      const item = document.createElement("div");
      item.className = "pix-pr-popup-item" + (v === w.value ? " active" : "");
      item.textContent = v;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        w.value = v;
        close();
        onImageChanged(node);
      });
      popup.appendChild(item);
    }
  }
  document.body.appendChild(popup);

  function close() {
    popup.remove();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
  }
  const onDown = (e) => { if (!popup.contains(e.target)) close(); };
  const onWheel = (e) => { if (!popup.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
}

// ── Setup ──────────────────────────────────────────────────────────────────

function setupNode(node) {
  injectCSS();
  const imageWidget = hideNativeImageCombo(node);
  node._pixPrImageWidget = imageWidget;

  // Suppress ComfyUI's native bottom-of-node image preview. `image_upload:
  // True` makes the framework fetch the selected file and assign it to
  // `node.imgs`, which LiteGraph then renders below the widgets. We don't
  // need that here - the readout is the whole point - so we lock `imgs` to
  // an empty array. Any framework code that still reads `node.imgs[0]` just
  // sees undefined and skips the draw.
  try {
    Object.defineProperty(node, "imgs", {
      configurable: true,
      get() { return []; },
      set(_v) { /* swallow */ },
    });
  } catch (_e) { /* property already non-configurable - ignore */ }

  const root = buildRoot();
  node._pixPrRoot = root;

  // Load Image Pixaroma Pattern #4: measure each child's intrinsic
  // offsetHeight, but EXCLUDE the readout textarea (which has flex: 1 and
  // absorbs node-resize slack). Counting its grown offsetHeight here would
  // feed back into getMinHeight and the node would balloon every paint.
  // Treat the readout as a fixed minimum instead; the user can still drag
  // the node larger and the textarea fills the extra space, but the
  // measurement remains stable so the node can also be shrunk back down.
  const READOUT_MIN_H = 80;
  function measureHeight() {
    let total = 0;
    let visible = 0;
    for (const child of root.children) {
      const cs = window.getComputedStyle(child);
      if (cs.position === "absolute" || cs.position === "fixed") continue;
      if (cs.display === "none") continue;
      if (child.classList.contains("pix-pr-readout")) {
        total += READOUT_MIN_H;
      } else {
        total += child.offsetHeight;
      }
      visible += 1;
    }
    const padding = 16;
    const gaps = Math.max(0, visible - 1) * 8;
    return total + padding + gaps;
  }

  node.addDOMWidget("pixaroma_prompt_reader_ui", "custom", root, {
    canvasOnly: true,
    getValue: () => null,
    setValue: () => {},
    getMinHeight: measureHeight,
    margin: 4,
    serialize: false,
  });

  // Wrap the image widget's callback so native drag-drop on the bottom of the
  // node, programmatic value sets, and our own picks all route through the
  // same extract refresh.
  if (imageWidget) {
    const orig = imageWidget.callback;
    imageWidget.callback = function () {
      const r = orig?.apply(this, arguments);
      onImageChanged(node);
      return r;
    };
  }

  // Upload button
  root.querySelector('[data-role="upload"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const saved = await pickAndUpload(node);
      if (saved) onImageChanged(node);
    } catch (err) {
      console.error("[PixaromaPromptReader] upload failed", err);
      alert("Upload failed: " + err.message);
    }
  });

  // Dropdown
  root.querySelector('[data-role="dropdown"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openDropdown(node, e.currentTarget);
  });

  // Copy button
  root.querySelector('[data-role="copy"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const readout = root.querySelector('[data-role="readout"]');
    const text = readout?.value || "";
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        readout.select();
        document.execCommand("copy");
      }
      const btn = e.currentTarget;
      const orig = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = orig; }, 1200);
    } catch (err) {
      console.error("[PixaromaPromptReader] copy failed", err);
    }
  });

  // Drag-drop on the DOM widget root. ComfyUI's native bottom-preview drop
  // handler also covers the node, so this is a safety net for drops landing
  // squarely over our panel.
  root.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
  });
  root.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      await uploadImage(node, file);
      onImageChanged(node);
    } catch (err) {
      console.error("[PixaromaPromptReader] drop upload failed", err);
      alert("Upload failed: " + err.message);
    }
  });

  // Initial population - defer past configure() so widget value is restored
  // (Vue Compat #8 - nodeCreated fires BEFORE configure resolves saved values).
  queueMicrotask(() => {
    refreshDropdown(node);
    const s = readState(node);
    const wval = imageWidget?.value || "";
    // If we have cached state for the currently-selected file, use it (fast).
    // Otherwise, kick off a live extract so the user always sees something.
    if (s.filename && s.filename === wval && (s.text || s.message)) {
      restoreFromState(node);
    } else if (wval) {
      onImageChanged(node);
    }
  });
}

// ── Extension registration ─────────────────────────────────────────────────

app.registerExtension({
  name: "Pixaroma.PromptReader",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptReader") return;
    const origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origCfg?.apply(this, arguments);
      queueMicrotask(() => {
        refreshDropdown(this);
        restoreFromState(this);
      });
      return r;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaPromptReader") return;
    setupNode(node);
  },
});
