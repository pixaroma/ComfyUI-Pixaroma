// Outpaint Stitch Pixaroma - the slider face. Two recess-style sliders (Feather,
// Color Match) matching Sliders Pixaroma's look, bound to the node's native INT
// widgets. Renders in BOTH renderers (DOM widget). See js/sliders/ui.mjs for the
// original of this look; the CSS values are copied verbatim so the pack reads as
// one design (a future refactor could promote it to a shared slider helper).

import { app } from "/scripts/app.js";
import { widgetOf, accentOf } from "./core.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";

export const ROW_H = 23;    // one slider row (matches Sliders Pixaroma)
export const ROW_GAP = 6;
export const PAD = 5;       // top+bottom padding inside the root
export const MIN_W = 210;
export const DEFAULT_W = 274;

const WIDGET_TYPE = "pixaroma_ops_sliders";   // namespaced (Nodes 2.0 dispatch)
const WIDGET_NAME = "pixops_sliders";

// Each slider drives one native INT widget. min/max mirror node_outpaint_stitch.py.
const SLIDERS = [
  { name: "feather", label: "Feather", min: 0, max: 1024 },
  { name: "color_match", label: "Color Match", min: 0, max: 200 },
];

export function bodyHeight() {
  return SLIDERS.length * ROW_H + (SLIDERS.length - 1) * ROW_GAP + PAD * 2;
}

export function injectCSS() {
  if (document.getElementById("pix-ops-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ops-css";
  s.textContent = `
    .pix-ops-root { width:100%; box-sizing:border-box; display:flex; flex-direction:column;
      gap:${ROW_GAP}px; padding:2px 0 ${PAD}px; }

    /* Heights must be DEFINITE, not 100% - everything inside is absolutely
       positioned, so a min-content grid track (Nodes 2.0) would collapse the row
       to ~2px (Sliders Pattern #2). */
    .pix-ops-row { width:100%; height:${ROW_H}px; min-height:${ROW_H}px; box-sizing:border-box; }

    /* The EMPTY part is a translucent DENT (darkens whatever colour the node is),
       not a fixed dark slab, so a recoloured node still looks right. */
    .pix-ops-sl {
      position:relative; width:100%; height:${ROW_H}px; border-radius:5px; overflow:hidden;
      background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.14);
      cursor:ew-resize; box-sizing:border-box; user-select:none;
    }
    .pix-ops-sl:hover { border-color:var(--acc,#f66744); }

    /* The FILL is SOLID accent (a translucent orange over dark mixes to brown). */
    .pix-ops-fill { position:absolute; left:0; top:0; bottom:0; width:0; background:var(--acc,#f66744); }

    /* Two clipped copies of the line: the ink flips to white where the fill has
       passed under it, so the label stays readable at any value. */
    .pix-ops-lay {
      position:absolute; inset:0; display:flex; align-items:center; gap:6px; padding:0 8px;
      pointer-events:none; font:11.5px 'Segoe UI',-apple-system,sans-serif;
    }
    .pix-ops-lay .nm { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-ops-lay .nu { flex:none; font-weight:600; font-variant-numeric:tabular-nums; }
    .pix-ops-base { clip-path:inset(0 0 0 var(--p,0%)); }
    .pix-ops-over { clip-path:inset(0 calc(100% - var(--p,0%)) 0 0); }
    .pix-ops-base .nm { color:rgba(255,255,255,0.72); }
    .pix-ops-base .nu { color:var(--acc,#f66744); }
    .pix-ops-over .nm, .pix-ops-over .nu { color:#fff; }

    /* Type an exact value (double-click the row). */
    .pix-ops-edit {
      position:absolute; inset:0; width:100%; height:100%; box-sizing:border-box; display:none;
      background:#1d1d1d; border:1px solid var(--acc,#f66744); border-radius:5px; outline:none;
      color:#e8e8e8; font:11.5px 'Segoe UI',sans-serif; text-align:right; padding:0 8px;
      font-variant-numeric:tabular-nums;
    }
    .pix-ops-sl.editing .pix-ops-edit { display:block; }

    /* Nodes 2.0 only: each widget row reserves a 12px widget-input dot column.
       Our sliders are not widget-socket inputs, so collapse it - otherwise the
       rows are indented 12px from the left. */
    .lg-node:has(.pix-ops-root) .lg-node-widget > div:first-child {
      width:0 !important; min-width:0 !important; overflow:hidden !important;
    }
  `;
  document.head.appendChild(s);
}

function hideNativeWidget(w) {
  if (!w) return;
  // Keep the widget as the value store, just stop it rendering: hidden + a
  // zero computeSize collapse the legacy row; canvasOnly keeps it out of the
  // Nodes 2.0 body AND the Parameters tab. Value still serializes + prompts.
  w.hidden = true;
  w.computeSize = () => [0, -4];
  if (!w.options) w.options = {};
  w.options.canvasOnly = true;
}

function makeSliderRow(node, cfg) {
  const row = document.createElement("div");
  row.className = "pix-ops-row";
  const sl = document.createElement("div");
  sl.className = "pix-ops-sl";
  const fill = document.createElement("div");
  fill.className = "pix-ops-fill";
  const base = document.createElement("div");
  base.className = "pix-ops-lay pix-ops-base";
  base.innerHTML = '<span class="nm"></span><span class="nu"></span>';
  const over = document.createElement("div");
  over.className = "pix-ops-lay pix-ops-over";
  over.innerHTML = '<span class="nm"></span><span class="nu"></span>';
  const edit = document.createElement("input");
  edit.className = "pix-ops-edit";
  edit.type = "text";
  edit.spellcheck = false;
  sl.append(fill, base, over, edit);
  row.appendChild(sl);
  row._cfg = cfg;
  row._sl = sl;

  const getW = () => widgetOf(node, cfg.name);
  const setVal = (v, live) => {
    const w = getW();
    if (!w) return;
    let n = Math.round(Number(v));
    if (!Number.isFinite(n)) n = cfg.min;
    n = Math.min(cfg.max, Math.max(cfg.min, n));
    if (w.value !== n) {
      w.value = n;
      try { w.callback?.(n, app?.canvas, node); } catch {}
    }
    paintRoot(node);
    if (!live) node.graph?.setDirtyCanvas?.(true, true);
  };

  // Drag maps the cursor across the track; Shift = quarter-speed relative nudge.
  let startX = 0, startV = 0;
  const valFromX = (clientX, shift) => {
    const r = sl.getBoundingClientRect();
    if (shift) {
      const dx = (clientX - startX) / Math.max(1, r.width);
      return startV + dx * (cfg.max - cfg.min) * 0.25;
    }
    const p = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    return cfg.min + p * (cfg.max - cfg.min);
  };

  sl.addEventListener("pointerdown", (e) => {
    if (sl.classList.contains("editing") || e.button !== 0) return;
    e.stopPropagation();   // never start a node drag
    e.preventDefault();
    const w = getW();
    if (!w) return;
    startX = e.clientX;
    startV = Number(w.value) || 0;
    sl.setPointerCapture(e.pointerId);
    setVal(valFromX(e.clientX, e.shiftKey), true);
    const move = (ev) => setVal(valFromX(ev.clientX, ev.shiftKey), true);
    const up = () => {
      sl.removeEventListener("pointermove", move);
      sl.removeEventListener("pointerup", up);
      sl.removeEventListener("pointercancel", up);
      setVal(getW()?.value, false);
    };
    sl.addEventListener("pointermove", move);
    sl.addEventListener("pointerup", up);
    sl.addEventListener("pointercancel", up);
  });

  sl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const w = getW();
    if (!w) return;
    edit.value = String(Math.round(Number(w.value) || 0));
    sl.classList.add("editing");
    edit.focus();
    edit.select();
  });
  const closeEdit = (apply) => {
    if (!sl.classList.contains("editing")) return;
    if (apply) {
      const v = parseFloat(edit.value);
      if (Number.isFinite(v)) setVal(v, false);
    }
    sl.classList.remove("editing");
    paintRoot(node);
  };
  edit.addEventListener("keydown", (e) => {
    e.stopPropagation();   // keep typing out of the canvas shortcuts
    if (e.key === "Enter") { e.preventDefault(); closeEdit(true); }
    else if (e.key === "Escape") { e.preventDefault(); closeEdit(false); }
  });
  edit.addEventListener("blur", () => closeEdit(true));
  edit.addEventListener("pointerdown", (e) => e.stopPropagation());
  return row;
}

