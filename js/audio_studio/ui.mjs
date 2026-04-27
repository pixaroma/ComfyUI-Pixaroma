// js/audio_studio/ui.mjs
// Mixin: collapsible-section sidebar (3D-Builder style) — Motion / Overlays /
// Audio / Output. Adds methods to AudioStudioEditor.prototype.
import { AudioStudioEditor } from "./core.mjs";
import { createPanel, UI_ICON } from "../framework/index.mjs";

const ASPECT_OPTIONS = [
  "Original",
  "Custom (Use Width & Height below)",
  "Custom Ratio 16:9 (Uses Width)",
  "Custom Ratio 9:16 (Uses Width)",
  "Custom Ratio 4:3 (Uses Width)",
  "Custom Ratio 1:1 (Uses Width)",
  "512x512 (Square)",
  "768x512 (Landscape)",
  "512x768 (Portrait)",
  "832x480 (Landscape)",
  "480x832 (Portrait)",
  "1024x576 (Landscape 16:9)",
  "576x1024 (Portrait 9:16)",
  "1280x720 (Landscape HD)",
  "720x1280 (Portrait HD)",
  "1920x1080 (Landscape FHD)",
  "1080x1920 (Portrait FHD)",
  "2560x1440 (Landscape 2K)",
  "1440x2560 (Portrait 2K)",
  "3840x2160 (Landscape 4K)",
  "2160x3840 (Portrait 4K)",
];

// Internal id (left) goes to the engine + saved workflow; label (right) is
// what users see. Renaming the label is safe; the id is load-bearing and
// must NOT change without an explicit migration.
const MOTION_MODES = [
  { value: "scale_pulse",  label: "Pulse Zoom" },
  { value: "zoom_punch",   label: "Punch Zoom" },
  { value: "shake",        label: "Camera Shake" },
  { value: "drift",        label: "Drift" },
  { value: "rotate_pulse", label: "Pulse Spin" },
  { value: "ripple",       label: "Ripple" },
  { value: "swirl",        label: "Swirl" },
  { value: "slit_scan",    label: "Time Slice" },
  { value: "glitch",       label: "Glitch" },
  { value: "pinch",        label: "Pinch" },
  { value: "wave",         label: "Wave" },
  { value: "tilt",         label: "Tilt" },
  { value: "pixelate",     label: "Pixelate" },
  { value: "rgb_split",    label: "RGB Split" },
  { value: "squeeze",      label: "Squeeze" },
];

// Motion modes that have a meaningful "direction" axis — rotation,
// translation, or wave-travel. The Direction toggle is only shown for
// these. scale_pulse / zoom_punch / shake have no directional axis (pure
// scale or random jitter), so flipping a sign would do nothing visible.
const DIRECTIONAL_MOTION_MODES = new Set([
  "drift", "rotate_pulse", "ripple", "swirl", "slit_scan",
  // Pass 3: pinch (bulge↔pinch), wave (travel direction), tilt (lean
  // side), squeeze (zoom in vs out). pixelate / rgb_split are symmetric.
  "pinch", "wave", "tilt", "squeeze",
]);

// Audio band button group is also reused by the section reset list.
const SHAKE_AXES = [
  { value: "both", label: "Both" },
  { value: "x",    label: "X" },
  { value: "y",    label: "Y" },
];

const SQUEEZE_AXES = [
  { value: "x", label: "Horizontal" },
  { value: "y", label: "Vertical" },
];

const AUDIO_BANDS = [
  { value: "full",   label: "Full" },
  { value: "bass",   label: "Bass" },
  { value: "mids",   label: "Mids" },
  { value: "treble", label: "Treble" },
];

// Aspect-ratio values where Custom Width is editable.
function isCustomWidthAspect(v) {
  return typeof v === "string" && v.startsWith("Custom");
}
// Only this single value also makes Custom Height editable.
function isCustomHeightAspect(v) {
  return v === "Custom (Use Width & Height below)";
}

/**
 * Mirror of `process_aspect()` in nodes/_audio_react_engine.py — given the
 * cfg's aspect_ratio + the user's stored custom_width / custom_height,
 * return the {w, h} the engine will actually render at (snapped to mult-of-
 * 8 the same way Python does). Returns null for "Original" because that
 * size depends on the upstream image, which the editor doesn't know with
 * certainty at config-edit time. Used to populate the read-only side of
 * the Output W × H pair so users see the real numbers, not stale stored
 * values.
 */
