// Prompt Stack Pixaroma - DOM widget render.
//
// Builds a root <div> for the node body containing one row per state entry +
// an "+ Add row" button. Each row is its own <div> with controls.
// Click handlers and drag handlers are wired in interaction.mjs (Task 5+).

import { readState } from "./core.mjs";
import { attachLabelEditor, attachTextareaEditor } from "./interaction.mjs";

const CSS_ID = "pix-prompt-stack-css";

const CSS = `
.pix-ps-root {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px 8px 8px;
  box-sizing: border-box;
  font-family: inherit;
  color: #ddd;
}

.pix-ps-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px;
  border-radius: 4px;
  background: #232323;
  border: 1px solid #2e2e2e;
  position: relative;
  transition: opacity 0.12s ease;
}
.pix-ps-row.is-disabled { opacity: 0.45; }
.pix-ps-row.is-dragging { opacity: 0.4; }
.pix-ps-row.is-drop-target-above { box-shadow: 0 -2px 0 0 #f66744; }
.pix-ps-row.is-drop-target-below { box-shadow: 0 2px 0 0 #f66744; }

.pix-ps-row-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
}

.pix-ps-handle {
  cursor: grab;
  color: #888;
  font-size: 14px;
  line-height: 14px;
  user-select: none;
  padding: 0 2px;
  letter-spacing: -2px;
}
.pix-ps-handle:active { cursor: grabbing; }
.pix-ps-handle:hover { color: #ccc; }

.pix-ps-toggle {
  min-width: 32px;
  height: 18px;
  border-radius: 9px;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  cursor: pointer;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 600;
  color: #888;
  letter-spacing: 0.5px;
  padding: 0 6px;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  user-select: none;
}
.pix-ps-toggle:hover {
  border-color: #555;
  color: #ccc;
}
.pix-ps-toggle.on {
  background: #f66744;
  border-color: #f66744;
  color: #fff;
}
.pix-ps-toggle.on:hover {
  filter: brightness(1.08);
  color: #fff;
}

.pix-ps-label {
  flex: 1;
  background: #1a1a1a;
  border: 1px solid #2e2e2e;
  border-radius: 3px;
  color: #ddd;
  font-size: 11px;
  padding: 2px 6px;
  outline: none;
  min-width: 0;
}
.pix-ps-label:focus { border-color: #f66744; }
.pix-ps-label::placeholder { color: #666; font-style: italic; }

.pix-ps-delete {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 14px;
  line-height: 14px;
  flex-shrink: 0;
  padding: 0;
}
.pix-ps-delete:hover { color: #f66744; background: rgba(246,103,68,0.12); }
.pix-ps-delete:disabled { color: #444; cursor: not-allowed; background: transparent; }

.pix-ps-textarea {
  width: 100%;
  min-height: 38px;
  max-height: 120px;
  resize: none;
  background: #1a1a1a;
  border: 1px solid #2e2e2e;
  border-radius: 3px;
  color: #ddd;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 4px 6px;
  outline: none;
  box-sizing: border-box;
  overflow-y: auto;
}
.pix-ps-textarea:focus { border-color: #f66744; }

.pix-ps-add {
  align-self: flex-start;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 3px;
  color: #ddd;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
  margin-top: 4px;
}
.pix-ps-add:hover { background: #333; border-color: #f66744; color: #f66744; }

.pix-ps-confirm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  font-family: inherit;
  -webkit-font-smoothing: antialiased;
}
.pix-ps-confirm-box {
  background: #1d1d1d;
  border: 1px solid #2e2e2e;
  border-radius: 6px;
  min-width: 320px;
  max-width: 480px;
  padding: 18px 20px;
  color: #ddd;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}
.pix-ps-confirm-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  margin: 0 0 8px 0;
}
.pix-ps-confirm-msg {
  font-size: 13px;
  color: #bbb;
  margin: 0 0 16px 0;
  line-height: 1.4;
}
.pix-ps-confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.pix-ps-confirm-btn {
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 3px;
  color: #ddd;
  cursor: pointer;
  font-size: 12px;
  padding: 6px 14px;
  font-family: inherit;
}
.pix-ps-confirm-btn:hover { background: #333; border-color: #555; }
.pix-ps-confirm-btn.primary {
  background: #f66744;
  border-color: #f66744;
  color: #fff;
}
.pix-ps-confirm-btn.primary:hover { background: #ff7a58; border-color: #ff7a58; }
`;

