import { app } from "/scripts/app.js";
import {
  BRAND, applyAdaptiveCanvasOnly, registerNodeHelp, closeHelpPopup, isVueNodes,
  installResizeFloor, installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { getTags, getCategories, findTag, subscribe, getLibrary as _getLib, setLibrary as _setLib } from "./library.mjs";
import { expandTags, hasTags } from "./expand.mjs";
import { openLibraryEditor, closeLibraryEditorFor } from "./library_editor.mjs";
import { openPromptSettings, closePromptSettingsFor, accentOf, ACCENT_SETTING } from "./settings.mjs";

// Prompt Pixaroma: a prompt box where @tags expand to library snippets, with an
// optional wired text input joined to the typed prompt. State lives on
// node.properties.promptState; the expanded prompt + order + separator are
// injected into the hidden PromptState input by the graphToPrompt hook below
// (Sliders / Seed pattern). @tag expansion + highlighting reuse expand.mjs.

const STATE_KEY = "promptState";
const DEFAULT_STATE = { text: "", order: "mine", sep: ", ", accent: null, showExpanded: true };

const DEFAULT_W = 460;
const DEFAULT_H = 214;
const MIN_W = 440;
const MIN_H = 178;
const WIDGET_MIN_H = 150;
const TAWRAP_MIN = 64;

// ── state (node.properties) ────────────────────────────────────────────────
function readState(node) {
  const s = (node.properties && node.properties[STATE_KEY]) || {};
  return {
    text: typeof s.text === "string" ? s.text : DEFAULT_STATE.text,
    order: s.order === "wired" ? "wired" : "mine",
    sep: typeof s.sep === "string" ? s.sep : DEFAULT_STATE.sep,
    accent: s.accent || null,
    showExpanded: s.showExpanded !== false,
  };
}
function writeState(node, patch) {
  node.properties = node.properties || {};
  const cur = readState(node);
  node.properties[STATE_KEY] = { ...cur, ...patch };
}

// ── CSS ────────────────────────────────────────────────────────────────────
let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pix-prm-root { --acc:${BRAND}; display:flex; flex-direction:column; gap:6px; padding:6px;
      width:100%; height:100%; box-sizing:border-box; color:#e0e0e0; font:12px 'Segoe UI',sans-serif; }
    /* order control sits on the top line (only when the text input is wired) */
    .pix-prm-portrow { display:none; align-items:center; justify-content:center; gap:8px; flex:0 0 auto;
      flex-wrap:wrap; padding:1px 2px; user-select:none; }
    .pix-prm-portrow.on { display:flex; }
    .pix-prm-portrow .cl { font-size:10.5px; color:#9cc4e6; display:inline-flex; align-items:center; gap:5px; }
    .pix-prm-portrow .cl .wd { width:8px; height:8px; border-radius:50%; background:#5aa9e6; }
    .pix-prm-seg { display:inline-flex; border:1px solid rgba(90,169,230,.5); border-radius:6px; overflow:hidden; }
    .pix-prm-seg button { background:transparent; border:0; color:#9cc4e6; padding:4px 9px; font:500 11px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-prm-seg button:hover { color:#fff; }
    .pix-prm-seg button.on { background:#5aa9e6; color:#08243b; }
    .pix-prm-sepsel { background:rgba(90,169,230,.10); border:1px solid rgba(90,169,230,.5); color:#9cc4e6;
      border-radius:5px; font:11px 'Segoe UI',sans-serif; padding:3px 5px; outline:none; }
    .pix-prm-tawrap { position:relative; flex:1 1 auto; min-height:${TAWRAP_MIN}px; display:flex; }
    .pix-prm-backdrop { position:absolute; inset:0; padding:6px 8px; border:1px solid transparent;
      font:12px/1.5 monospace; color:transparent; white-space:pre-wrap; word-wrap:break-word; overflow:hidden; pointer-events:none; box-sizing:border-box; }
    .pix-prm-ta { flex:1 1 auto; width:100%; height:100%; box-sizing:border-box; background:transparent; color:#e0e0e0;
      border:1px solid #333; border-radius:4px; padding:6px 8px; font:12px/1.5 monospace; resize:none; outline:none; caret-color:var(--acc); }
    .pix-prm-ta:focus { border-color:var(--acc); }
    .pix-prm-ta.pix-prm-locked { color:#888; font-style:italic; background:#161616; }
    .pix-prm-chip { border-radius:3px; box-shadow:0 0 0 1px var(--acc) inset; background:rgba(246,103,68,.24); }
    .pix-prm-chip.bad { box-shadow:0 0 0 1px rgba(226,85,74,.75) inset; background:rgba(226,85,74,.22); }
    .pix-prm-expand { flex:0 0 auto; background:#151515; border:1px solid #262626; border-radius:4px; padding:6px 8px;
      font:11px/1.5 monospace; white-space:pre-wrap; max-height:76px; overflow-y:auto; }
    .pix-prm-expand .lbl { color:#6d6d6d; }
    .pix-prm-expand .mine { color:#9fd6b0; }
    .pix-prm-expand .note { color:#9cc4e6; }
    .pix-prm-bar { display:flex; align-items:center; flex:0 0 auto; gap:4px; flex-wrap:wrap; row-gap:4px; padding:0 2px; user-select:none; }
    .pix-prm-btn { box-sizing:border-box; user-select:none; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.15);
      border-radius:4px; color:rgba(255,255,255,.85); cursor:pointer; font:11px 'Segoe UI',sans-serif; padding:4px 11px;
      transition:background .1s,color .1s,border-color .1s; display:inline-flex; align-items:center; gap:5px; }
    .pix-prm-btn:hover { background:var(--acc); border-color:var(--acc); color:#fff; }
    .pix-prm-btn[disabled] { color:rgba(255,255,255,.3); cursor:default; background:rgba(255,255,255,.02); border-color:rgba(255,255,255,.08); }
    .pix-prm-btn[disabled]:hover { background:rgba(255,255,255,.02); border-color:rgba(255,255,255,.08); color:rgba(255,255,255,.3); }
    .pix-prm-btn.is-flashing, .pix-prm-btn.is-flashing:hover { background:#3ec371; border-color:#3ec371; color:#fff; }
    .pix-prm-sw { box-sizing:border-box; display:inline-flex; align-items:center; gap:5px; flex:0 0 auto; user-select:none; white-space:nowrap;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.15); border-radius:4px; color:rgba(255,255,255,.7);
      cursor:pointer; font:11px 'Segoe UI',sans-serif; padding:4px 9px; transition:background .1s,color .1s,border-color .1s; }
    .pix-prm-sw:hover { border-color:var(--acc); color:rgba(255,255,255,.92); }
    .pix-prm-sw-dot { width:8px; height:8px; border-radius:50%; border:1.5px solid rgba(255,255,255,.55); background:transparent; box-sizing:border-box; }
    .pix-prm-sw.on { background:var(--acc); border-color:var(--acc); color:#fff; }
    .pix-prm-sw.on .pix-prm-sw-dot { background:#fff; border-color:#fff; }
    .pix-prm-gear { margin-left:auto; padding:4px 8px; }
    .pix-prm-lockhint { color:var(--acc); font:10px 'Segoe UI',sans-serif; font-style:italic; padding:0 2px; margin:0; flex:0 0 auto; user-select:none; display:none; }
    /* @-autocomplete popup (appended to <body> so the node never clips it) */
    .pix-prm-ac { position:fixed; z-index:10030; background:#1d1d1d; border:1px solid #4a4a4a; border-radius:7px;
      overflow-y:auto; max-height:230px; min-width:260px; box-shadow:0 12px 30px rgba(0,0,0,.6);
      font:12px 'Segoe UI',sans-serif; display:none; }
    .pix-prm-ac-h { padding:5px 11px 3px; font:600 9.5px 'Segoe UI',sans-serif; letter-spacing:.1em; text-transform:uppercase; color:#767676;
      display:flex; align-items:center; gap:6px; border-top:1px solid #262626; }
    .pix-prm-ac-h:first-child { border-top:none; }
    .pix-prm-ac-h .cd { width:8px; height:8px; border-radius:50%; }
    .pix-prm-ac-i { padding:6px 11px; cursor:pointer; }
    .pix-prm-ac-i.sel, .pix-prm-ac-i:hover { background:#3a2a24; }
    .pix-prm-ac-n { font:12px monospace; color:var(--acc, ${BRAND}); }
    .pix-prm-ac-d { font-size:10.5px; color:#767676; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:320px; }
    .pix-prm-ac-empty { padding:9px 11px; color:#767676; font-size:11.5px; }
  `;
  document.head.appendChild(style);
}

// ── Help ─────────────────────────────────────────────────────────────────
const PROMPT_HELP = {
  title: "Prompt Pixaroma",
  tagline: "A prompt box with reusable @tags and an optional text input you can join with.",
  sections: [
    {
      heading: "Writing a prompt",
      body:
        "Type your prompt in the box. To reuse a chunk you type a lot, save it once as a tag and then type `@name` for it. Type `@` to get a searchable list grouped by category - arrow keys and Enter to insert.\n\n" +
        "Known tags glow in your accent colour; an unknown `@tag` glows red so you spot a typo. At run time each `@tag` is swapped for its full text, so the box stays short. `Show expanded` previews exactly what will be sent.",
    },
    {
      heading: "Save text as a tag",
      body: "Select some text in the box and a `Save as tag` button appears - name it and pick a category, and that text becomes a reusable @tag on the spot.",
    },
    {
      heading: "The text input and output",
      body:
        "The `text` output carries your finished prompt. The optional `text` input lets you wire in another prompt:",
      bullets: [
        "Nothing wired in: the output is just your prompt.",
        "Wired in: it is joined with your prompt. A small control on the top line lets you choose `My prompt first` or `Wired first`, and the separator (comma, space, or new line).",
      ],
    },
    {
      heading: "The tag library",
      body:
        "The `Tags` button opens the fullscreen library: categories down the left, tags on the right. Add, rename, move between categories, or delete. New tags appear at the top.\n\n" +
        "Your library is saved in ComfyUI's own settings, so it is private to you and survives updating the plugin - it is never saved into a workflow. Share it on purpose with `Export` / `Import` (Import lets you keep both, replace, or skip when a name already exists).",
    },
    {
      heading: "Colours",
      body: "The gear opens node settings where you can change the button colour, and set it as the default for new Prompt nodes.",
    },
    {
      heading: "Good to know",
      body: "A tag expands to plain text (one level, no tag-inside-a-tag). A workflow run without a browser (pure API) cannot expand @tags or read your library - type into a plain Text node for those, or wire the text input.",
    },
  ],
};
registerNodeHelp("PixaromaPrompt", PROMPT_HELP);

function toast(severity, msg) {
  const t = app?.extensionManager?.toast;
  if (t?.add) t.add({ severity, summary: "Prompt Pixaroma", detail: msg, life: 2200 });
  else console.warn("[Pixaroma.Prompt]", msg);
}
function flashBtnText(btn, label) {
  const orig = btn.textContent;
  btn.textContent = label;
  btn.classList.add("is-flashing");
  setTimeout(() => { btn.textContent = orig; btn.classList.remove("is-flashing"); }, 700);
}
function escapeHTML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function catColor(name) {
  const cats = getCategories();
  const i = cats.indexOf(name);
  if (name === "Uncategorized" || i < 0) return "#7a7a7a";
  const PAL = ["#e0894b", "#5aa9e6", "#8e7bd6", "#5fbf8f", "#d76b98", "#c9a24b", "#6fb3b8"];
  return PAL[i % PAL.length];
}

// ── @-autocomplete (single body-level popup) ───────────────────────────────
const TAG_TOKEN_RE = /@([a-zA-Z0-9_\-]*)$/;
let _acEl = null;
let _ac = null; // { node, ta, start, items, sel }

function acPopup() {
  if (_acEl) return _acEl;
  _acEl = document.createElement("div");
  _acEl.className = "pix-prm-ac";
  document.body.appendChild(_acEl);
  return _acEl;
}
function closeAC() {
  if (_acEl) _acEl.style.display = "none";
  _ac = null;
}
function maybeAC(node, ta) {
  const pos = ta.selectionStart;
  const m = TAG_TOKEN_RE.exec(ta.value.slice(0, pos));
  if (!m) { closeAC(); return; }
  const start = pos - m[0].length;
  // Boundary: the char before @ must not be a word char / another @.
  const prev = start > 0 ? ta.value[start - 1] : "";
  if (prev && /[\w@]/.test(prev)) { closeAC(); return; }
  const q = m[1].toLowerCase();
  openAC(node, ta, start, q);
}
function openAC(node, ta, start, q) {
  const el = acPopup();
  el.style.setProperty("--acc", accentOf(node));
  const tags = getTags().filter((t) => t.name.toLowerCase().includes(q));
  const byCat = new Map();
  for (const t of tags) {
    const c = t.cat || "Uncategorized";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(t);
  }
  const order = getCategories().filter((c) => byCat.has(c));
  el.innerHTML = "";
  const flat = [];
  if (!tags.length) {
    const e = document.createElement("div");
    e.className = "pix-prm-ac-empty";
    e.textContent = q ? `No tag matches "@${q}". Open Tags to add one.` : "No tags yet. Open Tags to add one.";
    el.appendChild(e);
  } else {
    for (const c of order) {
      const h = document.createElement("div");
      h.className = "pix-prm-ac-h";
      h.innerHTML = `<span class="cd" style="background:${catColor(c)}"></span>${escapeHTML(c)}`;
      el.appendChild(h);
      for (const t of byCat.get(c)) {
        const idx = flat.length;
        flat.push(t);
        const d = document.createElement("div");
        d.className = "pix-prm-ac-i" + (idx === 0 ? " sel" : "");
        d.dataset.i = String(idx);
        d.innerHTML = `<div class="pix-prm-ac-n">@${escapeHTML(t.name)}</div><div class="pix-prm-ac-d">${escapeHTML(t.text)}</div>`;
        d.addEventListener("mousedown", (e) => { e.preventDefault(); pickAC(t); });
        el.appendChild(d);
      }
    }
  }
  _ac = { node, ta, start, items: flat, sel: 0 };
  const r = ta.getBoundingClientRect();
  el.style.display = "block";
  el.style.minWidth = Math.max(260, Math.min(360, r.width)) + "px";
  // Place below the field, flipping above if it would run off the bottom.
  const below = window.innerHeight - r.bottom;
  el.style.left = Math.min(r.left, window.innerWidth - el.offsetWidth - 8) + "px";
  if (below < 200 && r.top > below) { el.style.top = ""; el.style.bottom = (window.innerHeight - r.top + 4) + "px"; }
  else { el.style.bottom = ""; el.style.top = (r.bottom + 4) + "px"; }
}
function updateACSel() {
  if (!_acEl) return;
  _acEl.querySelectorAll(".pix-prm-ac-i").forEach((c) => c.classList.toggle("sel", +c.dataset.i === _ac.sel));
  const sel = _acEl.querySelector(".pix-prm-ac-i.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}
function pickAC(tag) {
  if (!_ac) return;
  const { node, ta, start } = _ac;
  const v = ta.value;
  const before = v.slice(0, start);
  const after = v.slice(ta.selectionStart);
  const ins = "@" + tag.name;
  ta.value = before + ins + after;
  const p = (before + ins).length;
  ta.selectionStart = ta.selectionEnd = p;
  closeAC();
  ta.focus();
  writeState(node, { text: ta.value });
  refreshBody(node);
}
document.addEventListener("mousedown", (e) => {
  if (_acEl && _acEl.style.display === "block" && !_acEl.contains(e.target)) {
    if (!_ac || e.target !== _ac.ta) closeAC();
  }
}, true);

// ── DOM ────────────────────────────────────────────────────────────────────
function buildRoot(node) {
  const root = document.createElement("div");
  root.className = "pix-prm-root";

  // order control (top line, shown only when the text input is wired)
  const portrow = document.createElement("div");
  portrow.className = "pix-prm-portrow";
  const cl = document.createElement("span");
  cl.className = "cl";
  cl.innerHTML = `<span class="wd"></span>join`;
  const seg = document.createElement("div");
  seg.className = "pix-prm-seg";
  const bMine = document.createElement("button"); bMine.type = "button"; bMine.textContent = "My prompt first"; bMine.dataset.order = "mine";
  const bWired = document.createElement("button"); bWired.type = "button"; bWired.textContent = "Wired first"; bWired.dataset.order = "wired";
  seg.append(bMine, bWired);
  const sepSel = document.createElement("select");
  sepSel.className = "pix-prm-sepsel";
  sepSel.title = "Separator between the two prompts";
  [[", ", ", comma"], [" ", "space"], ["\n", "new line"]].forEach(([v, label]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = label; sepSel.appendChild(o);
  });
  portrow.append(cl, seg, sepSel);

  const tawrap = document.createElement("div");
  tawrap.className = "pix-prm-tawrap";
  const backdrop = document.createElement("div");
  backdrop.className = "pix-prm-backdrop";
  const ta = document.createElement("textarea");
  ta.className = "pix-prm-ta";
  ta.placeholder = "your prompt — type @ to insert a tag";
  ta.title = "Type your prompt. @name inserts a tag. Ctrl+Enter runs the workflow.";
  ta.spellcheck = false;
  tawrap.append(backdrop, ta);

  const expand = document.createElement("div");
  expand.className = "pix-prm-expand";

  const lockHint = document.createElement("div");
  lockHint.className = "pix-prm-lockhint";
  lockHint.textContent = "Wired from upstream; typing here is ignored";

  const bar = document.createElement("div");
  bar.className = "pix-prm-bar";
  const mkBtn = (label, title) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "pix-prm-btn"; b.textContent = label; b.title = title; return b;
  };
  const copyBtn = mkBtn("Copy all", "Copy the whole prompt to the clipboard");
  const replaceBtn = mkBtn("Replace", "Replace the box with text from the clipboard");
  const clearBtn = mkBtn("Clear", "Empty the box instantly");
  const tagsBtn = mkBtn("Tags", "Open the tag library");
  tagsBtn.innerHTML = '<span>☲</span>Tags';
  const expandSw = document.createElement("button");
  expandSw.type = "button"; expandSw.className = "pix-prm-sw";
  expandSw.title = "Preview the prompt with every @tag expanded";
  expandSw.innerHTML = '<span class="pix-prm-sw-dot"></span>Show expanded';
  const gearBtn = document.createElement("button");
  gearBtn.type = "button"; gearBtn.className = "pix-prm-btn pix-prm-gear"; gearBtn.title = "Node settings (button colour)";
  gearBtn.textContent = "⚙";
  bar.append(copyBtn, replaceBtn, clearBtn, tagsBtn, expandSw, gearBtn);

  root.append(portrow, tawrap, expand, lockHint, bar);
  root._els = { portrow, seg, bMine, bWired, sepSel, tawrap, backdrop, ta, expand, lockHint, copyBtn, replaceBtn, clearBtn, tagsBtn, expandSw, gearBtn };
  return root;
}

// ── render ───────────────────────────────────────────────────────────────
function isWired(node) {
  for (const inp of (node.inputs || [])) if (inp && inp.name === "text_in" && inp.link != null) return true;
  return false;
}
// Show the wired input as "text" (the Python kwarg stays text_in). Idempotent so
// it never false-dirties a saved workflow (Vue Compat #18): only writes when different.
function relabelInputSlot(node) {
  for (const inp of (node.inputs || [])) if (inp && inp.name === "text_in" && inp.label !== "text") inp.label = "text";
}
function renderBackdrop(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  els.backdrop.innerHTML = escapeHTML(els.ta.value).replace(/@([a-zA-Z0-9_\-]+)/g, (m, n) => {
    const known = !!findTag(n);
    return `<span class="pix-prm-chip${known ? "" : " bad"}">${m}</span>`;
  });
}
function renderExpand(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  const st = readState(node);
  if (!st.showExpanded || !hasTags(els.ta.value)) { els.expand.style.display = "none"; return; }
  els.expand.style.display = "block";
  const { out } = expandTags(els.ta.value);
  let html = `<span class="lbl">sent → </span><span class="mine">${escapeHTML(out)}</span>`;
  if (isWired(node)) {
    html += st.order === "wired"
      ? ` <span class="note">(wired text goes before this)</span>`
      : ` <span class="note">(wired text goes after this)</span>`;
  }
  els.expand.innerHTML = html;
}
function refreshBody(node) {
  renderBackdrop(node);
  renderExpand(node);
  updateClearEnabled(node);
}
function updateClearEnabled(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  els.clearBtn.disabled = !(els.ta.value && els.ta.value.length > 0);
}
function applyOrderUI(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  const st = readState(node);
  els.bMine.classList.toggle("on", st.order !== "wired");
  els.bWired.classList.toggle("on", st.order === "wired");
  els.sepSel.value = st.sep;
}
function applyAccent(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  node._pixPromptRoot.style.setProperty("--acc", accentOf(node));
}
function applyExpandSwitch(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  els.expandSw.classList.toggle("on", readState(node).showExpanded);
}
function refreshWireLock(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  const wired = isWired(node);
  els.portrow.classList.toggle("on", wired);
  renderExpand(node);
}

// ── events ─────────────────────────────────────────────────────────────────
function wireEvents(node, root) {
  const els = root._els;

  els.ta.addEventListener("input", () => {
    writeState(node, { text: els.ta.value });
    refreshBody(node);
    maybeAC(node, els.ta);
    hideSaveSel();
  });
  els.ta.addEventListener("scroll", () => { els.backdrop.scrollTop = els.ta.scrollTop; els.backdrop.scrollLeft = els.ta.scrollLeft; });
  els.ta.addEventListener("keydown", (e) => {
    if (_ac && _acEl && _acEl.style.display === "block") {
      if (e.key === "ArrowDown") { e.preventDefault(); _ac.sel = Math.min(_ac.sel + 1, _ac.items.length - 1); updateACSel(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); _ac.sel = Math.max(_ac.sel - 1, 0); updateACSel(); return; }
      if ((e.key === "Enter" || e.key === "Tab") && _ac.items.length) { e.preventDefault(); e.stopPropagation(); pickAC(_ac.items[_ac.sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAC(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return; // let ComfyUI run the workflow
    e.stopPropagation();
  });
  els.ta.addEventListener("mousedown", (e) => e.stopPropagation());
  els.ta.addEventListener("mouseup", () => setTimeout(() => onSelect(node), 0));
  els.ta.addEventListener("keyup", (e) => { if (e.shiftKey) setTimeout(() => onSelect(node), 0); });
  els.ta.addEventListener("blur", () => setTimeout(() => { if (!_saveSel || document.activeElement !== _saveSel.input) hideSaveSel(); }, 150));

  els.copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const txt = els.ta.value || "";
    if (!txt) { toast("info", "Nothing to copy"); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(txt);
      flashBtnText(els.copyBtn, "Copied");
    } catch { toast("warn", "Could not copy to clipboard"); }
  });
  els.replaceBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      if (!navigator.clipboard?.readText) throw new Error("no clipboard");
      const txt = await navigator.clipboard.readText();
      if (!txt) { toast("info", "Nothing to paste"); return; }
      els.ta.value = txt;
      writeState(node, { text: txt });
      refreshBody(node);
      flashBtnText(els.replaceBtn, "Pasted");
    } catch { toast("warn", "Could not paste from clipboard"); }
  });
  els.clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (els.clearBtn.disabled) return;
    els.ta.value = "";
    writeState(node, { text: "" });
    refreshBody(node);
  });
  els.tagsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openLibraryEditor(node, {
      accent: accentOf(node),
      onInsert: (name) => {
        const ta = els.ta;
        const p = ta.selectionStart;
        ta.value = ta.value.slice(0, p) + "@" + name + ta.value.slice(p);
        ta.selectionStart = ta.selectionEnd = p + name.length + 1;
        writeState(node, { text: ta.value });
        refreshBody(node);
      },
    });
  });
  els.expandSw.addEventListener("click", (e) => {
    e.stopPropagation();
    writeState(node, { showExpanded: !readState(node).showExpanded });
    applyExpandSwitch(node);
    renderExpand(node);
  });
  els.gearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPromptSettings(node, () => { applyAccent(node); refreshBody(node); });
  });
  els.bMine.addEventListener("click", (e) => { e.stopPropagation(); writeState(node, { order: "mine" }); applyOrderUI(node); renderExpand(node); });
  els.bWired.addEventListener("click", (e) => { e.stopPropagation(); writeState(node, { order: "wired" }); applyOrderUI(node); renderExpand(node); });
  els.sepSel.addEventListener("change", (e) => { e.stopPropagation(); writeState(node, { sep: els.sepSel.value }); renderExpand(node); });
  els.sepSel.addEventListener("mousedown", (e) => e.stopPropagation());

  for (const b of [els.copyBtn, els.replaceBtn, els.clearBtn, els.tagsBtn, els.expandSw, els.gearBtn, els.bMine, els.bWired]) {
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    b.addEventListener("mousedown", (ev) => ev.stopPropagation());
  }
}

// ── Save-selection-as-a-tag ────────────────────────────────────────────────
let _saveSel = null; // { node, popup, input, a, b }
function hideSaveSel() {
  if (_saveSel?.popup) _saveSel.popup.remove();
  _saveSel = null;
}
function onSelect(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  const ta = els.ta;
  const a = ta.selectionStart, b = ta.selectionEnd;
  if (b <= a) { hideSaveSel(); return; }
  const text = ta.value.slice(a, b).trim();
  if (!text) { hideSaveSel(); return; }
  showSaveSel(node, a, b, ta.value.slice(a, b));
}
function showSaveSel(node, a, b, selText) {
  hideSaveSel();
  const els = node._pixPromptRoot._els;
  const r = els.ta.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = "pix-prm-ac"; // reuse the popup chrome
  popup.style.cssText = `position:fixed;z-index:10031;display:block;padding:9px;min-width:250px;left:${Math.min(r.left, window.innerWidth - 270)}px;top:${r.top + 6}px;`;
  popup.style.setProperty("--acc", accentOf(node));
  const cats = getCategories().filter((c) => c !== "Uncategorized");
  popup.innerHTML =
    `<div style="font-size:10.5px;color:#8a8a8a;margin-bottom:7px">Save the selected text as a tag:</div>` +
    `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><span style="color:${accentOf(node)};font-family:monospace">@</span>` +
    `<input class="nm" placeholder="name" spellcheck="false" style="flex:1;background:#151515;border:1px solid #4a4a4a;border-radius:4px;color:#e0e0e0;font:12px monospace;padding:5px 7px;outline:none"></div>` +
    `<div style="display:flex;gap:6px;align-items:center"><select class="cat" style="flex:1;background:#151515;border:1px solid #4a4a4a;border-radius:4px;color:#e0e0e0;font:12px 'Segoe UI';padding:5px 7px;outline:none">` +
    cats.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("") +
    `<option value="">Uncategorized</option></select>` +
    `<button class="go" style="background:${accentOf(node)};border:none;color:#fff;border-radius:4px;padding:6px 11px;font:500 11.5px 'Segoe UI';cursor:pointer">Save</button></div>`;
  document.body.appendChild(popup);
  const input = popup.querySelector(".nm");
  const catSel = popup.querySelector(".cat");
  const go = popup.querySelector(".go");
  _saveSel = { node, popup, input, a, b };
  const commit = () => {
    const name = (input.value || "").replace(/[^a-zA-Z0-9_\-]/g, "");
    if (!name) { input.focus(); return; }
    saveSelectionTag(node, name, catSel.value, selText, a, b);
    hideSaveSel();
  };
  go.addEventListener("click", (e) => { e.stopPropagation(); commit(); });
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") hideSaveSel(); });
  [input, catSel, go].forEach((el) => el.addEventListener("mousedown", (e) => e.stopPropagation()));
  setTimeout(() => input.focus(), 0);
}
function saveSelectionTag(node, name, cat, selText, a, b) {
  const data = getLibraryForEdit();
  const existing = findTag(name);
  if (existing) existing.text = selText;
  else data.tags.unshift({ name, cat: cat || "", text: selText });
  commitLib(data);
  const els = node._pixPromptRoot._els;
  els.ta.value = els.ta.value.slice(0, a) + "@" + name + els.ta.value.slice(b);
  els.ta.selectionStart = els.ta.selectionEnd = a + name.length + 1;
  writeState(node, { text: els.ta.value });
  refreshBody(node);
}
// small library-edit helpers kept local so save-selection doesn't import the editor
function getLibraryForEdit() { const d = _getLib(); return { version: 1, categories: [...d.categories], tags: d.tags.map((t) => ({ ...t })) }; }
function commitLib(d) { _setLib(d); }

// ── resize floor ───────────────────────────────────────────────────────────
function measurePromptFloor(root) {
  if (!root) return 0;
  const cs = getComputedStyle(root);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;
  const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  let h = TAWRAP_MIN;
  let count = 1;
  for (const sel of [".pix-prm-portrow", ".pix-prm-expand", ".pix-prm-lockhint", ".pix-prm-bar"]) {
    const el = root.querySelector(sel);
    if (el && el.offsetParent !== null && getComputedStyle(el).display !== "none") { h += el.offsetHeight; count += 1; }
  }
  if (count > 1) h += gap * (count - 1);
  return h + padV;
}

// ── setup ────────────────────────────────────────────────────────────────
function setupNode(node) {
  injectCSS();
  const root = buildRoot(node);
  node._pixPromptRoot = root;

  const st = readState(node);
  root._els.ta.value = st.text;

  installCanvasZoomPassthrough(root);
  const w = node.addDOMWidget("pix_prompt_ui", "pixaroma_prompt", root, {
    getValue: () => null, setValue: () => {},
    getMinHeight: () => WIDGET_MIN_H,
    margin: 4, serialize: false,
  });
  applyAdaptiveCanvasOnly(w);

  node._pixPromptFloorOff = installResizeFloor(root, measurePromptFloor);
  wireEvents(node, root);

  // Re-highlight / re-preview when the library changes (edited in the editor).
  node._pixPromptUnsub = subscribe(() => { refreshBody(node); });

  if (node.size[0] < MIN_W) node.size[0] = DEFAULT_W;
  if (node.size[1] < MIN_H) node.size[1] = DEFAULT_H;

  queueMicrotask(() => {
    relabelInputSlot(node);
    applyAccent(node);
    applyOrderUI(node);
    applyExpandSwitch(node);
    refreshWireLock(node);
    refreshBody(node);
  });
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "Pixaroma.Prompt",

  // Global default button colour lives in the ComfyUI settings panel (plain hex).
  settings: [
    {
      id: ACCENT_SETTING,
      name: "Prompt Pixaroma - default button colour",
      type: "text",
      defaultValue: "",
      tooltip: "Hex colour (e.g. #f66744) for the buttons on new Prompt nodes. Blank = Pixaroma orange. Each node can override it from its gear.",
      category: ["👑 Pixaroma", "Prompt", "Default button colour"],
    },
  ],

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPrompt") return;

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure?.apply(this, arguments);
      queueMicrotask(() => {
        const root = this._pixPromptRoot;
        if (root && root._els) {
          const st = readState(this);
          if (root._els.ta.value !== st.text) root._els.ta.value = st.text;
          relabelInputSlot(this);
          applyAccent(this);
          applyOrderUI(this);
          applyExpandSwitch(this);
          refreshWireLock(this);
          refreshBody(this);
        }
      });
      return r;
    };

    const origOCC = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = origOCC?.apply(this, arguments);
      queueMicrotask(() => refreshWireLock(this));
      return r;
    };

    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      if (origResize) return origResize.apply(this, arguments);
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed || isVueNodes()) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeHelpPopup();
      closeLibraryEditorFor(this);
      closePromptSettingsFor(this);
      this._pixPromptFloorOff?.(); this._pixPromptFloorOff = null;
      this._pixPromptUnsub?.(); this._pixPromptUnsub = null;
      this._pixPromptRoot = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaPrompt") return;
    setupNode(node);
  },
});

// ── graphToPrompt: expand @tags + inject PromptState (Sliders / Seed pattern) ─
function buildPromptNodeIndex() {
  const index = new Map();
  const visit = (graph, prefix) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      const fullId = prefix + String(n.id);
      if (n.comfyClass === "PixaromaPrompt" || n.type === "PixaromaPrompt") index.set(fullId, n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner, fullId + ":");
    }
  };
  visit(app.graph, "");
  return index;
}
function findPromptNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      let index = null;
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPrompt") continue;
        if (!index) index = buildPromptNodeIndex();
        const node = findPromptNode(index, key);
        const st = node ? readState(node) : { text: "", order: "mine", sep: ", " };
        const expanded = expandTags(st.text).out;
        entry.inputs = entry.inputs || {};
        // Cosmetic keys (accent, showExpanded) are DELIBERATELY excluded so a colour
        // pick can't change the run's cache key (project note on injected state).
        entry.inputs.PromptState = JSON.stringify({ text: expanded, order: st.order, sep: st.sep });
      }
    }
  } catch (err) {
    console.error("Pixaroma.Prompt: graphToPrompt hook failed", err);
  }
  return result;
};
