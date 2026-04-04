// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Editor Framework — Component Factories             ║
// ║  Reusable UI building blocks (buttons, panels, sliders, etc) ║
// ╚═══════════════════════════════════════════════════════════════╝


// ── Button ───────────────────────────────────────────────────
export function createButton(text, opts = {}) {
  const btn = document.createElement("button");
  const variantClass = {
    standard: "pxf-btn",
    accent: "pxf-btn pxf-btn-accent",
    danger: "pxf-btn pxf-btn-danger",
    sm: "pxf-btn-sm",
    icon: "pxf-btn-icon",
    full: "pxf-btn-full",
  }[opts.variant || "standard"] || "pxf-btn";

  btn.className = variantClass;
  if (opts.iconSrc) {
    const img = document.createElement("img");
    img.src = opts.iconSrc;
    img.draggable = false;
    btn.appendChild(img);
  }
  if (text) btn.appendChild(document.createTextNode(text));
  if (opts.title) btn.title = opts.title;
  if (opts.onClick) btn.addEventListener("click", opts.onClick);
  return btn;
}

// ── Panel / Section ──────────────────────────────────────────
export function createPanel(title, opts = {}) {
  const el = document.createElement("div");
  el.className = "pxf-panel" + (opts.collapsed ? " collapsed" : "");

  const titleEl = document.createElement("div");
  titleEl.className = "pxf-panel-title" + (opts.collapsible ? " clickable" : "");

  if (opts.collapsible) {
    const arrow = document.createElement("span");
    arrow.className = "pxf-panel-title-arrow";
    arrow.textContent = "▼";
    titleEl.appendChild(arrow);
  }

  const titleText = document.createTextNode(title);
  titleEl.appendChild(titleText);
  el.appendChild(titleEl);

  const content = document.createElement("div");
  content.className = "pxf-panel-content";
  el.appendChild(content);

  if (opts.collapsible) {
    titleEl.addEventListener("click", () => {
      el.classList.toggle("collapsed");
    });
  }

  return {
    el,
    content,
    setCollapsed(b) { el.classList.toggle("collapsed", b); },
  };
}

// ── Slider Row ───────────────────────────────────────────────
export function createSliderRow(label, min, max, value, onChange, opts = {}) {
  const row = document.createElement("div");
  row.className = "pxf-slider-row";

  const lbl = document.createElement("label");
  lbl.className = "pxf-slider-label";
  lbl.textContent = label;
  if (opts.labelWidth) lbl.style.width = opts.labelWidth;
  row.appendChild(lbl);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = min; slider.max = max; slider.value = value;
  if (opts.step) slider.step = opts.step;

  const numInput = document.createElement("input");
  numInput.type = "number";
  numInput.min = min; numInput.max = max; numInput.value = value;
  if (opts.step) numInput.step = opts.step;

  function _syncFill() {
    const mn = parseFloat(slider.min) || 0, mx = parseFloat(slider.max) || 100;
    const v = parseFloat(slider.value) || 0;
    slider.style.setProperty("--pxf-fill", ((v - mn) / (mx - mn)) * 100 + "%");
  }
  _syncFill();

  slider.addEventListener("input", () => {
    numInput.value = slider.value;
    _syncFill();
    if (onChange) onChange(parseFloat(slider.value));
  });
  numInput.addEventListener("input", () => {
    slider.value = numInput.value;
    _syncFill();
    if (onChange) onChange(parseFloat(numInput.value));
  });

  row.appendChild(slider);
  row.appendChild(numInput);

  return {
    el: row,
    slider,
    numInput,
    setValue(n) {
      slider.value = n;
      numInput.value = n;
      _syncFill();
    },
    setRange(newMin, newMax) {
      slider.min = newMin; slider.max = newMax;
      numInput.min = newMin; numInput.max = newMax;
      _syncFill();
    },
  };
}

