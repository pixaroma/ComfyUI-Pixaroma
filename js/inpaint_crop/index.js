// ============================================================
// Inpaint Crop Pixaroma — node entry (open button, preview, source, persist)
// ============================================================
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { growToCoreMinHeight, capComputeSizeInNodes2 } from "../shared/core_min_size.mjs";
import { InpaintCropEditor, INPAINT_PREVIEW_COLORS } from "./core.mjs";
import { registerNodeAccent } from "../shared/node_settings.mjs";
import "./paint.mjs";   // mixin: brush / mask / keys
import "./render.mjs";  // mixin: canvas render + save
import {
  createNodePreview, showNodePreview, restoreNodePreview, clearNodePreview, activateNodePreview,
  downloadDataURL, applyAdaptiveCanvasOnly,
  installCanvasZoomPassthrough, onRouterChanged,
} from "../shared/index.mjs";

const SIZE_MODE_MAP = {
  "keep shape (long side)": "keep",
  "force size (square)": "force",
  "free (multiple only)": "free",
};

// node-widget label <-> internal blend_mode key (the editor pill uses the internal key)
const BLEND_MODE_MAP = { "mask": "mask", "whole crop": "whole_crop" };

function readParams(node) {
  const g = (n) => node.widgets?.find((w) => w.name === n)?.value;
  return {
    size_mode: SIZE_MODE_MAP[g("size_mode")] || "keep",
    target: parseInt(g("target")) || 1024,
    multiple: parseInt(g("multiple")) || 8,
    context_px: g("context_px") != null ? parseInt(g("context_px")) : 24,
    mask_grow: g("mask_grow") != null ? parseInt(g("mask_grow")) : 4,
    mask_blur: g("mask_blur") != null ? parseInt(g("mask_blur")) : 4,
    blend: g("softness") != null ? parseInt(g("softness")) : 16,
    // blend_mode is now a node widget too (mirrored by the editor pill).
    blend_mode: BLEND_MODE_MAP[g("blend_mode")] || "mask",
  };
}

// friendly-label <- internal size-mode key, for writing the editor's choice back
const SIZE_MODE_LABEL = Object.fromEntries(
  Object.entries(SIZE_MODE_MAP).map(([k, v]) => [v, k]));
const BLEND_MODE_LABEL = Object.fromEntries(
  Object.entries(BLEND_MODE_MAP).map(([k, v]) => [v, k]));

function setNodeWidget(node, name, value) {
  const w = node.widgets?.find((x) => x.name === name);
  if (w && w.value !== value) { w.value = value; w.callback?.(value); }
}

// write the editor's mirrored geometry knobs back to the native node widgets
function writeBackWidgets(node, extra) {
  if (!extra) return;
  if (extra.context_px != null) setNodeWidget(node, "context_px", extra.context_px);
  if (extra.mask_grow != null) setNodeWidget(node, "mask_grow", extra.mask_grow);
  if (extra.mask_blur != null) setNodeWidget(node, "mask_blur", extra.mask_blur);
  if (extra.softness != null) setNodeWidget(node, "softness", extra.softness);
  if (extra.target != null) setNodeWidget(node, "target", extra.target);
  if (extra.multiple != null) setNodeWidget(node, "multiple", extra.multiple);
  if (extra.size_mode != null)
    setNodeWidget(node, "size_mode", SIZE_MODE_LABEL[extra.size_mode] || "keep shape (long side)");
  if (extra.blend_mode != null)
    setNodeWidget(node, "blend_mode", BLEND_MODE_LABEL[extra.blend_mode] || "mask");
}

