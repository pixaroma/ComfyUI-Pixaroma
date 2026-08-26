// Save Image Pixaroma — extension entry point.
// Save images to ANY folder on disk (or output/), with a live "Will save as"
// filename preview, PNG/JPG, workflow embedding, and batch support. State on
// node.properties.saveImageState, injected into the hidden SaveImageState
// input at graphToPrompt time (Pattern #9). Design approved via mockup
// 2026-07-03 (docs/superpowers/specs/2026-07-03-save-image-node-design.md).

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import {
  applyAdaptiveCanvasOnly,
  isVueNodes,
  installResizeFloor,
  hideJsonWidget,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeSettings, installNodeAccent } from "../shared/node_settings.mjs";
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
  sanitizePrefixMirror,
  FORMATS,
  formatDef,
  visibleFormats,
} from "./state.mjs";
import { injectCSS, buildRoot, el } from "./ui.mjs";
import { openSettingsPanel, closeSettingsPanelFor } from "./settings.mjs";

// User-measured with the sizer snippet: 474 wide keeps the full button row
// (2 pills + 3 equal action buttons, third labeled "Folder") on ONE line;
// 806 tall gives the preview real space.
const MIN_W = 474;
const DEFAULT_W = 474;
const DEFAULT_H = 806;
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
  // The one-click version of "put each picture in a folder named after what is
  // wired in". This is PATTERN text, so the slash makes a folder on its own and
  // it does not need the "Keep folders from the wired name" setting - that
  // setting is a different job (keeping folders the wired text ALREADY has).
  { label: "+ Input folder", dyn: "inputfolder", title: "Put a folder named after the wired name input in front, e.g. bunny/image" },
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
// The floor's ONLY contract is "the fixed content must not spill", and the real
// content at the design width is ~490 - so any value above DEFAULT_H is by
// definition a mis-measurement, not a tall node. Clamping here makes an inflated
// floor unreachable for EVERY consumer (getMinHeight, computeLayoutSize,
// growToFloor, the resize-floor pin) without having to know which fitter misfired.
// Safe by construction: the clamp can only LOWER the floor, and the floor reaches
// node.size only through grow-only Math.max(), so it can never grow a node or
// rewrite a clean saved size.
//
// Two states LIE and must not be measured at all:
//  - root not laid out / unmounted -> every offsetHeight reads 0. addDOMWidget
//    defaults hideOnZoom:true, so the element is unmounted on any zoom-out.
//  - root with no real width -> the button row wraps and the sum explodes. This
//    is the only mechanism found that can reach ~1800.
// In those states reuse the last good reading instead of inventing one.
const FLOOR_CAP = DEFAULT_H;
function measureFloor(ui) {
  const inner = ui && ui.inner;
  if (!inner) return 320;
  const root = ui.root;
  if (!root || !root.isConnected || root.clientWidth < MIN_W - 40) {
    return ui._pixSiFloorCache || 320;
  }
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
  if (n === 0) return ui._pixSiFloorCache || 320; // pre-attach placeholder
  h += 16; // inner vertical padding (8 + 8)
  h += (n - 1) * 10; // flex gaps
  const out = Math.min(Math.max(200, h), FLOOR_CAP);
  ui._pixSiFloorCache = out;
  return out;
}

