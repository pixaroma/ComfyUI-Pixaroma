// XY Plot Pixaroma - node-body DOM: axis cards, target dropdown, adaptive
// value entry, counter, option toggles. All CSS is `.pix-xy-*` scoped.
//
// Render model (mirrors Load Image Pattern #5): picker/mode changes do a full
// rebuild (handlers.rerender), but typing into value fields only updates state
// + refreshes the counter/preview in place (no rebuild) so input focus is kept.

import { app } from "/scripts/app.js";
import {
  readState, writeState,
  enumerateTargets, lookupWidgetMeta, currentValuePreview,
  resolveAxisValues, computeCounts, axisReady,
} from "./core.mjs";
import { createHelpButton } from "../shared/index.mjs";

const BRAND = "#f66744";

// Node Help panel content (the ? button -> themed popup; node UI convention #16).
// The popup is a document.body overlay, so it works in BOTH renderers.
const XY_HELP = {
  title: "XY Plot Pixaroma",
  tagline: "Compare settings side by side in one labeled grid - no extra wiring.",
  sections: [
    {
      heading: "What it does",
      body: "Drop this at the end of your workflow and wire your final image into it, like a Preview node. Pick what changes ACROSS (X = columns) and DOWN (Y = rows), press Run once, and every combination fills a labeled grid right here on the node.",
    },
    {
      heading: "How to use",
      bullets: [
        "Wire your workflow's final image into the `image` input.",
        "In the X card, pick a setting to vary across the columns. Do the same in the Y card for the rows (you can use just one axis if you like).",
        "Enter the values you want to try in the value box.",
        "Press Run once. The grid builds as each run finishes.",
      ],
    },
    {
      heading: "The value box adapts to what you pick",
      defs: [
        ["Number", "A `Range` (Start / End / Steps) or a `List` of values."],
        ["Dropdown", "A checklist - tick the samplers / models / schedulers you want to compare."],
        ["Prompt text", "`Full list` (one full prompt per line) or `Find & replace` (swap a word for each value)."],
      ],
    },
    {
      heading: "Entering numbers",
      bullets: [
        "List: values separated by commas, e.g. `5, 6, 7.1, 10`. Decimals are kept exactly.",
        "Range: set Start, End and Steps (how many). 5 to 15 in 3 steps gives 5, 10, 15.",
        "Shorthand inside a list also works: `4-10 (+2)` steps by 2, and `4-10 [4]` gives 4 evenly spaced values.",
      ],
    },
    {
      heading: "Buttons and options",
      defs: [
        ["Lock seed", "Keeps the seed the same for every square so the only thing changing is what you're testing. Turns off on its own if you're plotting the seed."],
        ["Draw labels", "Show the value labels and axis names on the grid."],
        ["Save cells", "Also save each square on its own, not just the whole grid."],
        ["Grid: Dark / Light / Mono", "The grid background and label style. Switching re-skins the grid you already have, instantly."],
        ["Reset X / Reset Y", "Clear just that one axis."],
        ["Reset XY", "Clear both axes and all selections, back to a fresh node."],
        ["Save Disk / Save Output / Copy / Open", "Act on the finished grid: save it to your computer or to ComfyUI's output, copy it, or open it in a new tab."],
      ],
    },
  ],
  footer: "Tip: start small (a few values each way). The node asks you to confirm before running more than 25 squares, since each square is a full workflow run.",
};

function xyToast(detail, severity = "info") {
  const tm = app.extensionManager?.toast;
  if (tm && typeof tm.add === "function") {
    try { tm.add({ severity, summary: "XY Plot", detail, life: 4000 }); return; } catch (_e) {}
  }
  console.warn("[Pixaroma.XYPlot] " + detail);
}

