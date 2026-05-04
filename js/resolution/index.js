import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget } from "../shared/index.mjs";

function injectCSS() {
  if (document.getElementById("pixaroma-resolution-css")) return;
  const css = `
    .pix-res-root {
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
    /* 6-col grid lets us mix 1/3-width ratio chips (span 2) with 1/2-width
       custom chips (span 3) on the same row. */
    .pix-res-chips {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 5px;
    }
    .pix-res-chip {
      grid-column: span 2; /* default = 1/3 width (3 chips per row) */
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 0;
      text-align: center;
      font-size: 10px;
      color: #ccc;
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, border-color 0.08s;
    }
    .pix-res-chip:hover { border-color: #666; }
    .pix-res-chip.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-res-chip.span-half { grid-column: span 3; } /* 1/2 width — used by Custom Ratio + Custom Resolution */
    .pix-res-list {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      /* x clipped (active-row orange tint stays inside rounded border);
         y scrolls if at large browser zoom the rows still wouldn't fit
         (node height is locked, so this is a defensive fallback only). */
      overflow-x: hidden;
      overflow-y: auto;
      /* Preset list takes its natural size (8 fixed-height rows + borders);
         since the widget is sized to exactly accommodate that, no extra space
         appears in either direction. Custom panel overrides to flex:1 so its
         preview rect can absorb the panel's vertical space. */
      flex: 0 1 auto;
      display: flex;
      flex-direction: column;
    }
    .pix-res-list.pix-res-custom {
      flex: 1;
      min-height: 160px;
    }
    /* Slim, theme-matched scrollbar so the list doesn't get a fat default bar. */
    .pix-res-list::-webkit-scrollbar { width: 6px; }
    .pix-res-list::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
    .pix-res-list::-webkit-scrollbar-track { background: transparent; }
    /* Subtle focus indicator: brand-tinted border (no outline ring overflow). */
    .pix-res-list:focus { outline: none; border-color: ${BRAND}; }
    .pix-res-row {
      /* Fixed row height — must NOT grow with the node, otherwise resizing
         taller bloats every row to a giant cell. flex-shrink: 0 + the parent
         list's overflow-y: auto means rows stay readable and the list scrolls
         instead when the widget is too short to fit all 8. */
      flex: 0 0 28px;
      box-sizing: border-box;
      padding: 4px 8px;
      border-bottom: 1px solid #2f2f2f;
      font-size: 11px;
      text-align: center;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ui-monospace, monospace;
      color: #ccc;
    }
    .pix-res-row:last-child { border-bottom: none; }
    .pix-res-row.active {
      background: rgba(246,103,68,0.15);
      color: ${BRAND};
      font-weight: 600;
    }
    .pix-res-row.empty {
      cursor: default;
      color: #2a2a2a;
    }
    .pix-res-custom {
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pix-res-custom-row {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 6px;
      align-items: end; /* push the swap icon down so it sits next to the input boxes, not the labels */
    }
    .pix-res-custom-field { display: flex; flex-direction: column; gap: 3px; }
    .pix-res-custom-field label {
      font-size: 9px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
    }
    .pix-res-custom-field input {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      color: ${BRAND};
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      font-family: ui-monospace, monospace;
      box-sizing: border-box;
      width: 100%;
    }
    .pix-res-custom-field input:focus {
      outline: none;
      border-color: ${BRAND};
    }
    /* Square icon button placed BETWEEN the W and H inputs (Figma/Photoshop pattern).
       Uses CSS mask-image so the SVG inherits color via the button's color property
       — same technique Note Pixaroma uses for toolbar mask-icons. */
    .pix-res-swap {
      width: 32px;
      height: 32px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #aaa;
      cursor: pointer;
      padding: 0;
      position: relative;
      display: inline-block;
    }
    .pix-res-swap::before {
      content: "";
      position: absolute;
      inset: 0;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/swap.svg") center / 16px 16px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/swap.svg") center / 16px 16px no-repeat;
      pointer-events: none;
    }
    .pix-res-swap:hover { color: ${BRAND}; border-color: ${BRAND}; }
    .pix-res-readout {
      display: flex;
      align-items: center;
      /* snap-group pinned left, ratio/MP pinned right — text length changes
         on the right side then can't push the snap chips around. */
      justify-content: space-between;
      gap: 6px;
      padding: 0 2px;
      font-size: 10px;
      color: #777;
    }
    .pix-res-readout .accent { color: ${BRAND}; }
    /* Aspect-ratio visual preview — fills the remaining custom-panel space.
       The inner rect is scaled to the chosen W:H ratio so the user sees the
       shape they'll get at a glance. Label below shows the exact W × H. */
    .pix-res-preview {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding-top: 4px;
      min-height: 0;
    }
    .pix-res-preview-rect {
      background: rgba(246, 103, 68, 0.18);
      border: 1px solid ${BRAND};
      border-radius: 2px;
      transition: width 0.15s ease, height 0.15s ease;
    }
    .pix-res-preview-label {
      font-family: ui-monospace, monospace;
      font-size: 10px;
      color: #999;
    }
    .pix-res-preview-label .accent { color: ${BRAND}; }
    /* Snap-step picker — magnet label + 4 small chip buttons (8/16/32/64). */
    .pix-res-snap-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pix-res-snap-icon {
      display: inline-block;
      width: 11px;
      height: 11px;
      background-color: #888;
      -webkit-mask: url("/pixaroma/assets/icons/ui/magnet.svg") center / 11px 11px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/magnet.svg") center / 11px 11px no-repeat;
      pointer-events: none;
    }
    .pix-res-snap-btns {
      display: inline-flex;
      gap: 2px;
    }
    .pix-res-snap-btn {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      color: #aaa;
      font-size: 9px;
      padding: 2px 5px;
      min-width: 18px;
      cursor: pointer;
      font-family: ui-monospace, monospace;
      line-height: 1;
    }
    .pix-res-snap-btn:hover { color: #ddd; border-color: #666; }
    .pix-res-snap-btn.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }

    /* Custom Ratio panel — Photoshop "lock-aspect" pattern. Sections top to
       bottom: (1) ratio inputs (W:H typed once), (2) quick-pick width chips
       (S/M/L/XL), (3) W and H math-aware inputs side-by-side (edit either,
       counterpart auto-computes from ratio), (4) aspect preview, (5) footer
       (snap picker + ratio·MP). Reuses .pix-res-custom-* layout for fields —
       the wrap element gets both classes so it inherits the custom-mode shell
       (padding, gap, flex column) without needing a duplicate rule here. */
    .pix-res-ratio-input-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .pix-res-ratio-input-row .pix-res-ratio-label {
      font-size: 9px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .pix-res-ratio-input-row input {
      width: 42px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 3px;
      padding: 4px 6px;
      color: ${BRAND};
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      font-family: ui-monospace, monospace;
      box-sizing: border-box;
    }
    .pix-res-ratio-input-row input:focus { outline: none; border-color: ${BRAND}; }
    .pix-res-ratio-swap {
      width: 22px;
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
    .pix-res-ratio-swap::before {
      content: "";
      position: absolute;
      inset: 0;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/swap.svg") center / 12px 12px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/swap.svg") center / 12px 12px no-repeat;
      pointer-events: none;
    }
    .pix-res-ratio-swap:hover { color: ${BRAND}; border-color: ${BRAND}; }
    /* Quick-pick width chips — 4 evenly-spaced buttons under the ratio row. */
    .pix-res-quickpicks {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
    }
    .pix-res-quickpick {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      color: #ccc;
      padding: 5px 0;
      font-size: 10px;
      font-family: ui-monospace, monospace;
      cursor: pointer;
      transition: background 0.08s, border-color 0.08s;
    }
    .pix-res-quickpick:hover { border-color: #666; color: #fff; }
    .pix-res-quickpick.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
  `;
  const style = document.createElement("style");
  style.id = "pixaroma-resolution-css";
  style.textContent = css;
  document.head.appendChild(style);
}
injectCSS();