// Re-assert the size the workflow actually SAVED, because ComfyUI's grow-only
// fit passes inflate the node right after load (measured live: saved 474x806 came
// back 474x1830). Idempotent: a correct load matches the saved size and writes
// nothing, so no dirty-on-load.
//
// NOTE, corrected 2026-07-16: the old note here blamed a zoom mis-scale ("the
// parked element's on-screen height gets mis-scaled into graph units"). That is
// NOT what this frontend does - the DOM-widget host is sized in GRAPH units with a
// CSS transform, so offsetHeight is never zoom-scaled. measureFloor is now clamped
// at FLOOR_CAP, which makes the inflated value unreachable at the source.
//
// This used to be time-boxed (now + next frame + 400ms, then give up), which is
// why the node sometimes STAYED big: in a hidden browser tab or an inactive
// workflow tab, requestAnimationFrame does not fire and the canvas never DRAWS -
// and a DOM widget is only mounted and laid out by a draw. So ComfyUI's fit (and
// its inflation) does not happen until the user comes back, long after the 400ms
// window shut. The correction is now driven by the layout itself: a
// ResizeObserver on the widget root fires exactly when the fit really happens,
// whenever that is, and visibilitychange covers the tab being shown again.
//
// It retires when the root is genuinely laid out AND the size already matches -
// i.e. things have settled - so it cannot linger and fight growToFloor after a
// run. It also retires the moment the user grabs a resize handle: the size is
// theirs from then on.
function reassertSavedSize(node, saved) {
  let done = false;
  let ro = null;

  // A real box means the widget is mounted and ComfyUI has actually fitted it.
  // Until then a size match proves nothing, so we must keep watching.
  const mounted = () => {
    const r = node._pixSiUI && node._pixSiUI.root;
    return !!r && r.isConnected && r.clientWidth > 0;
  };

  function retire() {
    if (done) return;
    done = true;
    window.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("visibilitychange", onVis);
    try { if (ro) ro.disconnect(); } catch {}
    ro = null;
    if (node._pixSiReassertOff === retire) node._pixSiReassertOff = null;
  }

  // Correct if wrong; retire only once laid out AND already correct.
  const apply = (mayRetire) => {
    if (done || !node._pixSiUI || node._pixSiSkipReassert) return;
    const off =
      Math.abs(node.size[0] - saved[0]) > 1 || Math.abs(node.size[1] - saved[1]) > 1;
    if (off) {
      if (node.setSize) node.setSize([saved[0], saved[1]]);
      else {
        node.size[0] = saved[0];
        node.size[1] = saved[1];
      }
      node.setDirtyCanvas?.(true, true);
      return; // our own write re-lays-out the root; the next pass confirms
    }
    if (mayRetire && mounted()) retire();
  };

  // A RESIZE-HANDLE grab means the user owns the size now. A plain click must NOT
  // cancel, so the signal is the grabbed element's cursor (same test
  // js/shared/resize_floor.mjs uses).
  const onDown = (e) => {
    try {
      const el = e.target;
      const cur = el && el.nodeType === 1 ? getComputedStyle(el).cursor || "" : "";
      if (cur.indexOf("-resize") !== -1) retire();
    } catch {}
  };
  const onVis = () => {
    if (document.visibilityState === "visible") requestAnimationFrame(() => apply(true));
  };

  try { node._pixSiReassertOff?.(); } catch {} // a previous configure must not linger
  node._pixSiReassertOff = retire;

  window.addEventListener("pointerdown", onDown, true);
  document.addEventListener("visibilitychange", onVis);
  try {
    const root = node._pixSiUI && node._pixSiUI.root;
    if (root && typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => apply(true));
      ro.observe(root);
    }
  } catch {}

  apply(false); // never retire on these two: the fit has not happened yet
  requestAnimationFrame(() => apply(false));
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

// ── fold / unfold (collapse the settings, keep the toolbar + preview) ────────
// Height (graph units == layout px) occupied by the settings sections between
// the top strip and the preview, AS CURRENTLY DISPLAYED. offsetTop is layout-
// relative so it is immune to graph zoom, and these sections are content-height
// (not flex-grow), so the reading is stable regardless of the preview size.
function settingsBlockH(ui) {
  const barBottom = ui.topbar.offsetTop + ui.topbar.offsetHeight;
  return Math.max(0, ui.savedSec.offsetTop - barBottom);
}

function setFoldDisplay(ui, folded, hideBar) {
  ui.secFolder.style.display = folded ? "none" : "";
  ui.secName.style.display = folded ? "none" : "";
  ui.secBtns.style.display = folded && hideBar ? "none" : "";
}

function updateFoldIcon(ui, folded) {
  ui.foldBtn.classList.toggle("folded", folded);
  ui.foldBtn.title = folded
    ? "Unfold - show the folder and filename settings"
    : "Fold - hide the settings, keep the toolbar and preview";
}

