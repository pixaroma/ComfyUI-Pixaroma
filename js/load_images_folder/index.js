// Load Images from Folder Pixaroma — extension entry point.
// Mirrors Load Image Pixaroma's both-renderer DOM-widget + Pattern #9 state
// injection, adapted for a folder + multi-select gallery + list output.

import { app } from "/scripts/app.js";
import {
  applyAdaptiveCanvasOnly,
  isVueNodes,
  installResizeFloor,
  hideJsonWidget,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import {
  COMFY_CLASS,
  HIDDEN_INPUT_NAME,
  readState,
  writeState,
} from "./state.mjs";
import { listFolder } from "./api.mjs";
import {
  injectCSS,
  buildRoot,
  openPickGallery,
  openBrowsePopup,
  openMiniMenu,
} from "./ui.mjs";
import { buildModePanel, injectResizePanelCSS } from "../shared/resize_panel.mjs";

const MIN_W = 280;
const DEFAULT_W = 300;

// Resize modes — values match the shared engine (_resize_helpers / buildModePanel).
const RESIZE_MODES = [
  { value: "off", label: "Off", hint: "full size" },
  { value: "max_mp", label: "Max megapixels", hint: "cap pixels" },
  { value: "longest_side", label: "Longest side", hint: "cap long edge" },
  { value: "scale_factor", label: "Scale by", hint: "× factor" },
  { value: "fit_inside", label: "Fit inside", hint: "W×H box" },
  { value: "cover", label: "Crop to fill", hint: "W×H exact" },
  { value: "match_ratio", label: "Match aspect ratio", hint: "crop / pad" },
  { value: "pad", label: "Pad", hint: "add borders" },
];

// ── node body height (sum visible children; NOT scrollHeight) ─────────────────
function measureContentHeight(root) {
  if (!root) return 110;
  let h = 0;
  let n = 0;
  for (const ch of root.children) {
    const oh = ch.offsetHeight;
    if (oh > 0) {
      h += oh;
      n++;
    }
  }
  if (n === 0) return 110; // pre-attach placeholder
  h += 16; // root vertical padding (8 + 8)
  h += (n - 1) * 8; // row gaps
  return Math.max(96, h);
}

function stripInputs(node) {
  if (!node?.inputs || node.inputs.length === 0) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    if (node.inputs[i]?.link != null) {
      try {
        node.disconnectInput(i);
      } catch {}
    }
    node.removeInput(i);
  }
  node.setDirtyCanvas?.(true, true);
}

// ── render the node body from state ──────────────────────────────────────────
function renderUI(node) {
  const ui = node._pixLifUI;
  if (!ui) return;
  const state = readState(node);
  if (document.activeElement !== ui.folderInput) {
    ui.folderInput.value = state.folder || "";
  }
  const total = (node._pixLifFiles || []).length;
  const sel = (state.selected || []).length;
  ui.pickBtn.textContent = `Pick images · ${sel} / ${total}`;
  ui.pickBtn.classList.toggle("empty", sel === 0);
  ui.msgEl.textContent = node._pixLifListError || "";
  node.setDirtyCanvas?.(true, true);
}

// ── (re)list the chosen folder + reconcile selection ─────────────────────────
// userAction = the call came from a real user gesture (folder change / subfolder
// toggle), as opposed to a workflow-load path (onNodeCreated / onConfigure).
async function refreshListing(node, userAction = false) {
  const state = readState(node);
  if (!state.folder) {
    node._pixLifFiles = [];
    node._pixLifListError = "";
    renderUI(node);
    return;
  }
  const res = await listFolder(state.folder, state.recursive);
  if (res && res.ok) {
    node._pixLifFiles = res.files || [];
    node._pixLifListError = node._pixLifFiles.length
      ? ""
      : "No images found in this folder.";
  } else {
    node._pixLifFiles = [];
    node._pixLifListError = (res && res.message) || "Folder not found.";
  }
  // Drop selections that no longer exist on disk, but PERSIST that only on a
  // genuine user action. The load path must never write serialized state
  // (Vue Compat #18) - and isGraphLoading() alone is unreliable here because
  // the await above usually outlasts its 300ms trailing window. Python tolerates
  // missing files at run time (skips them), so not persisting on load is safe.
  const present = new Set((node._pixLifFiles || []).map((f) => f.file));
  const st = readState(node);
  const before = (st.selected || []).length;
  const kept = (st.selected || []).filter((f) => present.has(f));
  if (kept.length !== before && userAction && !isGraphLoading()) {
    st.selected = kept;
    writeState(node, st);
  }
  renderUI(node);
}

async function setFolder(node, folder) {
  const st = readState(node);
  const changed = (st.folder || "") !== (folder || "");
  st.folder = folder;
  if (changed) st.selected = []; // new folder → drop stale selection
  writeState(node, st);
  await refreshListing(node, true);
}

// ── resize control (mode dropdown + the shared per-mode panel) ────────────────
function renderResize(node) {
  const ui = node._pixLifUI;
  if (!ui) return;
  injectResizePanelCSS();
  const state = readState(node);
  const slot = ui.resizeSlot;
  slot.innerHTML = "";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pix-lif-resizebtn";
  const label = RESIZE_MODES.find((m) => m.value === state.mode)?.label || "Off";
  btn.innerHTML = `<span class="lbl">Resize</span><span class="val">${label} ▾</span>`;
  btn.title = "Resize each image as it loads (same options as Load Image)";
  btn.addEventListener("click", () => {
    openMiniMenu(btn, RESIZE_MODES, readState(node).mode, (val) => {
      const st = readState(node);
      st.mode = val;
      writeState(node, st);
      renderResize(node);
      node.setDirtyCanvas?.(true, true);
    });
  });
  slot.appendChild(btn);

  if (state.mode !== "off") {
    // The shared builders re-read node.properties[stateKey] on each edit and
    // only override the resize key, so folder/selected are preserved.
    const panel = buildModePanel(
      state.mode,
      node,
      readState(node),
      writeState,
      () => node.setDirtyCanvas?.(true, true),
      "loadImagesFolderState",
      { oneLine: true }
    );
    if (panel) slot.appendChild(panel);
  }
  node.setDirtyCanvas?.(true, true);
}

