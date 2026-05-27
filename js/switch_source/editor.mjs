// Switch Source Pixaroma - inline DOM editor to rename a row.
// Mirrors the Switch label editor, but the click target is the OUTPUT label.
// Commit writes state.labels[rowIdx] + the output slot label; an empty value
// reverts the row to its auto label (type / "out r").

import { app } from "/scripts/app.js";
import { readState, writeState, updateOutputLabels } from "./core.mjs";

let activeEditor = null; // module singleton

export function cancelEditorForNode(node) {
  if (activeEditor && activeEditor.node === node) activeEditor.cleanup();
}

export function openLabelEditor(node, rowIdx1, rect) {
  if (activeEditor) activeEditor.cleanup();

  const state = readState(node);
  const input = document.createElement("input");
  input.type = "text";
  input.value = state.labels?.[rowIdx1] || "";
  input.placeholder = "row name";

  const scale = app.canvas?.ds?.scale || 1;
  Object.assign(input.style, {
    position: "fixed",
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${Math.max(40, rect.w)}px`,
    height: `${rect.h}px`,
    boxSizing: "border-box",
    background: "#1d1d1d",
    color: "#fff",
    border: "1px solid #f66744",
    borderRadius: "3px",
    padding: `0 ${Math.max(2, Math.round(4 * scale))}px`,
    font: `${Math.max(9, Math.round(12 * scale))}px 'Segoe UI', -apple-system, sans-serif`,
    textAlign: "right",
    zIndex: "99999",
    outline: "none",
  });
  document.body.appendChild(input);

  function commit() {
    const v = input.value.trim();
    const st = readState(node);
    if (!st.labels) st.labels = {};
    if (v) st.labels[rowIdx1] = v;
    else delete st.labels[rowIdx1];
    writeState(node, st);
    updateOutputLabels(node);
    node.graph?.setDirtyCanvas?.(true, true);
    cleanup();
  }

  function cleanup() {
    if (!activeEditor) return;
    window.removeEventListener("keydown", onKey, true);
    input.removeEventListener("blur", commit);
    if (input.parentNode) input.parentNode.removeChild(input);
    activeEditor = null;
  }

  function onKey(e) {
    // Capture + stopImmediatePropagation so Ctrl+Z / Enter / Esc don't escape
    // to ComfyUI's canvas while typing.
    e.stopImmediatePropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cleanup(); }
  }

  input.addEventListener("blur", commit);
  // Defer focus + listener install so the opening mousedown doesn't ghost-blur
  // the input (same pattern as Switch's editor).
  setTimeout(() => {
    window.addEventListener("keydown", onKey, true);
    input.focus();
    input.select();
  }, 0);

  activeEditor = { node, cleanup };
}
