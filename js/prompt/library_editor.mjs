// Prompt Pixaroma - the fullscreen tag library editor.
//
// Opens from the node's "Tags" button, filling the viewport like the other
// Pixaroma editors: a category sidebar on the left, tag rows on the right, with
// search, add, move-between-categories, export, and an import that resolves
// same-name clashes. It edits a WORKING copy of the library and pushes changes
// through commitLibrary (debounced persist + live notify to every node).

import { app } from "/scripts/app.js";
import { installGraphUndoGuard } from "../shared/graph_undo_guard.mjs";
import { BRAND } from "../shared/utils.mjs";
import {
  getLibrary, commitLibrary, flushLibrary, exportLibraryJSON, parseImport, applyImport,
  UNCATEGORIZED, NAME_RE,
} from "./library.mjs";

const PAL = ["#e0894b", "#5aa9e6", "#8e7bd6", "#5fbf8f", "#d76b98", "#c9a24b", "#6fb3b8"];
const ICON_BASE = "/pixaroma/assets/icons/ui/";

let _overlay = null;
let _node = null;
let _opts = null;
let _data = null;       // working copy
let _curCat = "All";
let _search = "";
let _undoGuardOff = null;
let _catMenu = null;
let _accent = BRAND;
// In-progress create-form values, kept alive across re-renders (clicking a sidebar
// category or typing in search rebuilds the form) so a typed OR prefilled name/text
// is never lost. Cleared on Create and on close.
let _createDraft = { name: "", text: "" };

function clone(d) { return { version: 1, categories: [...d.categories], tags: d.tags.map((t) => ({ ...t })) }; }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function sanitizeName(n) { return String(n || "").replace(NAME_RE, ""); }
function colorOf(cat) {
  if (!cat || cat === UNCATEGORIZED) return "#7a7a7a";
  const i = _data.categories.indexOf(cat);
  return PAL[(i < 0 ? 0 : i) % PAL.length];
}
function tagsIn(cat) { return _data.tags.filter((t) => (t.cat || UNCATEGORIZED) === cat); }
function hasUncat() { return _data.tags.some((t) => !t.cat); }
function uniqueNameExcept(base, exceptTag) {
  let n = sanitizeName(base) || "tag";
  const taken = (x) => { const k = x.toLowerCase(); return _data.tags.some((t) => t !== exceptTag && t.name.toLowerCase() === k); };
  if (!taken(n)) return n;
  let i = 2; while (taken(n + "-" + i)) i++; return n + "-" + i;
}
function commit() { commitLibrary(_data); }

