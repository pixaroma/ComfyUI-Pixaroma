// Prompt Stack Pixaroma - input field wiring (label, textarea).
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

  autoGrow(taEl);
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
    backdrop.className = "pix-ps-confirm-backdrop";

    const box = document.createElement("div");
    box.className = "pix-ps-confirm-box";

    const titleEl = document.createElement("div");
    titleEl.className = "pix-ps-confirm-title";
    titleEl.textContent = title || "Confirm";
    box.appendChild(titleEl);

    if (message) {
      const msgEl = document.createElement("div");
      msgEl.className = "pix-ps-confirm-msg";
      msgEl.textContent = message;
      box.appendChild(msgEl);
    }

    const actions = document.createElement("div");
    actions.className = "pix-ps-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pix-ps-confirm-btn";
    cancelBtn.textContent = cancelText;
    actions.appendChild(cancelBtn);

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "pix-ps-confirm-btn primary";
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
