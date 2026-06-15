// Load Images from Folder Pixaroma — DOM (node body, gallery, folder browser) + CSS.

import { thumbURL, browseFolder } from "./api.mjs";
import { readState, writeState, sortFiles } from "./state.mjs";

// folder.svg (assets/icons/ui/folder.svg) inlined so the Browse button + browser
// rows draw the real icon without a network fetch. fill:currentColor follows text.
const FOLDER_SVG =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M52.291,56.817H5.626c-1.006,0-1.922-.594-2.5-1.323-.752-.949-.846-2.209-.483-3.372l7.293-23.34c.522-1.67,1.625-2.992,3.453-3.243h46.148c2.155.308,3.418,2.045,3.193,4.245l-7.097,23.693c-.491,1.64-1.523,2.993-3.343,3.341ZM50.726,14.308h-21.805c-.429-.181-.717-.689-.997-1.031l-3.967-4.843c-.559-.682-1.432-1.249-2.369-1.25H6.186c-1.185,0-2.24.531-3.095,1.272-1.098.952-1.545,2.24-1.818,3.706v31.447c1.841-5.514,3.332-10.857,5.103-16.241.459-1.396,1.126-2.594,2.154-3.621,1.355-1.054,2.862-2.056,4.685-2.057h42.426c.669-2.549-.634-7.369-4.914-7.382Z"/></svg>';

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// ── CSS ──────────────────────────────────────────────────────────────────────
export function injectCSS() {
  if (document.getElementById("pix-lif-css")) return;
  const css = `
.pix-lif-root { display:flex; flex-direction:column; gap:8px; padding:8px 10px; box-sizing:border-box; font-family:inherit; }
.pix-lif-folderrow { display:flex; gap:6px; }
.pix-lif-folder { flex:1; min-width:0; background:#141414; border:1px solid #3a3a3a; border-radius:5px; padding:7px 8px; color:#cfcfcf; font-size:11px; box-sizing:border-box; }
.pix-lif-folder:focus { outline:none; border-color:#f66744; }
.pix-lif-browse { display:flex; align-items:center; gap:5px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.16); border-radius:5px; color:#ddd; font-size:11px; padding:0 9px; cursor:pointer; white-space:nowrap; }
.pix-lif-browse:hover { border-color:#f66744; color:#fff; }
.pix-lif-browse svg { width:13px; height:13px; fill:currentColor; }
.pix-lif-pick { background:#f66744; border:1px solid #f66744; border-radius:6px; padding:8px; font-size:12px; color:#fff; text-align:center; font-weight:500; cursor:pointer; }
.pix-lif-pick:hover { filter:brightness(1.08); }
.pix-lif-pick.empty { background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.16); color:#9a9a9a; }
.pix-lif-msg { font-size:11px; color:#e0a33e; line-height:1.4; }
.pix-lif-msg:empty { display:none; }
.pix-lif-resize-slot { display:flex; flex-direction:column; gap:6px; }
.pix-lif-resize-slot:empty { display:none; }
.pix-lif-resizebtn { display:flex; align-items:center; gap:8px; width:100%; background:#141414; border:1px solid #3a3a3a; border-radius:5px; padding:6px 8px; font-size:11px; color:#cfcfcf; cursor:pointer; box-sizing:border-box; }
.pix-lif-resizebtn:hover { border-color:#f66744; }
.pix-lif-resizebtn .lbl { color:#f66744; font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
.pix-lif-resizebtn .val { margin-left:auto; color:#ddd; }

/* mini dropdown menu (sort, resize mode) */
.pix-lif-menu { position:fixed; z-index:99999; background:#191919; border:1px solid #3a3a3a; border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,0.5); overflow:hidden; min-width:150px; }
.pix-lif-menu .it { padding:7px 11px; font-size:12px; color:#cfcfcf; cursor:pointer; display:flex; justify-content:space-between; gap:14px; }
.pix-lif-menu .it:hover { background:#2a2a2a; }
.pix-lif-menu .it.on { color:#f66744; }

/* gallery */
.pix-lif-gallery { position:fixed; z-index:99999; background:#191919; border:1px solid #f66744; border-radius:9px; box-shadow:0 14px 40px rgba(0,0,0,0.6); display:flex; flex-direction:column; max-height:80vh; }
.pix-lif-gal-head { padding:9px 12px; border-bottom:1px solid #333; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.pix-lif-tbtn { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.16); border-radius:5px; padding:5px 10px; font-size:11px; color:#ddd; cursor:pointer; user-select:none; }
.pix-lif-tbtn:hover { border-color:#f66744; color:#fff; }
.pix-lif-firstwrap { display:flex; align-items:center; }
.pix-lif-firstwrap .pix-lif-tbtn { border-radius:5px 0 0 5px; }
.pix-lif-firstn { width:46px; background:#141414; border:1px solid rgba(255,255,255,0.16); border-left:none; border-radius:0 5px 5px 0; color:#f66744; font-size:11px; padding:5px 4px; text-align:center; box-sizing:border-box; }
.pix-lif-firstn:focus { outline:none; border-color:#f66744; }
.pix-lif-count { margin-left:auto; font-size:11px; color:#9a9a9a; white-space:nowrap; }
.pix-lif-count b { color:#f66744; }
.pix-lif-gal-body { padding:10px 12px; overflow:auto; }
.pix-lif-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(84px,1fr)); gap:7px; }
.pix-lif-thumb { position:relative; aspect-ratio:1; border-radius:5px; border:2px solid transparent; cursor:pointer; overflow:hidden; background:#0f0f0f; }
.pix-lif-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.pix-lif-thumb .veil { position:absolute; inset:0; background:rgba(0,0,0,0.45); }
.pix-lif-thumb.sel { border-color:#f66744; }
.pix-lif-thumb.sel .veil { opacity:0; }
.pix-lif-thumb .chk { position:absolute; top:3px; right:3px; width:16px; height:16px; border-radius:50%; background:#f66744; color:#fff; font-size:11px; display:none; align-items:center; justify-content:center; }
.pix-lif-thumb.sel .chk { display:flex; }
.pix-lif-thumb .nm { position:absolute; bottom:0; left:0; right:0; padding:2px 4px; font-size:9px; color:#eee; background:linear-gradient(transparent, rgba(0,0,0,0.75)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pix-lif-gal-empty { padding:30px; text-align:center; color:#888; font-size:12px; grid-column:1/-1; }
.pix-lif-gal-foot { padding:9px 12px; border-top:1px solid #333; display:flex; gap:10px; align-items:center; }
.pix-lif-subf { display:flex; align-items:center; gap:6px; font-size:11px; color:#bbb; cursor:pointer; user-select:none; }
.pix-lif-subf .box { width:12px; height:12px; border:1px solid #555; border-radius:3px; }
.pix-lif-subf.on .box { background:#f66744; border-color:#f66744; }
.pix-lif-done { margin-left:auto; background:#f66744; border:1px solid #f66744; border-radius:6px; padding:6px 16px; font-size:12px; color:#fff; cursor:pointer; }
.pix-lif-done:hover { filter:brightness(1.08); }

/* folder browser */
.pix-lif-browse-pop { position:fixed; z-index:99999; background:#191919; border:1px solid #f66744; border-radius:9px; box-shadow:0 14px 40px rgba(0,0,0,0.6); display:flex; flex-direction:column; max-height:72vh; }
.pix-lif-bp-head { padding:9px 12px; border-bottom:1px solid #333; font-size:12px; color:#f66744; font-weight:600; }
.pix-lif-bp-crumb { padding:7px 12px 4px; font-size:11px; color:#999; word-break:break-all; }
.pix-lif-bp-list { padding:6px 10px 10px; overflow:auto; display:flex; flex-direction:column; gap:4px; }
.pix-lif-bp-item { display:flex; align-items:center; gap:8px; padding:7px 9px; background:#141414; border:1px solid #2c2c2c; border-radius:6px; cursor:pointer; font-size:12px; color:#ddd; }
.pix-lif-bp-item:hover { border-color:#f66744; background:#1c1c1c; }
.pix-lif-bp-item svg { width:13px; height:13px; fill:#f66744; flex:0 0 auto; }
.pix-lif-bp-item .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pix-lif-bp-item .cnt { color:#777; font-size:11px; white-space:nowrap; }
.pix-lif-bp-item.up { color:#9a9a9a; }
.pix-lif-bp-empty { padding:14px; text-align:center; color:#777; font-size:12px; }
.pix-lif-bp-foot { padding:9px 12px; border-top:1px solid #333; display:flex; gap:8px; }
`;
  const el = document.createElement("style");
  el.id = "pix-lif-css";
  el.textContent = css;
  document.head.appendChild(el);
}