function computeEngineWH(ar, customW, customH) {
  if (ar === "Original") return null;
  let bw, bh;
  if (ar === "Custom (Use Width & Height below)") {
    bw = customW; bh = customH;
  } else if (ar.startsWith("Custom Ratio")) {
    bw = customW;
    if      (ar.includes("16:9")) bh = Math.floor(bw * 9 / 16);
    else if (ar.includes("9:16")) bh = Math.floor(bw * 16 / 9);
    else if (ar.includes("4:3"))  bh = Math.floor(bw * 3 / 4);
    else if (ar.includes("1:1"))  bh = bw;
    else                          bh = customH;
  } else {
    // Fixed preset like "1280x720 (Landscape HD)" — first token is WxH.
    const [wStr, hStr] = (ar.split(" ")[0] || "").split("x");
    const w = parseInt(wStr, 10), h = parseInt(hStr, 10);
    if (Number.isFinite(w) && Number.isFinite(h)) { bw = w; bh = h; }
    else { bw = customW; bh = customH; }
  }
  bw = Math.floor(bw / 8) * 8;
  bh = Math.floor(bh / 8) * 8;
  return { w: bw, h: bh };
}

function injectSidebarCSS() {
  if (document.getElementById("pix-as-sidebar-css")) return;
  // Slider rows reuse the framework's `.pxf-slider-row` styling (label +
  // range + boxed number input on one line) so we look identical to 3D
  // Builder. The only Audio-Studio-specific rules below cover the
  // dropdown, toggle, button-group, and W×H pair — none of which the
  // framework provides directly.
  const css = `
    .pix-as-controls { padding: 12px; flex: 1; overflow-y: auto; }
    .pix-as-control { margin-bottom: 8px; }
    .pix-as-control:last-child { margin-bottom: 0; }
    .pix-as-label {
      color: #aaa;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .pix-as-label.disabled { color: #555; }

    .pix-as-dropdown,
    .pix-as-input {
      width: 100%;
      background: #1a1a1a;
      color: #ccc;
      border: 1px solid #333;
      padding: 4px 6px;
      border-radius: 3px;
      font-size: 12px;
      outline: none;
      box-sizing: border-box;
    }
    .pix-as-dropdown:focus,
    .pix-as-input:focus { border-color: #f66744; }
    .pix-as-input:disabled,
    .pix-as-dropdown:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .pix-as-toggle {
      display: inline-flex; align-items: center; gap: 6px;
      cursor: pointer;
    }
    .pix-as-toggle input { cursor: pointer; }

    /* Button group — used for small categorical pickers (motion mode,
       audio band) in place of a dropdown. */
    .pix-as-btn-group {
      display: grid;
      gap: 4px;
    }
    .pix-as-btn-group button {
      padding: 6px 6px;
      background: #1a1a1a;
      color: #aaa;
      border: 1px solid #333;
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
      font-family: inherit;
      text-align: center;
      transition: background 0.1s, color 0.1s, border-color 0.1s;
    }
    .pix-as-btn-group button:hover { color: #ccc; border-color: #555; }
    .pix-as-btn-group button.active {
      background: #f66744;
      color: #fff;
      border-color: #f66744;
    }

    /* Inline W × H pair (Output section) — single row to save vertical
       space vs. two stacked number inputs. */
    .pix-as-wh-row {
      display: flex; align-items: center; gap: 6px;
    }
    .pix-as-wh-label {
      font-size: 10px; color: #aaa; flex-shrink: 0;
      text-transform: uppercase; letter-spacing: 0.4px;
    }
    .pix-as-wh-label.disabled { color: #555; }
    .pix-as-wh-input {
      flex: 1; min-width: 0;
      background: #1a1a1a; color: #ccc;
      border: 1px solid #333; border-radius: 4px;
      padding: 3px 4px;
      font-size: 11px; font-family: ui-monospace, monospace;
      text-align: center;
      outline: none;
      -moz-appearance: textfield;
    }
    .pix-as-wh-input::-webkit-outer-spin-button,
    .pix-as-wh-input::-webkit-inner-spin-button {
      -webkit-appearance: none; margin: 0;
    }
    .pix-as-wh-input:disabled { opacity: 0.4; cursor: not-allowed; }
    .pix-as-wh-input:focus { border-color: #f66744; }
    .pix-as-wh-sep { color: #666; font-size: 11px; flex-shrink: 0; }

    /* Per-section action button on the right side of a panel title
       (currently used for the Motion section's Reset). Visually small +
       muted so it doesn't compete with the title text. */
    .pix-as-section-action {
      margin-left: auto;
      width: 18px; height: 18px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 3px;
      padding: 0;
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 0.1s, border-color 0.1s;
    }
    .pix-as-section-action:hover {
      background: #2a2a2a; border-color: #3a3a3a;
    }
    .pix-as-section-action .pix-as-section-action-icon {
      width: 12px; height: 12px;
      background-color: #aaa;
      -webkit-mask: var(--pix-as-icon-url) center/contain no-repeat;
              mask: var(--pix-as-icon-url) center/contain no-repeat;
      pointer-events: none;
    }
    .pix-as-section-action:hover .pix-as-section-action-icon { background-color: #fff; }

    /* Direction toggle — two icon buttons (CW / CCW) shown side-by-side
       under the motion-mode grid for modes that have a directional axis. */
    .pix-as-direction {
      display: flex; gap: 6px; align-items: center;
    }
    .pix-as-direction-buttons { display: flex; gap: 4px; flex: 1; }
    .pix-as-direction button {
      flex: 1;
      padding: 6px 8px;
      background: #1a1a1a;
      color: #aaa;
      border: 1px solid #333;
      border-radius: 3px;
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      font-family: inherit;
      font-size: 11px;
      transition: background 0.1s, color 0.1s, border-color 0.1s;
    }
    .pix-as-direction button:hover { color: #ccc; border-color: #555; }
    .pix-as-direction button.active {
      background: #f66744; color: #fff; border-color: #f66744;
    }
    .pix-as-direction button .pix-as-dir-icon {
      width: 12px; height: 12px;
      background-color: currentColor;
      -webkit-mask: var(--pix-as-icon-url) center/contain no-repeat;
              mask: var(--pix-as-icon-url) center/contain no-repeat;
      pointer-events: none;
    }
  `;
  const style = document.createElement("style");
  style.id = "pix-as-sidebar-css";
  style.textContent = css;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// _buildSidebar — entry point called from core.mjs open()
// ---------------------------------------------------------------------------

AudioStudioEditor.prototype._buildSidebar = function () {
  injectSidebarCSS();
  const sidebar = this.sidebar;
  sidebar.textContent = "";
  sidebar.style.display = "flex";
  sidebar.style.flexDirection = "column";

  // Scrollable container so the collapsible sections can grow without
  // pushing the framework's footer (Help / Save) off-screen.
  const scroller = document.createElement("div");
  scroller.style.cssText = "flex:1; overflow-y:auto; min-height:0;";
  sidebar.appendChild(scroller);

  const sections = [
    { title: "Motion",   build: this._buildMotionSection,
      action: { icon: "reset.svg", title: "Reset Motion sliders to defaults",
                onClick: () => this._resetMotionDefaults() } },
    { title: "Overlays", build: this._buildOverlaysSection,
      action: { icon: "reset.svg", title: "Reset Overlays to defaults (all off)",
                onClick: () => this._resetOverlaysDefaults() } },
    { title: "Audio",    build: this._buildAudioSection },
    { title: "Output",   build: this._buildOutputSection },
  ];
  for (const sec of sections) {
    const panel = createPanel(sec.title, { collapsible: true });
    if (sec.action) this._attachSectionAction(panel.el, sec.action);
    scroller.appendChild(panel.el);
    sec.build.call(this, panel.content);
  }
};

/**
 * Attach a small icon button to a collapsible-section's title bar (right
 * side, pushed by margin-left:auto). Click handler is wrapped to
 * stopPropagation so it doesn't toggle the section's collapsed state.
 */
AudioStudioEditor.prototype._attachSectionAction = function (panelEl, action) {
  const titleEl = panelEl.querySelector(".pxf-panel-title");
  if (!titleEl) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pix-as-section-action";
  btn.title = action.title || "";
  const icon = document.createElement("span");
  icon.className = "pix-as-section-action-icon";
  icon.style.setProperty("--pix-as-icon-url", `url(${UI_ICON}${action.icon})`);
  btn.appendChild(icon);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    action.onClick(e);
  });
  titleEl.appendChild(btn);
};

