// Save Image Pixaroma — extension entry point.
// Save images to ANY folder on disk (or output/), with a live "Will save as"
// filename preview, PNG/JPG, workflow embedding, and batch support. State on
// node.properties.saveImageState, injected into the hidden SaveImageState
// input at graphToPrompt time (Pattern #9). Design approved via mockup
// 2026-07-03 (docs/superpowers/specs/2026-07-03-save-image-node-design.md).

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import {
  applyAdaptiveCanvasOnly,
  isVueNodes,
  installResizeFloor,
  hideJsonWidget,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { applyFilenameTokenRefs } from "../shared/filename_tokens.mjs";
import {
  COMFY_CLASS,
  HIDDEN_INPUT_NAME,
  DEFAULT_STATE,
  readState,
  writeState,
  normalizePath,
  resolveDateTokens,
  expandNativeTokens,
  cleanInputName,
} from "./state.mjs";
import { injectCSS, buildRoot, el } from "./ui.mjs";
import { openSettingsPanel, closeSettingsPanelFor } from "./settings.mjs";

const MIN_W = 360;
const DEFAULT_W = 460;
const DEFAULT_H = 740;
const PREVIEW_MIN = 160; // the viewer's minimum height inside the floor
const THUMB_SHOW_MAX = 16;

const CHIPS = [
  { label: "+ Input name", tok: "%input%", title: "Insert the wired name input (e.g. the filename from Load Image Pixaroma)" },
  { label: "+ Date", dyn: "date", title: "Insert the date of the save (order comes from the right-click settings). Codes: yyyy year, MM month (capital M), dd day" },
  { label: "+ Time", tok: "%date:hh-mm-ss%", title: "Insert the time of the save. Codes: hh hours, mm minutes (lowercase m), ss seconds" },
  { label: "+ Counter", tok: "%counter%", title: "Insert the auto-increasing number (files never overwrite)" },
  { label: "+ Seed", tok: "%Seed Pixaroma.seed%", title: "Insert the seed from a Seed Pixaroma node" },
  { label: "+ Width", tok: "%width%", title: "Insert the image width in pixels" },
  { label: "+ Height", tok: "%height%", title: "Insert the image height in pixels" },
  { label: "+ Batch #", tok: "%batch_num%", title: "Insert the frame's position inside a batch (0, 1, 2 ...)" },
  { label: "+ Model", dyn: "model", title: "Insert the model's name: finds the model loader in this workflow automatically" },
  { label: "+ Date folder", dyn: "datefolder", title: "Put a folder per day in front of the name, e.g. 2026-07-03/image" },
];

// Find a model loader anywhere in the graph (subgraphs too) and build a
// %NodeName.widget% token for it, so the model's name lands in the filename.
function findModelToken() {
  const KEYS = ["ckpt_name", "unet_name", "model_name", "gguf_name"];
  const nodes = [];
  (function walk(g) {
    if (!g) return;
    for (const n of g._nodes || g.nodes || []) {
      if (!n) continue;
      nodes.push(n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== g) walk(inner);
    }
  })(app.graph?.rootGraph || app.graph);
  for (const n of nodes) {
    const w = n.widgets?.find((x) => x && KEYS.includes(x.name));
    if (w) {
      const nm = (n.properties && n.properties["Node name for S&R"]) || n.title || n.type;
      if (nm) return "%" + nm + "." + w.name + "%";
    }
  }
  return null;
}

// ── node body FLOOR (fill model: the big preview grows with the node) ────────
// Sum the INNER layer's children, but count the preview box at its MINIMUM
// (not its grown offsetHeight - Load Image pattern) so the node can shrink.
function measureFloor(ui) {
  const inner = ui && ui.inner;
  if (!inner) return 320;
  let h = 0;
  let n = 0;
  for (const ch of inner.children) {
    let oh = ch.offsetHeight;
    if (oh <= 0) continue;
    if (ch === ui.savedSec) {
      oh = oh - (ui.view ? ui.view.offsetHeight : 0) + PREVIEW_MIN;
    }
    h += oh;
    n++;
  }
  if (n === 0) return 320; // pre-attach placeholder
  h += 16; // inner vertical padding (8 + 8)
  h += (n - 1) * 10; // flex gaps
  return Math.max(200, h);
}

// Grow-ONLY fit: after a run adds the thumb strip, make sure the node is at
// least floor-tall. Never shrinks (the preview area is the user's to size).
// Self-gates on isGraphLoading (Vue Compat #18).
function growToFloor(node) {
  if (!node._pixSiUI) return;
  requestAnimationFrame(() => {
    if (!node._pixSiUI || isGraphLoading()) return;
    const sz = node.computeSize?.();
    if (sz && sz[1] > node.size[1] + 1) {
      if (node.setSize) node.setSize([node.size[0], sz[1]]);
      else node.size[1] = sz[1];
      node.setDirtyCanvas?.(true, true);
    }
  });
}

// ── backend helpers ───────────────────────────────────────────────────────────
// Browse reuses the Load Images from Folder native-dialog route (generic:
// it just pops the OS picker and returns a path).
async function pickNativeFolder(startPath) {
  try {
    const url = `/pixaroma/api/load_images_folder/pick_native?path=${encodeURIComponent(startPath || "")}`;
    const r = await fetch(url);
    return await r.json();
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// ── the single info line under the image (dims + save summary + flashes) ─────
function updateInfoLine(node) {
  const ui = node._pixSiUI;
  if (!ui) return;
  const parts = [];
  const d = node._pixSiLastDims;
  if (d) parts.push(d.w + " × " + d.h);
  if (node._pixSiSummary) parts.push(node._pixSiSummary);
  ui.infoLine.textContent = parts.join("   ·   ");
  ui.infoLine.title = node._pixSiFolderInfo || "";
  ui.infoLine.style.color = "#8f8f8f";
}

// Temporary message on the info line; reverts to dims + summary after.
function flashStatus(node, kind, text, ms = 2600) {
  const ui = node._pixSiUI;
  if (!ui) return;
  ui.infoLine.textContent = text;
  ui.infoLine.style.color = kind === "ok" ? "#3ec371" : "#cfcfcf";
  clearTimeout(node._pixSiFlashT);
  node._pixSiFlashT = setTimeout(() => updateInfoLine(node), ms);
}

function buildViewUrl(f) {
  return (
    "/view?filename=" + encodeURIComponent(f.filename) +
    "&type=" + encodeURIComponent(f.type || "output") +
    "&subfolder=" + encodeURIComponent(f.subfolder || "")
  );
}

// Raw ui entry -> preview source. Files inside output/temp go through /view;
// external files go through the token route; anything else has no preview.
function entrySrc(f) {
  if (f && f.type && f.filename) return buildViewUrl(f);
  if (f && f.token) return "/pixaroma/api/save_image/file?t=" + encodeURIComponent(f.token);
  return null;
}
function entriesToFrames(list) {
  const frames = [];
  for (const f of list || []) {
    const src = entrySrc(f);
    if (!src) continue;
    frames.push({
      src,
      title: (f.path || ((f.subfolder ? f.subfolder + "/" : "") + (f.filename || ""))) || "",
    });
    if (frames.length >= THUMB_SHOW_MAX) break;
  }
  return frames;
}

// ── the viewer (Preview Image parity): single fills; batch = grid; click a
// cell to expand it, ✕ goes back; hover arrows + counter in expanded view ────
function renderPreviewUI(node) {
  const ui = node._pixSiUI;
  if (!ui) return;
  const frames = node._pixSiFrames || [];
  const n = frames.length;
  let sel = node._pixSiSel || 0;
  if (sel >= n) sel = n - 1;
  if (sel < 0) sel = 0;
  node._pixSiSel = sel;

  ui.view.classList.toggle("has", n > 0);
  ui.ph.style.display = n ? "none" : "flex";
  const gridmode = n > 1 && !node._pixSiExpanded;
  ui.view.classList.toggle("gridmode", gridmode);
  ui.bigImg.style.display = n && !gridmode ? "block" : "none";

  if (n && !gridmode) {
    const f = frames[sel];
    if (ui.bigImg.getAttribute("src") !== f.src) ui.bigImg.src = f.src;
    ui.bigImg.title = (f.title || "") + (n > 1 ? " - click for the next image" : "");
  }

  ui.grid.innerHTML = "";
  if (gridmode) {
    const cols = Math.ceil(Math.sqrt(n));
    ui.grid.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
    const total = Math.max(node._pixSiTotal || 0, n);
    frames.forEach((f, i) => {
      const cell = el("div", "pix-si-cell");
      const im = el("img");
      im.loading = "lazy";
      im.src = f.src;
      im.onerror = () => {
        im.style.display = "none";
      };
      cell.title = (f.title || "") + " - click to view";
      cell.appendChild(im);
      cell.appendChild(el("div", "pix-si-cellbadge", (i + 1) + " / " + total));
      cell.addEventListener("click", () => {
        node._pixSiSel = i;
        node._pixSiExpanded = true;
        renderPreviewUI(node);
      });
      ui.grid.appendChild(cell);
    });
  }

  const expandedMulti = n > 1 && !gridmode;
  ui.navPrev.classList.toggle("show", expandedMulti);
  ui.navNext.classList.toggle("show", expandedMulti);
  ui.counter.style.display = expandedMulti ? "block" : "none";
  ui.closeX.style.display = expandedMulti ? "block" : "none";
  const total = Math.max(node._pixSiTotal || 0, n);
  ui.counter.textContent = (sel + 1) + " / " + total;
  updateInfoLine(node);
}

function stepPreview(node, dir) {
  const n = (node._pixSiFrames || []).length;
  if (n < 2) return;
  node._pixSiSel = ((node._pixSiSel || 0) + dir + n) % n;
  renderPreviewUI(node);
}

// Copy the SHOWN frame to the OS clipboard as PNG (Preview Image parity).
// Converted through a canvas so JPG saves copy fine (clipboards want PNG).
async function copyFrame(node) {
  const ui = node._pixSiUI;
  const frames = node._pixSiFrames || [];
  const f = frames[node._pixSiSel || 0];
  if (!ui || !f) return;
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error("no clipboard api");
    const img = ui.bigImg;
    if (!img.naturalWidth) throw new Error("not loaded");
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    cv.getContext("2d").drawImage(img, 0, 0);
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!blob) throw new Error("convert failed");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    flashStatus(node, "ok", "Copied to clipboard");
  } catch {
    flashStatus(node, "info", "Could not copy - the browser blocked clipboard access");
  }
}

function openFrame(node) {
  const frames = node._pixSiFrames || [];
  const f = frames[node._pixSiSel || 0];
  if (!f) return;
  const w = window.open(f.src, "_blank", "noopener");
  if (!w) flashStatus(node, "info", "Popup blocked by the browser");
}

// ── live "Will save as" preview ───────────────────────────────────────────────
function resolveWiredName(node) {
  try {
    const inp = node.inputs && node.inputs.find((i) => i && i.name === "name");
    if (!inp || inp.link == null) return "";
    const graph = node.graph || app.graph;
    let link = graph.links?.[inp.link];
    if (!link && typeof graph.links?.get === "function") link = graph.links.get(inp.link);
    if (!link) return "name";
    const origin = graph.getNodeById ? graph.getNodeById(link.origin_id) : null;
    if (!origin) return "name";
    if (origin.comfyClass === "PixaromaLoadImage") {
      const w = origin.widgets?.find((x) => x && x.name === "image");
      let v = typeof w?.value === "string" ? w.value : "";
      v = v.replace(/\s*\[(input|output|temp)\]\s*$/i, "");
      v = v.split("/").pop().split("\\").pop();
      return cleanInputName(v) || "name";
    }
    // a plain text-ish widget on the origin (Text Pixaroma etc.) — best effort
    const tw = origin.widgets?.find(
      (x) => x && typeof x.value === "string" && x.value &&
        (x.name === "text" || x.name === "value" || x.name === "string")
    );
    if (tw) return cleanInputName(String(tw.value).slice(0, 60)) || "name";
    return "name"; // wired, value only known at run time
  } catch {
    return "name";
  }
}

function scheduleCounterFetch(node, folderRaw, nameWithExt) {
  if (!nameWithExt.includes("%counter%")) return;
  const key = folderRaw + " " + nameWithExt;
  if (node._pixSiCntKey === key) return; // already fetched / in flight
  node._pixSiCntKey = key;
  clearTimeout(node._pixSiCntTimer);
  node._pixSiCntTimer = setTimeout(async () => {
    try {
      const r = await fetch(
        "/pixaroma/api/save_image/next_counter?folder=" + encodeURIComponent(folderRaw) +
        "&name=" + encodeURIComponent(nameWithExt)
      );
      const j = await r.json();
      if (node._pixSiCntKey !== key || !node._pixSiUI) return; // superseded
      node._pixSiCounterNum = (j && j.counter) || 1;
      updatePreview(node);
    } catch {}
  }, 350);
}

function updatePreview(node) {
  const ui = node._pixSiUI;
  if (!ui) return;
  const st = readState(node);
  let s = String(st.pattern || DEFAULT_STATE.pattern);
  s = s.replace(/%input%/g, resolveWiredName(node));
  s = resolveDateTokens(s);
  s = expandNativeTokens(s); // %year% %month% %day% %hour% %minute% %second%
  s = applyFilenameTokenRefs(s); // %Seed Pixaroma.seed% and friends
  const dims = node._pixSiLastDims;
  if (dims) {
    s = s.replace(/%width%/g, String(dims.w)).replace(/%height%/g, String(dims.h));
  }
  s = s.replace(/%batch_num%/g, "0");
  // light display mirror of the Python sanitizer
  s = s.replace(/\\/g, "/").replace(/[<>:"|?*]/g, "_").replace(/_{2,}/g, "_");
  const ext = st.format === "jpg" ? ".jpg" : ".png";
  const digits = Math.max(1, Math.min(8, parseInt(st.counterDigits, 10) || 5));
  const padded = String(node._pixSiCounterNum || 1).padStart(digits, "0");
  const resolved = s.replace(/%counter%/g, padded);
  const folder = st.folder ? normalizePath(st.folder) : "";
  const display =
    (folder ? folder.replace(/\//g, "\\") : "…\\ComfyUI\\output") +
    "\\" +
    resolved.split("/").filter(Boolean).join("\\") +
    ext;
  ui.prevPath.textContent = display;
  scheduleCounterFetch(node, st.folder || "", s + ext);
}

// ── face sync (DOM only; safe on the load path) ──────────────────────────────
function syncFace(node) {
  const ui = node._pixSiUI;
  if (!ui) return;
  const st = readState(node);
  if (document.activeElement !== ui.folderInput) ui.folderInput.value = st.folder || "";
  if (document.activeElement !== ui.patternInput) ui.patternInput.value = st.pattern || "";
  const jpg = st.format === "jpg";
  ui.fmtPng.classList.toggle("on", !jpg);
  ui.fmtJpg.classList.toggle("on", jpg);
  ui.fmtJpg.title =
    "Smaller JPG files, quality " + (st.quality ?? 90) +
    " (right-click to change). No transparency. Workflows reload from PNG only.";
  const preview = !st.saveOnRun;
  ui.modeSave.classList.toggle("on", !preview);
  ui.modePreview.classList.toggle("on", preview);
  node.setDirtyCanvas?.(true, true);
}

function restoreLastRun(node) {
  const ui = node._pixSiUI;
  if (!ui) return;
  const last = node.properties?.pixSiLastRun;
  if (!last || typeof last !== "object") return;
  if (last.w && last.h) node._pixSiLastDims = { w: last.w, h: last.h };
  if (typeof last.sum === "string") node._pixSiSummary = last.sum;
  if (typeof last.folder === "string") node._pixSiFolderInfo = last.folder;
  const frames = entriesToFrames(last.entries);
  if (frames.length) {
    node._pixSiFrames = frames;
    node._pixSiSel = 0;
    node._pixSiExpanded = false;
    node._pixSiTotal = Math.max(last.n || 0, frames.length);
  }
  renderPreviewUI(node);
}

// ── wiring ───────────────────────────────────────────────────────────────────
function insertToken(node, ui, tok) {
  const inp = ui.patternInput;
  const s = inp.selectionStart ?? inp.value.length;
  const e = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, s) + tok + inp.value.slice(e);
  inp.focus();
  const pos = s + tok.length;
  try {
    inp.setSelectionRange(pos, pos);
  } catch {}
  const st = readState(node);
  st.pattern = inp.value;
  writeState(node, st);
  updatePreview(node);
}

function wireEvents(node, ui) {
  const stopKeys = (e) => {
    e.stopImmediatePropagation(); // capture-phase canvas shortcuts
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
  };
  ui.folderInput.addEventListener("keydown", stopKeys);
  ui.patternInput.addEventListener("keydown", stopKeys);

  ui.folderInput.addEventListener("input", () => {
    const st = readState(node);
    st.folder = ui.folderInput.value.trim();
    writeState(node, st);
    updatePreview(node);
  });
  ui.folderInput.addEventListener("change", () => {
    const st = readState(node);
    st.folder = normalizePath(ui.folderInput.value);
    writeState(node, st);
    if (document.activeElement !== ui.folderInput) ui.folderInput.value = st.folder;
    updatePreview(node);
  });

  ui.patternInput.addEventListener("input", () => {
    const st = readState(node);
    st.pattern = ui.patternInput.value;
    writeState(node, st);
    updatePreview(node);
  });

  for (const c of CHIPS) {
    const chip = el("button", "pix-si-chip", c.label);
    chip.type = "button";
    chip.title = c.title;
    chip.addEventListener("click", () => {
      // + Date inserts the user's preferred order (right-click settings)
      const style = readState(node).dateStyle || DEFAULT_STATE.dateStyle;
      if (c.dyn === "datefolder") {
        // a folder goes in FRONT of the name, not at the cursor
        const st = readState(node);
        const cur = st.pattern || "";
        const prefix = "%date:" + style + "%/";
        if (!cur.startsWith(prefix)) {
          st.pattern = prefix + cur;
          writeState(node, st);
          ui.patternInput.value = st.pattern;
          updatePreview(node);
        }
        return;
      }
      if (c.dyn === "model") {
        const tok = findModelToken();
        if (!tok) {
          flashStatus(node, "info", "No model loader found in this workflow");
          return;
        }
        insertToken(node, ui, tok);
        return;
      }
      const tok = c.dyn === "date" ? "%date:" + style + "%" : c.tok;
      insertToken(node, ui, tok);
    });
    ui.chipsWrap.appendChild(chip);
  }
  const setPattern = (value) => {
    const st = readState(node);
    st.pattern = value;
    writeState(node, st);
    ui.patternInput.value = value;
    updatePreview(node);
  };
  const clearChip = el("button", "pix-si-chip", "✕ Clear");
  clearChip.type = "button";
  clearChip.title = "Empty the filename field";
  clearChip.addEventListener("click", () => setPattern(""));
  ui.chipsWrap.appendChild(clearChip);
  const reset = el("button", "pix-si-chip", "↺ Reset");
  reset.type = "button";
  reset.title = "Restore the default filename pattern";
  reset.addEventListener("click", () => setPattern(DEFAULT_STATE.pattern));
  ui.chipsWrap.appendChild(reset);

  const setFormat = (fmt) => {
    const st = readState(node);
    st.format = fmt;
    writeState(node, st);
    syncFace(node);
    updatePreview(node);
  };
  ui.fmtPng.addEventListener("click", () => setFormat("png"));
  ui.fmtJpg.addEventListener("click", () => setFormat("jpg"));

  const setMode = (saveOn) => {
    const st = readState(node);
    st.saveOnRun = saveOn;
    writeState(node, st);
    syncFace(node);
  };
  ui.modeSave.addEventListener("click", () => setMode(true));
  ui.modePreview.addEventListener("click", () => setMode(false));

  // viewer: click the image or use the hover arrows to flip; ✕ back to grid
  ui.bigImg.addEventListener("click", () => stepPreview(node, 1));
  ui.navPrev.addEventListener("click", (e) => {
    e.stopPropagation();
    stepPreview(node, -1);
  });
  ui.navNext.addEventListener("click", (e) => {
    e.stopPropagation();
    stepPreview(node, 1);
  });
  ui.closeX.addEventListener("click", (e) => {
    e.stopPropagation();
    node._pixSiExpanded = false;
    renderPreviewUI(node);
  });
  ui.btnCopy.addEventListener("click", () => copyFrame(node));
  ui.btnOpen.addEventListener("click", () => openFrame(node));
  // No browser context menu anywhere on the node body (user request) - the
  // text fields keep it (paste needs it), everything else suppresses it.
  ui.root.addEventListener("contextmenu", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    e.preventDefault();
  });

  ui.browseBtn.addEventListener("click", async () => {
    const start = readState(node).folder || "";
    ui.browseBtn.disabled = true;
    ui.browseLbl.textContent = "Opening…";
    let res;
    try {
      res = await pickNativeFolder(start);
    } catch {
      res = { ok: false };
    }
    ui.browseBtn.disabled = false;
    ui.browseLbl.textContent = "Browse";
    if (res && res.ok && res.path) {
      const st = readState(node);
      st.folder = normalizePath(res.path);
      writeState(node, st);
      syncFace(node);
      updatePreview(node);
    } else if (!(res && res.cancelled)) {
      flashStatus(node, "info", "Folder dialog unavailable - paste the path instead", 3200);
    }
  });

  ui.btnFolder.addEventListener("click", async () => {
    try {
      const r = await fetch("/pixaroma/api/save_image/open_folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: readState(node).folder || "" }),
      });
      const j = await r.json();
      if (!j || !j.ok) {
        flashStatus(node, "info", (j && j.message) || "Could not open the folder", 3200);
        return;
      }
      // Visible feedback: the window can land behind the browser (Windows
      // blocks focus-stealing; the AV-safe plain open is all we ship).
      flashStatus(node, "ok", "Folder opened - check the taskbar if it is not in front", 3000);
    } catch {}
  });
}

// ── per-node setup ───────────────────────────────────────────────────────────
function setupNode(node) {
  injectCSS();
  try {
    hideJsonWidget(node.widgets, HIDDEN_INPUT_NAME);
  } catch {}

  // We emit ui.images when saving inside output/ (Assets panel refresh);
  // suppress ComfyUI's own bottom-of-node preview both ways (Preview #15).
  node.hideOutputImages = true;
  try {
    const desc = Object.getOwnPropertyDescriptor(node, "imgs");
    if (!desc || desc.configurable !== false) {
      Object.defineProperty(node, "imgs", {
        configurable: true,
        get() {
          return [];
        },
        set() {},
      });
    } else {
      console.warn("[PixaromaSaveImage] imgs not configurable; native preview may appear");
    }
  } catch {}

  const ui = buildRoot();
  node._pixSiUI = ui;
  installCanvasZoomPassthrough(ui.root);
  const widget = node.addDOMWidget("pixaroma_save_image", "custom", ui.root, {
    getValue: () => null,
    setValue: () => {},
    // FLOOR only (fill model, Save Mp4 recipe): NO getMaxHeight and NO custom
    // computeSize, so the preview area absorbs all free height in both
    // renderers. Coarse-rounded (Vue Compat #18).
    getMinHeight: () => Math.round(measureFloor(ui) / 4) * 4,
    serialize: false,
  });
  applyAdaptiveCanvasOnly(widget);
  node._pixSiWidget = widget;
  if (isVueNodes()) {
    widget.computeLayoutSize = () => ({
      minHeight: Math.round(measureFloor(ui) / 4) * 4,
      minWidth: 1,
    });
  }

  wireEvents(node, ui);
  try {
    node._pixSiFloorOff = installResizeFloor(ui.root, () => measureFloor(ui));
  } catch {}

  // default size on a FRESH drop only; configure() restores saved sizes
  if (!node.size) node.size = [DEFAULT_W, DEFAULT_H];
  if (!isGraphLoading()) {
    node.size[0] = DEFAULT_W;
    if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
  }

  // initial populate, deferred so configure()'s state lands first (Compat #8)
  queueMicrotask(() => {
    syncFace(node);
    restoreLastRun(node);
    updatePreview(node);
  });
}

// ── executed event: thumbnails + status + light persistence ─────────────────
let _executedInstalled = false;
function installExecutedListener() {
  if (_executedInstalled) return;
  _executedInstalled = true;
  api.addEventListener("executed", ({ detail }) => {
    if (!detail) return;
    let node = app.graph?.getNodeById?.(detail.node);
    if (!node && typeof detail.node === "string") {
      node = app.graph?.getNodeById?.(parseInt(detail.node, 10));
    }
    if (!node || node.comfyClass !== COMFY_CLASS || !node._pixSiUI) return;
    const out = detail.output || {};
    const frames = out.pixaroma_save_frames || out.images;
    if (!Array.isArray(frames) || !frames.length) return;
    const status = frames[0]._pixaroma_status || null;

    node._pixSiFrames = entriesToFrames(frames);
    node._pixSiSel = 0;
    node._pixSiExpanded = false; // batches land on the grid first
    node._pixSiTotal = Math.max(status ? status.saved : 0, node._pixSiFrames.length);

    if (status) {
      if (status.w && status.h) node._pixSiLastDims = { w: status.w, h: status.h };
      const ok = status.saved > 0;
      let sum;
      if (ok) {
        sum = "saved " + status.saved + (status.saved === 1 ? " image" : " images");
        if (status.note) sum += " (" + status.note + ")";
      } else {
        sum = "preview only - not saved";
      }
      node._pixSiSummary = sum;
      node._pixSiFolderInfo = status.folder || "";
      // Persist a LIGHT restore snapshot so the preview + summary survive a
      // workflow-tab switch (Preview Pattern #4 family; writing properties
      // after a run is the accepted "Save Changes?" trade-off). Tokens stay
      // valid for the server session, so external saves restore too.
      try {
        const keep = frames
          .filter((f) => f && ((f.type && f.filename) || f.token))
          .slice(0, THUMB_SHOW_MAX)
          .map((f) => ({
            filename: f.filename || "",
            subfolder: f.subfolder || "",
            type: f.type || "",
            token: f.token || "",
            path: f.path || "",
          }));
        if (!node.properties) node.properties = {};
        node.properties.pixSiLastRun = {
          ok,
          sum,
          folder: node._pixSiFolderInfo,
          entries: keep,
          n: node._pixSiTotal,
          w: status.w,
          h: status.h,
        };
      } catch {}
    }
    renderPreviewUI(node);
    node._pixSiCntKey = null; // files landed on disk - refetch the counter
    updatePreview(node);
    growToFloor(node);
  });
}

// ── Pattern #9: inject state into the hidden input at submit time ────────────
function collectNodes(graph, out) {
  if (!graph) return;
  const nodes = graph._nodes || graph.nodes || [];
  for (const n of nodes) {
    if (n?.comfyClass === COMFY_CLASS) out.push(n);
    const inner = n?.subgraph || n?.graph || n?._graph;
    if (inner && inner !== graph) collectNodes(inner, out);
  }
}
function matchNode(nodes, promptId) {
  let n = nodes.find((x) => String(x.id) === String(promptId));
  if (n) return n;
  const tail = String(promptId).split(":").pop();
  return nodes.find((x) => String(x.id) === tail) || null;
}
function injectState(result) {
  const out = result?.output;
  if (!out) return;
  const siNodes = [];
  collectNodes(app.graph, siNodes);
  if (!siNodes.length) return;
  for (const id in out) {
    const entry = out[id];
    if (!entry || entry.class_type !== COMFY_CLASS) continue;
    const node = matchNode(siNodes, id);
    if (!node) continue;
    if (!entry.inputs) entry.inputs = {};
    const st = readState(node);
    // resolve %NodeName.widget% refs NOW (frontend-only tokens; the Seed
    // mirror widget already holds this run's value at this point)
    st.pattern = applyFilenameTokenRefs(String(st.pattern || DEFAULT_STATE.pattern));
    entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify(st);
  }
}
function installGraphToPromptHook() {
  if (app._pixSiGraphPatched) return;
  app._pixSiGraphPatched = true;
  const orig = app.graphToPrompt.bind(app);
  app.graphToPrompt = async function (...args) {
    const result = await orig(...args);
    try {
      injectState(result);
    } catch (e) {
      console.warn("[SaveImage] graphToPrompt inject failed", e);
    }
    return result;
  };
}

app.registerExtension({
  name: "Pixaroma.SaveImage",
  setup() {
    installGraphToPromptHook();
    installExecutedListener();
  },

  getNodeMenuItems(node) {
    if (!node || node.comfyClass !== COMFY_CLASS) return [];
    return [
      null,
      {
        content: "⚙ Save Image settings",
        callback: () =>
          openSettingsPanel(node, () => {
            syncFace(node);
            updatePreview(node);
          }),
      },
    ];
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== COMFY_CLASS) return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setupNode(this);
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = origConfigure?.apply(this, arguments);
      queueMicrotask(() => {
        syncFace(this);
        restoreLastRun(this);
        updatePreview(this);
      });
      return r;
    };

    // Rewiring the `name` input changes what %input% resolves to — refresh
    // the preview line (runtime-only, no serialized writes; Compat #19 safe).
    const origConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = origConn?.apply(this, arguments);
      if (this._pixSiUI) queueMicrotask(() => updatePreview(this));
      return r;
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = origDraw?.apply(this, arguments);
      // legacy-only min-width self-heal (Nodes 2.0 size lives in the Vue layout)
      if (!isVueNodes() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return r;
    };
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      // fill model: free vertical resize (the preview grows); width floor only
      if (!isVueNodes() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return origResize?.apply(this, arguments);
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        this._pixSiFloorOff?.();
      } catch {}
      closeSettingsPanelFor(this);
      clearTimeout(this._pixSiCntTimer);
      clearTimeout(this._pixSiFlashT);
      this._pixSiUI = null;
      return origRemoved?.apply(this, arguments);
    };
  },
});
