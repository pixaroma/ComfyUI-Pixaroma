// Sliders Pixaroma - the node face (one DOM row widget per slider) and the
// output-dot alignment that puts each slider's dot ON its own row.
//
// ── Why one widget per row ────────────────────────────────────────────────
// DOM widgets render in BOTH renderers, so a single row implementation serves
// legacy and Nodes 2.0. One widget per slider (rather than one list widget) is
// what lets each output dot line up with its row:
//
//   LEGACY    LiteGraph honours a hard-coded `output.pos` (getConnectionPos
//             returns node.pos + slot.pos verbatim), so alignOutputsLegacy()
//             parks each dot at its widget's Y. Outputs with a pos are also
//             skipped by the auto-stacker (_defaultVerticalOutputs), so they do
//             not double up in the top-right column.
//
//   NODES 2.0 There is NO official way to move an output (unlike inputs, which
//             have the widget-socket model - see js/switch/vue_list.mjs). So we
//             NUDGE: the slots block is pulled out of the flow and the output
//             column is translated down onto the first row. This is cosmetic
//             only - if a future ComfyUI update defeats it, the dots simply
//             return to the top-right corner and the node keeps working.

import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { readState, accentOf, clampValue, decimalsOf } from "./core.mjs";

export const ROW_H = 23;    // height of one slider row
export const ROW_GAP = 6;   // gap between rows (matches the Vue widgets grid gap-y-1 + our own)
export const ADD_H = 21;    // the "+ Add slider" strip
export const MIN_W = 190;
export const DEFAULT_W = 274;

const ROW_TYPE = "pixaroma_slider_row";
const ROW_NAME = (idx1) => `pixsld_row_${idx1}`;
const ADD_NAME = "pixsld_add";

export function injectCSS() {
  if (document.getElementById("pix-sld-css")) return;
  const s = document.createElement("style");
  s.id = "pix-sld-css";
  s.textContent = `
    /* Heights must be DEFINITE, not 100%. Everything inside the slider is
       absolutely positioned, so its min-content height is zero - and in Nodes
       2.0 the widget row is a min-content grid track, which then collapses the
       row to nothing (measured: a 2px row). Legacy hides this because it sets
       an explicit height on the element. So: fixed px, both renderers. */
    .pix-sld-row { width:100%; height:${ROW_H}px; min-height:${ROW_H}px; box-sizing:border-box; }

    /* The slider itself. The EMPTY part is a translucent dent - it darkens
       whatever colour the node body is, instead of stamping a fixed dark slab
       on it, so a recoloured node still looks right (node UI convention #1). */
    .pix-sld-sl {
      position:relative; width:100%; height:${ROW_H}px; border-radius:5px; overflow:hidden;
      background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.14);
      cursor:ew-resize; box-sizing:border-box; user-select:none;
    }
    .pix-sld-sl:hover { border-color:var(--acc,#f66744); }

    /* The FILL is solid: a translucent orange over a dark field mixes to brown. */
    .pix-sld-fill { position:absolute; left:0; top:0; bottom:0; width:0; background:var(--acc,#f66744); }

    /* Two clipped copies of the same line: the ink flips to white where the
       fill has passed under it, so the text stays readable at any value. */
    .pix-sld-lay {
      position:absolute; inset:0; display:flex; align-items:center; gap:6px; padding:0 8px;
      pointer-events:none; font:11.5px 'Segoe UI',-apple-system,sans-serif;
    }
    .pix-sld-lay .nm { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-sld-lay .nu { flex:none; font-weight:600; font-variant-numeric:tabular-nums; }
    .pix-sld-base { clip-path:inset(0 0 0 var(--p,0%)); }
    .pix-sld-over { clip-path:inset(0 calc(100% - var(--p,0%)) 0 0); }
    .pix-sld-base .nm { color:rgba(255,255,255,0.72); }
    .pix-sld-base .nu { color:var(--acc,#f66744); }
    .pix-sld-over .nm, .pix-sld-over .nu { color:#fff; }

    /* Type an exact value (double-click the row). */
    .pix-sld-edit {
      position:absolute; inset:0; width:100%; height:100%; box-sizing:border-box; display:none;
      background:#1d1d1d; border:1px solid var(--acc,#f66744); border-radius:5px; outline:none;
      color:#e8e8e8; font:11.5px 'Segoe UI',sans-serif; text-align:right; padding:0 8px;
      font-variant-numeric:tabular-nums;
    }
    .pix-sld-sl.editing .pix-sld-edit { display:block; }

    .pix-sld-add {
      width:100%; height:${ADD_H}px; min-height:${ADD_H}px; box-sizing:border-box; display:flex; align-items:center;
      justify-content:center; border:1px dashed rgba(255,255,255,0.18); border-radius:6px;
      color:rgba(255,255,255,0.45); font:11.5px 'Segoe UI',sans-serif; cursor:pointer; user-select:none;
    }
    .pix-sld-add:hover { border-color:var(--acc,#f66744); color:var(--acc,#f66744); }
    .pix-sld-add.full { opacity:.4; cursor:default; border-style:solid; }
    .pix-sld-add.full:hover { border-color:rgba(255,255,255,0.18); color:rgba(255,255,255,0.45); }

    /* ── Nodes 2.0 only ────────────────────────────────────────────────────
       Every widget row reserves a 12px column for a widget-input dot. This node
       has no inputs, so collapse it - otherwise every row is indented by 12px. */
    .lg-node:has(.pix-sld-row) .lg-node-widget > div:first-child {
      width:0 !important; min-width:0 !important; overflow:hidden !important;
    }
    /* The output slot must draw no label (the row already shows the name) and
       must not swallow pointer events over the row - only its dot may. */
    .lg-node:has(.pix-sld-row) .lg-slot--output { padding-left:0 !important; pointer-events:none; }
    .lg-node:has(.pix-sld-row) .lg-slot--output > div:first-child { display:none !important; }
    .lg-node:has(.pix-sld-row) .lg-slot--output [data-testid="slot-connection-dot"] { pointer-events:auto; }
  `;
  document.head.appendChild(s);
}