// ── Number Input ─────────────────────────────────────────────
export function createNumberInput(opts = {}) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "pxf-input-num";
  if (opts.value != null) input.value = opts.value;
  if (opts.min != null) input.min = opts.min;
  if (opts.max != null) input.max = opts.max;
  if (opts.step != null) input.step = opts.step;
  if (opts.width) input.style.width = opts.width;
  if (opts.onChange) input.addEventListener("input", () => opts.onChange(parseFloat(input.value)));
  return input;
}

// ── Select Input ─────────────────────────────────────────────
export function createSelectInput(opts = {}) {
  const select = document.createElement("select");
  select.className = "pxf-select";
  (opts.options || []).forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  });
  if (opts.value) select.value = opts.value;
  if (opts.onChange) select.addEventListener("change", () => opts.onChange(select.value));
  return select;
}

// ── Color Input ──────────────────────────────────────────────
export function createColorInput(opts = {}) {
  const input = document.createElement("input");
  input.type = "color";
  input.className = "pxf-color-input";
  input.value = opts.value || "#ffffff";
  if (opts.onChange) input.addEventListener("input", () => opts.onChange(input.value));
  return input;
}

// ── Row (label + content) ────────────────────────────────────
export function createRow(label, content, opts = {}) {
  const row = document.createElement("div");
  row.className = "pxf-row";

  const lbl = document.createElement("span");
  lbl.className = "pxf-row-label";
  lbl.textContent = label;
  lbl.style.width = opts.labelWidth || "56px";
  row.appendChild(lbl);

  if (Array.isArray(content)) {
    content.forEach((c) => row.appendChild(c));
  } else {
    row.appendChild(content);
  }
  return row;
}

// ── Button Row ───────────────────────────────────────────────
export function createButtonRow(buttons) {
  const row = document.createElement("div");
  row.className = "pxf-btn-row";
  buttons.forEach((b) => row.appendChild(b));
  return row;
}

// ── Pill Grid ────────────────────────────────────────────────
export function createPillGrid(options, columns, onChange, opts = {}) {
  const grid = document.createElement("div");
  grid.className = "pxf-pill-grid";
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

  const pills = [];
  let activeValue = opts.activeValue;

  options.forEach((opt) => {
    const pill = document.createElement("button");
    pill.className = "pxf-pill" + (opt.value === activeValue ? " active" : "");
    pill.textContent = opt.label;
    pill.addEventListener("click", () => {
      activeValue = opt.value;
      pills.forEach((p, i) => p.classList.toggle("active", options[i].value === activeValue));
      if (onChange) onChange(activeValue);
    });
    grid.appendChild(pill);
    pills.push(pill);
  });

  return {
    el: grid,
    pills,
    setActive(value) {
      activeValue = value;
      pills.forEach((p, i) => p.classList.toggle("active", options[i].value === activeValue));
    },
  };
}

// ── Tool Button ──────────────────────────────────────────────
export function createToolButton(icon, label, onClick, opts = {}) {
  const btn = document.createElement("button");
  btn.className = "pxf-tool-btn" + (opts.active ? " active" : "");
  if (opts.title) btn.title = opts.title;

  const iconEl = document.createElement("span");
  iconEl.className = "pxf-tool-btn-icon";
  iconEl.textContent = icon;

  const labelEl = document.createElement("span");
  labelEl.className = "pxf-tool-btn-label";
  labelEl.textContent = label;

  btn.append(iconEl, labelEl);
  btn.addEventListener("click", onClick);

  return {
    el: btn,
    setActive(b) { btn.classList.toggle("active", b); },
  };
}

// ── Tool Grid ────────────────────────────────────────────────
export function createToolGrid(columns, tools) {
  const grid = document.createElement("div");
  grid.className = "pxf-tool-grid";
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

  const buttons = {};
  tools.forEach((tool) => {
    const tb = createToolButton(tool.icon, tool.label, tool.onClick, { title: tool.title });
    buttons[tool.id] = tb;
    grid.appendChild(tb.el);
  });

  return {
    el: grid,
    setActive(id) {
      Object.entries(buttons).forEach(([key, tb]) => tb.setActive(key === id));
    },
  };
}