export function injectCSS() {
  // DOM-id guard (survives a module hot-reload without duplicating the style).
  if (document.getElementById("pix-xy-css")) return;
  const css = `
.pix-xy-root{display:flex;flex-direction:column;gap:9px;padding:8px 9px 16px;font-family:'Segoe UI',system-ui,sans-serif;color:#e0e0e0;box-sizing:border-box;}
.pix-xy-axis{border:1px solid rgba(255,255,255,.14);border-radius:7px;padding:9px 10px 10px;background:rgba(0,0,0,.18);}
.pix-xy-axis-head{display:flex;align-items:center;flex-wrap:wrap;gap:7px;font-size:12px;font-weight:600;margin-bottom:8px;}
.pix-xy-badge{background:${BRAND};color:#fff;border-radius:4px;width:18px;height:18px;display:grid;place-items:center;font-size:11px;font-weight:700;flex:0 0 auto;}
.pix-xy-axis-dir{color:#9a9a9a;font-weight:500;font-size:11px;}
.pix-xy-head-right{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
.pix-xy-axis-reset{display:flex;align-items:center;gap:5px;font-size:10.5px;font-weight:500;color:#9a9a9a;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:3px 8px;cursor:pointer;user-select:none;}
.pix-xy-axis-reset:hover{border-color:${BRAND};color:#fff;}
.pix-xy-axis-reset .pix-xy-axis-reset-ic{font-size:12px;line-height:1;}
.pix-xy-row{display:flex;align-items:center;gap:7px;}
.pix-xy-curhint{font-size:10.5px;color:#8a8a8a;font-style:italic;margin:5px 2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* custom dropdown (value + ▼ + ◀▶), Pixaroma convention - never native <select> */
.pix-xy-combo{flex:1;display:flex;align-items:center;gap:8px;min-width:0;background:#1d1d1d;border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:6px 9px;font-size:12.5px;cursor:pointer;}
.pix-xy-combo:hover{border-color:${BRAND};}
.pix-xy-combo .pix-xy-val{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pix-xy-combo .pix-xy-val .pix-xy-node{color:${BRAND};font-weight:600;}
.pix-xy-combo .pix-xy-val.placeholder{color:#777;}
.pix-xy-combo .pix-xy-car{color:#9a9a9a;font-size:10px;flex:0 0 auto;}
.pix-xy-nav{width:22px;height:30px;flex:0 0 auto;display:grid;place-items:center;background:#1d1d1d;border:1px solid rgba(255,255,255,.14);border-radius:5px;color:${BRAND};font-size:11px;cursor:pointer;}
.pix-xy-nav:hover{border-color:${BRAND};}
.pix-xy-nav.disabled{opacity:.35;cursor:default;}
/* popup */
.pix-xy-popup{position:fixed;z-index:99999;background:#1d1d1d;border:1px solid rgba(255,255,255,.18);border-radius:7px;box-shadow:0 10px 30px rgba(0,0,0,.6);max-height:340px;overflow:auto;padding:5px;min-width:220px;}
.pix-xy-pop-section{font-size:10px;color:${BRAND};font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:7px 8px 3px;}
.pix-xy-pop-item{display:flex;flex-direction:column;gap:1px;padding:6px 9px;border-radius:4px;font-size:12.5px;cursor:pointer;}
.pix-xy-pop-item:hover{background:#2a2a2a;}
.pix-xy-pop-item.sel{background:rgba(246,103,68,.18);}
.pix-xy-pop-item-top{display:flex;align-items:center;gap:8px;}
.pix-xy-pop-item .pix-xy-wname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pix-xy-pop-item .pix-xy-wtype{font-size:10px;color:#888;flex:0 0 auto;}
.pix-xy-pop-prev{font-size:10px;color:#8a8a8a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}
.pix-xy-empty{padding:10px;color:#888;font-size:12px;text-align:center;}
/* value area */
.pix-xy-valuearea{margin-top:9px;}
.pix-xy-seg{display:inline-flex;background:rgba(0,0,0,.3);border-radius:6px;padding:2px;gap:2px;margin-bottom:8px;}
.pix-xy-moderow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}
.pix-xy-moderow .pix-xy-seg{margin-bottom:0;}
.pix-xy-seg span{font-size:11.5px;padding:4px 11px;border-radius:4px;color:#9a9a9a;cursor:pointer;user-select:none;}
.pix-xy-seg span.on{background:${BRAND};color:#fff;font-weight:600;}
.pix-xy-range{display:flex;gap:7px;margin-bottom:7px;}
.pix-xy-field{flex:1;background:#1d1d1d;border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:4px 6px;min-width:0;cursor:text;}
.pix-xy-field:focus-within{border-color:${BRAND};}
.pix-xy-field .pix-xy-flbl{font-size:9px;color:${BRAND};text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:1px;}
.pix-xy-field input{width:100%;background:transparent;border:none;outline:none;color:#e0e0e0;font-size:13px;padding:0;}
.pix-xy-input{width:100%;box-sizing:border-box;background:#1d1d1d;border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:6px 8px;color:#e0e0e0;font:12px monospace;outline:none;}
.pix-xy-input:focus{border-color:${BRAND};}
textarea.pix-xy-input{resize:vertical;min-height:46px;white-space:pre;}
.pix-xy-preview{font-size:11.5px;color:#9a9a9a;background:rgba(0,0,0,.25);border-radius:5px;padding:6px 8px;margin-top:6px;word-break:break-word;}
.pix-xy-preview b{color:#8fd19e;font-weight:600;}
.pix-xy-check{max-height:140px;overflow:auto;border:1px solid rgba(255,255,255,.14);border-radius:5px;background:#1d1d1d;}
.pix-xy-check .pix-xy-item{display:flex;align-items:center;gap:8px;padding:5px 9px;font-size:12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);}
.pix-xy-check .pix-xy-item:last-child{border-bottom:none;}
.pix-xy-check .pix-xy-item:hover{background:#262626;}
.pix-xy-box{width:14px;height:14px;flex:0 0 auto;border-radius:3px;border:1.5px solid rgba(255,255,255,.25);display:grid;place-items:center;font-size:10px;color:#fff;}
.pix-xy-box.ck{background:${BRAND};border-color:${BRAND};}
.pix-xy-count{font-size:11px;color:#9a9a9a;margin-top:5px;}
/* counter chip + options */
.pix-xy-counter{text-align:center;font-size:13px;font-weight:600;color:#fff;background:${BRAND};border-radius:6px;padding:7px;}
.pix-xy-counter.muted{background:rgba(255,255,255,.06);color:#9a9a9a;font-weight:500;}
.pix-xy-opts{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
.pix-xy-opts2{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;}
.pix-xy-themewrap{display:flex;align-items:center;flex-wrap:wrap;gap:7px;}
.pix-xy-themelbl{font-size:11.5px;color:#9a9a9a;}
.pix-xy-themeseg{margin-bottom:0;}
.pix-xy-themeseg span{padding:4px 10px;}
.pix-xy-toggle{display:flex;align-items:center;gap:7px;font-size:11.5px;color:#cfcfcf;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:5px 11px;cursor:pointer;user-select:none;white-space:nowrap;}
.pix-xy-toggle:hover{border-color:${BRAND};}
.pix-xy-pill{width:30px;height:16px;flex:0 0 auto;border-radius:8px;background:#444;position:relative;transition:.15s;}
.pix-xy-pill.on{background:${BRAND};}
.pix-xy-pill .pix-xy-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;transition:.15s;}
.pix-xy-pill.on .pix-xy-knob{left:16px;}
.pix-xy-resetbtn{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11.5px;color:#cfcfcf;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:5px 11px;cursor:pointer;user-select:none;}
.pix-xy-resetbtn:hover{border-color:${BRAND};color:#fff;}
/* grid preview + buttons */
.pix-xy-gridmount{display:flex;flex-direction:column;gap:8px;}
.pix-xy-gridbox{border:1px solid rgba(255,255,255,.12);border-radius:6px;background:#161616;min-height:60px;display:flex;align-items:center;justify-content:center;overflow:hidden;}
.pix-xy-gridimg{max-width:100%;max-height:360px;display:block;}
.pix-xy-gridhint{color:#777;font-size:12px;padding:14px;text-align:center;}
.pix-xy-savebar{display:flex;gap:6px;}
.pix-xy-sb{flex:1;text-align:center;font-size:11px;color:#e0e0e0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:6px 4px;cursor:pointer;user-select:none;}
.pix-xy-sb:hover{background:${BRAND};border-color:${BRAND};color:#fff;}
.pix-xy-sb.disabled{opacity:.4;cursor:default;}
.pix-xy-sb.disabled:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.14);color:#e0e0e0;}
`;
  const tag = document.createElement("style");
  tag.id = "pix-xy-css";
  tag.textContent = css;
  document.head.appendChild(tag);
}