// Node dimensions are LOCKED — width and height. The original "make it
// resizable" attempt was a workaround for the default height being too small
// to show all 8 preset rows; once that's fixed, there's no real reason to
// resize, and a resizable node just produces an awkward dark empty band when
// dragged taller. Locking matches the canvas-side res-node pattern and is
// honest: the node draws exactly what fits its content.
//
// NODE_H sized so all 8 preset rows fit at 100% browser zoom with NO
// scrollbar — exact content breakdown (in pixels of widget area):
//   root padding (8 top + 8 bottom) ............... 16
//   chip grid (4 rows × 26 + 3 × 5 gap) ............ 119
//     ├─ row 1: 1:1 / 16:9 / 9:16
//     ├─ row 2: 2:1 / 3:2 / 2:3
//     ├─ row 3: 4:3 / 3:4 / 4:5
//     └─ row 4: Custom Ratio / Custom Resolution (half-width chips)
//   gap between chips and list ..................... 8
//   size list ..................................... 233
//     ├─ borders (1 top + 1 bottom) ........  2
//     ├─ rows (8 × 28 fixed-height) ....... 224
//     └─ inter-row borders (7 × 1) .........  7
//   DOM widget `margin: 4` (top + bottom) ........... 8
//                                                  ----
//   widget content total ......................... 384
//   chrome (titlebar + port row + frame margins) ... 46
//                                                  ----
//   NODE_H ....................................... 430
//
// 435 chosen with a 5-px safety margin for sub-pixel rounding, font metric
// variance across browsers, and the focus-state border swap.
const NODE_W = 240;
const NODE_H = 435;

// Python uses `hidden` inputs (no widget, no slot dot). State lives on
// node.properties[STATE_PROP] which LiteGraph serializes natively in the
// workflow JSON. The JS-side hook (app.graphToPrompt) injects the state
// into the API prompt as the `ResolutionState` hidden input at run time.
const STATE_PROP = "resolutionState";
const HIDDEN_INPUT_NAME = "ResolutionState"; // matches Python INPUT_TYPES key

const DEFAULT_STATE = {
  mode: "preset", // "preset" | "custom" | "custom_ratio"
  ratio: "1:1",
  w: 1024,
  h: 1024,
  custom_w: 1024,
  custom_h: 1024,
  // Custom Ratio mode — user types a ratio (e.g. 4:3) and picks from
  // generated sizes. Defaults to a popular non-preset ratio so the panel
  // shows useful sizes the moment the user clicks the chip.
  custom_ratio_w: 4,
  custom_ratio_h: 3,
  snap: 16, // px step for Custom mode commit + arrow-key nudge (8 / 16 / 32 / 64)
};

const SNAP_OPTIONS = [8, 16, 32, 64];

function readState(node) {
  // Primary: node.properties (current architecture).
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return { ...DEFAULT_STATE, ...JSON.parse(v) }; }
    catch { /* fall through to migration */ }
  }
  // Migration: workflows saved with the old widget-based architecture have
  // their state in node.widgets_values[0] as a JSON string. Detect, migrate,
  // and persist into node.properties so the next save is in the new format.
  const wv = node.widgets_values;
  if (Array.isArray(wv)) {
    for (const x of wv) {
      if (typeof x === "string" && x.includes('"mode"')) {
        try {
          const parsed = JSON.parse(x);
          if (parsed && typeof parsed === "object" && "ratio" in parsed) {
            writeState(node, { ...DEFAULT_STATE, ...parsed });
            return { ...DEFAULT_STATE, ...parsed };
          }
        } catch { /* not our JSON, keep looking */ }
      }
    }
  }
  return { ...DEFAULT_STATE };
}

function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

// Chip layout — order matches design spec
const CHIPS = [
  { id: "1:1",    label: "1:1" },
  { id: "16:9",   label: "16:9" },
  { id: "9:16",   label: "9:16" },
  { id: "2:1",    label: "2:1" },
  { id: "3:2",    label: "3:2" },
  { id: "2:3",    label: "2:3" },
  { id: "4:3",    label: "4:3" },
  { id: "3:4",    label: "3:4" },
  { id: "4:5",    label: "4:5" },
  { id: "custom_ratio", label: "Custom Ratio", spanHalf: true },
  { id: "custom",       label: "Custom Resolution", spanHalf: true },
];

