// Sliders Pixaroma - the floating settings panel (Run Timer / Save Image
// pattern: themed panel beside the node, draggable by its header, closes on
// outside click or Esc).
//
// The node face stays clean - names, sliders, values. Everything that would
// clutter it lives here: ranges, step, type, add / remove, and the slider
// colour (per node, with a global default) so nobody is forced into the
// Pixaroma orange.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { openPixaromaColorPickerPopup, BUTTON_PALETTE } from "../shared/color_picker.mjs";
import {
  readState, normalizeSliders, addSlider, removeSlider, syncOutputs,
  accentOf, BRAND, ACCENT_SETTING, MAX_SLIDERS, clampValue, ensureToggle,
  ensureCombo, comboVisible, comboOptionsOf,
} from "./core.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _cpHandle = null; // open colour-picker popup, so the panel can close it too
let _rebuildRows = null; // rebuild the open panel's rows (e.g. after a wire change)

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// The word shown on a locked row's type chip (a seed/text/list row has no pill
// of its own in the picker, so map every kind to a readable label).
const TYPE_LABEL = { toggle: "Toggle", combo: "List", seed: "Seed", text: "Text", int: "Int", float: "Float", auto: "Auto" };

// The type is LOCKED only when the wire actually DICTATES it - i.e. the row's
// output reaches at least one concrete-typed input (INT / FLOAT / BOOLEAN /
// STRING, or a dropdown/COMBO). A row wired ONLY through "*" pass-throughs
// (Reroute / Set / Preview) dictates no type, so it stays freely editable (else
// picking a type on such a row would instantly lock it with no way back). If a
// link can't be resolved we fall back to locked - a wired row should not be
// re-typed just because we failed to inspect its target.
function rowWiredToTypedTarget(node, i) {
  const o = node.outputs && node.outputs[i];
  const links = o && Array.isArray(o.links) ? o.links.filter((x) => x != null) : [];
  if (!links.length) return false;
  const graph = node.graph;
  const getLink = (lid) => {
    let lk = graph?.links?.[lid];
    if (!lk && typeof graph?.links?.get === "function") lk = graph.links.get(lid);
    return lk;
  };
  let resolved = 0;
  for (const lid of links) {
    const lk = getLink(lid);
    if (!lk) continue;
    const tgt = graph?.getNodeById?.(lk.target_id);
    const inp = tgt?.inputs?.[lk.target_slot];
    if (!tgt || !inp) continue;   // dangling / unresolvable target - inconclusive, don't count
    resolved++;
    const t = String(inp.type || "").toUpperCase();
    if ((t && t !== "*") || comboOptionsOf(tgt, inp.widget?.name || inp.name)) return true;
  }
  return resolved === 0;   // couldn't resolve any target -> be safe and keep it locked
}

// Whether the type picker should be LOCKED (shown as a read-only chip) for this
// row. Seed / Text / Dropdown are WIRE-DERIVED types the free 5-pill picker
// can't represent (there is no Seed/Text pill, and converting a dropdown away
// via a pill zeroes its value) - so they always lock, even when UNWIRED (the one
// normal way to reach an unwired-yet-typed row is a single-node copy-paste, which
// keeps the type but drops the wire). Other types lock only while wired to a
// concrete-typed input; an unwired auto/int/float/toggle keeps the free picker.
function isRowTypeLocked(node, i, s) {
  if (s.type === "seed" || s.type === "text" || s.type === "combo") return true;
  return s.type !== "auto" && rowWiredToTypedTarget(node, i);
}