// Give a duplicated node its own on-disk scratch space. The state_json carries
// a project_id that keys the src/mask files on disk; a duplicate (alt-drag,
// right-click Duplicate, or Ctrl+C/V) copies it verbatim, so saving from the
// copy's editor would overwrite the parent's files. If another live node of the
// same type already holds this id, re-mint it + clear the paths so the copy
// starts blank and isolated. A clean workflow load never has two nodes sharing
// an id, so this is a no-op (no write) on load -> no dirty-on-load.
function dedupeInpaintProjectId(node) {
  try {
    const w = node.widgets?.find((x) => x.name === "InpaintCropWidget");
    if (!w) return;
    let meta;
    try { meta = JSON.parse(w.value?.state_json || "{}"); } catch { return; }
    const myId = meta?.project_id;
    if (!myId) return;
    const g = node.graph || app.graph;
    const nodes = g?._nodes || g?.nodes || [];
    const collides = nodes.some((n) => {
      if (n === node || n?.comfyClass !== node.comfyClass) return false;
      const ow = n.widgets?.find((x) => x.name === "InpaintCropWidget");
      if (!ow) return false;
      let om; try { om = JSON.parse(ow.value?.state_json || "{}"); } catch { return false; }
      return om?.project_id === myId;
    });
    if (!collides) return;
    meta.project_id = "inpaint_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    meta.src_path = "";
    meta.mask_path = "";
    w.value = { state_json: JSON.stringify(meta) };
    // Also clear the copied cached-source references, else the node-body
    // thumbnail keeps showing the parent's image (restoreNodePreview can't
    // blank an already-drawn image). Then repaint: the upstream if the copy is
    // wired, otherwise the empty placeholder.
    node._pixInpaintSourceURL = null;
    if (node.properties) delete node.properties.pixInpaintSource;
    if (getUpstreamImageURL(node)) node._pixInpaintRefresh?.();
    else node._pixInpaintClearPreview?.();
  } catch (e) { console.warn("[InpaintCrop] dedupe project id failed:", e); }
}

function buildSourceURL(part, bust) {
  if (!part || !part.filename) return null;
  // The cache-buster is part of the ROUTE handed to pixApiUrl, never appended to
  // its RESULT: a hosted ComfyUI adds its auth token to the finished url, so
  // concatenating afterwards writes our param on the far side of that token
  // (see js/shared/api_url.mjs). Locally the two produce the identical string.
  return pixApiUrl(`/view?filename=${encodeURIComponent(part.filename)}` +
    `&subfolder=${encodeURIComponent(part.subfolder || "")}` +
    `&type=${encodeURIComponent(part.type || "temp")}` +
    (bust ? `&t=${Date.now()}` : ""));
}

// A LoadImage combo value can be "name.png", "sub/name.png", or carry an
// annotation like "clipspace/clipboard.png [input]" (this is what PASTING into a
// LoadImage produces - a subfolder + suffix). /view wants filename + subfolder as
// SEPARATE params and no annotation, so split it; otherwise the editor 404s with
// "Failed to load the source image" (only on paste, since a plain pick has no
// subfolder/suffix). Mirrors the image-picker split used elsewhere.
function parseAnnotatedImageValue(value) {
  let v = String(value || "");
  let type = "input";
  const m = v.match(/\s*\[(input|output|temp)\]\s*$/i);
  if (m) { type = m[1].toLowerCase(); v = v.slice(0, m.index); }
  v = v.replace(/\\/g, "/").trim();
  const i = v.lastIndexOf("/");
  return {
    filename: i >= 0 ? v.slice(i + 1) : v,
    subfolder: i >= 0 ? v.slice(0, i) : "",
    type,
  };
}

// ── finding the node that actually holds the picture ────────────────────────
// The image wired in is often NOT the node holding the pixels: people put a
// Switch, a Reroute or an Image Info in between. Resolving only the IMMEDIATE
// upstream meant the node found nothing, so the thumbnail never updated and the
// editor opened empty - reported 2026-09-17 with two recordings, against the
// real "Load Image works but these other nodes do not" case.
//
// THE RULE THAT MATTERS: when we cannot tell which branch is live, return
// NOTHING rather than guess. Painting a mask on the wrong picture is worse than
// painting on none, because nothing tells the user it happened.
const MAX_SOURCE_HOPS = 12;

