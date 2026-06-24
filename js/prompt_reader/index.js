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
import { BRAND, applyAdaptiveCanvasOnly } from "../shared/index.mjs";

const STATE_PROP = "promptReaderState";

// Tracks the currently-selected Prompt Reader node so the global PageUp /
// PageDown keydown listener can route the step to the right one. Cleared
// on deselect or removal.
let _activePromptReaderNode = null;

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
    /* Nodes 2.0 renders its own .image-preview panel (fed by ComfyUI's
       internal node-preview state, NOT node.imgs which we lock to []). It
       goes stale on programmatic file changes and we don't want an image
       preview on this text-readout node anyway. Hide it, scoped to our node
       via :has() so no other node is affected. Legacy has no .lg-node /
       .image-preview, so this rule is a no-op there. */
    .lg-node:has(.pix-pr-root) .image-preview { display: none !important; }

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
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      font-family: inherit;
      transition: background 0.08s;
    }
    .pix-pr-upload-btn:hover { background: #ff7e5a; }
    /* Icon mirrors Load Image Pixaroma's upload button for consistency. */
    .pix-pr-upload-btn .ico {
      width: 14px; height: 14px;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/upload.svg") center/14px 14px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/upload.svg") center/14px 14px no-repeat;
    }
    /* File row: [◀] [ dropdown ] [▶] - mirrors Load Image Pixaroma. */
    .pix-pr-filerow {
      display: flex;
      gap: 4px;
      align-items: stretch;
    }
    .pix-pr-filerow .pix-pr-dropdown { flex: 1; min-width: 0; }
    .pix-pr-nav {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      color: #aaa;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      width: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      transition: background 0.08s, border-color 0.08s, color 0.08s;
      flex-shrink: 0;
    }
    .pix-pr-nav:hover:not(.disabled) { border-color: ${BRAND}; color: ${BRAND}; }
    .pix-pr-nav:active:not(.disabled) { background: ${BRAND}; color: #fff; }
    .pix-pr-nav.disabled { opacity: 0.3; cursor: default; }
    .pix-pr-dropdown .counter {
      color: #777;
      font-size: 9px;
      margin-left: 6px;
      flex-shrink: 0;
    }
    .pix-pr-popup-section {
      padding: 4px 10px 3px;
      font-size: 9px;
      color: #777;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: #161616;
      border-bottom: 1px solid #2a2a2a;
      user-select: none;
    }
    .pix-pr-popup-section:not(:first-child) { border-top: 1px solid #2a2a2a; }
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
      background: ${BRAND};
      border: 1px solid ${BRAND};
      color: #fff;
      font-weight: 600;
      border-radius: 3px;
      padding: 2px 10px;
      font-size: 10px;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.08s;
    }
    .pix-pr-copy:hover { background: #ff7e5a; border-color: #ff7e5a; }
    .pix-pr-copy:disabled {
      opacity: 0.35; cursor: default;
    }
    .pix-pr-copy:disabled:hover { background: ${BRAND}; border-color: ${BRAND}; }
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

  const btnUpload = document.createElement("button");
  btnUpload.type = "button";
  btnUpload.className = "pix-pr-upload-btn";
  btnUpload.dataset.role = "upload";
  // Icon + label, matching Load Image Pixaroma's upload button.
  const upIco = document.createElement("span");
  upIco.className = "ico";
  const upLbl = document.createElement("span");
  upLbl.textContent = "Upload Image";
  btnUpload.append(upIco, upLbl);
  root.appendChild(btnUpload);

  const hint = document.createElement("div");
  hint.className = "pix-pr-hint";
  hint.textContent = "or drag a PNG here";
  hint.dataset.role = "hint";
  root.appendChild(hint);

  // File row with prev/next arrows so users can flip through images
  // visually, mirroring Load Image Pixaroma.
  const fileRow = document.createElement("div");
  fileRow.className = "pix-pr-filerow";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "pix-pr-nav";
  prev.dataset.role = "prev";
  prev.title = "Previous image (PageUp)";
  prev.textContent = "◀";

  const dd = document.createElement("div");
  dd.className = "pix-pr-dropdown";
  dd.dataset.role = "dropdown";
  dd.innerHTML = `<span class="name">— no image —</span><span class="counter" data-role="counter"></span><span class="arrow">▾</span>`;

  const next = document.createElement("button");
  next.type = "button";
  next.className = "pix-pr-nav";
  next.dataset.role = "next";
  next.title = "Next image (PageDown)";
  next.textContent = "▶";

  fileRow.append(prev, dd, next);
  root.appendChild(fileRow);

  // Order: dropdown → readout → status (info + Copy). The status pill is
  // placed AFTER the readout because (a) the user reads the prompt first
  // and the info chip below acts as a small caption, and (b) the Copy
  // button colocated with the status sits naturally underneath the text
  // it copies.
  const readout = document.createElement("textarea");
  readout.className = "pix-pr-readout empty";
  readout.readOnly = true;
  readout.value = "";
  readout.placeholder = "The positive prompt will appear here.";
  readout.dataset.role = "readout";
  root.appendChild(readout);

  const status = document.createElement("div");
  status.className = "pix-pr-status";
  status.dataset.role = "status";
  status.innerHTML = `
    <span class="pix-pr-status-dot"></span>
    <span class="pix-pr-status-label">Pick an image to read its prompt.</span>
    <button class="pix-pr-copy" data-role="copy" disabled>Copy</button>
  `;
  root.appendChild(status);

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
      const _el = w.element || w.inputEl; // prefer .element; .inputEl only on old builds (no deprecation warning)
      if (_el) _el.style.display = "none";
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
    // Defensive cache - issue #38 hardening. Same pattern used by every
    // other pick path (dropdown click, arrow nav, native drag-drop).
    node._pixPrSelectedFilename = saved;
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

// Per-node monotonic request id - rapid file-combo clicks would otherwise
// race, and an out-of-order response could stamp stale text on the readout.
// `onImageChanged` bumps node._pixPrReqId before fetching, then checks the
// id is still current before applying the result.
function nextReqId(node) {
  node._pixPrReqId = (node._pixPrReqId | 0) + 1;
  return node._pixPrReqId;
}

// ── Readout rendering ──────────────────────────────────────────────────────

function applyResult(node, result) {
  const root = node._pixPrRoot;
  // Guard: node may have been removed mid-fetch (onRemoved nulls _pixPrRoot).
  // Without this guard the in-flight response would still try to write to
  // detached DOM and persist state on a deleted node.
  if (!root || !root.isConnected) return;
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
  const root = node._pixPrRoot;
  if (!root) return;
  const w = node._pixPrImageWidget;
  const nameEl = root.querySelector('[data-role="dropdown"] .name');
  const counter = root.querySelector('[data-role="counter"]');
  const value = w?.value || "";
  if (nameEl) nameEl.textContent = value ? value : "— no image —";
  const values = w?.options?.values || [];
  if (counter) {
    if (value && values.length > 1) {
      const idx = values.indexOf(value);
      counter.textContent = idx >= 0 ? `${idx + 1} / ${values.length}` : "";
    } else {
      counter.textContent = "";
    }
  }
  const prev = root.querySelector('[data-role="prev"]');
  const next = root.querySelector('[data-role="next"]');
  const disabled = values.length < 2;
  if (prev) prev.classList.toggle("disabled", disabled);
  if (next) next.classList.toggle("disabled", disabled);
}

// Split "Studio1/cat.png" into {subfolder, filename}. Mirrors the same
// helper in load_image/api.mjs so the two nodes share grouping behaviour.
function splitPath(path) {
  if (!path) return { subfolder: "", filename: "" };
  const norm = String(path).replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return { subfolder: "", filename: norm };
  return { subfolder: norm.slice(0, idx), filename: norm.slice(idx + 1) };
}

// Step the selected image by `offset` (+1 / -1), wrapping. Routes through
// the same callback path as a manual pick so the extract refresh happens.
function pickByOffset(node, offset) {
  const w = node._pixPrImageWidget;
  if (!w) return;
  const values = w.options?.values || [];
  if (values.length === 0) return;
  const cur = values.indexOf(w.value);
  let next;
  if (cur < 0) next = offset > 0 ? 0 : values.length - 1;
  else next = ((cur + offset) % values.length + values.length) % values.length;
  w.value = values[next];
  node._pixPrSelectedFilename = values[next];
  onImageChanged(node);
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
  const myId = nextReqId(node);
  const result = await extractPrompt(filename);
  // Bail if a newer request has been kicked off in the meantime - prevents
  // out-of-order responses from stamping stale text on the readout.
  if (node._pixPrReqId !== myId) return;
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
    // Group by subfolder: root first, then alphabetised folders. Each item
    // shows only the bare filename; the `title` attribute holds the full
    // path for hover discoverability.
    const map = new Map();
    for (const v of values) {
      const { subfolder, filename } = splitPath(v);
      if (!map.has(subfolder)) map.set(subfolder, []);
      map.get(subfolder).push({ full: v, name: filename });
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    const folders = [...map.keys()].sort((a, b) => {
      if (a === "" && b !== "") return -1;
      if (a !== "" && b === "") return 1;
      return a.localeCompare(b);
    });
    const showHeaders = folders.length > 1 || (folders.length === 1 && folders[0] !== "");
    let scrollTarget = null;
    for (const folder of folders) {
      if (showHeaders) {
        const head = document.createElement("div");
        head.className = "pix-pr-popup-section";
        head.textContent = folder === "" ? "root" : folder;
        popup.appendChild(head);
      }
      for (const entry of map.get(folder)) {
        const item = document.createElement("div");
        item.className = "pix-pr-popup-item" + (entry.full === w.value ? " active" : "");
        item.textContent = entry.name;
        item.title = entry.full;
        if (entry.full === w.value) scrollTarget = item;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          w.value = entry.full;
          node._pixPrSelectedFilename = entry.full;
          close();
          onImageChanged(node);
        });
        popup.appendChild(item);
      }
    }
    if (scrollTarget) queueMicrotask(() => {
      try { scrollTarget.scrollIntoView({ block: "nearest" }); }
      catch (_e) { /* ignore */ }
    });
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
  // an empty array. Side effect: right-click menu items that read
  // `node.imgs[0]` (Save Image, Copy Clipspace, Open Image) become no-ops.
  // That's an acceptable tradeoff since the file is reachable directly via
  // ComfyUI's /view route from the input folder anyway.
  //
  // Probe the existing descriptor first: if a previous redefine made it
  // non-configurable or some earlier framework code assigned a value the
  // engine left non-configurable, defineProperty throws TypeError and the
  // previous try/catch was swallowing that silently. Log it once so a
  // future Vue-frontend change becomes visible in the console.
  const imgsDesc = Object.getOwnPropertyDescriptor(node, "imgs");
  if (imgsDesc && imgsDesc.configurable === false) {
    console.warn("[PixaromaPromptReader] cannot suppress node.imgs - existing descriptor is non-configurable");
  } else {
    try {
      Object.defineProperty(node, "imgs", {
        configurable: true,
        get() { return []; },
        set(_v) { /* swallow */ },
      });
    } catch (e) {
      console.warn("[PixaromaPromptReader] node.imgs suppression failed:", e.message);
    }
  }

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

  const _prWidget = node.addDOMWidget("pixaroma_prompt_reader_ui", "custom", root, {
    // canvasOnly set adaptively below (CLAUDE.md Nodes 2.0): true in legacy
    // (out of the Parameters tab), false in Nodes 2.0 (renders in Vue body).
    getValue: () => null,
    setValue: () => {},
    getMinHeight: measureHeight,
    margin: 4,
    serialize: false,
  });
  applyAdaptiveCanvasOnly(_prWidget);

  // Default node size for fresh-on-canvas placements. LiteGraph's configure
  // (workflow restore) runs AFTER nodeCreated and overwrites node.size with
  // the saved value, so existing workflows keep whatever size the user had.
  // Only new drops get this size.
  node.size[0] = 400;
  node.size[1] = 300;

  // Wrap the image widget's callback so native drag-drop on the bottom of the
  // node, programmatic value sets, and our own picks all route through the
  // same extract refresh.
  if (imageWidget) {
    const orig = imageWidget.callback;
    imageWidget.callback = function () {
      const r = orig?.apply(this, arguments);
      if (imageWidget.value) node._pixPrSelectedFilename = imageWidget.value;
      onImageChanged(node);
      return r;
    };
    // Seed the defensive cache from whatever value the widget has at setup
    // (covers saved-workflow restore where configure() landed before us).
    if (imageWidget.value) node._pixPrSelectedFilename = imageWidget.value;
  }

  // Upload button. Errors surface inline via the status pill (Note Pattern
  // #7: never use alert() inside our overlays / panels - it context-switches
  // away and can be blocked by Vue's modal layer).
  root.querySelector('[data-role="upload"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const saved = await pickAndUpload(node);
      if (saved) onImageChanged(node);
    } catch (err) {
      console.error("[PixaromaPromptReader] upload failed", err);
      applyResult(node, { found: false, message: `Upload failed: ${err.message}` });
    }
  });

  // Dropdown
  root.querySelector('[data-role="dropdown"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openDropdown(node, e.currentTarget);
  });

  // Prev / Next arrows - flip through input/ images visually. PageUp/PageDown
  // when the node is selected do the same. Mirrors Load Image Pixaroma.
  root.querySelector('[data-role="prev"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.currentTarget.classList.contains("disabled")) return;
    pickByOffset(node, -1);
  });
  root.querySelector('[data-role="next"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.currentTarget.classList.contains("disabled")) return;
    pickByOffset(node, +1);
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
      applyResult(node, { found: false, message: `Upload failed: ${err.message}` });
    }
  });

  // Initial population - defer past configure() so widget value is restored
  // (Vue Compat #8 - nodeCreated fires BEFORE configure resolves saved
  // values). We always re-extract on load rather than using the cached
  // state, so any message-text changes from a Pixaroma update propagate
  // to existing workflows without the user having to re-pick a file.
  queueMicrotask(() => {
    refreshDropdown(node);
    const wval = imageWidget?.value || "";
    if (wval) {
      onImageChanged(node);
    } else {
      // No image selected - restore at least the cached UI text so the
      // user sees the previous result on tab switch without a flash.
      restoreFromState(node);
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
        const wval = this._pixPrImageWidget?.value || "";
        if (wval) {
          this._pixPrSelectedFilename = wval;
          onImageChanged(this);
        } else {
          restoreFromState(this);
        }
      });
      return r;
    };

    // Track the active node so the global PageUp / PageDown handler knows
    // which Prompt Reader to step.
    const origSel = nodeType.prototype.onSelected;
    const origDes = nodeType.prototype.onDeselected;
    nodeType.prototype.onSelected = function () {
      _activePromptReaderNode = this;
      return origSel?.apply(this, arguments);
    };
    nodeType.prototype.onDeselected = function () {
      if (_activePromptReaderNode === this) _activePromptReaderNode = null;
      return origDes?.apply(this, arguments);
    };

    // Cleanup on node removal. The file-dropdown popup attaches FOUR
    // document-level capture-phase listeners on every open; without an
    // explicit close on removal those leak forever (closure pins the
    // popup + node alive). Bumping the per-node request id also
    // invalidates any in-flight extract response so it can't apply
    // results to a destroyed root.
    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      const r = origRemoved?.apply(this, arguments);
      try {
        // Trigger every open popup's close() path (their mousedown handler
        // closes when the click is outside, which fires here).
        document.querySelectorAll(".pix-pr-popup").forEach((p) => p.remove());
      } catch (_e) { /* ignore */ }
      // Stale in-flight requests after this point will all fail the
      // reqId match in onImageChanged.
      this._pixPrReqId = (this._pixPrReqId | 0) + 1;
      this._pixPrRoot = null;
      this._pixPrImageWidget = null;
      if (_activePromptReaderNode === this) _activePromptReaderNode = null;
      return r;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaPromptReader") return;
    setupNode(node);
  },
});

// Global PageUp / PageDown to step the active Prompt Reader node's image,
// matching the equivalent shortcut in Load Image Pixaroma.
window.addEventListener("keydown", (e) => {
  if (!_activePromptReaderNode) return;
  if (e.key !== "PageUp" && e.key !== "PageDown") return;
  const tag = (e.target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (e.target?.isContentEditable) return;
  e.preventDefault();
  e.stopPropagation();
  pickByOffset(_activePromptReaderNode, e.key === "PageUp" ? -1 : +1);
}, true);