function injectCSS() {
  if (document.getElementById("pix-prled-css")) return;
  const s = document.createElement("style");
  s.id = "pix-prled-css";
  s.textContent = `
    .pix-prled { position:fixed; inset:0; z-index:10040; background:#181818; color:#e6e6e6;
      font:14px 'Segoe UI',system-ui,sans-serif; display:flex; flex-direction:column; }
    .pix-prled * { scrollbar-color:#3d3d3d #181818; scrollbar-width:thin; }
    .pix-prled ::-webkit-scrollbar { width:12px; height:12px; }
    .pix-prled ::-webkit-scrollbar-track { background:#181818; }
    .pix-prled ::-webkit-scrollbar-thumb { background:#3d3d3d; border-radius:6px; border:2px solid #181818; }
    .pix-prled ::-webkit-scrollbar-thumb:hover { background:#505050; }
    .pix-prled-bar { display:flex; align-items:center; gap:10px; background:#161616; border-bottom:1px solid #0e0e0e; padding:11px 16px; }
    .pix-prled-bar .ttl { font-weight:500; font-size:15px; color:#fff; display:flex; align-items:center; gap:8px; }
    .pix-prled-bar .ttl .cr { color:var(--acc); }
    .pix-prled-srch { width:320px; max-width:36vw; display:flex; align-items:center; gap:8px; background:#1d1d1d; border:1px solid #3a3a3a; border-radius:6px; padding:6px 10px; margin-left:8px; }
    .pix-prled-srch input { flex:1; background:transparent; border:0; outline:none; color:#e6e6e6; font:13px 'Segoe UI',sans-serif; }
    .pix-prled-srch .i { color:#767676; }
    .pix-prled-bar .priv { margin-left:6px; color:#767676; font-size:11.5px; }
    .pix-prled-bar .help { margin-left:auto; width:30px; height:30px; display:flex; align-items:center; justify-content:center; color:#a6a6a6; cursor:pointer; border-radius:6px; }
    .pix-prled-bar .help:hover { background:rgba(255,255,255,.08); color:#fff; }
    .pix-prled-bar .help .pix-prled-svg { width:17px; height:17px; }
    .pix-prled-bar .x { color:#a6a6a6; cursor:pointer; font-size:20px; line-height:1; padding:3px 9px; border-radius:6px; }
    .pix-prled-bar .x:hover { background:rgba(255,255,255,.08); color:#fff; }
    .pix-prled-main { flex:1; display:flex; min-height:0; }
    .pix-prled-side { width:220px; flex:none; background:#1b1b1b; border-right:1px solid #101010; padding:10px; overflow-y:auto; display:flex; flex-direction:column; gap:3px; }
    .pix-prled-side .lbl { font:600 10px 'Segoe UI',sans-serif; letter-spacing:.1em; text-transform:uppercase; color:#767676; padding:4px 8px 8px; }
    .pix-prled-cat { display:flex; align-items:center; gap:9px; padding:9px 10px; border-radius:7px; cursor:pointer; color:#c9c9c9; font:13px 'Segoe UI',sans-serif; }
    .pix-prled-cat:hover { background:rgba(255,255,255,.05); color:#fff; }
    .pix-prled-cat.on { background:color-mix(in srgb, var(--acc) 18%, transparent); color:#fff; }
    .pix-prled-cat .cd { width:11px; height:11px; border-radius:50%; flex:none; }
    .pix-prled-cat .nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-prled-cat .cnt { font-size:11px; color:#767676; }
    .pix-prled-cat.on .cnt { color:rgba(255,255,255,.7); }
    .pix-prled-cat .act { opacity:0; color:#767676; font-size:12px; padding:0 2px; }
    .pix-prled-cat:hover .act { opacity:1; }
    .pix-prled-cat .act:hover { color:var(--acc); }
    .pix-prled-cat .catinput { flex:1; min-width:0; background:#151515; border:1px solid var(--acc); border-radius:4px; color:#e6e6e6; font:12.5px monospace; padding:4px 6px; outline:none; }
    .pix-prled-newcat { margin-top:6px; padding-top:9px; border-top:1px solid #262626; }
    .pix-prled-btn { background:rgba(255,255,255,.05); border:1px solid #4a4a4a; color:#a6a6a6; border-radius:6px; padding:7px 13px; font:12.5px 'Segoe UI',sans-serif; cursor:pointer; display:inline-flex; gap:6px; align-items:center; transition:.12s; }
    .pix-prled-btn:hover { border-color:var(--acc); color:#fff; }
    .pix-prled-btn.pri { color:#fff; background:var(--acc); border-color:var(--acc); }
    .pix-prled-btn.pri:hover { filter:brightness(1.08); }
    .pix-prled-newcat .pix-prled-btn { width:100%; justify-content:center; }
    .pix-prled-content { flex:1; display:flex; flex-direction:column; min-width:0; background:#212121; }
    .pix-prled-chead { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid #171717; }
    .pix-prled-chead .h { display:flex; align-items:center; gap:9px; font-size:15px; color:#fff; font-weight:500; }
    .pix-prled-chead .h .cd { width:12px; height:12px; border-radius:50%; }
    .pix-prled-chead .h .c { color:#767676; font-weight:400; font-size:12.5px; }
    /* the CREATE form: fill name + text in one place and hit Create (no hunting for
       a button on the far side of the editor) */
    .pix-prled-create { display:flex; align-items:center; gap:8px; padding:11px 16px; background:#1e1e1e; border-bottom:1px solid #171717; }
    .pix-prled-create input, .pix-prled-create textarea { background:#151515; border:1px solid #3a3a3a; border-radius:5px; color:#e6e6e6; font:12.5px monospace; padding:8px 9px; outline:none; height:36px; box-sizing:border-box; }
    .pix-prled-create input:focus, .pix-prled-create textarea:focus { border-color:var(--acc); }
    .pix-prled-create .cnm { width:170px; flex:none; color:var(--acc); }
    .pix-prled-create .ctx { flex:1; min-width:0; resize:none; line-height:1.5; white-space:pre-wrap; overflow-y:auto; }
    .pix-prled-create .ccat { flex:none; height:36px; }
    .pix-prled-create .ccat .car { font-size:9px; opacity:.85; margin-left:1px; }
    .pix-prled-create .cbtn { flex:none; background:var(--acc); border:none; color:#fff; border-radius:5px; padding:9px 15px; font:500 12.5px 'Segoe UI',sans-serif; cursor:pointer; height:36px; }
    .pix-prled-create .cbtn:hover { filter:brightness(1.08); }
    /* CARD GRID: tags as compact cards that fill the width in columns - each card
       keeps its name, text, and actions together (no reaching across the editor). */
    .pix-prled-grid { flex:1; overflow-y:auto; padding:13px 15px; display:grid;
      grid-template-columns:repeat(auto-fill, minmax(255px, 1fr)); gap:11px; align-content:start; }
    .pix-prled-card { background:#282828; border:1px solid #333; border-radius:9px; padding:10px; display:flex; flex-direction:column; gap:7px; min-width:0; }
    .pix-prled-card .ctop { display:flex; align-items:center; gap:6px; }
    .pix-prled-card .cnm { flex:1; min-width:0; background:#1d1d1d; border:1px solid #3a3a3a; border-radius:5px; color:var(--acc); font:13px monospace; padding:6px 8px; outline:none; }
    .pix-prled-card .cnm:focus { border-color:var(--acc); }
    .pix-prled-card .ctop .pix-prled-pill { flex:none; max-width:52%; }
    .pix-prled-card .ctx { background:#1d1d1d; border:1px solid #3a3a3a; border-radius:5px; color:#e0e0e0; font:11.5px/1.45 monospace; padding:7px 8px; outline:none; resize:vertical; min-height:66px; }
    .pix-prled-card .ctx:focus { border-color:var(--acc); }
    .pix-prled-card .cfoot { display:flex; gap:6px; }
    .pix-prled-svg { display:block; width:15px; height:15px; background-color:currentColor;
      -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat; -webkit-mask-position:center; mask-position:center; -webkit-mask-size:contain; mask-size:contain; }
    .pix-prled-empty { color:#767676; font-size:13px; padding:24px; text-align:center; }
    /* Lighter gray (node-like), NOT the #1d1d1d of the editable inputs, so the
       category chip reads as a clickable label rather than a text field. */
    .pix-prled-pill { display:inline-flex; align-items:center; gap:7px; background:#3a3a3a; border:1px solid #4a4a4a; border-radius:20px; padding:6px 11px; font:12px 'Segoe UI',sans-serif; color:#d6d6d6; cursor:pointer; white-space:nowrap; overflow:hidden; }
    .pix-prled-pill:hover { border-color:var(--acc); color:#fff; }
    .pix-prled-pill .cd { width:10px; height:10px; border-radius:50%; flex:none; }
    .pix-prled-insert { flex:1; min-width:74px; height:30px; border-radius:5px; border:1px solid var(--acc); background:transparent;
      color:var(--acc); cursor:pointer; font:12px 'Segoe UI',sans-serif; display:flex; align-items:center; justify-content:center; gap:5px; }
    .pix-prled-insert:hover { background:var(--acc); color:#fff; }
    .pix-prled-insert .pix-prled-svg { width:13px; height:13px; }
    .pix-prled-insert.ok, .pix-prled-insert.ok:hover { background:#3ec371; border-color:#3ec371; color:#fff; }
    .pix-prled-ic { width:32px; height:30px; border-radius:5px; border:1px solid #4a4a4a; background:transparent; color:#a6a6a6; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; }
    .pix-prled-ic:hover { border-color:var(--acc); color:#fff; }
    .pix-prled-ic.del:hover { background:#e2554a; border-color:#e2554a; color:#fff; }
    .pix-prled-foot { display:flex; align-items:center; gap:9px; padding:10px 16px; border-top:1px solid #0e0e0e; background:#161616; }
    .pix-prled-foot .push { margin-left:auto; }
    .pix-prled-menu { position:fixed; z-index:10050; background:#1d1d1d; border:1px solid #4a4a4a; border-radius:7px; padding:5px; box-shadow:0 12px 30px rgba(0,0,0,.6); min-width:170px; }
    .pix-prled-menu .mi { display:flex; align-items:center; gap:9px; padding:7px 10px; border-radius:5px; cursor:pointer; font:12.5px 'Segoe UI',sans-serif; color:#cfcfcf; }
    .pix-prled-menu .mi:hover { background:rgba(255,255,255,.06); color:#fff; }
    .pix-prled-menu .mi .cd { width:10px; height:10px; border-radius:50%; }
    .pix-prled-menu .mi.newc { border-top:1px solid #2a2a2a; margin-top:4px; padding-top:8px; color:var(--acc); }
    .pix-prled-menu input { width:100%; background:#151515; border:1px solid #4a4a4a; border-radius:4px; color:#e6e6e6; font:12px monospace; padding:6px 8px; outline:none; margin-top:5px; }
    .pix-prled-modal { position:absolute; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; z-index:10045; }
    .pix-prled-mcard { background:#202020; border:1px solid #0e0e0e; border-radius:12px; width:460px; max-width:92vw; box-shadow:0 20px 60px rgba(0,0,0,.6); overflow:hidden; }
    .pix-prled-mcard .mh { padding:14px 16px; border-bottom:1px solid #171717; font:500 15px 'Segoe UI',sans-serif; color:#fff; }
    .pix-prled-mcard .mb { padding:14px 16px; color:#a6a6a6; font-size:13px; line-height:1.6; }
    .pix-prled-mcard .mb b { color:#fff; font-weight:500; }
    .pix-prled-mcard .conf { background:#1a1a1a; border:1px solid #2a2a2a; border-radius:7px; padding:8px 11px; margin:9px 0; font:12px monospace; color:#e0894b; max-height:80px; overflow-y:auto; }
    .pix-prled-opts { display:flex; flex-direction:column; gap:8px; padding:2px 16px 16px; }
    .pix-prled-opt { display:flex; align-items:center; gap:11px; background:#262626; border:1px solid #333; border-radius:8px; padding:11px 13px; cursor:pointer; transition:.12s; }
    .pix-prled-opt:hover, .pix-prled-opt.rec { border-color:var(--acc); }
    .pix-prled-opt .oic { width:30px; height:30px; border-radius:7px; background:color-mix(in srgb, var(--acc) 16%, transparent); color:var(--acc); display:flex; align-items:center; justify-content:center; font-size:15px; flex:none; }
    .pix-prled-opt .t { font:500 13px 'Segoe UI',sans-serif; color:#fff; }
    .pix-prled-opt .t small { display:block; color:#a6a6a6; font-weight:400; font-size:11.5px; margin-top:1px; }
    .pix-prled-opt .rtag { margin-left:auto; font-size:10px; color:#3ec371; border:1px solid rgba(62,195,113,.4); border-radius:12px; padding:1px 8px; }
    .pix-prled-help-card { width:560px; }
    .pix-prled-help-card .mb { max-height:60vh; overflow-y:auto; }
    .pix-prled-help-card .mb p { margin:0 0 11px; }
    .pix-prled-help-card .mb p:last-child { margin-bottom:0; }
    .pix-prled-help-foot { display:flex; justify-content:flex-end; padding:0 16px 16px; }
  `;
  document.head.appendChild(s);
}

