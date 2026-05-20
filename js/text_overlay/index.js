// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay Pixaroma — extension entry (simplified v2)     ║
// ║  Node body hosts the full text_editor.mjs panel + Open btn.  ║
// ║  Same panel re-mounted in editor right sidebar on open.      ║
// ╚═══════════════════════════════════════════════════════════════╝

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { TextOverlayEditor } from "./core.mjs";
import { createTextEditorPanel } from "../framework/text_editor.mjs";
import { loadFontForLayer, canvasFontString } from "../framework/fonts.mjs";
import { DEFAULT_STATE, resetStateInPlace } from "./defaults.mjs";
import "./interaction.mjs"; // side-effect: registers prototype methods

const NODE_CLASS = "PixaromaTextOverlay";
const STATE_PROP = "textOverlayState";
const HIDDEN_INPUT_NAME = "TextOverlayState";

app.registerExtension({
  name: "Pixaroma.TextOverlay",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_CLASS) return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setupTextOverlayNode(this);
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      // Gate the text-lock RESIZE during load. LGraphNode.configure() replays
      // onConnectionsChange for every wired slot (Vue Compat #17); without the
      // flag, that replay would resize the node by 1-2px (computeSize rounding)
      // and falsely mark the workflow modified on a plain open. Cleared in
      // finally so it always resets.
      this._textOverlayConfiguring = true;
      try {
        const r = origConfigure?.apply(this, arguments);
        ensureValidState(this);
        // panelHeight() returns a fixed constant (BASE_H +/- HINT_H), so
        // node.size is the same on every load and the workflow is never
        // falsely flagged "modified".
        // After configure, push current state into the body panel UI
        if (this._textOverlayBodyPanel) {
          this._textOverlayBodyPanel.setLayer(this.properties[STATE_PROP]);
        }
        refreshOpenButton(this);
        refreshTextLock(this); // allowResize defaults false - no resize on load
        return r;
      } finally {
        this._textOverlayConfiguring = false;
      }
    };

    // Update the Open button + text-lock indicator when wires change
    // so the user sees the right state immediately (image wire affects
    // the Open button; text wire grays out the textarea). Allow the resize
    // only for REAL user wire changes (not the configure-replay during load).
    const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = origOnConnectionsChange?.apply(this, arguments);
      refreshOpenButton(this);
      refreshTextLock(this, !this._textOverlayConfiguring);
      return r;
    };
  },
});

function ensureValidState(node) {
  if (!node.properties) node.properties = {};
  const cur = node.properties[STATE_PROP];
  // Reset to defaults when version is missing or older than current.
  // v1 (multi-layer) and v2 (bad defaults) both replaced wholesale.
  if (!cur || cur.version !== 3) {
    node.properties[STATE_PROP] = { ...DEFAULT_STATE };
  }
}