// Core nodes that pass a picture straight through, naming the input that
// carries it. Needed only where the generic "exactly one wired input" rule
// below cannot tell an image apart from its siblings.
const PASSTHROUGH_INPUT = {
  JoinImageWithAlpha: "image",
  SplitImageWithAlpha: "image",
  PixaromaImageInfo: "image_info",
};

// Nodes that BUILD a new picture from what is wired in, so the picture on their
// input is not the one on their output. The one-wire rule below would otherwise
// walk straight through them: an Image Composer with a single placeholder slot
// wired opened the raw picture going INTO it, and the mask was painted on the
// wrong image (measured 2026-09-28, inpaint.md #18). Stopping here falls back to
// the picture the last run saved, which is the real composition.
const NOT_A_PASSTHROUGH = new Set(["PixaromaImageComposition"]);

function inputByName(node, name) {
  return (node.inputs || []).find((i) => i.name === name) || null;
}

// graph.links is an object on older frontends and a Map on newer ones
// (Vue Compat #3), so every read has to try both.
function linkById(graph, id) {
  if (id == null || !graph) return null;
  let l = graph.links?.[id];
  if (!l && typeof graph.links?.get === "function") l = graph.links.get(id);
  return l || null;
}

/** The input of `node` that carries the live picture, or null if unknowable.
 *
 * `fromSlot` is the OUTPUT slot we arrived through, which is what tells a
 * multi-row router which row we are on.
 */
function routedInput(node, fromSlot) {
  const cls = node.comfyClass || node.type || "";
  if (NOT_A_PASSTHROUGH.has(cls)) return null;

  // Our own routers record which branch is live, so ASK them. Guessing here
  // would silently pick another wire's picture.
  if (cls === "PixaromaSwitch") {
    const idx = node.properties?.switchState?.activeIndex;
    return idx ? inputByName(node, "input_" + idx) : null;
  }
  if (cls === "PixaromaSwitchSource") {
    // a_1..a_16 / b_1..b_16, one row per OUTPUT slot; the toggle picks the bank.
    const bank = node.properties?.switchSourceState?.active === "B" ? "b" : "a";
    return inputByName(node, bank + "_" + ((fromSlot | 0) + 1));
  }

  const named = PASSTHROUGH_INPUT[cls];
  if (named) {
    const hit = inputByName(node, named);
    if (hit) return hit;
  }

  // Anything else, including core Reroute and other packs' routers: follow it
  // only when exactly ONE input is wired. One wire is unambiguous; several is a
  // guess, and we do not guess.
  const wired = (node.inputs || []).filter((i) => i.link != null);
  return wired.length === 1 ? wired[0] : null;
}

/** Walk back to the node that really holds the pixels. `{node, slot}` or null. */
function resolveImageSource(node) {
  const graph = node.graph;
  if (!graph) return null;
  let input = inputByName(node, "image");
  const seen = new Set();
  for (let hop = 0; hop < MAX_SOURCE_HOPS; hop++) {
    if (!input || input.link == null) return null;
    const link = linkById(graph, input.link);
    const src = link && graph.getNodeById(link.origin_id);
    if (!src) return null;
    if (seen.has(src.id)) return null;      // a cycle: stop rather than spin
    seen.add(src.id);
    if (nodeImageURL(src, link.origin_slot)) return { node: src, slot: link.origin_slot };
    input = routedInput(src, link.origin_slot);
  }
  return null;                              // deeper than the cap: give up quietly
}

/** The picture THIS node is holding, or null if it holds none. */
function nodeImageURL(src, slot) {
  if (!src) return null;
  if (src.comfyClass === "LoadImage" || src.type === "LoadImage") {
    const w = (src.widgets || []).find((x) => x.name === "image");
    if (w && w.value) return buildSourceURL(parseAnnotatedImageValue(w.value), true);
  }
  if (src.imgs && src.imgs.length > 0) {
    const img = src.imgs[slot] || src.imgs[0];
    if (typeof img === "string") return img;
    if (img && img.src) return img.src;
  }
  return null;
}

