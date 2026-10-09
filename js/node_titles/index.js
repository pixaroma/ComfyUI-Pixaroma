import { app } from "../../../scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";

// =============================================================================
// Adaptive node-title color - the node title text auto-picks white or dark from
// the node's TITLE-BAR color brightness, so it stays readable on any color
// (mirrors the Group Pixaroma header ink). Default ON; toggle in Settings under
// 👑 Pixaroma > Node titles.
//
// Two renderers, two paths (verified from the bundle):
//   CLASSIC  - the title is canvas-painted by LGraphNode.prototype.drawTitleText,
//              which uses `this.constructor.title_text_color || default_title_color`
//              (default_title_color = LGraphCanvas.node_title_color, the gray
//              ~#999). We WRAP it and feed our computed ink as default_title_color.
//              (When a node is SELECTED, LiteGraph uses NODE_SELECTED_TITLE_COLOR
//              instead - we leave that bright selected color as-is.)
//   NODES 2.0 - the title is a DOM element in NodeHeader.vue (class
//              `text-node-component-header`) and node.color drives the header
//              background. The ink depends on each node's own color (CSS can't
//              compute luminance), so we set the header element's text color per
//              node on a light poll; the title text inherits it while the chevron
//              + badges keep their own color classes.
// =============================================================================

const SETTING = "Pixaroma.NodeTitles.AdaptiveColor";
const state = { enabled: true };