export function measureContentHeight(root) {
  if (!root) return 120;
  let h = 0;
  const kids = root.children;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c && c.offsetHeight) h += c.offsetHeight;
  }
  const cs = getComputedStyle(root);
  const gap = parseFloat(cs.rowGap || cs.gap || "0") || 0;
  h += gap * Math.max(0, kids.length - 1);
  h += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return h < 20 ? 280 : h;
}

export function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-xy-root";
  root.innerHTML = `
    <div class="pix-xy-axis" data-axis="x"></div>
    <div class="pix-xy-axis" data-axis="y"></div>
    <div class="pix-xy-counter-wrap"></div>
    <div class="pix-xy-opts"></div>
    <div class="pix-xy-opts2"></div>
    <div class="pix-xy-gridmount"></div>`;
  return root;
}

// ── small DOM helpers ──────────────────────────────────────────────────────

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

// Keydown isolation so ComfyUI / LiteGraph don't grab Arrow / Enter / Z etc.
function isolate(input) {
  input.addEventListener("keydown", (e) => e.stopImmediatePropagation());
  input.addEventListener("pointerdown", (e) => e.stopPropagation());
  return input;
}

function labeledField(label, value, oninput) {
  const wrap = el("div", "pix-xy-field");
  wrap.appendChild(el("span", "pix-xy-flbl", label));
  const inp = isolate(el("input"));
  inp.type = "text";
  inp.value = value == null ? "" : String(value);
  inp.addEventListener("input", () => oninput(inp.value));
  wrap.appendChild(inp);
  // The whole box looks clickable - so clicking the label or the padding
  // (anywhere but the input itself) focuses the input. preventDefault keeps
  // it from stealing/Collapsing a text selection inside the input.
  wrap.addEventListener("mousedown", (e) => {
    if (e.target !== inp) { e.preventDefault(); inp.focus(); }
  });
  return wrap;
}

