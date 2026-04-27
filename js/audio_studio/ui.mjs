// js/audio_studio/ui.mjs
// Mixin: tabbed sidebar with all 16 controls.
// Adds methods to AudioStudioEditor.prototype via the mixin pattern.
import { AudioStudioEditor } from "./core.mjs";

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

const MOTION_MODES = [
  "scale_pulse", "zoom_punch", "shake", "drift",
  "rotate_pulse", "ripple", "swirl", "slit_scan",
];

const AUDIO_BANDS = ["full", "bass", "mids", "treble"];

function injectSidebarCSS() {
  if (document.getElementById("pix-as-sidebar-css")) return;
  const css = `
    .pix-as-tabs {
      display: flex;
      background: #1c1c1c;
      border-bottom: 1px solid #1a1a1a;
    }
    .pix-as-tab {
      flex: 1;
      padding: 8px 6px;
      text-align: center;
      color: #888;
      font-size: 11px;
      cursor: pointer;
      user-select: none;
    }
    .pix-as-tab.active {
      color: #f66744;
      border-bottom: 2px solid #f66744;
    }
    .pix-as-tab:hover:not(.active) { color: #ccc; }
    .pix-as-controls {
      padding: 12px;
      flex: 1;
      overflow-y: auto;
    }
    .pix-as-control { margin-bottom: 12px; }
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
    .pix-as-toggle {
      display: inline-flex; align-items: center; gap: 6px;
      cursor: pointer;
    }
    .pix-as-toggle input { cursor: pointer; }
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

  // Tab bar
  const tabs = document.createElement("div");
  tabs.className = "pix-as-tabs";
  this._tabs = {};
  this._tabPanels = {};

  const tabNames = ["Motion", "Overlays", "Audio", "Output"];
  for (const name of tabNames) {
    const tab = document.createElement("span");
    tab.className = "pix-as-tab";
    tab.textContent = name;
    tab.addEventListener("click", () => this._activateTab(name));
    tabs.appendChild(tab);
    this._tabs[name] = tab;
  }
  sidebar.appendChild(tabs);

  // One panel per tab
  for (const name of tabNames) {
    const panel = document.createElement("div");
    panel.className = "pix-as-controls";
    panel.style.display = "none";
    sidebar.appendChild(panel);
    this._tabPanels[name] = panel;
  }

  this._buildMotionTab(this._tabPanels.Motion);
  this._buildOverlaysTab(this._tabPanels.Overlays);
  this._buildAudioTab(this._tabPanels.Audio);
  this._buildOutputTab(this._tabPanels.Output);

  this._activateTab("Motion");
};

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

AudioStudioEditor.prototype._activateTab = function (name) {
  for (const k of Object.keys(this._tabs)) {
    this._tabs[k].classList.toggle("active", k === name);
    this._tabPanels[k].style.display = k === name ? "block" : "none";
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

AudioStudioEditor.prototype._addDropdown = function (panel, label, key, options) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";

  const lab = document.createElement("div");
  lab.className = "pix-as-label";
  lab.textContent = label;
  ctl.appendChild(lab);

  const sel = document.createElement("select");
  sel.className = "pix-as-dropdown";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
  sel.value = String(this.cfg[key]);
  sel.addEventListener("change", () => {
    this.cfg[key] = sel.value;
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

AudioStudioEditor.prototype._addNumberInput = function (panel, label, key, min, max, step) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";

  const lab = document.createElement("div");
  lab.className = "pix-as-label";
  lab.textContent = label;
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
};

// ---------------------------------------------------------------------------
// Per-tab builders
// ---------------------------------------------------------------------------

AudioStudioEditor.prototype._buildMotionTab = function (panel) {
  this._addDropdown(panel, "Motion mode",   "motion_mode",   MOTION_MODES);
  this._addSlider(  panel, "Intensity",     "intensity",     0.0, 2.0, 0.05, v => v.toFixed(2));
  this._addSlider(  panel, "Motion speed",  "motion_speed",  0.05, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(  panel, "Smoothing",     "smoothing",     1, 15, 1);
  this._addToggle(  panel, "Loop safe",     "loop_safe");
};

AudioStudioEditor.prototype._buildOverlaysTab = function (panel) {
  this._addSlider(panel, "Glitch",     "glitch_strength",    0.0, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Bloom",      "bloom_strength",     0.0, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Vignette",   "vignette_strength",  0.0, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Hue shift",  "hue_shift_strength", 0.0, 1.0, 0.05, v => v.toFixed(2));
};

AudioStudioEditor.prototype._buildAudioTab = function (panel) {
  this._addDropdown(panel, "Audio band", "audio_band", AUDIO_BANDS);

  // Read-only source status — click paths land in Milestone H (pills in header)
  const status = document.createElement("div");
  status.style.color = "#888";
  status.style.fontSize = "11px";
  status.style.marginTop = "20px";
  status.innerHTML = `
    Image source: <code>${this.cfg.image_source}</code><br>
    Audio source: <code>${this.cfg.audio_source}</code><br>
    <em style="color:#666;font-size:10px">(Click pills in header to change &mdash; H1/H2)</em>
  `;
  panel.appendChild(status);
};

AudioStudioEditor.prototype._buildOutputTab = function (panel) {
  this._addDropdown(    panel, "Aspect ratio",  "aspect_ratio",  ASPECT_OPTIONS);
  this._addNumberInput( panel, "Custom width",  "custom_width",  64, 4096, 8);
  this._addNumberInput( panel, "Custom height", "custom_height", 64, 4096, 8);
  this._addNumberInput( panel, "FPS",           "fps",            8,   60, 1);
};
