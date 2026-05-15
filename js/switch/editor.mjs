// Inline label editor for Switch Pixaroma rows.
//
// Spawns a transient DOM <input type="text"> overlaid on the canvas at the
// row's label area. Only one editor is open at a time (module-level singleton).
//
// Usage:
//   openLabelEditor(node, slotIdx1, rect)
//     node      - the LiteGraph node
//     slotIdx1  - 1-based slot index
//     rect      - { x, y, w, h } in viewport pixels (from labelScreenRect)
//
// Behaviour:
//   Enter / blur -> commit: saves value to node.properties.switchState.labels[slotIdx1];
//                           empty value deletes the entry.
//   Esc          -> cancel: no change.
//   Opening another editor auto-commits the previous one.

const STATE_PROP = "switchState";
const BRAND = "#f66744";

let activeEditor = null; // module-level singleton

function commit(state) {
  if (!state || state._committed) return;
  state._committed = true;
  const { node, slotIdx, input } = state;
  if (!input.isConnected) { cleanup(state); return; }
  const value = input.value.trim();
  const sw = node.properties[STATE_PROP] || (node.properties[STATE_PROP] = {});
  if (!sw.labels) sw.labels = {};
  if (value) sw.labels[slotIdx] = value;
  else delete sw.labels[slotIdx];
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
  if (activeEditor === state) activeEditor = null;
}

// rect: { x, y, w, h } in viewport pixels.
export function openLabelEditor(node, slotIdx /* 1-based */, rect) {
  // Close any previously open editor with an implicit commit.
  if (activeEditor) commit(activeEditor);

  const initial = node.properties?.[STATE_PROP]?.labels?.[slotIdx] || "";

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
    `border: 2px solid ${BRAND}`,
    "border-radius: 3px",
    "padding: 0 6px",
    "font: 12px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
    "outline: none",
    "box-sizing: border-box",
    "line-height: 1",
  ].join("; ");

  document.body.appendChild(input);

  const state = { node, slotIdx, input, _committed: false };

  // Window-capture keydown handler: fires BEFORE ComfyUI's canvas listeners
  // so Ctrl+Z (undo), arrow keys, R/T (rotate/move shortcuts), etc. cannot
  // escape to the canvas while the user is typing a label.
  // Only intercepts events whose target is our input element.
  // (CLAUDE.md Note Pixaroma Pattern #5 / Load Image Pixaroma Pattern #6)
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

  // blur fires when the user clicks away or tabs out - treat as a commit.
  state.blurHandler = () => commit(state);

  // The window-level capture handler attaches immediately so Ctrl+Z and other
  // canvas shortcuts are blocked from the very first keystroke.
  window.addEventListener("keydown", state.windowKeyHandler, true); // capture phase

  activeEditor = state;

  // Defer focus AND blur listener install. The mouseDown event that opened us
  // is still propagating through LiteGraph / ComfyUI / Vue when this function
  // returns. If we call input.focus() synchronously, that propagation path
  // shifts focus back to the canvas, which fires blur on our input, which
  // calls commit() and removes the input - all within the same tick, so the
  // user never sees anything.
  //
  // setTimeout(0) lets the current event loop tick finish (the mouseDown chain
  // fully resolves) before we grab focus. The blur listener is also deferred
  // so it only catches genuine user-clicks-elsewhere events, not the ghost
  // blur caused by the propagating click.
  setTimeout(() => {
    if (!input.isConnected) return; // commit/cancel already removed us
    input.focus();
    input.select();
    input.addEventListener("blur", state.blurHandler);
  }, 0);
}

// Cancel the open label editor for a specific node, if any.
// Called from onRemoved in index.js so that deleting a node while its
// label editor is open removes the dangling DOM <input>.
export function cancelEditorForNode(node) {
  if (activeEditor && activeEditor.node === node) {
    cancel(activeEditor);
  }
}
