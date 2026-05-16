import { app } from "/scripts/app.js";
import { readState, restoreFromProperties, addRow, deleteRow, toggleEnabled } from "./core.mjs";
import { injectCSS, buildRoot, renderRows, measureContentHeight } from "./render.mjs";
import { pixConfirm } from "./interaction.mjs";

const DEFAULT_W = 400;
const DEFAULT_H = 280;

function removeAllWireSlots(node) {
  if (!node.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    const inp = node.inputs[i];
    if (inp && typeof inp.name === "string" && inp.name.startsWith("wire_")) {
      node.removeInput(i);
    }
  }
}

// growNodeToContent: after a rerender that added rows, ask ComfyUI to recompute
// the node's natural size. If the content's required height grew past the
// current node.size[1], lift the node taller. Never shrinks the node (so a
// user-resized-bigger node stays the size they chose).
function growNodeToContent(node) {
  if (!node || typeof node.computeSize !== "function") return;
  const computed = node.computeSize();
  if (Array.isArray(computed) && computed[1] > node.size[1]) {
    node.size[1] = computed[1];
  }
}

function makeHandlers(node, root) {
  const rerender = () => {
    renderRows(node, root, handlers);
    requestAnimationFrame(() => {
      growNodeToContent(node);
      node.setDirtyCanvas(true, true);
    });
  };
  const handlers = {
    onToggleEnabled: (id) => { toggleEnabled(node, id); rerender(); },
    onToggleWire: (_id) => { /* Task 8 */ },
    onLabelChange: (_id, _v) => { /* Task 5 */ },
    onTextChange: (_id, _v) => { /* Task 5 */ },
    onDelete: async (id) => {
      const state = readState(node);
      const row = state.rows.find((r) => r.id === id);
      const hasContent = row && ((row.text && row.text.trim()) || (row.label && row.label.trim()));
      if (hasContent) {
        const labelOrIdx = (row.label && row.label.trim()) || `Row ${state.rows.indexOf(row) + 1}`;
        const ok = await pixConfirm({
          title: "Delete row?",
          message: `Are you sure you want to delete "${labelOrIdx}"?`,
          okText: "Delete",
          cancelText: "Cancel",
        });
        if (!ok) return;
      }
      deleteRow(node, id);
      rerender();
    },
    onAdd: () => { addRow(node); rerender(); },
    onDragStart: (_id, _ev) => { /* Task 9 */ },
    onDragOver: (_id, _ev) => { /* Task 9 */ },
    onDrop: (_id, _ev) => { /* Task 9 */ },
    onDragEnd: (_ev) => { /* Task 9 */ },
  };
  return { handlers, rerender };
}

app.registerExtension({
  name: "Pixaroma.PromptStack",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptStack") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;
      queueMicrotask(() => {
        injectCSS();
        removeAllWireSlots(node);
        restoreFromProperties(node);

        const root = buildRoot();
        const { handlers, rerender } = makeHandlers(node, root);
        node._pixPsRoot = root;
        node._pixPsRerender = rerender;

        node.addDOMWidget("promptstack", "div", root, {
          serialize: false,
          canvasOnly: true,
          getMinHeight: () => measureContentHeight(root),
        });

        rerender();

        if (node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
        if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      if (this._pixPsRerender) this._pixPsRerender();
      return r;
    };
  },
});

// app.graphToPrompt hook - injects state + resolved separator into the hidden
// PromptStackState input at workflow-submit time. Pattern #9 (Vue Frontend
// Compatibility). Subgraph-safe via tail-id matching.
const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const sep = resolveSeparator();
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPromptStack") continue;
        // Tail-id matching: find the node by id suffix (subgraphs prefix the id with "x:y:")
        const nodeId = parseInt(String(key).split(":").pop(), 10);
        const node = app.graph?.getNodeById?.(nodeId);
        if (!node) continue;
        const state = node.properties?.promptStackState;
        if (!state || !Array.isArray(state.rows)) continue;
        const payload = JSON.stringify({
          version: 1,
          rows: state.rows.map((r) => ({
            enabled: !!r.enabled,
            wireMode: !!r.wireMode,
            wireIndex: r.wireIndex ?? null,
            label: r.label || "",
            text: r.text || "",
          })),
          separator: sep,
        });
        entry.inputs = entry.inputs || {};
        entry.inputs.PromptStackState = payload;
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptStack: graphToPrompt hook failed", err);
  }
  return result;
};

function resolveSeparator() {
  // Task 7 replaces this with a real settings lookup. For now: default.
  return ", ";
}