function injectCSS() {
  if (document.getElementById("pix-sldp-css")) return;
  const s = document.createElement("style");
  s.id = "pix-sldp-css";
  s.textContent = `
    .pix-sldp {
      position:fixed; z-index:10010; width:600px; max-width:94vw; background:#1a1a1a;
      border:1px solid #3a3a3a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif; overflow:hidden;
    }
    .pix-sldp-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323;
      border-bottom:1px solid #333; cursor:grab; user-select:none; }
    .pix-sldp-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-sldp-t .x:hover { color:#fff; }
    .pix-sldp-b { padding:12px; display:flex; flex-direction:column; gap:8px; max-height:60vh; overflow-y:auto; }

    .pix-sldp-head { display:grid; grid-template-columns:1fr 174px 56px 56px 56px 22px; gap:8px;
      font-size:9.5px; letter-spacing:.06em; text-transform:uppercase; color:#7a7a7a; padding:0 6px; }
    .pix-sldp-row { display:grid; grid-template-columns:1fr 174px 56px 56px 56px 22px; gap:8px; align-items:center;
      background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.10); border-radius:6px; padding:6px; }

    /* a combo row's filter button spans the three value columns */
    .pix-sldp-filter { grid-column:3 / 6; box-sizing:border-box; width:100%; background:#1d1d1d;
      border:1px solid #444; border-radius:4px; color:#cfcfcf; font:11.5px 'Segoe UI',sans-serif;
      padding:5px 9px; cursor:pointer; text-align:left; display:flex; align-items:center; gap:8px; }
    .pix-sldp-filter:hover { border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-sldp-filter .cnt { margin-left:auto; color:var(--acc,${BRAND}); font-weight:600; font-variant-numeric:tabular-nums; }

    /* the filter popup (which options to show + the default) */
    .pix-sldp-fpop { position:fixed; z-index:10040; width:280px; max-height:60vh; overflow:hidden; background:#1a1a1a;
      border:1px solid #3a3a3a; border-radius:9px; box-shadow:0 16px 44px rgba(0,0,0,0.6); display:flex; flex-direction:column; }
    .pix-sldp-fpop .fh { display:flex; align-items:center; gap:8px; padding:9px 11px; background:#232323; border-bottom:1px solid #333; font-size:11px; color:#cfcfcf; }
    .pix-sldp-fpop .fh .fa { margin-left:auto; font-size:10.5px; color:var(--acc,${BRAND}); cursor:pointer; }
    .pix-sldp-fpop .fh .fa:hover { text-decoration:underline; }
    .pix-sldp-flist { overflow-y:auto; padding:6px; display:flex; flex-direction:column; gap:3px; }
    .pix-sldp-fopt { display:flex; align-items:center; gap:9px; padding:6px 8px; border-radius:5px; cursor:pointer;
      font-size:12px; color:#bdbdbd; border:1px solid transparent; }
    .pix-sldp-fopt:hover { border-color:rgba(255,255,255,0.12); }
    .pix-sldp-fopt .ck { width:15px; height:15px; border-radius:4px; border:1.5px solid #555; flex:none;
      display:grid; place-items:center; font-size:10px; color:#fff; }
    .pix-sldp-fopt[data-on="1"] { color:#fff; }
    .pix-sldp-fopt[data-on="1"] .ck { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); }
    .pix-sldp-fopt .star { margin-left:auto; font-size:13px; color:#5a5a5a; cursor:pointer; flex:none; }
    .pix-sldp-fopt[data-def="1"] .star { color:var(--acc,${BRAND}); }
    .pix-sldp-row input {
      width:100%; box-sizing:border-box; background:#1d1d1d; border:1px solid #444; border-radius:4px;
      color:#e0e0e0; font:12px 'Segoe UI',sans-serif; padding:3px 6px; outline:none;
      font-variant-numeric:tabular-nums;
    }
    .pix-sldp-row input:focus { border-color:var(--acc,${BRAND}); }
    .pix-sldp-seg { display:flex; border:1px solid rgba(255,255,255,0.18); border-radius:5px; overflow:hidden; }
    .pix-sldp-seg button { flex:1; border:0; background:transparent; color:rgba(255,255,255,0.55);
      font:10px 'Segoe UI',sans-serif; padding:4px 0; cursor:pointer; }
    .pix-sldp-seg button:hover { color:#ddd; }
    .pix-sldp-seg button.on { background:var(--acc,${BRAND}); color:#fff; font-weight:600; }
    /* a wired row's type is fixed by what it is plugged into - shown, not editable */
    .pix-sldp-typelock { display:flex; align-items:center; justify-content:center; gap:6px;
      border:1px solid rgba(255,255,255,0.10); border-radius:5px; background:rgba(255,255,255,0.03);
      color:#9a9a9a; font:11px 'Segoe UI',sans-serif; padding:5px 0; cursor:default; user-select:none; }
    .pix-sldp-typelock .lk { font-size:10px; opacity:.65; }
    .pix-sldp-del { background:none; border:0; color:#6b6b6b; cursor:pointer; font-size:13px; padding:0; }
    .pix-sldp-del:hover { color:#e0604a; }
    .pix-sldp-del:disabled { opacity:.3; cursor:default; }

    .pix-sldp-acc { display:flex; align-items:center; gap:10px; padding:10px 6px 2px; border-top:1px solid #2e2e2e; }
    .pix-sldp-acc .lab { font-size:12px; color:#cfcfcf; }
    .pix-sldp-acc .sub { font-size:11px; color:#8a8a8a; }
    .pix-sldp-sw { width:30px; height:22px; border-radius:5px; border:1px solid #555; cursor:pointer; flex:none; }
    .pix-sldp-sw:hover { border-color:#fff; }

    .pix-sldp-f { display:flex; gap:8px; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .pix-sldp-btn { border:1px solid #444; background:rgba(255,255,255,0.04); color:#d8d8d8; border-radius:5px;
      padding:5px 12px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-sldp-btn:hover { border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-sldp-btn.primary { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; font-weight:600; }
    .pix-sldp-btn.primary:hover { filter:brightness(1.08); }
    .pix-sldp-btn:disabled { opacity:.4; cursor:default; }
    .pix-sldp-push { margin-left:auto; }
  `;
  document.head.appendChild(s);
}

