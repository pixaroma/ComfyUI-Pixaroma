// Prompt Multi Pixaroma - input field wiring (label, textarea).
// Drag-and-drop reorder lives here too (Task 9). First-time wire confirm too (Task 8).
//
// All input events use stopImmediatePropagation so they don't escape into
// ComfyUI's canvas keybindings (Load Image Pattern #6).

import { setLabel, setText } from "./core.mjs";

export function attachLabelEditor(node, inputEl, rowId) {
  const original = inputEl.value;
  let staged = original;

  const commit = () => {
    if (staged !== inputEl.dataset.committed) {
      setLabel(node, rowId, staged);
      inputEl.dataset.committed = staged;
    }
  };

  inputEl.dataset.committed = original;

  inputEl.addEventListener("input", (e) => {
    e.stopImmediatePropagation();
    staged = inputEl.value;
  });

  inputEl.addEventListener("keydown", (e) => {
    e.stopImmediatePropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      inputEl.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      inputEl.value = inputEl.dataset.committed;
      staged = inputEl.dataset.committed;
      inputEl.blur();
    }
  });

  inputEl.addEventListener("blur", commit);

  // Stop click / pointer events from bubbling into LiteGraph (otherwise
  // clicking the label can deselect the node or start a drag).
  inputEl.addEventListener("pointerdown", (e) => e.stopImmediatePropagation());
  inputEl.addEventListener("mousedown", (e) => e.stopImmediatePropagation());
}

export function attachTextareaEditor(node, taEl, rowId) {
  taEl.dataset.committed = taEl.value;
  let pending = false;

  const commit = () => {
    if (taEl.value !== taEl.dataset.committed) {
      setText(node, rowId, taEl.value);
      taEl.dataset.committed = taEl.value;
    }
    pending = false;
  };

  taEl.addEventListener("input", (e) => {
    e.stopImmediatePropagation();
    autoGrow(taEl);
    // Ask the host node to grow its own height so the rest of the body
    // (Add row button + other rows below) stays inside the node frame.
    if (typeof node._pixPmGrow === "function") node._pixPmGrow();
    // Update the Clear prompts button's enabled state on every keystroke.
    if (typeof node._pixPmRefreshClear === "function") node._pixPmRefreshClear();
    if (!pending) {
      pending = true;
      // Commit on idle (next frame). Cheap and keeps state in sync without
      // re-rendering the row on every keystroke.
      requestAnimationFrame(commit);
    }
  });

  taEl.addEventListener("keydown", (e) => {
    e.stopImmediatePropagation();
  });

  taEl.addEventListener("blur", commit);

  taEl.addEventListener("pointerdown", (e) => e.stopImmediatePropagation());
  taEl.addEventListener("mousedown", (e) => e.stopImmediatePropagation());

  // Defer the initial auto-grow to next frame so the textarea is actually in
  // the DOM (scrollHeight returns 0 for unattached elements). Without this,
  // re-renders (after Add row, etc.) collapse previously-grown textareas back
  // to their CSS min-height because we measured them before layout ran.
  requestAnimationFrame(() => {
    autoGrow(taEl);
    if (typeof node._pixPmGrow === "function") node._pixPmGrow();
  });
}

function autoGrow(ta) {
  // Reset to single line, then grow to scrollHeight up to max-height (CSS cap).
  ta.style.height = "auto";
  const h = Math.min(ta.scrollHeight, 120);
  ta.style.height = h + "px";
}

// pixConfirm: small Pixaroma-themed confirmation dialog. Replaces native
// window.confirm() so the user does not get yanked out to the browser chrome.
// Returns a Promise<boolean>: true = primary action, false = cancel / Esc / backdrop click.
export function pixConfirm({ title, message, okText = "OK", cancelText = "Cancel" } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-pm-confirm-backdrop";

    const box = document.createElement("div");
    box.className = "pix-pm-confirm-box";

    const titleEl = document.createElement("div");
    titleEl.className = "pix-pm-confirm-title";
    titleEl.textContent = title || "Confirm";
    box.appendChild(titleEl);

    if (message) {
      const msgEl = document.createElement("div");
      msgEl.className = "pix-pm-confirm-msg";
      msgEl.textContent = message;
      box.appendChild(msgEl);
    }

    const actions = document.createElement("div");
    actions.className = "pix-pm-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pix-pm-confirm-btn";
    cancelBtn.textContent = cancelText;
    actions.appendChild(cancelBtn);

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "pix-pm-confirm-btn primary";
    okBtn.textContent = okText;
    actions.appendChild(okBtn);

    box.appendChild(actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(val);
    };

    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); finish(true); }
    };
    window.addEventListener("keydown", onKey, true);

    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) finish(false);
    });
    cancelBtn.addEventListener("click", () => finish(false));
    okBtn.addEventListener("click", () => finish(true));

    // Focus the OK button so Enter works immediately; backspace-safe because
    // both buttons handle their own keys via the global keydown listener.
    queueMicrotask(() => okBtn.focus());
  });
}


// Drag-to-reorder rows.
//
// Uses the HTML5 drag-and-drop API. The drag image is the row itself (default).
// On dragover we compute whether the cursor is in the top or bottom half of
// the target row and add a visual indicator (orange line via CSS class).
// On drop we move the dragged row to the new index and re-render.
//
// dragState is module-scoped so handlers attached to multiple rows share state.

const _drag = { id: null };

export function attachDragHandlers(node, rowEl, rowId, onDrop) {
  rowEl.addEventListener("dragstart", (e) => {
    // Don't initiate drag if the event target is an input/textarea/button.
    // This protects native text-selection and click behavior in the row's
    // controls (label input, textarea, ON pill, X delete).
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "button") {
      e.preventDefault();
      return;
    }
    _drag.id = rowId;
    rowEl.classList.add("is-dragging");
    try { e.dataTransfer.effectAllowed = "move"; } catch (_) {}
    try { e.dataTransfer.setData("text/plain", rowId); } catch (_) {}
  });

  rowEl.addEventListener("dragover", (e) => {
    if (!_drag.id || _drag.id === rowId) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
    const rect = rowEl.getBoundingClientRect();
    const isAbove = (e.clientY - rect.top) < rect.height / 2;
    rowEl.classList.toggle("is-drop-target-above", isAbove);
    rowEl.classList.toggle("is-drop-target-below", !isAbove);
  });

  rowEl.addEventListener("dragleave", () => {
    rowEl.classList.remove("is-drop-target-above");
    rowEl.classList.remove("is-drop-target-below");
  });

  rowEl.addEventListener("drop", (e) => {
    if (!_drag.id || _drag.id === rowId) return;
    e.preventDefault();
    const above = rowEl.classList.contains("is-drop-target-above");
    rowEl.classList.remove("is-drop-target-above");
    rowEl.classList.remove("is-drop-target-below");
    onDrop(_drag.id, rowId, above);
    _drag.id = null;
  });

  rowEl.addEventListener("dragend", () => {
    rowEl.classList.remove("is-dragging");
    _drag.id = null;
    // Defensive: clear any leftover indicators on siblings.
    const siblings = rowEl.parentElement?.querySelectorAll(".pix-pm-row") || [];
    siblings.forEach((s) => {
      s.classList.remove("is-drop-target-above");
      s.classList.remove("is-drop-target-below");
      s.classList.remove("is-dragging");
    });
  });
}
