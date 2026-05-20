import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { hideJsonWidget } from "../shared/index.mjs";
import { buildModePanel, previewResize, injectResizePanelCSS } from "../shared/resize_panel.mjs";
import {
  injectCSS, buildModeChips, buildFooter, buildResampleAndUpscale,
  buildReadout, buildPreview,
} from "./ui.mjs";

injectCSS();
injectResizePanelCSS();

const STATE_PROP = "imageResizeState";
const HIDDEN_INPUT = "ImageResizeState";
const DEFAULT_STATE = {
  mode: "off", max_mp: 1.0, longest_side: 1024, scale_factor: 1.0,
  fit_w: 1024, fit_h: 1024, cover_w: 1024, cover_h: 1024,
  ratio_preset: "1:1", ratio_w: 1, ratio_h: 1, ratio_action: "crop",
  pad_color: "#000000", snap: 0, resample: "auto", allow_upscale: true,
  preview_open: false,
};
const WH_MODES = new Set(["fit_inside", "cover"]);

function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return { ...DEFAULT_STATE, ...JSON.parse(v) }; } catch {}
  }
  return { ...DEFAULT_STATE };
}
function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

// Sum children intrinsic heights (NOT scrollHeight — LiteGraph stretches the
// root, so scrollHeight feeds back; see Load Image Pattern #4). Root is a flex
// column with 8px gap + 8px padding top/bottom.
function measureContentHeight(root) {
  if (!root) return 120;
  let h = 0;
  for (const c of root.children) h += c.offsetHeight;
  h += Math.max(0, root.children.length - 1) * 8; // row gaps
  h += 16; // root padding (top + bottom)
  return Math.max(120, h);
}

// Refit node height to content. ONLY call on genuine user actions — never on
// the load path (Vue Compat #18: resizing during configure dirties the saved
// workflow). rAF so the freshly-rendered panel has laid out before measuring.
function refit(node) {
  if (!node._pixIrRoot) return;
  requestAnimationFrame(() => {
    if (!node._pixIrRoot) return;
    const sz = node.computeSize();
    if (Math.abs(node.size[1] - sz[1]) > 1) {
      node.size[1] = sz[1];
      node.setDirtyCanvas(true, true);
    }
  });
}

function getInputDims(node) {
  const inp = node.inputs?.find((i) => i.name === "image");
  if (!inp || inp.link == null) return null;
  let l = node.graph?.links?.[inp.link];
  if (!l && typeof node.graph?.links?.get === "function") l = node.graph.links.get(inp.link);
  if (!l) return null;
  const up = node.graph.getNodeById(l.origin_id);
  const img = up?.imgs?.[0];
  if (img?.naturalWidth) return { w: img.naturalWidth, h: img.naturalHeight };
  return null;
}

function refreshReadout(node) {
  const ro = node._pixIrEls?.readout;
  if (!ro) return;
  const state = readState(node);
  const cached = node.properties?.pixIrDims;       // {in_w,in_h,out_w,out_h} from last run
  const live = getInputDims(node);
  if (live) {
    // Upstream image size is known (e.g. a loader feeding in) — predict live.
    const { w, h } = previewResize(live.w, live.h, state);
    ro.innerHTML = `<b>${live.w}×${live.h}</b> → <b>${w}×${h}</b>`;
  } else if (cached) {
    // No live size, but we learned it from the last run.
    ro.innerHTML = `<b>${cached.in_w}×${cached.in_h}</b> → <b>${cached.out_w}×${cached.out_h}</b>`;
  } else if (!isWired(node, "image")) {
    // Nothing connected yet — guide the user.
    ro.textContent = "Connect an image";
  } else {
    // Wired to something whose size isn't known until it runs (e.g. a
    // mid-workflow image that hasn't been generated yet).
    ro.textContent = "Run once to read size";
  }
}

