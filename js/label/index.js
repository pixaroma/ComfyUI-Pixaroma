import { app } from "/scripts/app.js";
import { allow_debug, hideJsonWidget } from "../shared/index.mjs";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
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
    // Fully transparent, but in a format ComfyUI's color parser accepts — the CSS
    // keyword "transparent" isn't recognised (only #hex / rgb(a) / hsl(a)) and logs
    // an "Unsupported color format" warning on every canvas paint.
    node.color = "rgba(0,0,0,0)";
    node.bgcolor = "rgba(0,0,0,0)";
    node.flags = node.flags || {};
    node.flags.no_title = true;
    // Title-less, self-sizing node: it snaps to its text (resizeLabelToContent /
    // computeSize), so a manual resize is meaningless. In Nodes 2.0 the grips are
    // hidden via CSS; in Legacy, disable the resize handle outright so a
    // corner-drag can't stretch the node into an empty black box (the body fill
    // showing past the small text pill). resizable is NOT serialized, so this
    // never dirties a saved workflow (Vue Compat #18).
    node.resizable = false;
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
      // Never resize during a workflow load - the saved node.size is trusted
      // (resizing on load would falsely flag the workflow modified, Vue Compat
      // #18). Only fresh creation + genuine edits (saveCfg) resize.
      if (isGraphLoading()) return;
      const el = node._pixLblVueEl;
      if (!el || !el.isConnected) return;
      const nw = Math.max(Math.ceil(el.scrollWidth), 30);
      const nh = Math.max(Math.ceil(el.scrollHeight), 20);
      if (Math.abs((node.size?.[0] || 0) - nw) > 1 || Math.abs((node.size?.[1] || 0) - nh) > 1) {
        // Write node.size DIRECTLY, not via setSize: the frontend's resize path
        // clamps width to a hardcoded 225px minimum (Math.max(width, 225)), which
        // would block shrinking a short label below 225. A direct write sets the
        // --node-width var the renderer reads, and the CSS above lifts the 225
        // min-width floor so it actually renders narrow.
        if (node.size) { node.size[0] = nw; node.size[1] = nh; }
        node.graph?.setDirtyCanvas?.(true, true);
      }
    });
  };

  const w = node.addDOMWidget("label_dom", "pixaroma_label", div, {
    serialize: false,
    getMinHeight: () => Math.max(measureLabel(node._labelCfg || DEFAULTS).h, 16),
  });
  applyAdaptiveCanvasOnly(w);
  // Snap the node to the real rendered label on a fresh drop too (not just on
  // edit), so the selection box hugs it. Gated by isGraphLoading inside _pixLblFit.
  node._pixLblFit();
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

// Legacy only: in current ComfyUI the node BODY paints our transparent bgcolor
// ("rgba(0,0,0,0)") as opaque BLACK (the color util drops the alpha), so the node
// frame shows as black corners behind a large-radius pill, and a fully transparent
// label becomes a solid black box. We can't make the body transparent, so for the
// duration of a Label's drawNode call we either: (opaque pill) paint the body to
// MATCH the pill - same colour + same corner radius - so the body IS the pill and
// the corners fall back to the grid; or (transparent label) skip the body fill
// entirely so the grid shows through and only the text remains. Restored after.
// No-op in Nodes 2.0, where drawNode skips body paint.
function installLabelShadowHook() {
  if (window._pixLblShadowWrapped) return;
  const proto = window.LGraphCanvas?.prototype;
  if (typeof proto?.drawNode !== "function") {
    console.warn("[Pixaroma.Label] LGraphCanvas.drawNode not found - shadow suppression disabled");
    return;
  }
  window._pixLblShadowWrapped = true;
  const orig = proto.drawNode;
  proto.drawNode = function (node, ctx) {
    if (ctx && node && (node.comfyClass === "PixaromaLabel" || node.type === "PixaromaLabel")) {
      const cfg = node._labelCfg || DEFAULTS;
      const opaque = cfg.backgroundColor && cfg.backgroundColor !== "transparent";
      if (opaque) {
        // Opaque pill: paint the node body to MATCH the pill - same colour + same
        // corner radius (ROUND_RADIUS, clamped to half the node) - so the frame stops
        // showing as black corners; the corners outside that radius fall back to the
        // grid. The label's onDrawForeground draws the pill + text on top. Restored.
        const maxR = Math.floor(Math.min(node.size?.[0] || 0, node.size?.[1] || 0) / 2);
        const sBg = node.bgcolor, sCol = node.color, sR = window.LiteGraph?.ROUND_RADIUS;
        node.bgcolor = cfg.backgroundColor;
        node.color = cfg.backgroundColor;
        if (window.LiteGraph) {
          window.LiteGraph.ROUND_RADIUS = Math.max(1, Math.min(Math.round(cfg.borderRadius || 0), maxR || 1));
        }
        try { return orig.apply(this, arguments); }
        finally {
          node.bgcolor = sBg; node.color = sCol;
          if (window.LiteGraph) window.LiteGraph.ROUND_RADIUS = sR;
        }
      } else {
        // Transparent label: we can't make the body transparent (it renders black),
        // so SKIP the body fill - the grid shows through fully. There is no pill to
        // draw in this mode, and the text uses fillText (not fill), so only the
        // unwanted body rectangle is suppressed. ctx.fill is restored in finally.
        const origFill = ctx.fill;
        ctx.fill = function () {};
        try { return orig.apply(this, arguments); }
        finally { ctx.fill = origFill; }
      }
    }
    return orig.apply(this, arguments);
  };
}

// ─── Extension Registration ──────────────────────────────────
app.registerExtension({
  name: "Pixaroma.Label",
  setup() { installLabelShadowHook(); },

  // "Edit Label" in the node right-click menu — new context-menu API (replaces the
  // deprecated getNodeMenuOptions monkey-patch). A reliable edit path in both
  // renderers (the label body is pointer-events:none, so its own dblclick can't fire
  // in Nodes 2.0; a document-level dblclick listener below covers that separately).
  getNodeMenuItems(node) {
    if (node && (node.type === "PixaromaLabel" || node.comfyClass === "PixaromaLabel")) {
      return [null, { content: "✏️ Edit Label", callback: () => openLabelEditor(node) }];
    }
    return [];
  },

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
      this.color = "rgba(0,0,0,0)";       // parser-safe transparent (not the "transparent" keyword)
      this.bgcolor = "rgba(0,0,0,0)";

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

// ("Edit Label" in the right-click menu is now the getNodeMenuItems hook on the
// extension above — no getNodeMenuOptions monkey-patch.)

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