// ── per-node setup ───────────────────────────────────────────────────────────
function setupNode(node) {
  injectCSS();
  try {
    hideJsonWidget(node.widgets, HIDDEN_INPUT_NAME);
  } catch {}
  stripInputs(node);

  const ui = buildRoot();
  node._pixLifUI = ui;

  const widget = node.addDOMWidget("pixaroma_lif_ui", "custom", ui.root, {
    getValue: () => null,
    setValue: () => {},
    getMinHeight: () => measureContentHeight(ui.root),
    getMaxHeight: () => measureContentHeight(ui.root),
    serialize: false,
  });
  applyAdaptiveCanvasOnly(widget);
  node._pixLifWidget = widget;
  if (isVueNodes()) {
    widget.computeLayoutSize = () => ({
      minHeight: measureContentHeight(ui.root),
      minWidth: 1,
    });
  }

  // events
  ui.folderInput.addEventListener("keydown", (e) => {
    // capture-phase canvas shortcuts need stopImmediate, not just stop
    e.stopImmediatePropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      ui.folderInput.blur();
    }
  });
  ui.folderInput.addEventListener("change", () =>
    setFolder(node, ui.folderInput.value.trim())
  );
  ui.browseBtn.addEventListener("click", () => {
    openBrowsePopup(node, ui.browseBtn, {
      startPath: readState(node).folder,
      onPick: (folder) => setFolder(node, folder),
    });
  });
  ui.pickBtn.addEventListener("click", async () => {
    // commit a typed-but-not-blurred path first
    const typed = ui.folderInput.value.trim();
    if (typed !== (readState(node).folder || "")) await setFolder(node, typed);
    const st = readState(node);
    if (!st.folder) {
      ui.folderInput.focus();
      node._pixLifListError = "Set a folder first (type, paste, or Browse).";
      renderUI(node);
      return;
    }
    if (!node._pixLifFiles) await refreshListing(node, true);
    openPickGallery(node, ui.pickBtn, {
      onChange: renderUI,
      refreshListing: (n) => refreshListing(n, true),
    });
  });

  try {
    node._pixLifFloorOff = installResizeFloor(ui.root, measureContentHeight);
  } catch {}

  // resize control (reads current state; fresh node = "Off")
  renderResize(node);

  // default width only (configure() restores saved size for loaded nodes)
  if (!node.size || node.size[0] < MIN_W) node.size[0] = DEFAULT_W;

  // initial populate, deferred so configure()'s state lands first
  queueMicrotask(() => refreshListing(node));
}

// ── Pattern #9: inject state into the hidden input at submit time ─────────────
function collectNodes(graph, out) {
  if (!graph) return;
  const nodes = graph._nodes || graph.nodes || [];
  for (const n of nodes) {
    if (n?.comfyClass === COMFY_CLASS) out.push(n);
    if (n?.subgraph) collectNodes(n.subgraph, out);
  }
}
function matchNode(nodes, promptId) {
  let n = nodes.find((x) => String(x.id) === String(promptId));
  if (n) return n;
  const tail = String(promptId).split(":").pop();
  return nodes.find((x) => String(x.id) === tail) || null;
}
function injectState(result) {
  const out = result?.output;
  if (!out) return;
  const lifNodes = [];
  collectNodes(app.graph, lifNodes);
  if (!lifNodes.length) return;
  for (const id in out) {
    const entry = out[id];
    if (!entry || entry.class_type !== COMFY_CLASS) continue;
    const node = matchNode(lifNodes, id);
    if (!node) continue;
    if (!entry.inputs) entry.inputs = {};
    entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify(readState(node));
  }
}
function installGraphToPromptHook() {
  if (app._pixLifGraphPatched) return;
  app._pixLifGraphPatched = true;
  const orig = app.graphToPrompt.bind(app);
  app.graphToPrompt = async function (...args) {
    const result = await orig(...args);
    try {
      injectState(result);
    } catch (e) {
      console.warn("[LoadImagesFolder] graphToPrompt inject failed", e);
    }
    return result;
  };
}

app.registerExtension({
  name: "Pixaroma.LoadImagesFolder",
  setup() {
    installGraphToPromptHook();
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== COMFY_CLASS) return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setupNode(this);
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = origConfigure?.apply(this, arguments);
      stripInputs(this);
      queueMicrotask(() => {
        renderResize(this);
        refreshListing(this);
      });
      return r;
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = origDraw?.apply(this, arguments);
      // legacy-only min-width self-heal (Nodes 2.0 size lives in the Vue layout)
      if (!isVueNodes() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return r;
    };

    nodeType.prototype.onConnectInput = function () {
      return false;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        this._pixLifFloorOff?.();
      } catch {}
      document
        .querySelectorAll(".pix-lif-gallery,.pix-lif-browse-pop,.pix-lif-menu")
        .forEach((p) => p._pixClose?.());
      return origRemoved?.apply(this, arguments);
    };
  },
});
