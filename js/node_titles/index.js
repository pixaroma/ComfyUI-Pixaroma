import { app } from "/scripts/app.js";
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
        "Make every node's title text auto-pick white or dark based on the node's title-bar color, so it stays readable on any color (like the group headers). Off = ComfyUI's default gray title text.",
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
    console.log("[Pixaroma.NodeTitles] setup: enabled =", state.enabled);
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
        const ink = pickInk(barColor(this));
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
  const nodes = app.graph?._nodes || [];
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
    const ink = state.enabled ? pickInk(barColor(n)) : null;
    const val = ink || ""; // "" restores the native class color
    if (h.__pixTitleInk === val) continue; // skip redundant writes
    h.style.color = val;
    h.__pixTitleInk = val;
  }
}
function installVuePoll() {
  if (_vueTimer) return;
  // Only meaningful in Nodes 2.0; the tick self-checks and is a no-op otherwise.
  _vueTimer = setInterval(() => {
    if (isVueNodes()) refreshVue();
  }, 400);
}
