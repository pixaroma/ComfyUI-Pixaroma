// Sizes Pixaroma - an editable list of exact resolutions with a Portrait /
// Landscape flip. One DOM widget (pills + gear + size list), two outputs
// (width, height). Works in BOTH renderers.
//
// Architecture mirrors Resolution Pixaroma: state on node.properties.sizesState,
// injected into the hidden SizesState input by the graphToPrompt hook below
// (Vue Compat #9). The settings panel (gear / right-click) lives in settings.mjs.

import { app } from "/scripts/app.js";
import { hideJsonWidget, applyAdaptiveCanvasOnly } from "../shared/index.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import {
  BRAND, ACCENT_SETTING, STATE_PROP, HIDDEN_INPUT, MAX_SIZES,
  readState, writeState, fmtRow, accentOf, DEFAULT_STATE,
} from "./core.mjs";
import { openSizesPanel, closeSizesPanelFor } from "./settings.mjs";

const CLASS = "PixaromaSizes";

const NODE_W = 210;
const ROW_H = 28;
const HEADER_H = 30;   // pills + gear row
const GAP = 8;         // gap between header and list
const HINT_H = 22;     // shown only when the list has one size
const PAD = 9;         // inner padding (top + bottom)
const MAX_VISIBLE = 8; // rows shown before the list scrolls
const CHROME = 46;     // legacy: title + 2 output slot rows + margins
const VUE_CHROME = 52; // Nodes 2.0: title + category chip

function widgetH(node) {
  const st = readState(node);
  const rows = Math.min(Math.max(st.sizes.length, 1), MAX_VISIBLE);
  const listH = rows * ROW_H + 2; // + top/bottom border
  const hint = st.sizes.length <= 1 ? GAP + HINT_H : 0;
  return PAD + HEADER_H + GAP + listH + hint + PAD;
}

function injectCSS() {
  if (document.getElementById("pixaroma-sizes-css")) return;
  const css = `
    .pix-sz-root { position:relative; width:100%; height:100%; box-sizing:border-box;
      background:#1d1d1d; border-radius:4px; color:#ddd;
      font-family: ui-sans-serif, system-ui, sans-serif; font-size:11px; }
    .pix-sz-inner { position:absolute; inset:0; box-sizing:border-box; padding:${PAD}px;
      display:flex; flex-direction:column; gap:${GAP}px; }
    .pix-sz-head { display:flex; align-items:stretch; gap:6px; flex:0 0 auto; }
    .pix-sz-pills { display:flex; gap:5px; flex:1; min-width:0; }
    .pix-sz-pill { flex:1; text-align:center; padding:6px 4px; border-radius:5px;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
      color:#a8a8a8; font-size:11px; cursor:pointer; user-select:none;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      transition:background .08s, border-color .08s, color .08s; }
    .pix-sz-pill:hover { border-color:var(--acc,${BRAND}); color:#ddd; }
    .pix-sz-pill.on { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-sz-gear { flex:0 0 auto; width:30px; display:flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); border-radius:5px;
      color:#bbb; font-size:14px; cursor:pointer; user-select:none; line-height:1; }
    .pix-sz-gear:hover { border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-sz-list { flex:1 1 auto; min-height:0; overflow-x:hidden; overflow-y:auto;
      background:rgba(0,0,0,0.28); border:1px solid #333; border-radius:6px; }
    .pix-sz-list::-webkit-scrollbar { width:6px; }
    .pix-sz-list::-webkit-scrollbar-thumb { background:#555; border-radius:3px; }
    .pix-sz-list::-webkit-scrollbar-track { background:transparent; }
    .pix-sz-row { box-sizing:border-box; height:${ROW_H}px; display:flex; align-items:center;
      justify-content:center; padding:0 8px; font-size:12px; color:#cfcfcf; cursor:pointer;
      font-variant-numeric:tabular-nums; user-select:none; }
    .pix-sz-row:hover { background:rgba(255,255,255,0.05); }
    .pix-sz-row.active { background:rgba(255,255,255,0.06); color:var(--acc,${BRAND}); font-weight:600; }
    .pix-sz-hint { flex:0 0 auto; text-align:center; color:#6f6f6f; font-size:11px;
      display:flex; align-items:center; justify-content:center; gap:5px; }
  `;
  const s = document.createElement("style");
  s.id = "pixaroma-sizes-css";
  s.textContent = css;
  document.head.appendChild(s);
}

