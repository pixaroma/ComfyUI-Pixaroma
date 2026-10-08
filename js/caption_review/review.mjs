// Caption Review Pixaroma - the review window.
//
// Every picture of a folder with its .txt caption under it, editable. READS come
// from the read-only caption_review/list route; WRITES go through Save Text's
// existing save_text/write route (claim:false = replace the named file), so the
// feature adds no write route (registry-compliance.md 4e #2).
//
// A card is saved ONLY under its caption's own name. The write route cleans a
// name (a leading _, a double __, a trailing dot ...), and a cleaned name would
// be a SECOND file beside the picture, so the route marks such cards read_only
// (_text_folder_helpers.save_name_changes) and this window never writes them.
// After every write the answer's `file` is compared with the name asked for.
//
// While the window is open, ComfyUI's Ctrl+Z is held off with the shared guard
// (graph-undo-guard.md): typing Ctrl+Z in a caption must undo the TEXT, never
// reload the graph underneath the window.

import { pixApiUrl } from "../shared/api_url.mjs";
import { installGraphUndoGuard } from "../shared/graph_undo_guard.mjs";

const CSS = `
.pix-cr-overlay { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,.72); display:flex; align-items:center; justify-content:center; font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif; }
.pix-cr-win { width:min(1240px,96vw); height:92vh; background:#1b1b1b; border:1px solid var(--pix-acc,#f66744); border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,.6); display:flex; flex-direction:column; overflow:hidden; color:#ddd; }
.pix-cr-head { flex-shrink:0; display:flex; align-items:baseline; gap:12px; padding:12px 16px 6px; }
.pix-cr-title { font-size:16px; font-weight:600; color:var(--pix-acc,#f66744); white-space:nowrap; }
.pix-cr-folder { font-size:11px; color:#999; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1; }
.pix-cr-count { font-size:12px; color:#bbb; white-space:nowrap; }
.pix-cr-tools { flex-shrink:0; display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:6px 16px 10px; border-bottom:1px solid #333; }
.pix-cr-find { width:220px; background:#141414; border:1px solid rgba(255,255,255,.16); border-radius:6px; color:#ddd; font-size:12px; padding:6px 8px; box-sizing:border-box; }
.pix-cr-find:focus { outline:none; border-color:var(--pix-acc,#f66744); }
.pix-cr-tog { display:flex; align-items:center; gap:6px; font-size:12px; color:#bbb; cursor:pointer; user-select:none; padding:4px 2px; }
.pix-cr-tog .box { width:13px; height:13px; border:1px solid #555; border-radius:3px; box-sizing:border-box; }
.pix-cr-tog.on .box { background:var(--pix-acc,#f66744); border-color:var(--pix-acc,#f66744); }
.pix-cr-btn { box-sizing:border-box; min-width:86px; text-align:center; user-select:none; cursor:pointer; font-size:12px; padding:6px 14px; border-radius:6px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.05); color:#ddd; }
.pix-cr-btn:hover { border-color:var(--pix-acc,#f66744); }
.pix-cr-btn.main { background:var(--pix-acc,#f66744); border-color:var(--pix-acc,#f66744); color:#fff; }
.pix-cr-btn.main:hover { filter:brightness(1.08); }
.pix-cr-btn.off { opacity:.45; pointer-events:none; }
.pix-cr-spacer { flex:1; }
.pix-cr-msg { flex-shrink:0; min-height:18px; padding:6px 16px 0; font-size:12px; color:#bbb; }
.pix-cr-msg.bad { color:#ff8a7a; }
.pix-cr-msg.good { color:#3ec371; }
.pix-cr-ask { flex-shrink:0; display:none; align-items:center; gap:8px; margin:8px 16px 0; padding:8px 12px; border:1px solid var(--pix-acc,#f66744); border-radius:7px; background:rgba(255,255,255,.04); font-size:12px; }
.pix-cr-ask.show { display:flex; }
.pix-cr-body { flex:1; min-height:0; overflow:auto; padding:12px 16px 16px; }
.pix-cr-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px; }
.pix-cr-card { display:flex; flex-direction:column; gap:6px; background:#222; border:1px solid #333; border-radius:8px; padding:8px; min-width:0; }
.pix-cr-card.changed { border-color:var(--pix-acc,#f66744); }
.pix-cr-pic { height:192px; display:flex; align-items:center; justify-content:center; background:#0f0f0f; border-radius:5px; overflow:hidden; flex-shrink:0; }
.pix-cr-pic img { max-width:100%; max-height:100%; display:block; }
.pix-cr-name { display:flex; align-items:center; gap:6px; font-size:11px; color:#ccc; min-width:0; flex-shrink:0; }
.pix-cr-name .nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1; }
.pix-cr-chip { flex-shrink:0; font-size:10px; padding:1px 6px; border-radius:9px; background:rgba(255,255,255,.08); color:#bbb; }
.pix-cr-chip.miss { background:rgba(246,103,68,.18); color:#ffb39f; }
.pix-cr-chip.chg { background:var(--pix-acc,#f66744); color:#fff; }
.pix-cr-text { width:100%; min-height:150px; resize:vertical; box-sizing:border-box; background:#1d1d1d; color:#e0e0e0; border:1px solid #333; border-radius:5px; font:12px/1.45 'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif; padding:6px 7px; flex-shrink:0; }
.pix-cr-text:focus { outline:none; border-color:var(--pix-acc,#f66744); }
.pix-cr-text[readonly] { background:#2d2d2d; border-color:#3a3a3a; color:#d8d8d8; }
.pix-cr-foot { font-size:10px; color:#888; flex-shrink:0; }
.pix-cr-empty { padding:40px; text-align:center; color:#999; font-size:13px; grid-column:1/-1; }
`;

