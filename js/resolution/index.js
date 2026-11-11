import { app } from "../../../scripts/app.js";
import { BRAND, hideJsonWidget, applyAdaptiveCanvasOnly,
  installCanvasZoomPassthrough, installNodeAccent, registerNodeAccent,
} from "../shared/index.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import { isComfyTextShortcut } from "../shared/text_shortcuts.mjs";
import { installLatentBatch } from "../shared/latent_batch.mjs";
import { installScaleSwitch } from "./scale_switch.mjs";

// Node dimensions are LOCKED — width and height. The original "make it
// resizable" attempt was a workaround for the default height being too small
// to show all 8 preset rows; once that's fixed, there's no real reason to
// resize, and a resizable node just produces an awkward dark empty band when
// dragged taller. Locking matches the canvas-side res-node pattern and is
// honest: the node draws exactly what fits its content.
//
// NODE_H is EXACT (Classic px): every height below is fixed in the CSS, none
// depends on a font, so no safety margin is needed. The old 5-px margin and the
// root's 8-px top / bottom padding showed as extra space under the output dots
// and below the list (the root is the same colour as the node body).
//   chip grid (4 rows × CHIP_H 28 + 3 × 5 gap) ...... 127
//     ├─ row 1: 1:1 / 16:9 / 9:16
//     ├─ row 2: 2:1 / 3:2 / 2:3
//     ├─ row 3: 4:3 / 3:4 / 4:5
//     └─ row 4: Custom Ratio / Custom Resolution (half-width chips)
//   gap between chips and list ..................... 8
//   size list ..................................... 226
//     ├─ borders (1 top + 1 bottom) ........  2
//     └─ rows (8 × 28, border-box: each row's 1-px divider is inside it) 224
//   DOM widget `margin: 4` (top + bottom) ........... 8
//                                                  ----
//   WIDGET_H ..................................... 369
//   chrome: 3 output rows (width, height, latent) .. 66
//                                                  ----
//   NODE_H ....................................... 435
// Add or remove an output and the chrome moves by 20 (one slot row).
const NODE_W = 240;
const CHIP_H = 28;
const WIDGET_H = 4 * CHIP_H + 3 * 5 + 8 + (8 * 28 + 2) + 8; // 369
const NODE_H = WIDGET_H + 66; // 435

