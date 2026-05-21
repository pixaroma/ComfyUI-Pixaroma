import { BRAND } from "../shared/index.mjs";

let _cssInjected = false;

export function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const css = `
    .pix-li-root {
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      color: #ddd;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pix-li-upload-btn {
      width: 100%;
      background: ${BRAND};
      border: none;
      border-radius: 4px;
      padding: 9px 8px;
      font-size: 11px;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      font-family: inherit;
      transition: background 0.08s;
    }
    .pix-li-upload-btn:hover { background: #ff7e5a; }
    .pix-li-upload-btn .ico {
      width: 14px; height: 14px;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/upload.svg") center/14px 14px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/upload.svg") center/14px 14px no-repeat;
    }
    .pix-li-hint {
      font-size: 9px;
      color: #777;
      text-align: center;
      letter-spacing: 0.3px;
      margin-top: -3px;
    }
    .pix-li-hint kbd {
      color: #aaa;
      font-family: inherit;
      background: transparent;
      padding: 0;
    }
    /* File row: [◀] [ dropdown ] [▶] - arrow buttons let the user flip
       through images visually, matching native ComfyUI LoadImage. */
    .pix-li-filerow {
      display: flex;
      gap: 4px;
      align-items: stretch;
    }
    .pix-li-filerow .pix-li-dropdown { flex: 1; min-width: 0; }
    .pix-li-nav {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      color: #aaa;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      width: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      transition: background 0.08s, border-color 0.08s, color 0.08s;
      flex-shrink: 0;
    }
    .pix-li-nav:hover:not(.disabled) { border-color: ${BRAND}; color: ${BRAND}; }
    .pix-li-nav:active:not(.disabled) { background: ${BRAND}; color: #fff; }
    .pix-li-nav.disabled { opacity: 0.3; cursor: default; }
    .pix-li-dropdown {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 11px;
      color: #ccc;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }
    .pix-li-dropdown:hover { border-color: #666; }
    .pix-li-dropdown .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pix-li-dropdown .arrow { color: ${BRAND}; font-size: 10px; margin-left: 6px; }
    .pix-li-dropdown .counter {
      color: #777;
      font-size: 9px;
      margin-left: 6px;
      flex-shrink: 0;
    }
    /* Subfolder section header inside the dropdown popup. Visual separator
       only - not clickable. Items below it show the bare filename. */
    .pix-li-popup-section {
      padding: 4px 10px 3px;
      font-size: 9px;
      color: #777;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: #161616;
      border-bottom: 1px solid #2a2a2a;
      user-select: none;
    }
    .pix-li-popup-section:not(:first-child) { border-top: 1px solid #2a2a2a; }
    /* Dimensions info bar — replaces the "drag/paste" hint once an image
       is loaded. Horizontal layout: [INPUT  dims  ratio] → [OUTPUT  dims
       ratio], both halves on the same line so we save vertical space
       when a resize mode is active. When resize is Off, only the Input
       half is rendered. */
    .pix-li-diminfo {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #1d1d1d;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 10px;
    }
    .pix-li-diminfo-row {
      display: flex;
      align-items: center;
      gap: 5px;
      flex: 1;
      min-width: 0; /* allow shrinking when both halves visible */
    }
    .pix-li-diminfo-tag {
      font-size: 8px;
      color: #777;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .pix-li-diminfo-dims {
      color: #ddd;
      flex: 1;
      white-space: nowrap;
    }
    .pix-li-diminfo-ratio {
      color: #888;
      flex-shrink: 0;
    }
    .pix-li-diminfo-arrow {
      color: ${BRAND};
      font-size: 11px;
      line-height: 1;
      flex-shrink: 0;
    }
    .pix-li-diminfo .pix-li-shape {
      flex-shrink: 0;
    }
    /* Highlight the OUTPUT half by tinting the dims orange when resize active. */
    .pix-li-diminfo-row.out .pix-li-diminfo-dims { color: ${BRAND}; font-weight: 600; }
    .pix-li-chips {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 5px;
    }
    .pix-li-chip {
      box-sizing: border-box;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 3px;
      text-align: center;
      font-size: 9.5px;
      color: #ccc;
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, border-color 0.08s;
    }
    .pix-li-chip:hover { border-color: ${BRAND}; color: #ddd; }
    .pix-li-chip.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-li-panel {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 8px 10px;
    }
    .pix-li-panel-row { display: flex; align-items: center; gap: 8px; }
    .pix-li-panel-label {
      font-size: 9px;
      color: ${BRAND};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .pix-li-panel input[type="range"] {
      flex: 1;
      accent-color: ${BRAND};
    }
    .pix-li-panel input[type="text"], .pix-li-panel input[type="number"] {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 3px;
      padding: 4px 6px;
      color: ${BRAND};
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      font-family: inherit;
      box-sizing: border-box;
    }
    .pix-li-panel input[type="text"]:focus, .pix-li-panel input[type="number"]:focus {
      outline: none;
      border-color: ${BRAND};
    }
    .pix-li-panel-readout {
      font-size: 9px;
      color: #888;
      font-family: inherit;
      text-align: center;
      margin-top: 6px;
    }
    .pix-li-quickpicks {
      display: grid;
      gap: 3px;
      margin-bottom: 8px;
    }
    .pix-li-quickpick {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      color: #aaa;
      padding: 4px 0;
      text-align: center;
      font-size: 10px;
      cursor: pointer;
      font-family: inherit;
    }
    .pix-li-quickpick:hover { border-color: #666; color: #ddd; }
    .pix-li-quickpick.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-li-value {
      font-family: inherit;
      font-size: 12px;
      color: ${BRAND};
      font-weight: 600;
      min-width: 50px;
      text-align: right;
    }
    .pix-li-ratio-chips {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 3px;
      margin-bottom: 8px;
    }
    .pix-li-ratio-chip {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      padding: 4px 0;
      text-align: center;
      font-size: 9px;
      color: #aaa;
      cursor: pointer;
      font-family: inherit;
    }
    .pix-li-ratio-chip:hover { border-color: #666; color: #ddd; }
    .pix-li-ratio-chip.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-li-cropped {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .pix-li-cropped > div {
      text-align: center;
      font-size: 10px;
      padding: 5px 0;
      color: #aaa;
      cursor: pointer;
      user-select: none;
    }
    .pix-li-cropped > div.active { background: ${BRAND}; color: #fff; }
    .pix-li-pad-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      color: #888;
    }
    .pix-li-pad-swatch {
      width: 22px; height: 22px;
      border-radius: 3px;
      border: 1px solid #444;
      cursor: pointer;
    }
    .pix-li-custom-ratio-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    /* Custom ratio inputs sit inside a .pix-li-numinput wrapper — the
       wrapper supplies border/background; we just fix the width. */
    .pix-li-custom-ratio-input-wrap { width: 64px; }
    .pix-li-custom-ratio-swap {
      width: 24px;
      height: 22px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 3px;
      color: #aaa;
      cursor: pointer;
      position: relative;
      padding: 0;
      display: inline-block;
    }
    .pix-li-custom-ratio-swap::before {
      content: "";
      position: absolute;
      inset: 0;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/swap.svg") center/14px 14px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/swap.svg") center/14px 14px no-repeat;
      pointer-events: none;
    }
    .pix-li-custom-ratio-swap:hover { color: ${BRAND}; border-color: ${BRAND}; }
    /* Center single-input panel rows (Max MP / Longest side / Scale by ×). */
    .pix-li-panel-row.pix-li-centered { justify-content: center; }
    .pix-li-input-wide {
      width: 70% !important;
      max-width: 200px;
    }
    /* makeNumericInput wrapper — flex row with input + stacked +/- spinners. */
    .pix-li-numinput {
      display: inline-flex;
      align-items: stretch;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      overflow: hidden;
      box-sizing: border-box;
    }
    .pix-li-numinput:focus-within { border-color: ${BRAND}; }
    .pix-li-numinput input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      padding: 2px 6px;
      color: ${BRAND};
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      font-family: inherit;
      width: 100%;
      min-width: 0;
    }
    .pix-li-spin {
      display: flex;
      flex-direction: column;
      width: 12px;
      border-left: 1px solid #444;
    }
    .pix-li-spin > button {
      flex: 1;
      background: #232323;
      border: none;
      padding: 0;
      cursor: pointer;
      color: #aaa;
      font-size: 8px;
      line-height: 1;
      position: relative;
    }
    .pix-li-spin > button:hover { background: #333; color: ${BRAND}; }
    .pix-li-spin-up { border-bottom: 1px solid #444; }
    /* CSS chevron arrows (no extra SVG needed). */
    .pix-li-spin-up::before,
    .pix-li-spin-down::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: 6px;
      height: 6px;
      transform: translate(-50%, -50%) rotate(-45deg);
      border-top: 1px solid currentColor;
      border-right: 1px solid currentColor;
    }
    .pix-li-spin-up::before {
      transform: translate(-50%, -25%) rotate(-45deg);
    }
    .pix-li-spin-down::before {
      transform: translate(-50%, -75%) rotate(135deg);
    }
    /* Width × Height panels (Fit inside, Crop to fill) with swap between. */
    .pix-li-wh-row {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 6px;
      align-items: end;
    }
    .pix-li-wh-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .pix-li-wh-label {
      font-size: 9px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
    }
    /* W/H input is inside a .pix-li-numinput wrap — wrap provides
       border/background. The default 11px input font is fine. */
    .pix-li-wh-input-wrap { width: 100%; }
    /* Generic swap button used between W and H inputs. Height matches
       the trimmed .pix-li-numinput control height (~22 px). */
    .pix-li-swap {
      width: 26px;
      height: 22px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #aaa;
      cursor: pointer;
      padding: 0;
      position: relative;
      align-self: end;
    }
    .pix-li-swap::before {
      content: "";
      position: absolute;
      inset: 0;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/swap.svg") center/12px 12px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/swap.svg") center/12px 12px no-repeat;
      pointer-events: none;
    }
    .pix-li-swap:hover { color: ${BRAND}; border-color: ${BRAND}; }
    /* Aspect-ratio preview block under W / H fields. */
    .pix-li-wh-preview {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
    }
    .pix-li-wh-rect {
      background: rgba(246,103,68,0.18);
      border: 1px solid ${BRAND};
      border-radius: 2px;
      transition: width 0.12s ease, height 0.12s ease;
    }
    .pix-li-wh-rect-label {
      font-size: 9px;
      color: #999;
      font-family: inherit;
    }
    /* Tiny aspect-ratio shape rendered INSIDE each Match-ratio chip,
       same idea Resolution Pixaroma uses to make every ratio recognisable
       at a glance without reading the label. */
    .pix-li-ratio-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .pix-li-shape {
      display: inline-block;
      background: rgba(180,180,180,0.25);
      border: 1px solid #888;
      border-radius: 1px;
      box-sizing: border-box;
      flex-shrink: 0;
    }
    .pix-li-ratio-chip.active .pix-li-shape {
      background: rgba(255,255,255,0.4);
      border-color: rgba(255,255,255,0.85);
    }
    /* Custom chip has no shape (no fixed aspect) — keep text-only. */
    .pix-li-ratio-chip.pix-li-ratio-custom-chip { display: block; }
    .pix-li-global {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .pix-li-snap-row, .pix-li-rs-row {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #1d1d1d;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 5px 8px;
    }
    .pix-li-magnet {
      display: inline-block;
      width: 11px; height: 11px;
      background-color: #888;
      -webkit-mask: url("/pixaroma/assets/icons/ui/magnet.svg") center/11px 11px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/magnet.svg") center/11px 11px no-repeat;
    }
    .pix-li-snap-btns {
      display: inline-flex;
      gap: 2px;
      margin-left: auto;
    }
    .pix-li-snap-btn {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      color: #aaa;
      font-size: 9px;
      padding: 2px 5px;
      min-width: 18px;
      cursor: pointer;
      font-family: inherit;
      line-height: 1;
    }
    .pix-li-snap-btn:hover { color: #ddd; border-color: #666; }
    .pix-li-snap-btn.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    /* Resample row — custom dropdown trigger styled like the file picker. */
    .pix-li-rs-row {
      cursor: pointer;
      user-select: none;
    }
    .pix-li-rs-row:hover { border-color: #666; }
    .pix-li-rs-value {
      color: #ccc;
      font-size: 10px;
      margin-left: auto;
    }
    .pix-li-rs-arrow {
      color: ${BRAND};
      font-size: 9px;
      margin-left: 4px;
    }
    .pix-li-rs-popup {
      position: fixed;
      z-index: 99999;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      font-size: 11px;
      color: #ccc;
      min-width: 200px;
      overflow: hidden;
    }
    .pix-li-rs-item {
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pix-li-rs-item:last-child { border-bottom: none; }
    .pix-li-rs-item:hover { background: #2a2a2a; }
    .pix-li-rs-item.active .pix-li-rs-item-label { color: ${BRAND}; font-weight: 600; }
    .pix-li-rs-item-label { font-size: 11px; }
    .pix-li-rs-item-hint { font-size: 9px; color: #777; }
    .pix-li-up-row {
      background: #1d1d1d;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 5px 8px;
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      user-select: none;
      font-size: 10px;
      color: #aaa;
    }
    .pix-li-up-row input { accent-color: ${BRAND}; cursor: pointer; }
    /* ── Image Resize design language, scoped to .pix-li-root ── */
    /* Centered snap footer: magnet + "Snap" + chips. */
    .pix-li-foot { display:flex; align-items:center; justify-content:center; gap:6px; flex-wrap:wrap; }
    .pix-li-snap2 { display:inline-flex; align-items:center; gap:5px; }
    .pix-li-snap-icon { display:inline-block; width:12px; height:12px; background-color:#888; flex:none;
      -webkit-mask:url("/pixaroma/assets/icons/ui/magnet.svg") center/12px 12px no-repeat;
              mask:url("/pixaroma/assets/icons/ui/magnet.svg") center/12px 12px no-repeat; }
    .pix-li-snap-lbl { font-size:9px; color:#7d7d7d; text-transform:uppercase; letter-spacing:.5px; }
    .pix-li-schip { background:#1d1d1d; border:1px solid #444; border-radius:3px; color:#aaa;
      font-size:8.5px; padding:3px 5px; min-width:16px; text-align:center; cursor:pointer; user-select:none; }
    .pix-li-schip:hover { border-color:${BRAND}; color:#ddd; }
    .pix-li-schip.active { background:${BRAND}; color:#fff; border-color:${BRAND}; }
    /* Resample picker: [◀] [ Resample: Auto ▾ ] [▶] */
    .pix-li-rs2-row { display:flex; align-items:stretch; gap:6px; }
    .pix-li-rs2-nav { flex:0 0 30px; background:#1d1d1d; border:1px solid #444; border-radius:4px;
      color:${BRAND}; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; }
    .pix-li-rs2-nav:hover { border-color:${BRAND}; }
    .pix-li-rs2-dd { flex:1; display:flex; align-items:center; justify-content:space-between;
      background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:6px 10px; cursor:pointer; user-select:none; }
    .pix-li-rs2-dd:hover { border-color:${BRAND}; }
    .pix-li-rs2-value { color:#ddd; font-size:11px; }
    .pix-li-rs2-arrow { color:${BRAND}; font-size:13px; margin-left:6px; line-height:1; }
    /* Upscaling toggle button. */
    .pix-li-upbtn { align-self:center; background:#1d1d1d; border:1px solid #444; border-radius:5px;
      color:#aaa; font-size:11px; padding:7px 18px; cursor:pointer; user-select:none; transition:background .08s,border-color .08s; }
    .pix-li-upbtn:hover { border-color:${BRAND}; color:#ddd; }
    .pix-li-upbtn.is-on, .pix-li-upbtn.is-on:hover { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    /* Per-mode panel overrides (mirror image_resize .pix-ir-root .pix-li-* block). */
    .pix-li-root .pix-li-panel { background:rgba(255,255,255,.04); border:none; border-radius:6px; padding:9px 10px; }
    .pix-li-root .pix-li-panel-readout { display:none; }
    .pix-li-root .pix-li-ratio-chips { margin-bottom:0; }
    .pix-li-root .pix-li-custom-ratio-row { margin:8px 0 0; }
    .pix-li-root .pix-li-input-wide { width:100% !important; max-width:none; }
    .pix-li-root .pix-li-numinput { background:#1d1d1d !important; align-items:center; min-height:28px; }
    .pix-li-root .pix-li-numinput .pix-li-spin { align-self:stretch; }
    .pix-li-root .pix-li-numinput input { line-height:1.2; background:transparent !important; border:none !important; border-radius:0 !important; }
    .pix-li-root .pix-li-inline-label { display:flex; align-items:center; color:${BRAND}; font-size:9px; font-weight:600;
      text-transform:uppercase; letter-spacing:.5px; padding:0 4px 0 9px; white-space:nowrap; flex:none; }
    .pix-li-root .pix-li-num-labeled input { text-align:right !important; padding-right:8px !important; }
    .pix-li-root .pix-li-swap { background:#1d1d1d !important; }
    .pix-li-root .pix-li-wh-header { text-align:center !important; color:#d6d6d6 !important; }
    .pix-li-root .pix-li-wh-rect { background:rgba(246,103,68,0.35); border-width:2px; }
    .pix-li-root .pix-li-wh-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; align-items:center; }
    .pix-li-root .pix-li-wh-col { display:flex; flex-direction:column; gap:6px; min-width:0; }
    .pix-li-root .pix-li-wh-col .pix-li-swap { width:100%; height:24px; align-self:auto; }
    .pix-li-root .pix-li-wh-grid .pix-li-wh-preview { margin-top:0; justify-content:center; }
    /* Filled triangle spinner glyphs (replace shared outline chevrons). NOTE:
       use the literal triangle characters - a backslash-escape inside a JS
       template literal throws (CLAUDE.md UI Pattern #12). */
    .pix-li-root .pix-li-spin { width:16px; border-left:none; }
    .pix-li-root .pix-li-spin > button { background:transparent; }
    .pix-li-root .pix-li-spin-up::before, .pix-li-root .pix-li-spin-down::before {
      border:none; width:auto; height:auto; font-size:8px; line-height:1; transform:translate(-50%,-50%); }
    .pix-li-root .pix-li-spin-up::before { content:"▲"; }
    .pix-li-root .pix-li-spin-down::before { content:"▼"; }
    /* Crop-to-fill extras: Fill/Crop toggle + 3x3 anchor grid. */
    .pix-li-root .pix-li-swaprow { display:flex; gap:6px; align-items:stretch; }
    .pix-li-root .pix-li-wh-col .pix-li-swaprow .pix-li-swap { flex:0 0 46px; width:auto; height:auto; align-self:stretch; }
    .pix-li-root .pix-li-fillcrop { flex:1; display:grid; grid-template-columns:1fr 1fr; background:#1d1d1d; border:1px solid #444; border-radius:4px; overflow:hidden; }
    .pix-li-root .pix-li-fillcrop > div { display:flex; align-items:center; justify-content:center; font-size:9.5px; padding:5px 0; color:#aaa; cursor:pointer; user-select:none; }
    .pix-li-root .pix-li-fillcrop > div:hover { color:#ddd; background:rgba(255,255,255,.08); }
    .pix-li-root .pix-li-fillcrop > div.active { background:${BRAND}; color:#fff; }
    .pix-li-root .pix-li-anchor { display:grid; grid-template-columns:repeat(3,1fr); grid-template-rows:repeat(3,1fr); gap:3px;
      width:100%; max-width:96px; aspect-ratio:1; margin:0 auto; background:#1d1d1d; border:1px solid #444; border-radius:5px; padding:5px; box-sizing:border-box; }
    .pix-li-root .pix-li-anchor-cell { background:rgba(255,255,255,.07); border-radius:2px; cursor:pointer; transition:background .08s; }
    .pix-li-root .pix-li-anchor-cell:hover { background:rgba(255,255,255,.18); }
    .pix-li-root .pix-li-anchor-cell.active { background:${BRAND}; }
    /* Bring shared quick-pick + ratio chips in line (orange hover). */
    .pix-li-root .pix-li-quickpick { box-sizing:border-box; }
    .pix-li-root .pix-li-quickpick:hover { border-color:${BRAND}; color:#ddd; }
    .pix-li-root .pix-li-ratio-chip { box-sizing:border-box; }
    .pix-li-root .pix-li-ratio-chip:hover { border-color:${BRAND}; color:#ddd; }
    /* Collapsible dropdown popup. */
    .pix-li-pop-folder { display:flex; align-items:center; gap:6px; padding:5px 10px; cursor:pointer; user-select:none;
      background:#161616; border-bottom:1px solid #2a2a2a; font-size:9px; color:#999; text-transform:uppercase; letter-spacing:.5px; }
    .pix-li-pop-folder:hover { color:#ddd; }
    .pix-li-pop-folder:not(:first-child) { border-top:1px solid #2a2a2a; }
    .pix-li-pop-caret { display:inline-block; width:8px; color:${BRAND}; font-size:9px; flex:none; transition:transform .08s; }
    .pix-li-pop-foldername { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-li-pop-count { color:#666; font-size:9px; flex:none; }
    .pix-li-pop-files.collapsed { display:none; }
  `;
  const el = document.createElement("style");
  el.id = "pixaroma-load-image-css";
  el.textContent = css;
  document.head.appendChild(el);
}