function renderPreviewThumb(node) {
  const body = node._pixIrEls?.body;
  if (!body) return;
  const p = node.properties?.pixIrPreview; // {url, out_w, out_h}
  if (!p?.url) {
    body.innerHTML = `<div class="pix-ir-hint">Run the workflow to see the result</div>`;
    return;
  }
  body.innerHTML = `<img src="${p.url}"><div class="pix-ir-badge">${p.out_w} × ${p.out_h}</div>`;
}

function isWired(node, name) {
  const inp = node.inputs?.find((i) => i.name === name);
  return !!(inp && inp.link != null);
}

// Lock the matching W/H field in the active panel when its wire is connected.
// buildWHPanel renders Width then Height as the first two text inputs.
function applyWiredLocks(node, root) {
  const state = readState(node);
  if (!WH_MODES.has(state.mode)) return;
  const numEls = [...root.querySelectorAll(".pix-li-numinput input")];
  if (isWired(node, "width") && numEls[0]) lockField(numEls[0]);
  if (isWired(node, "height") && numEls[1]) lockField(numEls[1]);
}
function lockField(inp) {
  inp.readOnly = true;
  inp.style.opacity = "0.55";
  inp.title = "Driven by wired input";
}

// On connect of width/height while NOT in a W×H mode, switch to Crop to fill
// (the "make it exactly this size" default). User-intent only — gated by the
// configuring flag at the call site (Vue Compat #17).
function maybeAutoSwitch(node) {
  const state = readState(node);
  if ((isWired(node, "width") || isWired(node, "height")) && !WH_MODES.has(state.mode)) {
    writeState(node, { ...state, mode: "cover" });
  }
}

function renderUI(node) {
  const root = node._pixIrRoot;
  // Render even when the root is not yet attached to the document: on a fresh
  // drop the DOM widget element can still be detached at queueMicrotask time,
  // and building into a detached node is fine (Vue mounts it moments later).
  // Bailing on !isConnected here left the body blank until the first wire/edit.
  if (!root) return;
  const state = readState(node);
  root.innerHTML = "";

  const chips = buildModeChips(state);
  root.appendChild(chips);

  const panel = buildModePanel(state.mode, node, state, writeState,
    () => refreshReadout(node), STATE_PROP);
  if (panel) root.appendChild(panel);

  const readout = buildReadout();
  root.appendChild(readout);

  const footer = buildFooter(state);
  root.appendChild(footer);

  const { wrap: ruWrap, sel, box } = buildResampleAndUpscale(state);
  root.appendChild(ruWrap);

  const { wrap: prevWrap, bar, body } = buildPreview(state);
  root.appendChild(prevWrap);

  node._pixIrEls = { readout, body, bar };
  applyWiredLocks(node, root);
  refreshReadout(node);
  if (state.preview_open) renderPreviewThumb(node);

  // ── wiring ──
  chips.addEventListener("click", (e) => {
    const c = e.target.closest(".pix-ir-chip");
    if (!c) return;
    writeState(node, { ...readState(node), mode: c.dataset.mode });
    renderUI(node);
    refit(node);
  });
  footer.addEventListener("click", (e) => {
    const s = e.target.closest(".pix-ir-schip");
    if (!s) return;
    writeState(node, { ...readState(node), snap: parseInt(s.dataset.snap, 10) });
    // snap doesn't change panel height — update active chip + readout only.
    for (const el of footer.querySelectorAll(".pix-ir-schip")) {
      el.classList.toggle("active", el === s);
    }
    refreshReadout(node);
  });
  sel.addEventListener("change", () => {
    writeState(node, { ...readState(node), resample: sel.value });
    refreshReadout(node);
  });
  box.addEventListener("change", () => {
    writeState(node, { ...readState(node), allow_upscale: box.checked });
    refreshReadout(node);
  });
  bar.addEventListener("click", () => {
    const s = readState(node);
    writeState(node, { ...s, preview_open: !s.preview_open });
    renderUI(node);
    refit(node);
  });
}