function injectCSS() {
  if (document.getElementById("pixaroma-resolution-css")) return;
  const css = `
    .pix-res-root {
      width: 100%;
      box-sizing: border-box;
      /* No top / bottom padding: the root is the same colour as the node body,
         so padding there only showed as extra space under the output dots and
         below the list. The chips now start where Sizes Pixaroma's panel does. */
      padding: 0 8px;
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
      /* A FIXED height, not padding around the text: the text height differs
         per font and renderer (measured 28 in Classic, 27.3 in Nodes 2.0), and
         the node height (WIDGET_H) is computed from this number. */
      box-sizing: border-box;
      height: ${CHIP_H}px;
      padding: 0 4px;
      font-size: 10px;
      color: #ccc;
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, border-color 0.08s;
      /* flex layout so a small visual AR rectangle can sit next to the label
         on ratio chips. Custom Ratio / Custom Resolution chips skip the shape
         and just render the label, which centers naturally via justify-content. */
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .pix-res-chip:hover { border-color: #666; }
    .pix-res-chip.active {
      background: var(--pix-acc,#f66744);
      color: #fff;
      border-color: var(--pix-acc,#f66744);
    }
    .pix-res-chip.span-half { grid-column: span 3; } /* 1/2 width — used by Custom Ratio + Custom Resolution */
    /* Tiny ratio-shape preview rendered inside each ratio chip. Width and
       height are set inline by JS to match the actual W:H, so the user can
       recognize the shape of every preset at a glance, not just the picked one.
       Bounding box (14 x 11) is tuned for the ~66 px ratio chip width — leaves
       enough room next to the label "16:9" without clipping at NODE_W = 240. */
    .pix-res-chip-shape {
      display: inline-block;
      background: rgba(180, 180, 180, 0.25);
      border: 1px solid #888;
      border-radius: 1px;
      box-sizing: border-box;
      flex-shrink: 0;
    }
    .pix-res-chip.active .pix-res-chip-shape {
      background: rgba(255, 255, 255, 0.4);
      border-color: rgba(255, 255, 255, 0.85);
    }
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
         appears in either direction. It never shrinks: the widget has no
         safety margin any more, and a sub-pixel shortfall would otherwise
         squeeze it into a scrollbar. Custom panel overrides to flex:1 so its
         preview rect can absorb the panel's vertical space. */
      flex: 0 0 auto;
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
    .pix-res-list:focus { outline: none; border-color: var(--pix-acc,#f66744); }
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
      font-family: inherit;
      color: #ccc;
    }
    .pix-res-row:last-child { border-bottom: none; }
    .pix-res-row.active {
      background: color-mix(in srgb, var(--pix-acc,#f66744) 15%, transparent);
      color: var(--pix-acc,#f66744);
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
      padding: 2px 6px;
      color: var(--pix-acc,#f66744);
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      font-family: inherit;
      box-sizing: border-box;
      width: 100%;
    }
    .pix-res-custom-field input:focus {
      outline: none;
      border-color: var(--pix-acc,#f66744);
    }
    /* Square icon button placed BETWEEN the W and H inputs (Figma/Photoshop pattern).
       Uses CSS mask-image so the SVG inherits color via the button's color property
       — same technique Note Pixaroma uses for toolbar mask-icons. */
    .pix-res-swap {
      width: 26px;
      height: 22px;
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
      -webkit-mask: url("${pixAsset("icons/ui/swap.svg")}") center / 12px 12px no-repeat;
              mask: url("${pixAsset("icons/ui/swap.svg")}") center / 12px 12px no-repeat;
      pointer-events: none;
    }
    .pix-res-swap:hover { color: var(--pix-acc,#f66744); border-color: var(--pix-acc,#f66744); }
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
    .pix-res-readout .accent { color: var(--pix-acc,#f66744); }
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
      background: color-mix(in srgb, var(--pix-acc,#f66744) 18%, transparent);
      border: 1px solid var(--pix-acc,#f66744);
      border-radius: 2px;
      /* Sized by sizePreviewRect: aspect-ratio + max-width + a flex basis it
         may shrink from. min-height 0 lets it shrink below that basis (a flex
         item's automatic minimum would block it); the width follows. */
      min-height: 0;
      transition: flex-basis 0.15s ease, max-width 0.15s ease;
    }
    .pix-res-preview-label {
      font-family: inherit;
      font-size: 10px;
      color: #999;
    }
    .pix-res-preview-label .accent { color: var(--pix-acc,#f66744); }
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
      -webkit-mask: url("${pixAsset("icons/ui/magnet.svg")}") center / 11px 11px no-repeat;
              mask: url("${pixAsset("icons/ui/magnet.svg")}") center / 11px 11px no-repeat;
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
      font-family: inherit;
      line-height: 1;
    }
    .pix-res-snap-btn:hover { color: #ddd; border-color: #666; }
    .pix-res-snap-btn.active {
      background: var(--pix-acc,#f66744);
      color: #fff;
      border-color: var(--pix-acc,#f66744);
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
      padding: 2px 6px;
      color: var(--pix-acc,#f66744);
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      font-family: inherit;
      box-sizing: border-box;
    }
    .pix-res-ratio-input-row input:focus { outline: none; border-color: var(--pix-acc,#f66744); }
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
      -webkit-mask: url("${pixAsset("icons/ui/swap.svg")}") center / 12px 12px no-repeat;
              mask: url("${pixAsset("icons/ui/swap.svg")}") center / 12px 12px no-repeat;
      pointer-events: none;
    }
    .pix-res-ratio-swap:hover { color: var(--pix-acc,#f66744); border-color: var(--pix-acc,#f66744); }
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
      font-family: inherit;
      cursor: pointer;
      transition: background 0.08s, border-color 0.08s;
    }
    .pix-res-quickpick:hover { border-color: #666; color: #fff; }
    .pix-res-quickpick.active {
      background: var(--pix-acc,#f66744);
      color: #fff;
      border-color: var(--pix-acc,#f66744);
    }
  `;
  const style = document.createElement("style");
  style.id = "pixaroma-resolution-css";
  style.textContent = css;
  document.head.appendChild(style);
}
injectCSS();

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