function hideCatMenu() { if (_catMenu) { _catMenu.remove(); _catMenu = null; } }

// Generic category picker: lists every category + Uncategorized + a New-category
// row, and calls onPick(catValue) ("" = Uncategorized). Does NOT re-render - the
// caller decides (so the create form keeps its typed name/text when picking).
function openCategoryMenu(anchor, onPick) {
  hideCatMenu();
  const menu = document.createElement("div");
  menu.className = "pix-prled-menu";
  const cats = [..._data.categories, UNCATEGORIZED];
  for (const c of cats) {
    const mi = document.createElement("div");
    mi.className = "mi";
    mi.innerHTML = `<span class="cd" style="background:${colorOf(c)}"></span>${esc(c)}`;
    mi.addEventListener("click", () => { hideCatMenu(); onPick(c === UNCATEGORIZED ? "" : c); });
    menu.appendChild(mi);
  }
  const nc = document.createElement("div");
  nc.className = "mi newc";
  nc.innerHTML = `<span>＋</span> New category`;
  const inp = document.createElement("input");
  inp.placeholder = "name"; inp.style.display = "none";
  nc.addEventListener("click", () => { inp.style.display = "block"; inp.focus(); });
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const v = inp.value.trim();
      // If it case-collides with an existing category, use the EXISTING (canonical)
      // one - never assign the tag a wrong-case category that no sidebar row matches.
      const existing = v ? _data.categories.find((c) => c.toLowerCase() === v.toLowerCase()) : null;
      if (v && !existing) { _data.categories.push(v); commit(); }
      hideCatMenu();
      if (v) onPick(existing || v);
    }
    if (e.key === "Escape") hideCatMenu();
  });
  menu.append(nc, inp);
  _overlay.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + "px";
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + "px";
  _catMenu = menu;
}
// Moving an existing tag between categories: persist + re-render.
function openCatMenu(tag, anchor) {
  openCategoryMenu(anchor, (c) => { tag.cat = c; commit(); render(); });
}
document.addEventListener("mousedown", (e) => {
  if (_catMenu && !_catMenu.contains(e.target) && !e.target.closest(".pix-prled-pill")) hideCatMenu();
}, true);