// ── Checkbox ─────────────────────────────────────────────────
export function createCheckbox(label, checked, onChange) {
  const row = document.createElement("label");
  row.className = "pxf-check-row";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  row.appendChild(cb);
  row.append(label);
  return { el: row, checkbox: cb };
}

// ── Divider ──────────────────────────────────────────────────
export function createDivider() {
  const div = document.createElement("div");
  div.className = "pxf-divider";
  return div;
}

// ── Info block ───────────────────────────────────────────────
export function createInfo(html = "") {
  const el = document.createElement("div");
  el.className = "pxf-info";
  el.innerHTML = html;
  return {
    el,
    setHTML(s) { el.innerHTML = s; },
  };
}

// ── Zoom Controls ────────────────────────────────────────────
export function createZoomControls(onZoomIn, onZoomOut, onFit) {
  const bar = document.createElement("div");
  bar.className = "pxf-zoom-bar";

  const label = document.createElement("span");
  label.className = "pxf-zoom-label";
  label.textContent = "100%";

  bar.appendChild(createButton("\u2212", { variant: "sm", title: "Zoom out", onClick: onZoomOut }));
  bar.appendChild(createButton("Fit", { variant: "sm", title: "Fit to view", onClick: onFit }));
  bar.appendChild(label);
  bar.appendChild(createButton("+", { variant: "sm", title: "Zoom in", onClick: onZoomIn }));

  return {
    el: bar,
    setZoomLabel(text) { label.textContent = text; },
  };
}