// Apply the fold state to the DOM. When allowResize (a user action, NEVER the
// load path) AND the visible set actually changes, shrink/grow the node by
// exactly the space the sections occupy so the preview keeps its size. On the
// load path we only set the look and trust the saved size (Vue Compat #18).
function applyFold(node, allowResize) {
  const ui = node._pixSiUI;
  if (!ui) return;
  const st = readState(node);
  const folded = !!st.folded;
  const hideBar = !!st.hideBarWhenFolded;
  const isHidden = (elx) => elx.style.display === "none";
  const wantFolderHidden = folded;
  const wantBtnsHidden = folded && hideBar;
  const changing =
    isHidden(ui.secFolder) !== wantFolderHidden || isHidden(ui.secBtns) !== wantBtnsHidden;

  if (allowResize && changing && !isGraphLoading()) {
    const before = settingsBlockH(ui);
    setFoldDisplay(ui, folded, hideBar);
    const after = settingsBlockH(ui); // forces a sync reflow before paint
    const delta = before - after; // >0 shrink (hid), <0 grow (showed)
    if (Math.abs(delta) > 0.5) {
      const floor = Math.round(measureFloor(ui) / 4) * 4;
      const target = Math.max(floor, node.size[1] - delta);
      if (node.setSize) node.setSize([node.size[0], target]);
      else node.size[1] = target;
      node.setDirtyCanvas?.(true, true);
    }
  } else {
    setFoldDisplay(ui, folded, hideBar);
  }
  updateFoldIcon(ui, folded);
}

function toggleFold(node) {
  const st = readState(node);
  st.folded = !st.folded;
  writeState(node, st);
  applyFold(node, true);
}