export function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const el = document.createElement("style");
  el.id = CSS_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-ps-root";
  return root;
}

// measureContentHeight: sum of each child's offsetHeight (not root.scrollHeight,
// because ComfyUI stretches root.offsetHeight which would create a feedback
// loop). Adds CSS row-gap between children + root's vertical padding.
// Used by getMinHeight so the DOM widget can ask ComfyUI for the right amount
// of vertical space as rows are added or removed.
export function measureContentHeight(root) {
  if (!root) return 120;
  let h = 0;
  let count = 0;
  for (const child of root.children) {
    if (child.offsetParent === null) continue;
    h += child.offsetHeight;
    count += 1;
  }
  const cs = getComputedStyle(root);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;
  if (count > 1) h += gap * (count - 1);
  h += parseFloat(cs.paddingTop) || 0;
  h += parseFloat(cs.paddingBottom) || 0;
  return Math.max(120, h);
}

// renderRows clears root.innerHTML and rebuilds every row.
// Returns nothing; mutates root.
// rowHandlers is an object with callbacks the interaction module wires up:
//   { onToggleEnabled(id), onLabelChange(id, val), onTextChange(id, val),
//     onDelete(id), onAdd(),
//     onDragStart(id, ev), onDragOver(id, ev), onDrop(id, ev), onDragEnd(ev) }
export function renderRows(node, root, rowHandlers) {
  const state = readState(node);
  root.innerHTML = "";

  for (const row of state.rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "pix-ps-row" + (row.enabled ? "" : " is-disabled");
    rowEl.dataset.id = row.id;
    rowEl.draggable = true;

    const head = document.createElement("div");
    head.className = "pix-ps-row-head";

    const handle = document.createElement("span");
    handle.className = "pix-ps-handle";
    handle.textContent = "⋮⋮"; // two vertical ellipses
    handle.title = "Drag to reorder";
    head.appendChild(handle);

    const toggle = document.createElement("div");
    toggle.className = "pix-ps-toggle" + (row.enabled ? " on" : "");
    toggle.textContent = row.enabled ? "ON" : "OFF";
    toggle.title = row.enabled ? "Click to mute this row" : "Click to include this row";
    toggle.addEventListener("click", () => rowHandlers.onToggleEnabled(row.id));
    head.appendChild(toggle);

    const label = document.createElement("input");
    label.type = "text";
    label.className = "pix-ps-label";
    label.value = row.label || "";
    label.placeholder = `Row ${state.rows.indexOf(row) + 1}`;
    head.appendChild(label);
    attachLabelEditor(node, label, row.id);

    const del = document.createElement("button");
    del.className = "pix-ps-delete";
    del.type = "button";
    del.textContent = "✕";
    del.title = "Delete row";
    del.disabled = state.rows.length <= 1;
    del.addEventListener("click", () => rowHandlers.onDelete(row.id));
    head.appendChild(del);

    rowEl.appendChild(head);

    const ta = document.createElement("textarea");
    ta.className = "pix-ps-textarea";
    ta.value = row.text || "";
    ta.rows = 2;
    ta.placeholder = "Type your prompt chunk here...";
    rowEl.appendChild(ta);
    attachTextareaEditor(node, ta, row.id);

    root.appendChild(rowEl);
  }

  const add = document.createElement("button");
  add.className = "pix-ps-add";
  add.type = "button";
  add.textContent = "+ Add row";
  add.addEventListener("click", () => rowHandlers.onAdd());
  root.appendChild(add);
}