// ── Transform Panel ──────────────────────────────────────────
export function createTransformPanel(config) {
  const _ui = "/pixaroma/assets/icons/ui/";
  const panel = createPanel("Transform Properties", { collapsible: true, collapsed: true });

  const fitW   = createButton("Fit W",  { variant: "sm", iconSrc: _ui + "fit-width.svg",       onClick: config.onFitWidth,   title: "Fit to canvas width" });
  const fitH   = createButton("Fit H",  { variant: "sm", iconSrc: _ui + "fit-height.svg",      onClick: config.onFitHeight,  title: "Fit to canvas height" });
  const flipH  = createButton("Flip H", { variant: "sm", iconSrc: _ui + "flip-horizontal.svg", onClick: config.onFlipH,      title: "Flip horizontally" });
  const flipV  = createButton("Flip V", { variant: "sm", iconSrc: _ui + "flip-vertical.svg",   onClick: config.onFlipV,      title: "Flip vertically" });
  const rotCCW = createButton("-90°",   { variant: "sm", iconSrc: _ui + "rotate-ccw.svg",      onClick: config.onRotateCCW,  title: "Rotate -90°" });
  const rotCW  = createButton("+90°",   { variant: "sm", iconSrc: _ui + "rotate-cw.svg",       onClick: config.onRotateCW,   title: "Rotate +90°" });

  [fitW, fitH, flipH, flipV, rotCCW, rotCW].forEach(b => b.style.flex = "1");

  const row1 = createButtonRow([fitW, fitH, flipH]);
  const row2 = createButtonRow([flipV, rotCCW, rotCW]); row2.style.marginTop = "4px";
  panel.content.appendChild(row1);
  panel.content.appendChild(row2);

  let resetBtn = null;
  if (config.onReset) {
    resetBtn = createButton("Reset Transform", {
      variant: "full",
      onClick: config.onReset,
      title: "Reset all transforms to default",
    });
    resetBtn.classList.add("pxf-btn-danger");
    resetBtn.insertBefore(_dangerIcon("M5.1,36.2h8c-.1,8,5.1,15,12.2,17.7,7.8,2.9,16.4.6,21.5-5.8,3.3-4.1,4.6-9.2,4-14.4-1-8.6-7.8-15.3-16.4-16.4v6.5c0,.6-.6,1.3-1.1,1.4-.5.2-1.5.2-1.9-.2l-12-10.2c-.6-.5-.8-1.1-.8-1.9,0-.7.4-1.3,1-1.8l11.6-9.9c.6-.5,1.4-.6,2.1-.3.5.2,1,.9,1,1.6v6.4c4.6.5,9,1.9,12.8,4.5,6.5,4.5,10.6,11.2,11.6,19,.3,2.7.4,5,0,7.6-.9,6.2-3.9,12-8.4,16.2-12.2,11.1-30.9,8.9-40.4-4.6-3.1-4.4-4.8-9.7-4.8-15.5ZM38.7,41.7v-9.2c0-1.1-.7-1.9-1.7-2.2h-10.1c-1,.2-1.7,1.1-1.7,2.1v9.3c0,1.2.9,2.1,2.1,2.1h9.1c1.2,0,2.3-1,2.3-2.2Z"), resetBtn.firstChild);
    resetBtn.style.marginTop = "6px";
    panel.content.appendChild(resetBtn);
  }

  const sliderWrap = document.createElement("div");
  sliderWrap.style.marginTop = "8px";
  const sliders = {};

  if (config.showRotateSlider !== false) {
    const s = createSliderRow("Rotate", 0, 360, 0, config.onRotateChange, { step: 1 });
    sliderWrap.appendChild(s.el);
    sliders.rotateSlider = s.slider; sliders.rotateNum = s.numInput;
    sliders.setRotate = (v) => s.setValue(v);
  }
  if (config.showScaleSlider !== false) {
    const s = createSliderRow("Scale %", 5, 300, 100, config.onScaleChange, { step: 1 });
    sliderWrap.appendChild(s.el);
    sliders.scaleSlider = s.slider; sliders.scaleNum = s.numInput;
    sliders.setScale = (v) => s.setValue(v);
  }
  if (config.showStretchSliders !== false) {
    const sh = createSliderRow("Horiz %", 5, 300, 100, config.onStretchHChange, { step: 1 });
    const sv = createSliderRow("Vert %", 5, 300, 100, config.onStretchVChange, { step: 1 });
    sliderWrap.append(sh.el, sv.el);
    sliders.stretchHSlider = sh.slider; sliders.stretchHNum = sh.numInput;
    sliders.stretchVSlider = sv.slider; sliders.stretchVNum = sv.numInput;
    sliders.setStretchH = (v) => sh.setValue(v);
    sliders.setStretchV = (v) => sv.setValue(v);
  }
  if (config.showOpacitySlider !== false) {
    const s = createSliderRow("Opacity", 0, 100, 100, config.onOpacityChange, { step: 1 });
    sliderWrap.appendChild(s.el);
    sliders.opacitySlider = s.slider; sliders.opacityNum = s.numInput;
    sliders.setOpacity = (v) => s.setValue(v);
  }
  if (sliderWrap.children.length > 0) panel.content.appendChild(sliderWrap);

  return {
    el: panel.el,
    content: panel.content,
    fitW, fitH, flipH, flipV, rotCCW, rotCW, resetBtn,
    ...sliders,
  };
}

// ── Danger Icon (inline SVG) ─────────────────────────────────
function _dangerIcon(pathD) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.style.cssText = "width:14px;height:14px;flex-shrink:0;transition:fill .15s;";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "#999");
  svg.appendChild(path);
  requestAnimationFrame(() => {
    const btn = svg.closest("button");
    if (btn) {
      btn.addEventListener("mouseenter", () => path.setAttribute("fill", "#ffffff"));
      btn.addEventListener("mouseleave", () => path.setAttribute("fill", "#999"));
    }
  });
  return svg;
}

// Export _dangerIcon for canvas.js
export { _dangerIcon };
