import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget } from "../shared/index.mjs";

function injectCSS() {
  if (document.getElementById("pixaroma-resolution-css")) return;
  const css = `
    .pix-res-root {
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      color: #ddd;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pix-res-chips {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
    }
    .pix-res-chip {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 0;
      text-align: center;
      font-size: 10px;
      color: #ccc;
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, border-color 0.08s;
    }
    .pix-res-chip:hover { border-color: #666; }
    .pix-res-chip.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-res-chip.span-3 { grid-column: span 3; }
    .pix-res-list {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      min-height: 120px;
      display: flex;
      flex-direction: column;
    }
    .pix-res-row {
      flex: 1;
      padding: 4px 8px;
      border-bottom: 1px solid #2f2f2f;
      font-size: 11px;
      text-align: center;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ui-monospace, monospace;
      color: #ccc;
    }
    .pix-res-row:last-child { border-bottom: none; }
    .pix-res-row.active {
      background: rgba(246,103,68,0.15);
      color: ${BRAND};
      font-weight: 600;
    }
    .pix-res-row.empty {
      cursor: default;
      color: #2a2a2a;
    }
    .pix-res-custom {
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pix-res-custom-row { display: flex; gap: 8px; }
    .pix-res-custom-field { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .pix-res-custom-field label {
      font-size: 9px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
    }
    .pix-res-custom-field input {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      color: ${BRAND};
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      font-family: ui-monospace, monospace;
      box-sizing: border-box;
      width: 100%;
    }
    .pix-res-custom-field input:focus {
      outline: none;
      border-color: ${BRAND};
    }
    .pix-res-swap {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 5px;
      color: #aaa;
      font-size: 10px;
      cursor: pointer;
    }
    .pix-res-swap:hover { color: #ddd; border-color: #666; }
    .pix-res-readout {
      text-align: center;
      font-size: 10px;
      color: #777;
    }
    .pix-res-readout .accent { color: ${BRAND}; }
  `;
  const style = document.createElement("style");
  style.id = "pixaroma-resolution-css";
  style.textContent = css;
  document.head.appendChild(style);
}
injectCSS();

// Locked node dimensions. Tuned by eye in the Vue frontend.
const NODE_W = 240;
const NODE_H = 296;   // total node height
const WIDGET_H = 250; // DOM widget area height (inside title + ports)

const STATE_WIDGET = "ResolutionState";

const DEFAULT_STATE = {
  mode: "preset",
  ratio: "1:1",
  w: 1024,
  h: 1024,
  custom_w: 1024,
  custom_h: 1024,
};

function readState(node) {
  const w = (node.widgets || []).find((x) => x.name === STATE_WIDGET);
  if (!w?.value) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(w.value);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(node, state) {
  const w = (node.widgets || []).find((x) => x.name === STATE_WIDGET);
  if (w) w.value = JSON.stringify(state);
}

// Chip layout — order matches design spec
const CHIPS = [
  { id: "1:1",    label: "1:1" },
  { id: "16:9",   label: "16:9" },
  { id: "9:16",   label: "9:16" },
  { id: "2:1",    label: "2:1" },
  { id: "3:2",    label: "3:2" },
  { id: "2:3",    label: "2:3" },
  { id: "custom", label: "Custom Resolution", span3: true },
];

// Sizes per ratio — exactly 6 entries each. 1:1 was extended in the spec to 2048×2048.
const SIZES = {
  "1:1":  [[1024,1024],[1280,1280],[1328,1328],[1408,1408],[1536,1536],[2048,2048]],
  "16:9": [[1344,768],[1536,864],[1600,896],[1664,928],[1792,1008],[1920,1088]],
  "9:16": [[768,1344],[864,1536],[896,1600],[928,1664],[1008,1792],[1088,1920]],
  "2:1":  [[1280,640],[1536,768],[1600,800],[1792,896],[1920,960],[2048,1024]],
  "3:2":  [[1152,768],[1344,896],[1536,1024],[1632,1088],[1728,1152],[1920,1280]],
  "2:3":  [[768,1152],[896,1344],[1024,1536],[1088,1632],[1152,1728],[1280,1920]],
};

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a || 1;
}

function ratioLabel(w, h) {
  const g = gcd(w, h);
  const rw = w / g, rh = h / g;
  const known = ["1:1","16:9","9:16","2:1","1:2","3:2","2:3"];
  const simple = `${rw}:${rh}`;
  if (known.includes(simple)) return simple;
  const r = w / h;
  return r >= 1 ? `~${r.toFixed(2)}:1` : `~1:${(1 / r).toFixed(2)}`;
}

function megapixels(w, h) {
  return ((w * h) / 1_000_000).toFixed(2);
}

function snap16(n) { return Math.round(n / 16) * 16; }
function clampDim(n) { return Math.max(256, Math.min(4096, n)); }

