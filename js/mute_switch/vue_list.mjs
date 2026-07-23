// Mute Switch Pixaroma - Nodes 2.0 DOM body (mode bar + scene rows).
//
// In the legacy renderer the two mode pills (Single|Multi, Mute|Bypass) and the
// per-row ON/OFF toggles are PAINTED on the canvas (render.mjs / onMouseDown).
// Nodes 2.0 skips onDrawForeground, so we render DOM widgets instead: a mode-bar
// widget on top, then ONE ROW WIDGET PER INPUT.
//
// One widget per input is what puts each input's dot ON its own row (the same
// side-by-side layout legacy has). See js/switch/vue_list.mjs for the full
// explanation of ComfyUI's widget-socket model: an input marked
// `input.widget = {name}` leaves the top dot column and its dot is rendered in
// column 1 of the same-named widget's row - a real slot, not a decoration.
//
// The mode bar is a normal widget with no matching input, so it simply gets no
// dot. Renaming + toggling write the SAME state the legacy canvas reads, so both
// renderers stay in lockstep.

import { readState, togglePillRow, setSelectMode, setMuteMode } from "./core.mjs";
import { getUpstreamType } from "./render.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";

const BRAND = "#f66744";
const MODEBAR_H = 34;                 // mode bar block (segments + its padding)
const ROW_MIN_H = 24;                 // matches the 24px slot-dot row height
const ROW_WIDGET_TYPE = "pixaroma_mute_switch_row";
const ROW_WIDGET_NAME = (idx1) => `pixms_row_${idx1}`;

