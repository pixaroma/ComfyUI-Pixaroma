import { app } from "/scripts/app.js";
import { allow_debug, hideJsonWidget } from "../shared/index.mjs";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { DEFAULTS, fontStr, measureLabel, applyLabelToDom, injectVueLabelCSS } from "./render.mjs";
import { parseCfg, LabelEditor } from "./core.mjs";

// ─── Setup helpers ───────────────────────────────────────────
const NO_TITLE = (typeof LiteGraph !== "undefined" && LiteGraph.NO_TITLE) || 1;

// Size the label box to its text. Must NOT run on the LOAD path: measureLabel
// can come back a few px different than when the workflow was saved (canvas
// metrics / timing), and rewriting node.size on load falsely flags the
// workflow "modified" on a plain open (Vue Compat #18 - same class as the
// Text Overlay dirty-on-load bug, observed here as size 210 -> 193). So this
// runs ONLY for fresh creation and explicit user edits (editor Save); on load
// we trust the saved node.size.
function resizeLabelToContent(node) {
  const m = measureLabel(node._labelCfg || DEFAULTS);
  if (node.size) {
    node.size[0] = Math.max(m.w, 60);
    node.size[1] = Math.max(m.h, 30);
  }
}

function setupLabel(node, withResize = false) {
  try {
    hideJsonWidget(node.widgets, "label_json");
    node._labelCfg = parseCfg(node);
    node.color = "transparent";
    node.bgcolor = "transparent";
    node.flags = node.flags || {};
    node.flags.no_title = true;
    // Remove input slots so no connections can be made (only when some exist,
    // so a saved label with none doesn't get a needless write on load).
    if (node.inputs && node.inputs.length) node.inputs.length = 0;
    if (withResize) resizeLabelToContent(node);
  } catch (err) {
    console.error("[Pixaroma Label] setupLabel error:", err);
  }
}

// Nodes 2.0 only: render the label as a crisp-HTML DOM widget in the node body
// (onDrawForeground is skipped in 2.0). Double-click opens the same editor.
// Legacy is untouched and keeps the canvas paint.
function setupVueLabel(node) {
  injectVueLabelCSS();
  const div = document.createElement("div");
  div.className = "pix-lbl-vue";
  node._pixLblVueEl = div;

  const render = () => applyLabelToDom(div, node._labelCfg || DEFAULTS);
  node._pixLblRender = render;
  render();

  // Resize the node to the ACTUAL rendered text. measureLabel uses canvas
  // measureText, which comes out a few px narrower than the real HTML text, so
  // the canvas-sized node clipped the text. Measure the laid-out element next
  // frame and snap the node to it. Called from saveCfg after an edit (a genuine
  // user action) - NOT on load, so it never dirties a saved workflow.
  node._pixLblFit = () => {
    requestAnimationFrame(() => {
      const el = node._pixLblVueEl;
      if (!el || !el.isConnected) return;
      const nw = Math.max(Math.ceil(el.scrollWidth), 60);
      const nh = Math.max(Math.ceil(el.scrollHeight), 30);
      if (Math.abs((node.size?.[0] || 0) - nw) > 1 || Math.abs((node.size?.[1] || 0) - nh) > 1) {
        if (typeof node.setSize === "function") node.setSize([nw, nh]);
        else if (node.size) { node.size[0] = nw; node.size[1] = nh; }
        node.graph?.setDirtyCanvas?.(true, true);
      }
    });
  };

  const w = node.addDOMWidget("label_dom", "pixaroma_label", div, {
    serialize: false,
    getMinHeight: () => Math.max(measureLabel(node._labelCfg || DEFAULTS).h, 16),
  });
  applyAdaptiveCanvasOnly(w);
  // No DOM listener on the div: it's pointer-events:none so placement/drag work.
  // Editing opens via onDblClick (legacy double-click) + the right-click "Edit
  // Label" menu (reliable in both renderers - see openLabelEditor below).
}

// Open the editor for a Label node, guarded so a second trigger doesn't stack
// two overlays. Shared by onDblClick (legacy) and the right-click menu (Vue).
function openLabelEditor(node) {
  if (node._pixLblEditorOpen) return;
  node._pixLblEditorOpen = true;
  const ed = new LabelEditor(node);
  const origClose = ed.close.bind(ed);
  ed.close = () => { node._pixLblEditorOpen = false; origClose(); };
  ed.open();
}

