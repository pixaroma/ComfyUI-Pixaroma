// Reference Images Pixaroma - the dark dropdown list (convention #14: never a
// native <select>). Lives on document.body, so it follows the canvas zoom
// through placeZoomedPopup (convention #27) and closes on an outside
// pointerdown, a wheel outside it, or Escape (Load Audio's proven shape).

import { accentOf } from "../shared/node_settings.mjs";
import { placeZoomedPopup } from "../shared/popup_zoom.mjs";
import { injectCSS } from "./css.mjs";

let _pop = null;
let _anchor = null;

export function closeMenu() {
  try { _pop?.remove(); } catch {}
  _pop = null;
  _anchor = null;
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("wheel", onWheel, true);
  document.removeEventListener("keydown", onEsc, true);
}

export const menuOpenFor = (anchor) => !!_pop && _anchor === anchor;

function outside(e) {
  if (!_pop || _pop.contains(e.target)) return;
  // The button that opened it toggles it itself (its click handler runs next).
  if (_anchor && _anchor.contains(e.target)) return;
  closeMenu();
}
function onWheel(e) {
  if (_pop && !_pop.contains(e.target)) closeMenu();
}
function onEsc(e) {
  if (e.key === "Escape" && _pop) {
    e.stopPropagation();
    closeMenu();
  }
}

/** items: [{ key, label, hint? }]. A second click on the same anchor closes it. */
export function openMenu(node, anchor, items, current, onPick) {
  if (menuOpenFor(anchor)) {
    closeMenu();
    return;
  }
  closeMenu();
  injectCSS();
  const pop = document.createElement("div");
  pop.className = "pix-rfi-pop";
  pop.setAttribute("role", "listbox");
  // A body-level list copies its opener's accent (node-settings-accent #6).
  try { pop.style.setProperty("--pix-acc", accentOf(node)); } catch {}
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "it" + (it.key === current ? " on" : "");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(it.key === current));
    row.textContent = it.label;
    if (it.title) row.title = it.title;
    if (it.hint) {
      const h = document.createElement("small");
      h.textContent = it.hint;
      row.appendChild(h);
    }
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      onPick(it.key);
    });
    pop.appendChild(row);
  }
  document.body.appendChild(pop);
  _pop = pop;
  _anchor = anchor;
  // The CSS max-height governs at 100% zoom; baseMaxHeightPx scales it when the
  // canvas is zoomed in. The two numbers must match (Load Audio's lesson).
  placeZoomedPopup(pop, anchor, { baseFontPx: 12, minWidthPx: 150, baseMaxHeightPx: 340 });
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("wheel", onWheel, true);
  document.addEventListener("keydown", onEsc, true);
}