// Load Image Pixaroma resizes in PYTHON, at execute time, so the resized pixels
// do not exist in the browser at all before a run - the editor can only open the
// file on disk. That is fine for a plain loader, but it is NOT harmless here:
// with an aspect-changing mode (crop / cover) the mask would be painted against
// geometry the run never sees, and the node reads as "it ignored my resize"
// (reported 2026-08-15).
//
// getUpstreamImageURL has a branch for core LoadImage and otherwise falls back
// to src.imgs, which for this node is the /view URL of the INPUT file - i.e.
// always the original. Rather than guess a resized preview we cannot produce,
// say plainly which picture is on screen.
function upstreamResizeNote(node) {
  // Through the same walk as the picture itself, so the note still appears when
  // the resizing loader sits behind a Switch or a Reroute.
  const found = resolveImageSource(node);
  const src = found && found.node;
  if (!src || src.comfyClass !== "PixaromaLoadImage") return "";
  let st = null;
  try {
    const raw = src.properties?.loadImagePixState;
    st = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
  } catch (e) {
    return "";                       // unreadable state is not worth a warning
  }
  const mode = st && typeof st.mode === "string" ? st.mode : "";
  if (!mode || mode === "off") return "";
  return ` — this is the ORIGINAL. The Load Image above resizes it (${mode}), `
    + "and the resized picture only exists after a run.";
}

function getUpstreamImageURL(node) {
  // Prefer the LIVE wired source so a just-changed Load Image (or any live
  // preview) is what the editor opens. The cached executed-source URL below is
  // only a fallback for generative upstreams whose pixels exist solely as the
  // temp PNG the Python node saved on the last run. (Without this order,
  // swapping the Load Image file showed the PREVIOUS run's image until re-run.)
  const found = resolveImageSource(node);
  if (found) {
    const url = nodeImageURL(found.node, found.slot);
    if (url) return url;
  }
  // fallback: source PNG from the last Python execute (generative upstreams, or
  // before a live preview exists), and the paste / drag-drop / restored case.
  if (node._pixInpaintSourceURL) return node._pixInpaintSourceURL;
  return null;
}

// ── clipboard paste → selected Inpaint Crop node ──
let _pasteInstalled = false;
function installPasteHandler() {
  if (_pasteInstalled) return;
  _pasteInstalled = true;
  window.addEventListener("paste", async (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const node = findActiveNode();
    if (!node) return;
    // editor open -> let the editor's own paste handler load it into the canvas
    if (node._pixInpaintEditor?.el?.overlay?.isConnected) return;
    const items = e.clipboardData?.items || [];
    const it = Array.from(items).find((x) => x.type?.startsWith("image/"));
    if (!it) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const idx = (node.inputs || []).findIndex((i) => i.name === "image");
    if (idx >= 0 && node.inputs[idx].link != null) { try { node.disconnectInput(idx); } catch {} }
    const idsBefore = new Set((app.graph?._nodes || []).map((n) => n.id));
    const blob = it.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = (ev) => node._pixInpaintPaste(ev.target.result);
    reader.readAsDataURL(blob);
    setTimeout(() => {
      for (const n of app.graph?._nodes || []) {
        if (idsBefore.has(n.id)) continue;
        if (n.comfyClass !== "LoadImage" && n.type !== "LoadImage") continue;
        const w = (n.widgets || []).find((x) => x.name === "image");
        if (typeof w?.value === "string" && w.value.startsWith("pasted/")) { try { app.graph.remove(n); } catch {} }
      }
    }, 50);
  }, true);
}

function findActiveNode() {
  const c = app.canvas;
  if (!c) return null;
  const ok = (n) => n && n.comfyClass === "PixaromaInpaintCrop" && typeof n._pixInpaintPaste === "function";
  const sel = c.selected_nodes;
  if (sel) {
    let iter = Array.isArray(sel) ? sel : (typeof sel.values === "function" ? Array.from(sel.values()) : Object.values(sel));
    const hit = iter?.find(ok);
    if (hit) return hit;
  }
  if (ok(c.current_node)) return c.current_node;
  if (ok(c.node_over)) return c.node_over;
  for (const n of app.graph?._nodes || []) if (ok(n) && (n.is_selected || n.flags?.is_selected)) return n;
  return null;
}

