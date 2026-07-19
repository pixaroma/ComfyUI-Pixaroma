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
    .pix-prled-bar .x { margin-left:auto; color:#a6a6a6; cursor:pointer; font-size:20px; line-height:1; padding:3px 9px; border-radius:6px; }
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
    .pix-prled-create input { background:#151515; border:1px solid #3a3a3a; border-radius:5px; color:#e6e6e6; font:12.5px monospace; padding:8px 9px; outline:none; height:36px; box-sizing:border-box; }
    .pix-prled-create input:focus { border-color:var(--acc); }
    .pix-prled-create .cnm { width:170px; flex:none; color:var(--acc); }
    .pix-prled-create .ctx { flex:1; min-width:0; }
    .pix-prled-create .chint { color:#767676; font-size:11.5px; white-space:nowrap; display:flex; align-items:center; gap:6px; }
    .pix-prled-create .chint .cd { width:9px; height:9px; border-radius:50%; }
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
    .pix-prled-pill { display:inline-flex; align-items:center; gap:7px; background:#1d1d1d; border:1px solid #3a3a3a; border-radius:20px; padding:6px 11px; font:12px 'Segoe UI',sans-serif; color:#cfcfcf; cursor:pointer; white-space:nowrap; overflow:hidden; }
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
  `;
  document.head.appendChild(s);
}

function hideCatMenu() { if (_catMenu) { _catMenu.remove(); _catMenu = null; } }

function openCatMenu(tag, anchor) {
  hideCatMenu();
  const menu = document.createElement("div");
  menu.className = "pix-prled-menu";
  const cats = [..._data.categories, UNCATEGORIZED];
  for (const c of cats) {
    const mi = document.createElement("div");
    mi.className = "mi";
    mi.innerHTML = `<span class="cd" style="background:${colorOf(c)}"></span>${esc(c)}`;
    mi.addEventListener("click", () => { tag.cat = (c === UNCATEGORIZED ? "" : c); commit(); hideCatMenu(); render(); });
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
      if (v && !_data.categories.some((c) => c.toLowerCase() === v.toLowerCase())) _data.categories.push(v);
      if (v) tag.cat = v;
      commit(); hideCatMenu(); render();
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
  nm.addEventListener("input", () => { tag.name = sanitizeName(nm.value); nm.value = tag.name; commit(); });
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
  const targetCat = (_curCat !== "All" && _curCat !== UNCATEGORIZED) ? _curCat : "";
  const form = document.createElement("div");
  form.className = "pix-prled-create";
  const nm = document.createElement("input"); nm.className = "cnm"; nm.placeholder = "new tag name"; nm.spellcheck = false;
  const tx = document.createElement("input"); tx.className = "ctx"; tx.placeholder = "what it expands to - the full prompt text"; tx.spellcheck = false;
  const hint = document.createElement("span"); hint.className = "chint";
  hint.innerHTML = `<span class="cd" style="background:${colorOf(targetCat || UNCATEGORIZED)}"></span>into ${esc(targetCat || UNCATEGORIZED)}`;
  const btn = document.createElement("button"); btn.className = "cbtn"; btn.textContent = "Create tag";
  const doCreate = () => {
    const name = sanitizeName(nm.value);
    if (!name) { nm.focus(); return; }
    const uniq = uniqueNameExcept(name, null);
    _data.tags.unshift({ name: uniq, cat: targetCat, text: tx.value });
    commit();
    render();
    const nf = _overlay && _overlay.querySelector(".pix-prled-create .cnm");
    if (nf) nf.focus();
    toast("success", "Created tag @" + uniq);
  };
  btn.addEventListener("click", doCreate);
  const onKey = (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); doCreate(); } };
  nm.addEventListener("keydown", onKey);
  tx.addEventListener("keydown", onKey);
  form.append(nm, tx, hint, btn);
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

// ── open / close ───────────────────────────────────────────────────────
export function openLibraryEditor(node, opts) {
  closeLibraryEditor();
  injectCSS();
  _node = node; _opts = opts || {}; _accent = _opts.accent || BRAND;
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
  ov.querySelector(".imp-done").addEventListener("click", closeLibraryEditor);
  ov.querySelector(".imp-export").addEventListener("click", doExport);
  ov.querySelector(".imp-import").addEventListener("click", pickImportFile);

  render();
  search.focus();

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
  try { flushLibrary(); } catch { /* ignore */ }
  try { _undoGuardOff?.(); } catch { /* ignore */ }
  _undoGuardOff = null;
  if (_overlay) { try { _overlay.remove(); } catch { /* ignore */ } }
  _overlay = null; _node = null; _opts = null; _data = null;
}
export function closeLibraryEditorFor(node) { if (_node === node) closeLibraryEditor(); }
