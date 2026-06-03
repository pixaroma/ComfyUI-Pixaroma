// Find & Replace Pixaroma - DOM widget render.
//
// Builds the node body: a row of global toggle pills, one rule row per state
// entry (handle / ON-OFF / find -> replace / delete), an action row
// (+ Add rule / Reset), and a live before/after preview.

import {
  readState,
  applyRulesJS,
  diffTokens,
  escapeHtml,
  getPreviewInput,
} from "./core.mjs";
import { attachFieldEditor, attachDragHandlers } from "./interaction.mjs";

const CSS_ID = "pix-find-replace-css";

const CSS = `
.pix-fr-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 8px 8px 8px;
  box-sizing: border-box;
  font-family: inherit;
  color: #ddd;
  /* NO height:100% and NO min-height here - deliberate (the Prompt Reader
     pattern). In Nodes 2.0 the host wrapper gives this root flex:1, so it
     still fills the node body and the preview grows with the node; in
     legacy ComfyUI sizes the widget element. Crucially the root's natural
     flex min-content height (the fixed rows + the preview's real
     min-height) is what the Nodes 2.0 resize floor measures (it collapses
     the node to --node-height:0 and reads the content height), so the node
     can't be dragged small enough to overflow - no JS needed. A height:100%
     here would collapse to 0 under that measurement and break the floor. */
}

/* ---- global toggle pills ---- */
.pix-fr-toggles { display: flex; gap: 6px; flex-wrap: wrap; flex: 0 0 auto; }
.pix-fr-tog {
  font-size: 10.5px;
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.68);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.pix-fr-tog:hover { border-color: #f66744; color: #ddd; }
.pix-fr-tog.on { background: #f66744; border-color: #f66744; color: #fff; }
.pix-fr-tog.on:hover { filter: brightness(1.08); color: #fff; }
.pix-fr-tog.is-muted {
  opacity: 0.4;
  cursor: not-allowed;
  border-color: rgba(255,255,255,0.1);
}
.pix-fr-tog.is-muted:hover { border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.68); }

/* ---- rule rows ---- */
.pix-fr-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px;
  border-radius: 4px;
  /* Semi-transparent overlay (NOT opaque dark) so rows adapt to a user-
     recolored node body instead of showing as grey patches (UI convention #1). */
  background: rgba(0,0,0,0.18);
  border: 1px solid rgba(255,255,255,0.08);
  position: relative;
  transition: opacity 0.12s ease;
  flex: 0 0 auto;
}
.pix-fr-row.is-disabled { opacity: 0.45; }
.pix-fr-row.is-dragging { opacity: 0.4; }
.pix-fr-row.is-drop-target-above { box-shadow: 0 -2px 0 0 #f66744; }
.pix-fr-row.is-drop-target-below { box-shadow: 0 2px 0 0 #f66744; }

.pix-fr-handle {
  cursor: grab;
  color: #888;
  font-size: 14px;
  line-height: 22px;
  user-select: none;
  padding: 0 1px;
  letter-spacing: -2px;
  flex: none;
}
.pix-fr-handle:active { cursor: grabbing; }
.pix-fr-handle:hover { color: #ccc; }

.pix-fr-toggle {
  min-width: 30px;
  height: 18px;
  margin-top: 2px;
  border-radius: 9px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.15);
  cursor: pointer;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 600;
  color: rgba(255,255,255,0.65);
  letter-spacing: 0.5px;
  user-select: none;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.pix-fr-toggle:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.35); color: #fff; }
.pix-fr-toggle.on { background: #f66744; border-color: #f66744; color: #fff; }
.pix-fr-toggle.on:hover { filter: brightness(1.08); color: #fff; }

/* find -> replace fields */
.pix-fr-field {
  flex: 1 1 0;
  /* align-self:flex-start + height (not min-height) keeps the textarea sized to
     its CONTENT (one line until you type more), so it never stretches to fill a
     tall row when the node is large (e.g. after deleting a rule) or shows a
     scrollbar when the node is squished. autoGrow overrides height for
     multi-line content, capped by max-height. */
  align-self: flex-start;
  min-width: 0;
  height: 30px;
  max-height: 120px;
  resize: none;
  background: #1d1d1d;
  border: 1px solid #333;
  border-radius: 4px;
  color: #e0e0e0;
  font: 12px monospace;
  padding: 6px 8px;
  outline: none;
  box-sizing: border-box;
  overflow-y: auto;
  line-height: 1.35;
}
.pix-fr-field:focus { border-color: #f66744; }
.pix-fr-field::placeholder { color: rgba(255,255,255,0.32); font-style: italic; }
.pix-fr-field.is-delete::placeholder { color: rgba(255,150,160,0.55); }

.pix-fr-arrow { color: #f66744; font-weight: 700; line-height: 30px; flex: none; }

.pix-fr-delete {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border-radius: 3px;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 14px;
  line-height: 14px;
  flex: none;
  padding: 0;
}
.pix-fr-delete:hover { color: #f66744; background: rgba(246,103,68,0.12); }
.pix-fr-delete:disabled { color: #444; cursor: not-allowed; background: transparent; }

/* ---- action row ---- */
.pix-fr-actions { display: flex; flex-wrap: wrap; gap: 6px; align-self: flex-start; user-select: none; flex: 0 0 auto; }
.pix-fr-add, .pix-fr-reset {
  box-sizing: border-box;
  min-width: 92px;
  user-select: none;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px;
  color: rgba(255,255,255,0.85);
  cursor: pointer;
  font: 11px inherit;
  font-family: inherit;
  padding: 5px 12px;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.pix-fr-add { color: #f66744; border-color: rgba(246,103,68,0.5); }
.pix-fr-add:hover { background: #f66744; border-color: #f66744; color: #fff; }
.pix-fr-reset:hover { background: #f66744; border-color: #f66744; color: #fff; }
.pix-fr-reset:disabled {
  color: rgba(255,255,255,0.3);
  cursor: default;
  background: rgba(255,255,255,0.02);
  border-color: rgba(255,255,255,0.08);
}
.pix-fr-reset:disabled:hover {
  background: rgba(255,255,255,0.02);
  border-color: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.3);
}

/* ---- live preview (fills the remaining node height) ---- */
.pix-fr-preview {
  border-top: 1px solid #3a3a3a;
  padding-top: 8px;
  flex: 1 1 0;
  /* A REAL min-height (not 0): this is the flex area, so its min-height is
     what stops the root collapsing below its content under the Nodes 2.0
     resize floor measurement. It still grows to fill extra node height. */
  min-height: 100px;
  display: flex;
  flex-direction: column;
}
.pix-fr-prev-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
  color: #7fd18f; font-weight: 700; margin-bottom: 5px;
  flex: 0 0 auto;
}
.pix-fr-prev-note { color: #666; font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 9.5px; }
.pix-fr-prev-body {
  background: #161616;
  border: 1px solid #2c3a2c;
  border-radius: 4px;
  padding: 7px 9px;
  font: 11px monospace;
  color: #cfcfcf;
  line-height: 1.5;
  flex: 1 1 0;
  min-height: 60px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.pix-fr-before { color: #7d7d7d; margin-bottom: 5px; }
.pix-fr-before .o { background: #3a2026; color: #e2899a; text-decoration: line-through; border-radius: 2px; padding: 0 1px; }
.pix-fr-after .n { background: #1f4a2a; color: #9af0ad; border-radius: 2px; padding: 0 1px; }
.pix-fr-prev-empty { color: #777; font-style: italic; }
.pix-fr-prev-nochange { color: #888; font-size: 9.5px; margin-top: 4px; font-style: italic; }
.pix-fr-prev-trunc { color: #b89; font-size: 9.5px; margin-top: 5px; }
.pix-fr-warn { color: #e9b04a; font-size: 10px; margin-top: 6px; }

/* ---- confirm dialog ---- */
.pix-fr-confirm-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000; font-family: inherit; -webkit-font-smoothing: antialiased;
}
.pix-fr-confirm-box {
  background: #1d1d1d; border: 1px solid #2e2e2e; border-radius: 6px;
  min-width: 320px; max-width: 480px; padding: 18px 20px; color: #ddd;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}
.pix-fr-confirm-title { font-size: 14px; font-weight: 600; color: #fff; margin: 0 0 8px 0; }
.pix-fr-confirm-msg { font-size: 13px; color: #bbb; margin: 0 0 16px 0; line-height: 1.4; }
.pix-fr-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.pix-fr-confirm-btn {
  background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 3px;
  color: #ddd; cursor: pointer; font-size: 12px; padding: 6px 14px; font-family: inherit;
}
.pix-fr-confirm-btn:hover { background: #333; border-color: #555; }
.pix-fr-confirm-btn.primary { background: #f66744; border-color: #f66744; color: #fff; }
.pix-fr-confirm-btn.primary:hover { background: #ff7a58; border-color: #ff7a58; }
`;