function setupTextOverlayNode(node) {
  ensureValidState(node);

  const root = document.createElement("div");
  root.style.cssText = "display:flex; flex-direction:column; gap:6px; padding:4px 0;";

  // Open Text Editor button at the top. When the upstream image is not
  // available (no wire, or wire connected but workflow hasn't run yet),
  // the button shows a hint label instead and refuses to open the
  // editor — so the user doesn't waste two clicks (open + close).
  const btn = document.createElement("button");
  btn.style.cssText = "color:#fff; border:none; padding:8px; border-radius:4px; font:600 13px system-ui;";
  btn.addEventListener("click", () => {
    if (btn.classList.contains("disabled")) return;
    openEditor(node);
  });
  root.appendChild(btn);
  node._textOverlayOpenBtn = btn;
  refreshOpenButton(node);

  // The shared text_editor.mjs panel mounted on the node body
  const panelMount = document.createElement("div");
  panelMount.style.cssText = "padding:0 4px;";
  root.appendChild(panelMount);

  const bodyPanel = createTextEditorPanel({
    mount: panelMount,
    onChange: () => {
      // Sync the editor's panel (if editor is open) + re-render its canvas
      if (node._textOverlayEditor && node._textOverlayEditor.layout?.overlay?.isConnected) {
        node._textOverlayEditor.editorPanel?.setLayer?.(node.properties[STATE_PROP]);
        node._textOverlayEditor.requestRender?.();
      }
      node.setDirtyCanvas?.(true, true);
    },
    // Reset to DEFAULT_STATE in-place so both the body panel + (if open)
    // editor sidebar point at the same restored object. We mutate keys
    // rather than replace the object so existing references stay valid.
    onReset: (layer) => resetStateInPlace(layer),
    // "Position on canvas" buttons on the node body. Moves the whole text
    // block to a canvas edge / center. The editor sidebar panel does NOT
    // get this callback (the editor has its own top align toolbar), so the
    // row only appears on the node body where there's no canvas to drag.
    onAlignCanvas: (mode) => alignOnCanvasFromBody(node, mode),
  });
  node._textOverlayBodyPanel = bodyPanel;
  node._textOverlayBodyRoot = root;

  // Intrinsic content-height measurement, mirrors Load Image's
  // measureContentHeight pattern: sum children's offsetHeight + the panel's
  // padding (8px top + 8px bottom = 16px) + flex gaps (5px between visible
  // children). Do NOT use root.scrollHeight: LiteGraph stretches root when
  // the node is taller than minimum and that creates a feedback loop where
  // every paint reports a larger height. Children offsetHeight is intrinsic
  // and stable.
  function measureContentHeight() {
    let totalH = 0;
    let visible = 0;
    for (const child of root.children) {
      const style = window.getComputedStyle(child);
      if (style.position === "absolute" || style.position === "fixed") continue;
      if (style.display === "none") continue;
      totalH += child.offsetHeight;
      visible += 1;
    }
    const padding = 16;            // 8px top + 8px bottom (matches CSS)
    const gaps    = Math.max(0, visible - 1) * 5; // flex gap: 5px in CSS
    return Math.max(320, totalH + padding + gaps);
  }
  node._textOverlayMeasureHeight = measureContentHeight;

  // FIXED panel height - the only approach that can't dirty the workflow.
  // Every measurement-based attempt failed: the live DOM height varies a few
  // px between save and reload (font/layout timing), AND storing it in
  // node.properties added a key the saved baseline lacked - either way
  // node.size differed on load and ComfyUI flagged the workflow "modified"
  // even when nothing was edited. A constant removes measurement (and any
  // stored property) from the load path entirely, so node.size is the SAME
  // value every save and load -> never dirty. The height only depends on
  // whether the text-lock hint row is shown (text input wired), which is
  // restored consistently from the saved graph. BASE_H is the panel's content
  // height with the hint hidden; if the panel layout changes (add/remove a
  // row), update BASE_H to match (the only maintenance cost of this approach).
  const BASE_H = 412;   // content height, text input NOT wired
  const HINT_H = 18;    // extra height when the text input IS wired (lock hint)
  function panelHeight() {
    const wired = node.inputs?.find((i) => i.name === "text")?.link != null;
    return BASE_H + (wired ? HINT_H : 0);
  }
  node._textOverlayPanelHeight = panelHeight;

  node.addDOMWidget("pix_text_overlay_ui", "div", root, {
    canvasOnly: true,
    serialize: false,
    getMinHeight: panelHeight,
    // Cap height at content size so manual node resize gives the slack to
    // ComfyUI's input slot area / blank space, not stretches this panel.
    // Without getMaxHeight the layout engine treats this widget as
    // stretchable and the bottom of the panel sits below where the
    // background ends, leaving the Reset button visually outside the node.
    getMaxHeight: panelHeight,
  });

  // Default size for new nodes; LiteGraph restores saved sizes via configure.
  // The compact layout plus the "Text align" + "Position on canvas" rows
  // fits in roughly 450 px including title + slots; pick 455 so there is a
  // touch of breathing room. (getMinHeight enforces the true content height
  // anyway, but a matching default avoids an initial resize jump.)
  if (!node.size || node.size[0] < 320) {
    node.size = [340, 455];
  }

  // Enforce a minimum node width so the user can't drag-shrink so narrow
  // that the input values get clipped and labels overlap. Self-heal on
  // draw is the Preview Image Pixaroma pattern #11 (Vue Compat #13 says
  // onResize is unreliable for DOM-widget resizes; overriding
  // node.computeSize interferes with LiteGraph's internal layout and can
  // make the whole node body collapse on the current Vue frontend).
  const MIN_W = 320;
  const _origOnDrawForeground = node.onDrawForeground?.bind(node);
  node.onDrawForeground = function (ctx) {
    if (this.size && this.size[0] < MIN_W) {
      this.size[0] = MIN_W;
      this.setDirtyCanvas?.(true, true);
    }
    return _origOnDrawForeground ? _origOnDrawForeground(ctx) : undefined;
  };

  // Defer panel population past configure() so saved state is restored first.
  // No deferred height capture here - panelHeight() stores the height
  // synchronously the first time it runs (see comment there), which keeps
  // node.size and the persisted height in agreement.
  queueMicrotask(() => {
    bodyPanel.setLayer(node.properties[STATE_PROP]);
    refreshTextLock(node);
  });
}