// ── backend helpers ───────────────────────────────────────────────────────────
// Browse reuses the Load Images from Folder native-dialog route (generic:
// it just pops the OS picker and returns a path).
async function pickNativeFolder(startPath) {
  try {
    const url = pixApiUrl(`/pixaroma/api/load_images_folder/pick_native?path=${encodeURIComponent(startPath || "")}`);
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

// ⚠️ The `t=` cache-buster is NOT optional, and the comment that used to say
// "no cache-buster needed since names are never reused" was wrong (user report,
// 2026-08-10). Filenames ARE reused: %counter% picks max-found + 1, so DELETING
// the newest file frees its number and the next run writes that exact name
// again. The /view URL is then byte-identical to one the browser already has,
// so it serves the OLD picture from cache while the correct new file sits on
// disk. REPRODUCED end to end: saved a red 001, deleted it, generated a blue
// one that really did write 001 (blue on disk, verified) - and the node showed
// RED. Save Mp4 and Save Video already busted their URLs; this node did not.
//
// The stamp is per RUN, not per render (`f.bust`, set once in the executed
// handler), so switching workflow tabs or flipping grid/expanded re-uses the
// same URL and stays cache-fast; only a NEW run fetches again. An entry with no
// stamp (an older saved workflow) keeps the plain URL: its file has not changed
// since it was written, so its cache entry is correct.
function buildViewUrl(f) {
  return pixApiUrl(
    "/view?filename=" + encodeURIComponent(f.filename) +
    "&type=" + encodeURIComponent(f.type || "output") +
    "&subfolder=" + encodeURIComponent(f.subfolder || "") +
    (f.bust ? "&t=" + encodeURIComponent(f.bust) : "")
  );
}

// Raw ui entry -> preview source. Files inside output/temp go through /view;
// external files go through the token route; anything else has no preview.
function entrySrc(f) {
  if (f && f.type && f.filename) return buildViewUrl(f);
  if (f && f.token) return pixApiUrl("/pixaroma/api/save_image/file?t=" + encodeURIComponent(f.token));
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
      name: f.filename || (f.path ? String(f.path).split(/[\\/]/).pop() : "image.png"),
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
      cell.dataset.i = String(i);
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

// Download the shown frame (same-origin src, so the download attribute works).
function downloadFrame(node) {
  const f = (node._pixSiFrames || [])[node._pixSiSel || 0];
  if (!f) return;
  const a = document.createElement("a");
  a.href = f.src;
  a.download = f.name || "image.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── right-click menu on the preview image (native Save Image parity) ─────────
let _imgMenu = null;
let _imgMenuNode = null; // owner, so removing another node can't close it
function _imgMenuOutside(e) {
  if (_imgMenu && !_imgMenu.contains(e.target)) closeImageMenu();
}
function _imgMenuEsc(e) {
  if (e.key === "Escape") closeImageMenu();
}
function closeImageMenu() {
  if (!_imgMenu) return;
  try {
    _imgMenu.remove();
  } catch {}
  _imgMenu = null;
  _imgMenuNode = null;
  document.removeEventListener("pointerdown", _imgMenuOutside, true);
  document.removeEventListener("keydown", _imgMenuEsc, true);
}
function openImageMenu(node, x, y) {
  closeImageMenu();
  const menu = el("div", "pix-si-menu");
  _imgMenu = menu;
  _imgMenuNode = node;
  const add = (label, fn) => {
    const it = el("div", "pix-si-mitem", label);
    it.addEventListener("click", () => {
      closeImageMenu();
      fn();
    });
    menu.appendChild(it);
  };
  add("Open image", () => openFrame(node));
  add("Copy image", () => copyFrame(node));
  add("Save image", () => downloadFrame(node));
  document.body.appendChild(menu);
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + "px";
  const _m = menu;
  setTimeout(() => {
    if (_imgMenu !== _m) return;
    document.addEventListener("pointerdown", _imgMenuOutside, true);
    document.addEventListener("keydown", _imgMenuEsc, true);
  }, 0);
}

// ── live "Will save as" preview ───────────────────────────────────────────────
function resolveWiredName(node) {
  try {
    // mirror the run-time cleanup, including whether folders survive
    const keepFolders = !!readState(node).inputSubfolders;
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
      return cleanInputName(v, keepFolders) || "name";
    }
    // a plain text-ish widget on the origin (Text Pixaroma etc.) — best effort
    const tw = origin.widgets?.find(
      (x) => x && typeof x.value === "string" && x.value &&
        (x.name === "text" || x.name === "value" || x.name === "string")
    );
    if (tw) return cleanInputName(String(tw.value).slice(0, 60), keepFolders) || "name";
    return "name"; // wired, value only known at run time
  } catch {
    return "name";
  }
}

function cntKey(folderRaw, nameWithExt, digits) {
  return folderRaw + "\x00" + nameWithExt + "\x00" + digits;
}
function scheduleCounterFetch(node, folderRaw, nameWithExt, digits) {
  if (!nameWithExt.includes("%counter%")) return;
  const key = cntKey(folderRaw, nameWithExt, digits);
  if (node._pixSiCntKey === key) return; // already fetched / in flight
  node._pixSiCntKey = key;
  clearTimeout(node._pixSiCntTimer);
  node._pixSiCntTimer = setTimeout(async () => {
    try {
      const r = await fetch(
        pixApiUrl(
          "/pixaroma/api/save_image/next_counter?folder=" + encodeURIComponent(folderRaw) +
          "&name=" + encodeURIComponent(nameWithExt) +
          "&digits=" + encodeURIComponent(digits)
        )
      );
      const j = await r.json();
      if (node._pixSiCntKey !== key || !node._pixSiUI) return; // superseded
      node._pixSiCounterNum = (j && j.counter) || 1;
      // the server also resolves %counter% in FOLDER segments (sibling-dir
      // scan, exactly like the save) - the exact path a Run would create
      node._pixSiCntResolved = (j && j.resolved) || "";
      // The folder is not on the approved list, so a Run would refuse it. Say
      // so HERE rather than letting the preview show a path that will never be
      // written - the whole point of this line is to be believable.
      node._pixSiCntDenied = !!(j && j.denied);
      node._pixSiCntResolvedFor = key;
      updatePreview(node);
    } catch {}
  }, 350);
}

function updatePreview(node) {
  const ui = node._pixSiUI;
  if (!ui) return;
  const st = readState(node);
  let s = String(st.pattern || DEFAULT_STATE.pattern);
  // function replacement so a wired name containing "$" patterns ($&, $$)
  // is inserted literally (JS string replacements interpret those)
  const wired = resolveWiredName(node);
  s = s.replace(/%input%/g, () => wired);
  s = resolveDateTokens(s);
  s = expandNativeTokens(s); // %year% %month% %day% %hour% %minute% %second%
  s = applyFilenameTokenRefs(s); // %Seed Pixaroma.seed% and friends
  const dims = node._pixSiLastDims;
  if (dims) {
    s = s.replace(/%width%/g, String(dims.w)).replace(/%height%/g, String(dims.h));
  }
  s = s.replace(/%batch_num%/g, "0");
  // Display mirror of the Python sanitizer, shared with Save Video Pixaroma -
  // the rules, and the two review rounds behind them, live in
  // js/shared/filename_mirror.mjs. It returns "" wherever _safe_prefix returns
  // None, and the fallback below is this node's own.
  s = sanitizePrefixMirror(s);
  if (!s) s = "image_%counter%"; // _safe_prefix returned None -> node's fallback
  const ext = formatDef(st.format).ext;
  const digits = Math.max(1, Math.min(8, parseInt(st.counterDigits, 10) || 3));
  let rel;
  if (
    node._pixSiCntResolved &&
    node._pixSiCntResolvedFor === cntKey(st.folder || "", s + ext, digits)
  ) {
    rel = node._pixSiCntResolved; // server-resolved (folder %counter% too)
  } else {
    const padded = String(node._pixSiCounterNum || 1).padStart(digits, "0");
    rel = s.replace(/%counter%/g, padded) + ext;
  }
  const folder = st.folder ? normalizePath(st.folder) : "";
  const display =
    (folder ? folder.replace(/\//g, "\\") : "…\\ComfyUI\\output") +
    "\\" +
    rel.split("/").filter(Boolean).join("\\");
  // Denial is keyed to the same cntKey as the resolved path, so a stale answer
  // for a folder the user has since edited can never colour the new one.
  if (
    node._pixSiCntDenied &&
    node._pixSiCntResolvedFor === cntKey(st.folder || "", s + ext, digits)
  ) {
    ui.prevPath.textContent = "This folder is not approved - click Browse and pick it once";
    ui.prevPath.style.color = "#f66744";
    ui.prevPath.title =
      "Pixaroma only writes to ComfyUI's own folders and to folders you picked " +
      "with Browse. Picking this folder in the system dialog approves it for good.";
  } else {
    ui.prevPath.textContent = display;
    ui.prevPath.style.color = "";
    ui.prevPath.title = "";
  }
  scheduleCounterFetch(node, st.folder || "", s + ext, digits);
}

// Show or hide the optional face buttons (settings panel, "Buttons on the
// node"). Reasons people asked: Open Folder does nothing useful on some
// systems, and someone who only ever saves PNG + WebP does not want a JPG
// button in the way.
//
// DOM ONLY - it must never write state or resize, because it runs from
// syncFace, which runs on the LOAD path (Vue Compat #18). The one thing it can
// change is `st.format`, and only when the user has hidden the format that was
// active; that write is guarded by isGraphLoading() so a load can never do it.
function applyButtonVisibility(node, st) {
  const ui = node._pixSiUI;
  if (!ui) return;
  const show = (elm, on) => {
    if (elm) elm.style.display = on ? "" : "none";
  };
  show(ui.btnOpen, st.showOpen !== false);
  show(ui.btnCopy, st.showCopy !== false);
  show(ui.btnFolder, st.showFolder !== false);
  const vis = visibleFormats(st);
  // FIRST correct the state, THEN paint from it. The active format was just
  // hidden, so fall back to the first visible one - otherwise the node keeps
  // writing a format with no button to change it. Doing this before the paint
  // matters: computing `activeId` first left the just-hidden format's button on
  // screen, unlit, until some later action happened to re-run syncFace (found
  // in review; close the panel right after the click and it stayed indefinitely).
  if (!vis.some((v) => v.id === formatDef(st.format).id) && !isGraphLoading()) {
    const next = vis[0].id;
    const cur = readState(node);
    cur.format = next;
    writeState(node, cur);
    st.format = next;
    // the extension in "Will save as" just changed, so refresh it. Only from
    // this branch: it cannot run during a load (guarded above), and it is the
    // one place inside this DOM-only function where the format really moved.
    queueMicrotask(() => updatePreview(node));
  }
  // The ACTIVE format's button is always shown, even if it was hidden. That
  // state is unreachable through the UI now that the correction above runs
  // first, but a LOAD can still deliver it (the correction is rightly skipped
  // during a load, since writing state there would flag a clean workflow
  // modified - Vue Compat #18), and a face with no lit pill gives no way to
  // tell what you are saving as. Showing the button needs no write.
  const activeId = formatDef(st.format).id;
  for (const f of FORMATS) show(ui.fmtBtns[f.id], f.id === activeId || vis.some((v) => v.id === f.id));
  // A single remaining format is not a choice, so the pill would just be a
  // label the user can click to no effect - hide the whole group instead. The
  // format still applies; it is shown in the "Will save as" extension. Counts
  // the ACTUAL buttons on screen, so a forced-visible active format keeps the
  // group up rather than leaving one lonely pill in a hidden container.
  const onScreen = FORMATS.filter((f) => f.id === activeId || vis.some((v) => v.id === f.id));
  show(ui.segFmt, onScreen.length > 1);
}

// ── face sync (DOM only; safe on the load path) ──────────────────────────────
function syncFace(node) {
  const ui = node._pixSiUI;
  if (!ui) return;
  const st = readState(node);
  if (document.activeElement !== ui.folderInput) ui.folderInput.value = st.folder || "";
  if (document.activeElement !== ui.patternInput) ui.patternInput.value = st.pattern || "";
  applyButtonVisibility(node, st);
  const active = formatDef(st.format).id;
  for (const f of FORMATS) ui.fmtBtns[f.id].classList.toggle("on", f.id === active);
  ui.fmtBtns.jpg.title =
    "Smaller JPG files, quality " + (st.quality ?? 100) +
    " (gear to change). No transparency, and ComfyUI cannot reload a workflow from a JPG.";
  ui.fmtBtns.webp.title = st.webpLossless
    ? "WebP, lossless. Keeps transparency, still much smaller than PNG, and it drags back into ComfyUI to reload the workflow."
    : "WebP, quality " + (st.quality ?? 100) +
      " (gear to change). Keeps transparency, far smaller than PNG, and it drags back into ComfyUI to reload the workflow.";
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
      if (c.dyn === "datefolder" || c.dyn === "inputfolder") {
        // a folder goes in FRONT of the name, not at the cursor
        const st = readState(node);
        const cur = st.pattern || "";
        const prefix = c.dyn === "inputfolder" ? "%input%/" : "%date:" + style + "%/";
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
  for (const f of FORMATS) ui.fmtBtns[f.id].addEventListener("click", () => setFormat(f.id));

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
  // a stale src (external-save token after a ComfyUI restart) must hide, not
  // show the browser's broken-image icon (grid cells already self-hide)
  ui.bigImg.addEventListener("error", () => {
    ui.bigImg.style.display = "none";
  });
  ui.bigImg.addEventListener("load", () => {
    const frames = node._pixSiFrames || [];
    const n = frames.length;
    const gridmode = n > 1 && !node._pixSiExpanded;
    ui.bigImg.style.display = n && !gridmode ? "block" : "none";
  });
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
  // fold / unfold toggle (stop the pointerdown so it can't start a node drag)
  ui.foldBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  ui.foldBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFold(node);
  });
  // gear beside it: the SAME panel the right-click entry and the selection
  // toolbar open, so there is one place the settings live and three ways in
  ui.gearBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  ui.gearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openSaveImagePanel(node);
  });
  // Right-click routing (user request): text fields keep the browser menu
  // (paste), the preview image gets OUR Open/Copy/Save menu (native Save
  // Image parity), and everywhere else opens ComfyUI's own NODE menu.
  ui.root.addEventListener("contextmenu", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    e.preventDefault();
    e.stopPropagation();
    const frames = node._pixSiFrames || [];
    if (frames.length && ui.view.contains(t)) {
      const cell = t.closest ? t.closest(".pix-si-cell") : null;
      if (cell && cell.dataset.i != null) {
        const i = parseInt(cell.dataset.i, 10);
        if (isFinite(i)) node._pixSiSel = i;
      }
      openImageMenu(node, e.clientX, e.clientY);
      return;
    }
    // hand the click to ComfyUI's node context menu
    try {
      const c = app.canvas;
      if (c && c.processContextMenu) {
        if (c.convertEventToCanvasOffset) {
          const off = c.convertEventToCanvasOffset(e);
          if (off) {
            e.canvasX = off[0];
            e.canvasY = off[1];
          }
        }
        c.processContextMenu(node, e);
      }
    } catch {}
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
      const r = await fetch(pixApiUrl("/pixaroma/api/save_image/open_folder"), {
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
  installNodeAccent(node, ui.root);   // the face follows this node's accent colour
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
  // UNCONDITIONAL, never behind isVueNodes() - see the long note at the matching
  // spot in js/save_video/index.js. The renderer can change under a live node, so
  // a node built in Classic would keep the prototype's minWidth 0 instead of our
  // 1. Measured inert on frontend 1.49.6; kept for consistency with Save Text,
  // Save Mp4 and Save Video rather than because a break was observed.
  widget.computeLayoutSize = () => ({
    minHeight: Math.round(measureFloor(ui) / 4) * 4,
    minWidth: 1,
  });

  wireEvents(node, ui);
  try {
    node._pixSiFloorOff = installResizeFloor(ui.root, () => measureFloor(ui));
  } catch {}

  // default size on a FRESH drop only; configure() restores saved sizes.
  // The sync write is NOT enough: ComfyUI's node-creation pipeline re-sizes
  // the node AFTER onNodeCreated returns (measured live: a fresh drop ended
  // up 500x1830 while computeSize said 518). So fresh nodes are SNAPPED to
  // the default again on the microtask + next frame; loaded nodes untouched.
  const fresh = !isGraphLoading();
  if (!node.size) node.size = [DEFAULT_W, DEFAULT_H];
  if (fresh) {
    node.size[0] = DEFAULT_W;
    if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
  }
  const snapFresh = () => {
    if (!node._pixSiUI) return;
    if (Math.abs(node.size[0] - DEFAULT_W) > 1 || Math.abs(node.size[1] - DEFAULT_H) > 1) {
      if (node.setSize) node.setSize([DEFAULT_W, DEFAULT_H]);
      else {
        node.size[0] = DEFAULT_W;
        node.size[1] = DEFAULT_H;
      }
      node.setDirtyCanvas?.(true, true);
    }
  };

  // initial populate, deferred so configure()'s state lands first (Compat #8)
  queueMicrotask(() => {
    syncFace(node);
    restoreLastRun(node);
    updatePreview(node);
    applyFold(node, false); // restore the folded look; never resizes on load
    if (fresh) {
      snapFresh();
      requestAnimationFrame(snapFresh);
    }
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

    // One stamp for THIS run, stamped onto every entry before anything builds a
    // URL from them, so a filename reused after a delete cannot serve the old
    // picture out of the browser cache (see buildViewUrl). Per run rather than
    // per render, so re-renders stay cache-fast.
    const bust = String(Date.now());
    for (const f of frames) {
      if (f && typeof f === "object") f.bust = bust;
    }

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
            // carried so a tab-switch restore rebuilds the SAME url this run
            // used - stable (no needless refetch) and still unique per run
            bust: f.bust || "",
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
        callback: () => openSaveImagePanel(node),
      },
      {
        // one-click escape from a stale oversized saved size (e.g. a size
        // stored in the workflow before the layout settled)
        content: "↺ Reset node size",
        callback: () => {
          node._pixSiSkipReassert = true; // an explicit user size choice
          // back to normal: unfold too, then snap to the default size
          const st = readState(node);
          if (st.folded) {
            st.folded = false;
            writeState(node, st);
          }
          applyFold(node, false); // show everything; size is set right after
          if (node.setSize) node.setSize([DEFAULT_W, DEFAULT_H]);
          else {
            node.size[0] = DEFAULT_W;
            node.size[1] = DEFAULT_H;
          }
          node.setDirtyCanvas?.(true, true);
        },
      },
    ];
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== COMFY_CLASS) return;
    if (nodeType.prototype._pixSiPatched) return; // hot-reload re-wrap guard
    nodeType.prototype._pixSiPatched = true;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setupNode(this);
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure?.apply(this, arguments);
      // A fresh configure brings a fresh authoritative saved size, so any earlier
      // "the user picked this size" intent is stale. Without this, one Reset node
      // size click disabled the only thing that undoes the inflation, for good.
      this._pixSiSkipReassert = false;
      // capture the size the workflow SAVED (array or {0,1} object form)
      let saved = null;
      const s = info && info.size;
      if (s != null) {
        const sw = Number(s[0] ?? s["0"]);
        const sh = Number(s[1] ?? s["1"]);
        if (isFinite(sw) && isFinite(sh) && sw > 50 && sh > 50) saved = [sw, sh];
      }
      // HEAL a workflow that was SAVED while inflated. ComfyUI's load fit is
      // grow-only, so once a silly height reaches the file it is permanent and
      // self-reinforcing - faithfully re-asserting it would keep the node broken
      // forever. This only has to catch files saved while measureFloor could
      // still explode (the root cause is fixed above), which landed around 1830.
      // Keep the bar HIGH: the preview area is the user's to size (growToFloor
      // never shrinks it), and a portrait image on a slightly widened node
      // reaches ~1330 legitimately - healing that would silently undo a
      // deliberate resize on every single load.
      const INFLATED_H = FLOOR_CAP * 2; // 1612; the observed break was 1830
      if (saved && saved[1] > INFLATED_H) {
        console.warn(
          "[PixaromaSaveImage] saved height " + Math.round(saved[1]) +
            " looks inflated (a known ComfyUI fit bug); restoring the default " + DEFAULT_H + "."
        );
        saved = [saved[0], DEFAULT_H];
      }
      queueMicrotask(() => {
        syncFace(this);
        restoreLastRun(this);
        updatePreview(this);
        applyFold(this, false); // restore the folded look; never resizes on load
        if (saved) reassertSavedSize(this, saved);
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
      // legacy-only min-width self-heal (Nodes 2.0 size lives in the Vue layout).
      // The isGraphLoading() gate is NOT optional: node.size is serialized, and
      // a draw hook runs on the very first frame of a LOAD - earlier than any
      // other clamp. MEASURED: a node saved 320 wide in Nodes 2.0 (which has no
      // live width clamp, so that width is legitimate) came back rewritten to
      // 474 the moment it was opened in Classic, throwing away a deliberate
      // size and putting the workflow one tick away from a false "modified".
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return r;
    };
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      // fill model: free vertical resize (the preview grows); width floor only.
      // Gated like the draw clamp above: onResize is NOT only a user drag - the
      // frontend calls setSize from fit-to-content, node creation and workflow
      // restore too.
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return origResize?.apply(this, arguments);
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        this._pixSiFloorOff?.();
      } catch {}
      // A watcher that has not retired yet (its root never laid out - e.g. the
      // node lived in a tab that was never shown) still holds the window /
      // document listeners and the ResizeObserver, and the RO pins the whole
      // built DOM subtree. Nulling _pixSiUI below only makes apply() a no-op.
      try {
        this._pixSiReassertOff?.();
      } catch {}
      closeSettingsPanelFor(this);
      if (_imgMenuNode === this) closeImageMenu();
      clearTimeout(this._pixSiCntTimer);
      clearTimeout(this._pixSiFlashT);
      this._pixSiUI = null;
      return origRemoved?.apply(this, arguments);
    };
  },
});

// One opener shared by the right-click entry and the selection-toolbar gear.
function openSaveImagePanel(node) {
  openSettingsPanel(node, () => {
    syncFace(node);
    updatePreview(node);
    applyFold(node, true); // resizes only if "hide toolbar" flips while folded
  });
}

registerNodeSettings(COMFY_CLASS, {
  title: "Save Image",
  ownMenuItem: true,   // the node already adds its own "⚙ Save Image settings" line
  open: (node) => openSaveImagePanel(node),
});