/**
 * Restore the Motion-section sliders + toggle to the editor's stored
 * DEFAULT_CFG values. motion_mode is preserved (the user explicitly chose
 * it). Snaps undo so the reset is one Ctrl+Z away.
 */
AudioStudioEditor.prototype._resetMotionDefaults = function () {
  const d = this._defaults || {};
  const keys = [
    "intensity", "motion_speed", "smoothing", "loop_safe",
    "motion_direction",
    "shake_axis", "ripple_density", "slit_density", "glitch_bands",
    "wave_density", "pixelate_blocks", "squeeze_axis",
  ];
  let changed = false;
  for (const k of keys) {
    if (d[k] !== undefined && this.cfg[k] !== d[k]) {
      this.cfg[k] = d[k];
      changed = true;
    }
  }
  if (!changed) return;
  this._snapForUndo(true);
  this._buildSidebar();
  this._refreshSaveBtnState();
  this._onCfgChanged();
};

/**
 * Reset all overlay sliders to their DEFAULT_CFG values (which are now
 * all 0 — overlays default off). Same shape as _resetMotionDefaults.
 */
AudioStudioEditor.prototype._resetOverlaysDefaults = function () {
  const d = this._defaults || {};
  const keys = [
    "glitch_strength", "bloom_strength", "vignette_strength", "hue_shift_strength",
    "cinematic_strength", "scanline_strength", "grain_strength",
  ];
  let changed = false;
  for (const k of keys) {
    if (d[k] !== undefined && this.cfg[k] !== d[k]) {
      this.cfg[k] = d[k];
      changed = true;
    }
  }
  if (!changed) return;
  this._snapForUndo(true);
  this._buildSidebar();
  this._refreshSaveBtnState();
  this._onCfgChanged();
};