function ensureRoot(node) {
  const held = node._pixSzRoot;
  if (held && held.isConnected) return held;
  // Vue/ComfyUI may have replaced the element; re-find a mounted one via the
  // widget. ComfyUI uses our div AS the widget element (adds h-full w-full), so
  // the element itself may carry .pix-sz-root - check self before descendants.
  const w = (node.widgets || []).find((x) => x.name === "sizes_ui");
  const el = w?.element;
  const elRoot = el?.classList?.contains?.("pix-sz-root")
    ? el
    : el?.querySelector?.(".pix-sz-root");
  if (elRoot) { node._pixSzRoot = elRoot; return elRoot; }
  // Fall back to the held root even if it is not connected yet (initial paint):
  // populate it now and it shows the moment the element mounts. Bailing here was
  // the empty-body bug - the first render ran before the element was in the DOM.
  return held || null;
}

function render(node) {
  const root = ensureRoot(node);
  if (!root) return;
  let inner = root.querySelector(".pix-sz-inner");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "pix-sz-inner";
    root.appendChild(inner);
  }
  node._pixSzInner = inner;

  const st = readState(node);
  inner.style.setProperty("--acc", accentOf(node));
  inner.innerHTML = "";

  // ── header: Portrait / Landscape pills + gear ──────────────────────────
  const head = document.createElement("div");
  head.className = "pix-sz-head";
  const pills = document.createElement("div");
  pills.className = "pix-sz-pills";
  for (const [o, label] of [["portrait", "Portrait"], ["landscape", "Landscape"]]) {
    const p = document.createElement("div");
    p.className = "pix-sz-pill" + (st.orientation === o ? " on" : "");
    p.dataset.o = o;
    p.textContent = label;
    p.title = o === "portrait" ? "Taller than wide" : "Wider than tall";
    pills.appendChild(p);
  }
  const gear = document.createElement("div");
  gear.className = "pix-sz-gear";
  gear.textContent = "⚙";
  gear.title = "Sizes settings — add, remove, reorder, snap";
  head.append(pills, gear);

  // ── size list ──────────────────────────────────────────────────────────
  const list = document.createElement("div");
  list.className = "pix-sz-list";
  st.sizes.forEach((pair, i) => {
    const row = document.createElement("div");
    row.className = "pix-sz-row" + (i === st.selected ? " active" : "");
    row.dataset.idx = String(i);
    row.textContent = fmtRow(pair, st);
    list.appendChild(row);
  });

  inner.append(head, list);

  // ── first-use hint (only while a single size exists) ────────────────────
  if (st.sizes.length <= 1) {
    const hint = document.createElement("div");
    hint.className = "pix-sz-hint";
    hint.textContent = "⚙ open settings to add more sizes";
    inner.appendChild(hint);
  }
}

function refitNode(node) {
  const targetH = isVueNodes() ? widgetH(node) + VUE_CHROME : widgetH(node) + CHROME;
  if (!node.size || Math.abs(node.size[0] - NODE_W) > 0.5 || Math.abs(node.size[1] - targetH) > 0.5) {
    if (node.setSize) node.setSize([NODE_W, targetH]);
    else node.size = [NODE_W, targetH];
  }
}

// A single change to selection / orientation persists + repaints + refits.
function applyAndRefresh(node, patch) {
  writeState(node, { ...readState(node), ...patch });
  render(node);
  refitNode(node);
  node.setDirtyCanvas?.(true, true);
}

function onClick(node, e) {
  if (e.target.closest(".pix-sz-gear")) {
    e.stopPropagation();
    openSizesPanel(node, () => { render(node); refitNode(node); node.setDirtyCanvas?.(true, true); });
    return;
  }
  const pill = e.target.closest(".pix-sz-pill");
  if (pill) {
    e.stopPropagation();
    applyAndRefresh(node, { orientation: pill.dataset.o });
    return;
  }
  const row = e.target.closest(".pix-sz-row");
  if (row && row.dataset.idx != null) {
    e.stopPropagation();
    applyAndRefresh(node, { selected: parseInt(row.dataset.idx, 10) });
  }
}