export function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const el = document.createElement("style");
  el.id = CSS_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-fr-root";
  return root;
}

// Minimum preview block height (head + a few lines of body). The preview
// flexes to fill any extra node height beyond this floor.
const PREVIEW_MIN = 100;

// The node's minimum height = the FIXED parts (toggles + rule rows + actions,
// measured live) + a minimum preview block. NOT the full preview, so the user
// can drag the node taller and the preview fills the new space (no dead gap).
// Sums children offsetHeight (NOT root.scrollHeight, which ComfyUI stretches -
// feedback loop), substituting PREVIEW_MIN for the flexible preview child.
export function measureMinHeight(root) {
  if (!root) return 180;
  let h = 0;
  let count = 0;
  for (const child of root.children) {
    if (child.offsetParent === null) continue;
    count += 1;
    if (child.classList.contains("pix-fr-preview")) h += PREVIEW_MIN;
    else h += child.offsetHeight;
  }
  const cs = getComputedStyle(root);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;
  if (count > 1) h += gap * (count - 1);
  h += parseFloat(cs.paddingTop) || 0;
  h += parseFloat(cs.paddingBottom) || 0;
  // Round to a 4px grid so sub-pixel/font jitter can't creep node.size bigger
  // on every workflow switch (getMinHeight/computeLayoutSize feed Nodes 2.0
  // grow-to-content, which is grow-only and accumulates - Vue Compat #18).
  return Math.max(180, Math.round(h / 4) * 4);
}