function getNodeScreenRect(node) {
  if (isVueNodes() && node && node.id != null) {
    // scope to .lg-node (matching alignOutputs) so a breadcrumb / minimap element
    // that happens to carry data-node-id can't anchor the panel to the wrong spot
    const e = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
    if (e) return e.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c && c.ds;
  const cv = c && c.canvas;
  if (!ds || !cv || !node?.pos || !node?.size) return null;
  const cr = cv.getBoundingClientRect();
  const titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const sc = ds.scale || 1;
  const off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * sc;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * sc;
  const width = node.size[0] * sc;
  const height = (node.size[1] + titleH) * sc;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function placeBeside(panel, rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = panel.offsetWidth, mh = panel.offsetHeight;
  const gap = 12, pad = 8;
  if (!rect) {
    panel.style.left = Math.max(pad, (vw - mw) / 2) + "px";
    panel.style.top = Math.max(pad, (vh - mh) / 2) + "px";
    return;
  }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw;
  if (left < pad) left = Math.max(pad, vw - mw - pad);
  let top = rect.top;
  if (top + mh > vh - pad) top = vh - mh - pad;
  if (top < pad) top = pad;
  panel.style.left = left + "px";
  panel.style.top = top + "px";
}

function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".x")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      if (!panel.isConnected) return up();
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

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  // the colour picker, the combo filter popup, and a node-face dropdown popup all
  // live outside the panel
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-sldp-fpop, .pix-sld-cpop")) return;
  closeSlidersPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    // let the colour picker / filter popup / dropdown popup take Escape first
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-sldp-fpop, .pix-sld-cpop")) return;
    e.stopPropagation();
    closeSlidersPanel();
  }
}