// ---------------------------------------------------------------------------
// Control helpers
// ---------------------------------------------------------------------------

AudioStudioEditor.prototype._addSlider = function (panel, label, key, min, max, step) {
  // pxf-slider-row gives us the framework's label + slider + boxed
  // number input on one line, the same look 3D Builder uses. The
  // framework auto-styles range + number children of this row inside
  // the .pxf-overlay scope (theme.mjs § "Slider row").
  const ctl = document.createElement("div");
  ctl.className = "pxf-slider-row pix-as-control";

  const lab = document.createElement("label");
  lab.className = "pxf-slider-label";
  lab.textContent = label;
  ctl.appendChild(lab);

  const isInt = step % 1 === 0;
  const parse = (s) => (isInt ? parseInt(s, 10) : parseFloat(s));
  const clamp = (v) => Math.max(min, Math.min(max, v));

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(this.cfg[key]);

  const numInput = document.createElement("input");
  numInput.type = "number";
  numInput.min = String(min);
  numInput.max = String(max);
  numInput.step = String(step);
  numInput.value = String(this.cfg[key]);

  // The framework's slider draws the orange progress fill via a CSS
  // gradient driven by --pxf-fill (a percent string).
  const updateFill = () => {
    const pct = ((parse(slider.value) - min) / (max - min)) * 100;
    slider.style.setProperty("--pxf-fill", pct + "%");
  };
  updateFill();

  slider.addEventListener("input", () => {
    const v = parse(slider.value);
    this.cfg[key] = v;
    numInput.value = String(v);
    updateFill();
    this._onCfgChanged();
  });
  // While typing — don't clamp yet (would break partial entry like ""),
  // just push valid numbers through so the preview tracks live.
  numInput.addEventListener("input", () => {
    const v = parse(numInput.value);
    if (isNaN(v)) return;
    this.cfg[key] = clamp(v);
    slider.value = String(this.cfg[key]);
    updateFill();
    this._onCfgChanged();
  });
  // On blur / Enter — final commit, snap to range + sync display.
  numInput.addEventListener("change", () => {
    let v = parse(numInput.value);
    if (isNaN(v)) v = this.cfg[key];
    v = clamp(v);
    this.cfg[key] = v;
    numInput.value = String(v);
    slider.value = String(v);
    updateFill();
    this._onCfgChanged();
  });

  ctl.appendChild(slider);
  ctl.appendChild(numInput);
  panel.appendChild(ctl);
};

