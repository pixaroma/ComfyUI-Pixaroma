// Switch Pixaroma - Nodes 2.0 DOM row list.
//
// In the legacy renderer the per-row mutex toggle + label are PAINTED on the
// canvas at each input dot's Y (render.mjs / onMouseDown). Nodes 2.0 renders the
// slots itself and ignores slot.pos, so there is no canvas band to paint on.
// Instead we render a DOM list - one row per input - in the node body below the
// Vue-drawn dots. Rows map to the dots by ORDER (row 1 = the 1st input dot).
//
// Each row: [#N] [label] [mutex toggle]. Clicking a connected row makes it the
// active (routed) input. The trailing empty row is dim and not clickable.
// Renaming stays legacy-only (the canvas click), consistent with Switch Source;
// Vue shows the custom label if one was set, else the upstream wire type.

import { readState, getUpstreamType, setActiveRow } from "./core.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";

const BRAND = "#f66744";
const LIST_ROW_H = 26; // per-row height incl. the 4px gap
const LIST_PAD = 8;    // top + bottom padding of the list container

function listHeight(node) {
  const rows = node.inputs?.length || 1;
  return rows * LIST_ROW_H + LIST_PAD;
}

function injectCSS() {
  if (document.getElementById("pix-sw-css")) return;
  const s = document.createElement("style");
  s.id = "pix-sw-css";
  s.textContent = `
    .pix-sw-list { display:flex; flex-direction:column; gap:4px; padding:4px 6px; box-sizing:border-box; width:100%; }
    .pix-sw-row {
      display:flex; align-items:center; gap:8px; height:22px; box-sizing:border-box;
      border-radius:6px; padding:0 8px;
      border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04);
      cursor:pointer; user-select:none;
    }
    .pix-sw-row:hover { border-color:rgba(255,255,255,0.30); }
    .pix-sw-row.active { border-color:${BRAND}; background:rgba(246,103,68,0.12); }
    .pix-sw-row.active:hover { border-color:${BRAND}; }
    .pix-sw-row.trailing { cursor:default; opacity:0.5; border-style:dashed; }
    .pix-sw-row.trailing:hover { border-color:rgba(255,255,255,0.12); }
    .pix-sw-num { color:rgba(255,255,255,0.5); font:600 10px 'Segoe UI',-apple-system,sans-serif; min-width:14px; text-align:right; }
    .pix-sw-label {
      flex:1; min-width:0; color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .pix-sw-row.trailing .pix-sw-label { color:#aaa; font-style:italic; }
    /* Editable input name: looks like plain label text until hovered/focused,
       so a row of these doesn't read as busy input boxes. */
    .pix-sw-name {
      flex:1; min-width:0; box-sizing:border-box; height:18px;
      background:transparent; border:1px solid transparent; border-radius:4px;
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif;
      padding:1px 4px; outline:none; cursor:text; text-overflow:ellipsis;
    }
    .pix-sw-name:hover { border-color:rgba(255,255,255,0.18); }
    .pix-sw-name:focus { border-color:${BRAND}; background:#1d1d1d; }
    .pix-sw-name::placeholder { color:#888; }
    /* Dim wire-type tag (STRING / IMAGE / MODEL ...) so each row shows what is
       plugged in even after it gets a custom name. */
    .pix-sw-type {
      flex:none; color:rgba(255,255,255,0.4); letter-spacing:0.5px; text-transform:uppercase;
      font:600 9px 'Segoe UI',-apple-system,sans-serif;
      white-space:nowrap; max-width:90px; overflow:hidden; text-overflow:ellipsis;
    }
    .pix-sw-toggle {
      position:relative; width:28px; height:14px; border-radius:7px; flex:none; box-sizing:border-box;
      border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06);
    }
    .pix-sw-row.active .pix-sw-toggle { border-color:${BRAND}; background:${BRAND}; }
    .pix-sw-knob { position:absolute; top:2px; left:2px; width:8px; height:8px; border-radius:50%; background:#ccc; transition:left .1s ease; }
    .pix-sw-row.active .pix-sw-knob { left:16px; background:#fff; }
    .pix-sw-row.trailing .pix-sw-toggle { visibility:hidden; }
  `;
  document.head.appendChild(s);
}

