// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Editor Framework — Canvas Components               ║
// ║  Canvas settings, frame overlay, and toolbar                 ║
// ╚═══════════════════════════════════════════════════════════════╝

import { createButton, createPanel, _dangerIcon } from "./components.mjs";
import { UI_ICON } from "./theme.mjs";

// ── Canvas Settings (document size/ratio) ────────────────────

const CANVAS_RATIOS = [
  { label: "Free",  w: 0,  h: 0  },
  { label: "1:1",   w: 1,  h: 1  },
  { label: "4:3",   w: 4,  h: 3  },
  { label: "3:2",   w: 3,  h: 2  },
  { label: "16:9",  w: 16, h: 9  },
  { label: "4:5",   w: 4,  h: 5  },
  { label: "3:4",   w: 3,  h: 4  },
  { label: "2:3",   w: 2,  h: 3  },
  { label: "9:16",  w: 9,  h: 16 },
  { label: "5:4",   w: 5,  h: 4  },
];

export function createCanvasSettings(config) {
  const {
    width: initW = 1024,
    height: initH = 1024,
    ratioIndex: initRatio = 0,
    minSize = 64,
    maxSize = 8192,
    startCollapsed = true,
    onChange,
  } = config;

  let curW = initW, curH = initH, curRatio = initRatio;

  const panel = createPanel("Canvas Settings", { collapsible: true, collapsed: startCollapsed });
  const wrapper = document.createElement("div");
  wrapper.className = "pxf-canvas-settings";

  // ── Ratio buttons ──
  const ratioGrid = document.createElement("div");
  ratioGrid.className = "pxf-ratio-grid";
  const ratioBtns = [];

  CANVAS_RATIOS.forEach((r, i) => {
    const btn = document.createElement("button");
    btn.className = "pxf-ratio-btn" + (i === curRatio ? " active" : "");
    btn.textContent = r.label;
    btn.addEventListener("click", () => _setRatio(i));
    ratioGrid.appendChild(btn);
    ratioBtns.push(btn);
  });
  wrapper.appendChild(ratioGrid);

  // ── Width x Height row ──
  const sizeRow = document.createElement("div");
  sizeRow.className = "pxf-size-row";

  const wLabel = document.createElement("span");
  wLabel.className = "pxf-size-label";
  wLabel.textContent = "W";

  const wInput = document.createElement("input");
  wInput.type = "number";
  wInput.className = "pxf-size-input";
  wInput.value = curW;
  wInput.min = minSize;
  wInput.max = maxSize;

  const xSign = document.createElement("span");
  xSign.className = "pxf-size-x";
  xSign.textContent = "\u00d7";

  const hLabel = document.createElement("span");
  hLabel.className = "pxf-size-label";
  hLabel.textContent = "H";

  const hInput = document.createElement("input");
  hInput.type = "number";
  hInput.className = "pxf-size-input";
  hInput.value = curH;
  hInput.min = minSize;
  hInput.max = maxSize;

  const swapBtn = createButton("", {
    variant: "icon",
    iconSrc: UI_ICON + "swap.svg",
    onClick: () => _swap(),
    title: "Swap width and height",
  });
  sizeRow.append(wLabel, wInput, xSign, hLabel, hInput, swapBtn);
  wrapper.appendChild(sizeRow);

  panel.content.appendChild(wrapper);

  // ── Internal logic ──

  function _clamp(v) {
    return Math.max(minSize, Math.min(maxSize, Math.round(v) || minSize));
  }

  function _getActiveRatio() {
    const r = CANVAS_RATIOS[curRatio];
    if (!r || r.w === 0) return 0;
    return r.w / r.h;
  }

  function _updateBtns() {
    ratioBtns.forEach((b, i) => b.classList.toggle("active", i === curRatio));
  }

  function _fire() {
    wInput.value = curW;
    hInput.value = curH;
    _updateBtns();
    if (onChange) onChange({ width: curW, height: curH, ratioIndex: curRatio });
  }

  function _setRatio(idx) {
    curRatio = idx;
    const ratio = _getActiveRatio();
    if (ratio > 0) {
      curH = _clamp(curW / ratio);
      if (Math.abs(curH / curW - 1 / ratio) > 0.01) {
        curW = _clamp(curH * ratio);
      }
    }
    _fire();
  }

  function _swap() {
    const tmp = curW;
    curW = curH;
    curH = tmp;
    const r = CANVAS_RATIOS[curRatio];
    if (r && r.w > 0) {
      const invIdx = CANVAS_RATIOS.findIndex(p => p.w === r.h && p.h === r.w);
      if (invIdx >= 0) curRatio = invIdx;
    }
    _fire();
  }

  wInput.addEventListener("change", () => {
    curW = _clamp(parseInt(wInput.value));
    const ratio = _getActiveRatio();
    if (ratio > 0) {
      curH = _clamp(curW / ratio);
    }
    _fire();
  });

  hInput.addEventListener("change", () => {
    curH = _clamp(parseInt(hInput.value));
    const ratio = _getActiveRatio();
    if (ratio > 0) {
      curW = _clamp(curH * ratio);
    }
    _fire();
  });

  return {
    el: panel.el,
    getWidth() { return curW; },
    getHeight() { return curH; },
    getRatioIndex() { return curRatio; },
    setSize(w, h) {
      curW = _clamp(w);
      curH = _clamp(h);
      wInput.value = curW;
      hInput.value = curH;
    },
    setRatio(index) { _setRatio(index); },
    swap() { _swap(); },
  };
}


