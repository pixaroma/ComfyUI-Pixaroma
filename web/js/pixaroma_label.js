import { app } from "/scripts/app.js";
import {
  hideJsonWidget,
  BRAND,
  installFocusTrap,
} from "./pixaroma_node_utils.js";
import { allow_debug } from "./pixaroma_shared.js";

// ─── Defaults ────────────────────────────────────────────────
const DEFAULTS = {
  text: "Label Pixaroma",
  fontSize: 18,
  fontFamily: "Arial",
  fontColor: "#ffffff",
  textAlign: "left",
  backgroundColor: "#333333",
  padding: 10,
  borderRadius: 6,
  opacity: 1,
  fontWeight: "normal",
  lineHeight: 1,
};

const FONT_CHOICES = ["Arial", "Times New Roman", "Courier New", "Impact"];
const FONT_SHORT = ["Arial", "Times", "Courier", "Impact"];

// Color swatches
const TEXT_SWATCHES = [
  "#ffffff",
  "#cccccc",
  "#999999",
  "#333333",
  "#000000",
  "#f66744",
  "#cc3333",
  "#33aa33",
  "#3388dd",
  "#ddaa00",
];
const BG_SWATCHES = [
  "#333333",
  "#444444",
  "#555555",
  "#222222",
  "#111111",
  "#f66744",
  "#593930",
  "#355735",
  "#354f6b",
  "#4f3560",
  "#ffe0e0",
  "#e0ffe0",
  "#e0e0ff",
  "#fff3e0",
  "#f0f0f0",
];

// ─── Helpers ─────────────────────────────────────────────────
function parseCfg(node) {
  const w = (node.widgets || []).find((x) => x.name === "label_json");
  if (!w?.value || w.value === "{}") return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(w.value) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function saveCfg(node, cfg) {
  node._labelCfg = cfg;
  const w = (node.widgets || []).find((x) => x.name === "label_json");
  if (w) {
    const json = JSON.stringify(cfg);
    w.value = json;
    if (node.widgets_values) {
      const i = node.widgets.findIndex((x) => x.name === "label_json");
      if (i > -1) node.widgets_values[i] = json;
    }
    if (w.callback) w.callback(w.value);
  }
  if (app.graph) {
    app.graph.setDirtyCanvas(true, true);
    if (typeof app.graph.change === "function") app.graph.change();
  }
}

function fontStr(cfg) {
  return `${cfg.fontWeight === "bold" ? "bold " : ""}${cfg.fontSize}px '${cfg.fontFamily}', 'Segoe UI Emoji', 'Noto Color Emoji', system-ui, sans-serif`;
}

function measureLabel(cfg) {
  const cvs = document.createElement("canvas");
  const ctx = cvs.getContext("2d");
  ctx.font = fontStr(cfg);
  const lines = (cfg.text || "").split("\n");
  const lh = cfg.fontSize * cfg.lineHeight;
  let maxW = 0;
  for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width);
  return {
    w: Math.ceil(maxW) + cfg.padding * 2,
    h: Math.ceil(lines.length * lh) + cfg.padding * 2,
    lines,
    lh,
  };
}