function openEditor(node) {
  if (node._textOverlayEditor && node._textOverlayEditor.layout?.overlay?.isConnected) return;
  const editor = new TextOverlayEditor(node);
  node._textOverlayEditor = editor;
  editor.open().catch((e) => {
    console.error("[Text Overlay] open failed", e);
    try { editor.close(); } catch {}
  });
}

// Open-button state management. The button is only "ready" when the
// upstream image input is wired AND the upstream node has produced an
// image (workflow has run at least once). Other states show a hint
// label and refuse to open the editor.
function isUpstreamImageReady(node) {
  const link = node.inputs?.find((i) => i.name === "image")?.link;
  if (link == null) return false;
  // Two paths the upstream image can be available:
  // 1. Upstream node populates `imgs[0]` (Load Image, Preview Image, etc).
  //    We can grab the HTMLImageElement directly.
  // 2. Upstream is an intermediate (VAE Decode, ImageScale, etc) that does
  //    not populate `imgs`. In that case the only way we KNOW an image has
  //    flowed through is to track this Text Overlay node's own execution.
  //    Once THIS node has run at least once, the upstream chain must have
  //    been able to produce an image, so the editor can fetch it.
  const graph = window.app.graph;
  let linkObj = graph.links?.[link];
  if (!linkObj && typeof graph.links?.get === "function") linkObj = graph.links.get(link);
  if (!linkObj) return false;
  const upstream = graph.getNodeById(linkObj.origin_id);
  const img = upstream?.imgs?.[0];
  if (img && img.complete && img.naturalWidth > 0) return true;
  if (node._textOverlayHasRun) return true;
  return false;
}

// Gray out the text textarea in the body panel when the `text` input
// is wired (upstream value overrides whatever the user types). Returns
// the textarea to editable when the wire is detached. Re-fits the node
// height so the orange hint line under the textarea doesn't leave
// stale empty space when removed.
function refreshTextLock(node, allowResize = false) {
  const panel = node._textOverlayBodyPanel;
  if (!panel || typeof panel.setTextReadOnly !== "function") return;
  const link = node.inputs?.find((i) => i.name === "text")?.link;
  const wired = link != null;
  panel.setTextReadOnly(wired, wired ? "Text input is wired - upstream value is used" : "");
  // The node-height snap runs ONLY for real user wire changes. On a plain
  // workflow load the saved size already fits the hint state, and a
  // computeSize() rounding difference of 1-2px would otherwise rewrite
  // node.size and falsely flag the workflow as modified (issue: "Save
  // Changes?" prompt on open+close with no edits).
  if (!allowResize) return;
  // Defer to next frame so the hint's DOM layout settles before
  // computeSize re-measures. LiteGraph's computeSize returns the
  // total node height (chrome + slots + widgets) so we don't need
  // to guess the chrome offset.
  requestAnimationFrame(() => {
    // Wire state changed -> panelHeight() now returns BASE_H +/- HINT_H, so
    // computeSize() already reflects the new height; just snap node.size to it.
    if (typeof node.computeSize === "function" && node.size) {
      const min = node.computeSize();
      if (Array.isArray(min) && min.length === 2 && typeof min[1] === "number") {
        if (Math.abs(node.size[1] - min[1]) > 1) {
          node.size[1] = min[1];
          node.setDirtyCanvas?.(true, true);
          node.graph?.setDirtyCanvas?.(true, true);
        }
      }
    }
  });
}