app.registerExtension({
  name: "Pixaroma.InpaintCrop",

  // No Settings-panel row: the mask preview colour lives on the node itself (the
  // gear in the selection toolbar / the right-click entry). The setting id is
  // unchanged and merely unregistered, so an existing choice carries over; the
  // read site supplies the default for the unset case.

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaInpaintCrop") return;
    capComputeSizeInNodes2(nodeType); // Nodes 2.0 Ctrl+Z grow on frontend 1.53 (inpaint.md #21)
    const origExec = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      origExec?.apply(this, arguments);
      this.imgs = null;
    };
    const origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const ret = origCfg?.apply(this, arguments);
      this.imgs = null;
      if (!this._pixInpaintSourceURL && this.properties?.pixInpaintSource) {
        this._pixInpaintSourceURL = buildSourceURL(this.properties.pixInpaintSource, true);
      }
      if (this._pixInpaintRefresh) {
        queueMicrotask(() => this._pixInpaintRefresh());
        setTimeout(() => this._pixInpaintRefresh?.(), 250);
      }
      // After the node settles, give a DUPLICATE its own project_id (see
      // dedupeInpaintProjectId). Deferred a microtask so a clipboard paste has
      // added the node to its graph (so this.graph + the sibling are both live).
      queueMicrotask(() => { if (!isGraphLoading()) dedupeInpaintProjectId(this); });
      return ret;
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaInpaintCrop") return;
    node.imgs = null;
    // Fresh-drop default size only; never on the load path (configure restores
    // the saved size, so writing it during load would dirty the workflow). Mutate
    // the array elements (convention #9), don't replace the array.
    if (!isGraphLoading() && node.size) { node.size[0] = 330; node.size[1] = 500; }

    if (!(node.inputs || []).some((i) => i.name === "image")) node.addInput("image", "IMAGE");
    if (!(node.inputs || []).some((i) => i.name === "mask")) node.addInput("mask", "MASK");

    const parts = createNodePreview(
      "Inpaint Crop", "Pixaroma",
      "Wire an IMAGE and Run,\nor click 'Open mask editor' to load + paint",
    );
    // let dedupe (module scope) blank this node's thumbnail after a duplicate
    node._pixInpaintClearPreview = () => clearNodePreview(parts, node);

    let stateJson = "{}";
    let widget;

    // Show the upstream picture - and CLEAR when there is no longer one.
    //
    // It used to paint only when it FOUND a url and never clear, so when the
    // source went away (a router flipped to an unwired row, a wire pulled) the
    // node kept showing the PREVIOUS picture: stale, which reads as correct and
    // is worse than blank. Flagged in `.claude/patterns/inpaint.md` #18 as "fix
    // it when someone is next in this file".
    //
    // The else is `restoreNodePreview`, NOT a bare clear, because a source can
    // legitimately have no wire at all - one loaded through the editor's own
    // Load Image lives in `stateJson.src_path`. restoreNodePreview rebuilds
    // from that when it is there and falls back to the placeholder when it is
    // not, so the editor-loaded case survives.
    //
    // isGraphLoading: this must never repaint while a workflow is opening -
    // nothing here writes serialized state, but the load path is where a wrong
    // answer would be baked in (Vue Compat #18/#19).
    const refreshSourcePreview = () => {
      const url = getUpstreamImageURL(node);
      if (url) { showNodePreview(parts, url, null, node); return; }
      if (isGraphLoading()) return;
      restoreNodePreview(parts, stateJson, node);
    };

    // ── Open mask editor button ──
    node.addWidget("button", "Open mask editor", null, () => {
      if (node._pixInpaintEditor?.el?.overlay?.isConnected) return;
      refreshSourcePreview();   // sync the node thumbnail to the current upstream image
      const editor = new InpaintCropEditor();
      node._pixInpaintEditor = editor;
      // brush size / opacity persist across opens on this node
      const captureBrush = () => {
        node._pixInpaintBrush = { brushSize: editor.brushSize, maskOpacity: editor.maskOpacity };
      };

      // preview tint (display only) - seed from the setting, persist on change
      const colName = app.ui.settings?.getSettingValue?.("Pixaroma.Inpaint.PreviewColor") || "Red";
      const colHex = INPAINT_PREVIEW_COLORS[colName] || INPAINT_PREVIEW_COLORS.Red;
      editor.previewColor = colHex;
      editor._cropBoxColor = (colHex === INPAINT_PREVIEW_COLORS.Orange) ? "#ffffff" : null;
      editor.onPreviewColor = (name) => {
        try { app.ui.settings?.setSettingValueAsync?.("Pixaroma.Inpaint.PreviewColor", name); } catch {}
      };

      editor.onSave = (jsonStr, extra, preview) => {
        stateJson = jsonStr;
        if (widget) widget.value = { state_json: jsonStr };
        writeBackWidgets(node, extra);
        if (preview) showNodePreview(parts, preview, null, node);
        if (app.graph) { app.graph.setDirtyCanvas(true, true); app.graph.change?.(); }
        captureBrush();
      };
      editor.onSaveToDisk = (d) => downloadDataURL(d, "pixaroma_inpaint_crop");
      editor.onLoadImage = () => {
        const idx = (node.inputs || []).findIndex((i) => i.name === "image");
        if (idx >= 0 && node.inputs[idx].link != null) { try { node.disconnectInput(idx); } catch {} }
      };
      editor.onClose = () => { captureBrush(); node._pixInpaintEditor = null; node.setDirtyCanvas(true, true); };

      // Read BEFORE open: the loader's onload appends it to the "Loaded: W×H"
      // status, so it has to be on the editor by the time the image lands.
      editor._pixResizeNote = upstreamResizeNote(node);
      editor.open(stateJson, getUpstreamImageURL(node),
        readParams(node), node._pixInpaintBrush);
    });

    // ── mini-preview DOM widget (also carries the hidden state) ──
    installCanvasZoomPassthrough(parts.container);
    widget = node.addDOMWidget("InpaintCropWidget", "custom", parts.container, {
      getValue: () => ({ state_json: stateJson }),
      setValue: (v) => {
        if (!v || typeof v !== "object") return;
        stateJson = v.state_json || "{}";
        const imgInput = (node.inputs || []).find((i) => i.name === "image");
        if (imgInput && imgInput.link != null) queueMicrotask(refreshSourcePreview);
        else restoreNodePreview(parts, stateJson, node);   // rebuild from src_path when present
      },
      getMinHeight: () => 200,
      margin: 5,
    });
    applyAdaptiveCanvasOnly(widget);
    // Classic fresh drop: up to core's own height (558), or the first Ctrl+Z grows
    // the node 12px and jams undo (#20).
    growToCoreMinHeight(node);
    activateNodePreview(parts, node);

    // ── paste / drag-drop a source directly onto the node ──
    installPasteHandler();
    node._pixInpaintPaste = async (dataURL) => {
      try {
        const r = await api.fetchApi("/pixaroma/api/inpaint/upload_src", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: "inpaint_paste_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9), image: dataURL }),
        });
        const d = await r.json();
        const srcPath = d.path || "";
        let meta = {};
        try { meta = JSON.parse(stateJson) || {}; } catch {}
        meta.src_path = srcPath;
        meta.mask_path = "";  // a new source clears the old painted mask
        stateJson = JSON.stringify(meta);
        if (widget) widget.value = { state_json: stateJson };
        if (srcPath) {
          const part = { filename: srcPath.split(/[\\/]/).pop(), subfolder: "pixaroma", type: "input" };
          node._pixInpaintSourceURL = buildSourceURL(part, true);
          if (!node.properties) node.properties = {};
          node.properties.pixInpaintSource = part;
        }
        showNodePreview(parts, dataURL, null, node);
        if (app.graph) app.graph.setDirtyCanvas(true, true);
      } catch (err) { console.warn("[InpaintCrop] paste failed:", err); }
    };
    const dropTarget = parts?.container;
    if (dropTarget) {
      dropTarget.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.stopPropagation(); } });
      dropTarget.addEventListener("drop", (e) => {
        e.preventDefault(); e.stopPropagation();
        const file = e.dataTransfer?.files?.[0];
        if (!file || !file.type?.startsWith("image/")) return;
        const idx = (node.inputs || []).findIndex((i) => i.name === "image");
        if (idx >= 0 && node.inputs[idx].link != null) { try { node.disconnectInput(idx); } catch {} }
        const reader = new FileReader();
        reader.onload = (ev) => node._pixInpaintPaste(ev.target.result);
        reader.readAsDataURL(file);
      });
    }

    // ── source URL caching from Python execute + refresh hooks ──
    node._pixInpaintRefresh = () => {
      if (getUpstreamImageURL(node)) refreshSourcePreview();
      // pass the real state (not "{}") so restoreNodePreview can rebuild from src_path
      // - e.g. a source loaded via the editor's Load Image, where the wire is gone.
      else restoreNodePreview(parts, stateJson, node);
    };
    const onExec = (event) => {
      const detail = event?.detail;
      if (!detail?.output) return;
      const matched = app.graph.getNodeById(detail.node) || app.graph.getNodeById(parseInt(detail.node, 10));
      if (matched !== node) return;
      const frames = detail.output.pixaroma_inpaint_source;
      if (!frames?.length) return;
      const f = frames[0];
      const part = { filename: f.filename, subfolder: f.subfolder || "", type: f.type || "temp" };
      node._pixInpaintSourceURL = buildSourceURL(part, true);
      if (!node.properties) node.properties = {};
      node.properties.pixInpaintSource = part;
      refreshSourcePreview();
    };
    api.addEventListener("executed", onExec);

    // A router flipping its live branch changes what is wired into us, and
    // LiteGraph fires nothing for it (no wire moved, no node added). Our routers
    // announce it instead - see js/shared/router_changed.mjs for why this is a
    // signal and not the 800ms per-node poll the reporter's agent used. Costs
    // nothing until somebody actually clicks a Switch.
    const offRouter = onRouterChanged(() => {
      if (isGraphLoading()) return;
      node._pixInpaintRefresh?.();
    });

    // wrap (don't clobber) any existing handler from the prototype / another ext;
    // forward all args, then run our image-input source-preview logic.
    const origConnChange = node.onConnectionsChange;
    node.onConnectionsChange = function (type, slotIndex, connected) {
      const r = origConnChange?.apply(this, arguments);
      if (type === LiteGraph.INPUT && node.inputs?.[slotIndex]?.name === "image" && !isGraphLoading()) {
        node._pixInpaintSourceURL = null;
        if (node.properties) delete node.properties.pixInpaintSource;
        if (connected) refreshSourcePreview();
        else restoreNodePreview(parts, "{}", node);
      }
      return r;
    };

    const origRemoved = node.onRemoved;
    node.onRemoved = () => {
      try { if (node._pixInpaintEditor?.el?.overlay?.isConnected) node._pixInpaintEditor._close(); } catch (e) {}
      try { parts?.resizeObserver?.disconnect(); } catch (e) {}
      origRemoved?.call(node);
      try { api.removeEventListener("executed", onExec); } catch {}
      try { offRouter(); } catch {}
    };
  },
});

// No colour block: this node's face is ComfyUI's own grey button plus a preview,
// so there is no Pixaroma orange on it to change. The panel hosts the mask
// preview colour, which used to sit in the global Settings panel.
registerNodeAccent("PixaromaInpaintCrop", {
  title: "Inpaint Crop",
  accent: false,
  rows: [
    { kind: "combo", setting: "Pixaroma.Inpaint.PreviewColor",
      options: ["Red", "Green", "Blue", "Yellow", "Orange"], defaultValue: "Red",
      label: "Mask preview colour",
      hint: "The tint over the mask and seam in the editor. Display only." },
  ],
});