// Sizes per ratio — 8 entries each. The first two of 16:9/9:16/2:1 are the
// de facto AI-video standards (Wan 2.2, CogVideoX, AnimateDiff) and aren't
// mathematically exact for the ratio (e.g. 832×480 ≈ 1.733 vs 16:9 = 1.778).
// 4:3, 3:4, 4:5 use strict ratios with /16-aligned dimensions (SDXL-friendly).
// 4:5 includes 1152×1440 — the AI-friendly equivalent of Instagram portrait
// (native 1080×1350), a frequent ask for social-media workflows.
const SIZES = {
  "1:1":  [[512,512],[768,768],[1024,1024],[1280,1280],[1328,1328],[1408,1408],[1536,1536],[2048,2048]],
  "16:9": [[832,480],[1280,720],[1344,768],[1536,864],[1600,896],[1664,928],[1792,1008],[1920,1088]],
  "9:16": [[480,832],[720,1280],[768,1344],[864,1536],[896,1600],[928,1664],[1008,1792],[1088,1920]],
  "2:1":  [[512,256],[1024,512],[1280,640],[1536,768],[1600,800],[1792,896],[1920,960],[2048,1024]],
  "3:2":  [[768,512],[1024,680],[1152,768],[1344,896],[1536,1024],[1632,1088],[1728,1152],[1920,1280]],
  "2:3":  [[512,768],[680,1024],[768,1152],[896,1344],[1024,1536],[1088,1632],[1152,1728],[1280,1920]],
  "4:3":  [[512,384],[640,480],[768,576],[1024,768],[1280,960],[1408,1056],[1600,1200],[1920,1440]],
  "3:4":  [[384,512],[480,640],[576,768],[768,1024],[960,1280],[1056,1408],[1200,1600],[1440,1920]],
  "4:5":  [[512,640],[640,800],[768,960],[832,1040],[1024,1280],[1152,1440],[1280,1600],[1536,1920]],
};

// Default size auto-selected when the user clicks a ratio chip. Picked to be
// the most common/useful starting point per ratio — not the smallest entry.
const DEFAULT_PER_RATIO = {
  "1:1":  [1024, 1024],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "2:1":  [1280, 640],
  "3:2":  [1152, 768],
  "2:3":  [768, 1152],
  "4:3":  [1024, 768],
  "3:4":  [768, 1024],
  "4:5":  [1024, 1280], // SDXL-friendly portrait + Instagram-portrait equivalent
};

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a || 1;
}

function ratioLabel(w, h) {
  const g = gcd(w, h);
  const rw = w / g, rh = h / g;
  const known = ["1:1","16:9","9:16","2:1","1:2","3:2","2:3","4:3","3:4","4:5","5:4"];
  const simple = `${rw}:${rh}`;
  if (known.includes(simple)) return simple;
  const r = w / h;
  return r >= 1 ? `~${r.toFixed(2)}:1` : `~1:${(1 / r).toFixed(2)}`;
}

function megapixels(w, h) {
  return ((w * h) / 1_000_000).toFixed(2);
}

function snapTo(n, step) { return Math.round(n / step) * step; }
function clampDim(n) { return Math.max(256, Math.min(4096, n)); }

