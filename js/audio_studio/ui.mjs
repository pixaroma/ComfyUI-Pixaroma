// js/audio_studio/ui.mjs
// Mixin: collapsible-section sidebar (3D-Builder style) — Motion / Overlays /
// Audio / Output. Adds methods to AudioStudioEditor.prototype.
import { AudioStudioEditor } from "./core.mjs";
import { createPanel } from "../framework/index.mjs";

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

function injectSidebarCSS() {
  if (document.getElementById("pix-as-sidebar-css")) return;
  const css = `
    .pix-as-controls { padding: 12px; flex: 1; overflow-y: auto; }
    .pix-as-control { margin-bottom: 12px; }
    .pix-as-control:last-child { margin-bottom: 0; }
    .pix-as-control-row {
      display: flex; align-items: baseline; justify-content: space-between;
      margin-bottom: 4px;
    }
    .pix-as-label {
      color: #aaa;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .pix-as-label.disabled { color: #555; }
    .pix-as-value {
      color: #ccc;
      font-size: 11px;
      font-family: ui-monospace, monospace;
    }
    .pix-as-slider {
      width: 100%;
      -webkit-appearance: none;
      appearance: none;
      height: 4px;
      background: #1a1a1a;
      border-radius: 2px;
      outline: none;
    }
    .pix-as-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px; height: 14px;
      background: #f66744;
      border-radius: 50%;
      cursor: pointer;
    }
    .pix-as-slider::-moz-range-thumb {
      width: 14px; height: 14px;
      background: #f66744;
      border-radius: 50%;
      border: none;
      cursor: pointer;
    }
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
    ["Motion",   this._buildMotionSection],
    ["Overlays", this._buildOverlaysSection],
    ["Audio",    this._buildAudioSection],
    ["Output",   this._buildOutputSection],
  ];
  for (const [title, builder] of sections) {
    const panel = createPanel(title, { collapsible: true });
    scroller.appendChild(panel.el);
    builder.call(this, panel.content);
  }
};

// ---------------------------------------------------------------------------
// Control helpers
// ---------------------------------------------------------------------------

AudioStudioEditor.prototype._addSlider = function (panel, label, key, min, max, step, fmt) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";

  const row = document.createElement("div");
  row.className = "pix-as-control-row";

  const lab = document.createElement("span");
  lab.className = "pix-as-label";
  lab.textContent = label;

  const val = document.createElement("span");
  val.className = "pix-as-value";
  const refresh = () => { val.textContent = fmt ? fmt(this.cfg[key]) : String(this.cfg[key]); };
  refresh();

  row.appendChild(lab);
  row.appendChild(val);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "pix-as-slider";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(this.cfg[key]);
  slider.addEventListener("input", () => {
    const v = step % 1 === 0 ? parseInt(slider.value, 10) : parseFloat(slider.value);
    this.cfg[key] = v;
    refresh();
    this._onCfgChanged();
  });

  ctl.appendChild(row);
  ctl.appendChild(slider);
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
 * Number input. Returns `{ ctl, label, input }` so callers that need to
 * disable / re-style the control later (e.g. Output's W/H gating on aspect
 * ratio) can grab references at build time.
 */
AudioStudioEditor.prototype._addNumberInput = function (panel, label, key, min, max, step) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";

  const lab = document.createElement("div");
  lab.className = "pix-as-label";
  lab.textContent = label;
  lab.style.marginBottom = "4px";
  ctl.appendChild(lab);

  const inp = document.createElement("input");
  inp.type = "number";
  inp.className = "pix-as-input";
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  inp.value = String(this.cfg[key]);
  inp.addEventListener("change", () => {
    let v = step % 1 === 0 ? parseInt(inp.value, 10) : parseFloat(inp.value);
    if (isNaN(v)) v = this.cfg[key];
    v = Math.max(min, Math.min(max, v));
    this.cfg[key] = v;
    inp.value = String(v);
    this._onCfgChanged();
  });

  ctl.appendChild(inp);
  panel.appendChild(ctl);
  return { ctl, label: lab, input: inp };
};

// ---------------------------------------------------------------------------
// Per-section builders
// ---------------------------------------------------------------------------

AudioStudioEditor.prototype._buildMotionSection = function (panel) {
  this._addButtonGroup(panel, "Motion mode", "motion_mode", MOTION_MODES, { columns: 2 });
  this._addSlider(panel, "Intensity",    "intensity",    0.0, 2.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Motion speed", "motion_speed", 0.05, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Smoothing",    "smoothing",    1, 15, 1);
  this._addToggle(panel, "Loop safe",    "loop_safe");
};

AudioStudioEditor.prototype._buildOverlaysSection = function (panel) {
  this._addSlider(panel, "Glitch",    "glitch_strength",    0.0, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Bloom",     "bloom_strength",     0.0, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Vignette",  "vignette_strength",  0.0, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Hue shift", "hue_shift_strength", 0.0, 1.0, 0.05, v => v.toFixed(2));
};

AudioStudioEditor.prototype._buildAudioSection = function (panel) {
  this._addButtonGroup(panel, "Audio band", "audio_band", AUDIO_BANDS, { columns: 4 });
};

AudioStudioEditor.prototype._buildOutputSection = function (panel) {
  this._addDropdown(panel, "Aspect ratio", "aspect_ratio", ASPECT_OPTIONS,
    () => this._refreshOutputState());
  this._outputW = this._addNumberInput(panel, "Custom width",  "custom_width",  64, 4096, 8);
  this._outputH = this._addNumberInput(panel, "Custom height", "custom_height", 64, 4096, 8);
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
  const ar = this.cfg.aspect_ratio || "Original";
  const wOn = isCustomWidthAspect(ar);
  const hOn = isCustomHeightAspect(ar);
  if (this._outputW) {
    this._outputW.input.disabled = !wOn;
    this._outputW.label.classList.toggle("disabled", !wOn);
  }
  if (this._outputH) {
    this._outputH.input.disabled = !hOn;
    this._outputH.label.classList.toggle("disabled", !hOn);
  }
};