function refreshOpenButton(node) {
  const btn = node._textOverlayOpenBtn;
  if (!btn) return;
  if (isUpstreamImageReady(node)) {
    btn.classList.remove("disabled");
    btn.style.background = "#f66744";
    btn.style.color = "#fff";
    btn.style.cursor = "pointer";
    btn.textContent = "Open Text Editor";
    btn.title = "Open the fullscreen text editor";
  } else {
    btn.classList.add("disabled");
    btn.style.background = "#2a2a2a";
    btn.style.color = "#f66744";   // orange text so the hint is legible
    btn.style.cursor = "not-allowed";
    const link = node.inputs?.find((i) => i.name === "image")?.link;
    if (link == null) {
      btn.textContent = "Connect an image first";
      btn.title = "Wire an image source into the 'image' input";
    } else {
      btn.textContent = "Run workflow first";
      btn.title = "Run the workflow so the upstream image is available";
    }
  }
}

// Refresh the button label whenever a workflow finishes. If the executed
// node is a Text Overlay itself, mark it _textOverlayHasRun so the
// readiness check passes even when upstream is an intermediate node that
// doesn't populate `imgs[0]` (e.g. VAE Decode in a SD generation chain).
// Match any of comfyClass / type / nodeData.name. Different ComfyUI
// versions and Vue frontend builds use different fields for the class
// identifier; checking all of them is the only way to be reliable.
function isTextOverlayNode(node) {
  if (!node) return false;
  if (node.comfyClass === NODE_CLASS) return true;
  if (node.type === NODE_CLASS) return true;
  if (node.constructor?.comfyClass === NODE_CLASS) return true;
  if (node.nodeData?.name === NODE_CLASS) return true;
  return false;
}

api.addEventListener("executed", (e) => {
  const detail = e?.detail || {};
  const ridRaw = detail.node;
  let executedNode = null;
  if (ridRaw != null) {
    executedNode = app.graph?.getNodeById?.(ridRaw)
                || app.graph?.getNodeById?.(parseInt(ridRaw, 10))
                || app.graph?.getNodeById?.(String(ridRaw));
  }
  if (isTextOverlayNode(executedNode)) {
    executedNode._textOverlayHasRun = true;
    const base = detail.output?.pixaroma_text_overlay_base?.[0];
    if (base?.filename) {
      const subfolder = base.subfolder ? `&subfolder=${encodeURIComponent(base.subfolder)}` : "";
      const type = base.type || "temp";
      executedNode._textOverlayBaseImageURL =
        `/view?filename=${encodeURIComponent(base.filename)}${subfolder}&type=${encodeURIComponent(type)}&t=${Date.now()}`;
    }
    // Python resolved the text position on this run (first-run path for
    // generative chains where the JS hook couldn't position pre-submit -
    // covers both auto-center and an explicit "Position on canvas" choice).
    // Persist the x/y on the node and clear both pending flags so
    // subsequent runs respect the position.
    const ac = detail.output?.pixaroma_text_overlay_autocentered?.[0];
    if (ac && Number.isFinite(ac.x) && Number.isFinite(ac.y)) {
      const state = executedNode.properties?.[STATE_PROP];
      if (state) {
        state.x = ac.x;
        state.y = ac.y;
        delete state._autoCenterPending;
        delete state._alignPending;
        if (executedNode._textOverlayBodyPanel) {
          executedNode._textOverlayBodyPanel.setLayer(state);
        }
        executedNode.setDirtyCanvas?.(true, true);
      }
    }
  }
  for (const n of (app.graph?._nodes || app.graph?.nodes || [])) {
    if (isTextOverlayNode(n)) refreshOpenButton(n);
  }
});

// Belt-and-braces: workflow-level success event. When ANY workflow run
// completes, mark every Text Overlay node as "has run". Less precise
// than the per-node executed event (which can miss us if comfyClass
// isn't set on this Vue build) but guarantees the button enables once
// the user has run any workflow that included this node.
api.addEventListener("execution_success", () => {
  for (const n of (app.graph?._nodes || app.graph?.nodes || [])) {
    if (isTextOverlayNode(n)) {
      n._textOverlayHasRun = true;
      refreshOpenButton(n);
    }
  }
});

