// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Editor Framework — Layer System                    ║
// ║  Photoshop-style layer panel with drag reorder               ║
// ╚═══════════════════════════════════════════════════════════════╝

import { createPanel, createSliderRow } from "./components.mjs";

/** Base path for layer icon SVGs. */
const LAYER_ICON_BASE = "/pixaroma/assets/icons/layers/";

function _layerIcon(name, size = 12) {
  const img = document.createElement("img");
  img.src = LAYER_ICON_BASE + name + ".svg";
  img.width = size;
  img.height = size;
  img.draggable = false;
  return img;
}

/**
 * Returns a <span> that renders the SVG via CSS mask-image so its color
 * can be set exactly (vs. approximating via filter: hue-rotate).
 * Used for the "locked" state so the icon matches Pixaroma brand orange.
 */
function _layerIconColored(name, color, size = 12) {
  const span = document.createElement("span");
  const url = LAYER_ICON_BASE + name + ".svg";
  span.style.display = "inline-block";
  span.style.width = size + "px";
  span.style.height = size + "px";
  span.style.backgroundColor = color;
  span.style.webkitMaskImage = `url(${url})`;
  span.style.maskImage = `url(${url})`;
  span.style.webkitMaskRepeat = "no-repeat";
  span.style.maskRepeat = "no-repeat";
  span.style.webkitMaskSize = "contain";
  span.style.maskSize = "contain";
  span.style.webkitMaskPosition = "center";
  span.style.maskPosition = "center";
  return span;
}

function _layerActionBtn(iconName, title, onClick, cls = "") {
  const btn = document.createElement("button");
  btn.className = "pxf-layer-action-btn" + (cls ? " " + cls : "");
  btn.title = title;
  // If iconName starts with "/", treat it as an absolute asset path
  // (e.g. "/pixaroma/assets/icons/3D/drop-on-floor.svg") and render
  // that directly. Otherwise prepend the default layers icon base.
  if (iconName.startsWith("/")) {
    const img = document.createElement("img");
    img.src = iconName;
    img.width = 14;
    img.height = 14;
    img.draggable = false;
    btn.appendChild(img);
  } else {
    btn.appendChild(_layerIcon(iconName, 14));
  }
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

// ── Layer Item ───────────────────────────────────────────────
export function createLayerItem(config) {
  const el = document.createElement("div");
  el.className = "pxf-layer-item";
  if (config.active) el.classList.add("active");
  if (config.multiSelected) el.classList.add("multi-selected");
  el.draggable = true;

  // Visibility toggle
  const vis = document.createElement("div");
  vis.className = "pxf-layer-icon";
  vis.title = "Toggle visibility";
  let _visible = config.visible;
  vis.appendChild(_layerIcon(_visible ? "eye-visible" : "eye-hidden"));
  vis.addEventListener("click", (e) => {
    e.stopPropagation();
    config.onVisibilityToggle();
  });

  // Thumbnail
  const thumbWrap = document.createElement("div");
  thumbWrap.className = "pxf-layer-thumb";
  if (config.thumbnail) thumbWrap.appendChild(config.thumbnail);

  // Name
  const nameEl = document.createElement("span");
  nameEl.className = "pxf-layer-name";
  nameEl.textContent = config.name;

  // ── Inline rename ──
  function startRename() {
    const currentName = nameEl.textContent;
    const input = document.createElement("input");
    input.className = "pxf-layer-name-input";
    input.value = currentName;
    nameEl.style.display = "none";
    nameEl.parentNode.insertBefore(input, nameEl);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const newName = input.value.trim() || currentName;
      nameEl.textContent = newName;
      nameEl.style.display = "";
      input.remove();
      if (config.onRename) config.onRename(newName);
    };
    input.addEventListener("keydown", (ke) => {
      ke.stopPropagation();
      ke.stopImmediatePropagation();
      if (ke.key === "Enter") {
        finish();
      }
      if (ke.key === "Escape") {
        input.value = currentName;
        finish();
      }
    });
    setTimeout(() => {
      input.focus();
      input.select();
      input.addEventListener("blur", () => setTimeout(finish, 50));
    }, 60);
  }
  if (config.onRename) {
    nameEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startRename();
    });
  }

  // Edit icon button
  let editBtn = null;
  if (config.onRename) {
    editBtn = document.createElement("div");
    editBtn.className = "pxf-layer-icon";
    editBtn.title = "Rename layer";
    editBtn.appendChild(_layerIcon("edit"));
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      startRename();
    });
  }

  // Lock toggle
  const lock = document.createElement("div");
  lock.className = "pxf-layer-icon";
  lock.title = "Toggle lock";
  let _locked = config.locked;
  const lockIcon = _locked
    ? _layerIconColored("lock-locked", "var(--pxf-accent)")
    : _layerIcon("lock-unlocked");
  lock.appendChild(lockIcon);
  lock.addEventListener("click", (e) => {
    e.stopPropagation();
    config.onLockToggle();
  });

  el.append(vis, thumbWrap, nameEl);
  if (editBtn) el.appendChild(editBtn);
  el.appendChild(lock);

  el.addEventListener("click", (e) => config.onClick(e));

  return {
    el,
    setName(s) {
      nameEl.textContent = s;
    },
    setActive(b) {
      el.classList.toggle("active", b);
    },
    setMulti(b) {
      el.classList.toggle("multi-selected", b);
    },
    setVisible(b) {
      _visible = b;
      vis.innerHTML = "";
      vis.appendChild(_layerIcon(b ? "eye-visible" : "eye-hidden"));
    },
    setLocked(b) {
      _locked = b;
      lock.innerHTML = "";
      const ico = b
        ? _layerIconColored("lock-locked", "var(--pxf-accent)")
        : _layerIcon("lock-unlocked");
      lock.appendChild(ico);
    },
  };
}

