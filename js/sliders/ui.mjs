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
import { readState, accentOf, clampValue, decimalsOf, rangeOf, comboVisible, randomSeed, MAX_SLIDERS } from "./core.mjs";

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

    /* ── Toggle (switch) row - style A: an iOS-style slide switch ────────────
       A toggle is just another kind of row: same height, same output dot. The
       track is the same translucent dent the slider uses, so a recoloured node
       still reads, and the ON state fills with the node's accent. */
    .pix-sld-tog {
      display:flex; align-items:center; gap:8px; width:100%; height:${ROW_H}px;
      box-sizing:border-box; padding:0 8px; border-radius:5px;
      background:rgba(255,255,255,0.045); border:1px solid rgba(255,255,255,0.12);
      cursor:pointer; user-select:none;
    }
    .pix-sld-tog:hover { border-color:var(--acc,#f66744); }
    .pix-sld-tog .tnm {
      flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      font:11.5px 'Segoe UI',-apple-system,sans-serif; color:rgba(255,255,255,0.72);
    }
    .pix-sld-tog[data-on="1"] .tnm { color:#f2f2f2; }
    .pix-sld-tog .tst {
      flex:none; font:9.5px 'Segoe UI',sans-serif; font-weight:600; letter-spacing:.03em;
      color:rgba(255,255,255,0.42); max-width:70px; white-space:nowrap; overflow:hidden;
      text-overflow:ellipsis; text-align:right;
    }
    .pix-sld-tog[data-on="1"] .tst { color:var(--acc,#f66744); }
    .pix-sld-tsw {
      position:relative; flex:none; width:32px; height:16px; border-radius:8px;
      background:rgba(0,0,0,0.30); border:1px solid rgba(255,255,255,0.16);
      transition:background .15s, border-color .15s;
    }
    .pix-sld-tsw::after {
      content:""; position:absolute; top:1px; left:2px; width:12px; height:12px; border-radius:50%;
      background:#cfcfcf; transition:transform .15s, background .15s;
    }
    .pix-sld-tog[data-on="1"] .pix-sld-tsw { background:var(--acc,#f66744); border-color:var(--acc,#f66744); }
    .pix-sld-tog[data-on="1"] .pix-sld-tsw::after { transform:translateX(14px); background:#fff; }
    @media (prefers-reduced-motion:reduce){ .pix-sld-tsw,.pix-sld-tsw::after{transition:none;} }

    /* ── Dropdown (combo) row - the Pixaroma dark picker, never a native select.
       Value with prev/next arrows; click the value for the full list. */
    .pix-sld-combo {
      display:flex; align-items:center; gap:5px; width:100%; height:${ROW_H}px;
      box-sizing:border-box; padding:0 6px 0 11px; border-radius:5px;
      background:rgba(255,255,255,0.045); border:1px solid rgba(255,255,255,0.12); user-select:none;
    }
    .pix-sld-combo:hover { border-color:var(--acc,#f66744); }
    .pix-sld-combo .cnm {
      flex:1; min-width:0; font:11.5px 'Segoe UI',sans-serif; color:rgba(255,255,255,0.72);
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .pix-sld-cnav { flex:none; width:13px; text-align:center; color:var(--acc,#f66744); font-size:10px; cursor:pointer; }
    .pix-sld-cnav:hover { color:#fff; }
    .pix-sld-cval {
      flex:none; max-width:145px; display:flex; align-items:center; gap:5px; cursor:pointer;
      font:11.5px 'Segoe UI',sans-serif; font-weight:600; color:#fff;
    }
    .pix-sld-cval .ct { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-sld-cval::after { content:"▾"; font-size:9px; color:rgba(255,255,255,0.5); flex:none; }
    .pix-sld-combo.empty .cnm { color:rgba(255,255,255,0.4); }
    .pix-sld-combo.empty .cval { color:rgba(255,255,255,0.4); font-weight:400; font-style:italic; }
    .pix-sld-combo.empty .pix-sld-cnav { color:rgba(255,255,255,0.22); cursor:default; }

    .pix-sld-cpop {
      position:fixed; z-index:10030; background:#1d1d1d; border:1px solid #3a3a3a; border-radius:7px;
      box-shadow:0 14px 40px rgba(0,0,0,0.55); padding:4px; max-height:280px; overflow-y:auto;
      min-width:150px; font:12px 'Segoe UI',sans-serif;
    }
    .pix-sld-copt { padding:5px 10px; border-radius:4px; color:#d8d8d8; cursor:pointer; white-space:nowrap; }
    .pix-sld-copt:hover { background:#2a2a2a; }
    .pix-sld-copt.on { color:#fff; background:var(--acc,#f66744); }

    /* ── Seed row - a number with Randomize (R) + New-seed (N) buttons ─────── */
    .pix-sld-seed {
      display:flex; align-items:center; gap:6px; width:100%; height:${ROW_H}px;
      box-sizing:border-box; padding:0 6px 0 11px; border-radius:5px;
      background:rgba(255,255,255,0.045); border:1px solid rgba(255,255,255,0.12); user-select:none;
    }
    .pix-sld-seed:hover { border-color:var(--acc,#f66744); }
    .pix-sld-seed .snm { flex:1; min-width:0; font:11.5px 'Segoe UI',sans-serif; color:rgba(255,255,255,0.72); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-sld-seed .sv { flex:none; max-width:120px; font:11.5px 'Segoe UI',sans-serif; font-weight:600; color:#fff; font-variant-numeric:tabular-nums; cursor:text; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-sld-seed.random .sv { color:rgba(255,255,255,0.5); font-style:italic; }
    .pix-sld-sbtn { flex:none; min-width:18px; height:16px; padding:0 4px; border-radius:4px; border:1px solid rgba(255,255,255,0.18);
      display:grid; place-items:center; font:9.5px 'Segoe UI',sans-serif; font-weight:700; color:rgba(255,255,255,0.6); cursor:pointer; }
    .pix-sld-sbtn:hover { border-color:var(--acc,#f66744); color:#fff; }
    .pix-sld-seed.random .sr { background:var(--acc,#f66744); border-color:var(--acc,#f66744); color:#fff; }
    .pix-sld-sedit { display:none; flex:none; width:112px; background:#1d1d1d; border:1px solid var(--acc,#f66744); border-radius:4px;
      color:#e8e8e8; font:11.5px 'Segoe UI',sans-serif; text-align:right; padding:1px 6px; outline:none; font-variant-numeric:tabular-nums; }
    .pix-sld-seed.editing .sv { display:none; }
    .pix-sld-seed.editing .pix-sld-sedit { display:block; }

    /* ── Text row - a single-line field for a prompt / filename / tag ──────── */
    .pix-sld-text {
      display:flex; align-items:center; gap:8px; width:100%; height:${ROW_H}px;
      box-sizing:border-box; padding:0 8px 0 11px; border-radius:5px;
      background:rgba(255,255,255,0.045); border:1px solid rgba(255,255,255,0.12);
    }
    .pix-sld-text:hover, .pix-sld-text:focus-within { border-color:var(--acc,#f66744); }
    .pix-sld-text .txnm { flex:none; max-width:45%; font:11.5px 'Segoe UI',sans-serif;
      color:rgba(255,255,255,0.72); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-sld-txin { flex:1; min-width:0; background:transparent; border:0; outline:none; color:#fff;
      font:11.5px 'Segoe UI',sans-serif; text-align:left; padding:0; }
    .pix-sld-txin::placeholder { color:rgba(255,255,255,0.32); font-style:italic; }

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

  // The toggle control shares the row. Only one of the two (slider / toggle) is
  // ever displayed - paintRow decides from the row's type - so a row can switch
  // between a slider and a switch with no widget churn.
  const tog = document.createElement("div");
  tog.className = "pix-sld-tog";
  tog.style.display = "none";
  tog.innerHTML = '<span class="tnm"></span><span class="tst"></span><span class="pix-sld-tsw"></span>';

  // The dropdown control shares the row too (only one of slider/toggle/combo shows).
  const combo = document.createElement("div");
  combo.className = "pix-sld-combo";
  combo.style.display = "none";
  combo.innerHTML =
    '<span class="cnm"></span>' +
    '<span class="pix-sld-cnav" data-dir="-1">◀</span>' +
    '<span class="cval"><span class="ct"></span></span>' +
    '<span class="pix-sld-cnav" data-dir="1">▶</span>';

  // The seed control shares the row too.
  const seed = document.createElement("div");
  seed.className = "pix-sld-seed";
  seed.style.display = "none";
  seed.innerHTML =
    '<span class="snm"></span>' +
    '<span class="sv"></span>' +
    '<input class="pix-sld-sedit" type="text" spellcheck="false">' +
    '<span class="pix-sld-sbtn sr" title="Randomize the seed on every run">R</span>' +
    '<span class="pix-sld-sbtn sn" title="Roll a new fixed seed now">N</span>';

  // The text control shares the row too.
  const text = document.createElement("div");
  text.className = "pix-sld-text";
  text.style.display = "none";
  text.innerHTML = '<span class="txnm"></span><input class="pix-sld-txin" type="text" spellcheck="false">';

  row.append(sl, tog, combo, seed, text);

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
    const [min, max] = rangeOf(s);   // a user may have typed Min 100 / Max 0
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

  // Toggle: a click anywhere on the row flips it. pointerdown is swallowed so it
  // never starts a node drag (same guard the slider uses).
  tog.addEventListener("pointerdown", (e) => e.stopPropagation());
  tog.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = slider();
    if (!s || s.type !== "toggle") return;
    s.value = s.value ? 0 : 1;
    paintRow(node, index);
    node.graph?.setDirtyCanvas?.(true, true);
  });

  // Combo: arrows cycle the visible options; clicking the value opens the list.
  combo.addEventListener("pointerdown", (e) => e.stopPropagation());
  combo.querySelectorAll(".pix-sld-cnav").forEach((nav) => {
    nav.addEventListener("click", (e) => {
      e.stopPropagation();
      const s = slider();
      if (!s || s.type !== "combo") return;
      const vis = comboVisible(s);
      if (!vis.length) return;
      const dir = Number(nav.getAttribute("data-dir")) || 1;
      let i = vis.indexOf(s.value);
      if (i < 0) i = 0;
      s.value = vis[(i + dir + vis.length) % vis.length];
      paintRow(node, index);
      node.graph?.setDirtyCanvas?.(true, true);
    });
  });
  combo.querySelector(".cval").addEventListener("click", (e) => {
    e.stopPropagation();
    const s = slider();
    if (!s || s.type !== "combo") return;
    if (!comboVisible(s).length) return;
    openComboPopup(node, index, combo.querySelector(".cval"));
  });

  // Seed: R toggles randomize-each-run; N rolls a new fixed seed; click the
  // number to type an exact one.
  seed.addEventListener("pointerdown", (e) => e.stopPropagation());
  seed.querySelector(".sr").addEventListener("click", (e) => {
    e.stopPropagation();
    const s = slider();
    if (!s || s.type !== "seed") return;
    s.mode = s.mode === "random" ? "fixed" : "random";
    paintRow(node, index);
    node.graph?.setDirtyCanvas?.(true, true);
  });
  seed.querySelector(".sn").addEventListener("click", (e) => {
    e.stopPropagation();
    const s = slider();
    if (!s || s.type !== "seed") return;
    s.value = randomSeed();
    s.mode = "fixed";
    if (node._pixSeedRun) delete node._pixSeedRun[index];
    paintRow(node, index);
    node.graph?.setDirtyCanvas?.(true, true);
  });
  const sedit = seed.querySelector(".pix-sld-sedit");
  seed.querySelector(".sv").addEventListener("click", (e) => {
    e.stopPropagation();
    const s = slider();
    if (!s || s.type !== "seed") return;
    sedit.value = String(s.value);
    seed.classList.add("editing");
    sedit.focus();
    sedit.select();
  });
  const commitSeed = (apply) => {
    if (!seed.classList.contains("editing")) return;
    if (apply) {
      const v = parseInt(sedit.value, 10);
      const s = slider();
      if (s && Number.isFinite(v) && v >= 0) {
        s.value = Math.floor(v);
        s.mode = "fixed";
        if (node._pixSeedRun) delete node._pixSeedRun[index];
      }
    }
    seed.classList.remove("editing");
    paintRow(node, index);
    node.graph?.setDirtyCanvas?.(true, true);
  };
  sedit.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commitSeed(true); }
    else if (e.key === "Escape") { e.preventDefault(); commitSeed(false); }
  });
  sedit.addEventListener("blur", () => commitSeed(true));
  sedit.addEventListener("pointerdown", (e) => e.stopPropagation());

  // Text: type into the field; the field IS the value.
  const txin = text.querySelector(".pix-sld-txin");
  text.addEventListener("pointerdown", (e) => e.stopPropagation());
  txin.addEventListener("pointerdown", (e) => e.stopPropagation());
  txin.addEventListener("keydown", (e) => e.stopPropagation());   // keep typing out of canvas shortcuts
  txin.addEventListener("input", () => {
    const s = slider();
    if (s && s.type === "text") s.value = txin.value;
  });
  txin.addEventListener("change", () => {
    const s = slider();
    if (s && s.type === "text") s.value = txin.value;
    node.graph?.setDirtyCanvas?.(true, true);
  });

  return row;
}

// ── Dropdown option popup ────────────────────────────────────────────────────
let _comboPopup = null;
function _comboOutside(e) { if (_comboPopup && !_comboPopup.contains(e.target)) closeComboPopup(); }
function _comboEsc(e) { if (e.key === "Escape" && _comboPopup) { e.stopPropagation(); closeComboPopup(); } }

export function closeComboPopup() {
  if (_comboPopup) { try { _comboPopup.remove(); } catch {} _comboPopup = null; }
  document.removeEventListener("pointerdown", _comboOutside, true);
  document.removeEventListener("wheel", _comboOutside, true);   // wheel OUTSIDE closes; inside scrolls
  document.removeEventListener("keydown", _comboEsc, true);
}

function openComboPopup(node, index, anchorEl) {
  closeComboPopup();
  const s = readState(node).sliders[index];
  if (!s) return;
  const vis = comboVisible(s);
  if (!vis.length) return;

  const pop = document.createElement("div");
  pop.className = "pix-sld-cpop";
  pop.style.setProperty("--acc", accentOf(node));
  vis.forEach((opt) => {
    const item = document.createElement("div");
    item.className = "pix-sld-copt" + (opt === s.value ? " on" : "");
    item.textContent = opt;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const ss = readState(node).sliders[index];
      if (ss) { ss.value = opt; paintRow(node, index); node.graph?.setDirtyCanvas?.(true, true); }
      closeComboPopup();
    });
    pop.appendChild(item);
  });
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
  let top = r.bottom + 4;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = r.top - pop.offsetHeight - 4;
  pop.style.top = Math.max(8, top) + "px";
  pop.querySelector(".pix-sld-copt.on")?.scrollIntoView({ block: "nearest" });

  _comboPopup = pop;
  // wheel handler gates on !contains, so scrolling INSIDE the list never closes it.
  setTimeout(() => {
    document.addEventListener("pointerdown", _comboOutside, true);
    document.addEventListener("wheel", _comboOutside, true);
    document.addEventListener("keydown", _comboEsc, true);
  }, 0);
}

// Repaint one row from state (cheap: called on every drag frame).
export function paintRow(node, index) {
  const w = node._pixSldRows?.[index];
  const el = w?.element;
  const s = readState(node).sliders[index];
  if (!el || !s) return;

  const sl = el.querySelector(".pix-sld-sl");
  const tog = el.querySelector(".pix-sld-tog");
  const combo = el.querySelector(".pix-sld-combo");
  const seed = el.querySelector(".pix-sld-seed");
  const text = el.querySelector(".pix-sld-text");
  const acc = accentOf(node);

  // ── Toggle row ──
  if (s.type === "toggle") {
    if (sl) sl.style.display = "none";
    if (combo) combo.style.display = "none";
    if (seed) seed.style.display = "none";
    if (text) text.style.display = "none";
    if (tog) {
      tog.style.display = "flex";
      const on = Number(s.value) ? 1 : 0;
      tog.setAttribute("data-on", String(on));
      tog.style.setProperty("--acc", acc);
      tog.querySelector(".tnm").textContent = s.name || `Value ${index + 1}`;
      tog.querySelector(".tst").textContent = on ? (s.onLabel || "On") : (s.offLabel || "Off");
      tog.title = `${s.name || `Value ${index + 1}`}  (click to switch ${on ? "off" : "on"})`;
    }
    return;
  }

  // ── Dropdown (combo) row ──
  if (s.type === "combo") {
    if (sl) sl.style.display = "none";
    if (tog) tog.style.display = "none";
    if (seed) seed.style.display = "none";
    if (text) text.style.display = "none";
    if (combo) {
      combo.style.display = "flex";
      combo.style.setProperty("--acc", acc);
      const vis = comboVisible(s);
      const empty = !vis.length;
      combo.classList.toggle("empty", empty);
      combo.querySelector(".cnm").textContent = s.name || `Value ${index + 1}`;
      combo.querySelector(".cval .ct").textContent = empty ? "connect a picker" : (s.value || vis[0] || "");
      combo.title = empty
        ? "Wire this to a dropdown input (sampler, scheduler, checkpoint, ...) to fill it"
        : `${s.name || `Value ${index + 1}`}: ${s.value}`;
    }
    return;
  }

  // ── Seed row ──
  if (s.type === "seed") {
    if (sl) sl.style.display = "none";
    if (tog) tog.style.display = "none";
    if (combo) combo.style.display = "none";
    if (text) text.style.display = "none";
    if (seed) {
      seed.style.display = "flex";
      seed.style.setProperty("--acc", acc);
      const random = s.mode === "random";
      seed.classList.toggle("random", random);
      seed.querySelector(".snm").textContent = s.name || `Value ${index + 1}`;
      const runVal = node._pixSeedRun?.[index];
      seed.querySelector(".sv").textContent = random
        ? (Number.isFinite(runVal) ? String(runVal) : "random")
        : String(s.value);
      seed.title = random
        ? `${s.name || "Seed"}: a new random seed every run (R on). N rolls a fixed one.`
        : `${s.name || "Seed"}: ${s.value}  (R = randomize each run, N = new seed)`;
    }
    return;
  }

  // ── Text row ──
  if (s.type === "text") {
    if (sl) sl.style.display = "none";
    if (tog) tog.style.display = "none";
    if (combo) combo.style.display = "none";
    if (seed) seed.style.display = "none";
    if (text) {
      text.style.display = "flex";
      text.style.setProperty("--acc", acc);
      text.querySelector(".txnm").textContent = s.name || `Value ${index + 1}`;
      const txin = text.querySelector(".pix-sld-txin");
      txin.placeholder = "type text";
      // never clobber what the user is currently typing
      if (document.activeElement !== txin) txin.value = typeof s.value === "string" ? s.value : "";
      text.title = `${s.name || `Value ${index + 1}`}: text`;
    }
    return;
  }

  // ── Slider row ──
  if (tog) tog.style.display = "none";
  if (combo) combo.style.display = "none";
  if (seed) seed.style.display = "none";
  if (text) text.style.display = "none";
  if (sl) sl.style.display = "block";

  const [min, max] = rangeOf(s);   // a user may have typed Min 100 / Max 0
  const span = (max - min) || 1;
  const p = Math.min(100, Math.max(0, ((Number(s.value) - min) / span) * 100));
  const dec = decimalsOf(s);
  const txt = Number(s.value).toFixed(dec);

  sl.style.setProperty("--p", p + "%");
  sl.style.setProperty("--acc", acc);
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
    el.textContent = "+ Add control";
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
    const full = st.sliders.length >= MAX_SLIDERS;
    addEl.classList.toggle("full", full);
    addEl.textContent = full ? `${MAX_SLIDERS} controls max` : "+ Add control";
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
//
// ⚠️ MIND THE MARGIN. Legacy insets a DOM widget's ELEMENT by widget.margin
// (DEFAULT_MARGIN = 10): the element is drawn at
//     node.pos + margin + widget.y
// while widget.y itself carries no margin. Placing the dot at widget.y + rowH/2
// therefore lands it a full 10px ABOVE the row's real centre - which on a 23px
// row is almost exactly its top edge (user-reported: "aligned on top, not
// centre"). Nodes 2.0 has no such margin, which is why it looked right there.
export function alignOutputsLegacy(node) {
  const rows = node._pixSldRows || [];
  if (!node.outputs || !rows.length) return;
  for (let i = 0; i < node.outputs.length && i < rows.length; i++) {
    const w = rows[i];
    const y = w?.y;
    if (!Number.isFinite(y)) continue;
    const margin = Number.isFinite(w.margin) ? w.margin : 10;
    const pos = node.outputs[i].pos;
    const nx = node.size[0];
    const ny = y + margin + ROW_H * 0.5;   // the row's true visual centre
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
