// LoRA Loader Pixaroma - the searchable LoRA picker popup (opened by clicking a
// row's name field). Type to filter; results are grouped by subfolder. Closes on
// outside pointer / wheel / Esc. Follows Load Image Pixaroma Pattern #14 (the wheel
// handler must skip events inside the popup or scrolling the list would close it).

import { BRAND } from "./core.mjs";
import { listLoras } from "./api.mjs";

let _pop = null;
let _cleanup = null;

function injectCSS() {
  if (document.getElementById("pix-ll-dd-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ll-dd-css";
  s.textContent = `
    .pix-ll-dd { position:fixed; z-index:10020; width:300px; max-width:92vw; background:#242424;
      border:1px solid ${BRAND}; border-radius:9px; box-shadow:0 14px 44px rgba(0,0,0,0.6);
      overflow:hidden; font:12px 'Segoe UI',system-ui,sans-serif; color:#ddd;
      display:flex; flex-direction:column; max-height:60vh; }
    .pix-ll-dd-srch { margin:8px; display:flex; align-items:center; gap:7px; background:#161616;
      border:1px solid ${BRAND}; border-radius:6px; padding:6px 9px; }
    .pix-ll-dd-srch input { flex:1; min-width:0; background:transparent; border:0; outline:none;
      color:#fff; font:12px monospace; }
    .pix-ll-dd-srch .ic { color:#888; flex:none; }
    .pix-ll-dd-list { overflow-y:auto; overflow-x:hidden; padding:2px 0 6px; }
    .pix-ll-dd-list::-webkit-scrollbar { width:7px; }
    .pix-ll-dd-list::-webkit-scrollbar-thumb { background:#555; border-radius:3px; }
    .pix-ll-dd-grp { font-size:9.5px; text-transform:uppercase; letter-spacing:.6px; color:#7a7a7a;
      padding:6px 12px 3px; }
    .pix-ll-dd-opt { padding:6px 12px; font:11.5px monospace; color:#bbb; cursor:pointer;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-ll-dd-opt:hover { background:#2f2f2f; color:#fff; }
    .pix-ll-dd-opt.cur { color:${BRAND}; }
    .pix-ll-dd-empty { padding:14px 12px; color:#777; text-align:center; }
  `;
  document.head.appendChild(s);
}

export function closeLoraDropdown() {
  if (_cleanup) { try { _cleanup(); } catch {} }
  _cleanup = null;
  if (_pop) { try { _pop.remove(); } catch {} }
  _pop = null;
}

function group(name) {
  const i = name.replace(/\\/g, "/").lastIndexOf("/");
  return i < 0 ? "" : name.slice(0, i);
}
function base(name) {
  const i = name.replace(/\\/g, "/").lastIndexOf("/");
  return i < 0 ? name : name.slice(i + 1);
}

export async function openLoraDropdown(anchorEl, opts) {
  closeLoraDropdown();
  injectCSS();
  const { current = "", accent = BRAND, onPick } = opts || {};

  const pop = document.createElement("div");
  pop.className = "pix-ll-dd";
  pop.style.borderColor = accent;

  const srch = document.createElement("div");
  srch.className = "pix-ll-dd-srch";
  srch.style.borderColor = accent;
  const ic = document.createElement("span"); ic.className = "ic"; ic.textContent = "⌕";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search LoRAs…";
  input.addEventListener("keydown", (e) => e.stopPropagation()); // don't trigger canvas shortcuts
  srch.append(ic, input);

  const list = document.createElement("div");
  list.className = "pix-ll-dd-list";
  pop.append(srch, list);
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  pop.style.width = Math.min(Math.max(r.width, 240), 360) + "px";
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";

  // Placed below the anchor by default; flipped above if there isn't room. Recomputed
  // once the list has content (its real height is known then).
  function place() {
    const h = pop.offsetHeight;
    if (r.bottom + 4 + h <= window.innerHeight - 8) pop.style.top = (r.bottom + 4) + "px";
    else pop.style.top = Math.max(8, r.top - 4 - h) + "px";
  }
  place();

  const all = await listLoras();
  if (!pop.isConnected) return; // closed while loading

  function renderList() {
    const q = input.value.trim().toLowerCase();
    const matched = all.filter((n) => !q || n.toLowerCase().includes(q));
    list.innerHTML = "";
    if (!matched.length) {
      const e = document.createElement("div");
      e.className = "pix-ll-dd-empty";
      e.textContent = all.length ? "No match." : "No LoRAs in models/loras.";
      list.appendChild(e);
      return;
    }
    let lastGroup = null;
    for (const name of matched) {
      const g = group(name);
      if (g !== lastGroup) {
        lastGroup = g;
        const h = document.createElement("div");
        h.className = "pix-ll-dd-grp";
        h.textContent = g ? g + "/" : "root";
        list.appendChild(h);
      }
      const opt = document.createElement("div");
      opt.className = "pix-ll-dd-opt" + (name === current ? " cur" : "");
      opt.textContent = base(name);
      opt.title = name;
      opt.addEventListener("click", () => { onPick?.(name); closeLoraDropdown(); });
      list.appendChild(opt);
    }
  }
  renderList();
  place(); // list now has height - re-anchor (flip up if needed)
  input.addEventListener("input", renderList);
  setTimeout(() => input.focus(), 0);

  const onDown = (e) => { if (!pop.contains(e.target)) closeLoraDropdown(); };
  const onWheel = (e) => { if (!pop.contains(e.target)) closeLoraDropdown(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeLoraDropdown(); } };
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  _cleanup = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
  };
  _pop = pop;
}
