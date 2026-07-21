// LoRA Loader Pixaroma - the info panel (click a row's i). Shows the LoRA's info +
// trigger words read straight from the file, lets the user tick which words feed
// the triggers output, and offers the OPTIONAL Civitai lookup with its four states
// (searching / found / not found / offline). Selections persist on the row.

import { readState, patchLora, accentOf, BRAND } from "./core.mjs";
import { loraInfo, thumbUrl, civitaiLookup, invalidateInfo } from "./api.mjs";

let _panel = null;
let _cleanup = null;
let _ownerNode = null;

function injectCSS() {
  if (document.getElementById("pix-ll-info-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ll-info-css";
  s.textContent = `
    .pix-ll-info-p { position:fixed; z-index:10025; width:280px; max-width:94vw; background:#2b2b2b;
      border:1px solid ${BRAND}; border-radius:10px; box-shadow:0 14px 44px rgba(0,0,0,0.6);
      overflow:hidden; font:12px 'Segoe UI',system-ui,sans-serif; color:#ddd; }
    .pix-ll-info-top { display:flex; gap:11px; padding:12px; border-bottom:1px solid #1c1c1c; cursor:grab; }
    .pix-ll-info-th { width:64px; height:64px; border-radius:7px; flex:none; border:1px solid #000;
      background:radial-gradient(circle at 60% 35%,#4a3a5b,#221a2e 72%); background-size:cover; background-position:center; }
    .pix-ll-info-h { min-width:0; flex:1; }
    .pix-ll-info-h h3 { margin:0 0 4px; font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-ll-info-meta { font:10px monospace; color:#7a7a7a; line-height:1.7; }
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
    .pix-ll-chips { display:flex; flex-wrap:wrap; gap:5px; }
    .pix-ll-chip { font:10.5px 'Segoe UI'; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
      color:#b8b8b8; border-radius:99px; padding:3px 9px; cursor:pointer; user-select:none; display:flex; align-items:center; gap:4px; }
    .pix-ll-chip:hover { border-color:${BRAND}; }
    .pix-ll-chip.sel { background:rgba(246,103,68,0.18); border-color:${BRAND}; color:#f8a48c; }
    .pix-ll-chip.sel::before { content:"✓"; font-size:9px; }
    .pix-ll-chip-none { color:#777; font-size:11px; }
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
  const civitaiOn = readState(node).civitai;

  const panel = el("div", "pix-ll-info-p");
  panel.style.borderColor = accent;
  document.body.appendChild(panel);
  _panel = panel;
  _ownerNode = node;

  // view data for this panel session
  let info = { title: name || "LoRA", triggers: [], source: "file", has_preview: false };
  let civ = null; // { state:"searching"|"found"|"nofind"|"offline", info?, message? }

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

  function currentChips() {
    const civTriggers = civ?.state === "found" ? (civ.info?.triggers || []) : [];
    const src = civTriggers.length ? civTriggers : info.triggers;
    const out = [];
    const seen = new Set();
    for (const w of [...src, ...(readState(node).loras.find((e) => e.id === id)?.triggers || [])]) {
      const k = w.toLowerCase();
      if (w && !seen.has(k)) { seen.add(k); out.push(w); }
    }
    return out;
  }

  function thumb() {
    if (civ?.state === "found" && civ.info?.thumbnail) return civ.info.thumbnail;
    if (info.has_preview && name) return thumbUrl(name);
    return null;
  }

  function renderBody() {
    panel.innerHTML = "";
    const sel = selected();

    // ── header ───────────────────────────────────────────────────────────
    const top = el("div", "pix-ll-info-top");
    const th = el("div", "pix-ll-info-th");
    const turl = thumb();
    if (turl) th.style.backgroundImage = `url("${turl}")`;
    const h = el("div", "pix-ll-info-h");
    const title = el("h3", null, (civ?.state === "found" && civ.info?.name) || info.title || "LoRA");
    const metaBits = [];
    if (info.base_model) metaBits.push(info.base_model);
    if (info.rank) metaBits.push("rank " + info.rank + (info.alpha ? " / α" + info.alpha : ""));
    if (info.num_images) metaBits.push(info.num_images + " imgs");
    if (info.date) metaBits.push(String(info.date).slice(0, 10));
    const meta = el("div", "pix-ll-info-meta");
    meta.innerHTML = (metaBits.join(" · ") || "&nbsp;") + "<br>" + escapeHtml(name || "");
    h.append(title, meta);
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
    all.addEventListener("click", () => setWords(currentChips()));
    const none = el("span", "qa", "none");
    none.title = "Clear selection";
    none.addEventListener("click", () => setWords([]));
    head.append(all, none);
    const srcBadge = el("span", "src" + (info.source === "civitai" ? " net" : ""),
      civ?.state === "found" ? "from Civitai" : info.source === "sidecar" ? "from Civitai (saved)" : "from file");
    head.appendChild(srcBadge);
    sec.appendChild(head);
    sec.appendChild(el("p", "pix-ll-info-note",
      "Tap the ones you want. Only these, and only if the LoRA is on, reach the triggers output."));

    const chips = el("div", "pix-ll-chips");
    const list = currentChips();
    if (!list.length) {
      chips.appendChild(el("span", "pix-ll-chip-none",
        "No trigger words in this file." + (civitaiOn ? " Try the Civitai lookup below." : "")));
    } else {
      for (const w of list) {
        const c = el("span", "pix-ll-chip" + (sel.has(w.toLowerCase()) ? " sel" : ""), w);
        c.addEventListener("click", () => toggleWord(w));
        chips.appendChild(c);
      }
    }
    sec.appendChild(chips);
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
      // refresh offline info so the source badge / sidecar reflect the new cache
      loraInfo(name, true).then((j) => { if (j.ok && j.info) { info = j.info; } });
    } else if (res.reason === "notfound") {
      civ = { state: "nofind" };
    } else {
      civ = { state: "offline", message: res.message };
    }
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
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  _cleanup = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
}

function dragBy(panel) {
  const handle = panel.querySelector(".pix-ll-info-top") || panel;
  handle.addEventListener("pointerdown", (e) => {
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
