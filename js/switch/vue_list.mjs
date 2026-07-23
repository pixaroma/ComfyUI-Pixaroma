// Switch Pixaroma - Nodes 2.0 rows, each with its input dot ON THE ROW.
//
// HOW THE DOT LANDS ON THE ROW (ComfyUI frontend >= ~1.45, verified against the
// bundled sourcemaps - do NOT re-grep the bundle for this):
//
//   * NodeSlots.vue builds the top-left dot column from `nonWidgetedInputs()` -
//     every input that does NOT carry a `widget` marker. An input WITH one is
//     dropped from that column entirely.
//   * NodeWidgets.vue renders each widget as a 3-column subgrid row, and column
//     ONE is a real <InputSlot dot-only>, rendered when the widget has
//     `slotMetadata`. That dot is the genuine slot (correct index, link
//     interaction, position tracking) - not a decoration.
//   * useGraphNodeManager.buildSlotMetadata() keys slot metadata by BOTH
//     `input.name` AND `input.widget.name`, and safeWidgetMapper attaches it to
//     the widget of the same name.
//
// So: one DOM widget per input, named the same as that input's `widget` marker,
// and Vue paints the dot on the widget's own line - the legacy layout, natively.
//
// Legacy is untouched: it has NO widgets at all (rows are canvas-painted at the
// dot Y in render.mjs), and index.js strips the `widget` marker out of
// node.serialize() so saved workflows stay byte-identical to before and a file
// saved in one renderer opens clean in the other.
//
// Reactivity note: in Nodes 2.0 `node.inputs` / `node.widgets` are shallowReactive
// arrays installed on the live node, so pushing/removing a widget re-renders, but
// mutating a field INSIDE an existing slot (like `slot.widget`) does not. After
// marking slots we therefore reassign `node.inputs` to force the re-read.

import { readState, getUpstreamType, setActiveRow } from "./core.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";

const BRAND = "#f66744";
const ROW_MIN_H = 24;                 // matches the 24px slot-dot row height
const WIDGET_TYPE = "pixaroma_switch_row";
const ROW_WIDGET_NAME = (idx1) => `pixsw_row_${idx1}`;

function injectCSS() {
  if (document.getElementById("pix-sw-css")) return;
  const s = document.createElement("style");
  s.id = "pix-sw-css";
  s.textContent = `
    .pix-sw-row {
      display:flex; align-items:center; gap:8px; min-height:${ROW_MIN_H - 2}px;
      box-sizing:border-box; border-radius:6px; padding:0 8px;
      border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04);
      cursor:pointer; user-select:none;
    }
    .pix-sw-row:hover { border-color:rgba(255,255,255,0.30); }
    .pix-sw-row.active { border-color:${BRAND}; background:rgba(246,103,68,0.12); }
    .pix-sw-row.active:hover { border-color:${BRAND}; }
    .pix-sw-row.trailing { cursor:default; opacity:0.5; border-style:dashed; }
    .pix-sw-row.trailing:hover { border-color:rgba(255,255,255,0.12); }
    .pix-sw-num { flex:none; min-width:50px; color:rgba(255,255,255,0.55); font:12px 'Segoe UI',-apple-system,sans-serif; white-space:nowrap; }
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
    .pix-sw-toggle {
      position:relative; width:28px; height:14px; border-radius:7px; flex:none; box-sizing:border-box;
      border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06);
    }
    .pix-sw-row.active .pix-sw-toggle { border-color:${BRAND}; background:${BRAND}; }
    .pix-sw-knob { position:absolute; top:2px; left:2px; width:8px; height:8px; border-radius:50%; background:#ccc; transition:left .1s ease; }
    .pix-sw-row.active .pix-sw-knob { left:16px; background:#fff; }
    .pix-sw-row.trailing .pix-sw-toggle { visibility:hidden; }

    /* Vue paints a widget-row dot at opacity 0 until the row is hovered or the
       input is wired. Our rows ARE the inputs, so every dot must always show -
       otherwise an empty row looks like it has nowhere to plug a wire in. */
    .lg-node-widget:has(.pix-sw-row) > div:first-child { opacity:1 !important; }
  `;
  document.head.appendChild(s);
}