// Return v if it's a finite positive integer, otherwise fallback. Used for
// `custom_ratio_w` / `custom_ratio_h` reads — a corrupted/malicious workflow
// JSON could supply a string ("0", "<img...>"), 0, or a negative number, all
// of which slip past `?? 4` (nullish only). Coercing here closes both the
// XSS vector (string into innerHTML) and the divide-by-zero / negative path.
function safePositiveInt(v, fallback) {
  const n = +v;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Quick-pick width values for Custom Ratio mode — common AI-friendly widths.
// 512 (low-VRAM/draft), 768 (SD1.5 native), 1024 (SDXL native), 1536 (high-res).
// Click sets W to this value; H auto-computes from the typed ratio + snap.
const QUICK_PICK_WIDTHS = [512, 768, 1024, 1536];

// Tiny safe math evaluator for the W/H inputs — supports `+ - * / ( )` and
// decimals only. Hand-rolled recursive descent. NEVER use eval() / Function()
// here: even though the field is per-node, accepting arbitrary JS would let a
// shared workflow execute code on import. Returns NaN for any invalid input.
// Examples: "1024", "1024+128", "512*2", "(1024+128)/2", "1024 + 128".
function safeMathEval(str) {
  if (typeof str !== "string") return NaN;
  const s = str.trim();
  if (!s) return NaN;
  // Whitelist all chars up front so the parser never sees a stray identifier.
  if (!/^[0-9+\-*/().\s]+$/.test(s)) return NaN;
  // Hard length cap — defends against pathological inputs reaching the parser.
  if (s.length > 256) return NaN;

  let pos = 0;
  // Recursion depth cap — prevents stack overflow from deeply-nested parens
  // like "((((...1...))))". Threshold 64 is well above any realistic
  // expression and safely below browser stack limits.
  const MAX_DEPTH = 64;
  let depth = 0;
  const skipWs = () => { while (pos < s.length && s[pos] === " ") pos++; };
  const eat = (ch) => { skipWs(); if (s[pos] === ch) { pos++; return true; } return false; };

  function parseExpr() {
    let v = parseTerm();
    for (;;) {
      skipWs();
      if (eat("+")) v += parseTerm();
      else if (eat("-")) v -= parseTerm();
      else break;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    for (;;) {
      skipWs();
      if (eat("*")) v *= parseFactor();
      else if (eat("/")) {
        const d = parseFactor();
        if (d === 0) return NaN;
        v /= d;
      } else break;
    }
    return v;
  }
  function parseFactor() {
    if (++depth > MAX_DEPTH) return NaN;
    skipWs();
    if (eat("+"))  { const r = parseFactor(); depth--; return r; }
    if (eat("-"))  { const r = -parseFactor(); depth--; return r; }
    if (eat("(")) {
      const v = parseExpr();
      if (!eat(")")) { depth--; return NaN; }
      depth--;
      return v;
    }
    let num = "";
    while (pos < s.length && /[0-9.]/.test(s[pos])) num += s[pos++];
    depth--;
    if (!num) return NaN;
    // Reject malformed numbers like "1.2.3" — parseFloat would silently
    // truncate to 1.2 and the trailing-garbage check below wouldn't catch it.
    if ((num.match(/\./g) || []).length > 1) return NaN;
    return parseFloat(num);
  }

  const v = parseExpr();
  skipWs();
  if (pos !== s.length) return NaN; // trailing garbage
  return v;
}

function renderChipGrid(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-chips";
  for (const c of CHIPS) {
    const el = document.createElement("div");
    el.className = "pix-res-chip" + (c.spanHalf ? " span-half" : "");
    el.textContent = c.label;
    el.dataset.chipId = c.id;
    const isActive =
      (c.id === "custom" && state.mode === "custom") ||
      (c.id === "custom_ratio" && state.mode === "custom_ratio") ||
      (c.id !== "custom" && c.id !== "custom_ratio" &&
       state.mode === "preset" && state.ratio === c.id);
    if (isActive) el.classList.add("active");
    wrap.appendChild(el);
  }
  return wrap;
}

function renderSizeList(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-list";
  // Make the list focusable so ArrowUp/Down/Home/End change the active row.
  // Custom mode renders its own .pix-res-list (with .pix-res-custom) and
  // doesn't need this — its W/H inputs own keyboard input.
  wrap.tabIndex = 0;
  if (state.mode !== "preset") return wrap; // Custom mode handled in Task 5
  const sizes = SIZES[state.ratio] || [];
  // Render 8 rows; pad with .empty rows if the ratio has fewer than 8
  for (let i = 0; i < 8; i++) {
    const row = document.createElement("div");
    row.className = "pix-res-row";
    if (i >= sizes.length) {
      row.classList.add("empty");
      row.textContent = "";
      wrap.appendChild(row);
      continue;
    }
    const [w, h] = sizes[i];
    row.textContent = `${w} × ${h}`;
    row.dataset.w = String(w);
    row.dataset.h = String(h);
    if (state.w === w && state.h === h) row.classList.add("active");
    wrap.appendChild(row);
  }
  return wrap;
}

function renderCustomPanel(node, state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-list pix-res-custom";

  const row = document.createElement("div");
  row.className = "pix-res-custom-row";

  // Inputs are `type="text"` (not `number`) so users can type math expressions
  // like `1024+128` or `512*2`. We evaluate via safeMathEval on commit and on
  // ArrowUp/Down (custom snap-stepping). `inputmode="decimal"` keeps mobile
  // keypads numeric; the visible spinner buttons are gone but Up/Down arrows
  // step by snap (replacing the native HTML5 number-input stepper).
  const wField = document.createElement("div");
  wField.className = "pix-res-custom-field";
  const wLabel = document.createElement("label");
  wLabel.textContent = "Width";
  const wInput = document.createElement("input");
  wInput.type = "text";
  wInput.inputMode = "decimal";
  wInput.spellcheck = false;
  wInput.autocomplete = "off";
  wInput.title = "Math allowed: 1024+128, 512*2, (1024+128)/2";
  wInput.value = String(state.w);

  const hField = document.createElement("div");
  hField.className = "pix-res-custom-field";
  const hLabel = document.createElement("label");
  hLabel.textContent = "Height";
  const hInput = document.createElement("input");
  hInput.type = "text";
  hInput.inputMode = "decimal";
  hInput.spellcheck = false;
  hInput.autocomplete = "off";
  hInput.title = "Math allowed: 1024+128, 512*2, (1024+128)/2";
  hInput.value = String(state.h);

  wField.append(wLabel, wInput);
  hField.append(hLabel, hInput);

  const swap = document.createElement("button");
  swap.type = "button";
  swap.className = "pix-res-swap";
  swap.title = "Swap Width ↔ Height";
  swap.setAttribute("aria-label", "Swap Width and Height");

  // Place the swap icon BETWEEN the two input fields (Figma/Photoshop pattern).
  row.append(wField, swap, hField);

  const readout = document.createElement("div");
  readout.className = "pix-res-readout";

  // Snap-step picker: magnet icon + 4 small chip buttons (8/16/32/64).
  // Click to set; the active value is highlighted in brand orange.
  const snapGroup = document.createElement("div");
  snapGroup.className = "pix-res-snap-group";
  snapGroup.title = "Snap step (also drives Up/Down arrow nudge)";
  const snapIcon = document.createElement("span");
  snapIcon.className = "pix-res-snap-icon";
  const snapBtns = document.createElement("div");
  snapBtns.className = "pix-res-snap-btns";
  const snapBtnEls = [];
  for (const v of SNAP_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pix-res-snap-btn" + (v === (state.snap || 16) ? " active" : "");
    btn.textContent = String(v);
    btn.dataset.v = String(v);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      applySnap(v);
    });
    snapBtns.appendChild(btn);
    snapBtnEls.push(btn);
  }
  snapGroup.append(snapIcon, snapBtns);

  function applySnap(v) {
    for (const b of snapBtnEls) {
      b.classList.toggle("active", parseInt(b.dataset.v, 10) === v);
    }
    // Inputs are type="text" now (math support); no native step attr to update.
    // Arrow-key stepping reads the snap value at keypress time, so this just
    // needs to land in state and re-commit so the W/H snap to the new step.
    const cur = readState(node);
    writeState(node, { ...cur, snap: v });
    commit();
  }

  const ratioMP = document.createElement("span");

  readout.append(snapGroup, ratioMP);

  // Aspect-ratio visual preview — orange-tinted rectangle scaled to the
  // chosen W:H, with the exact W × H labeled below it.
  const preview = document.createElement("div");
  preview.className = "pix-res-preview";
  const previewRect = document.createElement("div");
  previewRect.className = "pix-res-preview-rect";
  const previewLabel = document.createElement("div");
  previewLabel.className = "pix-res-preview-label";
  preview.append(previewRect, previewLabel);

  // Maximum bounding box for the rectangle. Tuned so a 1:1 fits comfortably
  // inside the empty space below the readout in the locked node.
  const PREVIEW_MAX_W = 90;
  const PREVIEW_MAX_H = 60;

  function refreshPreview(w, h) {
    const aspect = w / h;
    let pw, ph;
    if (aspect >= PREVIEW_MAX_W / PREVIEW_MAX_H) {
      pw = PREVIEW_MAX_W;
      ph = PREVIEW_MAX_W / aspect;
    } else {
      ph = PREVIEW_MAX_H;
      pw = PREVIEW_MAX_H * aspect;
    }
    previewRect.style.width = `${pw}px`;
    previewRect.style.height = `${ph}px`;
    previewLabel.innerHTML = `<span class="accent">${w}</span> × <span class="accent">${h}</span>`;
  }
  refreshPreview(state.w, state.h);

  function refreshReadout(w, h) {
    ratioMP.innerHTML =
      `<span class="accent">${ratioLabel(w, h)}</span> · ${megapixels(w, h)} MP`;
    refreshPreview(w, h);
  }
  refreshReadout(state.w, state.h);

  function commit() {
    const cur = readState(node);
    const step = cur.snap || 16;
    const wRaw = safeMathEval(wInput.value);
    const hRaw = safeMathEval(hInput.value);
    // Invalid expression / empty → fall back to the LAST committed value so a
    // typo doesn't replace the user's working state with a default.
    const wNew = clampDim(snapTo(Number.isFinite(wRaw) && wRaw > 0 ? wRaw : cur.w, step));
    const hNew = clampDim(snapTo(Number.isFinite(hRaw) && hRaw > 0 ? hRaw : cur.h, step));
    wInput.value = String(wNew);
    hInput.value = String(hNew);
    refreshReadout(wNew, hNew);
    writeState(node, { ...cur, w: wNew, h: hNew, custom_w: wNew, custom_h: hNew });
  }


  function liveUpdate() {
    const wLive = safeMathEval(wInput.value);
    const hLive = safeMathEval(hInput.value);
    // Only refresh the readout/preview when BOTH expressions evaluate cleanly.
    // Otherwise the preview rectangle would jitter between valid keystrokes.
    if (Number.isFinite(wLive) && Number.isFinite(hLive) && wLive > 0 && hLive > 0) {
      refreshReadout(wLive, hLive);
    }
  }
  wInput.addEventListener("input", liveUpdate);
  hInput.addEventListener("input", liveUpdate);

  wInput.addEventListener("blur", commit);
  hInput.addEventListener("blur", commit);

  // Replace native HTML5 number-input stepping with snap-aware arrow stepping.
  // Up/Down increments by the current snap value (8/16/32/64); Shift+Up/Down
  // by 4× for coarse jumps. Evaluates the current expression first so users
  // can do "1024+8" then ArrowUp without losing the math.
  function stepInput(input, dir, multiplier) {
    const cur = readState(node);
    const step = (cur.snap || 16) * multiplier;
    const v = safeMathEval(input.value);
    const base = Number.isFinite(v) && v > 0 ? v : (input === wInput ? cur.w : cur.h);
    const next = clampDim(snapTo(base + dir * step, cur.snap || 16));
    input.value = String(next);
    liveUpdate();
  }

  for (const inp of [wInput, hInput]) {
    inp.addEventListener("keydown", (e) => {
      // Always block ComfyUI canvas shortcuts from firing while typing.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        inp.blur();
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? 1 : -1;
        const mult = e.shiftKey ? 4 : 1;
        stepInput(inp, dir, mult);
      }
    });
  }

  swap.addEventListener("click", () => {
    // Use safeMathEval too — the user may have typed math in either field.
    const w = safeMathEval(wInput.value);
    const h = safeMathEval(hInput.value);
    const wOk = Number.isFinite(w) && w > 0 ? w : state.w;
    const hOk = Number.isFinite(h) && h > 0 ? h : state.h;
    wInput.value = String(hOk);
    hInput.value = String(wOk);
    commit();
  });

  // swap is already inside `row` (between W and H fields), don't append again.
  wrap.append(row, readout, preview);
  return wrap;
}

