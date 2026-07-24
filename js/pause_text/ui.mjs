// Pause Text Pixaroma - the node body UI, ONE DOM widget for both renderers.
// Layout: a STATUS line sits in the empty band BETWEEN the input and output dots
// (Classic paints it on the canvas via onDrawForeground; Nodes 2.0 shows a DOM
// band lifted into the slot row by the block-nudge - see index.js). Below that:
// the editable text box (fills the height) whose header carries the field label,
// the Pause/Pass toggle and the Copy/Revert icons; then the count + Regenerate /
// Continue buttons. No status dot (it read as an input dot).
import { BRAND } from "../shared/utils.mjs";
import { getState, isEdited } from "./state.mjs";

// Fixed vertical budget for the non-fill rows -> getMinHeight is a per-renderer
// CONSTANT (Vue Compat #18): byte-identical every save/load, node.size never
// jitters. The band costs 0 height in Classic (painted) and BAND_H in Nodes 2.0
// (in-flow, then the nudge overlaps it onto the slot row).
const PAD = 6;
const HDR_H = 24;
const BODY_MIN_H = 120;
const BOT_H = 28;
export const BAND_H = 18;
const CORE_H = PAD + HDR_H + BODY_MIN_H + PAD + BOT_H + PAD;
// Minimum width where the count + both buttons fit comfortably (like the wide
// reference node). Below this the buttons don't fit: Classic clamps here in
// onResize; Nodes 2.0 snaps back here on resize release (it has no live width
// clamp). Kept modest so the node is still fairly compact.
export const NODE_MIN_W = 400;
export function nodeMinH(vue) { return CORE_H + (vue ? BAND_H + PAD : 0); }
// A safe constant floor used by getMinHeight/onResize (the larger of the two so
// neither renderer is starved).
export const NODE_MIN_H = CORE_H + BAND_H + PAD;