// Build the Nodes 2.0 DOM list widget for a Switch node and wire it as the
// node's refresh target (node._pixSwRefresh). Returns { render }.
export function buildSwitchVueList(node) {
  injectCSS();
  const root = document.createElement("div");
  root.className = "pix-sw-list";

  const widget = node.addDOMWidget("pixaroma_switch_list", "pixaroma_switch_list", root, {
    serialize: false,
    getMinHeight: () => listHeight(node),
    getMaxHeight: () => listHeight(node),
    getValue: () => null,
    setValue: () => {},
  });
  applyAdaptiveCanvasOnly(widget);

  function render() {
    root.innerHTML = "";
    const inputs = node.inputs || [];
    const state = readState(node);
    const activeIndex = state.activeIndex ?? 0; // 1-based; 0 = none
    const labels = state.labels ?? {};

    for (let i = 0; i < inputs.length; i++) {
      const slotIdx1 = i + 1;
      const slot = inputs[i];
      const connected = slot != null && slot.link != null;
      const isTrailing = !connected && slotIdx1 === inputs.length;
      const isActive = connected && activeIndex === slotIdx1;

      const rowEl = document.createElement("div");
      rowEl.className =
        "pix-sw-row" + (isActive ? " active" : "") + (isTrailing ? " trailing" : "");

      const numEl = document.createElement("span");
      numEl.className = "pix-sw-num";
      numEl.textContent = String(slotIdx1);

      const custom = labels[slotIdx1];
      const type = connected ? getUpstreamType(node, slotIdx1) : null;
      const usefulType = type && type !== "*" ? type : null;
      // Auto label = "<type> <slot#>" (e.g. "string 1"), matching the dot label;
      // falls back to "input N" when the type isn't known yet.
      const autoName = usefulType ? `${usefulType.toLowerCase()} ${slotIdx1}` : `input ${slotIdx1}`;

      // Connected rows get an editable name field; the trailing empty row gets
      // a plain dim "(empty)" label.
      let labelEl;
      if (connected && !isTrailing) {
        labelEl = document.createElement("input");
        labelEl.type = "text";
        labelEl.className = "pix-sw-name";
        labelEl.maxLength = 64;
        labelEl.spellcheck = false;
        labelEl.value = custom || "";
        labelEl.placeholder = autoName;
        labelEl.title = "Click to rename this input";
        labelEl.addEventListener("keydown", (e) => {
          e.stopPropagation(); // keep typing instead of triggering canvas shortcuts
          if (e.key === "Enter") { e.preventDefault(); labelEl.blur(); }
          else if (e.key === "Escape") {
            e.preventDefault();
            labelEl.value = readState(node).labels?.[slotIdx1] || "";
            labelEl.blur();
          }
        });
        const commitName = () => {
          const v = labelEl.value.trim();
          const st = readState(node);
          if (!st.labels) st.labels = {};
          if (v) st.labels[slotIdx1] = v; else delete st.labels[slotIdx1];
          // Same state.labels the legacy canvas paint reads, so the name shows
          // in both renderers. Also mirror onto the input dot's label so the
          // name shows next to the dot too (Nodes 2.0 renders slot.label there).
          const slot = node.inputs?.[slotIdx1 - 1];
          if (slot) slot.label = v || `input ${slotIdx1}`;
          // No list re-render here (it would drop focus mid-edit).
          node.graph?.setDirtyCanvas?.(true, true);
        };
        labelEl.addEventListener("change", commitName);
        labelEl.addEventListener("blur", commitName);
      } else {
        labelEl = document.createElement("span");
        labelEl.className = "pix-sw-label";
        labelEl.textContent = isTrailing ? "(empty)" : usefulType || `input ${slotIdx1}`;
        labelEl.title = labelEl.textContent;
      }

      // Wire-type tag - shown ONLY when the row has a custom name (then the auto
      // "string N" label is replaced, so the tag keeps the type visible). Unnamed
      // rows don't need it: their label already reads "string 1" / "image 3".
      let typeEl = null;
      if (connected && !isTrailing && custom && usefulType) {
        typeEl = document.createElement("span");
        typeEl.className = "pix-sw-type";
        typeEl.textContent = usefulType;
        typeEl.title = `Input type: ${usefulType}`;
      }

      const toggleEl = document.createElement("span");
      toggleEl.className = "pix-sw-toggle";
      const knob = document.createElement("span");
      knob.className = "pix-sw-knob";
      toggleEl.appendChild(knob);

      if (typeEl) rowEl.append(numEl, labelEl, typeEl, toggleEl);
      else rowEl.append(numEl, labelEl, toggleEl);

      if (connected && !isTrailing) {
        rowEl.title = "Click to route this input through (the name field renames it)";
        rowEl.addEventListener("click", (e) => {
          if (e.target === labelEl) return; // clicking the name field = edit, not activate
          e.stopPropagation();
          setActiveRow(node, slotIdx1);
        });
      }
      root.appendChild(rowEl);
    }
  }

  node._pixSwRefresh = render;
  render();
  return { render };
}