/**
 * Render a categorical picker as a row of toggle-style buttons. options may
 * be plain strings or `{value, label}` objects. The active button reflects
 * cfg[key] and clicking commits the value via _onCfgChanged + optional
 * onChange. opts.columns lets you control the grid (default 2).
 */
AudioStudioEditor.prototype._addButtonGroup = function (panel, label, key, options, opts = {}) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";

  const lab = document.createElement("div");
  lab.className = "pix-as-label";
  lab.textContent = label;
  lab.style.marginBottom = "6px";
  ctl.appendChild(lab);

  const grid = document.createElement("div");
  grid.className = "pix-as-btn-group";
  grid.style.gridTemplateColumns = `repeat(${opts.columns || 2}, 1fr)`;

  const buttons = [];
  for (const opt of options) {
    const value = typeof opt === "string" ? opt : opt.value;
    const text  = typeof opt === "string" ? opt : opt.label;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.dataset.value = value;
    btn.addEventListener("click", () => {
      this.cfg[key] = value;
      for (const b of buttons) b.classList.toggle("active", b.dataset.value === value);
      if (opts.onChange) opts.onChange(value);
      this._onCfgChanged();
    });
    grid.appendChild(btn);
    buttons.push(btn);
    if (this.cfg[key] === value) btn.classList.add("active");
  }

  ctl.appendChild(grid);
  panel.appendChild(ctl);
};

AudioStudioEditor.prototype._addDropdown = function (panel, label, key, options, onChange) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";

  const lab = document.createElement("div");
  lab.className = "pix-as-label";
  lab.textContent = label;
  lab.style.marginBottom = "4px";
  ctl.appendChild(lab);

  const sel = document.createElement("select");
  sel.className = "pix-as-dropdown";
  // Each option may be a plain string (value === label) or an object
  // {value, label}. The object form lets us show friendlier labels in the
  // UI while keeping the internal id (which Python + saved workflows
  // depend on) stable. See MOTION_MODES.
  for (const opt of options) {
    const o = document.createElement("option");
    if (typeof opt === "string") {
      o.value = opt;
      o.textContent = opt;
    } else {
      o.value = opt.value;
      o.textContent = opt.label;
    }
    sel.appendChild(o);
  }
  sel.value = String(this.cfg[key]);
  sel.addEventListener("change", () => {
    this.cfg[key] = sel.value;
    if (onChange) onChange(sel.value);
    this._onCfgChanged();
  });

  ctl.appendChild(sel);
  panel.appendChild(ctl);
};

AudioStudioEditor.prototype._addToggle = function (panel, label, key) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";

  const wrap = document.createElement("label");
  wrap.className = "pix-as-toggle";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!this.cfg[key];
  cb.addEventListener("change", () => {
    this.cfg[key] = cb.checked;
    this._onCfgChanged();
  });

  const lab = document.createElement("span");
  lab.className = "pix-as-label";
  lab.textContent = label;

  wrap.appendChild(cb);
  wrap.appendChild(lab);
  ctl.appendChild(wrap);
  panel.appendChild(ctl);
};

/**
 * Inline pair of number inputs separated by "×" — used for Output's
 * Custom Width × Custom Height to save a row of vertical space and signal
 * that they belong together. Returns `{w: {label, input}, h: {label,
 * input}}` so callers can toggle disabled state per-side.
 */
AudioStudioEditor.prototype._addInlineWH = function (panel, label1, key1, label2, key2, min, max, step) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control pix-as-wh-row";

  const mkSide = (text, key) => {
    const labEl = document.createElement("label");
    labEl.className = "pix-as-wh-label";
    labEl.textContent = text;

    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "pix-as-wh-input";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(this.cfg[key]);
    inp.addEventListener("change", () => {
      let v = parseInt(inp.value, 10);
      if (isNaN(v)) v = this.cfg[key];
      v = Math.max(min, Math.min(max, v));
      this.cfg[key] = v;
      inp.value = String(v);
      this._onCfgChanged();
      // Custom Ratio mode: H is derived from W, so editing W must
      // refresh the (read-only) H display. Cheaper to refresh both
      // sides than to special-case which one changed.
      this._refreshOutputState?.();
    });
    return { label: labEl, input: inp };
  };

  const w = mkSide(label1, key1);
  const sep = document.createElement("span");
  sep.className = "pix-as-wh-sep";
  sep.textContent = "×";
  const h = mkSide(label2, key2);

  ctl.append(w.label, w.input, sep, h.label, h.input);
  panel.appendChild(ctl);
  return { w, h };
};