// ── Row widgets ────────────────────────────────────────────────────────────

function makeRowEl(node, index) {
  const row = document.createElement("div");
  row.className = "pix-sld-row";

  const sl = document.createElement("div");
  sl.className = "pix-sld-sl";

  const fill = document.createElement("div");
  fill.className = "pix-sld-fill";

  const base = document.createElement("div");
  base.className = "pix-sld-lay pix-sld-base";
  base.innerHTML = '<span class="nm"></span><span class="nu"></span>';

  const over = document.createElement("div");
  over.className = "pix-sld-lay pix-sld-over";
  over.innerHTML = '<span class="nm"></span><span class="nu"></span>';

  const edit = document.createElement("input");
  edit.className = "pix-sld-edit";
  edit.type = "text";
  edit.spellcheck = false;

  sl.append(fill, base, over, edit);
  row.appendChild(sl);

  const slider = () => readState(node).sliders[index];

  const commit = (v, live) => {
    const s = slider();
    if (!s) return;
    s.value = clampValue(s, v);
    paintRow(node, index);
    if (!live) node.graph?.setDirtyCanvas?.(true, true);
  };

  // Drag. Plain drag maps the cursor across the track; holding Shift switches to
  // a quarter-speed relative nudge for fine work.
  let startX = 0, startV = 0;
  const valueFromX = (clientX, shift) => {
    const s = slider();
    if (!s) return 0;
    const r = sl.getBoundingClientRect();
    const min = Number(s.min), max = Number(s.max);
    if (shift) {
      const dx = (clientX - startX) / Math.max(1, r.width);
      return startV + dx * (max - min) * 0.25;
    }
    const p = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    return min + p * (max - min);
  };

  sl.addEventListener("pointerdown", (e) => {
    if (sl.classList.contains("editing")) return;
    if (e.button !== 0) return;
    e.stopPropagation();   // never start a node drag
    e.preventDefault();
    const s = slider();
    if (!s) return;
    startX = e.clientX;
    startV = Number(s.value);
    sl.setPointerCapture(e.pointerId);
    commit(valueFromX(e.clientX, e.shiftKey), true);
    const move = (ev) => commit(valueFromX(ev.clientX, ev.shiftKey), true);
    const up = () => {
      sl.removeEventListener("pointermove", move);
      sl.removeEventListener("pointerup", up);
      sl.removeEventListener("pointercancel", up);
      commit(slider()?.value, false);
    };
    sl.addEventListener("pointermove", move);
    sl.addEventListener("pointerup", up);
    sl.addEventListener("pointercancel", up);
  });

  sl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const s = slider();
    if (!s) return;
    edit.value = String(s.value);
    sl.classList.add("editing");
    edit.focus();
    edit.select();
  });

  const closeEdit = (apply) => {
    if (!sl.classList.contains("editing")) return;
    if (apply) {
      const v = parseFloat(edit.value);
      if (Number.isFinite(v)) commit(v, false);
    }
    sl.classList.remove("editing");
    paintRow(node, index);
  };
  edit.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keep typing out of the canvas shortcuts
    if (e.key === "Enter") { e.preventDefault(); closeEdit(true); }
    else if (e.key === "Escape") { e.preventDefault(); closeEdit(false); }
  });
  edit.addEventListener("blur", () => closeEdit(true));
  edit.addEventListener("pointerdown", (e) => e.stopPropagation());

  return row;
}

