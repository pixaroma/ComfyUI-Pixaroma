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
} from "./core.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _cpHandle = null; // open colour-picker popup, so the panel can close it too

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function injectCSS() {
  if (document.getElementById("pix-sldp-css")) return;
  const s = document.createElement("style");
  s.id = "pix-sldp-css";
  s.textContent = `
    .pix-sldp {
      position:fixed; z-index:10010; width:560px; max-width:94vw; background:#1a1a1a;
      border:1px solid #3a3a3a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif; overflow:hidden;
    }
    .pix-sldp-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323;
      border-bottom:1px solid #333; cursor:grab; user-select:none; }
    .pix-sldp-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-sldp-t .x:hover { color:#fff; }
    .pix-sldp-b { padding:12px; display:flex; flex-direction:column; gap:8px; max-height:60vh; overflow-y:auto; }

    .pix-sldp-head { display:grid; grid-template-columns:1fr 140px 58px 58px 58px 22px; gap:8px;
      font-size:9.5px; letter-spacing:.06em; text-transform:uppercase; color:#7a7a7a; padding:0 6px; }
    .pix-sldp-row { display:grid; grid-template-columns:1fr 140px 58px 58px 58px 22px; gap:8px; align-items:center;
      background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.10); border-radius:6px; padding:6px; }
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
    const e = document.querySelector(`[data-node-id="${node.id}"]`);
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
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return; // the colour picker
  closeSlidersPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
    e.stopPropagation();
    closeSlidersPanel();
  }
}

export function closeSlidersPanel() {
  try { _cpHandle?.close(); } catch {}
  _cpHandle = null;
  if (_panel) { try { _panel.remove(); } catch {} }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeSlidersPanelFor(node) {
  if (_panelNode === node) closeSlidersPanel();
}

export function openSlidersPanel(node, onChange) {
  closeSlidersPanel();
  injectCSS();
  _onChange = onChange || null;
  _panelNode = node;

  const panel = el("div", "pix-sldp");
  panel.style.setProperty("--acc", accentOf(node));

  const title = el("div", "pix-sldp-t");
  title.append(el("span", null, "⚙"), el("span", null, "Slider settings"));
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

      const seg = el("div", "pix-sldp-seg");
      [["auto", "Auto"], ["int", "Int"], ["float", "Float"], ["toggle", "Toggle"]].forEach(([key, label]) => {
        const b = el("button", s.type === key ? "on" : null, label);
        b.title =
          key === "auto" ? "Decide from the first input this row is connected to"
          : key === "int" ? "Always send a whole number"
          : key === "float" ? "Always send a decimal"
          : "An on / off switch instead of a slider";
        b.addEventListener("click", () => {
          if (s.type === key) return;
          s.type = key;
          if (key === "toggle") { ensureToggle(s); s.value = s.def; }   // start at its default (Off)
          fire();
          buildRows();
        });
        seg.appendChild(b);
      });

      const del = el("button", "pix-sldp-del", "✕");
      del.title = st.sliders.length > 1 ? "Remove this row" : "A panel keeps at least one row";
      del.disabled = st.sliders.length <= 1;
      del.addEventListener("click", () => {
        if (removeSlider(node, i)) { fire(); buildRows(); }
      });

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
    txt.appendChild(el("div", "lab", "Slider colour"));
    txt.appendChild(el("div", "sub", "This node only. Set the default for new ones below."));
    acc.append(sw, txt);
    body.appendChild(acc);
  }

  // the swatch is built once so the picker never loses its anchor
  const sw = el("div", "pix-sldp-sw");
  sw.title = "Pick the colour these sliders paint with";
  sw.style.background = accentOf(node);
  sw.addEventListener("click", () => {
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
  const add = el("button", "pix-sldp-btn primary", "+ Add slider");
  add.addEventListener("click", () => {
    if (addSlider(node)) { fire(); buildRows(); }
  });

  buildRows();

  const mkDefault = el("button", "pix-sldp-btn", "Colour as default");
  mkDefault.title = "Use this node's colour for every new Sliders node";
  mkDefault.addEventListener("click", async () => {
    try {
      await app.ui.settings.setSettingValueAsync(ACCENT_SETTING, accentOf(node));
      mkDefault.textContent = "Saved as default";
      setTimeout(() => { mkDefault.textContent = "Colour as default"; }, 1200);
    } catch {}
  });

  const reset = el("button", "pix-sldp-btn", "Reset values");
  reset.title = "Send every slider to the middle of its range, and every switch to its default";
  reset.addEventListener("click", () => {
    const st = readState(node);
    for (const s of st.sliders) {
      if (s.type === "toggle") { s.value = Number(s.def) ? 1 : 0; continue; }
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
}
