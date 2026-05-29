// Renderer Check Pixaroma — an on-canvas badge that shows which node
// renderer is live: Nodes 2.0 (Vue) or legacy (LiteGraph). Reads
// `LiteGraph.vueNodesMode` and refreshes on a light poll so it tracks a
// renderer switch made in Settings without needing a page reload.
//
// Built with the proven Nodes 2.0 recipe (CLAUDE.md "ComfyUI Nodes 2.0
// Migration"): a DOM widget with a UNIQUE type name + applyAdaptiveCanvasOnly,
// so the badge itself renders correctly in BOTH renderers.

import { app } from "/scripts/app.js";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";

const MIN_W = 220;
const MIN_H = 92;
const DEFAULT_W = 240;
const DEFAULT_H = 98;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pix-rc-wrap {
      width: 100%; height: 100%; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      padding: 8px; margin: 0;
    }
    .pix-rc-badge {
      width: 100%; box-sizing: border-box; text-align: center;
      padding: 14px 10px; border-radius: 8px;
      font: 700 17px 'Segoe UI', -apple-system, sans-serif;
      letter-spacing: 0.4px; color: #fff; line-height: 1.2;
      border: 2px solid transparent; user-select: none;
      transition: background 0.15s, border-color 0.15s;
    }
    .pix-rc-badge .pix-rc-sub {
      display: block; margin-top: 4px;
      font-weight: 500; font-size: 11px; letter-spacing: 0.2px; opacity: 0.9;
    }
    .pix-rc-badge.is-v2 { background: #2e7d32; border-color: #3ec371; }
    .pix-rc-badge.is-legacy { background: #364a66; border-color: #5a82c4; }
  `;
  document.head.appendChild(style);
}

app.registerExtension({
  name: "Pixaroma.RendererCheck",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaRendererCheck") return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origCreated?.apply(this, arguments);
      injectCSS();

      const wrap = document.createElement("div");
      wrap.className = "pix-rc-wrap";
      const badge = document.createElement("div");
      badge.className = "pix-rc-badge";
      wrap.appendChild(badge);

      let last = null;
      const refresh = () => {
        const v2 = !!window.LiteGraph?.vueNodesMode;
        if (v2 === last) return; // only touch the DOM when the mode flips
        last = v2;
        badge.classList.toggle("is-v2", v2);
        badge.classList.toggle("is-legacy", !v2);
        badge.innerHTML = v2
          ? `🟢 NODES 2.0<span class="pix-rc-sub">Vue renderer active</span>`
          : `⚪ LEGACY<span class="pix-rc-sub">Classic (LiteGraph) renderer</span>`;
      };
      refresh();

      const widget = this.addDOMWidget(
        "pixaroma_renderer_check",
        // UNIQUE type so Nodes 2.0 keeps OUR element (no native-widget hijack).
        "pixaroma_renderer_check",
        wrap,
        {
          getValue: () => null,
          setValue: () => {},
          getMinHeight: () => MIN_H - 16,
          serialize: false,
        }
      );
      // Adaptive canvasOnly: out of the legacy Parameters tab, but visible
      // in the Nodes 2.0 body. (CLAUDE.md Nodes 2.0 house rule.)
      applyAdaptiveCanvasOnly(widget);

      // The renderer can be toggled in Settings without a full reload, so
      // poll the flag and refresh the badge when it changes.
      this._pixRcTimer = setInterval(refresh, 600);

      // Fresh-on-canvas default size (configure() restores saved size after).
      this.size[0] = DEFAULT_W;
      this.size[1] = DEFAULT_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._pixRcTimer) {
        clearInterval(this._pixRcTimer);
        this._pixRcTimer = null;
      }
      origRemoved?.apply(this, arguments);
    };

    // Min-size self-heal (legacy renderer; harmless no-op in Nodes 2.0 where
    // onDrawForeground doesn't fire). Mirrors Show Text / UI convention #7.
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      origDraw?.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };
  },
});
