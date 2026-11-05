// Sizes Pixaroma - the short dark list behind a size's Tag button in the settings
// panel. On document.body because the panel clips its children (overflow:hidden).
// A constant size, like the panel it belongs to: placeZoomedPopup is for popups a
// NODE opens, the settings panels stay the same size at every canvas zoom.

import { BRAND, SIZE_TAGS } from "./core.mjs";

let _menu = null;
let _anchor = null;

function injectCSS() {
  if (document.getElementById("pix-szp-tagmenu-css")) return;
  const s = document.createElement("style");
  s.id = "pix-szp-tagmenu-css";
  s.textContent = `
    .pix-szp-tagmenu { position:fixed; z-index:10020; box-sizing:border-box; min-width:104px; padding:0;
      background:#181818; border:1px solid #555; border-radius:6px; overflow:hidden;
      box-shadow:0 8px 24px rgba(0,0,0,.55); }
    .pix-szp-tagitem { display:block; width:100%; box-sizing:border-box; padding:6px 10px; text-align:left;
      background:transparent; border:0; border-bottom:1px solid #2a2a2a; color:#d8d8d8;
      font:12px 'Segoe UI',-apple-system,sans-serif; cursor:pointer; }
    .pix-szp-tagitem:last-child { border-bottom:0; }
    .pix-szp-tagitem:hover, .pix-szp-tagitem:focus-visible { background:#2a2a2a; outline:none; }
    .pix-szp-tagitem.on { color:var(--acc,${BRAND}); font-weight:600; }
    .pix-szp-tagitem.none { color:#9a9a9a; }
    .pix-szp-tagitem.none.on { color:var(--acc,${BRAND}); }
  `;
  document.head.appendChild(s);
}

function onOutside(e) {
  if (!_menu || _menu.contains(e.target)) return;
  // A press on its own button: left to the click, which closes it. Closed here,
  // that click would find nothing open and open the list straight back up. A wheel
  // there scrolls the panel away from the list, so that one does close it.
  if (e.type === "pointerdown" && _anchor?.contains(e.target)) return;
  closeTagMenu();
}

function onKey(e) {
  if (!_menu) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    const a = _anchor;
    closeTagMenu();
    a?.focus?.();
    return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  e.stopPropagation();
  const items = [..._menu.querySelectorAll("button")];
  const at = items.indexOf(document.activeElement);
  const step = e.key === "ArrowDown" ? 1 : -1;
  items[(at + step + items.length) % items.length]?.focus();
}

export function closeTagMenu() {
  if (!_menu) return;
  _menu.remove();
  _menu = null;
  _anchor = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("wheel", onOutside, true);
  document.removeEventListener("keydown", onKey, true);
}

// Is a tag list open? The panel asks before it reacts to Esc.
export function tagMenuOpen() {
  return !!_menu;
}

// Open the list under `anchor`. onPick gets the chosen label, "" for No tag.
export function openTagMenu(anchor, current, accent, onPick) {
  const again = _anchor === anchor;
  closeTagMenu();
  if (again) return;               // a second click on the same button closes it
  injectCSS();

  const menu = document.createElement("div");
  menu.className = "pix-szp-tagmenu";
  menu.setAttribute("role", "menu");
  menu.style.setProperty("--acc", accent);
  for (const tag of ["", ...SIZE_TAGS]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pix-szp-tagitem" + (tag ? "" : " none") + (tag === current ? " on" : "");
    b.setAttribute("role", "menuitem");
    b.textContent = tag || "No tag";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTagMenu();
      onPick(tag);
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  const pad = 8, gap = 4;
  const left = Math.max(pad, Math.min(r.left, window.innerWidth - menu.offsetWidth - pad));
  let top = r.bottom + gap;
  if (top + menu.offsetHeight > window.innerHeight - pad) top = Math.max(pad, r.top - gap - menu.offsetHeight);
  menu.style.left = left + "px";
  menu.style.top = top + "px";

  _menu = menu;
  _anchor = anchor;
  // After this click has finished, or the same pointerdown would close it again.
  setTimeout(() => {
    if (_menu !== menu) return;
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("wheel", onOutside, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  (menu.querySelector(".on") || menu.firstChild)?.focus();
}