// ── Canvas Frame ─────────────────────────────────────────────

export function createCanvasFrame(workspace) {
  const masks = [];
  for (let i = 0; i < 4; i++) {
    const m = document.createElement("div");
    m.className = "pxf-canvas-mask";
    workspace.appendChild(m);
    masks.push(m);
  }

  const frame = document.createElement("div");
  frame.className = "pxf-canvas-frame";
  workspace.appendChild(frame);

  const label = document.createElement("div");
  label.className = "pxf-canvas-frame-label";
  frame.appendChild(label);

  let lastRect = { left: 0, top: 0, width: 0, height: 0, scale: 1 };

  let lastDocW = 0, lastDocH = 0;
  const ro = new ResizeObserver(() => {
    if (lastDocW > 0 && lastDocH > 0) update(lastDocW, lastDocH);
  });
  ro.observe(workspace);

  function update(docW, docH) {
    lastDocW = docW;
    lastDocH = docH;
    const vpW = workspace.clientWidth, vpH = workspace.clientHeight;
    if (!vpW || !vpH || !docW || !docH) return;

    const pad = 40;
    const availW = vpW - pad * 2, availH = vpH - pad * 2;
    const s = Math.min(availW / docW, availH / docH, 1);
    const fw = docW * s, fh = docH * s;
    const fl = (vpW - fw) / 2, ft = (vpH - fh) / 2;

    lastRect = { left: fl, top: ft, width: fw, height: fh, scale: s };

    Object.assign(frame.style, {
      left: fl + "px", top: ft + "px",
      width: fw + "px", height: fh + "px",
    });
    label.textContent = `${docW}\u00d7${docH}`;

    const [mT, mB, mL, mR] = masks;
    Object.assign(mT.style, { left: "0", top: "0", width: vpW + "px", height: ft + "px" });
    Object.assign(mB.style, { left: "0", top: (ft + fh) + "px", width: vpW + "px", height: (vpH - ft - fh) + "px" });
    Object.assign(mL.style, { left: "0", top: ft + "px", width: fl + "px", height: fh + "px" });
    Object.assign(mR.style, { left: (fl + fw) + "px", top: ft + "px", width: (vpW - fl - fw) + "px", height: fh + "px" });
  }

  function remove() {
    ro.disconnect();
    frame.remove();
    masks.forEach(m => m.remove());
  }

  function setVisible(v) {
    const d = v ? "" : "none";
    frame.style.display = d;
    masks.forEach(m => m.style.display = d);
  }

  return {
    update,
    getRect() { return lastRect; },
    setVisible,
    remove,
  };
}


// ── Canvas Toolbar ───────────────────────────────────────────

function _makeIconButton(iconSrc, label, onClick, title = "") {
  const btn = document.createElement("button");
  btn.className = "pxf-btn-full";
  btn.title = title || label;
  btn.style.cssText = "display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;padding:6px 8px;";
  const img = document.createElement("img");
  img.src = iconSrc;
  img.style.cssText = "width:14px;height:14px;filter:brightness(0) invert(0.7);";
  btn.appendChild(img);
  btn.appendChild(document.createTextNode(label));
  btn.addEventListener("click", onClick);
  btn.addEventListener("mouseenter", () => { img.style.filter = "brightness(0) invert(1)"; });
  btn.addEventListener("mouseleave", () => { img.style.filter = "brightness(0) invert(0.7)"; });
  return btn;
}