// ── render ─────────────────────────────────────────────────────────────
function makeCard(tag) {
  const card = document.createElement("div");
  card.className = "pix-prled-card";
  const top = document.createElement("div"); top.className = "ctop";
  const nm = document.createElement("input");
  nm.className = "cnm"; nm.value = tag.name; nm.spellcheck = false;
  nm.addEventListener("input", () => {
    tag.name = sanitizeName(nm.value); nm.value = tag.name;
    // Only persist a VALID name. An empty or duplicate name is dropped by normalize,
    // so committing it would briefly remove the tag from the store + every node (a
    // concurrent Run would miss it) and could persist the loss on an abrupt quit.
    // The blur handler recovers an invalid name to a unique one.
    const dup = _data.tags.some((o) => o !== tag && o.name.toLowerCase() === tag.name.toLowerCase());
    if (tag.name && !dup) commit();
  });
  nm.addEventListener("blur", () => { const u = uniqueNameExcept(nm.value, tag); if (u !== tag.name) { tag.name = u; nm.value = u; } commit(); });
  nm.addEventListener("keydown", (e) => e.stopPropagation());
  const cc = tag.cat || UNCATEGORIZED;
  const pill = document.createElement("button");
  pill.className = "pix-prled-pill"; pill.title = "Move to another category";
  pill.innerHTML = `<span class="cd" style="background:${colorOf(cc)}"></span><span>${esc(cc)}</span>`;
  pill.addEventListener("click", (e) => { e.stopPropagation(); openCatMenu(tag, pill); });
  top.append(nm, pill);
  const tx = document.createElement("textarea");
  tx.className = "ctx"; tx.value = tag.text; tx.spellcheck = false; tx.rows = 3;
  tx.addEventListener("input", () => { tag.text = tx.value; commit(); });
  tx.addEventListener("keydown", (e) => e.stopPropagation());
  const foot = document.createElement("div"); foot.className = "cfoot";
  const ins = document.createElement("button");
  ins.className = "pix-prled-insert"; ins.title = "Insert this tag into your prompt";
  ins.innerHTML = `<span class="lbl">Insert</span>`;
  ins.addEventListener("click", () => {
    _opts?.onInsert?.(tag.name);
    ins.classList.add("ok");
    const l = ins.querySelector(".lbl"); if (l) l.textContent = "Inserted ✓";
    setTimeout(() => { ins.classList.remove("ok"); const ll = ins.querySelector(".lbl"); if (ll) ll.textContent = "Insert"; }, 850);
  });
  const del = document.createElement("button");
  del.className = "pix-prled-ic del"; del.title = "Delete tag";
  del.innerHTML = `<span class="pix-prled-svg" style="-webkit-mask-image:url(${ICON_BASE}delete.svg);mask-image:url(${ICON_BASE}delete.svg)"></span>`;
  del.addEventListener("click", () => { const i = _data.tags.indexOf(tag); if (i > -1) _data.tags.splice(i, 1); commit(); render(); });
  foot.append(ins, del);
  card.append(top, tx, foot);
  return card;
}