// ── target dropdown ─────────────────────────────────────────────────────────

let _openPopup = null;
function closePopup() {
  if (_openPopup) { try { _openPopup._cleanup(); } catch (_e) {} _openPopup.remove(); _openPopup = null; }
}

// Close the picker popup ONLY if it belongs to `node` - so deleting node A
// doesn't tear down node B's open picker (the popup is a module singleton).
export function closePopupIfOwner(node) {
  if (_openPopup && node && _openPopup._pixOwnerId === node.id) closePopup();
}

function flatChoices(node) {
  const out = [];
  for (const t of enumerateTargets(node)) {
    for (const w of t.widgets) out.push({ nodeId: t.nodeId, title: t.title, w });
  }
  return out;
}

function selectChoice(node, axisKey, choice, rerender) {
  const state = readState(node);
  const axis = state[axisKey];
  const changed = axis.nodeId !== choice.nodeId || axis.widgetName !== choice.w.name;
  axis.nodeId = choice.nodeId;
  axis.widgetName = choice.w.name;
  axis.widgetType = choice.w.type;
  axis.step = choice.w.step || 1;
  axis.precision = (typeof choice.w.precision === "number") ? choice.w.precision : null;
  axis.realStep = (typeof choice.w.realStep === "number") ? choice.w.realStep : null;
  axis.options = choice.w.type === "combo" ? (choice.w.options || []) : [];
  if (changed) {
    // Reset entry to a sensible default for the new widget type. Mutate the
    // EXISTING raw object IN PLACE - do NOT replace it with a fresh literal, or
    // any value-field handler that captured the old raw by reference would
    // write a stale snapshot and clobber the other axis (the same aliasing bug
    // that readState's backfillAxis was built to prevent).
    axis.mode = choice.w.type === "number" ? "range" : (choice.w.type === "text" ? "fulllist" : null);
    const r = axis.raw || (axis.raw = {});
    r.start = ""; r.end = ""; r.steps = ""; r.listText = "";
    r.checked = []; r.srFind = ""; r.srReplace = "";
  }
  writeState(node, state);
  rerender();
}

function openPicker(node, axisKey, anchorEl, rerender) {
  closePopup();
  const state = readState(node);
  const axis = state[axisKey];
  const targets = enumerateTargets(node);
  const popup = el("div", "pix-xy-popup");

  const rows = [];   // { sec, items: [{ el, hay }] }
  let filter = null;
  if (!targets.length) {
    popup.appendChild(el("div", "pix-xy-empty", "No other nodes with adjustable settings found. Add a node (e.g. KSampler) and wire your workflow first."));
  } else {
    filter = isolate(el("input", "pix-xy-input"));
    filter.type = "text";
    filter.placeholder = "Filter settings…";
    filter.style.cssText += "position:sticky;top:0;margin-bottom:6px;";
    popup.appendChild(filter);
    for (const t of targets) {
      const sec = el("div", "pix-xy-pop-section", t.title);
      popup.appendChild(sec);
      const items = [];
      for (const w of t.widgets) {
        const item = el("div", "pix-xy-pop-item");
        if (axis.nodeId === t.nodeId && axis.widgetName === w.name) item.classList.add("sel");
        const top = el("div", "pix-xy-pop-item-top");
        top.appendChild(el("span", "pix-xy-wname", w.name));
        top.appendChild(el("span", "pix-xy-wtype", w.type));
        item.appendChild(top);
        // A preview of the current value disambiguates identically-named nodes
        // (e.g. the positive vs negative CLIP Text Encode).
        if (w.cur) item.appendChild(el("div", "pix-xy-pop-prev", "= " + w.cur));
        item.addEventListener("click", () => {
          selectChoice(node, axisKey, { nodeId: t.nodeId, title: t.title, w }, rerender);
          closePopup();
        });
        popup.appendChild(item);
        items.push({ el: item, hay: (t.title + " " + w.name + " " + (w.cur || "")).toLowerCase() });
      }
      rows.push({ sec, items });
    }
    const applyFilter = (q) => {
      const ql = (q || "").toLowerCase();
      for (const r of rows) {
        let any = false;
        for (const it of r.items) {
          const show = !ql || it.hay.includes(ql);
          it.el.style.display = show ? "" : "none";
          if (show) any = true;
        }
        r.sec.style.display = any ? "" : "none";
      }
    };
    filter.addEventListener("input", () => applyFilter(filter.value));
  }
  document.body.appendChild(popup);
  // position under the anchor, clamped to viewport
  const r = anchorEl.getBoundingClientRect();
  popup.style.left = Math.max(8, Math.min(r.left, window.innerWidth - popup.offsetWidth - 8)) + "px";
  let top = r.bottom + 4;
  if (top + popup.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - popup.offsetHeight - 4);
  popup.style.top = top + "px";

  const onDown = (e) => { if (!popup.contains(e.target)) closePopup(); };
  const onWheel = (e) => { if (!popup.contains(e.target)) closePopup(); };
  const onKey = (e) => { if (e.key === "Escape") closePopup(); };
  setTimeout(() => {
    // If another picker opened in the same tick, closePopup() already ran THIS
    // popup's _cleanup and _openPopup now points at the newer one - bail so we
    // don't attach orphaned, never-removed global listeners (a real leak that
    // also makes the newer popup dismiss on the next outside click).
    if (_openPopup !== popup) return;
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
    try { filter?.focus(); } catch (_e) {}
  }, 0);
  popup._cleanup = () => {
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
  };
  popup._pixOwnerId = node?.id;   // so closePopupIfOwner only closes this node's popup
  _openPopup = popup;
}