function renderCustomRatioPanel(node, state) {
  // Photoshop "lock-aspect" pattern: user types W:H ratio once, then either
  // (a) clicks a quick-pick width chip, or (b) types into the W or H input
  // (math expressions allowed). The other dimension auto-computes from the
  // ratio and is snapped to /8/16/32/64 for AI alignment.
  const wrap = document.createElement("div");
  wrap.className = "pix-res-list pix-res-custom pix-res-ratio";

  // ── ratio inputs row (W : H, swap between) ──────────────────
  const ratioRow = document.createElement("div");
  ratioRow.className = "pix-res-ratio-input-row";

  const lbl = document.createElement("span");
  lbl.className = "pix-res-ratio-label";
  lbl.textContent = "Ratio";

  const rwInput = document.createElement("input");
  rwInput.type = "text";
  rwInput.inputMode = "numeric";
  rwInput.spellcheck = false;
  rwInput.autocomplete = "off";
  rwInput.value = String(safePositiveInt(state.custom_ratio_w, 4));
  rwInput.title = "Ratio width (positive integer)";

  const rhInput = document.createElement("input");
  rhInput.type = "text";
  rhInput.inputMode = "numeric";
  rhInput.spellcheck = false;
  rhInput.autocomplete = "off";
  rhInput.value = String(safePositiveInt(state.custom_ratio_h, 3));
  rhInput.title = "Ratio height (positive integer)";

  const ratioSwap = document.createElement("button");
  ratioSwap.type = "button";
  ratioSwap.className = "pix-res-ratio-swap";
  ratioSwap.title = "Swap ratio W ↔ H";
  ratioSwap.setAttribute("aria-label", "Swap ratio width and height");

  ratioRow.append(lbl, rwInput, ratioSwap, rhInput);

  // ── quick-pick width chips ──────────────────────────────────
  const quickRow = document.createElement("div");
  quickRow.className = "pix-res-quickpicks";
  const quickBtnEls = [];
  for (const w of QUICK_PICK_WIDTHS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pix-res-quickpick";
    btn.textContent = String(w);
    btn.dataset.w = String(w);
    quickRow.appendChild(btn);
    quickBtnEls.push(btn);
  }

  // ── W and H math-aware inputs (side-by-side, no swap between — ratio swap
  //    above already handles orientation flip) ────────────────────────────
  const fieldsRow = document.createElement("div");
  fieldsRow.className = "pix-res-custom-row";
  fieldsRow.style.gridTemplateColumns = "1fr 1fr"; // override 1fr auto 1fr (no swap col)

  const wField = document.createElement("div");
  wField.className = "pix-res-custom-field";
  const wLabel = document.createElement("label");
  wLabel.textContent = "Width";
  const wInput = document.createElement("input");
  wInput.type = "text";
  wInput.inputMode = "decimal";
  wInput.spellcheck = false;
  wInput.autocomplete = "off";
  wInput.title = "Math allowed: 1024+128, 512*2 — height auto-computes from ratio";
  wInput.value = String(state.w);
  wField.append(wLabel, wInput);

  const hField = document.createElement("div");
  hField.className = "pix-res-custom-field";
  const hLabel = document.createElement("label");
  hLabel.textContent = "Height";
  const hInput = document.createElement("input");
  hInput.type = "text";
  hInput.inputMode = "decimal";
  hInput.spellcheck = false;
  hInput.autocomplete = "off";
  hInput.title = "Math allowed: 1024+128, 512*2 — width auto-computes from ratio";
  hInput.value = String(state.h);
  hField.append(hLabel, hInput);

  fieldsRow.append(wField, hField);

  // ── readout (snap picker + ratio·MP) + aspect preview ─────────
  const readout = document.createElement("div");
  readout.className = "pix-res-readout";

  const snapGroup = document.createElement("div");
  snapGroup.className = "pix-res-snap-group";
  snapGroup.title = "Snap step (also drives Up/Down arrow nudge)";
  const snapIcon = document.createElement("span");
  snapIcon.className = "pix-res-snap-icon";
  const snapBtns = document.createElement("div");
  snapBtns.className = "pix-res-snap-btns";
  const snapBtnEls = [];
  for (const v of SNAP_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pix-res-snap-btn" + (v === (state.snap || 16) ? " active" : "");
    btn.textContent = String(v);
    btn.dataset.v = String(v);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cur = readState(node);
      writeState(node, { ...cur, snap: v });
      for (const b of snapBtnEls) b.classList.toggle("active", parseInt(b.dataset.v, 10) === v);
      // Re-snap current W and recompute H so visible values reflect new step.
      const w = safeMathEval(wInput.value);
      if (Number.isFinite(w) && w > 0) {
        commitFromW(w);
      }
    });
    snapBtns.appendChild(btn);
    snapBtnEls.push(btn);
  }
  snapGroup.append(snapIcon, snapBtns);

  const ratioMP = document.createElement("span");
  readout.append(snapGroup, ratioMP);

  const preview = document.createElement("div");
  preview.className = "pix-res-preview";
  const previewRect = document.createElement("div");
  previewRect.className = "pix-res-preview-rect";
  const previewLabel = document.createElement("div");
  previewLabel.className = "pix-res-preview-label";
  preview.append(previewRect, previewLabel);

  const PREVIEW_MAX_W = 90;
  const PREVIEW_MAX_H = 60;

  function refreshPreview(w, h) {
    const aspect = w / h;
    let pw, ph;
    if (aspect >= PREVIEW_MAX_W / PREVIEW_MAX_H) {
      pw = PREVIEW_MAX_W;
      ph = PREVIEW_MAX_W / aspect;
    } else {
      ph = PREVIEW_MAX_H;
      pw = PREVIEW_MAX_H * aspect;
    }
    previewRect.style.width = `${pw}px`;
    previewRect.style.height = `${ph}px`;
    previewLabel.innerHTML = `<span class="accent">${w}</span> × <span class="accent">${h}</span>`;
  }

  function refreshReadout(w, h) {
    // In Custom Ratio mode the user's TYPED ratio is the source of truth, so
    // show that label even when /16 snap drifts the actual W:H slightly.
    const cur = readState(node);
    const rW = safePositiveInt(cur.custom_ratio_w, 4);
    const rH = safePositiveInt(cur.custom_ratio_h, 3);
    ratioMP.innerHTML =
      `<span class="accent">${rW}:${rH}</span> · ${megapixels(w, h)} MP`;
    refreshPreview(w, h);
    // Reflect quick-pick "active" chip if W matches an exact preset.
    for (const b of quickBtnEls) {
      b.classList.toggle("active", parseInt(b.dataset.w, 10) === w);
    }
  }
  refreshReadout(state.w, state.h);

  // ── core commit helpers ──────────────────────────────────────────
  // Given a Width value, snap it and derive Height from current ratio.
  // Writes both to state and updates the inputs / readout.
  function commitFromW(rawW) {
    const cur = readState(node);
    const step = cur.snap || 16;
    const rW = safePositiveInt(cur.custom_ratio_w, 4);
    const rH = safePositiveInt(cur.custom_ratio_h, 3);
    const w = clampDim(snapTo(rawW, step));
    const h = clampDim(snapTo((w * rH) / rW, step));
    wInput.value = String(w);
    hInput.value = String(h);
    refreshReadout(w, h);
    writeState(node, { ...cur, w, h });
  }

  // Given a Height value, snap it and derive Width from current ratio.
  function commitFromH(rawH) {
    const cur = readState(node);
    const step = cur.snap || 16;
    const rW = safePositiveInt(cur.custom_ratio_w, 4);
    const rH = safePositiveInt(cur.custom_ratio_h, 3);
    const h = clampDim(snapTo(rawH, step));
    const w = clampDim(snapTo((h * rW) / rH, step));
    wInput.value = String(w);
    hInput.value = String(h);
    refreshReadout(w, h);
    writeState(node, { ...cur, w, h });
  }

  // ── live preview while typing (no commit until blur) ─────────────
  function liveUpdate(input, isWidth) {
    const v = safeMathEval(input.value);
    if (!Number.isFinite(v) || v <= 0) return;
    const cur = readState(node);
    const rW = safePositiveInt(cur.custom_ratio_w, 4);
    const rH = safePositiveInt(cur.custom_ratio_h, 3);
    if (isWidth) {
      refreshReadout(Math.round(v), Math.round((v * rH) / rW));
    } else {
      refreshReadout(Math.round((v * rW) / rH), Math.round(v));
    }
  }
  wInput.addEventListener("input", () => liveUpdate(wInput, true));
  hInput.addEventListener("input", () => liveUpdate(hInput, false));

  // ── input commit on blur ─────────────────────────────────────────
  wInput.addEventListener("blur", () => {
    const v = safeMathEval(wInput.value);
    const cur = readState(node);
    commitFromW(Number.isFinite(v) && v > 0 ? v : cur.w);
  });
  hInput.addEventListener("blur", () => {
    const v = safeMathEval(hInput.value);
    const cur = readState(node);
    commitFromH(Number.isFinite(v) && v > 0 ? v : cur.h);
  });

  // ── arrow-key stepping (same pattern as Custom Resolution) ─────
  function stepInput(input, dir, multiplier, isWidth) {
    const cur = readState(node);
    const step = (cur.snap || 16) * multiplier;
    const v = safeMathEval(input.value);
    const base = Number.isFinite(v) && v > 0 ? v : (isWidth ? cur.w : cur.h);
    const next = base + dir * step;
    if (isWidth) commitFromW(next); else commitFromH(next);
  }

  for (const [inp, isW] of [[wInput, true], [hInput, false]]) {
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        inp.blur();
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? 1 : -1;
        const mult = e.shiftKey ? 4 : 1;
        stepInput(inp, dir, mult, isW);
      }
    });
  }

  // ── quick-pick chip clicks set W and recompute H ─────────────────
  quickRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".pix-res-quickpick");
    if (!btn) return;
    e.stopPropagation();
    commitFromW(parseInt(btn.dataset.w, 10));
  });

  // ── ratio input commit + validation ──────────────────────────────
  function commitRatio() {
    const rWraw = parseInt(rwInput.value, 10);
    const rHraw = parseInt(rhInput.value, 10);
    const cur = readState(node);
    const rW = Number.isFinite(rWraw) && rWraw > 0 ? rWraw : safePositiveInt(cur.custom_ratio_w, 4);
    const rH = Number.isFinite(rHraw) && rHraw > 0 ? rHraw : safePositiveInt(cur.custom_ratio_h, 3);
    rwInput.value = String(rW);
    rhInput.value = String(rH);
    const ratioChanged = rW !== cur.custom_ratio_w || rH !== cur.custom_ratio_h;
    if (ratioChanged) {
      // Recompute H from current W at the new ratio so the visible image
      // matches what the workflow will receive. Single combined write so
      // the workflow can never observe a half-updated state mid-blur.
      const step = cur.snap || 16;
      const w = clampDim(snapTo(cur.w, step));
      const h = clampDim(snapTo((w * rH) / rW, step));
      wInput.value = String(w);
      hInput.value = String(h);
      writeState(node, { ...cur, custom_ratio_w: rW, custom_ratio_h: rH, w, h });
      refreshReadout(w, h);
    }
  }

  for (const inp of [rwInput, rhInput]) {
    inp.addEventListener("blur", commitRatio);
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        inp.blur();
      }
    });
  }

  ratioSwap.addEventListener("click", () => {
    const a = rwInput.value;
    rwInput.value = rhInput.value;
    rhInput.value = a;
    commitRatio();
  });

  wrap.append(ratioRow, quickRow, fieldsRow, readout, preview);
  return wrap;
}