// ─── CSS injection (once) ────────────────────────────────────
let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
.pix-lbl-overlay {
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', system-ui, sans-serif;
}
.pix-lbl-panel {
    background: #171718; border: 1px solid #333; border-radius: 10px;
    width: 660px; max-height: 90vh; overflow-y: auto;
    box-shadow: 0 12px 40px rgba(0,0,0,0.6); position: relative;
}
.pix-lbl-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid #2a2a2a;
}
.pix-lbl-header span { color: #fff; font-size: 15px; font-weight: 600; }
.pix-lbl-close {
    background: none; border: none; color: #666; font-size: 20px;
    cursor: pointer; padding: 0 4px; line-height: 1;
}
.pix-lbl-close:hover { color: #fff; }
.pix-lbl-body { padding: 16px 18px; }
.pix-lbl-field { margin-bottom: 14px; }
.pix-lbl-field > .pix-lbl-lbl {
    display: block; color: #777; font-size: 10px; margin-bottom: 5px;
    text-transform: uppercase; letter-spacing: 0.6px;
}
.pix-lbl-field textarea {
    width: 100%; box-sizing: border-box;
    background: #222; border: 1px solid #333; border-radius: 5px;
    color: #ddd; padding: 8px 10px; font-size: 13px;
    font-family: inherit; outline: none; resize: vertical; min-height: 56px;
}
.pix-lbl-field textarea:focus { border-color: ${BRAND}; }
.pix-lbl-preview {
    margin-bottom: 14px; background: #111; border-radius: 6px;
    padding: 12px; min-height: 36px; display: flex;
    align-items: center; justify-content: center; overflow: hidden;
}
.pix-lbl-preview canvas { max-width: 100%; height: auto; }
/* Toggle button group */
.pix-lbl-btns { display: flex; gap: 4px; flex-wrap: wrap; }
.pix-lbl-btn {
    padding: 5px 12px; border: 1px solid #444; border-radius: 4px;
    background: #2a2c2e; color: #999; font-size: 12px; cursor: pointer;
    transition: all 0.15s;
}
.pix-lbl-btn:hover { border-color: #666; color: #ccc; }
.pix-lbl-btn.active { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
/* Bold button */
.pix-lbl-bold { font-weight: bold; min-width: 32px; text-align: center; }
/* Range row */
.pix-lbl-range-wrap { display: flex; align-items: center; gap: 8px; }
.pix-lbl-range-wrap input[type="range"] { flex: 1; accent-color: ${BRAND}; }
.pix-lbl-range-wrap .pix-lbl-val {
    color: #999; font-size: 12px; min-width: 32px; text-align: right;
}
/* Inline row */
.pix-lbl-row { display: flex; gap: 12px; align-items: flex-end; }
.pix-lbl-row > .pix-lbl-field { flex: 1; margin-bottom: 0; }
/* Color section */
.pix-lbl-swatches { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.pix-lbl-swatch {
    width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
    border: 2px solid transparent; transition: border-color 0.15s;
    box-sizing: border-box;
}
.pix-lbl-swatch:hover { border-color: #888; }
.pix-lbl-swatch.active { border-color: #fff; }
.pix-lbl-swatch-transp {
    width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
    border: 2px solid transparent; box-sizing: border-box;
    background: repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 50%/10px 10px;
}
.pix-lbl-swatch-transp:hover { border-color: #888; }
.pix-lbl-swatch-transp.active { border-color: #fff; }
.pix-lbl-color-row { display: flex; align-items: center; gap: 6px; }
.pix-lbl-color-row input[type="color"] {
    width: 30px; height: 26px; padding: 0; border: 1px solid #444;
    border-radius: 4px; background: #222; cursor: pointer;
}
.pix-lbl-color-row .pix-lbl-hex {
    width: 76px; background: #222; border: 1px solid #333; border-radius: 4px;
    color: #ddd; padding: 4px 6px; font-size: 11px; font-family: monospace;
    outline: none;
}
.pix-lbl-color-row .pix-lbl-hex:focus { border-color: ${BRAND}; }
/* Footer */
.pix-lbl-footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 18px; border-top: 1px solid #2a2a2a;
}
.pix-lbl-footer button {
    padding: 8px 20px; border: none; border-radius: 5px;
    font-size: 13px; cursor: pointer; font-weight: 500;
}
.pix-lbl-btn-cancel { background: #2a2a2a; color: #ccc; }
.pix-lbl-btn-cancel:hover { background: #363636; }
.pix-lbl-btn-save { background: ${BRAND}; color: #fff; }
.pix-lbl-btn-save:hover { opacity: 0.9; }
/* Align icon buttons */
.pix-lbl-align-icon { display: flex; flex-direction: column; gap: 2px; width: 14px; align-items: flex-start; }
.pix-lbl-align-icon span { display: block; height: 2px; background: currentColor; border-radius: 1px; }
.pix-lbl-align-left .pix-lbl-align-icon span:nth-child(1) { width: 14px; }
.pix-lbl-align-left .pix-lbl-align-icon span:nth-child(2) { width: 10px; }
.pix-lbl-align-left .pix-lbl-align-icon span:nth-child(3) { width: 12px; }
.pix-lbl-align-center .pix-lbl-align-icon { align-items: center; }
.pix-lbl-align-center .pix-lbl-align-icon span:nth-child(1) { width: 14px; }
.pix-lbl-align-center .pix-lbl-align-icon span:nth-child(2) { width: 10px; }
.pix-lbl-align-center .pix-lbl-align-icon span:nth-child(3) { width: 12px; }
.pix-lbl-align-right .pix-lbl-align-icon { align-items: flex-end; }
.pix-lbl-align-right .pix-lbl-align-icon span:nth-child(1) { width: 14px; }
.pix-lbl-align-right .pix-lbl-align-icon span:nth-child(2) { width: 10px; }
.pix-lbl-align-right .pix-lbl-align-icon span:nth-child(3) { width: 12px; }
/* Help overlay */
.pix-lbl-help-overlay {
    position: absolute; inset: 0; background: #171718;
    border-radius: 10px; padding: 28px; overflow-y: auto;
    color: #ccc; font-size: 13px; line-height: 1.7; z-index: 10;
}
.pix-lbl-help-overlay h3 { color: ${BRAND}; margin: 0 0 12px 0; font-size: 16px; }
.pix-lbl-help-overlay p { margin: 0 0 8px 0; }
.pix-lbl-help-overlay kbd {
    background: #333; border: 1px solid #555; border-radius: 3px;
    padding: 1px 5px; font-size: 11px; font-family: monospace; color: #ddd;
}
.pix-lbl-help-close {
    position: absolute; top: 12px; right: 16px;
    background: none; border: none; color: #666; font-size: 20px;
    cursor: pointer;
}
.pix-lbl-help-close:hover { color: #fff; }
/* Help button */
.pix-lbl-btn-help { background: #2a2a2a; color: #999; font-size: 12px; padding: 8px 14px; }
.pix-lbl-btn-help:hover { background: #363636; color: #ccc; }
`;
  document.head.appendChild(style);
}

// ─── Editor Popup ────────────────────────────────────────────
class LabelEditor {
  constructor(node) {
    this.node = node;
    this.cfg = { ...parseCfg(node) };
    this._el = null;
  }

  open() {
    injectCSS();
    this._build();
    document.body.appendChild(this._el);
    installFocusTrap(this._el);
    this._updatePreview();
    this._keyBlock = (e) => {
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", this._keyBlock, true);
    window.addEventListener("keyup", this._keyBlock, true);
    window.addEventListener("keypress", this._keyBlock, true);
  }

  close() {
    window.removeEventListener("keydown", this._keyBlock, true);
    window.removeEventListener("keyup", this._keyBlock, true);
    window.removeEventListener("keypress", this._keyBlock, true);
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
  }

  save() {
    saveCfg(this.node, this.cfg);
    this.close();
  }

  _build() {
    const c = this.cfg;
    const el = (tag, cls) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      return e;
    };
    const lbl = (text) => {
      const l = el("div", "pix-lbl-lbl");
      l.textContent = text;
      return l;
    };

    const overlay = el("div", "pix-lbl-overlay");
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) this.close();
    });
    const panel = el("div", "pix-lbl-panel");
    overlay.appendChild(panel);

    // Header
    const header = el("div", "pix-lbl-header");
    header.innerHTML = `<span>Edit Label</span>`;
    const closeBtn = el("button", "pix-lbl-close");
    closeBtn.textContent = "\u00d7";
    closeBtn.onclick = () => this.close();
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Body
    const body = el("div", "pix-lbl-body");
    panel.appendChild(body);

    // ── Text
    const textField = el("div", "pix-lbl-field");
    textField.appendChild(lbl("Text"));
    const ta = document.createElement("textarea");
    ta.value = c.text;
    ta.rows = 3;
    ta.addEventListener("input", () => {
      c.text = ta.value;
      this._updatePreview();
    });
    textField.appendChild(ta);
    body.appendChild(textField);

    // ── Preview
    const prevWrap = el("div", "pix-lbl-preview");
    this._previewCanvas = document.createElement("canvas");
    prevWrap.appendChild(this._previewCanvas);
    body.appendChild(prevWrap);

    // ── Font Size (slider)
    const sizeField = el("div", "pix-lbl-field");
    sizeField.appendChild(lbl("Font Size"));
    const sizeWrap = el("div", "pix-lbl-range-wrap");
    const sizeRange = document.createElement("input");
    sizeRange.type = "range";
    sizeRange.min = 8;
    sizeRange.max = 64;
    sizeRange.value = c.fontSize;
    const sizeVal = el("span", "pix-lbl-val");
    sizeVal.textContent = c.fontSize;
    sizeRange.addEventListener("input", () => {
      c.fontSize = Number(sizeRange.value);
      sizeVal.textContent = c.fontSize;
      this._updatePreview();
    });
    sizeWrap.appendChild(sizeRange);
    sizeWrap.appendChild(sizeVal);
    sizeField.appendChild(sizeWrap);
    body.appendChild(sizeField);

    // ── Font Family (toggle buttons) + Bold + Align
    const fontRow = el("div", "pix-lbl-field");
    fontRow.appendChild(lbl("Font"));
    const fontBtns = el("div", "pix-lbl-btns");
    const fontBtnEls = [];
    for (let i = 0; i < FONT_CHOICES.length; i++) {
      const btn = el("button", "pix-lbl-btn");
      btn.textContent = FONT_SHORT[i];
      btn.style.fontFamily = FONT_CHOICES[i];
      if (c.fontFamily === FONT_CHOICES[i]) btn.classList.add("active");
      btn.onclick = () => {
        c.fontFamily = FONT_CHOICES[i];
        fontBtnEls.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this._updatePreview();
      };
      fontBtnEls.push(btn);
      fontBtns.appendChild(btn);
    }
    // Bold toggle
    const boldBtn = el("button", "pix-lbl-btn pix-lbl-bold");
    boldBtn.textContent = "B";
    if (c.fontWeight === "bold") boldBtn.classList.add("active");
    boldBtn.onclick = () => {
      c.fontWeight = c.fontWeight === "bold" ? "normal" : "bold";
      boldBtn.classList.toggle("active");
      this._updatePreview();
    };
    fontBtns.appendChild(boldBtn);
    // Separator
    const sep = el("span");
    sep.style.cssText = "width:1px;height:20px;background:#444;margin:0 4px;";
    fontBtns.appendChild(sep);
    // Align buttons with CSS icons
    const aligns = ["left", "center", "right"];
    const alignBtnEls = [];
    for (const a of aligns) {
      const btn = el("button", `pix-lbl-btn pix-lbl-align-${a}`);
      btn.title = a;
      const icon = el("div", "pix-lbl-align-icon");
      icon.innerHTML = "<span></span><span></span><span></span>";
      btn.appendChild(icon);
      if (c.textAlign === a) btn.classList.add("active");
      btn.onclick = () => {
        c.textAlign = a;
        alignBtnEls.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this._updatePreview();
      };
      alignBtnEls.push(btn);
      fontBtns.appendChild(btn);
    }
    fontRow.appendChild(fontBtns);
    body.appendChild(fontRow);

    // ── Text Color
    const tcField = el("div", "pix-lbl-field");
    tcField.appendChild(lbl("Text Color"));
    const tcSwatches = el("div", "pix-lbl-swatches");
    this._buildSwatches(
      tcSwatches,
      TEXT_SWATCHES,
      c.fontColor,
      (color, swEls) => {
        c.fontColor = color;
        tcPicker.value = color;
        tcHex.value = color;
        swEls.forEach((s) =>
          s.classList.toggle("active", s.dataset.color === color),
        );
        this._updatePreview();
      },
    );
    tcField.appendChild(tcSwatches);
    const tcRow = el("div", "pix-lbl-color-row");
    const tcPicker = document.createElement("input");
    tcPicker.type = "color";
    tcPicker.value = c.fontColor;
    const tcHex = document.createElement("input");
    tcHex.type = "text";
    tcHex.className = "pix-lbl-hex";
    tcHex.value = c.fontColor;
    tcPicker.addEventListener("input", () => {
      c.fontColor = tcPicker.value;
      tcHex.value = tcPicker.value;
      this._clearSwatchActive(tcSwatches, tcPicker.value);
      this._updatePreview();
    });
    tcHex.addEventListener("input", () => {
      const v = tcHex.value.startsWith("#") ? tcHex.value : `#${tcHex.value}`;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        c.fontColor = v;
        tcPicker.value = v;
        this._clearSwatchActive(tcSwatches, v);
        this._updatePreview();
      }
    });
    tcRow.appendChild(tcPicker);
    tcRow.appendChild(tcHex);
    tcField.appendChild(tcRow);
    body.appendChild(tcField);

    // ── Background Color
    const bgField = el("div", "pix-lbl-field");
    bgField.appendChild(lbl("Background"));
    const bgSwatches = el("div", "pix-lbl-swatches");
    // Add transparent swatch first
    const transpSw = el("div", "pix-lbl-swatch-transp");
    transpSw.title = "Transparent";
    if (c.backgroundColor === "transparent") transpSw.classList.add("active");
    transpSw.onclick = () => {
      c.backgroundColor = "transparent";
      bgPicker.disabled = true;
      bgHex.disabled = true;
      bgSwatches
        .querySelectorAll(".pix-lbl-swatch,.pix-lbl-swatch-transp")
        .forEach((s) => s.classList.remove("active"));
      transpSw.classList.add("active");
      this._updatePreview();
    };
    bgSwatches.appendChild(transpSw);
    this._buildSwatches(
      bgSwatches,
      BG_SWATCHES,
      c.backgroundColor,
      (color, swEls) => {
        c.backgroundColor = color;
        bgPicker.value = color;
        bgPicker.disabled = false;
        bgHex.value = color;
        bgHex.disabled = false;
        transpSw.classList.remove("active");
        swEls.forEach((s) =>
          s.classList.toggle("active", s.dataset.color === color),
        );
        this._updatePreview();
      },
    );
    bgField.appendChild(bgSwatches);
    const bgRow = el("div", "pix-lbl-color-row");
    const bgPicker = document.createElement("input");
    bgPicker.type = "color";
    bgPicker.value =
      c.backgroundColor === "transparent" ? "#333333" : c.backgroundColor;
    bgPicker.disabled = c.backgroundColor === "transparent";
    const bgHex = document.createElement("input");
    bgHex.type = "text";
    bgHex.className = "pix-lbl-hex";
    bgHex.value = c.backgroundColor === "transparent" ? "" : c.backgroundColor;
    bgHex.disabled = c.backgroundColor === "transparent";
    bgHex.placeholder = "transparent";
    bgPicker.addEventListener("input", () => {
      c.backgroundColor = bgPicker.value;
      bgHex.value = bgPicker.value;
      transpSw.classList.remove("active");
      this._clearSwatchActive(bgSwatches, bgPicker.value);
      this._updatePreview();
    });
    bgHex.addEventListener("input", () => {
      const v = bgHex.value.startsWith("#") ? bgHex.value : `#${bgHex.value}`;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        c.backgroundColor = v;
        bgPicker.value = v;
        transpSw.classList.remove("active");
        this._clearSwatchActive(bgSwatches, v);
        this._updatePreview();
      }
    });
    bgRow.appendChild(bgPicker);
    bgRow.appendChild(bgHex);
    bgField.appendChild(bgRow);
    body.appendChild(bgField);

    // ── Padding + Border Radius + Opacity (compact row)
    const row4 = el("div", "pix-lbl-row");
    row4.style.marginBottom = "14px";
    row4.appendChild(
      this._rangeField("Padding", c.padding, 0, 60, 1, (v) => {
        c.padding = v;
      }),
    );
    row4.appendChild(
      this._rangeField("Radius", c.borderRadius, 0, 40, 1, (v) => {
        c.borderRadius = v;
      }),
    );
    body.appendChild(row4);

    const row5 = el("div", "pix-lbl-row");
    row5.style.marginBottom = "0";
    row5.appendChild(
      this._rangeField("Opacity", c.opacity, 0, 1, 0.05, (v) => {
        c.opacity = v;
      }),
    );
    row5.appendChild(
      this._rangeField("Line Height", c.lineHeight, 1, 3, 0.1, (v) => {
        c.lineHeight = v;
      }),
    );
    body.appendChild(row5);

    // Footer
    const footer = el("div", "pix-lbl-footer");
    const helpBtn = el("button", "pix-lbl-btn-help");
    helpBtn.textContent = "Help";
    helpBtn.style.marginRight = "auto";
    helpBtn.onclick = () => this._showHelp(panel);
    const cancelBtn = el("button", "pix-lbl-btn-cancel");
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => this.close();
    const saveBtn = el("button", "pix-lbl-btn-save");
    saveBtn.textContent = "Save";
    saveBtn.onclick = () => this.save();
    footer.appendChild(helpBtn);
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    panel.appendChild(footer);

    this._el = overlay;
  }

  // ── Help overlay ─────────────────────────────────────────
  _showHelp(panel) {
    if (panel.querySelector(".pix-lbl-help-overlay")) return;
    const help = document.createElement("div");
    help.className = "pix-lbl-help-overlay";
    help.innerHTML = `
            <h3>Label Pixaroma</h3>
            <p><b>Double-click</b> a label on the canvas to open this editor.</p>
            <p><b>Text</b> — supports multiline text and emoji.</p>
            <p><b>Font Size</b> — drag the slider to adjust (8–64px).</p>
            <p><b>Font buttons</b> — click to switch between Arial, Times, Courier, Impact.</p>
            <p><b>B</b> — toggle bold on/off.</p>
            <p><b>Align</b> — left, center, or right text alignment.</p>
            <p><b>Color swatches</b> — click a swatch for quick color selection, or use the picker for custom colors.</p>
            <p><b>Transparent</b> — the checkerboard swatch removes the background.</p>
            <p><b>Padding</b> — space between text and the label edge.</p>
            <p><b>Radius</b> — corner roundness of the background.</p>
            <p><b>Opacity</b> — overall transparency of the label.</p>
            <p><b>Line Height</b> — spacing between lines of text.</p>
            <p style="margin-top:14px;color:#777">Pixaroma &mdash; <a href="https://www.youtube.com/@pixaroma" style="color:${BRAND}">youtube.com/@pixaroma</a></p>
        `;
    const closeBtn = document.createElement("button");
    closeBtn.className = "pix-lbl-help-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.onclick = () => help.remove();
    help.appendChild(closeBtn);
    panel.appendChild(help);
  }

  // ── Swatch helpers ───────────────────────────────────────
  _buildSwatches(container, colors, activeColor, onSelect) {
    const swEls = [];
    for (const color of colors) {
      const sw = document.createElement("div");
      sw.className = "pix-lbl-swatch";
      sw.style.background = color;
      sw.dataset.color = color;
      sw.title = color;
      if (color === activeColor) sw.classList.add("active");
      sw.onclick = () => onSelect(color, swEls);
      swEls.push(sw);
      container.appendChild(sw);
    }
    return swEls;
  }

  _clearSwatchActive(container, activeColor) {
    container
      .querySelectorAll(".pix-lbl-swatch,.pix-lbl-swatch-transp")
      .forEach((s) => {
        s.classList.toggle("active", s.dataset.color === activeColor);
      });
  }

  // ── Range field ──────────────────────────────────────────
  _rangeField(label, val, min, max, step, onChange) {
    const field = document.createElement("div");
    field.className = "pix-lbl-field";
    const l = document.createElement("div");
    l.className = "pix-lbl-lbl";
    l.textContent = label;
    field.appendChild(l);
    const wrap = document.createElement("div");
    wrap.className = "pix-lbl-range-wrap";
    const range = document.createElement("input");
    range.type = "range";
    range.min = min;
    range.max = max;
    range.step = step;
    range.value = val;
    const valSpan = document.createElement("span");
    valSpan.className = "pix-lbl-val";
    valSpan.textContent = Number(val).toFixed(step < 1 ? 2 : 0);
    range.addEventListener("input", () => {
      const v = Number(range.value);
      valSpan.textContent = v.toFixed(step < 1 ? 2 : 0);
      onChange(v);
      this._updatePreview();
    });
    wrap.appendChild(range);
    wrap.appendChild(valSpan);
    field.appendChild(wrap);
    return field;
  }

  // ── Live preview ─────────────────────────────────────────
  _updatePreview() {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      this._renderPreview();
    });
  }

  _renderPreview() {
    const c = this.cfg;
    const m = measureLabel(c);
    const cvs = this._previewCanvas;
    // Use 1:1 pixel ratio — let CSS max-width handle scaling if too wide
    cvs.width = m.w;
    cvs.height = m.h;
    cvs.style.width = "";
    cvs.style.height = "";
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, m.w, m.h);
    ctx.globalAlpha = c.opacity;
    if (c.backgroundColor !== "transparent") {
      ctx.fillStyle = c.backgroundColor;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, 0, m.w, m.h, c.borderRadius);
      else ctx.rect(0, 0, m.w, m.h);
      ctx.fill();
    }
    ctx.font = fontStr(c);
    ctx.fillStyle = c.fontColor;
    ctx.textBaseline = "top";
    ctx.textAlign = c.textAlign;
    let tx = c.padding;
    if (c.textAlign === "center") tx = m.w / 2;
    else if (c.textAlign === "right") tx = m.w - c.padding;
    for (let i = 0; i < m.lines.length; i++) {
      ctx.fillText(m.lines[i], tx, c.padding + i * m.lh);
    }
    ctx.globalAlpha = 1;
  }
}

// ─── Setup helpers ───────────────────────────────────────────
const NO_TITLE = (typeof LiteGraph !== "undefined" && LiteGraph.NO_TITLE) || 1;

function setupLabel(node) {
  try {
    hideJsonWidget(node.widgets, "label_json");
    node._labelCfg = parseCfg(node);
    node.color = "#fff0";
    node.bgcolor = "#fff0";
    node.flags = node.flags || {};
    node.flags.no_title = true;
    // Remove input slots so no connections can be made
    if (node.inputs) node.inputs.length = 0;
    const m = measureLabel(node._labelCfg);
    if (node.size) {
      node.size[0] = Math.max(m.w, 60);
      node.size[1] = Math.max(m.h, 30);
    }
  } catch (err) {
    console.error("[Pixaroma Label] setupLabel error:", err);
  }
}

// ─── Extension Registration ──────────────────────────────────
app.registerExtension({
  name: "Pixaroma.Label",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaLabel") return;

    nodeType.title_mode = NO_TITLE;

    // ── Creation ─────────────────────────────────────────
    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _origCreated?.apply(this, arguments);
      setupLabel(this);
      this.badges = [];
      return r;
    };

    // ── Configure (load from saved workflow) ─────────────
    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const r = _origCfg?.apply(this, arguments);
      setupLabel(this);
      return r;
    };

    // ── Drawing ──────────────────────────────────────────
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      this.color = "transparent";
      this.bgcolor = "transparent";

      const c = this._labelCfg || DEFAULTS;
      const m = measureLabel(c);
      this.size[0] = m.w;
      this.size[1] = m.h;

      ctx.save();
      ctx.globalAlpha = c.opacity;

      if (c.backgroundColor !== "transparent") {
        ctx.fillStyle = c.backgroundColor;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(0, 0, m.w, m.h, c.borderRadius);
        else ctx.rect(0, 0, m.w, m.h);
        ctx.fill();
      }

      ctx.font = fontStr(c);
      ctx.fillStyle = c.fontColor;
      ctx.textBaseline = "top";
      ctx.textAlign = c.textAlign;
      let tx = c.padding;
      if (c.textAlign === "center") tx = m.w / 2;
      else if (c.textAlign === "right") tx = m.w - c.padding;
      for (let i = 0; i < m.lines.length; i++) {
        ctx.fillText(m.lines[i], tx, c.padding + i * m.lh);
      }
      ctx.restore();

      // Remove input slots every frame (ComfyUI may re-add them)
      if (this.inputs && this.inputs.length) this.inputs.length = 0;
    };

    // ── Double-click → open editor ───────────────────────
    const _origDblClick = nodeType.prototype.onDblClick;
    nodeType.prototype.onDblClick = function (e, pos) {
      const editor = new LabelEditor(this);
      editor.open();
      return true;
    };
  },
});