function renderChipGrid(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-chips";
  for (const c of CHIPS) {
    const el = document.createElement("div");
    el.className = "pix-res-chip" + (c.span3 ? " span-3" : "");
    el.textContent = c.label;
    el.dataset.chipId = c.id;
    const isActive =
      (c.id === "custom" && state.mode === "custom") ||
      (c.id !== "custom" && state.mode === "preset" && state.ratio === c.id);
    if (isActive) el.classList.add("active");
    wrap.appendChild(el);
  }
  return wrap;
}

function renderSizeList(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-list";
  if (state.mode !== "preset") return wrap; // Custom mode handled in Task 5
  const sizes = SIZES[state.ratio] || [];
  // Render 6 rows; pad with .empty rows if the ratio has fewer than 6
  for (let i = 0; i < 6; i++) {
    const row = document.createElement("div");
    row.className = "pix-res-row";
    if (i >= sizes.length) {
      row.classList.add("empty");
      row.textContent = "";
      wrap.appendChild(row);
      continue;
    }
    const [w, h] = sizes[i];
    row.textContent = `${w} × ${h}`;
    row.dataset.w = String(w);
    row.dataset.h = String(h);
    if (state.w === w && state.h === h) row.classList.add("active");
    wrap.appendChild(row);
  }
  return wrap;
}

function renderCustomPanel(node, state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-list pix-res-custom";

  const row = document.createElement("div");
  row.className = "pix-res-custom-row";

  const wField = document.createElement("div");
  wField.className = "pix-res-custom-field";
  const wLabel = document.createElement("label");
  wLabel.textContent = "Width";
  const wInput = document.createElement("input");
  wInput.type = "number";
  wInput.min = "256";
  wInput.max = "4096";
  wInput.step = "16";
  wInput.value = String(state.w);

  const hField = document.createElement("div");
  hField.className = "pix-res-custom-field";
  const hLabel = document.createElement("label");
  hLabel.textContent = "Height";
  const hInput = document.createElement("input");
  hInput.type = "number";
  hInput.min = "256";
  hInput.max = "4096";
  hInput.step = "16";
  hInput.value = String(state.h);

  wField.append(wLabel, wInput);
  hField.append(hLabel, hInput);
  row.append(wField, hField);

  const swap = document.createElement("button");
  swap.type = "button";
  swap.className = "pix-res-swap";
  swap.textContent = "⇄  Swap W ↔ H";

  const readout = document.createElement("div");
  readout.className = "pix-res-readout";

  function refreshReadout(w, h) {
    readout.innerHTML =
      `snaps to 16 px · <span class="accent">${ratioLabel(w, h)}</span> · ${megapixels(w, h)} MP`;
  }
  refreshReadout(state.w, state.h);

  function commit() {
    const wRaw = parseInt(wInput.value, 10);
    const hRaw = parseInt(hInput.value, 10);
    const wNew = clampDim(snap16(Number.isFinite(wRaw) ? wRaw : 1024));
    const hNew = clampDim(snap16(Number.isFinite(hRaw) ? hRaw : 1024));
    wInput.value = String(wNew);
    hInput.value = String(hNew);
    refreshReadout(wNew, hNew);
    const cur = readState(node);
    writeState(node, { ...cur, w: wNew, h: hNew, custom_w: wNew, custom_h: hNew });
  }

  function liveUpdate() {
    const wLive = parseInt(wInput.value, 10);
    const hLive = parseInt(hInput.value, 10);
    if (Number.isFinite(wLive) && Number.isFinite(hLive)) refreshReadout(wLive, hLive);
  }
  wInput.addEventListener("input", liveUpdate);
  hInput.addEventListener("input", liveUpdate);

  wInput.addEventListener("blur", commit);
  hInput.addEventListener("blur", commit);
  wInput.addEventListener("keydown", (e) => { if (e.key === "Enter") wInput.blur(); });
  hInput.addEventListener("keydown", (e) => { if (e.key === "Enter") hInput.blur(); });

  for (const inp of [wInput, hInput]) {
    inp.addEventListener("keydown", (e) => e.stopPropagation());
  }

  swap.addEventListener("click", () => {
    const w = parseInt(wInput.value, 10) || state.w;
    const h = parseInt(hInput.value, 10) || state.h;
    wInput.value = String(h);
    hInput.value = String(w);
    commit();
  });

  wrap.append(row, swap, readout);
  return wrap;
}

function renderUI(node) {
  const state = readState(node);
  let root = node._pixResRoot;
  if (!root || !root.isConnected) {
    // Vue may have detached the original element. Re-find via the DOM widget.
    const w = (node.widgets || []).find((x) => x.name === "resolution_ui");
    if (w?.element?.isConnected) {
      const found = w.element.querySelector(".pix-res-root");
      if (found) {
        node._pixResRoot = found;
        root = found;
      } else {
        // Container exists but our root is gone — append a new one.
        root = document.createElement("div");
        root.className = "pix-res-root";
        w.element.appendChild(root);
        node._pixResRoot = root;
      }
    } else {
      return; // nothing to render into
    }
  }

  root.innerHTML = "";
  root.appendChild(renderChipGrid(state));
  if (state.mode === "custom") {
    root.appendChild(renderCustomPanel(node, state));
  } else {
    root.appendChild(renderSizeList(state));
  }
}

