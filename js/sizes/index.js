// Sizes Pixaroma - an editable list of exact resolutions with a Portrait /
// Landscape flip. One DOM widget (pills + gear + size list), two outputs
// (width, height). Works in BOTH renderers.
//
// Architecture mirrors Resolution Pixaroma: state on node.properties.sizesState,
// injected into the hidden SizesState input by the graphToPrompt hook below
// (Vue Compat #9). The settings panel (gear / right-click) lives in settings.mjs.

import { app } from "/scripts/app.js";
import { hideJsonWidget, applyAdaptiveCanvasOnly, installCanvasZoomPassthrough } from "../shared/index.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings } from "../shared/node_settings.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import {
  BRAND, STATE_PROP, HIDDEN_INPUT, MAX_SIZES,
  readState, writeState, fmtRow, accentOf, DEFAULT_STATE, isStarredPair,
} from "./core.mjs";
import { openSizesPanel, closeSizesPanelFor } from "./settings.mjs";

const CLASS = "PixaromaSizes";

const NODE_W = 240;
const ROW_H = 30;       // list row height (CSS + height math kept in lockstep)
const HEADER_H = 28;    // chevron + pills + gear row (measured rendered height)
const GAP = 8;          // gap between header and list
const HINT_H = 16;      // one-line hint, shown only when the list has one size
const PAD = 9;          // inner padding (top + bottom)
const LIST_PAD = 2;     // the list's top + bottom border
const MAX_VISIBLE = 14; // auto-fit shows up to this many rows; beyond it scrolls
const CHROME = 46;      // legacy fallback: title + 2 output slot rows + margins
const VUE_CHROME = 52;  // Nodes 2.0 fallback: title + category chip

// The height the node WANTS in order to show all its content. Collapsed = the
// header + the single selected row; expanded = every size (capped, then scrolls).
function contentWidgetH(node) {
  const st = readState(node);
  const rows = st.collapsed ? 1 : Math.min(Math.max(st.sizes.length, 1), MAX_VISIBLE);
  const listH = rows * ROW_H + LIST_PAD; // rows + border/sub-pixel overhead
  const hint = (!st.collapsed && st.sizes.length <= 1) ? GAP + HINT_H : 0;
  return PAD + HEADER_H + GAP + listH + hint + PAD;
}
function fitNodeH(node) {
  // Delegate the chrome (title + the two output slot rows + margins) to
  // LiteGraph instead of guessing it: computeSize sums the slot rows + the DOM
  // widget's getMinHeight (== contentWidgetH), so the node is exactly tall enough
  // to show every row with no scrollbar. Fall back to a constant estimate only if
  // computeSize is unavailable.
  try {
    const cs = node.computeSize?.();
    if (cs && cs[1] > 0) return Math.round(cs[1]);
  } catch (_e) { /* fall through */ }
  return contentWidgetH(node) + (isVueNodes() ? VUE_CHROME : CHROME);
}