// The "Big" lists (the Normal | Big switch beside the width dot, resolution.md #8):
// 8 sizes per ratio from about 4 to 17 MP, every side a multiple of 32 (MiniMax H3
// Image's grid, so also fine for 8 / 16 / 64-grid models), exact ratios except
// 3840 x 2176 (4K on the 32 grid) and the top 16:9 / 9:16 / 4:3 / 3:4 / 1:1 rows,
// which are MiniMax H3 Image's own 16 MP sizes (4096 x 4096, 5472 x 3072, 4736 x 3552).
const BIG_SIZES = {
  "1:1":  [[2304,2304],[2560,2560],[2816,2816],[3072,3072],[3328,3328],[3584,3584],[3840,3840],[4096,4096]],
  "16:9": [[2560,1440],[3072,1728],[3584,2016],[3840,2176],[4096,2304],[4608,2592],[5120,2880],[5472,3072]],
  "9:16": [[1440,2560],[1728,3072],[2016,3584],[2176,3840],[2304,4096],[2592,4608],[2880,5120],[3072,5472]],
  "2:1":  [[2816,1408],[3072,1536],[3584,1792],[4096,2048],[4608,2304],[5120,2560],[5376,2688],[5760,2880]],
  "3:2":  [[2496,1664],[2880,1920],[3072,2048],[3456,2304],[3840,2560],[4224,2816],[4608,3072],[4992,3328]],
  "2:3":  [[1664,2496],[1920,2880],[2048,3072],[2304,3456],[2560,3840],[2816,4224],[3072,4608],[3328,4992]],
  "4:3":  [[2304,1728],[2560,1920],[2816,2112],[3328,2496],[3584,2688],[4096,3072],[4352,3264],[4736,3552]],
  "3:4":  [[1728,2304],[1920,2560],[2112,2816],[2496,3328],[2688,3584],[3072,4096],[3264,4352],[3552,4736]],
  "4:5":  [[1792,2240],[2048,2560],[2304,2880],[2560,3200],[2816,3520],[3072,3840],[3328,4160],[3584,4480]],
};

// The size a ratio chip picks in the Big list: about 8 MP (4K-class), the middle of
// the range MiniMax H3 Image does best at for text to image (4 to 8 MP).
const BIG_DEFAULT_PER_RATIO = {
  "1:1":  [2816, 2816],
  "16:9": [3840, 2176],
  "9:16": [2176, 3840],
  "2:1":  [4096, 2048],
  "3:2":  [3456, 2304],
  "2:3":  [2304, 3456],
  "4:3":  [3328, 2496],
  "3:4":  [2496, 3328],
  "4:5":  [2560, 3200],
};

/** The list a ratio shows: Big when the state says so (`big: true`), else Normal. */
function sizesFor(ratio, big) {
  return (big ? BIG_SIZES : SIZES)[ratio] || [];
}
function defaultFor(ratio, big) {
  const d = (big ? BIG_DEFAULT_PER_RATIO : DEFAULT_PER_RATIO)[ratio];
  return d || sizesFor(ratio, big)[0] || [1024, 1024];
}

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
// The custom modes' size range. 64 is the node's real floor (Python clamps to
// 64..16384); it was 256, which broke Custom Ratio's small sizes (#5). 8192 stays
// as a typo guard; it was 4096, which kept every 16 MP shape but the square out
// (MiniMax H3 Image: 5472 x 3072, 3552 x 4736; #7). Both are multiples of every
// snap step (8 / 16 / 32 / 64).
const MIN_DIM = 64;
const MAX_DIM = 8192;
function clampDim(n) { return Math.max(MIN_DIM, Math.min(MAX_DIM, n)); }

// Custom Ratio: the DRIVING side (the one typed or clicked) snapped, the other
// side from the ratio, and when either leaves MIN_DIM..MAX_DIM the PAIR is
// scaled to fit, so the typed ratio always holds. Clamping one side alone gave
// 512 x 256 for 21:9 + the 512 button and (at the old 4096 cap) 4096 x 4096 for 16:9 + H 4096, both
// under a "21:9" / "16:9" label (resolution.md #5). In range it is exactly the
// old maths (snap the driver, derive and snap the other side).
function ratioPair(raw, fromW, rW, rH, step) {
  const other = (v) => (fromW ? (v * rH) / rW : (v * rW) / rH);
  const make = (v) => { const a = snapTo(v, step); const b = snapTo(other(a), step); return fromW ? [a, b] : [b, a]; };
  let [w, h] = make(raw);
  if (Math.max(w, h) > MAX_DIM) [w, h] = make((raw * MAX_DIM) / Math.max(raw, other(raw)));
  else if (Math.min(w, h) < MIN_DIM) [w, h] = make((raw * MIN_DIM) / Math.min(raw, other(raw)));
  // a ratio beyond 128:1 (8192 / 64) cannot fit both limits: the clamp is the last word
  return [clampDim(w), clampDim(h)];
}

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
// decimals only. Hand-rolled recursive descent. NEVER use dynamic evaluation (JS eval or the Function constructor)
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
  // Any whitespace the whitelist lets in (\s): a pasted no-break space or a
  // tab used to stop the parse, and the field silently kept its old value.
  const skipWs = () => { while (pos < s.length && /\s/.test(s[pos])) pos++; };
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