function renderPicker(node, axisKey, mountRow, rerender) {
  const state = readState(node);
  const axis = state[axisKey];
  const choices = flatChoices(node);
  const curIdx = choices.findIndex((c) => c.nodeId === axis.nodeId && c.w.name === axis.widgetName);

  const combo = el("div", "pix-xy-combo");
  const val = el("span", "pix-xy-val");
  if (axis.nodeId != null && axis.widgetName) {
    const title = choices[curIdx]?.title || ("Node " + axis.nodeId);
    val.innerHTML = `<span class="pix-xy-node">${escapeHtml(title)}</span> · ${escapeHtml(axis.widgetName)}`;
  } else {
    val.classList.add("placeholder");
    val.textContent = "Pick a setting…";
  }
  combo.appendChild(val);
  combo.appendChild(el("span", "pix-xy-car", "▼"));
  combo.addEventListener("click", () => openPicker(node, axisKey, combo, rerender));

  const prev = el("div", "pix-xy-nav", "◀");
  const next = el("div", "pix-xy-nav", "▶");
  if (choices.length < 2) { prev.classList.add("disabled"); next.classList.add("disabled"); }
  const step = (dir) => {
    if (!choices.length) return;
    let i = curIdx < 0 ? (dir > 0 ? 0 : choices.length - 1) : (curIdx + dir + choices.length) % choices.length;
    selectChoice(node, axisKey, choices[i], rerender);
  };
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));

  mountRow.appendChild(prev);
  mountRow.appendChild(combo);
  mountRow.appendChild(next);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ── value entry (adaptive) ───────────────────────────────────────────────────

function previewText(axis) {
  const vals = resolveAxisValues(axis);
  if (!vals.length) return null;
  const shown = vals.slice(0, 8).map((v) => String(v));
  const more = vals.length > 8 ? ` … (+${vals.length - 8})` : "";
  return { count: vals.length, text: shown.join(", ") + more };
}

function buildPreview(axis) {
  const p = previewText(axis);
  const box = el("div", "pix-xy-preview");
  if (!p) { box.innerHTML = `<span style="color:#777">enter values…</span>`; return box; }
  box.innerHTML = `→ <b>${escapeHtml(p.text)}</b> &nbsp;·&nbsp; ${p.count} value${p.count === 1 ? "" : "s"}`;
  return box;
}