function injectCSS() {
  if (document.getElementById("pix-pt-css")) return;
  const s = document.createElement("style");
  s.id = "pix-pt-css";
  s.textContent = `
    .pix-pt-root { position:relative; display:flex; flex-direction:column; flex:1 1 0;
      min-height:0; box-sizing:border-box; padding:${PAD}px; gap:${PAD}px;
      font:12px sans-serif; color:#ddd; overflow:hidden; background:transparent; }
    /* Status band. Classic hides it (painted on canvas); Nodes 2.0 shows it and
       the nudge lifts it onto the slot row. Reserve the sides for the dot labels. */
    .pix-pt-band { flex:0 0 auto; height:${BAND_H}px; line-height:${BAND_H}px;
      font:11px sans-serif; color:rgba(255,255,255,0.72); text-align:center;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none;
      padding:0 66px; box-sizing:border-box; }
    .pix-pt-band.pt-hidden { display:none; }

    .pix-pt-box { flex:1 1 0; min-height:0; display:flex; flex-direction:column;
      background:#1d1d1d; border:1px solid #333; border-radius:5px; overflow:hidden; }
    .pix-pt-box.pt-focus { border-color:${BRAND}; }
    .pix-pt-box.pt-off { opacity:0.55; }
    .pix-pt-hdr { flex:0 0 auto; display:flex; align-items:center; gap:6px;
      padding:3px 6px 3px 9px; border-bottom:1px solid #2c2c2c; background:rgba(255,255,255,0.02); }
    .pix-pt-hlbl { font:10px 'Segoe UI',-apple-system,sans-serif; color:#8f8f8f; flex:1 1 0;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-pt-toggle { display:flex; background:rgba(0,0,0,0.25); border-radius:5px; padding:1px; gap:2px; flex:0 0 auto; }
    .pix-pt-seg { text-align:center; padding:2px 9px; border-radius:4px; cursor:pointer;
      color:rgba(255,255,255,0.6); user-select:none; border:1px solid transparent; font-size:10px; }
    .pix-pt-seg.active { background:${BRAND}; color:#fff; border-color:${BRAND}; }
    .pix-pt-seg:not(.active):hover { border-color:${BRAND}; color:#ddd; }
    .pix-pt-hic { width:19px; height:18px; border-radius:4px; display:flex; align-items:center;
      justify-content:center; cursor:pointer; background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.14); color:rgba(255,255,255,0.72); flex:0 0 auto; }
    .pix-pt-hic:hover:not(.off) { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    .pix-pt-hic.ok, .pix-pt-hic.ok:hover { background:#3ec371; border-color:#3ec371; color:#fff; }
    .pix-pt-hic.off { opacity:0.35; cursor:default; }
    .pix-pt-ta { flex:1 1 0; min-height:0; width:100%; box-sizing:border-box;
      background:transparent; color:#e0e0e0; border:0; outline:none; resize:none;
      font:12px monospace; line-height:1.4; padding:6px 8px; }
    .pix-pt-ta::placeholder { color:#5c5c5c; font-style:italic; }
    .pix-pt-ta:disabled { color:#9a9a9a; }

    /* flex-wrap so if the node is transiently narrower than the buttons (during a
       resize drag, before the width snaps back), Continue wraps to a new line
       instead of spilling past / being clipped at the right edge. */
    .pix-pt-bot { display:flex; align-items:center; gap:6px; flex:0 0 auto; flex-wrap:wrap; justify-content:flex-end; }
    .pix-pt-count { flex:1 1 0; min-width:0; font-size:10px; color:#aaa;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-pt-btn { height:26px; padding:0 12px; border-radius:4px;
      border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.05);
      color:rgba(255,255,255,0.85); font:12px sans-serif; cursor:pointer;
      box-sizing:border-box; white-space:nowrap; user-select:none; flex:0 0 auto; }
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

// The current status string, shared by the DOM band (Nodes 2.0) and the canvas
// paint (Classic). busy > flash > gate-derived.
export function statusText(node) {
  const s = getState(node);
  if (node._pixPtBusy) return node._pixPtBusy;
  if (node._pixPtFlash) return node._pixPtFlash;
  if (s.gate === "pass") return "Passing through: whole workflow runs";
  if (s.gate === "keep") return "Keeping this text: each Run makes an image";
  return isEdited(node) ? "Edited. Continue when ready." : "Paused. Edit and press Continue.";
}

// Build the DOM widget. callbacks: { onGate, onContinue, onRegenerate, onCopy,
// onRevert, onInput }. Caches refs on node._pixPtEls.
export function buildPauseTextWidget(node, callbacks) {
  injectCSS();
  const root = document.createElement("div");
  root.className = "pix-pt-root";

  // Status band (between the dots).
  const band = document.createElement("div");
  band.className = "pix-pt-band";

  // The editable box; its header carries the label + Pause/Pass toggle + icons.
  const box = document.createElement("div");
  box.className = "pix-pt-box";
  const hdr = document.createElement("div");
  hdr.className = "pix-pt-hdr";
  const hlbl = document.createElement("span");
  hlbl.className = "pix-pt-hlbl";
  hlbl.textContent = "text";
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
  const segKeep = document.createElement("div");
  segKeep.className = "pix-pt-seg";
  segKeep.textContent = "Keep";
  segKeep.title = "Keep this text; every Run makes a new image with it (the model is skipped)";
  toggle.append(segPause, segPass, segKeep);
  const copyBtn = document.createElement("span");
  copyBtn.className = "pix-pt-hic";
  copyBtn.innerHTML = COPY_SVG;
  copyBtn.title = "Copy this text";
  const revertBtn = document.createElement("span");
  revertBtn.className = "pix-pt-hic";
  revertBtn.innerHTML = REVERT_SVG;
  revertBtn.title = "Put the model's original text back";
  hdr.append(hlbl, toggle, copyBtn, revertBtn);
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

  root.append(band, box, bot);

  // Events. stopPropagation so canvas drag/deselect/shortcuts don't fire.
  ta.addEventListener("input", () => callbacks.onInput(ta.value));
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return;  // let run-workflow through
    e.stopPropagation();
  });
  ta.addEventListener("pointerdown", (e) => e.stopPropagation());
  ta.addEventListener("mousedown", (e) => e.stopPropagation());
  ta.addEventListener("focus", () => box.classList.add("pt-focus"));
  ta.addEventListener("blur", () => box.classList.remove("pt-focus"));

  segPause.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onGate("pause"); });
  segPass.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onGate("pass"); });
  segKeep.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onGate("keep"); });
  copyBtn.addEventListener("click", (e) => { e.stopPropagation(); if (!copyBtn.classList.contains("off")) callbacks.onCopy(); });
  revertBtn.addEventListener("click", (e) => { e.stopPropagation(); if (!revertBtn.classList.contains("off")) callbacks.onRevert(); });
  for (const b of [segPause, segPass, segKeep, copyBtn, revertBtn]) {
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("mousedown", (e) => e.stopPropagation());
  }
  btnRegen.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onRegenerate(); });
  btnContinue.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onContinue(); });

  node._pixPtEls = {
    root, band, box, hlbl, segPause, segPass, segKeep, copyBtn, revertBtn, ta, count, btnRegen, btnContinue,
  };
  return root;
}

function countLabel(text) {
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return `${chars} char${chars === 1 ? "" : "s"} · ${words} word${words === 1 ? "" : "s"}`;
}

export function flashIcon(iconEl) {
  if (!iconEl) return;
  iconEl.classList.add("ok");
  setTimeout(() => iconEl.classList.remove("ok"), 700);
}

// Push the stored text into the textarea. Only sets when different so it never
// fights the user's caret mid-type.
export function syncText(node) {
  const els = node._pixPtEls;
  if (!els) return;
  const s = getState(node);
  if (els.ta.value !== s.text) els.ta.value = s.text;
}

// Re-render controls from state. DOM-only, safe on the load path (Vue Compat #18).
// The status band is a DOM element in BOTH renderers (index.js floats it into the
// slot dead-space in Classic, nudges the slot block in Nodes 2.0).
export function renderPause(node) {
  const els = node._pixPtEls;
  if (!els) return;
  const s = getState(node);
  const gate = s.gate;
  const pass = gate === "pass";
  const keep = gate === "keep";
  const edited = isEdited(node);
  // Editing + the action buttons are ON in Pause and Keep, OFF in Pass (which
  // runs the model fresh and ignores the box).
  const editable = !pass;

  els.segPause.classList.toggle("active", gate === "pause");
  els.segPass.classList.toggle("active", pass);
  els.segKeep.classList.toggle("active", keep);

  els.ta.disabled = !editable;
  els.box.classList.toggle("pt-off", pass);
  els.ta.placeholder = editable
    ? "The model's text will appear here on Run"
    : "Passing through - the model's text is sent as-is";

  els.hlbl.innerHTML = edited
    ? 'text · <span style="color:' + BRAND + '">edited</span>'
    : "text";

  const hasText = !!s.text;
  els.copyBtn.classList.toggle("off", !hasText);
  els.revertBtn.classList.toggle("off", !edited);
  // Regenerate is greyed in Keep mode: Keep reuses the current text, so getting a
  // new prompt from the model doesn't belong here - switch back to Pause for that.
  els.btnRegen.disabled = !editable || keep || !!node._pixPtBusy;
  els.btnRegen.title = keep
    ? "Switch to Pause to get fresh text from the model"
    : "Get fresh text: roll the seed of whatever is generating it upstream";
  els.btnContinue.disabled = !editable || !!node._pixPtBusy;
  // In Keep the button just makes an image (like the top Run button), so call it
  // Run there; in Pause it commits your edit, so it stays Continue.
  els.btnContinue.textContent = keep ? "▶ Run" : "▶ Continue";
  els.btnContinue.title = keep
    ? "Make a new image with this text (same as pressing Run)"
    : "Run only the rest of the workflow with your edited text";

  els.count.textContent = countLabel(s.text);
  els.band.textContent = statusText(node);
  // Classic paints the status on the canvas from statusText(node), so nudge a
  // repaint whenever the state changes (harmless in Nodes 2.0).
  node.setDirtyCanvas?.(true, false);
}
