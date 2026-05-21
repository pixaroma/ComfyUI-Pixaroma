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
    /* Custom resample picker: [◀] [ Resample: Auto ▾ ] [▶] — native <select>
       renders with OS chrome (blue highlight etc), so we use our own dark
       dropdown to match the rest of the node. */
    .pix-ir-rs-row{display:flex;align-items:stretch;gap:6px;}
    .pix-ir-rs-nav{flex:0 0 30px;background:#1d1d1d;border:1px solid #444;border-radius:4px;
      color:${BRAND};font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}
    .pix-ir-rs-nav:hover{border-color:${BRAND};background:rgba(246,103,68,.12);}
    .pix-ir-rs-dd{flex:1;display:flex;align-items:center;justify-content:space-between;
      background:#1d1d1d;border:1px solid #444;border-radius:4px;padding:6px 10px;cursor:pointer;user-select:none;}
    .pix-ir-rs-dd:hover{border-color:#666;}
    .pix-ir-rs-value{color:#ddd;font-size:11px;}
    .pix-ir-rs-arrow{color:${BRAND};font-size:13px;margin-left:6px;line-height:1;}
    /* Popup is appended to document.body, so these are NOT scoped to .pix-ir-root. */
    .pix-ir-rs-popup{position:fixed;z-index:99999;background:#181818;border:1px solid #555;
      border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);overflow:hidden;}
    .pix-ir-rs-item{padding:9px 14px;cursor:pointer;display:flex;align-items:baseline;justify-content:space-between;gap:14px;border-bottom:1px solid #2a2a2a;}
    .pix-ir-rs-item:last-child{border-bottom:none;}
    .pix-ir-rs-item:hover{background:#2a2a2a;}
    .pix-ir-rs-item.active .pix-ir-rs-item-label{color:${BRAND};font-weight:600;}
    .pix-ir-rs-item-label{font-size:13px;color:#ddd;white-space:nowrap;}
    .pix-ir-rs-item-hint{font-size:11px;color:#888;text-align:right;}
    /* Allow-upscaling toggle button: orange "On", gray "Off". Centered. */
    .pix-ir-upbtn{align-self:center;background:#1d1d1d;border:1px solid #444;border-radius:5px;
      color:#aaa;font-size:11px;padding:7px 18px;cursor:pointer;user-select:none;transition:background .08s,border-color .08s;}
    .pix-ir-upbtn:hover{border-color:#666;color:#ddd;}
    .pix-ir-upbtn.is-on{background:${BRAND};border-color:${BRAND};color:#fff;}
    .pix-ir-upbtn.is-on:hover{background:${BRAND};border-color:${BRAND};color:#fff;}
    /* Image-Resize-only restyle of the shared mode panels (Option A — soft
       card): a faint borderless raised panel groups the active mode's
       settings, full-width inputs align with the chip grid, and a wider/bolder
       spinner. Scoped to .pix-ir-root so Load Image's panels stay untouched
       (the user will update Load Image to match later). Higher specificity
       than the shared .pix-li-* rules so these win. */
    .pix-ir-root .pix-li-panel{background:rgba(255,255,255,.04);border:none;border-radius:6px;padding:9px 10px;}
    /* Balance panel rhythm: the empty readout div left a phantom gap and the
       ratio-chip grid's bottom margin made Match ratio bottom-heavy. Hide the
       readout, drop the chip grid's bottom margin, and give the custom ratio
       row its own top gap so top/bottom padding match. */
    .pix-ir-root .pix-li-panel-readout{display:none;}
    .pix-ir-root .pix-li-ratio-chips{margin-bottom:0;}
    .pix-ir-root .pix-li-custom-ratio-row{margin:8px 0 0;}
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
    /* Fit / Crop (W x H) panel: dark swap button, centered light-gray title,
       more-visible aspect rectangle, and a two-column reflow - W/H stacked in a
       left column with the swap below them, the ratio rect on the right. */
    .pix-ir-root .pix-li-swap{background:#1d1d1d !important;}
    .pix-ir-root .pix-ir-wh-header{text-align:center !important;color:#d6d6d6 !important;}
    .pix-ir-root .pix-li-wh-rect{background:rgba(246,103,68,0.35);border-width:2px;}
    /* Fixed 50/50 columns: the W/H stack is always the left half (extends to
       center, ~aligned with the first 2 buttons) so the inputs never resize
       with the rect; the rect is centered in the right half. */
    /* minmax(0,1fr) so a wide (landscape) rect can't steal width from the W/H
       column - both columns stay exactly half. */
    .pix-ir-root .pix-ir-wh-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:center;}
    .pix-ir-root .pix-ir-wh-col{display:flex;flex-direction:column;gap:6px;min-width:0;}
    .pix-ir-root .pix-ir-wh-col .pix-li-swap{width:100%;height:24px;align-self:auto;}
    .pix-ir-root .pix-ir-wh-grid .pix-li-wh-preview{margin-top:0;justify-content:center;}
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
    /* Crop to fill extras: Fill/Crop scale toggle + 3x3 anchor picker. */
    .pix-ir-root .pix-ir-swaprow{display:flex;gap:6px;align-items:stretch;}
    .pix-ir-root .pix-ir-wh-col .pix-ir-swaprow .pix-li-swap{flex:0 0 46px;width:auto;height:auto;align-self:stretch;}
    .pix-ir-root .pix-ir-fillcrop{flex:1;display:grid;grid-template-columns:1fr 1fr;background:#1d1d1d;border:1px solid #444;border-radius:4px;overflow:hidden;}
    .pix-ir-root .pix-ir-fillcrop>div{display:flex;align-items:center;justify-content:center;font-size:9.5px;padding:5px 0;color:#aaa;cursor:pointer;user-select:none;}
    .pix-ir-root .pix-ir-fillcrop>div:hover{color:#ddd;}
    .pix-ir-root .pix-ir-fillcrop>div.active{background:${BRAND};color:#fff;}
    .pix-ir-root .pix-ir-anchor{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:3px;width:100%;max-width:96px;aspect-ratio:1;margin:0 auto;background:#1d1d1d;border:1px solid #444;border-radius:5px;padding:5px;box-sizing:border-box;}
    .pix-ir-root .pix-ir-anchor-cell{background:rgba(255,255,255,.07);border-radius:2px;cursor:pointer;transition:background .08s;}
    .pix-ir-root .pix-ir-anchor-cell:hover{background:rgba(255,255,255,.18);}
    .pix-ir-root .pix-ir-anchor-cell.active{background:${BRAND};}
  `;
  const s = document.createElement("style");
  s.id = "pix-ir-css";
  s.textContent = css;
  document.head.appendChild(s);
}

const MODE_CHIPS = [
  { id: "off", label: "Off" },
  { id: "max_mp", label: "Max MP" },
  { id: "longest_side", label: "Longest side" },
  { id: "scale_factor", label: "Scale by ×" },
  { id: "fit_inside", label: "Fit inside" },
  { id: "cover", label: "Crop to fill" },
  { id: "match_ratio", label: "Match ratio" },
  { id: "pad", label: "Pad" },
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

const RESAMPLE_OPTIONS = [
  { id: "auto",     label: "Auto",     hint: "Lanczos for shrink, Bilinear for grow" },
  { id: "nearest",  label: "Nearest",  hint: "Pixel-perfect, no smoothing" },
  { id: "bilinear", label: "Bilinear", hint: "Fast, smooth" },
  { id: "bicubic",  label: "Bicubic",  hint: "Slower, sharper" },
  { id: "lanczos",  label: "Lanczos",  hint: "Slowest, sharpest" },
];
export const RESAMPLE_IDS = RESAMPLE_OPTIONS.map((o) => o.id);
export function resampleLabel(id) {
  return (RESAMPLE_OPTIONS.find((o) => o.id === id) || RESAMPLE_OPTIONS[0]).label;
}

export function buildResampleAndUpscale(state) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  // [◀] [ Resample: Auto ▾ ] [▶]
  const rsRow = document.createElement("div");
  rsRow.className = "pix-ir-rs-row";
  const prev = document.createElement("button");
  prev.type = "button"; prev.className = "pix-ir-rs-nav"; prev.title = "Previous"; prev.textContent = "◀";
  const dd = document.createElement("div");
  dd.className = "pix-ir-rs-dd";
  const valueEl = document.createElement("span");
  valueEl.className = "pix-ir-rs-value";
  valueEl.textContent = "Resample: " + resampleLabel(state.resample || "auto");
  const arrow = document.createElement("span");
  arrow.className = "pix-ir-rs-arrow"; arrow.textContent = "▼";
  dd.append(valueEl, arrow);
  const next = document.createElement("button");
  next.type = "button"; next.className = "pix-ir-rs-nav"; next.title = "Next"; next.textContent = "▶";
  rsRow.append(prev, dd, next);

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  const upOn = state.allow_upscale !== false;
  upBtn.className = "pix-ir-upbtn" + (upOn ? " is-on" : "");
  upBtn.textContent = upOn ? "Upscaling: On" : "Upscaling: Off";

  wrap.append(rsRow, upBtn);
  return { wrap, upBtn, prev, dd, next, valueEl };
}

// Custom resample dropdown popup — dark Pixaroma styling instead of the native
// <select> chrome. Anchored to the dropdown row; click an item to commit.
// Closes on outside mousedown / pointerdown / wheel / Escape (all capture
// phase); the wheel + mousedown guards skip events inside the popup so a scroll
// inside the list doesn't dismiss it (Load Image Pattern #14).
export function openResamplePopup(anchorEl, currentValue, onPick) {
  document.querySelector(".pix-ir-rs-popup")?.remove();
  const popup = document.createElement("div");
  popup.className = "pix-ir-rs-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 2}px`;
  popup.style.width = `${rect.width}px`;
  for (const opt of RESAMPLE_OPTIONS) {
    const item = document.createElement("div");
    item.className = "pix-ir-rs-item" + (opt.id === currentValue ? " active" : "");
    const lbl = document.createElement("span");
    lbl.className = "pix-ir-rs-item-label"; lbl.textContent = opt.label;
    const hint = document.createElement("span");
    hint.className = "pix-ir-rs-item-hint"; hint.textContent = opt.hint;
    item.append(lbl, hint);
    item.addEventListener("click", (e) => { e.stopPropagation(); onPick(opt.id); close(); });
    popup.appendChild(item);
  }
  document.body.appendChild(popup);
  function close() {
    popup.remove();
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
  }
  const onDocDown = (e) => { if (!popup.contains(e.target)) close(); };
  const onWheel = (e) => { if (!popup.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  setTimeout(() => {
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
}

