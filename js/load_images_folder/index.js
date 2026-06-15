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
import { listFolder, pickNativeFolder } from "./api.mjs";
import {
  injectCSS,
  buildRoot,
  openPickGallery,
  openBrowsePopup,
  openMiniMenu,
} from "./ui.mjs";
import { buildModePanel, injectResizePanelCSS } from "../shared/resize_panel.mjs";

const MIN_W = 280;
const DEFAULT_W = 370; // wide enough for the 6 resize quick-pick chips (e.g. MP) on one line

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

// Refit the node height to its content (after the resize panel expands/collapses).
// Mirrors Image Resize's refit. Self-gates on isGraphLoading so it can be called
// freely without dirtying a saved workflow on load (Vue Compat #18). rAF so the
// freshly added/removed panel has laid out before we measure via computeSize.
function refit(node) {
  if (!node._pixLifUI) return;
  requestAnimationFrame(() => {
    if (!node._pixLifUI || isGraphLoading()) return;
    const sz = node.computeSize?.();
    if (sz && Math.abs(node.size[1] - sz[1]) > 1) {
      // setSize() is the official resize path; it sticks in both renderers
      // (a bare node.size[1] write can be reverted across a renderer switch).
      if (node.setSize) node.setSize([node.size[0], sz[1]]);
      else node.size[1] = sz[1];
      node.setDirtyCanvas?.(true, true);
    }
  });
}

// Normalize a folder path: backslash -> forward slash, trim, drop a trailing
// slash (but keep a bare drive root as "X:/"). Makes native-dialog returns
// (backslashes on Windows) compare cleanly against typed/pasted paths.
function normalizePath(p) {
  if (!p) return "";
  let s = String(p).trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:$/.test(s)) s += "/"; // "D:" -> "D:/"
  return s;
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
  const myReq = (node._pixLifListReq = (node._pixLifListReq || 0) + 1);
  const res = await listFolder(state.folder, state.recursive);
  // a newer refresh superseded this one (e.g. paste + blur), or the node was
  // removed while the fetch was in flight - drop this stale response.
  if (node._pixLifListReq !== myReq || !node._pixLifUI) return;
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
  const normalized = normalizePath(folder);
  const st = readState(node);
  const changed = (st.folder || "") !== normalized;
  st.folder = normalized;
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
      () => {
        node.setDirtyCanvas?.(true, true);
        refit(node); // some panels (e.g. match-ratio crop/pad) change height
      },
      "loadImagesFolderState",
      { oneLine: true }
    );
    if (panel) slot.appendChild(panel);
  }
  node.setDirtyCanvas?.(true, true);
  refit(node); // grow/shrink the node to fit the (possibly changed) panel
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
    // Coarse-round and NO getMaxHeight: a live getMaxHeight tied to a DOM
    // measurement can creep node.size on load (Vue Compat #18). getMinHeight
    // floors the node; refit() fits the exact height on user actions.
    getMinHeight: () => Math.round(measureContentHeight(ui.root) / 4) * 4,
    serialize: false,
  });
  applyAdaptiveCanvasOnly(widget);
  node._pixLifWidget = widget;
  if (isVueNodes()) {
    widget.computeLayoutSize = () => ({
      // coarse-round so sub-pixel/font jitter can't creep node.size on switch
      minHeight: Math.round(measureContentHeight(ui.root) / 4) * 4,
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
  // 'change' only fires on blur. A paste (Ctrl+V) should list immediately
  // without needing to click away first; typing still commits on blur or when
  // clicking Pick images.
  ui.folderInput.addEventListener("paste", () => {
    setTimeout(() => {
      const v = ui.folderInput.value.trim();
      if (normalizePath(v) !== (readState(node).folder || "")) setFolder(node, v);
    }, 0);
  });
  ui.browseBtn.addEventListener("click", async () => {
    const start = readState(node).folder || "";
    // Try the native OS folder dialog first (real dialog, real path, no copying).
    // Fall back to the in-app browser when it isn't available (non-Windows /
    // remote / error). A cancel just does nothing.
    const lbl = ui.browseLbl;
    const prev = lbl ? lbl.textContent : "";
    ui.browseBtn.disabled = true;
    if (lbl) lbl.textContent = "Opening…";
    let res;
    try {
      res = await pickNativeFolder(start);
    } catch {
      res = { ok: false };
    }
    ui.browseBtn.disabled = false;
    if (lbl) lbl.textContent = prev || "Browse";
    if (res && res.ok && res.path) {
      await setFolder(node, res.path);
      return;
    }
    if (res && res.cancelled) return; // user closed the native dialog
    openBrowsePopup(node, ui.browseBtn, {
      startPath: start,
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

  // default width on a FRESH drop only; on workflow load, leave the width for
  // configure() to restore (so a user-resized node keeps its saved width and we
  // don't dirty it — Vue Compat #18). LiteGraph's title-driven default is wider
  // than MIN_W, so this set (not a < MIN_W guard) is what actually applies it.
  if (!node.size) node.size = [DEFAULT_W, 200];
  if (!isGraphLoading()) node.size[0] = DEFAULT_W;

  // initial populate, deferred so configure()'s state lands first
  queueMicrotask(() => refreshListing(node));
}

// ── Pattern #9: inject state into the hidden input at submit time ─────────────
function collectNodes(graph, out) {
  if (!graph) return;
  const nodes = graph._nodes || graph.nodes || [];
  for (const n of nodes) {
    if (n?.comfyClass === COMFY_CLASS) out.push(n);
    // subgraph nodes expose their inner graph under different names by version
    const inner = n?.subgraph || n?.graph || n?._graph;
    if (inner && inner !== graph) collectNodes(inner, out);
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

    // Belt-and-braces with onDrawForeground (convention #7): onResize stops the
    // drag at MIN_W so the frame is never drawn narrower than the content.
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      if (!isVueNodes() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return origResize?.apply(this, arguments);
    };

    nodeType.prototype.onConnectInput = function () {
      return false;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        this._pixLifFloorOff?.();
      } catch {}
      // Close only THIS node's popups - deleting one node must not close another
      // node's open gallery. Menus are transient, so a global sweep is fine.
      this._pixLifGallery?._pixClose?.();
      this._pixLifBrowsePop?._pixClose?.();
      document.querySelectorAll(".pix-lif-menu").forEach((p) => p._pixClose?.());
      return origRemoved?.apply(this, arguments);
    };
  },
});
