// Pause Text Pixaroma - the node body UI, built as ONE DOM widget so it renders
// identically in the Classic and Nodes 2.0 renderers with zero isVueNodes()
// branching. Layout top->bottom: status + Pause/Pass toggle, the editable text
// box (fills the remaining height) with a header (label + edited tag + Copy /
// Revert icons), then the count line + Regenerate / Continue buttons.
import { BRAND } from "../shared/utils.mjs";
import { getState, isEdited } from "./state.mjs";

// Fixed vertical budget for the non-fill rows, so getMinHeight is a CONSTANT
// (Vue Compat #18): byte-identical every save/load, node.size never jitters.
const TOP_H = 26;
const BOX_HDR_H = 20;
const BOX_MIN_BODY_H = 110;   // textarea min inside the box
const BOTTOM_H = 28;
const PAD = 6;
export const NODE_MIN_W = 300;
export const NODE_MIN_H = PAD + TOP_H + PAD + BOX_HDR_H + BOX_MIN_BODY_H + PAD + BOTTOM_H + PAD;

function injectCSS() {
  if (document.getElementById("pix-pt-css")) return;
  const s = document.createElement("style");
  s.id = "pix-pt-css";
  s.textContent = `
    .pix-pt-root { display:flex; flex-direction:column; flex:1 1 0; min-height:0;
      box-sizing:border-box; padding:${PAD}px; gap:${PAD}px; font:12px sans-serif; color:#ddd;
      overflow:hidden; }
    .pix-pt-top { display:flex; align-items:center; gap:8px; flex:0 0 auto; }
    .pix-pt-dot { width:7px; height:7px; border-radius:50%; background:${BRAND}; flex:0 0 auto; }
    .pix-pt-dot.busy { background:#3ec371; }
    .pix-pt-dot.idle { background:#666; }
    .pix-pt-status { flex:1 1 0; min-width:0; font-size:11px; color:rgba(255,255,255,0.75);
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-pt-toggle { display:flex; background:rgba(0,0,0,0.25); border-radius:6px; padding:2px; gap:2px; flex:0 0 auto; }
    .pix-pt-seg { text-align:center; padding:3px 10px; border-radius:5px; cursor:pointer;
      color:rgba(255,255,255,0.6); user-select:none; border:1px solid transparent; font-size:11px; }
    .pix-pt-seg.active { background:${BRAND}; color:#fff; border-color:${BRAND}; }
    .pix-pt-seg:not(.active):hover { border-color:${BRAND}; color:#ddd; }

    .pix-pt-box { flex:1 1 0; min-height:0; display:flex; flex-direction:column;
      background:#1d1d1d; border:1px solid #333; border-radius:5px; overflow:hidden; }
    .pix-pt-box.pt-focus { border-color:${BRAND}; }
    .pix-pt-box.pt-off { opacity:0.55; }
    .pix-pt-hdr { flex:0 0 auto; display:flex; align-items:center; gap:6px; padding:3px 6px 2px 9px;
      border-bottom:1px solid #2c2c2c; background:rgba(255,255,255,0.02); }
    .pix-pt-hlbl { font:10px 'Segoe UI',-apple-system,sans-serif; color:#8f8f8f; flex:1 1 0;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-pt-edited { color:${BRAND}; }
    .pix-pt-hic { width:19px; height:18px; border-radius:4px; display:flex; align-items:center;
      justify-content:center; cursor:pointer; background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.14); color:rgba(255,255,255,0.72); }
    .pix-pt-hic:hover:not(.off) { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    .pix-pt-hic.ok, .pix-pt-hic.ok:hover { background:#3ec371; border-color:#3ec371; color:#fff; }
    .pix-pt-hic.off { opacity:0.35; cursor:default; }
    .pix-pt-ta { flex:1 1 0; min-height:0; width:100%; box-sizing:border-box;
      background:transparent; color:#e0e0e0; border:0; outline:none; resize:none;
      font:12px monospace; line-height:1.4; padding:6px 8px; }
    .pix-pt-ta::placeholder { color:#5c5c5c; font-style:italic; }
    .pix-pt-ta:disabled { color:#9a9a9a; }

    .pix-pt-bot { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
    .pix-pt-count { flex:1 1 0; min-width:0; font-size:10px; color:#aaa;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-pt-btn { height:26px; padding:0 12px; border-radius:4px;
      border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.05);
      color:rgba(255,255,255,0.85); font:12px sans-serif; cursor:pointer;
      box-sizing:border-box; white-space:nowrap; user-select:none; }
    .pix-pt-btn:hover:not(:disabled) { border-color:${BRAND}; color:#fff; }
    .pix-pt-btn.primary:not(:disabled) { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    .pix-pt-btn.primary:hover:not(:disabled) { background:#ff8a5e; border-color:#ff8a5e; }
    .pix-pt-btn:disabled { opacity:0.45; cursor:default; }
  `;
  document.head.appendChild(s);
}