const TOGGLE_DEFS = [
  { key: "caseSensitive", label: "Aa Case", title: "Match upper/lowercase exactly. Off = ignore case." },
  { key: "wholeWord", label: "Whole word", title: "Only match whole words, so 'art' will not hit 'artist'." },
  { key: "regex", label: ".* Regex", title: "Treat the find field as a regular expression. Replace can use \\1 backreferences." },
  { key: "tidy", label: "✨ Tidy", title: "After the edits, collapse double spaces and fix stray or double commas." },
];

// renderAll: clears root and rebuilds the whole body.
export function renderAll(node, root, handlers) {
  const state = readState(node);
  root.innerHTML = "";

  // -- toggles --
  const toggles = document.createElement("div");
  toggles.className = "pix-fr-toggles";
  for (const def of TOGGLE_DEFS) {
    const pill = document.createElement("div");
    const muted = def.key === "wholeWord" && state.regex;
    pill.className = "pix-fr-tog" + (state[def.key] ? " on" : "") + (muted ? " is-muted" : "");
    pill.textContent = def.label;
    pill.title = muted ? "Whole word is ignored while Regex is on (add \\b in your pattern)." : def.title;
    if (!muted) pill.addEventListener("click", () => handlers.onToggleGlobal(def.key));
    toggles.appendChild(pill);
  }
  root.appendChild(toggles);

  // -- rule rows --
  for (const rule of state.rules) {
    root.appendChild(buildRuleRow(node, state, rule, handlers));
  }

  // -- actions --
  const actions = document.createElement("div");
  actions.className = "pix-fr-actions";

  const add = document.createElement("button");
  add.className = "pix-fr-add";
  add.type = "button";
  add.textContent = "+ Add rule";
  add.title = "Add an empty find/replace rule at the bottom";
  add.addEventListener("click", () => handlers.onAdd());
  actions.appendChild(add);

  const reset = document.createElement("button");
  reset.className = "pix-fr-reset";
  reset.type = "button";
  reset.textContent = "↺ Reset";
  reset.title = "Clear all rules and put the toggles back to defaults";
  reset.addEventListener("click", () => handlers.onReset());
  actions.appendChild(reset);
  root.appendChild(actions);

  // -- preview --
  const preview = document.createElement("div");
  preview.className = "pix-fr-preview";
  const head = document.createElement("div");
  head.className = "pix-fr-prev-head";
  head.innerHTML = `<span>Live preview</span><span class="pix-fr-prev-note">last text that ran through</span>`;
  preview.appendChild(head);
  const body = document.createElement("div");
  body.className = "pix-fr-prev-body";
  preview.appendChild(body);
  root.appendChild(preview);

  refreshResetState(node, root);
  renderPreview(node, root);
}

