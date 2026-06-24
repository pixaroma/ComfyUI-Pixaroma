import { app } from "/scripts/app.js";
import { createPixaromaColorPicker, PIXAROMA_PALETTE } from "../shared/color_picker.mjs";
import { openHelpPopup, closeHelpPopup } from "../shared/help.mjs";
import {
  DEFAULTS,
  FONT_CHOICES,
  FONT_SHORT,
  measureLabel,
  renderLabelToCanvas,
  injectCSS,
} from "./render.mjs";

// Shared-style help (same themed popup as the Group help). Registered for the
// selection-toolbar ? button (index.js) AND opened by the in-editor ? button.
export const LABEL_HELP = {
  title: "Label Pixaroma",
  tagline: "A floating text caption for documenting your workflow. Double-click a label on the canvas to open this editor.",
  sections: [
    { heading: "Text", body: "Type any text - multiple lines and emoji are supported." },
    { heading: "Typography", defs: [
      ["Font", "Switch between Arial, Times, Courier and Impact."],
      ["B", "Toggle bold on or off."],
      ["Align", "Left, center or right alignment for multi-line text."],
      ["Font Size", "Drag the slider, type a value, or use the arrows (8 to 256 px)."],
    ] },
    { heading: "Colors", body: "Click the `Background` or `Text` bar to choose which one you are changing - each bar shows its current color code. Then pick a swatch on the right, drag in the color square on the left, or type a hex code straight into the bar. The `Transparent` button makes the background see-through (Background only)." },
    { heading: "Spacing & Style", defs: [
      ["Padding", "Space between the text and the label edge."],
      ["Radius", "Corner roundness of the background."],
      ["Opacity", "Overall transparency of the label."],
      ["Line Height", "Spacing between lines of text."],
    ] },
    { heading: "Add to canvas", body: "Right-click the canvas and pick `Add Label Pixaroma` to drop a new label, then double-click it to edit." },
  ],
  footer: "Pixaroma - youtube.com/@pixaroma",
};

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
  // Resize the node to fit the edited content. This is an explicit user edit,
  // so a size change is legitimate (the node no longer re-measures on load -
  // see setupLabel in index.js - so this is the place that keeps the box
  // fitted to the text).
  const m = measureLabel(cfg);
  const nw = Math.max(m.w, 60), nh = Math.max(m.h, 30);
  // setSize goes through the official resize path so the new size sticks in
  // Nodes 2.0 too (a bare node.size[] write can be reverted there); falls back
  // to a direct write on older builds without setSize.
  if (typeof node.setSize === "function") node.setSize([nw, nh]);
  else if (node.size) { node.size[0] = nw; node.size[1] = nh; }
  node._pixLblRender?.(); // Nodes 2.0: refresh the crisp-HTML label (no-op in legacy)
  node._pixLblFit?.();    // Nodes 2.0: snap node width to the real text (no-op in legacy)
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
    this._updatePreview();
    // Block ComfyUI's canvas shortcuts while the editor is open, but LET keys
    // through when a form control is focused so typing + Enter / Arrow in the
    // editor's inputs (slider number fields, hex, textarea) work normally. Esc
    // closes the help overlay if open, otherwise the editor.
    // NB: we deliberately do NOT call installFocusTrap - its mouseup-refocus steals
    // focus on every button / swatch / canvas click, which breaks typing in this
    // form-heavy editor (Vue Frontend Compatibility #7). The capture handlers below
    // are enough to isolate ComfyUI's canvas shortcuts.
    this._keyBlock = (e) => {
      if (e.type === "keydown" && e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (document.querySelector(".pix-help-backdrop")) closeHelpPopup();
        else this.close();
        return;
      }
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
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
    closeHelpPopup();
    this._picker?.destroy?.();
    this._picker = null;
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
    closeBtn.textContent = "×";
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

    // ── Preview (fit-to-area, DPR-sharp, never clipped — see _renderPreview)
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

    typoSection.appendChild(fontBtns);

    // Font size — full-width slider + number + spinner
    const fsField = this._sliderRow("Font Size", 8, 256, 1,
      () => c.fontSize, (n) => { c.fontSize = n; },
      (n) => String(Math.round(n)), (x) => x);
    fsField.style.marginTop = "8px";
    typoSection.appendChild(fsField);
    body.appendChild(typoSection);

    // ── Colors: two Group-style bars (chip + label + editable hex) that double
    //    as the target selector, plus the shared SV/hue/hex picker (left) and our
    //    own swatch grid (right). The bars match the Group "Title #hex / Body #hex"
    //    look so it's obvious WHICH colour you're changing. Transparent is a
    //    Background-only option shown as a labelled button below the grid, so the
    //    swatch grid always fills complete rows for BOTH targets (no empty cells).
    const colorSection = el("div");
    colorSection.appendChild(lbl("Colors"));

    let target = "bg";
    const curColorFor = (k) => (k === "bg" ? c.backgroundColor : c.fontColor);
    const isTransp = () => c.backgroundColor === "transparent";

    // Two color buttons (Background / Text) — chip + label. They select which
    // target the picker + swatches edit; the live hex shows under the picker
    // (the picker's own hex field), which follows the selected button.
    const bars = el("div", "pix-lbl-cbars");
    const mkBar = (key, text) => {
      const bar = el("button", "pix-lbl-cbar");
      bar.type = "button";
      const chip = el("span", "pix-lbl-cbar-chip");
      const k = el("span", "pix-lbl-cbar-k");
      k.textContent = text;
      bar.appendChild(chip);
      bar.appendChild(k);
      bar._key = key; bar._chip = chip;
      bars.appendChild(bar);
      return bar;
    };
    const bgBar = mkBar("bg", "Background");
    const txBar = mkBar("text", "Text");
    const allBars = [bgBar, txBar];
    colorSection.appendChild(bars);

    // Swatch grid (right column): the 36 shared palette colours in a perfect
    // 9x4 grid (no transparent tile — it lives below as a labelled button so the
    // grid never has empty cells, for either target).
    const swGrid = el("div", "pix-lbl-swgrid");
    const swTiles = [];
    for (const hex of PIXAROMA_PALETTE) {
      const t = el("button", "pix-lbl-swtile");
      t.style.background = hex;
      t.title = hex;
      swGrid.appendChild(t);
      swTiles.push({ el: t, hex });
    }

    // Transparent — Background only, below the grid (a labelled control, never an
    // empty grid cell).
    const transBtn = el("button", "pix-lbl-transbtn");
    const transSw = el("span", "pix-lbl-transbtn-sw");
    transBtn.appendChild(transSw);
    transBtn.append("Transparent");
    transBtn.title = "Transparent background";

    const syncBars = () => {
      for (const bar of allBars) {
        const cur = curColorFor(bar._key);
        const tr = bar._key === "bg" && cur === "transparent";
        bar._chip.classList.toggle("is-transp", tr);
        bar._chip.style.background = tr ? "" : cur;
        bar.classList.toggle("active", target === bar._key);
      }
    };
    const syncSwSel = () => {
      const cur = curColorFor(target);
      for (const { el: t, hex } of swTiles) {
        t.classList.toggle("active", !!(cur && hex.toLowerCase() === String(cur).toLowerCase()));
      }
      transBtn.classList.toggle("active", target === "bg" && isTransp());
    };
    const syncTransVis = () => { transBtn.style.display = target === "bg" ? "" : "none"; };

    const picker = createPixaromaColorPicker({
      initialColor: isTransp() ? "#333333" : c.backgroundColor,
      swatches: [],
      showClear: false,
      hideReset: true,   // our swatch grid already provides defaults; avoids a
                         // Reset that would set Text to the background gray
      resetColor: "#333333",
      onChange: (color) => {
        if (!color) return;
        if (target === "bg") c.backgroundColor = color;
        else c.fontColor = color;
        syncBars(); syncSwSel(); this._updatePreview();
      },
    });
    this._picker = picker;
    // Layout: SV picker (left) | swatch grid + Transparent (right), full width.
    const colorRow = el("div", "pix-lbl-colorrow");
    const pickerCol = el("div", "pix-lbl-pickercol");
    pickerCol.appendChild(picker.element);
    const swatchCol = el("div", "pix-lbl-swatchcol");
    swatchCol.appendChild(swGrid);
    swatchCol.appendChild(transBtn);
    colorRow.appendChild(pickerCol);
    colorRow.appendChild(swatchCol);
    colorSection.appendChild(colorRow);

    const selectTarget = (k) => {
      target = k;
      const cur = curColorFor(k);
      picker.setColor(k === "bg" && cur === "transparent" ? "#333333" : cur);
      syncBars(); syncSwSel(); syncTransVis();
    };

    // Bar interactions: click a button to choose which target the picker +
    // swatches edit (the live hex shows + edits under the picker).
    for (const bar of allBars) {
      bar.addEventListener("click", () => selectTarget(bar._key));
    }

    for (const { el: t, hex } of swTiles) {
      t.onclick = () => {
        if (target === "bg") c.backgroundColor = hex;
        else c.fontColor = hex;
        picker.setColor(hex);          // move the SV marker to the picked swatch
        syncBars(); syncSwSel(); this._updatePreview();
      };
    }
    transBtn.onclick = () => {
      if (target !== "bg") return;     // transparent is Background-only
      c.backgroundColor = "transparent";
      syncBars(); syncSwSel(); this._updatePreview();
    };

    syncBars(); syncSwSel(); syncTransVis();
    body.appendChild(colorSection);

    // ── Spacing & Style — 2x2 grid of slider + number + spinner
    const spacingSection = el("div");
    spacingSection.appendChild(lbl("Spacing & Style"));
    const spacingGrid = el("div", "pix-lbl-spacing-grid");
    spacingGrid.appendChild(this._sliderRow("Padding", 0, 60, 1,
      () => c.padding, (n) => { c.padding = n; }, (n) => String(Math.round(n)), (x) => x));
    spacingGrid.appendChild(this._sliderRow("Radius", 0, 40, 1,
      () => c.borderRadius, (n) => { c.borderRadius = n; }, (n) => String(Math.round(n)), (x) => x));
    spacingGrid.appendChild(this._sliderRow("Opacity", 0, 1, 0.05,
      () => c.opacity, (n) => { c.opacity = n; }, (n) => Number(n).toFixed(2), (x) => x));
    spacingGrid.appendChild(this._sliderRow("Line Height", 1, 3, 0.1,
      () => c.lineHeight, (n) => { c.lineHeight = n; }, (n) => Number(n).toFixed(1), (x) => x));
    spacingSection.appendChild(spacingGrid);
    body.appendChild(spacingSection);

    // ── Footer
    const footer = el("div", "pix-lbl-footer");
    const helpBtn = el("button", "pix-lbl-help-btn");
    helpBtn.textContent = "?";
    helpBtn.title = "Help";
    helpBtn.onclick = () => this._showHelp();
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

  // ── Slider + editable number + ▲▼ spinner (matches the Group Colors style) ──
  _sliderRow(labelText, min, max, step, get, set, fmt, parse) {
    const row = document.createElement("div");
    row.className = "pix-lbl-sliderrow";

    const l = document.createElement("span");
    l.className = "pix-lbl-slbl";       // inline label (left of the slider)
    l.textContent = labelText;
    row.appendChild(l);

    const s = document.createElement("input");
    s.type = "range";
    s.min = String(min); s.max = String(max); s.step = String(step);
    s.value = String(get());
    s.className = "pix-lbl-slider";
    const setFill = () => {
      const pct = max === min ? 0 : ((Number(s.value) - min) / (max - min)) * 100;
      s.style.setProperty("--fill", Math.max(0, Math.min(100, pct)) + "%");
    };
    setFill();

    const vWrap = document.createElement("div");
    vWrap.className = "pix-lbl-spin";
    const v = document.createElement("input");
    v.type = "text";
    v.value = fmt(get());
    v.className = "pix-lbl-spinval";
    const spin = document.createElement("div");
    spin.className = "pix-lbl-spinbtns";
    const up = document.createElement("button"); up.type = "button"; up.textContent = "▲"; up.title = "Increase";
    const dn = document.createElement("button"); dn.type = "button"; dn.textContent = "▼"; dn.title = "Decrease";
    spin.appendChild(up); spin.appendChild(dn);
    vWrap.appendChild(v); vWrap.appendChild(spin);

    s.addEventListener("input", () => {
      const n = Number(s.value);
      set(n); v.value = fmt(n); setFill(); this._updatePreview();
    });
    const apply = (n) => {
      n = Math.max(min, Math.min(max, Math.round(n / step) * step));
      // floating-point tidy so 0.65000000001 doesn't leak into the field
      n = Number(n.toFixed(4));
      set(n); s.value = String(n); v.value = fmt(n); setFill(); this._updatePreview();
    };
    const stepBy = (dir) => apply(get() + dir * step);
    const commitV = () => {
      const raw = parseFloat(v.value);
      if (Number.isFinite(raw)) apply(parse ? parse(raw) : raw);
      else v.value = fmt(get());
    };
    for (const b of [up, dn]) {
      b.addEventListener("mousedown", (e) => e.stopPropagation());
    }
    up.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); stepBy(1); });
    dn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); stepBy(-1); });
    v.addEventListener("mousedown", (e) => e.stopPropagation());
    v.addEventListener("focus", () => v.select());
    v.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commitV(); v.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); v.value = fmt(get()); v.blur(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); stepBy(1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); stepBy(-1); }
    });
    v.addEventListener("blur", commitV);

    row.appendChild(s);
    row.appendChild(vWrap);
    return row;
  }

  // ── Help (shared themed popup, same style as the Group help) ──
  _showHelp() {
    openHelpPopup(LABEL_HELP);
    // The editor overlay is z-index 99999; lift the help card above it.
    const bd = document.querySelector(".pix-help-backdrop");
    if (bd) bd.style.zIndex = "100000";
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

  // Render the label into the preview area FITTED to the available space and at
  // device-pixel resolution, so it is always sharp and never clipped regardless
  // of font size / padding / radius. The label is re-rendered at the displayed
  // size (ctx scaled), not CSS-stretched, so upscaling a small label stays crisp.
  _renderPreview() {
    const c = this.cfg;
    const m = measureLabel(c);
    const cvs = this._previewCanvas;
    const wrap = cvs.parentElement;
    if (!wrap) return;
    const availW = Math.max(20, (wrap.clientWidth || 460) - 24);
    const availH = Math.max(20, (wrap.clientHeight || 180) - 24);
    // Render close to the node's actual size, a touch larger for legibility, and
    // downscale big labels to fit. Capped at 1.5x so the preview reads a bit bigger
    // than the canvas without the blown-up look.
    let scale = Math.min(availW / m.w, availH / m.h, 1.5);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    const dpr = window.devicePixelRatio || 1;
    const dispW = Math.max(1, Math.round(m.w * scale));
    const dispH = Math.max(1, Math.round(m.h * scale));
    cvs.width = Math.round(dispW * dpr);
    cvs.height = Math.round(dispH * dpr);
    cvs.style.width = dispW + "px";
    cvs.style.height = dispH + "px";
    const ctx = cvs.getContext("2d");
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    renderLabelToCanvas(ctx, c, m, m.w, m.h);
  }
}