export function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-li-root";

  // Upload button (orange, prominent, primary action).
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pix-li-upload-btn";
  const ico = document.createElement("span");
  ico.className = "ico";
  const lbl = document.createElement("span");
  lbl.textContent = "Upload Image";
  btn.append(ico, lbl);
  root.appendChild(btn);

  // Hint line for alternate upload methods (shown when no image yet).
  const hint = document.createElement("div");
  hint.className = "pix-li-hint";
  hint.dataset.role = "hint";
  hint.innerHTML = `or drag here · paste with <kbd>Ctrl+V</kbd>`;
  root.appendChild(hint);

  // File row: [◀ prev] [ filename dropdown ] [▶ next]. Arrow buttons cycle
  // through input/ images so users can flip through them visually, matching
  // native ComfyUI LoadImage. Both the prev/next arrows and PageUp/PageDown
  // (wired in index.js) route through setSelectedImage so the bottom preview
  // updates immediately.
  const fileRow = document.createElement("div");
  fileRow.className = "pix-li-filerow";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "pix-li-nav";
  prev.dataset.role = "prev";
  prev.title = "Previous image (PageUp)";
  prev.textContent = "◀";

  const dd = document.createElement("div");
  dd.className = "pix-li-dropdown";
  dd.dataset.role = "dropdown";
  dd.innerHTML = `<span class="name">— no image —</span><span class="counter" data-role="counter"></span><span class="arrow">▾</span>`;

  const next = document.createElement("button");
  next.type = "button";
  next.className = "pix-li-nav";
  next.dataset.role = "next";
  next.title = "Next image (PageDown)";
  next.textContent = "▶";

  fileRow.append(prev, dd, next);
  root.appendChild(fileRow);

  // Dimensions info bar — shows once an image is loaded. Replaces the
  // hint text. Two rows when a resize is active (original → final), one
  // row when mode = Off (only original). Each row has the dims, ratio
  // label, and a tiny aspect rectangle.
  const info = document.createElement("div");
  info.className = "pix-li-diminfo";
  info.dataset.role = "diminfo";
  info.style.display = "none";
  root.appendChild(info);

  return root;
}

