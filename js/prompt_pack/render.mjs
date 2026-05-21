// Prompt Pack Pixaroma - CSS injection + DOM building.
//
// Layout:
//   .pix-pp-root
//     .pix-pp-tawrap               (textarea wrapper)
//       .pix-pp-ta                 (the textarea)
//     .pix-pp-bottombar            (bottom strip)
//       .pix-pp-actions            (Copy all / Replace / Clear buttons)
//         .pix-pp-actbtn           (each action button)
//       .pix-pp-counter            (small pill on the right)
//
// Paragraph / Line mode pills are NOT in the DOM - they're canvas-
// painted at the slot-row Y by the onDrawForeground hook in index.js
// so the DOM widget body stays compact (mirrors the way Text Pixaroma
// puts its action buttons up on the slot row).

const BRAND = "#f66744";

let _cssInjected = false;
export function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.id = "pix-pp-css";
  style.textContent = `
    .pix-pp-root {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      color: #e0e0e0;
      font: 12px sans-serif;
    }
    /* Paragraph / Line pills are now painted on the canvas at the
       slot-row Y so the DOM widget body stays compact. CSS for them
       lives in the canvas paintPill helper in index.js. */
    .pix-pp-tawrap {
      position: relative;
      flex: 1 1 auto;
      min-height: 100px;
      display: flex;
    }
    .pix-pp-ta {
      flex: 1 1 auto;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: #1d1d1d;
      color: #e0e0e0;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 6px 8px;
      font: 12px monospace;
      resize: none;
      outline: none;
    }
    .pix-pp-ta:focus { border-color: ${BRAND}; }
    .pix-pp-bottombar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: 0 0 auto;
      gap: 8px;
      padding: 0 2px;
    }
    /* Action buttons (Copy all / Replace / Clear). Semi-transparent
       white overlay default so the button blends with whatever node
       colour the user picks. Hover = full BRAND orange fill (not just
       orange border) so the click target is unambiguous. */
    .pix-pp-actions {
      display: flex;
      gap: 4px;
      flex: 0 0 auto;
      /* Stop text selection bleeding from the textarea into the button
         labels when the user drag-selects to the edge of the field. */
      user-select: none;
    }
    .pix-pp-actbtn {
      /* box-sizing: border-box so min-width includes padding + border -
         otherwise content-box adds an extra 26px per button (24 padding
         + 2 border) and the bottom row overflows even at the clamp. */
      box-sizing: border-box;
      /* min-width keeps all three buttons the same size when the label
         briefly changes to "Copied" / "Pasted" so the row never reflows
         under the cursor. 86px fits the widest label ("Copy all") with
         padding included. */
      min-width: 86px;
      user-select: none;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      color: rgba(255, 255, 255, 0.85);
      cursor: pointer;
      font: 11px sans-serif;
      padding: 4px 12px;
      transition: background 0.1s, color 0.1s, border-color 0.1s;
    }
    .pix-pp-actbtn:hover {
      background: ${BRAND};
      border-color: ${BRAND};
      color: #fff;
    }
    .pix-pp-actbtn[disabled] {
      color: rgba(255, 255, 255, 0.3);
      cursor: default;
      background: rgba(255, 255, 255, 0.02);
      border-color: rgba(255, 255, 255, 0.08);
    }
    .pix-pp-actbtn[disabled]:hover {
      background: rgba(255, 255, 255, 0.02);
      border-color: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.3);
    }
    /* Success flash - shown after a successful Copy / Replace. Higher
       specificity (including the hover variant) so the green wins even
       when the mouse is still on the button after the click. Same green
       Show Text Pixaroma uses for its Copy feedback. */
    .pix-pp-actbtn.is-flashing,
    .pix-pp-actbtn.is-flashing:hover {
      background: #3ec371;
      border-color: #3ec371;
      color: #fff;
    }
    .pix-pp-counter {
      font: 10px sans-serif;
      color: rgba(255, 255, 255, 0.6);
      background: rgba(255, 255, 255, 0.05);
      padding: 2px 8px;
      border-radius: 10px;
      user-select: none;
      white-space: nowrap;
    }
    .pix-pp-counter.active {
      color: ${BRAND};
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid ${BRAND};
    }
    .pix-pp-counter.empty {
      color: rgba(255, 255, 255, 0.3);
    }
    /* (Confirm-dialog CSS removed - Clear is now instant per spec.) */
  `;
  document.head.appendChild(style);
}