// ---------------------------------------------------------------------------
// Per-section builders
// ---------------------------------------------------------------------------

AudioStudioEditor.prototype._buildMotionSection = function (panel) {
  this._addButtonGroup(panel, "Motion mode", "motion_mode", MOTION_MODES, {
    columns: 3,
    onChange: () => this._refreshMotionModeUI(),
  });
  this._addDirectionToggle(panel);

  // Per-mode params — populated by _refreshMotionModeUI based on current
  // motion_mode. Sits above Intensity so mode-specific tuning is visually
  // grouped with the mode picker.
  this._modeSpecificPanel = document.createElement("div");
  panel.appendChild(this._modeSpecificPanel);

  this._addSlider(panel, "Intensity",    "intensity",    0.0, 2.0, 0.05);
  this._addSlider(panel, "Motion speed", "motion_speed", 0.05, 1.0, 0.05);
  this._addSlider(panel, "Smoothing",    "smoothing",    1, 15, 1);
  this._addToggle(panel, "Loop safe",    "loop_safe");

  this._refreshMotionModeUI();
};

/**
 * Per-mode control builders. Each builder populates the mode-specific
 * sub-panel with controls only relevant to that motion. Modes not listed
 * here have no extra params — the panel is simply empty.
 *
 * Adding a new per-mode control = (1) add the field to Params + DEFAULT_CFG
 * + render.mjs uniforms, (2) add a builder here.
 */
const MODE_SPECIFIC_BUILDERS = {
  shake(panel) {
    this._addButtonGroup(panel, "Axis", "shake_axis", SHAKE_AXES, { columns: 3 });
  },
  ripple(panel) {
    this._addSlider(panel, "Wave density", "ripple_density", 0.3, 3.0, 0.1);
  },
  slit_scan(panel) {
    this._addSlider(panel, "Bar density", "slit_density", 0.3, 3.0, 0.1);
  },
  glitch(panel) {
    this._addSlider(panel, "Bands", "glitch_bands", 5, 100, 1);
  },
  wave(panel) {
    this._addSlider(panel, "Wave density", "wave_density", 0.3, 3.0, 0.1);
  },
  pixelate(panel) {
    this._addSlider(panel, "Blocks", "pixelate_blocks", 5, 100, 1);
  },
  squeeze(panel) {
    this._addButtonGroup(panel, "Axis", "squeeze_axis", SQUEEZE_AXES, { columns: 2 });
  },
};

/**
 * Rebuild the per-mode panel + refresh the direction toggle's visibility
 * after motion_mode changes. Cheaper than rebuilding the whole sidebar
 * (other sections + their collapsed state aren't disturbed).
 */
AudioStudioEditor.prototype._refreshMotionModeUI = function () {
  this._refreshDirectionVisibility();
  if (!this._modeSpecificPanel) return;
  this._modeSpecificPanel.textContent = "";
  const builder = MODE_SPECIFIC_BUILDERS[this.cfg.motion_mode];
  if (builder) builder.call(this, this._modeSpecificPanel);
};

/**
 * Direction toggle (forward / reverse) — only visually present for motion
 * modes whose axis has a sign (see DIRECTIONAL_MOTION_MODES). For other
 * modes the row hides itself; cfg.motion_direction is preserved in case
 * the user switches back to a directional mode.
 */
AudioStudioEditor.prototype._addDirectionToggle = function (panel) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control pix-as-direction";

  const lab = document.createElement("div");
  lab.className = "pix-as-label";
  lab.textContent = "Direction";
  lab.style.minWidth = "60px";
  ctl.appendChild(lab);

  const group = document.createElement("div");
  group.className = "pix-as-direction-buttons";

  const mkBtn = (val, iconFile, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.title = title;
    const ic = document.createElement("span");
    ic.className = "pix-as-dir-icon";
    ic.style.setProperty("--pix-as-icon-url", `url(${UI_ICON}${iconFile})`);
    b.appendChild(ic);
    b.dataset.value = String(val);
    b.addEventListener("click", () => {
      this.cfg.motion_direction = val;
      fwd.classList.toggle("active", val > 0);
      rev.classList.toggle("active", val < 0);
      this._onCfgChanged();
    });
    return b;
  };
  const fwd = mkBtn(+1, "rotate-cw.svg",  "Forward / clockwise (default)");
  const rev = mkBtn(-1, "rotate-ccw.svg", "Reverse / counter-clockwise");
  const cur = (this.cfg.motion_direction ?? 1.0) >= 0 ? +1 : -1;
  fwd.classList.toggle("active", cur > 0);
  rev.classList.toggle("active", cur < 0);

  group.append(fwd, rev);
  ctl.appendChild(group);
  panel.appendChild(ctl);

  this._directionRow = ctl;
  this._refreshDirectionVisibility();
};

