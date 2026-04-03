import { app } from "/scripts/app.js";
import { BRAND, installFocusTrap } from "../shared/index.js";
import {
  DEFAULTS,
  FONT_CHOICES,
  FONT_SHORT,
  TEXT_SWATCHES,
  BG_SWATCHES,
  fontStr,
  measureLabel,
  renderLabelToCanvas,
  injectCSS,
} from "./render.js";

// ─── Config helpers ──────────────────────────────────────────
export function parseCfg(node) {
  const w = (node.widgets || []).find((x) => x.name === "label_json");
  if (!w?.value || w.value === "{}") return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(w.value) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function saveCfg(node, cfg) {
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

// ─── Editor Popup ────────────────────────────────────────────
export class LabelEditor {
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
    const vsep = () => el("span", "pix-lbl-vsep");

    const overlay = el("div", "pix-lbl-overlay");
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) this.close();
    });
    const panel = el("div", "pix-lbl-panel");
    overlay.appendChild(panel);

    // ── Header
    const header = el("div", "pix-lbl-header");
    const titleSpan = el("span", "pix-lbl-title");
    const logo = document.createElement("img");
    logo.src = "/pixaroma/assets/pixaroma_logo.svg";
    logo.className = "pix-lbl-title-logo";
    titleSpan.appendChild(logo);
    titleSpan.append(" Label Editor ");
    const brandSpan = el("span", "pix-lbl-title-brand");
    brandSpan.textContent = "Pixaroma";
    titleSpan.appendChild(brandSpan);
    header.appendChild(titleSpan);
    const closeBtn = el("button", "pix-lbl-close");
    closeBtn.textContent = "\u00d7";
    closeBtn.onclick = () => this.close();
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // ── Body
    const body = el("div", "pix-lbl-body");
    panel.appendChild(body);

    // ── Text
    const textField = el("div", "pix-lbl-field");
    textField.appendChild(lbl("Text"));
    const ta = document.createElement("textarea");
    ta.value = c.text;
    ta.rows = 2;
    ta.addEventListener("input", () => {
      c.text = ta.value;
      this._updatePreview();
    });
    textField.appendChild(ta);
    body.appendChild(textField);

    // ── Preview
    const prevSection = el("div");
    prevSection.appendChild(lbl("Preview"));
    const prevWrap = el("div", "pix-lbl-preview");
    this._previewCanvas = document.createElement("canvas");
    prevWrap.appendChild(this._previewCanvas);
    prevSection.appendChild(prevWrap);
    body.appendChild(prevSection);

    // ── Typography: font buttons + Bold + align in one row, size below
    const typoSection = el("div");
    typoSection.appendChild(lbl("Typography"));
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
    fontBtns.appendChild(vsep());

    // Bold
    const boldBtn = el("button", "pix-lbl-btn pix-lbl-bold");
    boldBtn.textContent = "B";
    if (c.fontWeight === "bold") boldBtn.classList.add("active");
    boldBtn.onclick = () => {
      c.fontWeight = c.fontWeight === "bold" ? "normal" : "bold";
      boldBtn.classList.toggle("active");
      this._updatePreview();
    };
    fontBtns.appendChild(boldBtn);
    fontBtns.appendChild(vsep());

    // Align
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
    fontBtns.appendChild(vsep());

    // Size inline (label + slider + val)
    const sizeRange = document.createElement("input");
    sizeRange.type = "range";
    sizeRange.min = 8;
    sizeRange.max = 64;
    sizeRange.value = c.fontSize;
    sizeRange.style.cssText = "flex:1;accent-color:" + BRAND + ";height:3px;min-width:60px;";
    const sizeVal = el("span", "pix-lbl-val");
    sizeVal.textContent = c.fontSize;
    sizeRange.addEventListener("input", () => {
      c.fontSize = Number(sizeRange.value);
      sizeVal.textContent = c.fontSize;
      this._updatePreview();
    });
    const sizeLbl = el("span");
    sizeLbl.textContent = "Size";
    sizeLbl.style.cssText = "color:#555;font-size:9px;text-transform:uppercase;letter-spacing:0.8px;white-space:nowrap;";
    fontBtns.appendChild(sizeLbl);
    fontBtns.appendChild(sizeRange);
    fontBtns.appendChild(sizeVal);

    typoSection.appendChild(fontBtns);
    body.appendChild(typoSection);

    // ── Colors (2-column grid)
    const colorSection = el("div");
    colorSection.appendChild(lbl("Colors"));
    const colorGrid = el("div", "pix-lbl-color-grid");

    // Background column
    const bgCol = el("div", "pix-lbl-color-col");
    const bgColLbl = el("div", "pix-lbl-lbl");
    bgColLbl.textContent = "Background";
    bgColLbl.style.color = "#444";
    bgCol.appendChild(bgColLbl);
    const bgSwatches = el("div", "pix-lbl-swatches");
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
    this._buildSwatches(bgSwatches, BG_SWATCHES, c.backgroundColor, (color, swEls) => {
      c.backgroundColor = color;
      bgPicker.value = color;
      bgPicker.disabled = false;
      bgHex.value = color;
      bgHex.disabled = false;
      transpSw.classList.remove("active");
      swEls.forEach((s) => s.classList.toggle("active", s.dataset.color === color));
      this._updatePreview();
    });
    bgCol.appendChild(bgSwatches);
    const bgRow = el("div", "pix-lbl-color-row");
    const bgPicker = document.createElement("input");
    bgPicker.type = "color";
    bgPicker.value = c.backgroundColor === "transparent" ? "#333333" : c.backgroundColor;
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
    bgCol.appendChild(bgRow);
    colorGrid.appendChild(bgCol);

    // Text Color column
    const tcCol = el("div", "pix-lbl-color-col");
    const tcColLbl = el("div", "pix-lbl-lbl");
    tcColLbl.textContent = "Text";
    tcColLbl.style.color = "#444";
    tcCol.appendChild(tcColLbl);
    const tcSwatches = el("div", "pix-lbl-swatches");
    this._buildSwatches(tcSwatches, TEXT_SWATCHES, c.fontColor, (color, swEls) => {
      c.fontColor = color;
      tcPicker.value = color;
      tcHex.value = color;
      swEls.forEach((s) => s.classList.toggle("active", s.dataset.color === color));
      this._updatePreview();
    });
    tcCol.appendChild(tcSwatches);
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
    tcCol.appendChild(tcRow);
    colorGrid.appendChild(tcCol);

    colorSection.appendChild(colorGrid);
    body.appendChild(colorSection);

    // ── Spacing (2x2 grid)
    const spacingSection = el("div");
    spacingSection.appendChild(lbl("Spacing & Style"));
    const spacingGrid = el("div", "pix-lbl-spacing-grid");
    const spacingFields = [
      ["Padding", c.padding, 0, 60, 1, (v) => { c.padding = v; }],
      ["Radius", c.borderRadius, 0, 40, 1, (v) => { c.borderRadius = v; }],
      ["Opacity", c.opacity, 0, 1, 0.05, (v) => { c.opacity = v; }],
      ["Line Height", c.lineHeight, 1, 3, 0.1, (v) => { c.lineHeight = v; }],
    ];
    for (const [label, val, min, max, step, onChange] of spacingFields) {
      const f = this._rangeField(label, val, min, max, step, onChange);
      f.className = "pix-lbl-spacing-field";
      spacingGrid.appendChild(f);
    }
    spacingSection.appendChild(spacingGrid);
    body.appendChild(spacingSection);

    // ── Footer
    const footer = el("div", "pix-lbl-footer");
    const helpBtn = el("button", "pix-lbl-btn-help");
    helpBtn.textContent = "? Help";
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
    cvs.width = m.w;
    cvs.height = m.h;
    cvs.style.width = "";
    cvs.style.height = "";
    const ctx = cvs.getContext("2d");
    renderLabelToCanvas(ctx, c, m, m.w, m.h);
  }
}