function injectCSS() {
  if (document.getElementById("pix-ms-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ms-css";
  s.textContent = `
    /* Mode bar - two segmented toggles, Pixaroma DOM pill-bar style. */
    .pix-ms-modebar {
      display:flex; gap:8px; align-items:center; justify-content:space-between;
      padding:6px 6px; box-sizing:border-box;
    }
    .pix-ms-seg {
      display:flex; flex:1; min-width:0; height:22px; border-radius:7px; overflow:hidden;
      border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.04);
    }
    .pix-ms-segbtn {
      flex:1; min-width:0; display:flex; align-items:center; justify-content:center;
      font:11px 'Segoe UI',-apple-system,sans-serif; color:rgba(255,255,255,0.65);
      cursor:pointer; user-select:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      padding:0 4px;
    }
    .pix-ms-segbtn:hover { color:#ddd; }
    .pix-ms-segbtn.active { background:${BRAND}; color:#fff; }
    .pix-ms-segbtn.active:hover { color:#fff; }
    /* Scene rows - each is its own widget, so its input dot sits on the row. */
    .pix-ms-row {
      display:flex; align-items:center; gap:8px; min-height:${ROW_MIN_H - 2}px;
      box-sizing:border-box; border-radius:6px; padding:0 8px;
      border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04);
    }
    .pix-ms-row.trailing { opacity:0.5; border-style:dashed; }
    .pix-ms-num { flex:none; min-width:50px; color:rgba(255,255,255,0.55); font:12px 'Segoe UI',-apple-system,sans-serif; white-space:nowrap; }
    .pix-ms-label {
      flex:1; min-width:0; color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .pix-ms-row.trailing .pix-ms-label { color:#aaa; font-style:italic; }
    /* Editable scene name: looks like plain label text until hovered/focused. */
    .pix-ms-name {
      flex:1; min-width:0; box-sizing:border-box; height:18px;
      background:transparent; border:1px solid transparent; border-radius:4px;
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif;
      padding:1px 4px; outline:none; cursor:text; text-overflow:ellipsis;
    }
    .pix-ms-name:hover { border-color:rgba(255,255,255,0.18); }
    .pix-ms-name:focus { border-color:${BRAND}; background:#1d1d1d; }
    .pix-ms-name::placeholder { color:#888; }
    /* ON/OFF toggle - the only click target to flip a scene. */
    .pix-ms-toggle {
      position:relative; width:28px; height:14px; border-radius:7px; flex:none; box-sizing:border-box;
      border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06);
      cursor:pointer;
    }
    .pix-ms-toggle.on { border-color:${BRAND}; background:${BRAND}; }
    .pix-ms-knob { position:absolute; top:2px; left:2px; width:8px; height:8px; border-radius:50%; background:#ccc; transition:left .1s ease; }
    .pix-ms-toggle.on .pix-ms-knob { left:16px; background:#fff; }

    /* Vue paints a widget-row dot at opacity 0 until the row is hovered or the
       input is wired. Our rows ARE the inputs, so every dot must always show -
       otherwise an empty row looks like it has nowhere to plug a wire in. */
    .lg-node-widget:has(.pix-ms-row) > div:first-child { opacity:1 !important; }
  `;
  document.head.appendChild(s);
}

// Build one segmented toggle (two labelled halves). `active` is "left"/"right".
function buildSegToggle(leftLabel, rightLabel, active, leftTip, rightTip, onLeft, onRight) {
  const seg = document.createElement("div");
  seg.className = "pix-ms-seg";
  const mk = (label, isActive, tip, handler) => {
    const b = document.createElement("div");
    b.className = "pix-ms-segbtn" + (isActive ? " active" : "");
    b.textContent = label;
    b.title = tip;
    b.addEventListener("click", (e) => { e.stopPropagation(); handler(); });
    return b;
  };
  seg.append(
    mk(leftLabel, active === "left", leftTip, onLeft),
    mk(rightLabel, active === "right", rightTip, onRight),
  );
  return seg;
}

// Ensure node.widgets holds exactly one row widget per input slot, and that each
// input carries the `widget` marker pointing at its row widget (that marker is
// what moves the dot out of the top column and onto the row).
function syncRowWidgets(node) {
  const inputs = node.inputs || [];
  const rows = node._pixMsRows || (node._pixMsRows = []);

  // Drop surplus rows (a disconnect removed a slot). Row widgets are positional,
  // so only the tail ever needs removing - names never have to change.
  while (rows.length > inputs.length) {
    const w = rows.pop();
    const i = node.widgets ? node.widgets.indexOf(w) : -1;
    if (i >= 0) node.widgets.splice(i, 1);
    w.onRemove?.();
  }

  // Add missing rows (a connect grew the slot list). They append AFTER the mode
  // bar widget, so the body reads mode bar first, then the rows.
  while (rows.length < inputs.length) {
    const el = document.createElement("div");
    el.className = "pix-ms-row";
    const w = node.addDOMWidget(ROW_WIDGET_NAME(rows.length + 1), ROW_WIDGET_TYPE, el, {
      serialize: false,   // options.serialize -> keeps it out of the API prompt
      getMinHeight: () => ROW_MIN_H,
    });
    // widget.serialize (top-level) is the SEPARATE flag LGraphNode.serialize()
    // reads for workflow persistence - without it every row would take a slot in
    // widgets_values and the saved file would change with the row count.
    w.serialize = false;
    applyAdaptiveCanvasOnly(w);
    // Own-property shadow of DOMWidget.computeLayoutSize: without this each row
    // is an "auto" (growing) grid row and they would split the node's spare
    // height between them instead of hugging their content.
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

// Build the Nodes 2.0 DOM body for a Mute Switch node and wire it as the node's
// refresh target (node._pixMsRefresh). Returns { render }.
export function buildMuteSwitchVueList(node) {
  injectCSS();
  const modebar = document.createElement("div");
  modebar.className = "pix-ms-modebar";

  const barWidget = node.addDOMWidget("pixaroma_mute_switch_bar", "pixaroma_mute_switch_bar", modebar, {
    serialize: false,
    getMinHeight: () => MODEBAR_H,
  });
  barWidget.serialize = false;
  applyAdaptiveCanvasOnly(barWidget);
  barWidget.computeLayoutSize = undefined;

  function render() {
    syncRowWidgets(node);

    const state = readState(node);
    const selectMode = state.selectMode || "multi";
    const muteMode = state.muteMode || "mute";
    const rows = state.rows || [];
    const inputs = node.inputs || [];
    const rowWidgets = node._pixMsRows || [];

    // ── Mode bar ──────────────────────────────────────────────────────────
    modebar.innerHTML = "";
    modebar.append(
      buildSegToggle(
        "Single", "Multi",
        selectMode === "single" ? "left" : "right",
        "Allow only one scene on at a time",
        "Allow any combination of scenes on",
        () => setSelectMode(node, "single"),
        () => setSelectMode(node, "multi"),
      ),
      buildSegToggle(
        "Mute", "Bypass",
        muteMode === "mute" ? "left" : "right",
        "Muted: the scene does not run at all",
        "Bypass: each node passes its input through unchanged",
        () => setMuteMode(node, "mute"),
        () => setMuteMode(node, "bypass"),
      ),
    );

    // ── Scene rows (one widget each, so the dot lands on the row) ─────────
    for (let i = 0; i < inputs.length && i < rowWidgets.length; i++) {
      const rowEl = rowWidgets[i].element;
      if (!rowEl) continue;

      const slotIdx1 = i + 1;
      const slot = inputs[i];
      const connected = slot != null && slot.link != null;
      const isTrailing = !connected && slotIdx1 === inputs.length;
      const row = rows[i];
      const on = connected && row && row.enabled;

      rowEl.className = "pix-ms-row" + (isTrailing ? " trailing" : "");
      rowEl.innerHTML = "";

      // Left: fixed "input N" identity (matches the dot label on the node edge).
      const numEl = document.createElement("span");
      numEl.className = "pix-ms-num";
      numEl.textContent = `input ${slotIdx1}`;

      const type = connected ? getUpstreamType(node, slotIdx1) : null;
      const usefulType = type && type !== "*" ? type : null;

      // Connected rows get an editable name field; the trailing empty row gets
      // a plain dim "(empty)" label.
      let labelEl;
      if (connected && !isTrailing) {
        labelEl = document.createElement("input");
        labelEl.type = "text";
        labelEl.className = "pix-ms-name";
        labelEl.maxLength = 64;
        labelEl.spellcheck = false;
        labelEl.value = (row && row.label) || "";
        labelEl.placeholder = usefulType ? usefulType.toLowerCase() : "name";
        labelEl.title = "Type a name to label this scene (defaults to its type)";
        labelEl.addEventListener("keydown", (e) => {
          e.stopPropagation(); // keep typing instead of triggering canvas shortcuts
          if (e.key === "Enter") { e.preventDefault(); labelEl.blur(); }
          else if (e.key === "Escape") {
            e.preventDefault();
            labelEl.value = (readState(node).rows?.[i]?.label) || "";
            labelEl.blur();
          }
        });
        const commitName = () => {
          const v = labelEl.value.trim();
          const st = readState(node);
          if (st.rows && st.rows[i]) st.rows[i].label = v || null;
          // Writes the same state.rows[i].label the legacy canvas paint reads.
          // No list re-render here (it would drop focus mid-edit).
          node.graph?.setDirtyCanvas?.(true, true);
        };
        labelEl.addEventListener("change", commitName);
        labelEl.addEventListener("blur", commitName);
      } else {
        labelEl = document.createElement("span");
        labelEl.className = "pix-ms-label";
        // A trailing row can carry a name that is waiting for its wire (paste
        // keeps the copied names while the rows regrow). Legacy paints that
        // name dimmed rather than "(empty)", so show it here too or the two
        // renderers disagree on the same node.
        labelEl.textContent = isTrailing
          ? (row?.label || "(empty)")
          : (usefulType ? usefulType.toLowerCase() : "");
        labelEl.title = labelEl.textContent;
      }

      rowEl.append(numEl, labelEl);

      // Only connected rows get a clickable ON/OFF toggle. Per the user's
      // choice, the toggle is the ONLY click target that flips the scene.
      if (connected && !isTrailing) {
        const toggleEl = document.createElement("span");
        toggleEl.className = "pix-ms-toggle" + (on ? " on" : "");
        toggleEl.title = on ? "Click to skip this scene" : "Click to enable this scene";
        const knob = document.createElement("span");
        knob.className = "pix-ms-knob";
        toggleEl.appendChild(knob);
        toggleEl.addEventListener("click", (e) => {
          e.stopPropagation();
          togglePillRow(node, slotIdx1);
        });
        rowEl.appendChild(toggleEl);
      }
    }
  }

  node._pixMsRefresh = render;
  render();
  return { render };
}