export function createCanvasToolbar(config) {
  const {
    onAddImage,
    onBgColorChange,
    onClear,
    onReset,
    bgColor = "#ffffff",
    showBgColor = true,
    showClear = true,
    showReset = true,
    addImageLabel = "Add Image",
    clearLabel = "Clear Canvas",
    resetLabel = "Reset to Default",
  } = config;

  const wrapper = document.createElement("div");
  wrapper.className = "pxf-canvas-toolbar";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file && onAddImage) onAddImage(file);
    fileInput.value = "";
  });
  wrapper.appendChild(fileInput);

  const addBtn = createButton(addImageLabel, {
    variant: "full",
    iconSrc: UI_ICON + "upload.svg",
    onClick: () => fileInput.click(),
    title: "Browse for an image file",
  });

  let colorInput = null;
  let _bgColor = bgColor;
  if (showBgColor) {
    const addRow = document.createElement("div");
    addRow.className = "pxf-canvas-toolbar-row";
    addBtn.style.flex = "1";
    const label = document.createElement("span");
    label.style.cssText = "font-size:10px;color:#888;flex-shrink:0;";
    label.textContent = "BG:";
    colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = bgColor;
    colorInput.className = "pxf-color-input";
    colorInput.style.cssText = "width:36px;height:28px;flex-shrink:0;";
    colorInput.addEventListener("input", () => {
      _bgColor = colorInput.value;
      if (onBgColorChange) onBgColorChange(colorInput.value);
    });
    addRow.append(addBtn, label, colorInput);
    wrapper.appendChild(addRow);
  } else {
    wrapper.appendChild(addBtn);
  }

  if ((showClear && onClear) || (showReset && onReset)) {
    const dangerRow = document.createElement("div");
    dangerRow.className = "pxf-canvas-toolbar-row";
    dangerRow.style.cssText = "gap:4px;";

    if (showClear && onClear) {
      const clearBtn = createButton(clearLabel, {
        variant: "full",
        onClick: onClear,
        title: "Clear all content",
      });
      clearBtn.classList.add("pxf-btn-danger");
      clearBtn.style.flex = "1";
      clearBtn.insertBefore(_dangerIcon("M11.4,21.4h41.2l-5.1,38.2c-.3,1.9-1.9,3.3-3.9,3.3h-23.2c-1.9,0-3.6-1.4-3.9-3.3l-5.1-38.2ZM50.1,6.9h-13v-2.9c0-1.2-1-2.1-2.1-2.1h-6c-1.2,0-2.1,1-2.1,2.1v2.9h-13c-3.9.2-7,3.5-7,7.4v3h50.3v-3c0-3.9-3.1-7.2-7-7.4Z"), clearBtn.firstChild);
      dangerRow.appendChild(clearBtn);
    }

    if (showReset && onReset) {
      const resetBtn = createButton(resetLabel, {
        variant: "full",
        onClick: onReset,
        title: "Reset all settings to default",
      });
      resetBtn.classList.add("pxf-btn-danger");
      resetBtn.style.flex = "1";
      resetBtn.insertBefore(_dangerIcon("M5.1,36.2h8c-.1,8,5.1,15,12.2,17.7,7.8,2.9,16.4.6,21.5-5.8,3.3-4.1,4.6-9.2,4-14.4-1-8.6-7.8-15.3-16.4-16.4v6.5c0,.6-.6,1.3-1.1,1.4-.5.2-1.5.2-1.9-.2l-12-10.2c-.6-.5-.8-1.1-.8-1.9,0-.7.4-1.3,1-1.8l11.6-9.9c.6-.5,1.4-.6,2.1-.3.5.2,1,.9,1,1.6v6.4c4.6.5,9,1.9,12.8,4.5,6.5,4.5,10.6,11.2,11.6,19,.3,2.7.4,5,0,7.6-.9,6.2-3.9,12-8.4,16.2-12.2,11.1-30.9,8.9-40.4-4.6-3.1-4.4-4.8-9.7-4.8-15.5ZM38.7,41.7v-9.2c0-1.1-.7-1.9-1.7-2.2h-10.1c-1,.2-1.7,1.1-1.7,2.1v9.3c0,1.2.9,2.1,2.1,2.1h9.1c1.2,0,2.3-1,2.3-2.2Z"), resetBtn.firstChild);
      dangerRow.appendChild(resetBtn);
    }

    wrapper.appendChild(dangerRow);
  }

  function setupDropZone(workspace) {
    if (!workspace || !onAddImage) return;

    const overlay = document.createElement("div");
    overlay.className = "pxf-drop-overlay";
    overlay.innerHTML = '<span class="pxf-drop-label">Drop image here</span>';
    workspace.appendChild(overlay);

    let dragCounter = 0;
    workspace.addEventListener("dragenter", (e) => {
      e.preventDefault(); e.stopPropagation();
      dragCounter++;
      if (e.dataTransfer?.types?.includes("Files")) overlay.classList.add("active");
    });
    workspace.addEventListener("dragleave", (e) => {
      e.preventDefault(); e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove("active"); }
    });
    workspace.addEventListener("dragover", (e) => {
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    });
    workspace.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      dragCounter = 0;
      overlay.classList.remove("active");
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith("image/")) onAddImage(file);
    });

    const overlayEl = workspace.closest(".pxf-overlay");
    if (overlayEl) {
      ["dragenter","dragover","dragleave","drop"].forEach(evt => {
        overlayEl.addEventListener(evt, (e) => {
          e.preventDefault(); e.stopPropagation();
        });
      });
    }

    const _pasteHandler = (e) => {
      if (!overlayEl?.isConnected) { window.removeEventListener("paste", _pasteHandler, true); return; }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault(); e.stopPropagation();
          const file = item.getAsFile();
          if (file) onAddImage(file);
          break;
        }
      }
    };
    window.addEventListener("paste", _pasteHandler, true);
  }

  return {
    el: wrapper,
    fileInput,
    setBgColor(hex) {
      _bgColor = hex;
      if (colorInput) colorInput.value = hex;
    },
    getBgColor() { return _bgColor; },
    setupDropZone,
  };
}