// Ensure node.widgets holds exactly one row widget per input slot, and that each
// input carries the `widget` marker pointing at its row widget (that marker is
// what moves the dot out of the top column and onto the row).
function syncRowWidgets(node) {
  const inputs = node.inputs || [];
  const rows = node._pixSwRows || (node._pixSwRows = []);

  // Drop surplus rows (a disconnect removed a slot). Row widgets are positional,
  // so only the tail ever needs removing - names never have to change.
  while (rows.length > inputs.length) {
    const w = rows.pop();
    const i = node.widgets ? node.widgets.indexOf(w) : -1;
    if (i >= 0) node.widgets.splice(i, 1);
    w.onRemove?.();
  }

  // Add missing rows (a connect grew the slot list).
  while (rows.length < inputs.length) {
    const el = document.createElement("div");
    el.className = "pix-sw-row";
    const w = node.addDOMWidget(ROW_WIDGET_NAME(rows.length + 1), WIDGET_TYPE, el, {
      serialize: false,   // options.serialize -> keeps it out of the API prompt
      getMinHeight: () => ROW_MIN_H,
    });
    // widget.serialize (top-level) is the SEPARATE flag LGraphNode.serialize()
    // reads for workflow persistence. Without it the rows would each take a slot
    // in widgets_values, so the saved file would change with the row count.
    w.serialize = false;
    applyAdaptiveCanvasOnly(w);
    // Own-property shadow of DOMWidget.computeLayoutSize: without this the row
    // is an "auto" (growing) grid row and N rows would split the node's spare
    // height between them. We want each row to hug its content.
    w.computeLayoutSize = undefined;
    rows.push(w);
  }

  // Bind slot -> row widget. `_widget` is litegraph's direct binding; `widget`
  // is the marker both renderers read.
  let changed = false;
  for (let i = 0; i < inputs.length; i++) {
    const slot = inputs[i];
    const w = rows[i];
    if (!slot || !w) continue;
    const name = ROW_WIDGET_NAME(i + 1);
    if (slot.widget?.name !== name) {
      slot.widget = { name };
      changed = true;
    }
    if (slot._widget !== w) slot._widget = w;
  }

  // shallowReactive only tracks the ARRAY, not fields inside a slot, so the
  // marker we just wrote is invisible to Vue until the array itself changes.
  // Reassigning routes through the reactive setter and forces the re-read.
  if (changed) node.inputs = inputs.slice();
}

// Paint the contents of every row widget from the current slot + state.
function renderRows(node) {
  const inputs = node.inputs || [];
  const rows = node._pixSwRows || [];
  const state = readState(node);
  const activeIndex = state.activeIndex ?? 0; // 1-based; 0 = none
  const labels = state.labels ?? {};

  for (let i = 0; i < rows.length && i < inputs.length; i++) {
    const rowEl = rows[i].element;
    if (!rowEl) continue;

    const slotIdx1 = i + 1;
    const slot = inputs[i];
    const connected = slot != null && slot.link != null;
    const isTrailing = !connected && slotIdx1 === inputs.length;
    const isActive = connected && activeIndex === slotIdx1;

    rowEl.className =
      "pix-sw-row" + (isActive ? " active" : "") + (isTrailing ? " trailing" : "");
    rowEl.innerHTML = "";

    // Left: fixed "input N" identity (matches the slot name Python routes on).
    const numEl = document.createElement("span");
    numEl.className = "pix-sw-num";
    numEl.textContent = `input ${slotIdx1}`;

    const custom = labels[slotIdx1];
    const type = connected ? getUpstreamType(node, slotIdx1) : null;
    const usefulType = type && type !== "*" ? type : null;

    // Connected rows get an editable name field; the trailing empty row gets a
    // plain dim "(empty)" label.
    let labelEl;
    if (connected && !isTrailing) {
      labelEl = document.createElement("input");
      labelEl.type = "text";
      labelEl.className = "pix-sw-name";
      labelEl.maxLength = 64;
      labelEl.spellcheck = false;
      labelEl.value = custom || "";
      // Default shows the wire type (string / image); typing a name overrides it.
      labelEl.placeholder = usefulType ? usefulType.toLowerCase() : "name";
      labelEl.title = "Type a name to label this input (defaults to its type)";
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
        // Writes the same state.labels the legacy canvas paint reads, so a name
        // set here shows in legacy too. No re-render here (it would drop focus
        // mid-edit).
        node.graph?.setDirtyCanvas?.(true, true);
      };
      labelEl.addEventListener("change", commitName);
      labelEl.addEventListener("blur", commitName);
    } else {
      labelEl = document.createElement("span");
      labelEl.className = "pix-sw-label";
      // A trailing row can carry a name that is waiting for its wire (paste
      // keeps the copied names while the rows regrow). Legacy paints that name
      // dimmed rather than "(empty)", so show it here too or the two renderers
      // disagree on the same node.
      labelEl.textContent = isTrailing
        ? (custom || "(empty)")
        : (usefulType ? usefulType.toLowerCase() : "");
      labelEl.title = labelEl.textContent;
    }

    const toggleEl = document.createElement("span");
    toggleEl.className = "pix-sw-toggle";
    const knob = document.createElement("span");
    knob.className = "pix-sw-knob";
    toggleEl.appendChild(knob);

    rowEl.append(numEl, labelEl, toggleEl);

    rowEl.onclick = null;
    rowEl.title = "";
    if (connected && !isTrailing) {
      rowEl.title = "Click to route this input through (the name field renames it)";
      rowEl.onclick = (e) => {
        if (e.target === labelEl) return; // clicking the name field = edit, not activate
        e.stopPropagation();
        setActiveRow(node, slotIdx1);
      };
    }
  }
}

// Build the Nodes 2.0 row widgets for a Switch node and wire the refresh hook
// core.mjs calls after every slot / state change.
export function buildSwitchVueList(node) {
  injectCSS();
  const refresh = () => {
    syncRowWidgets(node);
    renderRows(node);
  };
  node._pixSwRefresh = refresh;
  refresh();
  return { render: refresh };
}