app.registerExtension({
  name: "Pixaroma.ImageResize",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaImageResize") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _origCreated?.apply(this, arguments);
      hideJsonWidget(this.widgets, HIDDEN_INPUT);
      const root = document.createElement("div");
      root.className = "pix-ir-root";
      this.addDOMWidget("image_resize_ui", "custom", root, {
        canvasOnly: true,
        serialize: false,
        getMinHeight: () => measureContentHeight(root),
      });
      this._pixIrRoot = root;
      // Fresh-node default size (saved workflows restore their own via configure).
      if (!this.size || this.size[0] < 270) this.size = [276, 340];
      // Deferred initial render so configure() can land the saved state first
      // (Vue Compat #8). By microtask time, configure() has already run for a
      // loaded node, so node.properties[STATE_PROP] is set — we use that to
      // refit ONLY on a genuine fresh drop, never on load (Vue Compat #18).
      queueMicrotask(() => {
        const wasConfigured = this.properties?.[STATE_PROP] !== undefined;
        renderUI(this);
        if (!wasConfigured) refit(this);
      });
      return r;
    };

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      this._pixIrConfiguring = true;
      try {
        const res = _origConfigure?.apply(this, arguments);
        if (this._pixIrRoot) renderUI(this); // render only — no refit (Vue Compat #18)
        return res;
      } finally {
        this._pixIrConfiguring = false;
      }
    };

    const _origConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, idx, connected, link, ioSlot) {
      const r = _origConn?.apply(this, arguments);
      if (!this._pixIrConfiguring && this._pixIrRoot) {
        if (connected) maybeAutoSwitch(this); // user intent only (Vue Compat #17)
        renderUI(this);
        refit(this);
        // Upstream loader may populate its image a tick after the wire lands;
        // re-read the size shortly after so the readout updates without a run.
        setTimeout(() => refreshReadout(this), 200);
      }
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixIrRoot = null;
      this._pixIrEls = null;
      return _origRemoved?.apply(this, arguments);
    };
  },
});

// ── executed payload: learn real in/out dims + result preview ──
api.addEventListener("executed", ({ detail }) => {
  const frames = detail?.output?.pixaroma_image_resize;
  if (!frames || !frames.length) return;
  let node = app.graph.getNodeById(detail.node);
  if (!node && typeof detail.node === "string") node = app.graph.getNodeById(parseInt(detail.node, 10));
  if (!node || node.comfyClass !== "PixaromaImageResize") return;
  const f = frames[0];
  if (!node.properties) node.properties = {};
  node.properties.pixIrDims = { in_w: f.in_w, in_h: f.in_h, out_w: f.out_w, out_h: f.out_h };
  if (f.filename) {
    const url = `/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || "")}&type=${f.type || "temp"}&t=${Date.now()}`;
    node.properties.pixIrPreview = { url, out_w: f.out_w, out_h: f.out_h };
  }
  refreshReadout(node);
  if (readState(node).preview_open) renderPreviewThumb(node);
});

// ── graphToPrompt: inject state into the hidden input (subgraph-safe) ──
const _origG2P = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origG2P(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    const buildIndex = () => {
      const m = new Map();
      const visit = (g) => {
        if (!g) return;
        for (const n of (g._nodes || g.nodes || [])) {
          if (!n) continue;
          if (n.comfyClass === "PixaromaImageResize" || n.type === "PixaromaImageResize")
            m.set(String(n.id), n);
          const inner = n.subgraph || n.graph || n._graph;
          if (inner && inner !== g) visit(inner);
        }
      };
      visit(app.graph);
      return m;
    };
    for (const id in out) {
      if (out[id]?.class_type !== "PixaromaImageResize") continue;
      if (!index) index = buildIndex();
      const sId = String(id);
      let node = index.get(sId);
      if (!node && sId.includes(":")) node = index.get(sId.slice(sId.lastIndexOf(":") + 1));
      const state = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
      out[id].inputs = out[id].inputs || {};
      out[id].inputs[HIDDEN_INPUT] = state;
    }
  }
  return result;
};