function injectCSS() {
  if (document.getElementById("pix-cr-css")) return;
  const s = document.createElement("style");
  s.id = "pix-cr-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const words = (s) => (String(s || "").trim() ? String(s).trim().split(/\s+/).length : 0);

function thumbURL(folder, rel, mtime) {
  return pixApiUrl(`/pixaroma/api/load_images_folder/thumb?path=${encodeURIComponent(folder)}&file=${encodeURIComponent(rel)}&mt=${Math.floor(mtime || 0)}`);
}

async function listFolder(folder) {
  try {
    const r = await fetch(pixApiUrl(`/pixaroma/api/caption_review/list?path=${encodeURIComponent(folder || "")}`), { cache: "no-store" });
    return await r.json();
  } catch (e) {
    return { ok: false, message: String(e), items: [] };
  }
}

async function writeCaption(folder, stem, text) {
  try {
    const r = await fetch(pixApiUrl("/pixaroma/api/save_text/write"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, name: stem, content: text, claim: false, digits: 3 }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, message: "Could not reach the server to save." };
  }
}

// Opens the window for `node`; `folder` is the node's folder field. Only one at a time.
export function openCaptionReview(node, folder) {
  if (node._pixCrWindow?.isConnected) return;
  injectCSS();
  const ov = document.createElement("div");
  ov.className = "pix-cr-overlay";
  ov.innerHTML =
    `<div class="pix-cr-win" role="dialog" aria-label="Caption Review">` +
    `<div class="pix-cr-head"><div class="pix-cr-title">Caption Review</div><div class="pix-cr-folder"></div><div class="pix-cr-count"></div></div>` +
    `<div class="pix-cr-tools">` +
    `<input class="pix-cr-find" type="text" spellcheck="false" placeholder="Find a word in the captions" title="Show only the pictures whose caption or name contains this">` +
    `<div class="pix-cr-tog" data-tog="missing" title="Show only the pictures that have no caption yet"><span class="box"></span> Only without a caption</div>` +
    `<div class="pix-cr-tog" data-tog="changed" title="Show only the captions you changed and did not save yet"><span class="box"></span> Only changed</div>` +
    `<div class="pix-cr-spacer"></div>` +
    `<div class="pix-cr-btn" data-act="reload" title="Read the folder again">Reload</div>` +
    `<div class="pix-cr-btn main off" data-act="save" title="Write every changed caption to its .txt file (Ctrl+S)">Save changes</div>` +
    `<div class="pix-cr-btn" data-act="close" title="Close the window (Esc)">Close</div>` +
    `</div>` +
    `<div class="pix-cr-ask"><span class="q"></span><div class="pix-cr-spacer"></div>` +
    `<div class="pix-cr-btn main" data-ask="save">Save and close</div>` +
    `<div class="pix-cr-btn" data-ask="discard">Close without saving</div>` +
    `<div class="pix-cr-btn" data-ask="stay">Keep editing</div></div>` +
    `<div class="pix-cr-msg"></div>` +
    `<div class="pix-cr-body"><div class="pix-cr-grid"><div class="pix-cr-empty">Reading the folder...</div></div></div>` +
    `</div>`;
  document.body.appendChild(ov);
  node._pixCrWindow = ov;

  const q = (s) => ov.querySelector(s);
  const grid = q(".pix-cr-grid");
  const msg = q(".pix-cr-msg");
  const saveBtn = q('[data-act="save"]');
  const find = q(".pix-cr-find");
  const ask = q(".pix-cr-ask");
  const view = { missing: false, changed: false, text: "" };
  let data = { folder: "", items: [] };
  let saving = false;

  const undoOff = installGraphUndoGuard(() => ov.isConnected);

  function say(text, kind) {
    msg.textContent = text || "";
    msg.className = "pix-cr-msg" + (kind ? " " + kind : "");
  }
  const changedItems = () => data.items.filter((it) => !it.read_only && it.value !== it.caption);
  function syncCounts() {
    const n = data.items.length;
    const withCap = data.items.filter((it) => it.has_caption).length;
    const ch = changedItems().length;
    q(".pix-cr-count").textContent = n ? `${n} pictures · ${withCap} with a caption · ${n - withCap} without` : "";
    saveBtn.textContent = ch ? `Save changes (${ch})` : "Save changes";
    saveBtn.classList.toggle("off", !ch || saving);
  }
  function visible(it) {
    if (view.missing && it.has_caption) return false;
    if (view.changed && it.value === it.caption) return false;
    const t = view.text.trim().toLowerCase();
    if (t && !(it.value.toLowerCase().includes(t) || it.name.toLowerCase().includes(t))) return false;
    return true;
  }
  function chipFor(it) {
    if (it.read_only) return `<span class="pix-cr-chip" title="${esc(it.too_big ? "This caption file is too big to edit here. Open the .txt file itself." : "This name has characters a saved file name cannot keep (such as a _ at the start), so it would be saved under another name. Rename the picture, or edit its .txt file directly.")}">read-only</span>`;
    if (it.value !== it.caption) return `<span class="pix-cr-chip chg">changed</span>`;
    if (!it.has_caption) return `<span class="pix-cr-chip miss">no caption</span>`;
    return `<span class="pix-cr-chip">${esc(it.caption_file)}</span>`;
  }
  function renderCard(it) {
    const card = document.createElement("div");
    card.className = "pix-cr-card" + (it.value !== it.caption ? " changed" : "");
    card.innerHTML =
      `<div class="pix-cr-pic"><img loading="lazy" alt="" src="${thumbURL(data.folder, it.file, it.mtime)}" onerror="this.style.display='none'"></div>` +
      `<div class="pix-cr-name"><span class="nm" title="${esc(it.name)}">${esc(it.name)}</span>${chipFor(it)}</div>` +
      `<textarea class="pix-cr-text" spellcheck="true" placeholder="${it.read_only ? "" : "No caption yet: type one and Save"}"></textarea>` +
      `<div class="pix-cr-foot"></div>`;
    const ta = card.querySelector("textarea");
    const foot = card.querySelector(".pix-cr-foot");
    ta.value = it.value;
    ta.readOnly = !!it.read_only;
    const syncFoot = () => { foot.textContent = `${words(ta.value)} words`; };
    syncFoot();
    ta.addEventListener("input", () => {
      it.value = ta.value;
      card.classList.toggle("changed", it.value !== it.caption);
      card.querySelector(".pix-cr-name").lastElementChild.outerHTML = chipFor(it);
      syncFoot();
      syncCounts();
    });
    return card;
  }
  function render() {
    grid.innerHTML = "";
    const shown = data.items.filter(visible);
    if (!data.items.length) {
      grid.innerHTML = `<div class="pix-cr-empty">No pictures in this folder.</div>`;
    } else if (!shown.length) {
      grid.innerHTML = `<div class="pix-cr-empty">No picture matches.</div>`;
    } else {
      const frag = document.createDocumentFragment();
      for (const it of shown) frag.appendChild(renderCard(it));
      grid.appendChild(frag);
    }
    syncCounts();
  }
  async function load() {
    say("");
    grid.innerHTML = `<div class="pix-cr-empty">Reading the folder...</div>`;
    const r = await listFolder(folder);
    if (!ov.isConnected) return;
    if (!r?.ok) {
      data = { folder: "", items: [] };
      grid.innerHTML = `<div class="pix-cr-empty">${esc(r?.message || "Could not read the folder.")}</div>`;
      q(".pix-cr-folder").textContent = folder || "ComfyUI output";
      syncCounts();
      return;
    }
    data = { folder: r.folder, items: (r.items || []).map((it) => ({ ...it, value: it.caption })) };
    q(".pix-cr-folder").textContent = r.folder;
    q(".pix-cr-folder").title = r.folder;
    const notes = [];
    if (r.truncated) notes.push("Only the first 2000 pictures are shown.");
    if (r.orphans) notes.push(`${r.orphans} caption file(s) have no picture with the same name.`);
    if (notes.length) say(notes.join(" "));
    render();
  }

  async function saveAll() {
    if (saving) return true;
    const todo = changedItems();
    if (!todo.length) return true;
    saving = true;
    syncCounts();
    let done = 0;
    const failed = [];
    for (const it of todo) {
      say(`Saving ${done + 1} of ${todo.length}...`);
      const text = it.value;
      const res = await writeCaption(data.folder, it.save_stem, text);
      if (!ov.isConnected) return false;
      const want = it.save_stem + ".txt";
      if (res?.ok && (res.file || "") === want) {
        it.caption = text;
        it.has_caption = true;
        it.caption_file = want;
        done++;
      } else if (res?.ok) {
        // Saved, but under another name: tell, and keep the card marked as changed.
        failed.push(`${it.name}: saved as ${res.file} instead of ${want}`);
      } else {
        failed.push(`${it.name}: ${res?.message || "could not save"}`);
      }
    }
    saving = false;
    render();
    if (failed.length) {
      say(`${done} saved, ${failed.length} not: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? " ..." : ""}`, "bad");
      return false;
    }
    say(`✓ ${done} caption${done === 1 ? "" : "s"} saved`, "good");
    return true;
  }

  function close(force) {
    const ch = changedItems().length;
    if (!force && ch) {
      ask.querySelector(".q").textContent = `${ch} caption${ch === 1 ? " is" : "s are"} not saved.`;
      ask.classList.add("show");
      return;
    }
    window.removeEventListener("keydown", onKey, true);
    try { undoOff(); } catch { /* already released */ }
    ov.remove();
    if (node._pixCrWindow === ov) node._pixCrWindow = null;
  }
  node._pixCrClose = () => close(true);

  function onKey(e) {
    if (!ov.isConnected) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (ask.classList.contains("show")) ask.classList.remove("show");
      else close(false);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      // Ctrl+S here saves the captions, never the workflow underneath.
      e.preventDefault();
      e.stopImmediatePropagation();
      saveAll();
    }
  }
  window.addEventListener("keydown", onKey, true);

  find.addEventListener("input", () => { view.text = find.value; render(); });
  ov.querySelectorAll(".pix-cr-tog").forEach((el) => el.addEventListener("click", () => {
    const k = el.dataset.tog;
    view[k] = !view[k];
    el.classList.toggle("on", view[k]);
    render();
  }));
  q('[data-act="reload"]').addEventListener("click", () => {
    if (changedItems().length) { say("Save or undo your changes before reloading.", "bad"); return; }
    load();
  });
  saveBtn.addEventListener("click", () => saveAll());
  q('[data-act="close"]').addEventListener("click", () => close(false));
  ask.querySelector('[data-ask="save"]').addEventListener("click", async () => {
    ask.classList.remove("show");
    if (await saveAll()) close(true);
  });
  ask.querySelector('[data-ask="discard"]').addEventListener("click", () => close(true));
  ask.querySelector('[data-ask="stay"]').addEventListener("click", () => ask.classList.remove("show"));
  // a click on the dark backdrop (outside the window) is a Close
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(false); });

  load();
}