// ── Pattern #9: graphToPrompt hook (mostly unchanged, simpler payload) ───

function buildPixNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === NODE_CLASS || n.type === NODE_CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findPixNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== NODE_CLASS) continue;
      if (!index) index = buildPixNodeIndex();
      const node = findPixNode(index, id);
      const state = node?.properties?.[STATE_PROP] || DEFAULT_STATE;

      // First-run positioning. Two pending intents resolve here when the
      // upstream image is available at submit time (Load Image case):
      //   _alignPending     - user clicked a "Position on canvas" button on
      //                        the node body before dims were known.
      //   _autoCenterPending- fresh node that has never been centered.
      // An explicit align choice wins over the default auto-center. If the
      // image isn't available yet (generative chain), Python resolves it.
      if ((state._alignPending || state._autoCenterPending) && state.text && node) {
        try {
          const img = getUpstreamImage(node);
          if (img && img.naturalWidth && img.naturalHeight) {
            const bbox = await measureTextBbox(state);
            if (state._alignPending) {
              applyAlignMode(state, state._alignPending, img.naturalWidth, img.naturalHeight, bbox);
            } else {
              state.x = Math.max(0, Math.round((img.naturalWidth - bbox.w) / 2));
              state.y = Math.max(0, Math.round((img.naturalHeight - bbox.h) / 2));
            }
            delete state._alignPending;
            delete state._autoCenterPending;
            // Sync body panel + repaint so user sees the new position
            if (node._textOverlayBodyPanel) node._textOverlayBodyPanel.setLayer(state);
            node.setDirtyCanvas?.(true, true);
          }
        } catch (e) {
          console.warn("[Text Overlay] position on submit failed", e);
        }
      }

      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify(state);
    }
  }
  return result;
};

// Resolve the upstream image wired to this node's `image` input, returning
// the HTMLImageElement on the upstream node (e.g. Load Image's preview) or
// null. Same shape as core.mjs::_tryLoadUpstreamImage.
function getUpstreamImage(node) {
  const link = node.inputs?.find((i) => i.name === "image")?.link;
  if (!link) return null;
  const graph = window.app.graph;
  let linkObj = graph.links?.[link];
  if (!linkObj && typeof graph.links?.get === "function") linkObj = graph.links.get(link);
  if (!linkObj) return null;
  const upstream = graph.getNodeById(linkObj.origin_id);
  return upstream?.imgs?.[0] || null;
}

// Measure the rendered bbox of the state's text using the same canvas-text
// math as the live editor (and the Python renderer). Returns { w, h }.
let _measureCanvas = null;
async function measureTextBbox(state) {
  const variant = await loadFontForLayer(state.font || "Roboto", state.weight || 400, !!state.italic);
  const fontStr = canvasFontString(variant, state.fontSize || 96);
  if (!_measureCanvas) {
    _measureCanvas = document.createElement("canvas");
    _measureCanvas.width = 1;
    _measureCanvas.height = 1;
  }
  const ctx = _measureCanvas.getContext("2d");
  ctx.font = fontStr;
  const lines = String(state.text ?? "").split("\n");
  const letterSpacing = state.letterSpacing || 0;
  const lineWidths = lines.map((ln) => {
    if (letterSpacing === 0) return ctx.measureText(ln).width;
    let w = 0; for (const c of ln) w += ctx.measureText(c).width;
    return w + Math.max(0, ln.length - 1) * letterSpacing;
  });
  const maxLineW = Math.max(0, ...lineWidths);
  const m = ctx.measureText("Mg");
  const ascender = m.actualBoundingBoxAscent || (state.fontSize || 96) * 0.78;
  const descender = m.actualBoundingBoxDescent || (state.fontSize || 96) * 0.22;
  const lineHeightPx = Math.round((state.fontSize || 96) * (state.lineHeight || 1.2));
  const padX = state.bgColor ? 16 : 0;
  const padY = state.bgColor ? 10 : 0;
  return {
    w: Math.ceil(maxLineW + 2 * padX),
    h: Math.ceil(ascender + descender + Math.max(0, lines.length - 1) * lineHeightPx + 2 * padY),
  };
}