function setupResolutionNode(node) {
  // Hide the raw JSON widget — JS owns the UI.
  hideJsonWidget(node.widgets, STATE_WIDGET);

  // Lock the node size and disable resize handle.
  node.resizable = false;
  node.size = [NODE_W, NODE_H];

  // DEBUG — remove after persistence is confirmed working.
  const _stateW = (node.widgets || []).find((x) => x.name === STATE_WIDGET);
  console.log(
    "[PixRes] setupResolutionNode — widget value at setup:",
    _stateW?.value,
    "| widgets:", (node.widgets || []).map((w) => w.name),
  );

  // Read state. nodeCreated fires AFTER configure, so for workflow-restored
  // nodes the widget value is the saved JSON; for fresh nodes it's the Python
  // default.
  const state = readState(node);
  console.log("[PixRes] parsed state:", state);
  writeState(node, state); // normalize back so widget value is canonical

  // Build the UI: chip grid + (size list OR Custom panel based on mode).
  const root = document.createElement("div");
  root.className = "pix-res-root";

  // Initial population MUST happen before addDOMWidget. At this point
  // root.isConnected is false, so renderUI()'s connection guard would
  // short-circuit. Click-driven re-renders run later when root is
  // connected and renderUI works correctly.
  root.appendChild(renderChipGrid(state));
  if (state.mode === "custom") {
    root.appendChild(renderCustomPanel(node, state));
  } else {
    root.appendChild(renderSizeList(state));
  }

  const _widget = node.addDOMWidget("resolution_ui", "custom", root, {
    getValue: () => readState(node),
    setValue: (_v) => {},
    getMinHeight: () => WIDGET_H,
    getMaxHeight: () => WIDGET_H,
    margin: 4,
    serialize: false, // DOM widget itself does not serialize; the hidden STRING widget owns the state
  });

  const _onClick = (e) => {
    const chip = e.target.closest(".pix-res-chip");
    if (chip) {
      const id = chip.dataset.chipId;
      const cur = readState(node);
      if (id === "custom") {
        writeState(node, {
          ...cur,
          mode: "custom",
          w: cur.custom_w ?? 1024,
          h: cur.custom_h ?? 1024,
        });
      } else {
        const sizes = SIZES[id];
        if (!sizes) return;
        const [w, h] = sizes[0];
        writeState(node, { ...cur, mode: "preset", ratio: id, w, h });
      }
      renderUI(node);
      return;
    }
    const row = e.target.closest(".pix-res-row");
    if (row && !row.classList.contains("empty") && row.dataset.w) {
      const w = parseInt(row.dataset.w, 10);
      const h = parseInt(row.dataset.h, 10);
      const cur = readState(node);
      writeState(node, { ...cur, w, h });
      renderUI(node);
    }
  };

  // Attach to both root and the widget container so a Vue rebuild still routes events.
  root.addEventListener("click", _onClick);
  if (_widget?.element) _widget.element.addEventListener("click", _onClick);

  node._pixResRoot = root;
}

app.registerExtension({
  name: "Pixaroma.Resolution",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaResolution") return;

    // onConfigure fires when ComfyUI loads a saved workflow into an existing
    // node (e.g. user opens a different workflow without page reload). Re-read
    // and re-render so the UI matches the freshly-applied widget value.
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      // DEBUG
      console.log("[PixRes] onConfigure fired. info.widgets_values:", info?.widgets_values);
      const r = _origConfigure?.apply(this, arguments);
      const _w = (this.widgets || []).find((x) => x.name === STATE_WIDGET);
      console.log("[PixRes] onConfigure post — widget value:", _w?.value, "_pixResRoot:", !!this._pixResRoot);
      if (this._pixResRoot) renderUI(this);
      // Defensive: also re-render after a short delay in case _pixResRoot
      // wasn't ready yet (nodeCreated may fire later than onConfigure).
      setTimeout(() => {
        if (this._pixResRoot?.isConnected) {
          console.log("[PixRes] deferred re-render after onConfigure");
          renderUI(this);
        }
      }, 200);
      return r;
    };

    // Re-clamp on every resize attempt so the node can never grow / shrink.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      this.size[0] = NODE_W;
      this.size[1] = NODE_H;
      if (_origResize) return _origResize.call(this, size);
    };
  },

  // nodeCreated fires AFTER node construction including configure, so widget
  // values restored from a saved workflow are already in place. This is the
  // proven Pixaroma pattern (see js/note/index.js) for hidden-JSON-widget
  // state restoration.
  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaResolution") return;
    setupResolutionNode(node);
  },
});
