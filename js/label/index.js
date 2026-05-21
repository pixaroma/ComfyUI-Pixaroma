import { app } from "/scripts/app.js";
import { allow_debug, hideJsonWidget } from "../shared/index.mjs";
import { DEFAULTS, fontStr, measureLabel } from "./render.mjs";
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
      this.badges = [];
      if (allow_debug) console.log("PixaromaLabel", this);
      return r;
    };

    // ── Configure (load from saved workflow) ─────────────
    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const r = _origCfg?.apply(this, arguments);
      setupLabel(this); // load: trust the saved node.size, do NOT re-measure
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
      const editor = new LabelEditor(this);
      editor.open();
      return true;
    };
  },
});
