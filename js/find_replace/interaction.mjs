// Find & Replace Pixaroma - field editors, drag-reorder, themed confirm.
//
// All input events use stopImmediatePropagation so they don't escape into
// ComfyUI's canvas keybindings. Enter inserts a newline (find/replace values
// may legitimately contain newlines), so it is NOT intercepted.

import { setFind, setReplace } from "./core.mjs";

function autoGrow(ta) {
  // Empty field: pin to one line. Do NOT grow for the wrapped PLACEHOLDER -
  // when the node is narrow the placeholder ("find...") wraps to many lines and
  // scrollHeight balloons, leaving the field tall (and it wouldn't shrink back
  // when the node is widened, since autoGrow only runs on input). Only real
  // typed content grows the field.
  if (!ta.value) { ta.style.height = "30px"; return; }
  ta.style.height = "auto";
  ta.style.height = Math.max(30, Math.min(ta.scrollHeight, 120)) + "px";
}

// Re-measure every find/replace field in a root. Called from a width-change
// ResizeObserver so a field that grew (its content wrapped) at a narrow width
// shrinks back when the node is widened.
export function autoGrowAllFields(root) {
  if (!root) return;
  root.querySelectorAll(".pix-fr-field").forEach((ta) => autoGrow(ta));
}

// which = "find" | "replace"
export function attachFieldEditor(node, taEl, ruleId, which) {
  taEl.dataset.committed = taEl.value;
  let pending = false;

  const commit = () => {
    if (taEl.value !== taEl.dataset.committed) {
      if (which === "find") setFind(node, ruleId, taEl.value);
      else setReplace(node, ruleId, taEl.value);
      taEl.dataset.committed = taEl.value;
    }
    pending = false;
  };

  taEl.addEventListener("input", (e) => {
    e.stopImmediatePropagation();
    autoGrow(taEl);
    // Commit the keystroke to state synchronously so the next read is current.
    if (which === "find") setFind(node, ruleId, taEl.value);
    else setReplace(node, ruleId, taEl.value);
    taEl.dataset.committed = taEl.value;
    if (which === "replace") taEl.classList.toggle("is-delete", !taEl.value);
    // Coalesce the (relatively heavy) preview recompute + Reset state + node
    // grow into ONE rAF per frame, so holding a key down doesn't recompute the
    // word-diff on every keystroke.
    if (!pending) {
      pending = true;
      requestAnimationFrame(() => {
        node._pixFrRefreshPreview?.();
        node._pixFrRefreshReset?.();
        node._pixFrGrow?.();
        pending = false;
      });
    }
  });

  taEl.addEventListener("keydown", (e) => {
    // Let Ctrl/Cmd+Enter bubble to ComfyUI's "run workflow" shortcut.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return;
    e.stopImmediatePropagation();
  });

  taEl.addEventListener("blur", commit);
  taEl.addEventListener("pointerdown", (e) => e.stopImmediatePropagation());
  taEl.addEventListener("mousedown", (e) => e.stopImmediatePropagation());

  // Defer the initial auto-grow so the textarea is in the DOM (scrollHeight is
  // 0 for unattached elements). Without this, re-renders collapse grown fields.
  requestAnimationFrame(() => autoGrow(taEl));
}

// pixConfirm: Pixaroma-themed confirm dialog (no native window.confirm()).
// Returns Promise<boolean>.
export function pixConfirm({ title, message, okText = "OK", cancelText = "Cancel" } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-fr-confirm-backdrop";

    const box = document.createElement("div");
    box.className = "pix-fr-confirm-box";

    const titleEl = document.createElement("div");
    titleEl.className = "pix-fr-confirm-title";
    titleEl.textContent = title || "Confirm";
    box.appendChild(titleEl);

    if (message) {
      const msgEl = document.createElement("div");
      msgEl.className = "pix-fr-confirm-msg";
      msgEl.textContent = message;
      box.appendChild(msgEl);
    }

    const actions = document.createElement("div");
    actions.className = "pix-fr-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pix-fr-confirm-btn";
    cancelBtn.textContent = cancelText;
    actions.appendChild(cancelBtn);

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "pix-fr-confirm-btn primary";
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
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) finish(false); });
    cancelBtn.addEventListener("click", () => finish(false));
    okBtn.addEventListener("click", () => finish(true));
    queueMicrotask(() => okBtn.focus());
  });
}

// Drag-to-reorder rows. The HANDLE is the drag source, not the row (so dragging
// inside a textarea selects text normally). Mirrors Prompt Stack.
const _drag = { id: null };

export function attachDragHandlers(node, rowEl, rowId, onDrop) {
  rowEl.addEventListener("dragstart", (e) => {
    if (!e.target.closest || !e.target.closest(".pix-fr-handle")) {
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
    const siblings = rowEl.parentElement?.querySelectorAll(".pix-fr-row") || [];
    siblings.forEach((s) => {
      s.classList.remove("is-drop-target-above");
      s.classList.remove("is-drop-target-below");
      s.classList.remove("is-dragging");
    });
  });
}