// ─── Extension Registration ──────────────────────────────────
app.registerExtension({
  name: "Pixaroma.Label",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaLabel") return;

    nodeType.title_mode = NO_TITLE;

    // ── Creation ─────────────────────────────────────────
    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _origCreated?.apply(this, arguments);
      setupLabel(this, true); // fresh node: size it to the default text
      if (isVueNodes()) setupVueLabel(this); // Nodes 2.0: crisp-HTML body widget
      this.badges = [];
      if (allow_debug) console.log("PixaromaLabel", this);
      return r;
    };

    // ── Configure (load from saved workflow) ─────────────
    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const r = _origCfg?.apply(this, arguments);
      setupLabel(this); // load: trust the saved node.size, do NOT re-measure
      if (isVueNodes()) this._pixLblRender?.(); // re-render the DOM label from loaded cfg
      return r;
    };

    // ── Minimum size = the measured text size ────────────
    // Without this, LiteGraph clamps every node to its default minimum width
    // (~210px), so a label whose text is narrower than that gets a 210-wide
    // box while the colored pill is only drawn as wide as the text - the empty
    // gap users saw on short labels. Opening + saving couldn't fix it: the
    // editor's saveCfg sets node.size to the measured width, but the next
    // interaction re-clamped it back up to the 210 default min. Returning the
    // measured size as computeSize lowers that floor so short labels stay tight
    // AND a re-save now sticks.
    //
    // This is a MINIMUM only (LiteGraph uses computeSize as a floor, never to
    // force-resize on load), so a larger saved size is preserved - we never
    // shrink a saved label on load, which keeps the dirty-on-load behavior
    // unchanged (Vue Compat #18) and leaves the "oversized background label"
    // use case intact. Cached by cfg signature so it's cheap per frame.
    nodeType.prototype.computeSize = function (out) {
      const c = this._labelCfg || DEFAULTS;
      const key = `${c.text}|${c.fontSize}|${c.fontFamily}|${c.fontWeight}|${c.padding}|${c.lineHeight}`;
      let cache = this._labelSizeCache;
      if (!cache || cache.key !== key) {
        const m = measureLabel(c);
        cache = this._labelSizeCache = { key, w: Math.max(m.w, 1), h: Math.max(m.h, 1) };
      }
      if (out) { out[0] = cache.w; out[1] = cache.h; return out; }
      return [cache.w, cache.h];
    };

    // ── Drawing ──────────────────────────────────────────
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      // Nodes 2.0 renders the label via the crisp-HTML DOM widget, not the
      // canvas. setupVueLabel + setupLabel already handle transparency + slot
      // stripping there, so skip the canvas paint entirely.
      if (isVueNodes()) return;
      this.color = "transparent";
      this.bgcolor = "transparent";

      const c = this._labelCfg || DEFAULTS;
      const m = measureLabel(c);
      // Do NOT write this.size here. Rewriting node.size every frame from the
      // live measurement was rewriting the saved size on load and dirtying the
      // workflow (Vue Compat #18). node.size is set on creation + editor save;
      // the label is drawn at the measured m below regardless.

      ctx.save();
      ctx.globalAlpha = c.opacity;

      if (c.backgroundColor !== "transparent") {
        ctx.fillStyle = c.backgroundColor;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(0, 0, m.w, m.h, c.borderRadius);
        else ctx.rect(0, 0, m.w, m.h);
        ctx.fill();
      }

      ctx.font = fontStr(c);
      ctx.fillStyle = c.fontColor;
      ctx.textBaseline = "top";
      ctx.textAlign = c.textAlign;
      let tx = c.padding;
      if (c.textAlign === "center") tx = m.w / 2;
      else if (c.textAlign === "right") tx = m.w - c.padding;
      for (let i = 0; i < m.lines.length; i++) {
        ctx.fillText(m.lines[i], tx, c.padding + i * m.lh);
      }
      ctx.restore();

      // Remove input slots every frame (ComfyUI may re-add them)
      if (this.inputs && this.inputs.length) this.inputs.length = 0;
    };

    // ── Double-click → open editor ───────────────────────
    const _origDblClick = nodeType.prototype.onDblClick;
    nodeType.prototype.onDblClick = function (e, pos) {
      openLabelEditor(this);
      return true;
    };
  },
});

// ── Right-click menu: "Edit Label" ──────────────────────────────
// A reliable edit path in BOTH renderers (double-click via onDblClick is not
// guaranteed to fire in Nodes 2.0, and the label body is pointer-events:none so
// it can't host its own dblclick). Patches LGraphCanvas.getNodeMenuOptions once
// (same pattern as Mute Switch); the _patched flag guards extension hot-reload.
if (typeof LGraphCanvas !== "undefined"
    && LGraphCanvas?.prototype?.getNodeMenuOptions
    && !LGraphCanvas.prototype._pixLblMenuPatched) {
  LGraphCanvas.prototype._pixLblMenuPatched = true;
  const _origGetNodeMenu = LGraphCanvas.prototype.getNodeMenuOptions;
  LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
    const options = _origGetNodeMenu.apply(this, arguments);
    if (node && (node.type === "PixaromaLabel" || node.comfyClass === "PixaromaLabel")) {
      options.push(null, {
        content: "✏️ Edit Label",
        callback: () => openLabelEditor(node),
      });
    }
    return options;
  };
}

// ── Double-click to edit, restored for Nodes 2.0 ────────────────
// The label body is pointer-events:none (so the node can be placed/dragged), so
// LiteGraph's onDblClick never fires for it in Nodes 2.0. Listen at the document
// level and hit-test against the label ELEMENT's on-screen rectangle (the
// visible label), NOT the node's internal bounds - node.size can be narrower
// than the rendered text, so a bounds hit-test would miss the overflowing part.
// Gated to Nodes 2.0; legacy keeps the onDblClick hook.
if (typeof window !== "undefined" && !window._pixLblDblWired) {
  window._pixLblDblWired = true;
  document.addEventListener("dblclick", (e) => {
    if (!isVueNodes()) return;
    const g = app?.canvas?.graph;
    if (!g) return;
    const x = e.clientX, y = e.clientY;
    for (const n of (g._nodes || [])) {
      if (n.comfyClass !== "PixaromaLabel" && n.type !== "PixaromaLabel") continue;
      const el = n._pixLblVueEl;
      if (!el || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        openLabelEditor(n);
        break;
      }
    }
  }, true);
}