// Hides every auto-created widget so we can render our own UI in the DOM
// widget. `image_upload: True` creates TWO widgets in INPUT_TYPES on the
// Vue frontend: the `image` combo + a separate `upload` button widget — both
// need to be hidden, plus any other auto-created widget that isn't ours.
//
// Uses the same multi-technique pattern as shared/utils.mjs `hideJsonWidget`:
// setting `canvasOnly` alone is not enough for canvas drawing on the current
// Vue frontend — must also set `hidden=true`, zero `computeSize`, and hide
// any DOM element. Returns the `image` combo widget so callers can read /
// write its `.value` (that drives the actual file selection).
export function hideNativeImageCombo(node) {
  let imageWidget = null;
  for (const w of (node.widgets || [])) {
    if (!w) continue;
    if (w.name === "image") imageWidget = w;
    w.hidden = true;
    w.computeSize = () => [0, -4];
    if (!w.options) w.options = {};
    w.options.canvasOnly = true;
    if (w.element) w.element.style.display = "none";
  }
  // Vue may DOM-render an upload widget AFTER nodeCreated — re-hide on the
  // next animation frame as a belt-and-braces. Mirrors hideJsonWidget.
  requestAnimationFrame(() => {
    for (const w of (node.widgets || [])) {
      if (!w || w.name === "pixaroma_load_image_ui") continue;
      if (w.element) w.element.style.display = "none";
      if (w.inputEl) w.inputEl.style.display = "none";
    }
  });
  return imageWidget;
}