// ── Layers List ──────────────────────────────────────────────
export function createLayersList(config) {
  const panel = createPanel(config.title || "Layers");

  const list = document.createElement("div");
  list.className = "pxf-layers-list";
  panel.content.appendChild(list);

  // ── Drag-to-reorder ──
  let dragIdx = -1;
  list.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".pxf-layer-item");
    if (!item) return;
    dragIdx = [...list.children].indexOf(item);
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const item = e.target.closest(".pxf-layer-item");
    if (!item || item.classList.contains("dragging")) return;
    list.querySelectorAll(".pxf-layer-item").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
    const rect = item.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    item.classList.add(e.clientY < mid ? "drag-over-top" : "drag-over-bottom");
  });
  list.addEventListener("dragleave", (e) => {
    const item = e.target.closest(".pxf-layer-item");
    if (item) item.classList.remove("drag-over-top", "drag-over-bottom");
  });
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    list.querySelectorAll(".pxf-layer-item").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom", "dragging");
    });
    const item = e.target.closest(".pxf-layer-item");
    if (!item) return;
    let dropIdx = [...list.children].indexOf(item);
    const rect = item.getBoundingClientRect();
    if (e.clientY >= rect.top + rect.height / 2) dropIdx++;
    if (dragIdx >= 0 && dropIdx !== dragIdx && config.onReorder) {
      config.onReorder(dragIdx, dropIdx > dragIdx ? dropIdx - 1 : dropIdx);
    }
    dragIdx = -1;
  });
  list.addEventListener("dragend", () => {
    list.querySelectorAll(".pxf-layer-item").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom", "dragging");
    });
    dragIdx = -1;
  });

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "pxf-layers-actions";
  if (config.onAdd)
    actions.appendChild(
      _layerActionBtn(
        config.addIcon || "add",
        config.addTitle || "Add layer",
        config.onAdd,
      ),
    );
  if (config.onDuplicate)
    actions.appendChild(
      _layerActionBtn("duplicate", "Duplicate layer", config.onDuplicate),
    );
  // Editor-specific action — 3D editor uses this to snap the selected
  // object's base to the ground plane. Pass a full asset path so the
  // framework doesn't have to know about 3D-only icons.
  if (config.onDropToFloor)
    actions.appendChild(
      _layerActionBtn(
        config.dropToFloorIcon || "/pixaroma/assets/icons/3D/drop-on-floor.svg",
        config.dropToFloorTitle || "Drop to floor",
        config.onDropToFloor,
      ),
    );
  if (config.onDelete)
    actions.appendChild(
      _layerActionBtn("delete", "Delete layer", config.onDelete, "danger"),
    );
  if (config.onMoveUp)
    actions.appendChild(_layerActionBtn("move-up", "Move up", config.onMoveUp));
  if (config.onMoveDown)
    actions.appendChild(
      _layerActionBtn("move-down", "Move down", config.onMoveDown),
    );
  if (config.onMerge)
    actions.appendChild(
      _layerActionBtn("merge-down", "Merge down", config.onMerge),
    );
  if (config.onFlatten)
    actions.appendChild(
      _layerActionBtn("flatten", "Flatten all", config.onFlatten),
    );
  panel.content.appendChild(actions);

  return {
    el: panel.el,
    list,
    refresh(items) {
      list.innerHTML = "";
      items.forEach((item) => list.appendChild(item));
    },
  };
}

