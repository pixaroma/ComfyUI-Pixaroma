// Mute Switch Pixaroma - Nodes 2.0 DOM body (mode bar + scene rows).
//
// In the legacy renderer the two mode pills (Single|Multi, Mute|Bypass) and the
// per-row ON/OFF toggles are PAINTED on the canvas (render.mjs / onMouseDown).
// Nodes 2.0 skips onDrawForeground, so we render a single DOM widget for the
// node body instead: a mode bar on top, then one row per input below the
// Vue-drawn input dots. Rows map to the dots by ORDER (row 1 = the 1st dot).
//
// Mirrors js/switch/vue_list.mjs (the established Switch-family pattern) and
// adds the two-toggle mode bar. Per the user's choice: each connected row has
// an editable name field, and ONLY the ON/OFF toggle flips the scene (the rest
// of the row is not a click target). Renaming + toggling write the SAME state
// the legacy canvas reads, so both renderers stay in lockstep.

import { readState, togglePillRow, setSelectMode, setMuteMode } from "./core.mjs";
import { getUpstreamType } from "./render.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";

const BRAND = "#f66744";
const MODEBAR_H = 36; // mode bar block (segments + its padding)
const LIST_ROW_H = 26; // per-row height incl. the 4px gap
const LIST_PAD = 8;    // top + bottom padding of the list container

function widgetHeight(node) {
  const rows = node.inputs?.length || 1;
  return MODEBAR_H + rows * LIST_ROW_H + LIST_PAD;
}

function injectCSS() {
  if (document.getElementById("pix-ms-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ms-css";
  s.textContent = `
    .pix-ms-root { display:flex; flex-direction:column; width:100%; box-sizing:border-box; }
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
    /* Scene rows. */
    .pix-ms-list { display:flex; flex-direction:column; gap:4px; padding:0 6px 6px; box-sizing:border-box; width:100%; }
    .pix-ms-row {
      display:flex; align-items:center; gap:8px; height:22px; box-sizing:border-box;
      border-radius:6px; padding:0 8px;
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

// Build the Nodes 2.0 DOM body for a Mute Switch node and wire it as the node's
// refresh target (node._pixMsRefresh). Returns { render }.
export function buildMuteSwitchVueList(node) {
  injectCSS();
  const root = document.createElement("div");
  root.className = "pix-ms-root";
  const modebar = document.createElement("div");
  modebar.className = "pix-ms-modebar";
  const list = document.createElement("div");
  list.className = "pix-ms-list";
  root.append(modebar, list);

  const widget = node.addDOMWidget("pixaroma_mute_switch_list", "pixaroma_mute_switch_list", root, {
    serialize: false,
    getMinHeight: () => widgetHeight(node),
    getMaxHeight: () => widgetHeight(node),
    getValue: () => null,
    setValue: () => {},
  });
  applyAdaptiveCanvasOnly(widget);

  function render() {
    const state = readState(node);
    const selectMode = state.selectMode || "multi";
    const muteMode = state.muteMode || "mute";
    const rows = state.rows || [];
    const inputs = node.inputs || [];

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

    // ── Scene rows ────────────────────────────────────────────────────────
    list.innerHTML = "";
    for (let i = 0; i < inputs.length; i++) {
      const slotIdx1 = i + 1;
      const slot = inputs[i];
      const connected = slot != null && slot.link != null;
      const isTrailing = !connected && slotIdx1 === inputs.length;
      const row = rows[i];
      const on = connected && row && row.enabled;

      const rowEl = document.createElement("div");
      rowEl.className = "pix-ms-row" + (isTrailing ? " trailing" : "");

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
        labelEl.textContent = isTrailing ? "(empty)" : (usefulType ? usefulType.toLowerCase() : "");
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

      list.appendChild(rowEl);
    }
  }

  node._pixMsRefresh = render;
  render();
  return { render };
}