function renderUI(node) {
  const state = readState(node);
  let root = node._pixResRoot;
  if (!root || !root.isConnected) {
    // Vue may have detached the original element. Re-find via the DOM widget.
    const w = (node.widgets || []).find((x) => x.name === "resolution_ui");
    if (w?.element?.isConnected) {
      const found = w.element.querySelector(".pix-res-root");
      if (found) {
        node._pixResRoot = found;
        root = found;
      } else {
        // Container exists but our root is gone — append a new one.
        root = document.createElement("div");
        root.className = "pix-res-root";
        w.element.appendChild(root);
        node._pixResRoot = root;
      }
    } else {
      return; // nothing to render into
    }
  }

  root.innerHTML = "";
  root.appendChild(renderChipGrid(state));
  if (state.mode === "custom") {
    root.appendChild(renderCustomPanel(node, state));
  } else if (state.mode === "custom_ratio") {
    root.appendChild(renderCustomRatioPanel(node, state));
  } else {
    root.appendChild(renderSizeList(state));
  }
}

function setupResolutionNode(node) {
  // Defensive: if a widget for ResolutionState somehow exists (stale Python
  // not yet restarted, or a workflow loaded under the old architecture),
  // hide it. With the current Python (hidden input), no widget is created
  // and this is a no-op.
  hideJsonWidget(node.widgets, HIDDEN_INPUT_NAME);

  // Branded default colors. Only applied when the node has no override yet —
  // workflow-restored colors and right-click Color-menu picks both land on
  // node.color / node.bgcolor before nodeCreated fires, so the user's choice
  // wins. Title bar matches the chip surface (#1d1d1d), body matches the root
  // surface (#2a2a2a) so the whole node reads as one cohesive dark panel.
  if (!node.color)   node.color   = "#1d1d1d";
  if (!node.bgcolor) node.bgcolor = "#2a2a2a";

  // Lock both dimensions. The chip grid is tuned for 240px wide, and the
  // height is sized to fit all 8 preset rows + chips with no scrollbar (see
  // NODE_H comment block). Resize would only ever produce empty space — see
  // also onResize below which re-clamps if LiteGraph attempts a resize.
  node.resizable = false;
  node.size = [NODE_W, NODE_H];

  // Empty root — we do NOT populate it synchronously. In Vue's new frontend,
  // nodeCreated fires BEFORE configure restores widget values from saved
  // workflows. If we render now, we'd render with default state and flash to
  // the restored state when onConfigure re-renders milliseconds later. Defer
  // the initial render (see queueMicrotask at the bottom) so configure has
  // a chance to land the saved value first.
  const root = document.createElement("div");
  root.className = "pix-res-root";

  // DOM widget gets a constant slot of space — chrome (titlebar + ports +
  // margins) takes the rest. Both callbacks return the same value so the
  // widget exactly fills the area between titlebar and node bottom.
  const WIDGET_H = NODE_H - 46; // 358 — keep in sync with the chrome estimate in NODE_H comment
  const _widget = node.addDOMWidget("resolution_ui", "custom", root, {
    getValue: () => readState(node),
    setValue: (_v) => {},
    getMinHeight: () => WIDGET_H,
    getMaxHeight: () => WIDGET_H,
    margin: 4,
    serialize: false, // DOM widget itself does not serialize; the hidden STRING widget owns the state
  });

  const _onClick = (e) => {
    const chip = e.target.closest(".pix-res-chip");
    if (chip) {
      const id = chip.dataset.chipId;
      const cur = readState(node);
      if (id === "custom") {
        writeState(node, {
          ...cur,
          mode: "custom",
          w: cur.custom_w ?? 1024,
          h: cur.custom_h ?? 1024,
        });
      } else if (id === "custom_ratio") {
        // Preserve current W if it's reasonable (>= 256); otherwise default
        // to 1024 (SDXL native). Height auto-computes from the saved ratio
        // and snaps to the current step so the panel opens with valid dims.
        const rW = safePositiveInt(cur.custom_ratio_w, 4);
        const rH = safePositiveInt(cur.custom_ratio_h, 3);
        const step = cur.snap || 16;
        const w = clampDim(snapTo(cur.w >= 256 ? cur.w : 1024, step));
        const h = clampDim(snapTo((w * rH) / rW, step));
        writeState(node, { ...cur, mode: "custom_ratio", w, h });
      } else {
        const sizes = SIZES[id];
        if (!sizes) return;
        const [w, h] = DEFAULT_PER_RATIO[id] || sizes[0];
        writeState(node, { ...cur, mode: "preset", ratio: id, w, h });
      }
      renderUI(node);
      return;
    }
    const row = e.target.closest(".pix-res-row");
    if (row && !row.classList.contains("empty") && row.dataset.w) {
      const w = parseInt(row.dataset.w, 10);
      const h = parseInt(row.dataset.h, 10);
      const cur = readState(node);
      writeState(node, { ...cur, w, h });
      renderUI(node);
      // Focus the freshly-rendered list so the next ArrowUp/Down keystroke is
      // captured by the list — without this, the click moves focus to the
      // overlay/canvas and arrows don't reach us.
      const list = root.querySelector(".pix-res-list:not(.pix-res-custom)");
      list?.focus();
      list?.querySelector(".pix-res-row.active")?.scrollIntoView({ block: "nearest" });
    }
  };

  // Arrow-key navigation in preset mode (size list). The list is `tabindex=0`
  // so it can receive focus; we delegate at root level so the listener
  // survives every re-render. `stopPropagation` prevents ComfyUI's canvas
  // from interpreting the arrow keys as graph pan. Custom modes have their
  // own per-input arrow handlers (snap-step), not list-row navigation.
  const _onKeydown = (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const list = e.target.closest(".pix-res-list");
    if (!list || list.classList.contains("pix-res-custom")) return;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    const cur = readState(node);
    if (cur.mode !== "preset") return;
    const sizes = SIZES[cur.ratio] || [];
    if (sizes.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    let idx = sizes.findIndex(([w, h]) => w === cur.w && h === cur.h);
    if (idx < 0) idx = 0;
    if (e.key === "ArrowUp")        idx = Math.max(0, idx - 1);
    else if (e.key === "ArrowDown") idx = Math.min(sizes.length - 1, idx + 1);
    else if (e.key === "Home")      idx = 0;
    else if (e.key === "End")       idx = sizes.length - 1;
    const [w, h] = sizes[idx];
    if (w === cur.w && h === cur.h) return;
    writeState(node, { ...cur, w, h });
    renderUI(node);
    const newList = root.querySelector(".pix-res-list:not(.pix-res-custom)");
    newList?.focus();
    newList?.querySelector(".pix-res-row.active")?.scrollIntoView({ block: "nearest" });
  };

  // Attach to both root and the widget container so a Vue rebuild still routes events.
  root.addEventListener("click", _onClick);
  root.addEventListener("keydown", _onKeydown);
  if (_widget?.element) {
    _widget.element.addEventListener("click", _onClick);
    _widget.element.addEventListener("keydown", _onKeydown);
  }

  node._pixResRoot = root;

  // Deferred initial render. By the time the microtask fires, Vue will have
  // called configure() on this node (if it's being restored from a saved
  // workflow) so widget.value reflects the saved state and we render it
  // correctly on the first paint — no flash from defaults.
  queueMicrotask(() => {
    const state = readState(node);
    root.innerHTML = "";
    root.appendChild(renderChipGrid(state));
    if (state.mode === "custom") {
      root.appendChild(renderCustomPanel(node, state));
    } else if (state.mode === "custom_ratio") {
      root.appendChild(renderCustomRatioPanel(node, state));
    } else {
      root.appendChild(renderSizeList(state));
    }
  });
}

app.registerExtension({
  name: "Pixaroma.Resolution",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaResolution") return;

    // onConfigure fires whenever configure() is called — catches the case
    // where a user opens a different workflow into an already-constructed
    // node. Re-render so the UI matches the freshly-applied widget value.
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      if (this._pixResRoot) renderUI(this);
      return r;
    };

    // Re-clamp on every resize attempt so the node can never grow / shrink.
    // (Belt-and-braces with `node.resizable = false` — Vue/LiteGraph still
    // emit onResize during workflow load with the saved size, which may not
    // match our locked dimensions if the lock value was bumped between
    // versions.)
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      this.size[0] = NODE_W;
      this.size[1] = NODE_H;
      if (_origResize) return _origResize.call(this, size);
    };
  },

  // nodeCreated fires DURING node construction, BEFORE configure() is called
  // to restore saved widget values (CLAUDE.md Pattern #8). The initial
  // populate of the DOM widget is therefore deferred to queueMicrotask
  // inside setupResolutionNode so configure has a chance to land the saved
  // value first — without that defer, the panel renders defaults and flashes
  // to the saved state milliseconds later.
  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaResolution") return;
    setupResolutionNode(node);
  },
});

