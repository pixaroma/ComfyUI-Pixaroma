// Inline label editor for Mute Switch Pixaroma rows.
//
// Spawns a transient DOM <input type="text"> overlaid on the canvas at the
// row's label area. Only one editor is open at a time (module-level singleton).
//
// Behaviour:
//   Enter / blur -> commit: saves value to state.rows[slotIdx1-1].label;
//                           empty value clears the label (null).
//   Esc          -> cancel: no change.
//   Opening another editor auto-commits the previous one.

import { app } from "/scripts/app.js";
import { installGraphUndoGuard } from "../shared/graph_undo_guard.mjs";

const STATE_PROP = "muteSwitchState";
const BRAND = "#f66744";

let activeEditor = null;

function commit(state) {
  if (!state || state._committed) return;
  state._committed = true;
  const { node, slotIdx, input } = state;
  if (!input.isConnected) { cleanup(state); return; }
  const value = input.value.trim();
  const ms = node.properties[STATE_PROP];
  if (ms && ms.rows && ms.rows[slotIdx - 1]) {
    ms.rows[slotIdx - 1].label = value || null;
  }
  cleanup(state);
  node.graph?.setDirtyCanvas?.(true, true);
}

function cancel(state) {
  if (!state || state._committed) return;
  state._committed = true;
  cleanup(state);
}

function cleanup(state) {
  if (!state) return;
  if (state.windowKeyHandler) {
    window.removeEventListener("keydown", state.windowKeyHandler, true);
  }
  if (state.blurHandler) state.input.removeEventListener("blur", state.blurHandler);
  state.input.remove();
  // Release the graph-undo guard so Ctrl+Z works normally on the canvas
  // again after the editor closes.
  if (state.undoGuardOff) {
    state.undoGuardOff();
    state.undoGuardOff = null;
  }
  if (activeEditor === state) activeEditor = null;
}

export function openLabelEditor(node, slotIdx, rect) {
  if (activeEditor) commit(activeEditor);

  const initial = node.properties?.[STATE_PROP]?.rows?.[slotIdx - 1]?.label || "";

  // Floor the font + padding so the editor stays usable at low zoom (LG
  // can go as low as 0.25, which would otherwise render 3px text).
  const scale = app.canvas?.ds?.scale || 1;
  const fontPx = Math.max(11, 12 * scale);
  const padX = Math.max(4, 6 * scale);
  const borderPx = Math.max(1, 2 * scale);

  const input = document.createElement("input");
  input.type = "text";
  input.value = initial;
  input.placeholder = "Label";
  input.style.cssText = [
    "position: fixed",
    `left: ${rect.x}px`,
    `top: ${rect.y}px`,
    `width: ${rect.w}px`,
    `height: ${rect.h}px`,
    "z-index: 10000",
    "background: #1f1f1f",
    "color: #d8d8d8",
    `border: ${borderPx}px solid ${BRAND}`,
    "border-radius: 3px",
    `padding: 0 ${padX}px`,
    `font: ${fontPx}px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`,
    "outline: none",
    "box-sizing: border-box",
    "line-height: 1",
  ].join("; ");

  document.body.appendChild(input);

  const state = { node, slotIdx, input, _committed: false };

  state.windowKeyHandler = (e) => {
    if (e.target !== input) return;
    e.stopImmediatePropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit(state);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel(state);
    }
  };
  state.blurHandler = () => commit(state);

  window.addEventListener("keydown", state.windowKeyHandler, true);

  // Vue Compat #6: install the shared graph-undo guard while the input is
  // open. Without it, Ctrl+Z inside the input would escape to ComfyUI's
  // Vue undo (via requestAnimationFrame-scheduled loadGraphData) and could
  // tear the underlying node out from under us. The guard self-heals and
  // is reference-counted so multiple Mute Switch labels (or any other
  // editor) can be open simultaneously.
  state.undoGuardOff = installGraphUndoGuard(() => input.isConnected);

  activeEditor = state;

  setTimeout(() => {
    if (!input.isConnected) return;
    input.focus();
    input.select();
    input.addEventListener("blur", state.blurHandler);
  }, 0);
}

export function cancelEditorForNode(node) {
  if (activeEditor && activeEditor.node === node) {
    cancel(activeEditor);
  }
}