function injectCSS() {
  if (document.getElementById("pixaroma-sizes-css")) return;
  const css = `
    .pix-sz-root { width:100%; box-sizing:border-box;
      background:#1d1d1d; border-radius:4px; color:#ddd;
      font-family: ui-sans-serif, system-ui, sans-serif; font-size:11px; }
    /* Plain block flow (NOT flex, NOT absolute): each child takes its natural
       height so the list can never be squeezed, the node hugs the content with
       no bottom gap, and every row shows with no scrollbar. The list caps +
       scrolls only past MAX_VISIBLE rows. */
    .pix-sz-inner { box-sizing:border-box; padding:${PAD}px; }
    .pix-sz-head { display:flex; align-items:stretch; gap:6px; margin-bottom:${GAP}px; }
    .pix-sz-chevron { flex:0 0 auto; width:22px; display:flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); border-radius:5px;
      color:#bbb; font-size:11px; cursor:pointer; user-select:none; line-height:1; }
    .pix-sz-chevron:hover { border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-sz-pills { display:flex; gap:5px; flex:1; min-width:0; }
    .pix-sz-pill { flex:1; text-align:center; padding:6px 4px; border-radius:5px;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
      color:#a8a8a8; font-size:11px; cursor:pointer; user-select:none;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      transition:background .08s, border-color .08s, color .08s; }
    .pix-sz-pill:hover { border-color:var(--acc,${BRAND}); color:#ddd; }
    .pix-sz-pill.on { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; }
    /* The bundled gear SVG as a mask, NOT the ⚙ emoji (convention #28): an emoji
       is drawn by the OS, so it is a different shape and baseline on Windows,
       Mac and Linux and arrives in colour on some of them. This way it matches
       the gear on the node selection toolbar exactly. */
    .pix-sz-gear { flex:0 0 auto; width:30px; display:flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); border-radius:5px;
      cursor:pointer; user-select:none; line-height:0; }
    .pix-sz-gear::before { content:""; display:block; width:14px; height:14px; background:#bbb;
      -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
      mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat; }
    .pix-sz-gear:hover { border-color:var(--acc,${BRAND}); }
    .pix-sz-gear:hover::before { background:#fff; }
    /* The one-line hint points AT that button, so it uses the same glyph - an
       emoji beside a masked SVG gear reads as two different icons. */
    .pix-sz-hint-gear { display:inline-block; width:11px; height:11px; vertical-align:-1px;
      background:#6f6f6f;
      -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
      mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat; }
    .pix-sz-list { overflow:visible;
      background:rgba(0,0,0,0.28); border:1px solid #333; border-radius:6px; }
    .pix-sz-list.scroll { max-height:${MAX_VISIBLE * ROW_H + 2}px; overflow-x:hidden; overflow-y:auto; }
    .pix-sz-list::-webkit-scrollbar { width:6px; }
    .pix-sz-list::-webkit-scrollbar-thumb { background:#555; border-radius:3px; }
    .pix-sz-list::-webkit-scrollbar-track { background:transparent; }
    .pix-sz-row { box-sizing:border-box; position:relative; height:${ROW_H}px; display:flex; align-items:center;
      justify-content:center; padding:0 8px; font-size:12px; color:#cfcfcf; cursor:pointer;
      font-variant-numeric:tabular-nums; user-select:none; }
    .pix-sz-row:hover { background:rgba(255,255,255,0.05); }
    .pix-sz-row.active { background:rgba(255,255,255,0.06); color:var(--acc,${BRAND}); font-weight:600; }
    /* Recommended marker. ABSOLUTE on purpose: the row centres its text, so an
       in-flow star would shove the numbers off-centre on starred rows only and
       the column would no longer line up. Out of flow it cannot shift anything,
       and the row is a FIXED ${ROW_H}px so it cannot affect the height maths
       either. Filled star SVG as a mask, never a ★ glyph or an emoji
       (convention #28) - those differ per OS. */
    .pix-sz-star { position:absolute; right:7px; top:50%; margin-top:-5.5px;
      width:11px; height:11px; pointer-events:none; background:var(--acc,${BRAND});
      -webkit-mask:url("${pixAsset("icons/ui/star.svg")}") center/contain no-repeat;
      mask:url("${pixAsset("icons/ui/star.svg")}") center/contain no-repeat; }
    .pix-sz-hint { margin-top:${GAP}px; text-align:center; color:#6f6f6f; font-size:11px;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
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

  // ── header: fold chevron + Portrait / Landscape pills + gear ───────────
  const head = document.createElement("div");
  head.className = "pix-sz-head";

  const chevron = document.createElement("div");
  chevron.className = "pix-sz-chevron";
  chevron.textContent = st.collapsed ? "▸" : "▾";
  chevron.title = st.collapsed ? "Expand — show all sizes" : "Collapse — show only the selected size";

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
  gear.className = "pix-sz-gear"; // glyph comes from the ::before SVG mask
  gear.title = "Sizes settings — add, remove, reorder, snap";
  head.append(chevron, pills, gear);

  // ── size list (collapsed = only the selected row; scroll only past the cap) ──
  const list = document.createElement("div");
  list.className = "pix-sz-list" + (!st.collapsed && st.sizes.length > MAX_VISIBLE ? " scroll" : "");
  const indices = st.collapsed
    ? [st.sizes[st.selected] ? st.selected : 0]
    : st.sizes.map((_, i) => i);
  for (const i of indices) {
    const row = document.createElement("div");
    row.className = "pix-sz-row" + (i === st.selected ? " active" : "");
    row.dataset.idx = String(i);
    row.textContent = fmtRow(st.sizes[i], st);
    // textContent FIRST (it wipes children), then the star on top.
    if (isStarredPair(st, st.sizes[i])) {
      const star = document.createElement("span");
      star.className = "pix-sz-star";
      star.title = "Recommended";
      row.appendChild(star);
    }
    list.appendChild(row);
  }

  inner.append(head, list);

  // ── first-use hint (only expanded, while a single size exists) ─────────
  if (!st.collapsed && st.sizes.length <= 1) {
    const hint = document.createElement("div");
    hint.className = "pix-sz-hint";
    hint.textContent = "⚙ open settings to add more sizes";
    inner.appendChild(hint);
  }

}

// Auto-fit the node to show all its content. USER ACTIONS ONLY (add / remove /
// collapse) - never on the load path, or a saved size gets rewritten and a clean
// workflow opens "modified" (Vue Compat #18). Preserves the current width so a
// manual widen sticks.
function fitToContent(node) {
  if (isGraphLoading()) return;
  const w = Math.max(node.size?.[0] || NODE_W, NODE_W); // keep the header usable
  const h = fitNodeH(node);
  if (node.setSize) node.setSize([w, h]);
  else node.size = [w, h];
}

// Persist + repaint for a change that does NOT alter the node height (select,
// orientation) - leaves a manual resize alone.
function applyAndRefresh(node, patch) {
  writeState(node, { ...readState(node), ...patch });
  render(node);
  node.setDirtyCanvas?.(true, true);
}

function toggleCollapsed(node) {
  writeState(node, { ...readState(node), collapsed: !readState(node).collapsed });
  render(node);
  fitToContent(node);
  node.setDirtyCanvas?.(true, true);
}

// Settings-panel callback: repaint, and re-fit only when the change was
// STRUCTURAL (a size added / removed / common loaded) so a manual resize
// survives snap / accent / reorder tweaks.
function onPanelChange(node) {
  return (info) => {
    render(node);
    if (info?.structural) fitToContent(node);
    node.setDirtyCanvas?.(true, true);
  };
}

function onClick(node, e) {
  if (e.target.closest(".pix-sz-chevron")) {
    e.stopPropagation();
    toggleCollapsed(node);
    return;
  }
  if (e.target.closest(".pix-sz-gear")) {
    e.stopPropagation();
    openSizesPanel(node, onPanelChange(node));
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

  // Locked-to-content DOM widget: getMinHeight == getMaxHeight == the height that
  // shows all sizes (or one row when collapsed). Deterministic from the size
  // COUNT, so it never dirties a saved workflow (Vue Compat #18) and never leaves
  // a scrollbar for a normal list. The node auto-grows / shrinks on add / remove
  // / collapse via fitToContent below.
  const widget = node.addDOMWidget("sizes_ui", "custom", root, {
    getValue: () => readState(node),
    setValue: () => {},
    getMinHeight: () => contentWidgetH(node),
    getMaxHeight: () => contentWidgetH(node),
    margin: 4,
    serialize: false,
  });
  widget.computeLayoutSize = () => ({ minHeight: contentWidgetH(node), minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);
  // Wheel over the panel must still zoom the canvas (Classic; no-ops in Nodes 2.0).
  installCanvasZoomPassthrough(root);

  // Fresh default size (configure() overrides this for a loaded node, convention #9).
  node.size = [NODE_W, fitNodeH(node)];

  node._pixSzRoot = root;
  node._pixSzInner = inner;

  // ONE listener on the persistent widget wrapper (root lives inside it, so
  // clicks bubble up). Attaching to both the wrapper AND root would double-fire.
  const clickTarget = widget.element || root;
  clickTarget.addEventListener("click", (e) => onClick(node, e));

  // Defer the first populate past configure() so a restored workflow renders
  // its saved sizes on the first paint, not the default (Vue Compat #8). On a
  // fresh drop this fits to content; on the load path fitToContent bails (the
  // saved size is already restored).
  queueMicrotask(() => { render(node); fitToContent(node); });
}

app.registerExtension({
  name: "Pixaroma.Sizes",
  // No Settings-panel row: this node's colour lives in its OWN panel (the
  // gear / right-click entry). It used to be registered here with
  // defaultValue BRAND, which made getSettingValue ALWAYS return the orange -
  // so the node-type default permanently outranked the master accent and
  // "Every Pixaroma node" could never reach this node. Unregistered, the key
  // is written ONLY by an explicit "New ... nodes" press, so stored == chosen.

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixSzPatched) return; // hot-reload guard
    nodeType.prototype._pixSzPatched = true;

    injectCSS();

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      // Render + re-fit to the restored state. contentWidgetH is deterministic
      // from the size count, so this matches the saved node.size and never dirties
      // a clean workflow (Vue Compat #18).
      if (this._pixSzRoot) { render(this); fitToContent(this); }
      return r;
    };

    // Locked to content - re-clamp any resize attempt back to the computed size.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      this.size[0] = Math.max(this.size[0] || NODE_W, NODE_W);
      this.size[1] = fitNodeH(this);
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
    const st = readState(node);
    return [
      { content: "⚙ Sizes settings", callback: () => openSizesPanel(node, onPanelChange(node)) },
      {
        content: "⇄ Flip orientation",
        callback: () => applyAndRefresh(node, {
          orientation: readState(node).orientation === "landscape" ? "portrait" : "landscape",
        }),
      },
      { content: st.collapsed ? "▾ Expand" : "▸ Collapse", callback: () => toggleCollapsed(node) },
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

const _origGraphToPrompt_fn = app.graphToPrompt;
const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
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
    {
      heading: "Marking the recommended sizes",
      body:
        "Click the star beside a size in settings and it gets a star on the node too. Handy when a list holds every " +
        "size a workflow accepts but only some of them suit the model you are running: star those, and you can see " +
        "at a glance which to pick.\n\n" +
        "A star is a reminder only - it changes nothing about what the node sends out, and you can still choose any " +
        "size in the list. Stars follow the size itself, so reordering the list, flipping between portrait and " +
        "landscape, or removing a size and adding it back all keep them.",
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["The fold arrow", "Collapses the list down to just the chosen size, or opens it again."],
        ["Portrait and Landscape", "Shows the chosen size tall or wide, swapping which number is the width."],
        ["The gear", "Opens the settings panel, where you add, remove, reorder and recolour your sizes."],
        ["A size in the list", "Click any one to make it the size this node sends out."],
        ["Add, in settings", "Type a width and height, then add it to your list."],
        ["The drag handles, in settings", "Drag a size up or down to reorder the list."],
        ["The star, in settings", "Marks a size as recommended. It then shows a star on the node. Click again to unmark."],
        ["Snap, in settings", "Rounds every size to a multiple of 8, 16, 32 or 64."],
        ["Add common sizes, in settings", "Adds a set of popular square sizes from 512 up to 2048 in one click."],
      ],
    },
  ],
  footer: "A fresh node starts with one size (1024 x 1024). Add up to " + MAX_SIZES + " per node.",
});

// The gear in the node selection toolbar opens the same panel the right-click
// entry does. ownMenuItem: this node already adds its own menu line.
registerNodeSettings(CLASS, {
  title: "Sizes",
  // paints from its OWN --acc var - run its own render (see Control Panel)
  onChange: (node) => render(node),
  ownMenuItem: true,
  open: (node) => openSizesPanel(node, onPanelChange(node)),
});