function renderValueArea(node, axisKey, mount, refreshCounter, rerender) {
  mount.innerHTML = "";
  const state = readState(node);
  const axis = state[axisKey];
  if (!axis.widgetType) {
    mount.appendChild(el("div", "pix-xy-preview", "Pick a setting above to choose its values."));
    return;
  }
  const save = () => writeState(node, state);
  const refreshPreview = () => {
    const old = mount.querySelector(".pix-xy-preview");
    const fresh = buildPreview(axis);
    if (old) old.replaceWith(fresh); else mount.appendChild(fresh);
    refreshCounter();
  };

  if (axis.widgetType === "number") {
    // Keep precision synced with the live widget (0 = integer width/height/steps,
    // 1 = cfg, 2 = denoise) so a reloaded axis rounds correctly even if it was
    // saved before precision was tracked.
    const nmeta = lookupWidgetMeta(node, axis);
    if (nmeta && typeof nmeta.precision === "number") axis.precision = nmeta.precision;
    if (nmeta && typeof nmeta.realStep === "number") axis.realStep = nmeta.realStep;
    const seg = el("div", "pix-xy-seg");
    const sRange = el("span", null, "Range"); const sList = el("span", null, "List");
    (axis.mode === "list" ? sList : sRange).classList.add("on");
    sRange.addEventListener("click", () => { axis.mode = "range"; save(); rerender(); });
    sList.addEventListener("click", () => { axis.mode = "list"; save(); rerender(); });
    seg.appendChild(sRange); seg.appendChild(sList);
    const modeRow = el("div", "pix-xy-moderow");
    modeRow.appendChild(seg);
    // Per-axis Snap toggle - lives in the free space next to Range/List so it
    // adds no node height, and only shows when snapping has an effect (the field's
    // step is coarser than its precision, e.g. width/height snap to /16).
    const snapUnit = Math.pow(10, -(axis.precision != null ? axis.precision : 0));
    if (axis.realStep && axis.realStep > snapUnit + 1e-9) {
      const snapT = buildToggle("Snap", axis.snap !== false, (v) => { axis.snap = v; save(); refreshPreview(); });
      snapT.title = "Round values to this setting's real step (e.g. width to multiples of 16). Off = exact.";
      modeRow.appendChild(snapT);
    }
    mount.appendChild(modeRow);

    if (axis.mode === "list") {
      const inp = isolate(el("input", "pix-xy-input"));
      inp.type = "text";
      inp.placeholder = "e.g.  4, 6, 8, 10   (or  4-10 (+2)  /  4-10 [4] )";
      inp.value = axis.raw.listText || "";
      inp.addEventListener("input", () => { axis.raw.listText = inp.value; save(); refreshPreview(); });
      mount.appendChild(inp);
    } else {
      const rangeRow = el("div", "pix-xy-range");
      rangeRow.appendChild(labeledField("Start", axis.raw.start, (v) => { axis.raw.start = v; save(); refreshPreview(); }));
      rangeRow.appendChild(labeledField("End", axis.raw.end, (v) => { axis.raw.end = v; save(); refreshPreview(); }));
      rangeRow.appendChild(labeledField("Steps", axis.raw.steps, (v) => { axis.raw.steps = v; save(); refreshPreview(); }));
      mount.appendChild(rangeRow);
    }
    mount.appendChild(buildPreview(axis));

  } else if (axis.widgetType === "combo") {
    const meta = lookupWidgetMeta(node, axis);
    const options = (meta && meta.options && meta.options.length) ? meta.options : (axis.options || []);
    axis.options = options;
    const checkedSet = new Set(axis.raw.checked || []);
    const countEl = el("div", "pix-xy-count");
    const updateCount = () => { countEl.textContent = `${checkedSet.size} selected`; };

    // Filter box - sampler / scheduler / checkpoint lists can be long.
    const filter = isolate(el("input", "pix-xy-input"));
    filter.type = "text";
    filter.placeholder = "Filter…";
    filter.style.marginBottom = "6px";
    const list = el("div", "pix-xy-check");

    const buildList = (q) => {
      list.innerHTML = "";
      const ql = (q || "").toLowerCase();
      const shown = options.filter((o) => !ql || o.toLowerCase().includes(ql));
      if (!shown.length) {
        list.appendChild(el("div", "pix-xy-empty", options.length ? "No matches." : "This dropdown has no options to list."));
      }
      for (const opt of shown) {
        const item = el("div", "pix-xy-item");
        const box = el("div", "pix-xy-box");
        if (checkedSet.has(opt)) { box.classList.add("ck"); box.textContent = "✓"; }
        item.appendChild(box);
        item.appendChild(el("span", null, opt));
        item.addEventListener("click", () => {
          if (checkedSet.has(opt)) { checkedSet.delete(opt); box.classList.remove("ck"); box.textContent = ""; }
          else { checkedSet.add(opt); box.classList.add("ck"); box.textContent = "✓"; }
          axis.raw.checked = options.filter((o) => checkedSet.has(o)); // preserve displayed order
          save(); updateCount(); refreshCounter();
        });
        list.appendChild(item);
      }
    };
    filter.addEventListener("input", () => buildList(filter.value));
    if (options.length > 6) mount.appendChild(filter);
    mount.appendChild(list);
    buildList("");
    updateCount();
    mount.appendChild(countEl);

  } else if (axis.widgetType === "text") {
    const seg = el("div", "pix-xy-seg");
    const sFull = el("span", null, "Full list"); const sSr = el("span", null, "Find & replace");
    (axis.mode === "sr" ? sSr : sFull).classList.add("on");
    sFull.addEventListener("click", () => { axis.mode = "fulllist"; save(); rerender(); });
    sSr.addEventListener("click", () => { axis.mode = "sr"; save(); rerender(); });
    seg.appendChild(sFull); seg.appendChild(sSr);
    mount.appendChild(seg);

    if (axis.mode === "sr") {
      const find = isolate(el("input", "pix-xy-input"));
      find.type = "text"; find.placeholder = "Find (text already in the prompt), e.g.  an apple";
      find.value = axis.raw.srFind || "";
      find.style.marginBottom = "6px";
      find.addEventListener("input", () => { axis.raw.srFind = find.value; save(); refreshPreview(); });
      mount.appendChild(find);
      const rep = isolate(el("textarea", "pix-xy-input"));
      rep.placeholder = "Replace with (one per line):\na watermelon\na gun";
      rep.value = axis.raw.srReplace || "";
      rep.addEventListener("input", () => { axis.raw.srReplace = rep.value; save(); refreshPreview(); });
      mount.appendChild(rep);
    } else {
      const ta = isolate(el("textarea", "pix-xy-input"));
      ta.placeholder = "One full value per line";
      ta.value = axis.raw.listText || "";
      ta.addEventListener("input", () => { axis.raw.listText = ta.value; save(); refreshPreview(); });
      mount.appendChild(ta);
    }
    mount.appendChild(buildPreview(axis));
  }
}