// Build the static DOM tree. Returns the root element. Pills (Paragraph /
// Line) are NOT in the DOM - they're canvas-painted at the slot-row Y by
// the onDrawForeground hook in index.js. The DOM widget body now holds
// just the textarea + a bottom bar with three action buttons + counter.
export function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-pp-root";

  const tawrap = document.createElement("div");
  tawrap.className = "pix-pp-tawrap";

  const ta = document.createElement("textarea");
  ta.className = "pix-pp-ta";
  ta.placeholder = "Paste your prompts here...\n\nParagraph mode: separate with a blank line.\nLine mode: one prompt per line.";
  ta.spellcheck = false;

  tawrap.appendChild(ta);

  const bottombar = document.createElement("div");
  bottombar.className = "pix-pp-bottombar";

  // Three action buttons on the left of the bottom bar - mirrors Text
  // Pixaroma's button trio but in the bottom row instead of the top.
  const actions = document.createElement("div");
  actions.className = "pix-pp-actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "pix-pp-actbtn";
  copyBtn.textContent = "Copy all";
  copyBtn.title = "Copy the entire textarea content to the clipboard";

  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.className = "pix-pp-actbtn";
  replaceBtn.textContent = "Replace";
  replaceBtn.title = "Replace the textarea with text from the clipboard (image / empty clipboard shows a toast and leaves the text alone)";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "pix-pp-actbtn";
  clearBtn.textContent = "Clear";
  clearBtn.title = "Empty the textarea instantly (no confirm)";
  clearBtn.disabled = true;

  actions.append(copyBtn, replaceBtn, clearBtn);

  const counter = document.createElement("div");
  counter.className = "pix-pp-counter empty";
  counter.textContent = "0 prompts";
  counter.title = "How many prompts are in the box right now. During a run it counts down how many are left.";

  bottombar.appendChild(actions);
  bottombar.appendChild(counter);

  root.appendChild(tawrap);
  root.appendChild(bottombar);

  root._pixPp = { ta, counter, copyBtn, replaceBtn, clearBtn };

  return root;
}

// Apply the current state to the DOM.
//   - Textarea value matches state.text (only if it differs - avoid stomping the caret)
//   - Counter updates via updateCounter()
//   - Clear button enabled state reflects whether there is text to clear
// (Pill active state is canvas-painted; the node re-paints on every
// dirty canvas tick.)
export function applyState(root, state, runState) {
  const els = root._pixPp;
  if (!els) return;
  if (els.ta.value !== state.text) els.ta.value = state.text;
  updateCounter(root, state, runState);
  updateClearButton(root, state);
}

// Update just the counter pill. runState is optional:
//   { running: true, remaining: 3 }    -> "3 left" in orange (counts DOWN
//                                         as workflows finish executing)
//   undefined / null / running:false   -> "N prompts" or "0 prompts"
//
// We use a small inline parse (mirrors core.mjs parsePrompts) so render.mjs
// doesn't depend on core.mjs at module load time.
export function updateCounter(root, state, runState) {
  const els = root._pixPp;
  if (!els || !els.counter) return;
  const text = state?.text || "";
  const mode = state?.mode || "paragraph";
  const splitter = (mode === "line") ? "\n" : /\n\s*\n+/;
  const total = text.split(splitter).map((p) => p.trim()).filter((p) => p.length > 0).length;

  els.counter.classList.remove("active", "empty");
  if (runState && runState.running) {
    els.counter.classList.add("active");
    els.counter.textContent = `${runState.remaining} left`;
  } else if (total === 0) {
    els.counter.classList.add("empty");
    els.counter.textContent = "0 prompts";
  } else {
    els.counter.textContent = `${total} prompt${total === 1 ? "" : "s"}`;
  }
}

// Enable / disable the Clear prompts button based on whether the textarea
// has any content. Avoids accidental clicks on an empty textarea.
export function updateClearButton(root, state) {
  const els = root._pixPp;
  if (!els || !els.clearBtn) return;
  const hasContent = !!(state?.text && state.text.length > 0);
  els.clearBtn.disabled = !hasContent;
}
