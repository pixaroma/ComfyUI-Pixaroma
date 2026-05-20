import { BRAND } from "../shared/index.mjs";

// CSS for the Image Resize node body chrome (mode chips, footer, readout,
// preview). The per-mode resize PANELS are styled by injectResizePanelCSS()
// in js/shared/resize_panel.mjs (called from index.js). Adaptive surfaces use
// semi-transparent white per the Pixaroma node UI conventions.
export function injectCSS() {
  if (document.getElementById("pix-ir-css")) return;
  const css = `
    .pix-ir-root{width:100%;box-sizing:border-box;padding:8px;background:#2a2a2a;
      border-radius:4px;color:#ddd;font-family:ui-sans-serif,system-ui,sans-serif;
      font-size:11px;display:flex;flex-direction:column;gap:8px;}
    .pix-ir-chips{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;}
    .pix-ir-chip{background:#1d1d1d;border:1px solid #444;
      border-radius:4px;padding:6px 3px;font-size:9.5px;color:#ccc;
      text-align:center;cursor:pointer;user-select:none;transition:background .08s,border-color .08s;}
    .pix-ir-chip:hover{border-color:#666;}
    .pix-ir-chip.active{background:${BRAND};color:#fff;border-color:${BRAND};}
    .pix-ir-chip.span2{grid-column:span 2;}
    .pix-ir-foot{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;}
    .pix-ir-snap{display:inline-flex;align-items:center;gap:5px;}
    .pix-ir-snap-icon{display:inline-block;width:12px;height:12px;background-color:#888;flex:none;
      -webkit-mask:url("/pixaroma/assets/icons/ui/magnet.svg") center/12px 12px no-repeat;
              mask:url("/pixaroma/assets/icons/ui/magnet.svg") center/12px 12px no-repeat;}
    .pix-ir-snap-lbl{font-size:9px;color:#7d7d7d;text-transform:uppercase;letter-spacing:.5px;}
    .pix-ir-schip{background:#1d1d1d;border:1px solid #444;
      border-radius:3px;color:#aaa;font-size:8.5px;padding:3px 5px;
      min-width:16px;text-align:center;cursor:pointer;user-select:none;}
    .pix-ir-schip:hover{border-color:#666;color:#ddd;}
    .pix-ir-schip.active{background:${BRAND};color:#fff;border-color:${BRAND};}
    .pix-ir-resample{background:#1d1d1d;border:1px solid #444;
      border-radius:4px;color:#ddd;font-size:11px;padding:5px;font-family:inherit;width:100%;}
    .pix-ir-resample:focus{outline:none;border-color:${BRAND};}
    .pix-ir-chk{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#cfcfcf;cursor:pointer;user-select:none;}
    .pix-ir-prevbar{display:flex;align-items:center;justify-content:space-between;
      font-size:10px;color:#9a9a9a;padding:5px 7px;background:rgba(0,0,0,.22);
      border-radius:5px;cursor:pointer;user-select:none;}
    .pix-ir-prevtoggle{color:#777;}
    .pix-ir-thumb{border-radius:6px;overflow:hidden;background:#1d1d1d;position:relative;
      min-height:80px;display:flex;align-items:center;justify-content:center;}
    .pix-ir-thumb img{max-width:100%;max-height:240px;display:block;}
    .pix-ir-badge{position:absolute;bottom:5px;left:0;right:0;text-align:center;
      font-size:10px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8);}
    .pix-ir-hint{font-size:10px;color:#7d7d7d;text-align:center;padding:14px 4px;}
    /* Image-Resize-only restyle of the shared mode panels (Option A — soft
       card): a faint borderless raised panel groups the active mode's
       settings, full-width inputs align with the chip grid, and a wider/bolder
       spinner. Scoped to .pix-ir-root so Load Image's panels stay untouched
       (the user will update Load Image to match later). Higher specificity
       than the shared .pix-li-* rules so these win. */
    .pix-ir-root .pix-li-panel{background:rgba(255,255,255,.04);border:none;border-radius:6px;padding:9px 10px;}
    .pix-ir-root .pix-li-input-wide{width:100% !important;max-width:none;}
    /* Dark input fields (#1d1d1d) to match the buttons, not the lighter body
       gray. !important so it beats the shared .pix-li-numinput rule regardless
       of stylesheet injection order. */
    .pix-ir-root .pix-li-numinput{background:#1d1d1d !important;align-items:center;min-height:28px;}
    /* keep the arrow column full-height even though the row centers its items */
    .pix-ir-root .pix-li-numinput .pix-li-spin{align-self:stretch;}
    .pix-ir-root .pix-li-numinput input{line-height:1.2;}
    /* The shared .pix-li-panel input[type="text"] rule gives the input its own
       border + radius, drawing a second box INSIDE the wrapper ("two strokes").
       Strip it so only the wrapper draws the box. */
    .pix-ir-root .pix-li-numinput input{background:transparent !important;border:none !important;border-radius:0 !important;}
    /* Inline label inside the input (single-input modes): orange name on the
       left, value pushed to the right next to the arrows. The section header
       is removed in JS to save vertical space. */
    .pix-ir-root .pix-ir-inline-label{display:flex;align-items:center;color:${BRAND};font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:0 4px 0 9px;white-space:nowrap;flex:none;}
    .pix-ir-root .pix-ir-num-labeled input{text-align:right !important;padding-right:8px !important;}
    /* Fit / Crop (W x H) panel: dark swap button, center-aligned row (the
       above-field labels are removed in JS), centered light-gray title, and a
       more-visible aspect rectangle. */
    .pix-ir-root .pix-li-swap{background:#1d1d1d !important;}
    .pix-ir-root .pix-li-wh-row{align-items:center;}
    .pix-ir-root .pix-ir-wh-header{text-align:center !important;color:#d6d6d6 !important;}
    .pix-ir-root .pix-li-wh-rect{background:rgba(246,103,68,0.35);border-width:2px;}
    /* Solid filled triangle arrows (▲▼) like the chosen mockup, replacing the
       shared outline-chevron carets. Drop the internal divider + match the
       spinner fill so the field reads as ONE uniform dark box (no "two
       strokes" / second-box look). */
    .pix-ir-root .pix-li-spin{width:16px;border-left:none;}
    .pix-ir-root .pix-li-spin > button{background:transparent;}
    .pix-ir-root .pix-li-spin-up::before,
    .pix-ir-root .pix-li-spin-down::before{
      border:none;width:auto;height:auto;font-size:8px;line-height:1;
      transform:translate(-50%,-50%);}
    .pix-ir-root .pix-li-spin-up::before{content:"▲";}
    .pix-ir-root .pix-li-spin-down::before{content:"▼";}
  `;
  const s = document.createElement("style");
  s.id = "pix-ir-css";
  s.textContent = css;
  document.head.appendChild(s);
}