function renderSidebar(side) {
  side.innerHTML = "";
  side.appendChild(Object.assign(document.createElement("div"), { className: "lbl", textContent: "Categories" }));
  const mkCat = (label, color, count, key, renamable) => {
    const r = document.createElement("div");
    r.className = "pix-prled-cat" + (_curCat === key ? " on" : "");
    r.innerHTML = (color ? `<span class="cd" style="background:${color}"></span>` : `<span style="width:11px"></span>`) +
      `<span class="nm">${esc(label)}</span>` +
      (renamable ? `<span class="act ren" title="Rename">✎</span><span class="act rem" title="Delete category (tags become Uncategorized)">✕</span>` : "") +
      `<span class="cnt">${count}</span>`;
    r.addEventListener("click", (e) => {
      if (e.target.classList.contains("ren")) { startRenameCat(r, key); return; }
      if (e.target.classList.contains("rem")) { deleteCat(key); return; }
      _curCat = key; render();
    });
    return r;
  };
  side.appendChild(mkCat("All tags", "", _data.tags.length, "All", false));
  for (const c of _data.categories) side.appendChild(mkCat(c, colorOf(c), tagsIn(c).length, c, true));
  if (hasUncat()) side.appendChild(mkCat(UNCATEGORIZED, colorOf(UNCATEGORIZED), tagsIn(UNCATEGORIZED).length, UNCATEGORIZED, false));

  const nc = document.createElement("div");
  nc.className = "pix-prled-newcat";
  const b = document.createElement("button");
  b.className = "pix-prled-btn"; b.innerHTML = `<span>＋</span> New category`;
  b.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.placeholder = "category name";
    inp.style.cssText = "width:100%;margin-top:6px;background:#151515;border:1px solid var(--acc);border-radius:6px;color:#e6e6e6;font:12px monospace;padding:7px 9px;outline:none;";
    b.style.display = "none"; nc.appendChild(inp); inp.focus();
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { const v = inp.value.trim(); if (v && !_data.categories.some((c) => c.toLowerCase() === v.toLowerCase())) { _data.categories.push(v); _curCat = v; commit(); } render(); }
      if (e.key === "Escape") render();
    });
    inp.addEventListener("blur", () => setTimeout(() => { if (inp.isConnected) render(); }, 120));
  });
  nc.appendChild(b); side.appendChild(nc);
}
function startRenameCat(row, cat) {
  const nmSpan = row.querySelector(".nm");
  const inp = document.createElement("input");
  inp.className = "catinput"; inp.value = cat;
  nmSpan.replaceWith(inp); inp.focus(); inp.select();
  // Clicking inside the field to place the cursor / select letters must NOT bubble
  // to the row's click handler (which re-renders the sidebar and destroys the field).
  inp.addEventListener("mousedown", (e) => e.stopPropagation());
  inp.addEventListener("click", (e) => e.stopPropagation());
  const commitRename = () => {
    const v = inp.value.trim();
    if (v && v.toLowerCase() !== cat.toLowerCase() && !_data.categories.some((c) => c.toLowerCase() === v.toLowerCase())) {
      const idx = _data.categories.indexOf(cat);
      if (idx > -1) _data.categories[idx] = v;
      for (const t of _data.tags) if (t.cat === cat) t.cat = v;
      if (_curCat === cat) _curCat = v;
      commit();
    }
    render();
  };
  inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") commitRename(); if (e.key === "Escape") render(); });
  inp.addEventListener("blur", commitRename);
}
function deleteCat(cat) {
  const idx = _data.categories.indexOf(cat);
  if (idx > -1) _data.categories.splice(idx, 1);
  for (const t of _data.tags) if (t.cat === cat) t.cat = "";
  if (_curCat === cat) _curCat = "All";
  commit(); render();
}
// A localized create form pinned at the top: fill name + text in one place and
// hit Create - no bouncing to a button on the far side of the editor. New tags
// land in the currently-selected category (Uncategorized when "All" is selected).
function buildCreateForm() {
  // Default to the selected sidebar category; the user can change it right here.
  let createCat = (_curCat !== "All" && _curCat !== UNCATEGORIZED) ? _curCat : ""; // "" = Uncategorized
  const form = document.createElement("div");
  form.className = "pix-prled-create";
  const nm = document.createElement("input"); nm.className = "cnm"; nm.placeholder = "new tag name"; nm.spellcheck = false;
  // A <textarea> (not <input>) so a multi-line "save selection as a tag" keeps its
  // line breaks (a text input strips newlines on assignment).
  const tx = document.createElement("textarea"); tx.className = "ctx"; tx.placeholder = "what it expands to - the full prompt text"; tx.spellcheck = false; tx.rows = 1;
  // Seed from the in-progress draft so name + text survive a re-render (sidebar
  // category click / search), then keep the draft in sync as the user types.
  nm.value = _createDraft.name; tx.value = _createDraft.text;
  nm.addEventListener("input", () => { _createDraft.name = nm.value; });
  tx.addEventListener("input", () => { _createDraft.text = tx.value; });
  const catBtn = document.createElement("button"); catBtn.className = "pix-prled-pill ccat"; catBtn.title = "Category for the new tag - click to change";
  const paintCat = () => {
    const label = createCat || UNCATEGORIZED;
    catBtn.innerHTML = `<span class="cd" style="background:${colorOf(label)}"></span><span>${esc(label)}</span><span class="car">▾</span>`;
  };
  paintCat();
  catBtn.addEventListener("click", (e) => { e.stopPropagation(); openCategoryMenu(catBtn, (c) => { createCat = c; paintCat(); }); });
  const btn = document.createElement("button"); btn.className = "cbtn"; btn.textContent = "Create tag";
  const doCreate = () => {
    const name = sanitizeName(nm.value);
    if (!name) { nm.focus(); return; }
    const uniq = uniqueNameExcept(name, null);
    _data.tags.unshift({ name: uniq, cat: createCat, text: tx.value });
    _createDraft = { name: "", text: "" }; // tag saved -> next render's form is empty
    commit();
    render();
    const nf = _overlay && _overlay.querySelector(".pix-prled-create .cnm");
    if (nf) nf.focus();
    toast("success", "Created tag @" + uniq);
  };
  btn.addEventListener("click", doCreate);
  nm.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); doCreate(); } });
  // Enter creates the tag; Shift+Enter inserts a newline (the text can be multi-line).
  tx.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doCreate(); } });
  form.append(nm, tx, catBtn, btn);
  return form;
}
function buildGrid() {
  const grid = document.createElement("div");
  grid.className = "pix-prled-grid";
  const q = _search.toLowerCase();
  const rows = _data.tags.filter((t) =>
    (_curCat === "All" || (t.cat || UNCATEGORIZED) === _curCat) &&
    (!q || t.name.toLowerCase().includes(q) || t.text.toLowerCase().includes(q)));
  if (!rows.length) {
    const e = document.createElement("div");
    e.className = "pix-prled-empty"; e.style.gridColumn = "1 / -1";
    e.textContent = _search ? "No tags match your search." : "No tags here yet - create one above.";
    grid.appendChild(e);
  } else for (const t of rows) grid.appendChild(makeCard(t));
  return grid;
}
function renderContent(content) {
  content.innerHTML = "";
  const head = document.createElement("div");
  head.className = "pix-prled-chead";
  const h = document.createElement("div");
  h.className = "h";
  if (_curCat === "All") h.innerHTML = `<span>All tags</span><span class="c">· ${_data.tags.length}</span>`;
  else h.innerHTML = `<span class="cd" style="background:${colorOf(_curCat)}"></span><span>${esc(_curCat)}</span><span class="c">· ${tagsIn(_curCat).length} tags</span>`;
  head.append(h);
  content.append(head, buildCreateForm(), buildGrid());
}
function render() {
  if (!_overlay) return;
  hideCatMenu();
  renderSidebar(_overlay.querySelector(".pix-prled-side"));
  renderContent(_overlay.querySelector(".pix-prled-content"));
}