const COPY_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="9" y="9" width="11" height="11" rx="2"/>' +
  '<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const REVERT_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg>';

// Build the DOM widget. callbacks: { onGate, onContinue, onRegenerate, onCopy,
// onRevert, onInput }. Caches element refs on node._pixPtEls.
export function buildPauseTextWidget(node, callbacks) {
  injectCSS();
  const root = document.createElement("div");
  root.className = "pix-pt-root";

  // Top row: status + Pause/Pass toggle.
  const top = document.createElement("div");
  top.className = "pix-pt-top";
  const dot = document.createElement("span");
  dot.className = "pix-pt-dot";
  const status = document.createElement("span");
  status.className = "pix-pt-status";
  const toggle = document.createElement("div");
  toggle.className = "pix-pt-toggle";
  const segPause = document.createElement("div");
  segPause.className = "pix-pt-seg";
  segPause.textContent = "Pause";
  segPause.title = "Pause here on Run so you can edit before continuing";
  const segPass = document.createElement("div");
  segPass.className = "pix-pt-seg";
  segPass.textContent = "Pass";
  segPass.title = "Pass straight through; run the whole workflow in one go";
  toggle.append(segPause, segPass);
  top.append(dot, status, toggle);
  segPause.addEventListener("click", () => callbacks.onGate("pause"));
  segPass.addEventListener("click", () => callbacks.onGate("pass"));

  // The editable text box.
  const box = document.createElement("div");
  box.className = "pix-pt-box";
  const hdr = document.createElement("div");
  hdr.className = "pix-pt-hdr";
  const hlbl = document.createElement("span");
  hlbl.className = "pix-pt-hlbl";
  hlbl.textContent = "text";
  const copyBtn = document.createElement("span");
  copyBtn.className = "pix-pt-hic";
  copyBtn.innerHTML = COPY_SVG;
  copyBtn.title = "Copy this text";
  const revertBtn = document.createElement("span");
  revertBtn.className = "pix-pt-hic";
  revertBtn.innerHTML = REVERT_SVG;
  revertBtn.title = "Put the model's original text back";
  hdr.append(hlbl, copyBtn, revertBtn);
  const ta = document.createElement("textarea");
  ta.className = "pix-pt-ta";
  ta.spellcheck = false;
  ta.placeholder = "The model's text will appear here on Run";
  box.append(hdr, ta);

  // Bottom row: count + Regenerate / Continue.
  const bot = document.createElement("div");
  bot.className = "pix-pt-bot";
  const count = document.createElement("span");
  count.className = "pix-pt-count";
  const btnRegen = document.createElement("button");
  btnRegen.className = "pix-pt-btn";
  btnRegen.textContent = "⟳ Regenerate";
  btnRegen.title = "Get fresh text: roll the seed of whatever is generating it upstream";
  const btnContinue = document.createElement("button");
  btnContinue.className = "pix-pt-btn primary";
  btnContinue.textContent = "▶ Continue";
  btnContinue.title = "Run only the rest of the workflow with your edited text";
  bot.append(count, btnRegen, btnContinue);

  root.append(top, box, bot);

  // Wire events. stopPropagation so canvas drag/deselect/shortcuts don't fire.
  ta.addEventListener("input", () => callbacks.onInput(ta.value));
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return;  // let run-workflow through
    e.stopPropagation();
  });
  ta.addEventListener("pointerdown", (e) => e.stopPropagation());
  ta.addEventListener("mousedown", (e) => e.stopPropagation());
  ta.addEventListener("focus", () => box.classList.add("pt-focus"));
  ta.addEventListener("blur", () => box.classList.remove("pt-focus"));

  copyBtn.addEventListener("click", (e) => { e.stopPropagation(); if (!copyBtn.classList.contains("off")) callbacks.onCopy(); });
  revertBtn.addEventListener("click", (e) => { e.stopPropagation(); if (!revertBtn.classList.contains("off")) callbacks.onRevert(); });
  for (const b of [copyBtn, revertBtn]) {
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("mousedown", (e) => e.stopPropagation());
  }
  btnRegen.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onRegenerate(); });
  btnContinue.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onContinue(); });

  node._pixPtEls = {
    dot, status, segPause, segPass, box, hlbl, copyBtn, revertBtn, ta, count, btnRegen, btnContinue,
  };
  return root;
}

