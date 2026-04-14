// ============================================================
// Pixaroma 3D Editor — Per-object Shape parameter panel
// Shown in the right sidebar. Displays sliders for the active
// object's geoParams, rebuilds geometry on change.
// ============================================================
import { Pixaroma3DEditor, getTHREE } from "./core.mjs";
import { SHAPES, buildGeometry } from "./shapes.mjs";

const DEBOUNCE_MS = 60;

// Refresh the framework --pxf-fill CSS var so the orange slider fill
// aligns with the thumb. The framework only auto-updates this for
// sliders already mounted inside .pxf-overlay; we call it manually.
function refreshFill(slider) {
  if (window._pxfUpdateFill) window._pxfUpdateFill(slider);
}

// Create the Shape panel container. Called once during _buildRight.
// Returns the panel element; body is filled by _rebuildShapePanel on
// every selection change.
Pixaroma3DEditor.prototype._createShapePanel = function (createPanel) {
  const p = createPanel("Shape", { collapsible: true, collapsed: false });
  this._shapePanel = p;
  this._shapePanelBody = document.createElement("div");
  this._shapePanelBody.className = "p3d-shape-panel-body";
  p.content.appendChild(this._shapePanelBody);
  this._showShapePanelEmpty("Select an object to edit its shape.");
  return p.el;
};

Pixaroma3DEditor.prototype._showShapePanelEmpty = function (msg) {
  if (!this._shapePanelBody) return;
  this._shapePanelBody.innerHTML =
    `<div style="font-size:10px;color:#888;padding:8px 2px;">${msg}</div>`;
};

// Called from _select() whenever selection changes. Rebuilds slider
// UI to match the active object's type.
Pixaroma3DEditor.prototype._rebuildShapePanel = function () {
  const body = this._shapePanelBody;
  if (!body) return;
  body.innerHTML = "";

  const obj = this.activeObj;
  if (!obj) {
    this._showShapePanelEmpty("Select an object to edit its shape.");
    return;
  }

  const type = obj.userData.type;

  // Multi-select with mixed types
  if (this.selectedObjs.size > 1) {
    let allSame = true;
    for (const o of this.selectedObjs) {
      if (o.userData.type !== type) { allSame = false; break; }
    }
    if (!allSame) {
      this._showShapePanelEmpty(
        "Multiple types selected - pick one object to edit shape.");
      return;
    }
  }

  // Imported models have no parametric shape (Task 7/8 territory)
  if (type === "import" || type === "bunny") {
    this._showShapePanelEmpty("No shape parameters for imported models.");
    return;
  }

  const shape = SHAPES[type];
  if (!shape) {
    this._showShapePanelEmpty(`Unknown shape type: ${type}`);
    return;
  }

  // Header: icon + name
  const head = document.createElement("div");
  head.style.cssText =
    "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
  const icon = document.createElement("img");
  icon.src = `/pixaroma/assets/icons/3D/${shape.icon}`;
  icon.style.cssText = "width:16px;height:16px;filter:invert(90%);";
  const name = document.createElement("span");
  name.textContent = shape.label;
  name.style.cssText = "font-size:11px;color:#ccc;font-weight:600;";
  head.append(icon, name);
  body.appendChild(head);

  // Sliders
  const locked = !!obj.userData.locked;
  shape.params.forEach((f) => {
    const row = this._buildShapeParamRow(obj, shape, f, locked);
    body.appendChild(row);
    // Refresh fill AFTER the row (and its slider) is in the DOM.
    const slider = row.querySelector("input[type=range]");
    if (slider) refreshFill(slider);
  });

  // Reset defaults button
  const reset = document.createElement("button");
  reset.className = "p3d-btn";
  reset.style.cssText =
    "width:100%;margin-top:4px;font-size:10px;padding:4px 8px;";
  reset.textContent = "\u21ba Reset Shape Defaults";
  reset.disabled = locked;
  reset.addEventListener("click", () => {
    if (locked) return;
    this._pushUndo();
    for (const o of this.selectedObjs) {
      if (o.userData.type !== type) continue;
      o.userData.geoParams = { ...shape.defaults };
      this._rebuildObjectGeometry(o);
    }
    this._rebuildShapePanel();
  });
  body.appendChild(reset);
};

// One slider row: label + range + number input.
// Live rebuild for shape.live=true; debounced rebuild otherwise.
// One undo snapshot per drag (pushed on first input event).
Pixaroma3DEditor.prototype._buildShapeParamRow = function (obj, shape, f, locked) {
  const row = document.createElement("div");
  row.className = "p3d-row";
  const lbl = document.createElement("div");
  lbl.className = "p3d-label";
  lbl.textContent = f.label;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "p3d-range";
  slider.min = f.min; slider.max = f.max; slider.step = f.step;
  slider.value = obj.userData.geoParams[f.key];
  slider.disabled = locked;

  const numIn = document.createElement("input");
  numIn.type = "number";
  numIn.className = "p3d-input";
  numIn.min = f.min; numIn.max = f.max; numIn.step = f.step;
  numIn.value = slider.value;
  numIn.disabled = locked;

  const isInt = Number.isInteger(f.step);
  const fmt = (v) => isInt
    ? String(+v)
    : (+v).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

  // Debounce state (closure per row)
  let debounceT = null;
  let draggingSnapshot = false;

  const apply = (v, isFinal) => {
    // One undo snapshot per drag
    if (!draggingSnapshot) {
      this._pushUndo();
      draggingSnapshot = true;
    }
    for (const o of this.selectedObjs) {
      if (o.userData.type !== obj.userData.type) continue;
      o.userData.geoParams[f.key] = +v;
      if (shape.live) {
        this._rebuildObjectGeometry(o);
      } else {
        if (debounceT) clearTimeout(debounceT);
        debounceT = setTimeout(() => {
          this._rebuildObjectGeometry(o);
          debounceT = null;
        }, DEBOUNCE_MS);
      }
    }
    // On final change (mouse up / number input blur), flush any
    // pending debounced rebuild immediately.
    if (isFinal && debounceT) {
      clearTimeout(debounceT);
      for (const o of this.selectedObjs) {
        if (o.userData.type === obj.userData.type) {
          this._rebuildObjectGeometry(o);
        }
      }
      debounceT = null;
    }
  };

  const sync = (v) => {
    slider.value = v;
    numIn.value = fmt(v);
    refreshFill(slider);
  };

  slider.addEventListener("input", () => {
    sync(slider.value);
    apply(slider.value, false);
  });
  slider.addEventListener("change", () => {
    apply(slider.value, true);
    draggingSnapshot = false;
  });
  numIn.addEventListener("change", () => {
    const v = Math.max(f.min, Math.min(f.max, +numIn.value || f.min));
    sync(v);
    apply(v, true);
    draggingSnapshot = false;
  });

  row.append(lbl, slider, numIn);
  return row;
};

// Swap the mesh's geometry using the registry builder.
// Preserves transform, material, userData. Disposes old geometry.
Pixaroma3DEditor.prototype._rebuildObjectGeometry = function (obj) {
  const THREE = getTHREE();
  const type = obj.userData.type;
  const gp = obj.userData.geoParams;
  const newGeo = buildGeometry(THREE, type, gp);
  obj.geometry?.dispose();
  obj.geometry = newGeo;
};