// ── options toggles ──────────────────────────────────────────────────────────

function buildToggle(label, on, onToggle) {
  const t = el("div", "pix-xy-toggle");
  const pill = el("div", "pix-xy-pill" + (on ? " on" : ""));
  pill.appendChild(el("div", "pix-xy-knob"));
  t.appendChild(pill);
  t.appendChild(el("span", null, label));
  t.addEventListener("click", () => {
    const nowOn = !pill.classList.contains("on");
    pill.classList.toggle("on", nowOn);
    onToggle(nowOn);
  });
  return t;
}

const THEMES = [["dark", "Dark"], ["light", "Light"], ["mono", "Mono"]];

// Grid color-theme picker. Switching re-skins the CURRENT grid instantly (the
// cells are cached server-side) via /pixaroma/api/xy_plot/restyle; if no grid
// exists yet it just stores the choice for the next run.
function buildThemeControl(node, state) {
  const wrap = el("div", "pix-xy-themewrap");
  wrap.appendChild(el("span", "pix-xy-themelbl", "Grid"));
  const seg = el("div", "pix-xy-seg pix-xy-themeseg");
  const cur = state.theme || "dark";
  for (const [val, label] of THEMES) {
    const s = el("span", null, label);
    if (cur === val) s.classList.add("on");
    s.title = `Grid background + label style: ${label}`;
    s.addEventListener("click", async () => {
      const st = readState(node);
      if (st.theme === val) return;
      st.theme = val;
      writeState(node, st);
      seg.querySelectorAll("span").forEach((x) => x.classList.remove("on"));
      s.classList.add("on");
      // Instant re-skin of the grid already on screen.
      const last = node._pixXyLastGrid;
      if (last && last.sessionId) {
        // Token guards rapid theme spam: a stale fetch that resolves late must
        // not overwrite node._pixXyLastGrid (which Save/Copy/Open act on).
        const rtok = (node._pixXyRestyleReq = (node._pixXyRestyleReq || 0) + 1);
        try {
          const resp = await fetch("/pixaroma/api/xy_plot/restyle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: last.sessionId, theme: val }),
          });
          if (rtok !== node._pixXyRestyleReq) return;   // superseded by a newer theme click
          if (resp.ok) {
            const data = await resp.json().catch(() => ({}));
            if (data.filename) {
              const url = `/view?filename=${encodeURIComponent(data.filename)}&subfolder=&type=temp&t=${Date.now()}`;
              node._pixXyLastGrid = Object.assign({}, last, { filename: data.filename, url });
              node._pixXyGrid?.setGrid(url);
            }
          } else if (resp.status === 404) {
            xyToast("This grid's cells were cleared - run the plot again to see the new theme.");
          } else {
            // 405 = the restyle route isn't loaded -> ComfyUI needs a restart.
            xyToast("Theme saved. Restart ComfyUI to preview themes instantly; it applies on your next Run regardless.", "warn");
          }
        } catch (_e) {
          xyToast("Theme saved - it'll apply on your next Run.");
        }
      }
    });
    seg.appendChild(s);
  }
  wrap.appendChild(seg);
  return wrap;
}

