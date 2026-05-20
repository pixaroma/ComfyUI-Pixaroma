// Prompt Pack Pixaroma - event wiring.
//
// Hooks up the textarea + the three bottom action buttons (Copy all /
// Replace / Clear) to state mutations + counter updates. All real state
// changes go through core.mjs helpers; this module is just glue between
// DOM events and the state layer. The Paragraph / Line pill toggle lives
// on the canvas now and is wired in index.js (onDrawForeground +
// onMouseDown on the nodeType prototype).

import { app } from "/scripts/app.js";
import { setText, readState } from "./core.mjs";
import { applyState, updateCounter, updateClearButton } from "./render.mjs";

function flashBtnText(btn, label) {
  const orig = btn.textContent;
  btn.textContent = label;
  // Add the green-flash class. CSS overrides the hover orange so the
  // user sees a clear green "did something" feedback even if the mouse
  // is still parked on the button after the click.
  btn.classList.add("is-flashing");
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove("is-flashing");
  }, 700);
}

function toast(severity, msg) {
  const t = app?.extensionManager?.toast;
  if (t?.add) t.add({ severity, summary: "Prompt Pack", detail: msg, life: 2000 });
  else console.warn("[Pixaroma.PromptPack]", msg);
}

export function wireEvents(node, root) {
  const els = root._pixPp;
  if (!els) return;

  // Textarea typing - update state on every keystroke (cheap) and recount.
  // We use 'input' (not 'change') so the counter is live.
  els.ta.addEventListener("input", () => {
    setText(node, els.ta.value);
    const state = readState(node);
    updateCounter(root, state);
    updateClearButton(root, state);
  });

  // Block ComfyUI / LiteGraph keyboard shortcuts from leaking out of the
  // textarea (e.g. Q for queue, Delete for node delete, Ctrl+Enter, etc.).
  // Must be stopImmediatePropagation, NOT stopPropagation - ComfyUI/LiteGraph
  // listen at the document level and stopPropagation alone leaks (Load Image
  // Pattern #6; matches Prompt Stack / Prompt Multi).
  els.ta.addEventListener("keydown", (e) => {
    e.stopImmediatePropagation();
  });

  // Prevent the canvas from grabbing focus when the user clicks inside the
  // textarea - same defensive pattern used in other Pixaroma nodes.
  els.ta.addEventListener("pointerdown", (e) => e.stopImmediatePropagation());
  els.ta.addEventListener("mousedown", (e) => {
    e.stopImmediatePropagation();
  });

  // Copy all - dumps the whole textarea to the clipboard. Mirrors Text
  // Pixaroma's Copy all action. "Nothing to copy" toast on empty so the
  // user never silently fails.
  els.copyBtn.addEventListener("click", async () => {
    const txt = els.ta.value || "";
    if (!txt) { toast("info", "Nothing to copy"); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard not available");
      await navigator.clipboard.writeText(txt);
      flashBtnText(els.copyBtn, "Copied");
    } catch (err) {
      console.warn("[Pixaroma.PromptPack] copy failed", err);
      toast("warn", "Could not copy to clipboard");
    }
  });

  // Replace - read clipboard text and overwrite the textarea. Empty
  // clipboard / image-only clipboard returns "" on Chrome; we bail with
  // a "Nothing to paste" toast so an accidental click never wipes
  // existing prompts. Mirrors Text Pixaroma's Replace action.
  els.replaceBtn.addEventListener("click", async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error("Clipboard read not available");
      const txt = await navigator.clipboard.readText();
      if (!txt) { toast("info", "Nothing to paste"); return; }
      setText(node, txt);
      applyState(root, readState(node));
      flashBtnText(els.replaceBtn, "Pasted");
      node.setDirtyCanvas(true, true);
    } catch (err) {
      console.warn("[Pixaroma.PromptPack] paste failed", err);
      toast("warn", "Could not paste from clipboard");
    }
  });

  // Clear - INSTANT wipe, no confirm dialog (per user request). The
  // textarea content is gone afterwards; users can re-paste from the
  // clipboard if they regret it.
  els.clearBtn.addEventListener("click", () => {
    if (els.clearBtn.disabled) return;
    setText(node, "");
    applyState(root, readState(node));
    node.setDirtyCanvas(true, true);
  });

  // Don't let pointer events on the buttons start a node drag.
  for (const b of [els.copyBtn, els.replaceBtn, els.clearBtn]) {
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("mousedown", (e) => e.stopPropagation());
  }
}

// (The themed pixConfirm dialog that lived here was removed when Clear
//  became instant per the user request - no other call site needed it.)

// Toast helper - same as Prompt Multi's showNoEnabledToast pattern.
// Uses ComfyUI's modern toast API first, falls back to a hand-rolled orange
// banner for older builds that don't have extensionManager.toast.
export function showNoPromptsToast(app) {
  const msg = "Paste at least one prompt to run.";
  const tm = app.extensionManager?.toast;
  if (tm && typeof tm.add === "function") {
    try {
      tm.add({ severity: "warn", summary: "Prompt Pack", detail: msg, life: 4000 });
      return;
    } catch (_e) { /* fall through */ }
  }
  console.warn("[Pixaroma.PromptPack] " + msg);
  try {
    const banner = document.createElement("div");
    banner.textContent = msg;
    banner.style.cssText = "position:fixed;top:60px;right:20px;background:#1d1d1d;color:#fff;font:14px sans-serif;padding:10px 14px;border-radius:6px;border:2px solid #f66744;z-index:99999;";
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 4000);
  } catch (_e) {}
}