function countLabel(text) {
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return `${chars} char${chars === 1 ? "" : "s"} · ${words} word${words === 1 ? "" : "s"}`;
}

// Flash a header icon green for 700ms after a successful action.
export function flashIcon(iconEl) {
  if (!iconEl) return;
  iconEl.classList.add("ok");
  setTimeout(() => iconEl.classList.remove("ok"), 700);
}

// Push the stored text into the textarea (restore / fresh capture). Only sets when
// different so it never fights the user's caret mid-type.
export function syncText(node) {
  const els = node._pixPtEls;
  if (!els) return;
  const s = getState(node);
  if (els.ta.value !== s.text) els.ta.value = s.text;
}

// Re-render controls from current state. DOM-only (never mutates serialized
// state), so it is safe on the load path (Vue Compat #18).
export function renderPause(node) {
  const els = node._pixPtEls;
  if (!els) return;
  const s = getState(node);
  const paused = s.gate === "pause";
  const edited = isEdited(node);

  els.segPause.classList.toggle("active", paused);
  els.segPass.classList.toggle("active", !paused);

  // Editing only in Pause mode; Pass greys the box (transparent passthrough).
  els.ta.disabled = !paused;
  els.box.classList.toggle("pt-off", !paused);
  els.ta.placeholder = paused
    ? "The model's text will appear here on Run"
    : "Passing through - the model's text is sent as-is";

  els.hlbl.innerHTML = edited
    ? 'text · <span class="pix-pt-edited">edited</span>'
    : "text";

  const hasText = !!s.text;
  els.copyBtn.classList.toggle("off", !hasText);
  els.revertBtn.classList.toggle("off", !edited);
  els.btnRegen.disabled = !paused || !!node._pixPtBusy;
  els.btnContinue.disabled = !paused || !!node._pixPtBusy;

  els.count.textContent = countLabel(s.text);

  // Status dot + line.
  els.dot.classList.toggle("busy", !!node._pixPtBusy);
  els.dot.classList.toggle("idle", !paused && !node._pixPtBusy);
  if (node._pixPtBusy) {
    els.status.textContent = node._pixPtBusy;
  } else if (node._pixPtFlash) {
    els.status.textContent = node._pixPtFlash;
  } else if (!paused) {
    els.status.textContent = "Passing through: whole workflow runs";
  } else if (edited) {
    els.status.textContent = "Edited. Continue when ready.";
  } else {
    els.status.textContent = "Paused. Edit and press Continue.";
  }
}