export function closeSlidersPanel() {
  try { _cpHandle?.close(); } catch {}
  _cpHandle = null;
  closeFilterPopup();
  if (_panel) { try { _panel.remove(); } catch {} }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  _rebuildRows = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeSlidersPanelFor(node) {
  if (_panelNode === node) closeSlidersPanel();
}

// Rebuild the open panel's rows if it belongs to this node - called when a wire
// on the node changes, so a row that just became wired (or was unplugged) shows
// the correct locked-chip / free-picker state. Without this the panel is a
// snapshot from when it opened and a canvas wire change could leave a stale
// (unlocked) picker on a now-wired row, bypassing the type lock.
export function rebuildSlidersPanelFor(node) {
  if (_panel && _panelNode === node && _rebuildRows) {
    // Don't tear the rows down while the user is mid-edit in a panel field: a
    // canvas wire change firing this would destroy the focused input and lose the
    // characters they just typed. The lock state refreshes on the next open/edit.
    const ae = document.activeElement;
    if (ae && _panel.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    try { _rebuildRows(); } catch {}
  }
}

// ── Combo filter popup (which options a dropdown shows + its default) ─────────
let _filterPop = null;
function _filterOutside(e) { if (_filterPop && !_filterPop.contains(e.target)) closeFilterPopup(); }
function _filterEsc(e) { if (e.key === "Escape" && _filterPop) { e.stopPropagation(); closeFilterPopup(); } }
export function closeFilterPopup() {
  if (_filterPop) { try { _filterPop.remove(); } catch {} _filterPop = null; }
  document.removeEventListener("pointerdown", _filterOutside, true);
  document.removeEventListener("wheel", _filterOutside, true);
  document.removeEventListener("keydown", _filterEsc, true);
}

function openFilterPopup(node, s, anchorEl, onChange) {
  closeFilterPopup();
  const opts = Array.isArray(s.options) ? s.options : [];

  const pop = el("div", "pix-sldp-fpop");
  pop.style.setProperty("--acc", accentOf(node));
  const fh = el("div", "fh");
  const allBtn = el("span", "fa", "All");
  const noneBtn = el("span", "fa", "None");
  fh.append(el("span", null, "Show these options"), allBtn, noneBtn);
  const list = el("div", "pix-sldp-flist");
  pop.append(fh, list);

  // empty allowed = show all
  const shown = () => { const a = Array.isArray(s.allowed) ? s.allowed : []; return a.length ? new Set(a) : new Set(opts); };
  const commit = (set) => {
    if (set.size >= opts.length) s.allowed = [];
    else s.allowed = opts.filter((o) => set.has(o));
    ensureCombo(s);
    onChange && onChange();
  };

  function rebuild() {
    list.innerHTML = "";
    const set = shown();
    opts.forEach((o) => {
      const r = el("div", "pix-sldp-fopt");
      r.setAttribute("data-on", set.has(o) ? "1" : "0");
      r.setAttribute("data-def", s.def === o ? "1" : "0");
      const lab = el("span", null, o);
      lab.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      r.append(el("span", "ck", set.has(o) ? "✓" : ""), lab, el("span", "star", "★"));
      const star = r.querySelector(".star");
      star.title = "Set as the default";
      r.addEventListener("click", (e) => {
        if (e.target === star) return;
        const set2 = shown();
        if (set2.has(o)) set2.delete(o); else set2.add(o);
        if (!set2.size) set2.add(o);   // keep at least one shown
        commit(set2);
        rebuild();
      });
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        s.def = o;
        const set2 = shown();
        if (!set2.has(o)) set2.add(o);   // a default must be shown
        commit(set2);
        rebuild();
      });
      list.append(r);
    });
  }
  allBtn.addEventListener("click", () => { commit(new Set(opts)); rebuild(); });
  noneBtn.addEventListener("click", () => { commit(new Set(opts.length ? [opts[0]] : [])); rebuild(); });
  rebuild();

  document.body.appendChild(pop);
  const rc = anchorEl.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(rc.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
  let top = rc.bottom + 4;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, window.innerHeight - pop.offsetHeight - 8);
  pop.style.top = top + "px";
  _filterPop = pop;
  setTimeout(() => {
    document.addEventListener("pointerdown", _filterOutside, true);
    document.addEventListener("wheel", _filterOutside, true);
    document.addEventListener("keydown", _filterEsc, true);
  }, 0);
}

