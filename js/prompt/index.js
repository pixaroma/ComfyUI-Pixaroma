import { app } from "/scripts/app.js";
import {
  BRAND, applyAdaptiveCanvasOnly, registerNodeHelp, closeHelpPopup, isVueNodes,
  installResizeFloor, installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { getTags, getCategories, findTag, subscribe, getLibrary as _getLib, setLibrary as _setLib } from "./library.mjs";
import { expandTags, hasTags, scanTags } from "./expand.mjs";
import { openLibraryEditor, closeLibraryEditorFor } from "./library_editor.mjs";
import { openPromptSettings, closePromptSettingsFor, accentOf, ACCENT_SETTING } from "./settings.mjs";

// Prompt Pixaroma: a prompt box where @tags expand to library snippets, with an
// optional wired text input joined to the typed prompt. State lives on
// node.properties.promptState; the expanded prompt + order + separator are
// injected into the hidden PromptState input by the graphToPrompt hook below
// (Sliders / Seed pattern). @tag expansion + highlighting reuse expand.mjs.

const STATE_KEY = "promptState";
const DEFAULT_STATE = { text: "", order: "mine", sep: ", ", accent: null, showExpanded: true };

const DEFAULT_W = 470;
const DEFAULT_H = 210;
const MIN_W = 440;
const MIN_H = 172;
const WIDGET_MIN_H = 148;
const TAWRAP_MIN = 44;
const EXPAND_MIN = 30;

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
    .pix-prm-root { --acc:${BRAND}; position:relative; display:flex; flex-direction:column; gap:6px; padding:6px;
      width:100%; height:100%; box-sizing:border-box; color:#e0e0e0; font:12px 'Segoe UI',sans-serif; }
    /* order control floats ON the input/output slot row (only when the text input
       is wired) so it never pushes the body down. Absolute + pointer-events:none on
       the empty container so the slot dots underneath stay clickable/wireable;
       only the actual controls capture clicks. Coloured with the node accent. */
    .pix-prm-portrow { position:absolute; top:-26px; left:0; right:0; margin:0; z-index:3; pointer-events:none;
      display:none; align-items:center; justify-content:center; gap:8px; user-select:none; overflow:hidden; }
    .pix-prm-portrow.on { display:flex; }
    .pix-prm-portrow .cl { font-size:10.5px; color:var(--acc); display:inline-flex; align-items:center; gap:5px; }
    .pix-prm-portrow .cl .wd { width:8px; height:8px; border-radius:50%; background:var(--acc); }
    .pix-prm-seg { pointer-events:auto; display:inline-flex; border:1px solid var(--acc); border-radius:6px; overflow:hidden; background:#1d1d1d; }
    .pix-prm-seg button { background:transparent; border:0; color:var(--acc); padding:4px 9px; font:500 11px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-prm-seg button:hover { color:#fff; background:rgba(255,255,255,.06); }
    .pix-prm-seg button.on { background:var(--acc); color:#fff; }
    /* custom dark dropdown (never a native white select - house rule) */
    .pix-prm-dd { pointer-events:auto; position:relative; display:inline-flex; }
    .pix-prm-dd-btn { display:inline-flex; align-items:center; gap:6px; background:#1d1d1d; border:1px solid var(--acc);
      border-radius:5px; color:var(--acc); font:11px 'Segoe UI',sans-serif; padding:3px 8px; cursor:pointer; white-space:nowrap; }
    .pix-prm-dd-btn:hover { color:#fff; }
    .pix-prm-dd-btn .car { font-size:9px; opacity:.85; }
    .pix-prm-dd-pop { position:fixed; z-index:10032; background:#1d1d1d; border:1px solid #4a4a4a; border-radius:6px;
      overflow:hidden; box-shadow:0 10px 26px rgba(0,0,0,.55); min-width:120px; }
    .pix-prm-dd-item { padding:6px 11px; cursor:pointer; color:#cfcfcf; font:12px 'Segoe UI',sans-serif; }
    .pix-prm-dd-item:hover, .pix-prm-dd-item.sel { background:#3a2a24; color:#fff; }
    /* The DARK background + border live on the WRAPPER (not the textarea) so the
       prompt area reads dark like Text Pixaroma while the textarea stays
       transparent for the highlight backdrop to show through. */
    .pix-prm-tawrap { position:relative; flex:2 1 0; min-height:${TAWRAP_MIN}px; display:flex;
      background:#1d1d1d; border:1px solid #333; border-radius:4px; }
    .pix-prm-tawrap:focus-within { border-color:var(--acc); }
    .pix-prm-backdrop { position:absolute; inset:0; padding:6px 8px; border:0;
      font:12px/1.5 monospace; color:transparent; white-space:pre-wrap; word-wrap:break-word; overflow:hidden; pointer-events:none; box-sizing:border-box; }
    .pix-prm-ta { flex:1 1 auto; width:100%; height:100%; box-sizing:border-box; background:transparent; color:#e0e0e0;
      border:0; border-radius:4px; padding:6px 8px; font:12px/1.5 monospace; resize:none; outline:none; caret-color:var(--acc); }
    .pix-prm-chip { border-radius:3px; box-shadow:0 0 0 1px var(--acc) inset; background:rgba(246,103,68,.24); }
    .pix-prm-chip.bad { box-shadow:0 0 0 1px rgba(226,85,74,.75) inset; background:rgba(226,85,74,.22); }
    /* preview GROWS with the node (flex, no fixed cap) so a big node shows more */
    .pix-prm-expand { flex:1 1 0; background:#151515; border:1px solid #262626; border-radius:4px; padding:6px 8px;
      font:11px/1.5 monospace; white-space:pre-wrap; min-height:30px; overflow-y:auto; }
    .pix-prm-expand .lbl { color:#6d6d6d; }
    .pix-prm-expand .mine { color:#9fd6b0; }
    .pix-prm-expand .note { color:#8a8a8a; font-style:italic; }
    .pix-prm-bar { display:flex; align-items:center; flex:0 0 auto; gap:4px; flex-wrap:wrap; row-gap:4px; padding:0 2px; user-select:none; }
    .pix-prm-btn { box-sizing:border-box; user-select:none; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.15);
      border-radius:4px; color:rgba(255,255,255,.85); cursor:pointer; font:11px 'Segoe UI',sans-serif; padding:4px 9px;
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
    /* settings gear: a SQUARE at the SAME height as the text buttons (24x24) so it
       doesn't stick out. Explicit height is required - padding:0 with no height
       collapses it to 13px. */
    .pix-prm-gear { flex:0 0 auto; width:24px; height:24px; padding:0; justify-content:center; font-size:14px; line-height:1; }
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

// A dark custom dropdown (never a native white <select> - house rule). Returns
// { el, set(value) }. `options` is [{value,label}]; onChange(value) fires on pick.
let _ddPop = null;
let _ddOutside = null;
function closeDD() {
  if (_ddPop) { _ddPop.remove(); _ddPop = null; }
  if (_ddOutside) {
    document.removeEventListener("mousedown", _ddOutside, true);
    document.removeEventListener("pointerdown", _ddOutside, true);
    document.removeEventListener("wheel", _ddOutside, true);
    document.removeEventListener("keydown", _ddEsc, true);
    _ddOutside = null;
  }
}
function _ddEsc(e) { if (e.key === "Escape") closeDD(); }
function makeDropdown(value, options, onChange) {
  const wrap = document.createElement("div"); wrap.className = "pix-prm-dd";
  const btn = document.createElement("div"); btn.className = "pix-prm-dd-btn";
  const lbl = document.createElement("span"); lbl.className = "lbl";
  const car = document.createElement("span"); car.className = "car"; car.textContent = "▾";
  btn.append(lbl, car); wrap.appendChild(btn);
  let cur = value;
  const labelOf = (v) => { const o = options.find((o) => o.value === v); return o ? o.label : v; };
  const set = (v) => { cur = v; lbl.textContent = labelOf(v); };
  set(value);
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_ddPop) { closeDD(); return; }
    const pop = document.createElement("div"); pop.className = "pix-prm-dd-pop";
    for (const o of options) {
      const it = document.createElement("div");
      it.className = "pix-prm-dd-item" + (o.value === cur ? " sel" : "");
      it.textContent = o.label;
      it.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); set(o.value); onChange(o.value); closeDD(); });
      pop.appendChild(it);
    }
    document.body.appendChild(pop);
    _ddPop = pop;
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) + "px";
    const below = window.innerHeight - r.bottom;
    if (below < pop.offsetHeight + 8 && r.top > below) pop.style.top = (r.top - pop.offsetHeight - 4) + "px";
    else pop.style.top = (r.bottom + 4) + "px";
    _ddOutside = (ev) => { if (!pop.contains(ev.target) && !btn.contains(ev.target)) closeDD(); };
    setTimeout(() => {
      // pointerdown (capture) also fires when you start dragging the node or panning
      // the canvas, so the popup closes instead of hanging in place.
      document.addEventListener("mousedown", _ddOutside, true);
      document.addEventListener("pointerdown", _ddOutside, true);
      document.addEventListener("wheel", _ddOutside, true);
      document.addEventListener("keydown", _ddEsc, true);
    }, 0);
  });
  return { el: wrap, set };
}
const SEP_OPTIONS = [{ value: ", ", label: ", comma" }, { value: " ", label: "space" }, { value: "\n", label: "new line" }];

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
  // Boundary (Unicode-consistent with scanTags): don't autocomplete when @ sits
  // after a letter/number/mark/_ (an email) or another @.
  const prev = start > 0 ? ta.value[start - 1] : "";
  if (prev && /[\p{L}\p{N}\p{M}_@]/u.test(prev)) { closeAC(); return; }
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
  // Place below the field, flipping above if the FULL popup would run off the bottom.
  const below = window.innerHeight - r.bottom;
  const need = Math.min(el.offsetHeight || 230, 230);
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + "px";
  if (below < need && r.top > below) { el.style.top = ""; el.style.bottom = (window.innerHeight - r.top + 4) + "px"; }
  else { el.style.bottom = ""; el.style.top = (r.bottom + 4) + "px"; }
}
function updateACSel() {
  if (!_acEl) return;
  _acEl.querySelectorAll(".pix-prm-ac-i").forEach((c) => c.classList.toggle("sel", +c.dataset.i === _ac.sel));
  const sel = _acEl.querySelector(".pix-prm-ac-i.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}
// A leading space when the char before would jam the tag against a word or a
// previous @tag, so inserts never produce "@a@b" (which reads badly and is
// awkward to edit). See expand.mjs - chained tags DO expand, but a space is cleaner.
function tagSep(before) {
  return (before && /[\p{L}\p{N}\p{M}_@]$/u.test(before)) ? " " : "";
}
function pickAC(tag) {
  if (!_ac) return;
  const { node, ta, start } = _ac;
  const v = ta.value;
  const before = v.slice(0, start);
  const after = v.slice(ta.selectionStart);
  const ins = tagSep(before) + "@" + tag.name;
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
  const sepDD = makeDropdown(readState(node).sep, SEP_OPTIONS, (v) => { writeState(node, { sep: v }); renderExpand(node); });
  sepDD.el.title = "Separator between the two prompts";
  portrow.append(cl, seg, sepDD.el);

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
  root._els = { portrow, seg, bMine, bWired, sepDD, tawrap, backdrop, ta, expand, lockHint, copyBtn, replaceBtn, clearBtn, tagsBtn, expandSw, gearBtn };
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

// Best-effort: read the text feeding the wired input SO THE PREVIEW CAN SHOW THE
// REAL combined result. Works for plain-text sources (Text Pixaroma, another
// Prompt Pixaroma, or any node with a readable string widget). Returns null when
// the value can't be known in the browser (e.g. a model / LLM output not run yet),
// in which case the preview shows a note instead.
function resolveWiredText(node) {
  const inp = (node.inputs || []).find((i) => i && i.name === "text_in");
  if (!inp || inp.link == null) return null;
  let link = app.graph.links?.[inp.link];
  if (!link && typeof app.graph.links?.get === "function") link = app.graph.links.get(inp.link);
  if (!link) return null;
  const src = app.graph.getNodeById ? app.graph.getNodeById(link.origin_id) : (app.graph._nodes || []).find((n) => n.id === link.origin_id);
  return src ? readNodeText(src, 0) : null;
}
function readNodeText(src, depth) {
  if (!src || depth > 4) return null;
  const cls = src.comfyClass || src.type;
  if (cls === "PixaromaPrompt") {
    const t = src.properties?.promptState?.text;
    return typeof t === "string" ? expandTags(t).out : null; // its own typed text, tags resolved
  }
  const readW = (names) => {
    for (const name of names) {
      const w = (src.widgets || []).find((w) => w && w.name === name && typeof w.value === "string");
      if (w) return w.value;
    }
    return null;
  };
  if (cls === "PixaromaText") { const v = readW(["text"]); if (v != null) return v; }
  const byName = readW(["text", "string", "value", "prompt", "wildcard_text", "t"]);
  if (byName != null) return byName;
  const strs = (src.widgets || []).filter((w) => w && typeof w.value === "string");
  if (strs.length === 1) return strs[0].value;
  return null;
}
function renderBackdrop(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  // Chip ONLY the @tokens scanTags counts as real tags (so an email's @name is
  // left plain, matching the preview + the run). Known = accent chip, unknown = red.
  const text = els.ta.value;
  const hits = scanTags(text);
  let html = "";
  let i = 0;
  for (const h of hits) {
    html += escapeHTML(text.slice(i, h.start));
    const known = !!findTag(h.name);
    html += `<span class="pix-prm-chip${known ? "" : " bad"}">${escapeHTML(h.raw)}</span>`;
    i = h.end;
  }
  html += escapeHTML(text.slice(i));
  els.backdrop.innerHTML = html;
}
function renderExpand(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  const st = readState(node);
  const wired = isWired(node);
  if (!st.showExpanded || (!hasTags(els.ta.value) && !wired)) { els.expand.style.display = "none"; return; }
  els.expand.style.display = "block";
  const mine = expandTags(els.ta.value).out;
  if (!wired) {
    els.expand.innerHTML = `<span class="mine">${escapeHTML(mine)}</span>`;
    return;
  }
  const other = resolveWiredText(node);
  if (other != null) {
    // The wired text is readable now -> show the REAL combined result, in order.
    const combined = st.order === "wired" ? (other + st.sep + mine) : (mine + st.sep + other);
    els.expand.innerHTML = `<span class="mine">${escapeHTML(combined)}</span>`;
  } else {
    // Wired from something the browser can't read yet (e.g. a model output not run).
    const where = st.order === "wired" ? "before" : "after";
    els.expand.innerHTML = `<span class="mine">${escapeHTML(mine)}</span> <span class="note">(+ wired text goes ${where}, shown here once it can be read)</span>`;
  }
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
  els.sepDD.set(st.sep);
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
      // Ctrl/Cmd+Enter always runs the workflow (close the list, let it bubble).
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { closeAC(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); _ac.sel = Math.min(_ac.sel + 1, _ac.items.length - 1); updateACSel(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); _ac.sel = Math.max(_ac.sel - 1, 0); updateACSel(); return; }
      if ((e.key === "Enter" || e.key === "Tab") && _ac.items.length) { e.preventDefault(); e.stopPropagation(); pickAC(_ac.items[_ac.sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAC(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return; // let ComfyUI run the workflow
    e.stopPropagation();
  });
  // The "Save as tag" popup appears only after a deliberate DRAG-select - NOT on a
  // click or a double-click (double-click just selects a word natively, no popup).
  let dragStart = null;
  els.ta.addEventListener("mousedown", (e) => { e.stopPropagation(); dragStart = { x: e.clientX, y: e.clientY }; });
  els.ta.addEventListener("mouseup", (e) => {
    const moved = dragStart && (Math.abs(e.clientX - dragStart.x) + Math.abs(e.clientY - dragStart.y)) > 4;
    dragStart = null;
    setTimeout(() => { if (moved) onSelect(node); else hideSaveSel(); }, 0);
  });
  els.ta.addEventListener("dblclick", () => hideSaveSel()); // word-select only, never the popup
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
        const before = ta.value.slice(0, p);
        const ins = tagSep(before) + "@" + name;
        ta.value = before + ins + ta.value.slice(p);
        ta.selectionStart = ta.selectionEnd = p + ins.length;
        writeState(node, { text: ta.value });
        refreshBody(node);
        toast("info", "Inserted @" + name + " into the prompt");
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

  for (const b of [els.copyBtn, els.replaceBtn, els.clearBtn, els.tagsBtn, els.expandSw, els.gearBtn, els.bMine, els.bWired]) {
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    b.addEventListener("mousedown", (ev) => ev.stopPropagation());
  }
}

// ── Save-selection-as-a-tag ────────────────────────────────────────────────
let _saveSel = null; // { node, popup, input, a, b }
let _saveSelOutside = null;
function hideSaveSel() {
  closeDD();
  if (_saveSelOutside) { document.removeEventListener("pointerdown", _saveSelOutside, true); _saveSelOutside = null; }
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
  const acc = accentOf(node);
  const popup = document.createElement("div");
  popup.className = "pix-prm-ac"; // reuse the popup chrome
  popup.style.cssText = `position:fixed;z-index:10031;display:block;padding:9px;min-width:260px;overflow:visible;left:${Math.min(r.left, window.innerWidth - 280)}px;top:${r.top + 6}px;`;
  popup.style.setProperty("--acc", acc);

  const hint = document.createElement("div");
  hint.style.cssText = "font-size:10.5px;color:#8a8a8a;margin-bottom:7px";
  hint.textContent = "Save the selected text as a tag:";

  const nameRow = document.createElement("div");
  nameRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:6px";
  const at = document.createElement("span"); at.style.cssText = `color:${acc};font-family:monospace`; at.textContent = "@";
  const input = document.createElement("input");
  input.placeholder = "name"; input.spellcheck = false;
  input.style.cssText = "flex:1;background:#151515;border:1px solid #4a4a4a;border-radius:4px;color:#e0e0e0;font:12px monospace;padding:5px 7px;outline:none";
  nameRow.append(at, input);

  const catRow = document.createElement("div");
  catRow.style.cssText = "display:flex;gap:6px;align-items:center";
  const catOpts = getCategories().filter((c) => c !== "Uncategorized").map((c) => ({ value: c, label: c }));
  catOpts.push({ value: "", label: "Uncategorized" });
  let chosenCat = catOpts[0].value;
  const catDD = makeDropdown(chosenCat, catOpts, (v) => { chosenCat = v; });
  catDD.el.style.flex = "1";
  catDD.el.querySelector(".pix-prm-dd-btn").style.flex = "1";
  const go = document.createElement("button");
  go.textContent = "Save";
  go.style.cssText = `background:${acc};border:none;color:#fff;border-radius:4px;padding:6px 11px;font:500 11.5px 'Segoe UI';cursor:pointer`;
  catRow.append(catDD.el, go);

  popup.append(hint, nameRow, catRow);
  document.body.appendChild(popup);
  _saveSel = { node, popup, input, a, b };
  // Dismiss when the user clicks anywhere outside the popup (mirrors the other
  // body-appended popups). Deferred a tick so the click that opened it doesn't
  // immediately close it.
  // The category dropdown body-appends its own popup, so exclude it - else picking
  // a category counts as an "outside" click and destroys the save popup.
  _saveSelOutside = (e) => { if (_saveSel && !_saveSel.popup.contains(e.target) && !e.target.closest?.(".pix-prm-dd-pop")) hideSaveSel(); };
  setTimeout(() => { if (_saveSel) document.addEventListener("pointerdown", _saveSelOutside, true); }, 0);

  const commit = () => {
    const name = (input.value || "").replace(/[^a-zA-Z0-9_\-]/g, "");
    if (!name) { input.focus(); return; }
    saveSelectionTag(node, name, chosenCat, selText, a, b);
    hideSaveSel();
  };
  go.addEventListener("click", (e) => { e.stopPropagation(); commit(); });
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") hideSaveSel(); });
  [input, go].forEach((el) => el.addEventListener("mousedown", (e) => e.stopPropagation()));
  setTimeout(() => input.focus(), 0);
}
function saveSelectionTag(node, name, cat, selText, a, b) {
  const wasExisting = !!findTag(name);
  const data = getLibraryForEdit();
  const existing = data.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) existing.text = selText;
  else data.tags.unshift({ name, cat: cat || "", text: selText });
  commitLib(data);
  const els = node._pixPromptRoot._els;
  const before = els.ta.value.slice(0, a);
  const ins = tagSep(before) + "@" + name;
  els.ta.value = before + ins + els.ta.value.slice(b);
  els.ta.selectionStart = els.ta.selectionEnd = a + ins.length;
  writeState(node, { text: els.ta.value });
  refreshBody(node);
  toast("success", (wasExisting ? "Updated tag @" : "Saved new tag @") + name);
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
  let h = TAWRAP_MIN;   // textarea at its min
  let count = 1;
  // portrow is absolute (floats on the slot row) so it does NOT count toward flow height.
  // The preview flexes, so use its MIN not its grown height (else the node can't shrink).
  const expand = root.querySelector(".pix-prm-expand");
  if (expand && getComputedStyle(expand).display !== "none") { h += EXPAND_MIN; count += 1; }
  const hint = root.querySelector(".pix-prm-lockhint");
  if (hint && hint.offsetParent !== null && getComputedStyle(hint).display !== "none") { h += hint.offsetHeight; count += 1; }
  const bar = root.querySelector(".pix-prm-bar");
  if (bar) { h += bar.offsetHeight; count += 1; }
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
      closeAC();
      closeDD();
      hideSaveSel();
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