// ── Layer Panel (Photoshop-style: blend + opacity + list + actions) ───
export function createLayerPanel(config) {
  const wrapper = document.createElement("div");
  wrapper.className = "pxf-layer-panel";

  let blendSelect = null,
    opacitySlider = null,
    opacityNum = null;

  // ── Blend Mode row ──
  if (config.showBlendMode !== false) {
    const blendRow = document.createElement("div");
    blendRow.className = "pxf-layer-blend-row";
    const defaultModes = [
      { value: "Normal", label: "Normal" },
      { value: "Multiply", label: "Multiply" },
      { value: "Screen", label: "Screen" },
      { value: "Overlay", label: "Overlay" },
      { value: "Darken", label: "Darken" },
      { value: "Lighten", label: "Lighten" },
      { value: "Color Dodge", label: "Color Dodge" },
      { value: "Color Burn", label: "Color Burn" },
      { value: "Hard Light", label: "Hard Light" },
      { value: "Soft Light", label: "Soft Light" },
      { value: "Difference", label: "Difference" },
      { value: "Exclusion", label: "Exclusion" },
      { value: "Hue", label: "Hue" },
      { value: "Saturation", label: "Saturation" },
      { value: "Color", label: "Color" },
      { value: "Luminosity", label: "Luminosity" },
    ];
    blendSelect = document.createElement("select");
    blendSelect.className = "pxf-layer-blend-select";
    (config.blendModes || defaultModes).forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.value;
      opt.textContent = m.label;
      blendSelect.appendChild(opt);
    });
    blendSelect.addEventListener("change", () => {
      if (config.onBlendChange) config.onBlendChange(blendSelect.value);
    });
    blendRow.appendChild(blendSelect);
    wrapper.appendChild(blendRow);
  }

  // ── Opacity row ──
  if (config.showOpacity !== false) {
    const opRow = document.createElement("div");
    opRow.className = "pxf-layer-opacity-row";
    const opLabel = document.createElement("span");
    opLabel.className = "pxf-layer-opacity-label";
    opLabel.textContent = "Opacity";
    opacitySlider = document.createElement("input");
    opacitySlider.type = "range";
    opacitySlider.min = 0;
    opacitySlider.max = 100;
    opacitySlider.value = 100;
    opacityNum = document.createElement("input");
    opacityNum.type = "number";
    opacityNum.min = 0;
    opacityNum.max = 100;
    opacityNum.value = 100;
    function _syncOpFill() {
      if (window._pxfUpdateFill) window._pxfUpdateFill(opacitySlider);
    }
    opacitySlider.addEventListener("input", () => {
      opacityNum.value = opacitySlider.value;
      _syncOpFill();
      if (config.onOpacityChange) config.onOpacityChange(+opacitySlider.value);
    });
    opacityNum.addEventListener("change", () => {
      opacitySlider.value = opacityNum.value;
      _syncOpFill();
      if (config.onOpacityChange) config.onOpacityChange(+opacityNum.value);
    });
    opacitySlider.style.setProperty("--pxf-fill", "100%");
    opRow.append(opLabel, opacitySlider, opacityNum);
    wrapper.appendChild(opRow);
  }

  // ── Layer list ──
  const layersList = createLayersList(config);
  const list = layersList.list;
  wrapper.appendChild(list);

  // Resize handle
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "pxf-layers-resize";
  resizeHandle.title = "Drag to resize layer list";
  wrapper.appendChild(resizeHandle);

  // Action buttons
  const actionsEl = layersList.el.querySelector(".pxf-layers-actions");
  if (actionsEl) wrapper.appendChild(actionsEl);

  return {
    el: wrapper,
    list: layersList.list,
    blendSelect,
    opacitySlider,
    opacityNum,
    refresh(items) {
      layersList.refresh(items);
    },
    setBlend(v) {
      if (blendSelect) blendSelect.value = v;
    },
    setOpacity(v) {
      if (opacitySlider) {
        opacitySlider.value = v;
        opacitySlider.style.setProperty("--pxf-fill", v + "%");
      }
      if (opacityNum) opacityNum.value = v;
    },
  };
}