// ── top-level render ─────────────────────────────────────────────────────────

// handlers: { rerender(): full rebuild, growth(): re-measure node height }
export function renderBody(node, root, handlers) {
  const state = readState(node);

  const refreshCounter = () => {
    const wrap = root.querySelector(".pix-xy-counter-wrap");
    if (!wrap) return;
    const { cols, rows, total, hasPlot } = computeCounts(readState(node));
    wrap.innerHTML = "";
    const chip = el("div", "pix-xy-counter" + (hasPlot ? "" : " muted"));
    chip.textContent = hasPlot
      ? `→ ${total} image${total === 1 ? "" : "s"}  (${cols || 1} × ${rows || 1})`
      : "Pick X and/or Y values to plot";
    wrap.appendChild(chip);
  };

  for (const axisKey of ["x", "y"]) {
    const card = root.querySelector(`.pix-xy-axis[data-axis="${axisKey}"]`);
    card.innerHTML = "";
    const head = el("div", "pix-xy-axis-head");
    head.appendChild(el("span", "pix-xy-badge", axisKey.toUpperCase()));
    head.appendChild(document.createTextNode(axisKey === "x" ? "across" : "down"));
    head.appendChild(el("span", "pix-xy-axis-dir", axisKey === "x" ? "➡ columns" : "⬇ rows"));
    // Right-aligned header cluster: the node Help (?) lives on the X header
    // (one per node, kept here so it adds no empty row above the cards), and
    // each axis shows its own Reset once a setting is picked.
    const headRight = el("div", "pix-xy-head-right");
    if (axisKey === "x") headRight.appendChild(createHelpButton(XY_HELP));
    // Per-axis reset (clears just this axis; the other axis + toggles stay).
    // Only shown once a setting is picked - nothing to reset on an empty axis.
    if (handlers.resetAxis && state[axisKey] && state[axisKey].widgetType) {
      const axReset = el("div", "pix-xy-axis-reset");
      axReset.appendChild(el("span", "pix-xy-axis-reset-ic", "↺"));
      axReset.appendChild(el("span", null, "Reset " + axisKey.toUpperCase()));
      axReset.title = `Reset the ${axisKey.toUpperCase()} axis only - clears its setting and values. The other axis and your toggles stay.`;
      axReset.addEventListener("click", () => handlers.resetAxis(axisKey));
      headRight.appendChild(axReset);
    }
    if (headRight.children.length) head.appendChild(headRight);
    card.appendChild(head);
    const pickRow = el("div", "pix-xy-row");
    card.appendChild(pickRow);
    renderPicker(node, axisKey, pickRow, handlers.rerender);
    // "now: <value>" line so the user sees which setting this axis really
    // points at (e.g. the negative 'watermark, text' vs the positive prompt).
    const curp = currentValuePreview(node, state[axisKey]);
    if (curp) {
      const hint = el("div", "pix-xy-curhint", "now: " + curp);
      hint.title = "Current value of the setting this axis points at. If it's not the one you meant, re-pick above.";
      card.appendChild(hint);
    }
    const valueArea = el("div", "pix-xy-valuearea");
    card.appendChild(valueArea);
    renderValueArea(node, axisKey, valueArea, refreshCounter, handlers.rerender);
  }

  refreshCounter();

  const opts = root.querySelector(".pix-xy-opts");
  opts.innerHTML = "";
  opts.appendChild(buildToggle("Lock seed", state.lockSeed !== false, (v) => { const s = readState(node); s.lockSeed = v; writeState(node, s); }));
  opts.appendChild(buildToggle("Draw labels", state.drawLabels !== false, (v) => { const s = readState(node); s.drawLabels = v; writeState(node, s); }));
  opts.appendChild(buildToggle("Save cells", state.saveCells === true, (v) => { const s = readState(node); s.saveCells = v; writeState(node, s); }));

  // Second row: grid theme picker on the left, Reset on the right.
  const opts2 = root.querySelector(".pix-xy-opts2");
  opts2.innerHTML = "";
  opts2.appendChild(buildThemeControl(node, state));
  if (handlers.reset) {
    const reset = el("div", "pix-xy-resetbtn");
    reset.appendChild(el("span", null, "↺"));
    reset.appendChild(el("span", null, "Reset XY"));
    reset.title = "Clear BOTH axes, all selections, and the toggles - back to a fresh node.";
    reset.addEventListener("click", () => handlers.reset());
    opts2.appendChild(reset);
  }

  if (handlers.growth) handlers.growth();
}