// Repaint one row from state (cheap: called on every drag frame).
export function paintRow(node, index) {
  const w = node._pixSldRows?.[index];
  const el = w?.element;
  const s = readState(node).sliders[index];
  if (!el || !s) return;

  const min = Number(s.min), max = Number(s.max);
  const span = (max - min) || 1;
  const p = Math.min(100, Math.max(0, ((Number(s.value) - min) / span) * 100));
  const dec = decimalsOf(s);
  const txt = Number(s.value).toFixed(dec);

  const sl = el.querySelector(".pix-sld-sl");
  sl.style.setProperty("--p", p + "%");
  sl.style.setProperty("--acc", accentOf(node));
  el.querySelector(".pix-sld-fill").style.width = p + "%";
  el.querySelectorAll(".pix-sld-lay").forEach((lay) => {
    lay.querySelector(".nm").textContent = s.name || `Value ${index + 1}`;
    lay.querySelector(".nu").textContent = txt;
  });
  sl.title = `${s.name || ""}  ${min} – ${max}   (drag, Shift for fine, double-click to type)`;
}

// Keep exactly one row widget per slider, plus the "+ Add slider" strip last.
export function syncRowWidgets(node, onAdd) {
  const st = readState(node);
  const rows = node._pixSldRows || (node._pixSldRows = []);

  while (rows.length > st.sliders.length) {
    const w = rows.pop();
    const i = node.widgets ? node.widgets.indexOf(w) : -1;
    if (i >= 0) node.widgets.splice(i, 1);
    w.onRemove?.();
  }

  while (rows.length < st.sliders.length) {
    const index = rows.length;
    const el = makeRowEl(node, index);
    const w = node.addDOMWidget(ROW_NAME(index + 1), ROW_TYPE, el, {
      serialize: false,                 // keep it out of the API prompt
      getMinHeight: () => ROW_H,
    });
    w.serialize = false;                // and out of the saved workflow
    w.computeSize = () => [node.size[0], ROW_H];   // fixed height in legacy
    w.computeLayoutSize = undefined;              // min-content row in Nodes 2.0
    applyAdaptiveCanvasOnly(w);
    rows.push(w);
  }

  // The add strip always sits last.
  if (!node._pixSldAdd) {
    const el = document.createElement("div");
    el.className = "pix-sld-add";
    el.textContent = "+ Add slider";
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => { e.stopPropagation(); onAdd?.(); });
    const w = node.addDOMWidget(ADD_NAME, ROW_TYPE, el, {
      serialize: false,
      getMinHeight: () => ADD_H,
    });
    w.serialize = false;
    w.computeSize = () => [node.size[0], ADD_H];
    w.computeLayoutSize = undefined;
    applyAdaptiveCanvasOnly(w);
    node._pixSldAdd = w;
  } else if (node.widgets) {
    const i = node.widgets.indexOf(node._pixSldAdd);
    if (i >= 0 && i !== node.widgets.length - 1) {
      node.widgets.splice(i, 1);
      node.widgets.push(node._pixSldAdd);
    }
  }
}

export function renderAll(node) {
  const st = readState(node);
  for (let i = 0; i < (node._pixSldRows?.length || 0); i++) paintRow(node, i);
  const addEl = node._pixSldAdd?.element;
  if (addEl) {
    const full = st.sliders.length >= 16;
    addEl.classList.toggle("full", full);
    addEl.textContent = full ? "16 sliders max" : "+ Add slider";
    addEl.style.setProperty("--acc", accentOf(node));
  }
  scheduleAlign(node);
}

// The rows are not laid out yet on the frame a slider is added (or the node is
// first built), so measuring right away yields a stale offset that nothing ever
// corrects. Run once now for the common case, then again once layout settles.
export function scheduleAlign(node) {
  alignOutputs(node);
  requestAnimationFrame(() => {
    alignOutputs(node);
    setTimeout(() => alignOutputs(node), 120);
  });
}

// ── Output-dot alignment ───────────────────────────────────────────────────