// ── Ink: white on a dark bar, dark on a light bar. null = unknown color format
// (rgb()/named) -> leave the native title color alone.
function parseHex(c) {
  if (typeof c !== "string") return null;
  let h = c.trim();
  if (h[0] !== "#") return null;
  h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function pickInk(color) {
  const c = parseHex(color);
  if (!c) return null;
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return lum > 150 ? "#1a1a1a" : "#ffffff";
}
// Any CSS colour (renderingColor is an hsla() string) -> "#rrggbb", through a
// canvas's own colour parser; cached, since it runs for every title every frame.
let _nctx = null;
const _hexCache = new Map();
function cssToHex(c) {
  if (typeof c !== "string" || !c) return null;
  if (_hexCache.has(c)) return _hexCache.get(c);
  if (!_nctx) _nctx = document.createElement("canvas").getContext("2d");
  _nctx.fillStyle = "#000000";
  _nctx.fillStyle = c;
  const v = _nctx.fillStyle;
  const hex = v[0] === "#" ? v : rgbToHex(v);
  if (_hexCache.size > 500) _hexCache.clear();
  _hexCache.set(c, hex);
  return hex;
}
// A node's effective title-bar color: its own color, else LiteGraph's dark
// default (so an uncolored node gets a white title instead of gray).
function barColor(node) {
  return node.color || window.LiteGraph?.NODE_DEFAULT_COLOR || "#353535";
}

app.registerExtension({
  name: "Pixaroma.NodeTitles",
  settings: [
    {
      id: SETTING,
      name: "Adaptive node title color",
      type: "boolean",
      defaultValue: true,
      category: ["👑 Pixaroma", "Node titles"],
      tooltip:
        "Make every node's title text auto-pick white or dark based on the node's title-bar color, so it stays readable on any color (like the group headers). In Nodes 2.0 the 'Show advanced inputs' tab under a colored node follows it too. Off = ComfyUI's default gray text.",
      onChange: (v) => {
        state.enabled = !!v;
        refreshVue();
        app.canvas?.setDirty?.(true, true);
      },
    },
  ],
  setup() {
    const s = app.ui?.settings;
    if (s) {
      const v = s.getSettingValue(SETTING);
      state.enabled = v === undefined ? true : !!v;
    }
    installClassic();
    installVuePoll();
  },
});

// ── Classic: wrap LGraphNode.drawTitleText so the title text uses our ink. ────
let _classicInstalled = false;
let _origDrawTitleText = null;
function installClassic() {
  if (_classicInstalled) return;
  const N = window.LiteGraph?.LGraphNode || window.LGraphNode;
  if (!N?.prototype || typeof N.prototype.drawTitleText !== "function") {
    console.warn("[Pixaroma.NodeTitles] LGraphNode.drawTitleText not found - classic title color disabled");
    return;
  }
  _origDrawTitleText = N.prototype.drawTitleText;
  N.prototype.drawTitleText = function (ctx, opts) {
    if (state.enabled) {
      try {
        // The light palette paints the bar LIGHTENED (renderingColor, by
        // LiteGraph.nodeLightness): the ink must come from that colour, or an
        // orange node got a white title on a white bar. Dark palette: unchanged.
        const lit = window.LiteGraph?.nodeLightness ? cssToHex(this.renderingColor) : null;
        const ink = pickInk(lit || barColor(this));
        if (ink) opts = Object.assign({}, opts, { default_title_color: ink });
      } catch (_e) { /* fall through to native */ }
    }
    return _origDrawTitleText.call(this, ctx, opts);
  };
  _classicInstalled = true;
}

// ── Nodes 2.0: per-node header text color, applied on a light poll. ───────────
let _vueTimer = null;
function refreshVue() {
  if (!isVueNodes()) return;
  // the graph ON SCREEN: inside a subgraph app.graph is still the root, so the
  // inner nodes were never found and kept ComfyUI's gray (2026-10-09)
  const nodes = (app.canvas?.graph || app.graph)?._nodes || [];
  const byId = new Map();
  for (const n of nodes) byId.set(String(n.id), n);
  const headers = document.querySelectorAll(".lg-node-header");
  for (const h of headers) {
    let id = h.getAttribute("data-testid");
    id = id ? id.replace(/^node-header-/, "") : null;
    if (!id) {
      const host = h.closest("[data-node-id]");
      id = host ? host.getAttribute("data-node-id") : null;
    }
    if (id == null) continue;
    const n = byId.get(String(id));
    if (!n) continue;
    setInk(h, "--pix-title-ink", "data-pix-ink", "__pixTitleInk", state.enabled ? pickInk(paintedBar(h) || barColor(n)) : null);
    // The footer tab under the body ("Show advanced inputs", a subgraph's "Enter")
    // is painted in the node colour like the header, with a fixed gray text
    // (frontend 1.53, NodeFooter.vue): unreadable on orange.
    const root = h.closest(".lg-node");
    if (root) setInk(root, "--pix-foot-ink", "data-pix-foot-ink", "__pixFootInk", state.enabled ? footInk(root) : null);
  }
}
// The ink follows the colour the tab is PAINTED in, read from its inline style.
// ComfyUI sets one only on a node with its own colour (an uncoloured node keeps
// its surface + gray, left alone) and LIGHTENS it in the light palette
// (applyLightThemeColor), so the raw node.color gave white text on a near-white
// tab there.
function footInk(root) {
  const tab = root.querySelector('[data-testid="advanced-inputs-button"], [data-testid="subgraph-enter-button"]');
  return tab ? pickInk(rgbToHex(tab.style.backgroundColor)) : null;
}
// The header's PAINTED colour: Nodes 2.0 paints the card around the header with
// applyLightThemeColor(node.color) as an inline background, lightened in the light
// palette, where a white title worked out from the raw colour vanished (white on
// white). An uncoloured node has none: null, and the caller keeps barColor.
function paintedBar(h) {
  for (let el = h; el; el = el.parentElement) {
    const hex = rgbToHex(el.style.backgroundColor);
    if (hex) return hex;
    if (el.classList.contains("lg-node")) break;
  }
  return null;
}
function rgbToHex(c) {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c || "");
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
  return "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
}
function setInk(el, cssVar, marker, key, ink) {
  const val = ink || "";
  // skip redundant writes (and re-apply if a re-render dropped the var)
  if (el[key] === val && el.style.getPropertyValue(cssVar) === val) return;
  if (ink) {
    el.style.setProperty(cssVar, ink);
    el.setAttribute(marker, "");
  } else {
    el.style.removeProperty(cssVar);
    el.removeAttribute(marker);
  }
  el[key] = val;
}
// CSS that forces the title text to our per-node ink, beating ComfyUI's title
// color class (`.text-node-component-header` -> var(--fg-color), a light color)
// AND the selected-state color (white, which was invisible on light title bars).
// The per-node --pix-title-ink var + data-pix-ink marker are set on each header
// in refreshVue; `*` also covers EditableText's inner text element.
function injectVueCSS() {
  if (document.getElementById("pix-node-titles-css")) return;
  const el = document.createElement("style");
  el.id = "pix-node-titles-css";
  el.textContent =
    '.lg-node-header[data-pix-ink] [data-testid="node-title"],' +
    '.lg-node-header[data-pix-ink] [data-testid="node-title"] *' +
    "{color:var(--pix-title-ink)!important;}" +
    '.lg-node[data-pix-foot-ink] [data-testid="advanced-inputs-button"],' +
    '.lg-node[data-pix-foot-ink] [data-testid="advanced-inputs-button"] *,' +
    '.lg-node[data-pix-foot-ink] [data-testid="subgraph-enter-button"],' +
    '.lg-node[data-pix-foot-ink] [data-testid="subgraph-enter-button"] *' +
    "{color:var(--pix-foot-ink)!important;}";
  document.head.appendChild(el);
}
function installVuePoll() {
  if (_vueTimer) return;
  injectVueCSS();
  // Only meaningful in Nodes 2.0; the tick self-checks and is a no-op otherwise.
  _vueTimer = setInterval(() => {
    if (isVueNodes()) refreshVue();
  }, 400);
}