// Repaint both rows from the native widget values (cheap; called every drag frame).
export function paintRoot(node) {
  const root = node._pixOpsRoot;
  if (!root) return;
  const acc = accentOf(node);
  root.style.setProperty("--acc", acc);
  // Pull the block up under the input slots. LEGACY insets a DOM widget by a
  // 10px margin (BaseDOMWidgetImpl.DEFAULT_MARGIN), which reads as a gap between
  // the slots and the sliders; Nodes 2.0 has no such margin, so pull only there.
  root.style.marginTop = window.LiteGraph?.vueNodesMode ? "0px" : "-9px";
  for (const row of root.querySelectorAll(".pix-ops-row")) {
    const cfg = row._cfg;
    const w = widgetOf(node, cfg.name);
    let val = Math.round(Number(w?.value));
    if (!Number.isFinite(val)) val = cfg.min;
    val = Math.min(cfg.max, Math.max(cfg.min, val));
    const span = (cfg.max - cfg.min) || 1;
    const p = Math.min(100, Math.max(0, ((val - cfg.min) / span) * 100));
    const sl = row._sl;
    sl.style.setProperty("--p", p + "%");
    sl.style.setProperty("--acc", acc);
    row.querySelector(".pix-ops-fill").style.width = p + "%";
    row.querySelectorAll(".pix-ops-lay").forEach((lay) => {
      lay.querySelector(".nm").textContent = cfg.label;
      lay.querySelector(".nu").textContent = String(val);
    });
    sl.title = `${cfg.label}  ${cfg.min} - ${cfg.max}   (drag, Shift for fine, double-click to type)`;
  }
}

// Hide the native widgets, build the slider root, add it as ONE DOM widget.
// Idempotent: on a second call (onConfigure) it just repaints.
export function installSliders(node) {
  if (node._pixOpsRoot) { paintRoot(node); return; }
  for (const cfg of SLIDERS) hideNativeWidget(widgetOf(node, cfg.name));

  const root = document.createElement("div");
  root.className = "pix-ops-root";
  for (const cfg of SLIDERS) root.appendChild(makeSliderRow(node, cfg));
  node._pixOpsRoot = root;

  const w = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => bodyHeight(),
  });
  w.serialize = false;
  w.computeSize = () => [node.size?.[0] || DEFAULT_W, bodyHeight()];   // fixed height, legacy
  w.computeLayoutSize = undefined;                                     // min-content row, Nodes 2.0
  applyAdaptiveCanvasOnly(w);
  node._pixOpsWidget = w;
  node._pixOpsFloorOff = installResizeFloor(root, () => bodyHeight());
  paintRoot(node);
}

export function uninstallSliders(node) {
  try { node._pixOpsFloorOff?.(); } catch {}
  node._pixOpsFloorOff = null;
}