import { updateNativePreview, setSelectedImage, splitFilenameSubfolder } from "./api.mjs";

// Group combo values by subfolder so the popup renders:
//   ─ root ─
//      file1.png
//      file2.png
//   ─ Studio1 ─
//      bunny.png
// Returns an array of { folder, files } in display order (root first, then
// folders alphabetised). Each `files` entry is { full, name } where `full`
// is the value to write back and `name` is the bare filename to display.
function groupValuesByFolder(values) {
  const map = new Map();
  for (const v of values) {
    const { subfolder, filename } = splitFilenameSubfolder(v);
    if (!map.has(subfolder)) map.set(subfolder, []);
    map.get(subfolder).push({ full: v, name: filename });
  }
  // Sort the file lists alphabetically. Folders: root first, then ABC.
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const folders = [...map.keys()].sort((a, b) => {
    if (a === "" && b !== "") return -1;
    if (a !== "" && b === "") return 1;
    return a.localeCompare(b);
  });
  return folders.map((folder) => ({ folder, files: map.get(folder) }));
}

// Open a popup listing the underlying combo's options grouped by subfolder.
// Clicking an item sets the combo value to the FULL path (e.g.
// "Studio1/bunny.png") and the dropdown's label.
export function openImageDropdown(node, anchorEl, onPick) {
  const imageWidget = node._pixLiImageWidget;
  if (!imageWidget) return;
  const values = imageWidget.options?.values || [];

  // Close any existing popup
  document.querySelector(".pix-li-popup")?.remove();

  const popup = document.createElement("div");
  popup.className = "pix-li-popup";
  Object.assign(popup.style, {
    position: "fixed",
    zIndex: 99999,
    background: "#1d1d1d",
    border: `1px solid #444`,
    borderRadius: "4px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    maxHeight: "300px",
    overflowY: "auto",
    fontSize: "11px",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    color: "#ccc",
    minWidth: "200px",
  });

  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 2}px`;
  popup.style.width = `${rect.width}px`;

  if (values.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "8px";
    empty.style.color = "#666";
    empty.textContent = "(no images uploaded yet)";
    popup.appendChild(empty);
  } else {
    const groups = groupValuesByFolder(values);
    const showHeaders = groups.length > 1 || (groups.length === 1 && groups[0].folder !== "");
    let scrollTarget = null;
    for (const group of groups) {
      if (showHeaders) {
        const head = document.createElement("div");
        head.className = "pix-li-popup-section";
        head.textContent = group.folder === "" ? "root" : group.folder;
        popup.appendChild(head);
      }
      for (const entry of group.files) {
        const item = document.createElement("div");
        item.style.padding = "6px 10px";
        item.style.cursor = "pointer";
        item.style.borderBottom = "1px solid #2a2a2a";
        if (entry.full === imageWidget.value) {
          item.style.color = "#f66744";
          item.style.fontWeight = "600";
          scrollTarget = item;
        }
        item.textContent = entry.name;
        item.title = entry.full; // hover shows full path so it stays discoverable
        item.addEventListener("mouseenter", () => { item.style.background = "#2a2a2a"; });
        item.addEventListener("mouseleave", () => { item.style.background = ""; });
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          setSelectedImage(node, entry.full);
          closePopup();
          if (onPick) onPick(entry.full);
        });
        popup.appendChild(item);
      }
    }
    // Defer until popup is in DOM so scrollTop math is valid
    if (scrollTarget) queueMicrotask(() => {
      try {
        scrollTarget.scrollIntoView({ block: "nearest" });
      } catch (_e) { /* ignore */ }
    });
  }

  document.body.appendChild(popup);

  // Close the popup AND detach every listener. Captured in a single helper
  // so all close paths (click outside, scroll, Escape, canvas pointerdown,
  // node move) go through the same cleanup. Without centralised cleanup,
  // detached listeners would leak and re-close zombie popups on the next open.
  function closePopup() {
    popup.remove();
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
  }
  const onDocDown = (e) => {
    if (!popup.contains(e.target)) closePopup();
  };
  // Only close on wheel OUTSIDE the popup — the popup itself is scrollable
  // (overflowY: auto + maxHeight), users need wheel to navigate the list.
  const onWheel = (e) => {
    if (!popup.contains(e.target)) closePopup();
  };
  const onKey = (e) => {
    if (e.key === "Escape") closePopup();
  };
  // Capture phase so we preempt LiteGraph's canvas handlers, with a
  // setTimeout so the opening click doesn't immediately close. mousedown +
  // pointerdown both — LiteGraph's drag uses pointer events on the canvas,
  // and not every browser fires both reliably in capture phase.
  setTimeout(() => {
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
}

const MODE_CHIPS = [
  { id: "off",            label: "Off" },
  { id: "max_mp",         label: "Max megapixels" },
  { id: "longest_side",   label: "Longest side" },
  { id: "scale_factor",   label: "Scale by ×" },
  { id: "fit_inside",     label: "Fit inside" },
  { id: "cover",          label: "Crop to fill" },
  { id: "match_ratio",    label: "Match aspect ratio", spanFull: true },
];

export function renderChips(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-li-chips";
  for (const c of MODE_CHIPS) {
    const el = document.createElement("div");
    el.className = "pix-li-chip" + (c.spanFull ? " span-full" : "");
    if (state.mode === c.id) el.classList.add("active");
    el.dataset.modeId = c.id;
    el.textContent = c.label;
    wrap.appendChild(el);
  }
  return wrap;
}

const SNAP_OPTIONS = [0, 8, 16, 32, 64];
const RESAMPLE_OPTIONS = [
  { id: "auto",     label: "Auto",     hint: "Lanczos for shrink, Bilinear for grow" },
  { id: "nearest",  label: "Nearest",  hint: "Pixel-perfect, no smoothing" },
  { id: "bilinear", label: "Bilinear", hint: "Fast, smooth" },
  { id: "bicubic",  label: "Bicubic",  hint: "Slower, sharper" },
  { id: "lanczos",  label: "Lanczos",  hint: "Slowest, sharpest" },
];

// Custom resample dropdown popup. Same look as the file dropdown popup —
// fixed-position list anchored to the row, click an item to commit.
function openResamplePopup(anchorEl, currentValue, onPick) {
  document.querySelector(".pix-li-rs-popup")?.remove();

  const popup = document.createElement("div");
  popup.className = "pix-li-rs-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top  = `${rect.bottom + 2}px`;
  popup.style.width = `${rect.width}px`;

  for (const opt of RESAMPLE_OPTIONS) {
    const item = document.createElement("div");
    item.className = "pix-li-rs-item" + (opt.id === currentValue ? " active" : "");
    const lbl = document.createElement("span");
    lbl.className = "pix-li-rs-item-label";
    lbl.textContent = opt.label;
    const hint = document.createElement("span");
    hint.className = "pix-li-rs-item-hint";
    hint.textContent = opt.hint;
    item.append(lbl, hint);
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(opt.id);
      close();
    });
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
  const onDocDown = (e) => {
    if (!popup.contains(e.target)) close();
  };
  const onWheel = (e) => {
    if (!popup.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
}

export function renderGlobalControls(node, state, writeState, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "pix-li-global";

  // Snap row
  const snapRow = document.createElement("div");
  snapRow.className = "pix-li-snap-row";
  const magnet = document.createElement("span");
  magnet.className = "pix-li-magnet";
  snapRow.appendChild(magnet);
  const snapBtns = document.createElement("div");
  snapBtns.className = "pix-li-snap-btns";
  for (const v of SNAP_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pix-li-snap-btn" + (v === (state.snap || 0) ? " active" : "");
    b.textContent = v === 0 ? "Off" : String(v);
    b.dataset.v = String(v);
    snapBtns.appendChild(b);
  }
  snapRow.appendChild(snapBtns);
  wrap.appendChild(snapRow);

  // Resample row — custom Pixaroma-styled dropdown (native <select>
  // renders very differently across Mac/Win/Linux; matching it to the
  // rest of the node's look needs our own popup).
  const rsRow = document.createElement("div");
  rsRow.className = "pix-li-rs-row";
  const rsLabel = document.createElement("span");
  rsLabel.style.fontSize = "10px";
  rsLabel.style.color = "#888";
  rsLabel.textContent = "Resample";
  const rsValue = document.createElement("span");
  rsValue.className = "pix-li-rs-value";
  rsValue.dataset.role = "rs-value";
  const curResample = state.resample || "auto";
  rsValue.textContent = curResample.charAt(0).toUpperCase() + curResample.slice(1);
  const rsArrow = document.createElement("span");
  rsArrow.className = "pix-li-rs-arrow";
  rsArrow.textContent = "▾";
  rsRow.append(rsLabel, rsValue, rsArrow);
  wrap.appendChild(rsRow);

  // Upscale toggle row
  const upRow = document.createElement("label");
  upRow.className = "pix-li-up-row";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!state.allow_upscale;
  const upLbl = document.createElement("span");
  upLbl.textContent = "Allow upscaling";
  upRow.append(cb, upLbl);
  wrap.appendChild(upRow);

  // Wire events
  snapBtns.addEventListener("click", (e) => {
    const b = e.target.closest(".pix-li-snap-btn");
    if (!b) return;
    e.stopPropagation();
    const v = parseInt(b.dataset.v, 10);
    for (const x of snapBtns.querySelectorAll(".pix-li-snap-btn")) {
      x.classList.toggle("active", parseInt(x.dataset.v, 10) === v);
    }
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, snap: v });
    onChange?.();
  });
  rsRow.addEventListener("click", (e) => {
    e.stopPropagation();
    openResamplePopup(rsRow, state.resample || "auto", (picked) => {
      rsValue.textContent = picked.charAt(0).toUpperCase() + picked.slice(1);
      const s = JSON.parse(node.properties?.loadImagePixState || "{}");
      writeState(node, { ...s, resample: picked });
      onChange?.();
    });
  });
  cb.addEventListener("change", () => {
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, allow_upscale: cb.checked });
    onChange?.();
  });

  return wrap;
}