// LEGACY: park each output at its widget's Y. LiteGraph reads slot.pos verbatim
// (getConnectionPos) and skips positioned outputs in the auto-stacker.
export function alignOutputsLegacy(node) {
  const rows = node._pixSldRows || [];
  if (!node.outputs || !rows.length) return;
  const half = (window.LiteGraph?.NODE_SLOT_HEIGHT || 20) * 0.5;
  for (let i = 0; i < node.outputs.length && i < rows.length; i++) {
    const y = rows[i]?.y;
    if (!Number.isFinite(y)) continue;
    const pos = node.outputs[i].pos;
    const nx = node.size[0];
    const ny = y + ROW_H * 0.5;
    if (!pos || pos[0] !== nx || Math.abs(pos[1] - ny) > 0.5) {
      node.outputs[i].pos = [nx, ny];
    }
  }
}

// NODES 2.0: the nudge. Pull the slots block out of the flow (so it stops
// pushing the rows down) and translate the output column onto the first row.
// Wrapped in try/catch on purpose: if a future frontend changes the markup, the
// dots just stay in the corner and everything still works.
// Cheap check so the self-heal below is a no-op the 99% of the time nothing has
// moved: same number of dots as rows, and dot one already on row one.
function isAligned(rowEls, outs) {
  if (outs.length !== rowEls.length) return false;
  const rr = rowEls[0].getBoundingClientRect();
  const dd = outs[0].getBoundingClientRect();
  return Math.abs((rr.top + rr.height / 2) - (dd.top + dd.height / 2)) < 1;
}

export function alignOutputs(node) {
  if (!isVueNodes()) return;
  try {
    const el = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
    if (!el) return;
    const rowEls = el.querySelectorAll(".pix-sld-row");
    const outs = el.querySelectorAll(".lg-slot--output");
    if (!rowEls.length || !outs.length) return;
    if (isAligned(rowEls, outs)) return;

    const col = outs[0].parentElement;
    const block = col?.parentElement;
    if (!col || !block) return;

    // Reset first: every measurement below must be taken against the natural
    // layout, not against a previous nudge.
    block.style.marginBottom = "0px";
    col.style.transform = "none";
    col.style.gap = "0px";
    block.style.pointerEvents = "none";
    col.style.pointerEvents = "auto";

    // The styles we write are LAYOUT px, but getBoundingClientRect returns
    // SCREEN px (the node is CSS-scaled by the graph zoom). Rather than trust
    // ds.scale, measure the ratio off an element whose layout height we already
    // know - correct at any zoom, however the zoom happens to be applied.
    const rowH = rowEls[0].offsetHeight || ROW_H;
    const toLayout = rowH / (rowEls[0].getBoundingClientRect().height || rowH);

    // MEASURE the row pitch rather than assume it - the widgets grid owns its
    // own row gap and that number is not ours.
    const pitch = rowEls.length > 1
      ? (rowEls[1].getBoundingClientRect().top - rowEls[0].getBoundingClientRect().top) * toLayout
      : rowH + ROW_GAP;

    // STEP ONE: make each dot row match a slider row. This CHANGES the block's
    // height, which is why it has to happen before the block is measured -
    // measuring first pulls the block up by too little and every dot ends up
    // exactly one slot-row too high.
    for (const o of outs) {
      o.style.height = rowH + "px";
      o.style.minHeight = rowH + "px";
      o.style.marginBottom = Math.max(0, pitch - rowH) + "px";
    }

    // STEP TWO: take the (now correctly sized) slots block out of the flow, so
    // it stops pushing the rows down and the rows start at the top of the body.
    block.style.marginBottom = (-block.offsetHeight) + "px";

    // STEP THREE: drop the whole dot column onto row one.
    const delta =
      (rowEls[0].getBoundingClientRect().top - outs[0].getBoundingClientRect().top) * toLayout;
    col.style.transform = `translateY(${delta}px)`;
  } catch {
    /* nudge failed - dots stay in the corner, node still works */
  }
}

// Keep the dots on their rows.
//
// A MutationObserver alone is not enough: Vue REPLACES the node element when it
// re-renders, which silently orphans any observer bound to the old one - and it
// can render a newly added output slot a frame or two after our rows, so a
// single pass measures the wrong number of dots and never corrects itself
// (measured: dots stuck exactly one slot-row high). So this is a self-healing
// poll, like the pack's other canvas features. alignOutputs early-returns when
// nothing has moved, so the steady-state cost is one rect read.
export function watchAlign(node) {
  if (!isVueNodes() || node._pixSldPoll) return;
  node._pixSldPoll = setInterval(() => {
    if (!node.graph) {          // node deleted: stop
      clearInterval(node._pixSldPoll);
      node._pixSldPoll = null;
      return;
    }
    alignOutputs(node);
  }, 350);
  scheduleAlign(node);
}

export function unwatchAlign(node) {
  if (node._pixSldPoll) clearInterval(node._pixSldPoll);
  node._pixSldPoll = null;
}