AudioStudioEditor.prototype._refreshDirectionVisibility = function () {
  if (!this._directionRow) return;
  const supported = DIRECTIONAL_MOTION_MODES.has(this.cfg.motion_mode);
  this._directionRow.style.display = supported ? "" : "none";
};

AudioStudioEditor.prototype._buildOverlaysSection = function (panel) {
  // "Chroma Shift" was previously labeled "Glitch" — renamed to free up
  // the "Glitch" name for the new motion mode (which warps geometry,
  // whereas this overlay only offsets RGB channels). Internal cfg key
  // glitch_strength is unchanged for saved-workflow compatibility.
  this._addSlider(panel, "Chroma Shift", "glitch_strength",     0.0, 1.0, 0.05);
  this._addSlider(panel, "Bloom",        "bloom_strength",      0.0, 1.0, 0.05);
  this._addSlider(panel, "Vignette",     "vignette_strength",   0.0, 1.0, 0.05);
  this._addSlider(panel, "Hue shift",    "hue_shift_strength",  0.0, 1.0, 0.05);
  this._addSlider(panel, "Cinematic",    "cinematic_strength",  0.0, 1.0, 0.05);
  this._addSlider(panel, "Scanlines",    "scanline_strength",   0.0, 1.0, 0.05);
  this._addSlider(panel, "Film grain",   "grain_strength",      0.0, 1.0, 0.05);
};

AudioStudioEditor.prototype._buildAudioSection = function (panel) {
  this._addButtonGroup(panel, "Audio band", "audio_band", AUDIO_BANDS, { columns: 4 });
};

AudioStudioEditor.prototype._buildOutputSection = function (panel) {
  this._addDropdown(panel, "Aspect ratio", "aspect_ratio", ASPECT_OPTIONS,
    () => this._refreshOutputState());
  this._outputWH = this._addInlineWH(panel, "W", "custom_width", "H", "custom_height", 64, 4096, 8);
  this._addSlider(panel, "FPS", "fps", 8, 60, 1);
  this._refreshOutputState();
};

/**
 * Gray out the Custom Width / Height inputs when the current aspect ratio
 * doesn't use them. Called at build time and whenever Aspect Ratio changes.
 *  - "Original" / fixed presets ("1280x720 ...") → both disabled.
 *  - "Custom Ratio X:Y (Uses Width)"             → Width on, Height off.
 *  - "Custom (Use Width & Height below)"         → both on.
 */
AudioStudioEditor.prototype._refreshOutputState = function () {
  if (!this._outputWH) return;
  const ar = this.cfg.aspect_ratio || "Original";
  const wOn = isCustomWidthAspect(ar);
  const hOn = isCustomHeightAspect(ar);

  const wInput = this._outputWH.w.input;
  const hInput = this._outputWH.h.input;
  wInput.disabled = !wOn;
  this._outputWH.w.label.classList.toggle("disabled", !wOn);
  hInput.disabled = !hOn;
  this._outputWH.h.label.classList.toggle("disabled", !hOn);

  // Editable side shows the user's stored cfg value (so they can edit it).
  // Read-only side shows the engine's actual output dim — derived from the
  // chosen aspect ratio + (for Custom Ratio modes) the typed Width — so
  // users immediately see what their video will be sized to instead of a
  // stale stored value. Original aspect can't be computed without knowing
  // the upstream image, so we leave the cfg values visible there.
  const eff = computeEngineWH(ar, this.cfg.custom_width, this.cfg.custom_height);
  wInput.value = wOn ? String(this.cfg.custom_width)
                     : String(eff?.w ?? this.cfg.custom_width);
  hInput.value = hOn ? String(this.cfg.custom_height)
                     : String(eff?.h ?? this.cfg.custom_height);
};