// ── import / export ────────────────────────────────────────────────────
function doExport() {
  try {
    const blob = new Blob([exportLibraryJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "prompt-tags.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { console.error("Pixaroma.Prompt export failed", err); }
}
function pickImportFile() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json,application/json"; inp.style.display = "none";
  inp.addEventListener("change", () => {
    const file = inp.files && inp.files[0];
    inp.remove();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => startImport(String(reader.result || ""));
    reader.onerror = () => toast("warn", "Could not read that file");
    reader.readAsText(file);
  });
  document.body.appendChild(inp); inp.click();
}
function startImport(text) {
  flushLibrary(); // so parseImport sees exactly our working library
  const parsed = parseImport(text);
  if (parsed.error) { toast("warn", parsed.error); return; }
  if (!parsed.conflicts.length) { applyLibraryImport(parsed, "both"); return; }
  showImportModal(parsed);
}
function applyLibraryImport(parsed, mode) {
  const res = applyImport(parsed, mode);
  _data = clone(getLibrary());
  render();
  toast("info", `Imported ${res.added} tag${res.added === 1 ? "" : "s"}.`);
}
function showImportModal(parsed) {
  const modal = document.createElement("div");
  modal.className = "pix-prled-modal";
  const total = parsed.data.tags.length;
  const conf = parsed.conflicts.slice(0, 40).map((n) => "@" + n).join(" · ");
  modal.innerHTML =
    `<div class="pix-prled-mcard"><div class="mh">Import tags</div>` +
    `<div class="mb">Importing <b>${total} tag${total === 1 ? "" : "s"}</b>. <b>${parsed.conflicts.length}</b> have names you already use:` +
    `<div class="conf">${esc(conf)}</div>How should the clashes be handled?</div>` +
    `<div class="pix-prled-opts">` +
    `<div class="pix-prled-opt rec" data-mode="both"><span class="oic">＋</span><span class="t">Keep both<small>Renames the imported one (e.g. @${esc(parsed.conflicts[0])}-2) so nothing is lost</small></span><span class="rtag">recommended</span></div>` +
    `<div class="pix-prled-opt" data-mode="replace"><span class="oic">⟳</span><span class="t">Replace mine<small>Overwrite my tag's text with the imported one</small></span></div>` +
    `<div class="pix-prled-opt" data-mode="skip"><span class="oic">⊘</span><span class="t">Skip duplicates<small>Only add the tags I don't already have</small></span></div>` +
    `</div></div>`;
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelectorAll(".pix-prled-opt").forEach((o) => o.addEventListener("click", () => { const m = o.dataset.mode; modal.remove(); applyLibraryImport(parsed, m); }));
  _overlay.appendChild(modal);
}
function toast(sev, msg) {
  const t = app?.extensionManager?.toast;
  if (t?.add) t.add({ severity: sev, summary: "Prompt Pixaroma", detail: msg, life: 2600 });
  else console.warn("[Pixaroma.Prompt]", msg);
}

// A self-contained help panel, appended to the overlay (reuses the modal chrome so
// it sits above the editor and closes on the X / click-outside / Escape via onKey).
function showLibraryHelp() {
  if (!_overlay) return;
  const modal = document.createElement("div");
  modal.className = "pix-prled-modal";
  modal.innerHTML =
    `<div class="pix-prled-mcard pix-prled-help-card"><div class="mh">How the tag library works</div>` +
    `<div class="mb">` +
    `<p><b>What it is.</b> Your personal, reusable prompt snippets. Type a short <b>@name</b> in a Prompt node and it becomes the full text at run time, so the box stays short. Your library is saved on your machine, stays private to you, and survives updating the plugin - it is never stored inside a workflow.</p>` +
    `<p><b>Create a tag.</b> Fill in the name and the full prompt text along the top, pick a category, and press <b>Create tag</b>. New tags appear at the front.</p>` +
    `<p><b>Edit a tag.</b> Click a card's name or its text and change it - your edits save on their own.</p>` +
    `<p><b>Categories.</b> Make them in the left sidebar. Click a card's coloured pill to move that tag to another category. Rename or delete a category from the sidebar (its tags just become Uncategorized).</p>` +
    `<p><b>Use a tag.</b> Type <b>@</b> in the prompt box for a searchable list, or press <b>Insert</b> on a card to drop it straight into your prompt.</p>` +
    `<p><b>Share.</b> <b>Export library</b> saves your tags to a file you can share. <b>Import</b> brings a file in - if a name already exists you choose keep both, replace, or skip.</p>` +
    `</div>` +
    `<div class="pix-prled-help-foot"><button class="pix-prled-btn pri hgot">Got it</button></div>` +
    `</div>`;
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector(".hgot").addEventListener("click", () => modal.remove());
  _overlay.appendChild(modal);
}

// ── open / close ───────────────────────────────────────────────────────
export function openLibraryEditor(node, opts) {
  closeLibraryEditor();
  injectCSS();
  _node = node; _opts = opts || {}; _accent = _opts.accent || BRAND;
  _createDraft = { name: "", text: (_opts.prefill || "").trim() };
  _data = clone(getLibrary());
  _curCat = "All"; _search = "";

  const ov = document.createElement("div");
  ov.className = "pix-prled";
  ov.style.setProperty("--acc", _accent);
  ov.innerHTML =
    `<div class="pix-prled-bar">` +
    `<div class="ttl"><span class="cr">☲</span> Tag library</div>` +
    `<div class="pix-prled-srch"><span class="i">🔍</span><input placeholder="search tags and text"></div>` +
    `<span class="priv">private to you · survives plugin updates</span>` +
    `<span class="help" title="How the tag library works"><span class="pix-prled-svg" style="-webkit-mask-image:url(${ICON_BASE}help.svg);mask-image:url(${ICON_BASE}help.svg)"></span></span>` +
    `<span class="x" title="Close">✕</span></div>` +
    `<div class="pix-prled-main"><div class="pix-prled-side"></div><div class="pix-prled-content"></div></div>` +
    `<div class="pix-prled-foot"><button class="pix-prled-btn imp-export"><span>⭳</span> Export library</button>` +
    `<button class="pix-prled-btn imp-import"><span>⭱</span> Import</button>` +
    `<button class="pix-prled-btn push imp-done">Done</button></div>`;
  document.body.appendChild(ov);
  _overlay = ov;

  const search = ov.querySelector(".pix-prled-srch input");
  search.addEventListener("input", () => { _search = search.value; renderContent(ov.querySelector(".pix-prled-content")); });
  search.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape" && _search) { _search = ""; search.value = ""; renderContent(ov.querySelector(".pix-prled-content")); e.stopImmediatePropagation(); } });
  ov.querySelector(".x").addEventListener("click", closeLibraryEditor);
  ov.querySelector(".help").addEventListener("click", showLibraryHelp);
  ov.querySelector(".imp-done").addEventListener("click", closeLibraryEditor);
  ov.querySelector(".imp-export").addEventListener("click", doExport);
  ov.querySelector(".imp-import").addEventListener("click", pickImportFile);

  render();
  // Coming from "save selection as a tag": the text is already in the create form,
  // so focus the NAME field - the user only has to name it and hit Create.
  if ((_opts.prefill || "").trim()) {
    const nf = ov.querySelector(".pix-prled-create .cnm");
    if (nf) { nf.focus(); }
  } else {
    search.focus();
  }

  _undoGuardOff = installGraphUndoGuard(() => !!_overlay && _overlay.isConnected);
  window.addEventListener("keydown", onKey, true);
}
function onKey(e) {
  if (e.key !== "Escape") return;
  if (_overlay?.querySelector(".pix-prled-modal")) { _overlay.querySelector(".pix-prled-modal").remove(); e.stopPropagation(); return; }
  if (_catMenu) { hideCatMenu(); e.stopPropagation(); return; }
  const s = _overlay?.querySelector(".pix-prled-srch input");
  if (s && document.activeElement === s && s.value) return; // its own handler clears the search first
  e.stopPropagation();
  closeLibraryEditor();
}
export function closeLibraryEditor() {
  window.removeEventListener("keydown", onKey, true);
  hideCatMenu();
  // Recover any card left with an empty/duplicate name before persisting - the
  // per-card blur recovery is bypassed when closing via Escape / the X, and an
  // empty name is dropped by normalize (the tag would be lost otherwise).
  if (_data) {
    for (const t of _data.tags) { const u = uniqueNameExcept(t.name, t); if (u !== t.name) t.name = u; }
    try { commitLibrary(_data); } catch { /* ignore */ }
  }
  try { flushLibrary(); } catch { /* ignore */ }
  try { _undoGuardOff?.(); } catch { /* ignore */ }
  _undoGuardOff = null;
  if (_overlay) { try { _overlay.remove(); } catch { /* ignore */ } }
  _overlay = null; _node = null; _opts = null; _data = null; _createDraft = { name: "", text: "" };
}
export function closeLibraryEditorFor(node) { if (_node === node) closeLibraryEditor(); }