function setupNode(node) {
  hideJsonWidget(node.widgets, HIDDEN_INPUT); // no-op (Python input is hidden)
  node.resizable = false;

  const root = document.createElement("div");
  root.className = "pix-sz-root";
  const inner = document.createElement("div");
  inner.className = "pix-sz-inner";
  root.appendChild(inner);

  const widget = node.addDOMWidget("sizes_ui", "custom", root, {
    getValue: () => readState(node),
    setValue: () => {},
    getMinHeight: () => widgetH(node),
    getMaxHeight: () => widgetH(node),
    margin: 4,
    serialize: false,
  });
  widget.computeLayoutSize = () => ({ minHeight: widgetH(node), minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);

  node._pixSzRoot = root;
  node._pixSzInner = inner;

  // ONE listener on the persistent widget wrapper (root lives inside it, so
  // clicks bubble up). Attaching to both the wrapper AND root would double-fire.
  const clickTarget = widget.element || root;
  clickTarget.addEventListener("click", (e) => onClick(node, e));

  // Defer the first populate past configure() so a restored workflow renders
  // its saved sizes on the first paint, not the default (Vue Compat #8).
  queueMicrotask(() => { render(node); refitNode(node); });
}

app.registerExtension({
  name: "Pixaroma.Sizes",

  // Plain hex field (ComfyUI's settings dialog has no colour input); the pretty
  // picker lives in the node's own settings panel, which also writes this.
  settings: [
    {
      id: ACCENT_SETTING,
      name: "Default sizes accent colour (hex)",
      type: "text",
      defaultValue: BRAND,
      tooltip: "The colour new Sizes nodes highlight with, e.g. #f66744. Each node can override it in its settings.",
      category: ["👑 Pixaroma", "Sizes"],
      // Repaint every node that FOLLOWS the default (no per-node accent) so a
      // changed default is visible immediately, not at the next interaction.
      onChange: () => {
        try {
          for (const n of app.graph?._nodes || []) {
            if (n?.comfyClass !== CLASS) continue;
            let accent = null;
            try { const st = n.properties?.[STATE_PROP]; accent = st ? JSON.parse(st).accent : null; } catch {}
            if (!accent) render(n);
          }
        } catch {}
      },
    },
  ],

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixSzPatched) return; // hot-reload guard
    nodeType.prototype._pixSzPatched = true;

    injectCSS();

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      if (this._pixSzRoot) { render(this); refitNode(this); }
      return r;
    };

    // Locked to content — re-clamp any resize attempt back to the computed size.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const targetH = isVueNodes() ? widgetH(this) + VUE_CHROME : widgetH(this) + CHROME;
      this.size[0] = NODE_W;
      this.size[1] = targetH;
      if (_origResize) return _origResize.call(this, size);
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSizesPanelFor(this);
      return _origRemoved?.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS) return;
    setupNode(node);
  },

  // Right-click menu (new context-menu API, Vue Compat #20) — works in both renderers.
  getNodeMenuItems(node) {
    if (node?.comfyClass !== CLASS) return [];
    return [
      {
        content: "⚙ Sizes settings",
        callback: () => openSizesPanel(node, () => { render(node); refitNode(node); node.setDirtyCanvas?.(true, true); }),
      },
      {
        content: "⇄ Flip orientation",
        callback: () => {
          const cur = readState(node);
          applyAndRefresh(node, { orientation: cur.orientation === "landscape" ? "portrait" : "landscape" });
        },
      },
    ];
  },
});

// ── graphToPrompt: inject the per-node state ────────────────────────────────
// INJECT ONLY - never prune here (Export (API) serialises this same output).
function buildIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findNode(index, id) {
  const s = String(id);
  if (index.has(s)) return index.get(s);
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildIndex();
        const node = findNode(index, id);
        const state = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT] = state;
      }
    }
  } catch (e) {
    console.warn("[Sizes Pixaroma] could not inject state:", (e && e.message) || e);
  }
  return result;
};

registerNodeHelp(CLASS, {
  title: "Sizes Pixaroma",
  tagline: "Your own list of favourite resolutions, with a one-click orientation flip.",
  sections: [
    {
      heading: "What it does",
      body:
        "Keep the exact width x height sizes you use in one list, pick one, and it outputs width and height. " +
        "Wire those into an Empty Latent Image (or anywhere a width and height are needed).",
    },
    {
      heading: "Portrait and Landscape",
      body:
        "The two buttons flip the chosen size between tall and wide. Add a size like 1024 x 1536 once and " +
        "reuse it in either orientation - you do not need a separate entry for each. Square sizes look the same both ways.",
    },
    {
      heading: "Settings",
      body:
        "Click the gear (or right-click the node) to open the settings. There you can add a new size, remove or " +
        "reorder sizes by dragging, load a set of common sizes in one click, pick the highlight colour, and snap " +
        "width and height to a multiple of 8, 16, 32, or 64 so the numbers stay friendly for the VAE. Snapping is off by default.",
    },
  ],
  footer: "A fresh node starts with one size (1024 x 1024). Add up to " + MAX_SIZES + " per node.",
});