// Inject the per-node state into the API prompt at execution time. Python's
// `hidden` ResolutionState input expects a STRING value but doesn't get one
// from the workflow JSON (no widget exists). Patch app.graphToPrompt so each
// PixaromaResolution node's prompt entry gets its `inputs.ResolutionState`
// populated from node.properties[STATE_PROP] right before submission.
//
// Subgraph-safe lookup: ComfyUI's new subgraph system flattens contained nodes
// into the API prompt with composite string IDs (e.g. "5:12"), and `app.graph`
// only exposes top-level nodes — so the previous `parseInt(id) + getNodeById`
// path silently missed any PixaromaResolution placed inside a subgraph and
// the user got a TypeError at execution. Identify pixaroma entries directly
// by `class_type` in the API prompt, and resolve their state via a recursive
// walk over every nested subgraph. Falls back to DEFAULT_STATE if a node
// can't be found so the workflow never crashes — worst case the user sees the
// 1024×1024 default instead of their pick.
function buildPixaromaNodeIndex() {
  const index = new Map(); // String(node.id) → node
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaResolution" || n.type === "PixaromaResolution") {
        index.set(String(n.id), n);
      }
      // ComfyUI subgraph instances expose their inner graph at one of these
      // keys depending on frontend version; check all known shapes.
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findPixaromaNode(index, promptId) {
  // Try exact match first; then strip any subgraph prefix ("5:12" → "12") so
  // we still hit the inner node when ComfyUI prefixes IDs in the API prompt.
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== "PixaromaResolution") continue;
      if (!index) index = buildPixaromaNodeIndex();
      const node = findPixaromaNode(index, id);
      const state = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = state;
    }
  }
  return result;
};