function buildRuleRow(node, state, rule, handlers) {
  const rowEl = document.createElement("div");
  rowEl.className = "pix-fr-row" + (rule.enabled ? "" : " is-disabled");
  rowEl.dataset.id = rule.id;
  rowEl.draggable = false;

  const handle = document.createElement("span");
  handle.className = "pix-fr-handle";
  handle.draggable = true;
  handle.textContent = "⋮⋮";
  handle.title = "Drag to reorder";
  rowEl.appendChild(handle);

  const toggle = document.createElement("div");
  toggle.className = "pix-fr-toggle" + (rule.enabled ? " on" : "");
  toggle.textContent = rule.enabled ? "ON" : "OFF";
  toggle.title = rule.enabled ? "Click to skip this rule" : "Click to apply this rule";
  toggle.addEventListener("click", () => handlers.onToggleRule(rule.id));
  rowEl.appendChild(toggle);

  const findTa = document.createElement("textarea");
  findTa.className = "pix-fr-field pix-fr-find";
  findTa.value = rule.find || "";
  findTa.rows = 1;
  findTa.placeholder = "find...";
  findTa.title = "Text to find" + (state.regex ? " (regular expression)" : "");
  rowEl.appendChild(findTa);
  attachFieldEditor(node, findTa, rule.id, "find");

  const arrow = document.createElement("span");
  arrow.className = "pix-fr-arrow";
  arrow.textContent = "→";
  rowEl.appendChild(arrow);

  const replaceTa = document.createElement("textarea");
  replaceTa.className = "pix-fr-field pix-fr-replace" + ((rule.replace || "") ? "" : " is-delete");
  replaceTa.value = rule.replace || "";
  replaceTa.rows = 1;
  replaceTa.placeholder = "replace…";
  replaceTa.title = "Text to replace it with. Leave empty to delete the found text.";
  rowEl.appendChild(replaceTa);
  attachFieldEditor(node, replaceTa, rule.id, "replace");

  const del = document.createElement("button");
  del.className = "pix-fr-delete";
  del.type = "button";
  del.textContent = "✕";
  del.title = "Delete this rule";
  del.disabled = state.rules.length <= 1;
  del.addEventListener("click", () => handlers.onDelete(rule.id));
  rowEl.appendChild(del);

  attachDragHandlers(node, rowEl, rule.id, handlers.onDrop);
  return rowEl;
}

// Enable/disable the Reset button based on whether anything is non-default.
export function refreshResetState(node, root) {
  const reset = root.querySelector(".pix-fr-reset");
  if (!reset) return;
  const s = readState(node);
  const anyRuleContent = s.rules.some((r) => (r.find && r.find.trim()) || (r.replace && r.replace.trim()) || !r.enabled);
  const moreThanOne = s.rules.length !== 1;
  const nonDefaultToggles = s.caseSensitive || s.wholeWord || s.regex || s.tidy !== true;
  reset.disabled = !(anyRuleContent || moreThanOne || nonDefaultToggles);
}

// renderPreview: recompute the before/after diff from the persisted last-run
// input + the current rules, and fill the preview body. Safe to call on every
// edit/toggle without a full rerender.
export function renderPreview(node, root) {
  const body = root.querySelector(".pix-fr-prev-body");
  if (!body) return;
  const prev = getPreviewInput(node);
  if (!prev) {
    body.innerHTML = `<div class="pix-fr-prev-empty">Run the workflow once to preview the result.</div>`;
    return;
  }
  const state = readState(node);
  const { output, warnings } = applyRulesJS(prev.input, state);

  let html;
  if (output === prev.input) {
    html =
      `<div class="pix-fr-after">${escapeHtml(output) || '<span style="color:#666">(empty)</span>'}</div>` +
      `<div class="pix-fr-prev-nochange">no changes from your current rules</div>`;
  } else {
    const diff = diffTokens(prev.input, output);
    let beforeHtml = "";
    let afterHtml = "";
    for (const part of diff) {
      const esc = escapeHtml(part.s);
      if (part.t === "eq") {
        beforeHtml += esc;
        afterHtml += esc;
      } else if (part.t === "del") {
        beforeHtml += `<span class="o">${esc}</span>`;
      } else {
        afterHtml += `<span class="n">${esc}</span>`;
      }
    }
    html =
      `<div class="pix-fr-before">${beforeHtml}</div>` +
      `<div class="pix-fr-after">${afterHtml || '<span style="color:#666">(empty)</span>'}</div>`;
  }

  if (prev.truncated) {
    html += `<div class="pix-fr-prev-trunc">Preview sample shortened - the full text still passes through.</div>`;
  }
  if (warnings && warnings.length) {
    html += `<div class="pix-fr-warn">⚠ ${escapeHtml(warnings.join("; "))}</div>`;
  }
  body.innerHTML = html;
}