export function openSlidersPanel(node, onChange) {
  closeSlidersPanel();
  injectCSS();
  _onChange = onChange || null;
  _panelNode = node;

  const panel = el("div", "pix-sldp");
  panel.style.setProperty("--acc", accentOf(node));

  const title = el("div", "pix-sldp-t");
  title.append(el("span", null, "⚙"), el("span", null, "Control settings"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", closeSlidersPanel);
  title.appendChild(x);

  const body = el("div", "pix-sldp-b");
  const foot = el("div", "pix-sldp-f");

  const fire = () => { normalizeSliders(node); syncOutputs(node); _onChange?.(); };

  // Repaint the panel in the chosen accent without rebuilding it (that would
  // tear the colour picker down mid-interaction).
  const repaintAccent = () => {
    const a = accentOf(node);
    panel.style.setProperty("--acc", a);
    sw.style.background = a;
  };

  function buildRows() {
    body.innerHTML = "";
    const st = readState(node);

    const head = el("div", "pix-sldp-head");
    ["Name", "Type", "Min · On", "Max · Off", "Step · Def", ""].forEach((h) => head.appendChild(el("span", null, h)));
    body.appendChild(head);

    st.sliders.forEach((s, i) => {
      const row = el("div", "pix-sldp-row");

      const name = el("input");
      name.type = "text";
      name.value = s.name || "";
      name.placeholder = `Value ${i + 1}`;
      name.maxLength = 40;
      name.addEventListener("keydown", (e) => e.stopPropagation());
      // A manual rename takes ownership of the name (autoName off) so a later
      // re-wire won't overwrite it; clearing it hands the name back to auto.
      const applyName = () => { s.name = name.value.trim(); s.autoName = (s.name === ""); fire(); };
      name.addEventListener("change", applyName);
      name.addEventListener("blur", applyName);

      // The type follows whatever the row is wired to, and re-types on a re-wire
      // (pattern #19). While it is CONNECTED the type is LOCKED - shown as a plain
      // chip, not the pill picker - so a seed can't be turned into a switch, a
      // dropdown into a number, etc. (user-reported). A row still "auto" (not
      // wired, or wired to a "*" pass-through that dictates no type) keeps the
      // free picker so you can set up a control before wiring it.
      const typeLocked = isRowTypeLocked(node, i, s);
      let seg;
      if (typeLocked) {
        seg = el("div", "pix-sldp-typelock");
        seg.append(el("span", "lk", "🔒"), el("span", null, TYPE_LABEL[s.type] || s.type));
        seg.title = "This control's type follows the input you plug it into. Wire it (or delete and re-add) to change the type.";
      } else {
        seg = el("div", "pix-sldp-seg");
        [["auto", "Auto"], ["int", "Int"], ["float", "Float"], ["toggle", "Toggle"], ["combo", "List"]].forEach(([key, label]) => {
          const b = el("button", s.type === key ? "on" : null, label);
          b.title =
            key === "auto" ? "Decide from the first input this row is connected to"
            : key === "int" ? "Always send a whole number"
            : key === "float" ? "Always send a decimal"
            : key === "toggle" ? "An on / off switch instead of a slider"
            : "A dropdown - wire it to a picker (sampler, scheduler, ...) to fill its list";
          b.addEventListener("click", () => {
            // Re-check the lock at CLICK time, not just build time: a wire could
            // have been made on the canvas while a panel field kept focus (which
            // skips the rebuild), leaving this stale free picker over a now-locked
            // row. Don't retype a locked row - rebuild to its locked chip.
            if (isRowTypeLocked(node, i, s)) { buildRows(); return; }
            if (s.type === key) return;
            s.type = key;
            if (key === "toggle") { ensureToggle(s); s.value = s.def; }   // start at its default (Off)
            if (key === "combo") ensureCombo(s);
            fire();
            buildRows();
          });
          seg.appendChild(b);
        });
      }

      const del = el("button", "pix-sldp-del", "✕");
      del.title = st.sliders.length > 1 ? "Remove this row" : "A panel keeps at least one row";
      del.disabled = st.sliders.length <= 1;
      del.addEventListener("click", () => {
        if (removeSlider(node, i)) { fire(); buildRows(); }
      });

      // Seed / Text rows have no min/max/step - a short hint spans those columns.
      if (s.type === "seed" || s.type === "text") {
        const note = el("span", null, s.type === "seed" ? "randomize with R / N on the node" : "type into it on the node");
        note.style.cssText = "grid-column:3 / 6; color:#7a7a7a; font-size:11px; padding-left:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
        row.append(name, seg, note, del);
        body.appendChild(row);
        return;
      }

      // A dropdown row: one filter button (spanning the value columns) opens the
      // "which options to show + default" popup.
      if (s.type === "combo") {
        const vis = comboVisible(s);
        const filterBtn = el("button", "pix-sldp-filter");
        filterBtn.append(
          document.createTextNode("Show options"),
          el("span", "cnt", `${vis.length} / ${(s.options || []).length}`),
        );
        filterBtn.title = "Choose which options this dropdown offers, and the default";
        filterBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openFilterPopup(node, s, filterBtn, () => { fire(); buildRows(); });
        });
        row.append(name, seg, filterBtn, del);
        body.appendChild(row);
        return;
      }

      // The last three columns follow the row's type: numbers for a slider,
      // the two state words + a default for a toggle.
      let c3, c4, c5;
      if (s.type === "toggle") {
        const txt = (key, ph) => {
          const inp = el("input");
          inp.type = "text";
          inp.value = String(s[key] ?? "");
          inp.placeholder = ph;
          inp.maxLength = 16;
          inp.addEventListener("keydown", (e) => e.stopPropagation());
          const apply = () => { s[key] = inp.value; fire(); };  // labels are display-only
          inp.addEventListener("change", apply);
          inp.addEventListener("blur", apply);
          return inp;
        };
        c3 = txt("onLabel", "On");
        c4 = txt("offLabel", "Off");

        c5 = el("div", "pix-sldp-seg");
        [["0", "Off"], ["1", "On"]].forEach(([v, label]) => {
          const b = el("button", String(Number(s.def) || 0) === v ? "on" : null, label);
          b.title = "The state this switch starts in and returns to on Reset";
          b.addEventListener("click", () => {
            s.def = Number(v);
            s.value = s.def;                 // reflect the choice on the node face now
            fire();
            buildRows();
          });
          c5.appendChild(b);
        });
      } else {
        const num = (key) => {
          const inp = el("input");
          inp.type = "text";
          inp.value = String(s[key]);
          inp.addEventListener("keydown", (e) => e.stopPropagation());
          const apply = () => {
            const v = parseFloat(inp.value);
            if (Number.isFinite(v)) s[key] = v;
            // Put a back-to-front range the right way round and STORE it. Every
            // reader (the fill, the drag mapping) has to agree on which end is
            // which, or the slider paints from the wrong side and drags backwards.
            if (Number(s.min) > Number(s.max)) {
              const t = s.min; s.min = s.max; s.max = t;
            }
            fire();                       // re-clamps the value into the new range
            inp.value = String(s[key]);
            minInput.value = String(s.min);
            maxInput.value = String(s.max);
          };
          inp.addEventListener("change", apply);
          inp.addEventListener("blur", apply);
          return inp;
        };
        const minInput = num("min");
        const maxInput = num("max");
        const stepInput = num("step");
        c3 = minInput; c4 = maxInput; c5 = stepInput;
      }

      row.append(name, seg, c3, c4, c5, del);
      body.appendChild(row);
    });

    // Deleting a row makes room again, so the Add button's state is rebuilt here
    // rather than only in its own click handler (it would otherwise stay greyed
    // out after you delete one of 16 sliders).
    if (add) add.disabled = readState(node).sliders.length >= MAX_SLIDERS;

    // ── accent colour ──────────────────────────────────────────────────────
    const acc = el("div", "pix-sldp-acc");
    const txt = el("div");
    txt.appendChild(el("div", "lab", "Control colour"));
    txt.appendChild(el("div", "sub", "This node only. Set the default for new ones below."));
    acc.append(sw, txt);
    body.appendChild(acc);
  }

  // the swatch is built once so the picker never loses its anchor
  const sw = el("div", "pix-sldp-sw");
  sw.title = "Pick the colour these controls paint with";
  sw.style.background = accentOf(node);
  sw.addEventListener("click", () => {
    // Close any picker already open on this swatch first - a repeat click won't
    // self-close it (the picker exempts its own anchor), so without this each
    // click stacks another live popup and only the last is tracked for teardown.
    try { _cpHandle?.close(); } catch {}
    _cpHandle = null;
    // The LIVE picker (roomy SV plane + hue + hex + button-safe swatches) so the
    // sliders recolour live as you drag, like the Group Colors picker. No
    // transparent tile - an accent is always a colour.
    _cpHandle = openPixaromaColorPickerPopup(sw, {
      initialColor: accentOf(node),
      swatches: BUTTON_PALETTE,
      wide: true,
      resetColor: BRAND,         // Reset -> the Pixaroma orange
      onPick: (c) => {
        const st = readState(node);
        st.accent = c || BRAND;
        repaintAccent();
        _onChange?.();           // renderAll -> sliders repaint live
      },
    });
  });

  // Built BEFORE buildRows(), which re-reads its disabled state on every rebuild.
  const add = el("button", "pix-sldp-btn primary", "+ Add control");
  add.addEventListener("click", () => {
    if (addSlider(node)) { fire(); buildRows(); }
  });

  buildRows();

  const mkDefault = el("button", "pix-sldp-btn", "Colour as default");
  mkDefault.title = "Use this node's colour for every new Control Panel node";
  mkDefault.addEventListener("click", async () => {
    try {
      await app.ui.settings.setSettingValueAsync(ACCENT_SETTING, accentOf(node));
      mkDefault.textContent = "Saved as default";
      setTimeout(() => { mkDefault.textContent = "Colour as default"; }, 1200);
    } catch {}
  });

  const reset = el("button", "pix-sldp-btn", "Reset values");
  reset.title = "Sliders to the middle of their range, switches and dropdowns to their default. Seeds and text are left as they are.";
  reset.addEventListener("click", () => {
    const st = readState(node);
    for (const s of st.sliders) {
      // Only sliders have a meaningful "middle of the range". The old code sent
      // EVERY non-toggle row to (min+max)/2 = 0.5, which wiped a text field to
      // "0.5", zeroed a seed, and knocked a dropdown off its chosen default.
      if (s.type === "toggle") { s.value = Number(s.def) ? 1 : 0; continue; }
      if (s.type === "combo") {
        if (typeof s.def === "string" && (s.options || []).includes(s.def)) s.value = s.def;
        continue;
      }
      if (s.type === "seed" || s.type === "text") continue;   // no "middle" - leave the user's value
      s.value = clampValue(s, (Number(s.min) + Number(s.max)) / 2);
    }
    fire();
  });

  const done = el("button", "pix-sldp-btn pix-sldp-push", "Done");
  done.addEventListener("click", closeSlidersPanel);

  foot.append(add, mkDefault, reset, done);
  panel.append(title, body, foot);
  document.body.appendChild(panel);

  placeBeside(panel, getNodeScreenRect(node));
  makeDraggable(panel, title);

  setTimeout(() => {
    if (!_panel) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  _panel = panel;
  _rebuildRows = buildRows;   // let a wire change repaint the rows (lock state)
}
