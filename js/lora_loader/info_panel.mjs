// LoRA Loader Pixaroma - the info panel (click a row's i). Shows the LoRA's info +
// trigger words read straight from the file, lets the user tick which words feed
// the triggers output, and offers the OPTIONAL Civitai lookup with its four states
// (searching / found / not found / offline). Selections persist on the row.

import { readState, patchLora, accentOf, BRAND } from "./core.mjs";
import { loraInfo, thumbUrl, civitaiLookup, invalidateInfo, deleteCivitai } from "./api.mjs";

let _panel = null;
let _cleanup = null;
let _ownerNode = null;

function injectCSS() {
  if (document.getElementById("pix-ll-info-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ll-info-css";
  s.textContent = `
    .pix-ll-info-p { position:fixed; z-index:10025; width:340px; max-width:94vw; background:#2b2b2b;
      border:1px solid ${BRAND}; border-radius:10px; box-shadow:0 14px 44px rgba(0,0,0,0.6);
      overflow:hidden; font:12px 'Segoe UI',system-ui,sans-serif; color:#ddd; }
    .pix-ll-info-top { display:flex; gap:11px; padding:12px; border-bottom:1px solid #1c1c1c; cursor:grab; }
    .pix-ll-info-th { width:64px; height:64px; border-radius:7px; flex:none; border:1px solid #000;
      background:radial-gradient(circle at 60% 35%,#4a3a5b,#221a2e 72%); background-size:cover; background-position:center; }
    .pix-ll-info-h { min-width:0; flex:1; }
    .pix-ll-info-h h3 { margin:0 0 4px; font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-ll-info-meta { font:10px monospace; color:#7a7a7a; line-height:1.7; }
    .pix-ll-civlink { display:inline-block; margin-top:5px; font:10.5px 'Segoe UI'; color:#8fc0ff;
      cursor:pointer; }
    .pix-ll-civlink:hover { color:#b8d8ff; text-decoration:underline; }
    .pix-ll-info-x { margin-left:auto; color:#8a8a8a; cursor:pointer; align-self:flex-start; }
    .pix-ll-info-x:hover { color:#fff; }
    .pix-ll-info-sec { padding:11px 12px; }
    .pix-ll-info-sec h4 { margin:0 0 6px; font:600 9.5px 'Segoe UI'; text-transform:uppercase; letter-spacing:.7px;
      color:${BRAND}; display:flex; align-items:center; gap:7px; }
    .pix-ll-info-sec h4 .src { margin-left:auto; font:9px 'Segoe UI'; text-transform:none; letter-spacing:0;
      color:#8a8a8a; border:1px solid #444; border-radius:99px; padding:1px 7px; }
    .pix-ll-info-sec h4 .src.net { color:#8fc0ff; border-color:#3a5a80; }
    .pix-ll-info-sec h4 .qa { margin-left:8px; font:9.5px 'Segoe UI'; text-transform:none; letter-spacing:0;
      color:#9a9a9a; cursor:pointer; }
    .pix-ll-info-sec h4 .qa:hover { color:${BRAND}; }
    .pix-ll-info-note { font-size:10px; color:#7a7a7a; margin:0 0 8px; }
    .pix-ll-chips { display:flex; flex-wrap:wrap; gap:5px; max-height:36vh; overflow-y:auto; padding-right:2px; }
    .pix-ll-chips::-webkit-scrollbar { width:7px; }
    .pix-ll-chips::-webkit-scrollbar-thumb { background:#555; border-radius:3px; }
    .pix-ll-chip { font:10.5px 'Segoe UI'; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
      color:#b8b8b8; border-radius:99px; padding:3px 9px; cursor:pointer; user-select:none; display:flex; align-items:center; gap:4px; max-width:100%; }
    .pix-ll-chip:hover { border-color:${BRAND}; }
    .pix-ll-chip.sel { background:rgba(246,103,68,0.18); border-color:${BRAND}; color:#f8a48c; }
    .pix-ll-chip.sel::before { content:"✓"; font-size:9px; flex:none; }
    .pix-ll-chip .ct { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-ll-chip-none { color:#777; font-size:11px; }
    .pix-ll-chip .cx { margin-left:1px; color:#f8a48c; cursor:pointer; opacity:.6; font-size:10px; flex:none; }
    .pix-ll-chip .cx:hover { opacity:1; }
    .pix-ll-srctoggle { margin-left:auto; display:flex; border:1px solid #444; border-radius:99px; overflow:hidden; }
    .pix-ll-srctoggle .sg { font:9px 'Segoe UI'; text-transform:none; letter-spacing:0; color:#9a9a9a; padding:2px 9px; cursor:pointer; }
    .pix-ll-srctoggle .sg:hover { color:#ddd; }
    .pix-ll-srctoggle .sg.on { background:${BRAND}; color:#fff; }
    .pix-ll-addtrig { display:flex; gap:5px; margin-top:8px; }
    .pix-ll-addtrig input { flex:1; min-width:0; box-sizing:border-box; background:#161616;
      border:1px solid rgba(255,255,255,0.14); border-radius:6px; color:#fff; font:11px 'Segoe UI';
      padding:5px 8px; outline:none; }
    .pix-ll-addtrig input:focus { border-color:${BRAND}; }
    .pix-ll-addtrig button { flex:0 0 auto; background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.14); color:#ccc; border-radius:6px; padding:5px 11px;
      font:11px 'Segoe UI'; cursor:pointer; }
    .pix-ll-addtrig button:hover { border-color:${BRAND}; color:#fff; }
    .pix-ll-strip { margin:0 12px 11px; border-radius:7px; padding:9px 10px; font-size:11px; line-height:1.5;
      display:flex; gap:9px; align-items:flex-start; }
    .pix-ll-strip .st-ic { flex:none; width:18px; height:18px; border-radius:50%; color:#fff; font-size:11px;
      display:flex; align-items:center; justify-content:center; }
    .pix-ll-strip.searching { background:rgba(90,160,230,0.12); } .pix-ll-strip.searching .st-ic { background:#5aa0e6; }
    .pix-ll-strip.found { background:rgba(62,195,113,0.12); } .pix-ll-strip.found .st-ic { background:#3ec371; }
    .pix-ll-strip.nofind { background:rgba(255,255,255,0.05); } .pix-ll-strip.nofind .st-ic { background:#6f6f6f; }
    .pix-ll-strip.offline { background:rgba(233,165,61,0.12); } .pix-ll-strip.offline .st-ic { background:#e9a53d; }
    .pix-ll-spin { width:11px; height:11px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff;
      border-radius:50%; animation:pix-ll-sp 1s linear infinite; }
    @keyframes pix-ll-sp { to { transform:rotate(360deg); } }
    .pix-ll-info-foot { display:flex; gap:6px; padding:10px 12px; border-top:1px solid #1c1c1c; background:#242424; }
    .pix-ll-info-foot .b { flex:1; text-align:center; font-size:11px; padding:7px; border-radius:5px; cursor:pointer; }
    .pix-ll-info-foot .b.pri { background:${BRAND}; color:#fff; font-weight:600; }
    .pix-ll-info-foot .b.gh { border:1px solid rgba(255,255,255,0.14); color:#b8b8b8; }
    .pix-ll-info-foot .b.gh:hover { border-color:${BRAND}; color:#fff; }
    .pix-ll-info-foot .b.dis { opacity:.4; pointer-events:none; }
    .pix-ll-info-foot .b.del { flex:0 0 auto; min-width:38px; border:1px solid rgba(255,255,255,0.14); color:#c9736a; }
    .pix-ll-info-foot .b.del:hover { border-color:#e0604a; color:#fff; background:rgba(224,96,74,0.12); }
  `;
  document.head.appendChild(s);
}

export function closeInfoPanel() {
  if (_cleanup) { try { _cleanup(); } catch {} }
  _cleanup = null;
  if (_panel) { try { _panel.remove(); } catch {} }
  _panel = null;
  _ownerNode = null;
}

// Close only when THIS node owns the open panel (so deleting an unrelated LoRA
// Loader node doesn't yank away another node's open info panel).
export function closeInfoPanelFor(node) { if (_ownerNode === node) closeInfoPanel(); }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function nodeRect(node) {
  if (node?.id != null) {
    const e = document.querySelector(`[data-node-id="${node.id}"]`);
    if (e) return e.getBoundingClientRect();
  }
  return null;
}

export async function openInfoPanel(node, id, refresh) {
  closeInfoPanel();
  injectCSS();
  const entry0 = readState(node).loras.find((e) => e.id === id);
  if (!entry0) return;
  const name = entry0.name;
  const accent = accentOf(node);

  const panel = el("div", "pix-ll-info-p");
  panel.style.borderColor = accent;
  document.body.appendChild(panel);
  _panel = panel;
  _ownerNode = node;

  // view data for this panel session
  let info = { title: name || "LoRA", triggers: [], file_triggers: [], sidecar_triggers: [], source: "file", has_preview: false };
  let civ = null; // { state:"searching"|"found"|"nofind"|"offline", info?, message? }
  // Which set of candidate words to SHOW: "file" | "civitai". null = auto (Civitai
  // when a saved sidecar / fresh lookup exists, else the file's own words). The
  // user's SELECTED words persist regardless of the view (they live in row.triggers).
  let viewSource = null;

  const selected = () => new Set((readState(node).loras.find((e) => e.id === id)?.triggers || []).map((w) => w.toLowerCase()));

  function toggleWord(word) {
    const st = readState(node);
    const e = st.loras.find((x) => x.id === id);
    if (!e) return;
    const key = word.toLowerCase();
    const has = e.triggers.some((w) => w.toLowerCase() === key);
    const next = has ? e.triggers.filter((w) => w.toLowerCase() !== key) : [...e.triggers, word];
    patchLora(node, id, { triggers: next });
    refresh?.(false);
    renderBody();
  }
  function setWords(words) {
    patchLora(node, id, { triggers: words.slice() });
    refresh?.(false);
    renderBody();
  }

  // True when we have Civitai words available (a saved sidecar or a just-fetched result).
  function civitaiAvailable() {
    return (info.sidecar_triggers?.length || 0) > 0 || civ?.state === "found";
  }
  function fileWords() { return info.file_triggers?.length ? info.file_triggers : (info.triggers || []); }
  function civitaiWords() {
    if (info.sidecar_triggers?.length) return info.sidecar_triggers;
    if (civ?.state === "found") return civ.info?.triggers || [];
    return [];
  }
  // The active view source: honour the user's toggle, else auto.
  function effectiveSource() {
    if (viewSource === "file" || viewSource === "civitai") return viewSource;
    return civitaiAvailable() ? "civitai" : "file";
  }
  // The candidate words shown for the current view.
  function sourceWords() {
    return effectiveSource() === "civitai" ? (civitaiWords().length ? civitaiWords() : fileWords()) : fileWords();
  }

  // Chips shown: source words + the user's custom words + anything selected, de-duped.
  // `isCustom` is by MEMBERSHIP in `custom` (not push order), so a custom word that also
  // becomes a source word (e.g. after a Civitai lookup) still carries a removable ✕.
  function chipList() {
    const src = sourceWords();
    const row = readState(node).loras.find((e) => e.id === id);
    const custom = row?.custom || [];
    const customSet = new Set(custom.map((w) => w.toLowerCase()));
    const out = []; const seen = new Set();
    const push = (w) => {
      const k = w.toLowerCase();
      if (w && !seen.has(k)) { seen.add(k); out.push({ w, isCustom: customSet.has(k) }); }
    };
    for (const w of src) push(w);
    for (const w of custom) push(w);
    for (const w of (row?.triggers || [])) push(w);
    return out;
  }

  function addCustom(word) {
    const w = (word || "").trim();
    if (!w) return;
    const e = readState(node).loras.find((x) => x.id === id);
    if (!e) return;
    const key = w.toLowerCase();
    // If the file / Civitai already offers this word, just select it - don't also stash
    // it in `custom` (that would be a hidden duplicate of a source word).
    const inSrc = sourceWords().some((x) => x.toLowerCase() === key);
    const custom = (inSrc || (e.custom || []).some((x) => x.toLowerCase() === key))
      ? (e.custom || []) : [...(e.custom || []), w];
    const trig = (e.triggers || []).some((x) => x.toLowerCase() === key) ? e.triggers : [...(e.triggers || []), w];
    patchLora(node, id, { custom, triggers: trig }); // added = selected, so it reaches the output
    refresh?.(false);
    renderBody();
    setTimeout(() => panel.querySelector(".pix-ll-addtrig input")?.focus(), 0);
  }

  function removeCustom(word) {
    const key = (word || "").toLowerCase();
    const e = readState(node).loras.find((x) => x.id === id);
    if (!e) return;
    patchLora(node, id, {
      custom: (e.custom || []).filter((x) => x.toLowerCase() !== key),
      triggers: (e.triggers || []).filter((x) => x.toLowerCase() !== key),
    });
    refresh?.(false);
    renderBody();
  }

  function thumb() {
    if (civ?.state === "found" && civ.info?.thumbnail) return civ.info.thumbnail;
    if (info.has_preview && name) return thumbUrl(name);
    return null;
  }

  function renderBody() {
    panel.innerHTML = "";
    const sel = selected();
    const civitaiOn = readState(node).civitai; // re-read so a settings toggle isn't stale

    // ── header ───────────────────────────────────────────────────────────
    const top = el("div", "pix-ll-info-top");
    const th = el("div", "pix-ll-info-th");
    const turl = thumb();
    // Strip quotes/backslashes so a stray char in a Civitai image URL can't break the
    // CSS url() value (thumbUrl(name) is already percent-encoded; civ.info.thumbnail is raw).
    if (turl) th.style.backgroundImage = `url("${String(turl).replace(/["\\]/g, "")}")`;
    const h = el("div", "pix-ll-info-h");
    const title = el("h3", null, (civ?.state === "found" && civ.info?.name) || info.title || "LoRA");
    const metaBits = [];
    if (info.base_model) metaBits.push(info.base_model);
    if (info.rank) metaBits.push("rank " + info.rank + (info.alpha ? " / α" + info.alpha : ""));
    if (info.num_images) metaBits.push(info.num_images + " imgs");
    if (info.date) metaBits.push(String(info.date).slice(0, 10));
    const meta = el("div", "pix-ll-info-meta");
    meta.innerHTML = (metaBits.length ? escapeHtml(metaBits.join(" · ")) : "&nbsp;") +
      "<br>" + escapeHtml(name || "");
    h.append(title, meta);
    // Link to the Civitai model page when we know the id. Take BOTH ids from ONE
    // source (a live lookup, else the offline/cached info) so the model+version pair
    // can't be mixed across sources.
    const idSrc = (civ?.state === "found") ? civ.info : info;
    const mid = idSrc?.model_id;
    const vid = idSrc?.version_id;
    if (mid != null) {
      const link = el("span", "pix-ll-civlink", "View on Civitai ↗");
      link.addEventListener("click", () => {
        const u = "https://civitai.com/models/" + mid + (vid ? "?modelVersionId=" + vid : "");
        window.open(u, "_blank", "noopener");
      });
      h.appendChild(link);
    }
    const x = el("span", "pix-ll-info-x", "✕");
    x.addEventListener("click", closeInfoPanel);
    top.append(th, h, x);
    panel.appendChild(top);

    // ── optional Civitai status strip ────────────────────────────────────
    if (civ) panel.appendChild(civStrip());

    // ── trigger words ────────────────────────────────────────────────────
    const sec = el("div", "pix-ll-info-sec");
    const head = el("h4");
    head.appendChild(el("span", null, "Trigger words"));
    const all = el("span", "qa", "all");
    all.title = "Select every word";
    all.addEventListener("click", () => setWords(chipList().map((c) => c.w)));
    const none = el("span", "qa", "none");
    none.title = "Clear selection";
    none.addEventListener("click", () => setWords([]));
    head.append(all, none);
    // Source: a File / Civitai toggle when BOTH sets exist, else a plain badge.
    if (civitaiAvailable() && fileWords().length) {
      const es = effectiveSource();
      const seg = el("div", "pix-ll-srctoggle");
      const fBtn = el("span", "sg" + (es === "file" ? " on" : ""), "File");
      fBtn.title = "Show the LoRA's own words (from the file)";
      fBtn.addEventListener("click", () => { viewSource = "file"; renderBody(); });
      const cBtn = el("span", "sg" + (es === "civitai" ? " on" : ""), "Civitai");
      cBtn.title = "Show the saved Civitai words";
      cBtn.addEventListener("click", () => { viewSource = "civitai"; renderBody(); });
      seg.append(fBtn, cBtn);
      head.appendChild(seg);
    } else {
      const srcBadge = el("span", "src" + (info.source === "civitai" ? " net" : ""),
        civ?.state === "found" ? "from Civitai" : info.source === "sidecar" ? "from Civitai (saved)" : "from file");
      head.appendChild(srcBadge);
    }
    sec.appendChild(head);
    sec.appendChild(el("p", "pix-ll-info-note",
      "Tap the ones you want. Only these, and only if the LoRA is on, reach the triggers output."));

    const chips = el("div", "pix-ll-chips");
    const list = chipList();
    if (!list.length) {
      chips.appendChild(el("span", "pix-ll-chip-none",
        "No trigger words in this file - add your own below" + (civitaiOn ? ", or try Civitai." : ".")));
    } else {
      for (const { w, isCustom } of list) {
        const c = el("span", "pix-ll-chip" + (sel.has(w.toLowerCase()) ? " sel" : ""));
        c.title = w;                              // full text on hover (chips truncate to one line)
        c.appendChild(el("span", "ct", w));
        c.addEventListener("click", () => toggleWord(w));
        if (isCustom) {
          const x = el("span", "cx", "✕");
          x.title = "Remove this custom word";
          x.addEventListener("click", (ev) => { ev.stopPropagation(); removeCustom(w); });
          c.appendChild(x);
        }
        chips.appendChild(c);
      }
    }
    sec.appendChild(chips);

    // ── add your own trigger word (persists on this LoRA) ────────────────────
    const addRow = el("div", "pix-ll-addtrig");
    const inp = el("input");
    inp.type = "text";
    inp.placeholder = "add your own trigger word…";
    inp.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); addCustom(inp.value); }
    });
    const addBtn = el("button", null, "Add");
    addBtn.addEventListener("click", () => addCustom(inp.value));
    addRow.append(inp, addBtn);
    sec.appendChild(addRow);

    panel.appendChild(sec);

    // ── footer ───────────────────────────────────────────────────────────
    const foot = el("div", "pix-ll-info-foot");
    const done = el("div", "b pri", "Done");
    done.addEventListener("click", closeInfoPanel);
    foot.appendChild(done);
    if (civitaiOn && name) {
      const searching = civ?.state === "searching";
      const cbtn = el("div", "b gh" + (searching ? " dis" : ""), searching ? "Looking up…" : "↻ Civitai");
      if (!searching) cbtn.addEventListener("click", runCivitai);
      foot.appendChild(cbtn);
    }
    // Delete the saved Civitai info (only when a sidecar exists) - reverts to the file's words.
    if ((info.sidecar_triggers?.length || 0) > 0) {
      const del = el("div", "b del", "🗑");
      del.title = "Delete the saved Civitai info (back to the file's own words)";
      del.addEventListener("click", runDeleteCivitai);
      foot.appendChild(del);
    }
    panel.appendChild(foot);
  }

  function civStrip() {
    const strip = el("div", "pix-ll-strip " +
      (civ.state === "searching" ? "searching" : civ.state === "found" ? "found"
        : civ.state === "offline" ? "offline" : "nofind"));
    const ic = el("span", "st-ic");
    if (civ.state === "searching") ic.appendChild(el("span", "pix-ll-spin"));
    else ic.textContent = civ.state === "found" ? "✓" : civ.state === "offline" ? "!" : "?";
    const body = el("div");
    if (civ.state === "searching") body.textContent = "Looking up on Civitai… matching this file's fingerprint.";
    else if (civ.state === "found") body.innerHTML = "Found on Civitai. Saved next to the file, so it's instant and offline next time.";
    else if (civ.state === "nofind") body.innerHTML = "Not on Civitai. This exact file isn't in their database (it may be private, renamed, or custom-trained). The words read from the file are still shown.";
    else body.textContent = civ.message || "Couldn't reach Civitai. No connection, or it's busy. Use the file's own words, or try again.";
    strip.append(ic, body);
    return strip;
  }

  async function runCivitai() {
    civ = { state: "searching" };
    renderBody();
    const res = await civitaiLookup(name);
    if (!panel.isConnected) return;
    if (res.ok && res.found) {
      civ = { state: "found", info: res.info || {} };
      invalidateInfo(name);
      // refresh offline info so the source badge / cached ids reflect the new sidecar,
      // then repaint (the panel may have been closed meanwhile - guard on isConnected).
      loraInfo(name, true).then((j) => {
        if (j.ok && j.info && panel.isConnected) { info = j.info; renderBody(); }
      });
    } else if (res.reason === "notfound") {
      civ = { state: "nofind" };
    } else {
      civ = { state: "offline", message: res.message };
    }
    renderBody();
  }

  async function runDeleteCivitai() {
    await deleteCivitai(name);
    if (!panel.isConnected) return;
    invalidateInfo(name);                 // drop the cached (sidecar-flavoured) info
    civ = null;
    viewSource = "file";                  // nothing to toggle to now - show the file words
    const fresh = await loraInfo(name, true);
    if (!panel.isConnected) return;
    if (fresh.ok && fresh.info) info = fresh.info;
    renderBody();
  }

  // initial paint from cache, then the real offline read
  renderBody();
  const first = await loraInfo(name);
  if (!panel.isConnected) return;
  if (first.ok && first.info) info = first.info;
  renderBody();

  // place beside the node, drag by the header, close on outside / Esc
  const r = nodeRect(node);
  const pad = 8, gap = 12;
  const pw = panel.offsetWidth, ph = panel.offsetHeight;
  let left = r ? r.right + gap : (window.innerWidth - pw) / 2;
  if (left + pw > window.innerWidth - pad) left = r ? Math.max(pad, r.left - gap - pw) : left;
  let top = r ? r.top : (window.innerHeight - ph) / 2;
  top = Math.max(pad, Math.min(top, window.innerHeight - ph - pad));
  panel.style.left = Math.max(pad, left) + "px";
  panel.style.top = top + "px";
  dragBy(panel);

  const onDown = (e) => { if (!panel.contains(e.target) && !e.target.closest?.(".pix-ll-dd")) closeInfoPanel(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeInfoPanel(); } };
  setTimeout(() => {
    if (_panel !== panel) return; // closed/replaced in the same tick - don't orphan listeners
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  _cleanup = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
}

function dragBy(panel) {
  // Delegate on the PERSISTENT panel: renderBody() rebuilds the header on every
  // re-render (chip tick / Civitai state change), so wiring the header element itself
  // would go dead after the first re-render.
  panel.addEventListener("pointerdown", (e) => {
    if (!e.target.closest?.(".pix-ll-info-top")) return;
    if (e.target.closest(".pix-ll-info-x")) return;
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