// Parse a chip id like "16:9" into [16, 9]. Returns null for "custom" /
// "custom_ratio" so the shape-render path skips them.
function parseRatioId(id) {
  const m = /^(\d+):(\d+)$/.exec(id);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

// Scale a W:H pair to fit inside maxW × maxH, preserving aspect. Returns
// rounded integer px so the rendered rectangle has crisp 1 px borders.
function fitRectToBox(rw, rh, maxW, maxH) {
  const aspect = rw / rh;
  let w, h;
  if (aspect >= maxW / maxH) { w = maxW; h = maxW / aspect; }
  else                       { h = maxH; w = maxH * aspect; }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

// Size the custom panels' aspect preview so it keeps its SHAPE when the panel
// is short. Its height is a flex basis it may shrink from and its width follows
// through aspect-ratio. A fixed width + height let the preview's flex column
// shrink only the height: in Classic (fixed node height) the Custom Ratio panel
// gets 226 px of the ~245 it wants, and a 4:3 was drawn 80 x 38 (resolution.md #2).
function sizePreviewRect(el, pw, ph) {
  el.style.aspectRatio = `${pw} / ${ph}`;
  el.style.maxWidth = `${pw}px`;
  el.style.flex = `0 1 ${ph}px`;
}

// The "W × H" line under the custom panels' preview, built from TEXT nodes.
// w / h come from the saved state, which a shared workflow controls: written
// into innerHTML, a w of "<img onerror=...>" ran as soon as the workflow opened
// (resolution.md #3). textContent can never be markup.
function setSizeLabel(el, w, h) {
  const part = (v) => { const s = document.createElement("span"); s.className = "accent"; s.textContent = String(v); return s; };
  el.replaceChildren(part(w), " × ", part(h));
}

// Ctrl/Cmd+S (save) and Ctrl/Cmd+Enter (run) are ComfyUI's own keys, and its
// keybindings listen on window. Our fields stop every keydown so a typed letter
// can never fire a canvas shortcut, which also swallowed these two (Ctrl+S then
// opened the browser's "Save page as", Ctrl+Enter ran nothing). Commit the field
// FIRST (they commit on blur, so the save / run sees the typed size), then let
// the key go on. Ctrl+Arrows stay ours: they step the number (resolution.md #4).
function passComfyShortcut(e, inp) {
  if (!isComfyTextShortcut(e) || e.key === "ArrowUp" || e.key === "ArrowDown") return false;
  inp.blur();
  return true;
}

// Bounding box for the in-chip ratio rectangle. 14 × 11 fits comfortably next
// to the longest label ("16:9", ~24 px) inside the ~66 px ratio chip.
const CHIP_SHAPE_MAX_W = 14;
const CHIP_SHAPE_MAX_H = 11;

function renderChipGrid(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-chips";
  for (const c of CHIPS) {
    const el = document.createElement("div");
    el.className = "pix-res-chip" + (c.spanHalf ? " span-half" : "");
    el.dataset.chipId = c.id;
    const isActive =
      (c.id === "custom" && state.mode === "custom") ||
      (c.id === "custom_ratio" && state.mode === "custom_ratio") ||
      (c.id !== "custom" && c.id !== "custom_ratio" &&
       state.mode === "preset" && state.ratio === c.id);
    if (isActive) el.classList.add("active");

    // Visual AR rectangle for ratio chips only; custom chips stay text-only
    // because they're half-width (more horizontal space for the longer label)
    // and don't have a fixed shape to preview here.
    const ratio = parseRatioId(c.id);
    if (ratio) {
      const shape = document.createElement("span");
      shape.className = "pix-res-chip-shape";
      const { w, h } = fitRectToBox(ratio[0], ratio[1], CHIP_SHAPE_MAX_W, CHIP_SHAPE_MAX_H);
      shape.style.width = `${w}px`;
      shape.style.height = `${h}px`;
      el.appendChild(shape);
    }

    const labelEl = document.createElement("span");
    labelEl.textContent = c.label;
    el.appendChild(labelEl);

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
  const sizes = sizesFor(state.ratio, state.big);
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
    sizePreviewRect(previewRect, pw, ph);
    setSizeLabel(previewLabel, w, h);
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
      if (passComfyShortcut(e, inp)) return;
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
    sizePreviewRect(previewRect, pw, ph);
    setSizeLabel(previewLabel, w, h);
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
    const [w, h] = ratioPair(rawW, true, rW, rH, step);
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
    const [w, h] = ratioPair(rawH, false, rW, rH, step);
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
      if (passComfyShortcut(e, inp)) return;
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
      const [w, h] = ratioPair(cur.w, true, rW, rH, step);
      wInput.value = String(w);
      hInput.value = String(h);
      writeState(node, { ...cur, custom_ratio_w: rW, custom_ratio_h: rH, w, h });
      refreshReadout(w, h);
    }
  }

  for (const inp of [rwInput, rhInput]) {
    inp.addEventListener("blur", commitRatio);
    inp.addEventListener("keydown", (e) => {
      if (passComfyShortcut(e, inp)) return;
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
  // The innerHTML wipe above took the Classic batch band and the Normal | Big
  // switch with it: put them back.
  node._pixLb?.mount();
  node._pixScale?.mount();
}

function setupResolutionNode(node) {
  // Defensive: if a widget for ResolutionState somehow exists (stale Python
  // not yet restarted, or a workflow loaded under the old architecture),
  // hide it. With the current Python (hidden input), no widget is created
  // and this is a no-op.
  hideJsonWidget(node.widgets, HIDDEN_INPUT_NAME);

  // Brand default colors are applied globally by js/brand/index.js — no
  // per-node guard needed. Title bar matches the chip surface (#1d1d1d),
  // body matches the root surface (#2a2a2a) so the whole node reads as
  // one cohesive dark panel.

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

  // DOM widget gets a constant slot of space (WIDGET_H, top of the file);
  // chrome (the output rows) takes the rest. Both callbacks return the same
  // value so the widget exactly fills the area between the slots and the node
  // bottom.
  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root);   // the face follows this node's accent colour
  const _widget = node.addDOMWidget("resolution_ui", "custom", root, {
    // canvasOnly set adaptively below (CLAUDE.md Nodes 2.0): true in legacy
    // (out of the Parameters tab), false in Nodes 2.0 (renders in Vue body).
    getValue: () => readState(node),
    setValue: (_v) => {},
    getMinHeight: () => WIDGET_H,
    getMaxHeight: () => WIDGET_H,
    margin: 4,
    serialize: false, // DOM widget itself does not serialize; the hidden STRING widget owns the state
  });
  applyAdaptiveCanvasOnly(_widget);

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
        const [w, h] = ratioPair(cur.w >= 256 ? cur.w : 1024, true, rW, rH, step);
        writeState(node, { ...cur, mode: "custom_ratio", w, h });
      } else {
        if (!SIZES[id]) return;
        const [w, h] = defaultFor(id, cur.big);
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
    const sizes = sizesFor(cur.ratio, cur.big);
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

  // The latent's batch size: a small stepper on the level of the `latent`
  // output dot (output 2), in the empty space left of the labels, so the
  // locked node size does not change. Stored as state.batch (absent = 1).
  node._pixLb = installLatentBatch(node, {
    outputIndex: 2,
    getRoot: () => node._pixResRoot,
    read: () => readState(node).batch ?? 1,
    write: (n) => writeState(node, { ...readState(node), batch: n }),
  });

  // Normal | Big: which list the ratio chips show, on the level of the `width`
  // dot (output 0), one row above the batch stepper; the node size stays locked.
  // Stored as state.big (absent = Normal). Picking a list shows it (preset mode,
  // the same ratio) and selects that list's default size for the ratio.
  node._pixScale = installScaleSwitch(node, {
    outputIndex: 0,
    getRoot: () => node._pixResRoot,
    read: () => !!readState(node).big,
    pick: (big) => {
      const cur = readState(node);
      if (cur.mode === "preset" && !!cur.big === big) return false;
      const ratio = SIZES[cur.ratio] ? cur.ratio : "1:1";
      const [w, h] = defaultFor(ratio, big);
      const next = { ...cur, mode: "preset", ratio, w, h };
      if (big) next.big = true;
      else delete next.big;
      writeState(node, next);
      renderUI(node);
      return true;
    },
  });

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
    node._pixLb?.mount();
    node._pixScale?.mount();
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

const _origGraphToPrompt_fn = app.graphToPrompt;
const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  // FAIL OPEN - see the note in pause_image: a throw here rejects ComfyUI's
  // own graphToPrompt and breaks Run for the whole workflow. Never wrap the
  // `await _origGraphToPrompt` above; a failure in CORE must propagate.
  try {
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
  } catch (e) {
    console.error("[Pixaroma] Resolution prompt injection failed; prompt sent unchanged", e);
  }
  return result;
};

// The colour option: gives this node a right-click "Resolution settings" entry, the
// gear in the selection toolbar, and the shared colour panel behind both.
registerNodeAccent("PixaromaResolution", { title: "Resolution" });