// ── popup helpers ────────────────────────────────────────────────────────────
function positionBelow(popup, anchorEl, width) {
  const r = anchorEl.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.width = `${width}px`;
  popup.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
  popup.style.top = `${r.bottom + 4}px`;
  requestAnimationFrame(() => {
    const pr = popup.getBoundingClientRect();
    if (pr.bottom > window.innerHeight - 8) {
      popup.style.top = `${Math.max(8, window.innerHeight - 8 - pr.height)}px`;
    }
  });
}

function attachClosePopup(popup, onClose) {
  const close = () => {
    if (popup._pixClosed) return;
    popup._pixClosed = true;
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
    popup.remove();
    onClose?.();
  };
  // gate on !contains so scrolling/clicking INSIDE the popup never closes it
  const onDown = (e) => { if (!popup.contains(e.target)) close(); };
  const onWheel = (e) => { if (!popup.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  popup._pixClose = close;
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  return close;
}

export function openMiniMenu(anchorEl, items, currentValue, onPick) {
  document.querySelectorAll(".pix-lif-menu").forEach((m) => m._pixClose?.());
  const menu = document.createElement("div");
  menu.className = "pix-lif-menu";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "it" + (it.value === currentValue ? " on" : "");
    row.innerHTML = `<span>${escapeHtml(it.label)}</span>${it.hint ? `<span style="color:#777">${escapeHtml(it.hint)}</span>` : ""}`;
    row.addEventListener("click", () => { menu._pixClose?.(); onPick(it.value); });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  positionBelow(menu, anchorEl, Math.max(150, anchorEl.getBoundingClientRect().width));
  attachClosePopup(menu);
}

// ── node body ────────────────────────────────────────────────────────────────
export function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-lif-root";
  root.innerHTML =
    `<div class="pix-lif-folderrow">` +
    `<input class="pix-lif-folder" type="text" spellcheck="false" placeholder="Folder path — type, paste, or Browse">` +
    `<button class="pix-lif-browse" type="button" title="Browse for a folder on your computer">${FOLDER_SVG} Browse</button>` +
    `</div>` +
    `<button class="pix-lif-pick empty" type="button" title="Choose which images to load">Pick images · 0 / 0</button>` +
    `<div class="pix-lif-msg"></div>` +
    `<div class="pix-lif-resize-slot"></div>`;
  return {
    root,
    folderInput: root.querySelector(".pix-lif-folder"),
    browseBtn: root.querySelector(".pix-lif-browse"),
    pickBtn: root.querySelector(".pix-lif-pick"),
    msgEl: root.querySelector(".pix-lif-msg"),
    resizeSlot: root.querySelector(".pix-lif-resize-slot"),
  };
}

const SORTS = [
  { value: "name|asc", label: "Name ↑" },
  { value: "name|desc", label: "Name ↓" },
  { value: "date|asc", label: "Date ↑" },
  { value: "date|desc", label: "Date ↓" },
];

// ── the multi-select "Pick images" gallery ──────────────────────────────────
// ctx: { onChange(node), refreshListing(node):Promise }
export function openPickGallery(node, anchorEl, ctx) {
  document.querySelectorAll(".pix-lif-gallery").forEach((g) => g._pixClose?.());
  const gal = document.createElement("div");
  gal.className = "pix-lif-gallery";
  gal.innerHTML =
    `<div class="pix-lif-gal-head">` +
    `<div class="pix-lif-tbtn" data-act="all">Select all</div>` +
    `<div class="pix-lif-tbtn" data-act="none">None</div>` +
    `<div class="pix-lif-firstwrap"><div class="pix-lif-tbtn" data-act="first">First</div>` +
    `<input class="pix-lif-firstn" type="number" min="1" value="5"></div>` +
    `<div class="pix-lif-count"><b class="pix-lif-cn">0</b> / <span class="pix-lif-ct">0</span> selected</div>` +
    `</div>` +
    `<div class="pix-lif-gal-body"><div class="pix-lif-grid"></div></div>` +
    `<div class="pix-lif-gal-foot">` +
    `<div class="pix-lif-subf"><span class="box"></span> Include subfolders</div>` +
    `<div class="pix-lif-tbtn" data-act="sort">Sort: Name ↑</div>` +
    `<div class="pix-lif-done" data-act="done">Done</div>` +
    `</div>`;
  document.body.appendChild(gal);

  const grid = gal.querySelector(".pix-lif-grid");
  const cnEl = gal.querySelector(".pix-lif-cn");
  const ctEl = gal.querySelector(".pix-lif-ct");
  const firstInput = gal.querySelector(".pix-lif-firstn");
  const subfEl = gal.querySelector(".pix-lif-subf");
  const sortBtn = gal.querySelector('[data-act="sort"]');

  let state = readState(node);
  const selSet = new Set(state.selected || []);

  function sortLabel() {
    return SORTS.find((s) => s.value === `${state.sort}|${state.sort_dir}`)?.label || "Name ↑";
  }
  function updateCounts() {
    cnEl.textContent = selSet.size;
    ctEl.textContent = (node._pixLifFiles || []).length;
  }
  function commit() {
    const sorted = sortFiles(node._pixLifFiles || [], state.sort, state.sort_dir);
    state.selected = sorted.map((f) => f.file).filter((f) => selSet.has(f));
    writeState(node, state);
    updateCounts();
    ctx.onChange?.(node);
  }
  function renderGrid() {
    grid.innerHTML = "";
    sortBtn.textContent = `Sort: ${sortLabel()}`;
    subfEl.classList.toggle("on", !!state.recursive);
    const files = node._pixLifFiles || [];
    if (!files.length) {
      const empty = document.createElement("div");
      empty.className = "pix-lif-gal-empty";
      empty.textContent = node._pixLifListError || "No images in this folder.";
      grid.appendChild(empty);
      updateCounts();
      return;
    }
    const sorted = sortFiles(files, state.sort, state.sort_dir);
    for (const f of sorted) {
      const cell = document.createElement("div");
      cell.className = "pix-lif-thumb" + (selSet.has(f.file) ? " sel" : "");
      cell.innerHTML =
        `<img loading="lazy" src="${thumbURL(state.folder, f.file, f.mtime)}">` +
        `<div class="veil"></div><div class="chk">✓</div>` +
        `<div class="nm">${escapeHtml(f.name)}</div>`;
      cell.addEventListener("click", () => {
        if (selSet.has(f.file)) selSet.delete(f.file);
        else selSet.add(f.file);
        cell.classList.toggle("sel");
        commit();
      });
      grid.appendChild(cell);
    }
    updateCounts();
  }

  gal.querySelector('[data-act="all"]').addEventListener("click", () => {
    (node._pixLifFiles || []).forEach((f) => selSet.add(f.file));
    renderGrid();
    commit();
  });
  gal.querySelector('[data-act="none"]').addEventListener("click", () => {
    selSet.clear();
    renderGrid();
    commit();
  });
  gal.querySelector('[data-act="first"]').addEventListener("click", () => {
    const n = Math.max(0, parseInt(firstInput.value) || 0);
    selSet.clear();
    sortFiles(node._pixLifFiles || [], state.sort, state.sort_dir)
      .slice(0, n)
      .forEach((f) => selSet.add(f.file));
    renderGrid();
    commit();
  });
  firstInput.addEventListener("keydown", (e) => e.stopPropagation());
  sortBtn.addEventListener("click", () => {
    openMiniMenu(sortBtn, SORTS, `${state.sort}|${state.sort_dir}`, (val) => {
      const [s, d] = val.split("|");
      state.sort = s;
      state.sort_dir = d;
      writeState(node, state);
      commit();
      renderGrid();
    });
  });
  subfEl.addEventListener("click", async () => {
    state.recursive = !state.recursive;
    writeState(node, state);
    subfEl.classList.toggle("on", state.recursive);
    grid.innerHTML = `<div class="pix-lif-gal-empty">Loading…</div>`;
    await ctx.refreshListing(node);
    state = readState(node);
    selSet.clear();
    (state.selected || []).forEach((f) => selSet.add(f));
    renderGrid();
  });
  gal.querySelector('[data-act="done"]').addEventListener("click", () => gal._pixClose?.());

  attachClosePopup(gal);
  positionBelow(gal, anchorEl, Math.min(560, window.innerWidth - 16));
  renderGrid();
}

// ── the in-app folder browser ────────────────────────────────────────────────
// ctx: { startPath, onPick(folderPath) }
export function openBrowsePopup(node, anchorEl, ctx) {
  document.querySelectorAll(".pix-lif-browse-pop").forEach((p) => p._pixClose?.());
  const pop = document.createElement("div");
  pop.className = "pix-lif-browse-pop";
  pop.innerHTML =
    `<div class="pix-lif-bp-head">Choose a folder</div>` +
    `<div class="pix-lif-bp-crumb"></div>` +
    `<div class="pix-lif-bp-list"></div>` +
    `<div class="pix-lif-bp-foot">` +
    `<div class="pix-lif-tbtn" data-act="cancel">Cancel</div>` +
    `<div class="pix-lif-done" data-act="use">Use this folder</div>` +
    `</div>`;
  document.body.appendChild(pop);

  const crumb = pop.querySelector(".pix-lif-bp-crumb");
  const list = pop.querySelector(".pix-lif-bp-list");
  let cur = ctx.startPath || "";

  async function nav(path) {
    list.innerHTML = `<div class="pix-lif-bp-empty">Loading…</div>`;
    const res = await browseFolder(path);
    if (!res.ok) {
      list.innerHTML = `<div class="pix-lif-bp-empty">${escapeHtml(res.message || "Could not open this folder.")}</div>`;
      return;
    }
    cur = res.path || "";
    crumb.innerHTML = cur ? `Location: <b style="color:#ddd">${escapeHtml(cur)}</b>` : "This PC";
    list.innerHTML = "";
    if (res.parent !== null && res.parent !== undefined) {
      const up = document.createElement("div");
      up.className = "pix-lif-bp-item up";
      up.innerHTML = `<span style="width:13px;text-align:center;flex:0 0 auto">↰</span> <span class="nm">.. (up one level)</span>`;
      up.addEventListener("click", () => nav(res.parent || ""));
      list.appendChild(up);
    }
    if (!res.dirs.length) {
      const e = document.createElement("div");
      e.className = "pix-lif-bp-empty";
      e.textContent = cur ? "No sub-folders — use this folder." : "No drives found.";
      list.appendChild(e);
    }
    for (const d of res.dirs) {
      const it = document.createElement("div");
      it.className = "pix-lif-bp-item";
      const cnt = d.images >= 0 ? `<span class="cnt">${d.images} image${d.images === 1 ? "" : "s"}</span>` : "";
      it.innerHTML = `${FOLDER_SVG}<span class="nm">${escapeHtml(d.name)}</span>${cnt}`;
      it.addEventListener("click", () => nav(d.path));
      list.appendChild(it);
    }
  }

  pop.querySelector('[data-act="cancel"]').addEventListener("click", () => pop._pixClose?.());
  pop.querySelector('[data-act="use"]').addEventListener("click", () => {
    if (cur) ctx.onPick(cur);
    pop._pixClose?.();
  });

  attachClosePopup(pop);
  positionBelow(pop, anchorEl, Math.min(440, window.innerWidth - 16));
  nav(cur);
}