// ── "Position on canvas" from the node body ──────────────────────────────
// Mirrors the editor's core.mjs::alignToCanvas so a user gets the same
// result whether they click the buttons on the node body or in the editor.

// Snap the whole text block to a canvas edge / center. Same formulas as
// core.mjs::alignToCanvas (no clamping, so right/bottom align edges even
// when the text is wider/taller than the canvas).
function applyAlignMode(s, mode, W, H, bbox) {
  switch (mode) {
    case "left":    s.x = 0; break;
    case "centerH": s.x = Math.round((W - bbox.w) / 2); break;
    case "right":   s.x = Math.round(W - bbox.w); break;
    case "top":     s.y = 0; break;
    case "centerV": s.y = Math.round((H - bbox.h) / 2); break;
    case "bottom":  s.y = Math.round(H - bbox.h); break;
  }
}

// Resolve the canvas (= upstream image) dimensions for the node body.
// Two sources: the upstream node's imgs[0] (Load Image case, instant), or
// the stashed base-image PNG the Python node writes for generative chains
// (loaded once and cached). Returns { w, h } or null when dims are unknown.
async function resolveCanvasDims(node) {
  const img = getUpstreamImage(node);
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return { w: img.naturalWidth, h: img.naturalHeight };
  }
  const url = node._textOverlayBaseImageURL;
  if (url) {
    try {
      const baseImg = await loadBaseImage(node, url);
      if (baseImg && baseImg.naturalWidth > 0) {
        return { w: baseImg.naturalWidth, h: baseImg.naturalHeight };
      }
    } catch { /* fall through to null */ }
  }
  return null;
}

// Load + cache the stashed base image so repeated align clicks don't refetch.
function loadBaseImage(node, url) {
  if (node._textOverlayBaseImageEl && node._textOverlayBaseImageEl._srcUrl === url) {
    return Promise.resolve(node._textOverlayBaseImageEl);
  }
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => { im._srcUrl = url; node._textOverlayBaseImageEl = im; resolve(im); };
    im.onerror = reject;
    im.src = url;
  });
}

async function alignOnCanvasFromBody(node, mode) {
  const state = node.properties?.[STATE_PROP];
  if (!state || !state.text) return;
  const dims = await resolveCanvasDims(node);
  if (!dims) {
    // Dimensions unknown yet (generative chain not run). Record the intent
    // and let Python resolve it on the next run (the auto-center round-trip).
    state._alignPending = mode;
    delete state._autoCenterPending; // explicit choice wins over auto-center
    node.setDirtyCanvas?.(true, true);
    showTextOverlayToast("Position will apply on the next run (image size not known yet).");
    return;
  }
  try {
    const bbox = await measureTextBbox(state);
    applyAlignMode(state, mode, dims.w, dims.h, bbox);
    delete state._alignPending;
    syncTextOverlayPanels(node, state);
  } catch (e) {
    console.warn("[Text Overlay] align-on-canvas failed", e);
  }
}

// Push state into the body panel + (if open) the editor sidebar panel and
// repaint the editor canvas, so the node body and editor stay in lockstep.
function syncTextOverlayPanels(node, state) {
  node._textOverlayBodyPanel?.setLayer(state);
  if (node._textOverlayEditor && node._textOverlayEditor.layout?.overlay?.isConnected) {
    node._textOverlayEditor.editorPanel?.setLayer?.(state);
    node._textOverlayEditor.requestRender?.();
  }
  node.setDirtyCanvas?.(true, true);
}

// Brief toast (modern toast API with a hand-rolled banner fallback for older
// ComfyUI builds, same pattern as Prompt Multi).
function showTextOverlayToast(msg) {
  const tm = app.extensionManager?.toast;
  if (tm && typeof tm.add === "function") {
    try { tm.add({ severity: "info", summary: "Text Overlay", detail: msg, life: 3500 }); return; }
    catch { /* fall through */ }
  }
  try {
    const banner = document.createElement("div");
    banner.textContent = msg;
    banner.style.cssText = "position:fixed;top:60px;right:20px;background:#1d1d1d;color:#fff;font:14px sans-serif;padding:10px 14px;border-radius:6px;border:2px solid #f66744;z-index:99999;";
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 3500);
  } catch { /* no-op */ }
}