const MODE_CHIPS = [
  { id: "off", label: "Off" },
  { id: "max_mp", label: "Max MP" },
  { id: "longest_side", label: "Longest" },
  { id: "scale_factor", label: "Scale By" },
  { id: "fit_inside", label: "Fit" },
  { id: "cover", label: "Crop" },
  { id: "match_ratio", label: "Match ratio", span2: true },
];

export function buildModeChips(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-ir-chips";
  for (const c of MODE_CHIPS) {
    const el = document.createElement("div");
    el.className = "pix-ir-chip" + (c.span2 ? " span2" : "") + (state.mode === c.id ? " active" : "");
    el.dataset.mode = c.id;
    el.textContent = c.label;
    wrap.appendChild(el);
  }
  return wrap;
}

const SNAP_OPTS = [0, 8, 16, 32, 64];
export function buildFooter(state) {
  const foot = document.createElement("div");
  foot.className = "pix-ir-foot";
  const snap = document.createElement("div");
  snap.className = "pix-ir-snap";
  const icon = document.createElement("span");
  icon.className = "pix-ir-snap-icon";
  snap.appendChild(icon);
  const lbl = document.createElement("span");
  lbl.className = "pix-ir-snap-lbl";
  lbl.textContent = "Snap";
  snap.appendChild(lbl);
  for (const v of SNAP_OPTS) {
    const b = document.createElement("div");
    b.className = "pix-ir-schip" + ((state.snap || 0) === v ? " active" : "");
    b.dataset.snap = String(v);
    b.textContent = v === 0 ? "Off" : String(v);
    snap.appendChild(b);
  }
  foot.appendChild(snap);
  return foot;
}

export function buildResampleAndUpscale(state) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  const sel = document.createElement("select");
  sel.className = "pix-ir-resample";
  for (const o of ["auto", "nearest", "bilinear", "bicubic", "lanczos"]) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = "Resample: " + o[0].toUpperCase() + o.slice(1);
    if ((state.resample || "auto") === o) opt.selected = true;
    sel.appendChild(opt);
  }
  const chk = document.createElement("label");
  chk.className = "pix-ir-chk";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "pix-ir-upscale";
  box.checked = state.allow_upscale !== false;
  chk.append(box, document.createTextNode("Allow upscaling"));
  wrap.append(sel, chk);
  return { wrap, sel, box };
}

export function buildPreview(state) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  const bar = document.createElement("div");
  bar.className = "pix-ir-prevbar";
  bar.innerHTML = `<span>Preview</span><span class="pix-ir-prevtoggle">${state.preview_open ? "hide ▾" : "show ▸"}</span>`;
  const body = document.createElement("div");
  body.className = "pix-ir-thumb";
  body.style.display = state.preview_open ? "flex" : "none";
  body.innerHTML = `<div class="pix-ir-hint">Run the workflow to see the result</div>`;
  wrap.append(bar, body);
  return { wrap, bar, body };
}
