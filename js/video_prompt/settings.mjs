// Video Prompt Pixaroma - the floating settings panel.
//
// One singleton panel, opened from the gear on the node face, the gear in the
// node selection toolbar, or the right-click entry. It follows its node as the
// canvas pans and zooms until the user drags it somewhere on purpose
// (convention #29); both that and the drag come from shared/node_panel.mjs, so
// the two bugs those carry fixes for are not re-rolled here.
//
// The formulas are edited in a FULLSCREEN editor, not in the panel: the longest
// is 12,299 characters and a 360px column would be miserable. The panel row is
// the index - name, character count, Edit, Reset.

import {
  createAccentSection, repaintAccent,
} from "../shared/node_settings.mjs";
import {
  followNode, getNodeScreenRect, makeDraggable, placeBeside,
} from "../shared/node_panel.mjs";
import { formatModelSize } from "../shared/utils.mjs";
import { passComfyShortcut } from "../shared/text_shortcuts.mjs";
import { followSpellcheck } from "../shared/spellcheck.mjs";
import { looksVision } from "../shared/model_kinds.mjs";
import { installGraphUndoGuard } from "../shared/graph_undo_guard.mjs";
// The themed dialogs, reused like Music Prompt does (no cycle: ai_prompt never
// imports video_prompt). NEVER gate an action here on window.confirm / alert /
// prompt: a ComfyUI Desktop pane refuses them SILENTLY (confirm = false in 1 ms,
// nothing shown), so Reset, Reset all and Import did nothing and an import error
// said nothing (ai-prompt.md #19 / #19c, video-prompt.md #24).
import { askConfirm, sayIt, hasModelFile } from "../ai_prompt/settings.mjs";
// Duration Pixaroma's recipe list, shared rather than copied: it is pure data
// with no imports and no side effects, and one list means the two nodes cannot
// drift on what "Wan" means.
import { RECIPES, matchRecipe, recipeByName } from "../duration/recipes.mjs";
import { MODES, MODE_LABELS, readState, writeState } from "./core.mjs";
import { fetchAll, resetMode, saveDurations, saveFormula } from "./api.mjs";
import { cacheTiers } from "./ui.mjs";

let PANEL = null;
let PANEL_NODE = null;
let USER_MOVED = false;
let ON_CHANGE = null;
let DATA = { modes: {}, models: [], sizes: {} };
let CP_HANDLE = null;   // an open Pixaroma colour picker, so close takes it too

let _cssDone = false;
function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const style = document.createElement("style");
  style.id = "pixaroma-h3-panel-css";
  style.textContent = `
  .pix-vpp{
    position:fixed; z-index:1300; width:370px; max-height:82vh;
    display:flex; flex-direction:column;
    background:#2b2b2b; border:1px solid #555; border-radius:8px;
    box-shadow:0 8px 26px rgba(0,0,0,.45);
    font:12px 'Segoe UI', sans-serif; color:#ddd; overflow:hidden;
  }
  .pix-vpp *{ box-sizing:border-box; }
  .pix-vpp-head{
    display:flex; align-items:center; justify-content:space-between;
    padding:9px 12px; background:#333; border-bottom:1px solid #444;
    cursor:move; user-select:none; flex:none;
  }
  .pix-vpp-head span{ font-size:12px; color:#fff; }
  .pix-vpp-x{
    background:none; border:none; color:#999; cursor:pointer;
    font-size:15px; line-height:1; padding:0 2px;
  }
  .pix-vpp-x:hover{ color:#fff; }
  .pix-vpp-body{ padding:12px; overflow-y:auto; flex:1 1 auto; }
  .pix-vpp-sec{
    color:var(--pix-acc,#f66744); font-size:10px; letter-spacing:.5px;
    margin:0 0 7px;
  }
  .pix-vpp-sec:not(:first-child){ margin-top:14px; }
  .pix-vpp-row{
    display:flex; align-items:center; gap:8px;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
    padding:7px 9px; margin-bottom:5px;
  }
  .pix-vpp-row.is-edited{ border-color:var(--pix-acc,#f66744); }
  .pix-vpp-row .name{ flex:1 1 auto; min-width:0; color:#ddd; font-size:11px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pix-vpp-row .cnt{ flex:none; color:#777; font-size:10px; }
  .pix-vpp-row.is-edited .cnt{ color:var(--pix-acc,#f66744); }
  .pix-vpp-icon{
    flex:none; width:15px; height:15px; padding:0; background:none;
    border:none; cursor:pointer; color:#aaa; font-size:12px; line-height:1;
  }
  .pix-vpp-icon:hover{ color:var(--pix-acc,#f66744); }
  .pix-vpp-icon:disabled{ color:#555; cursor:default; }

  .pix-vpp-pick{
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
    padding:7px 9px; margin-bottom:6px; cursor:pointer;
  }
  .pix-vpp-pick:hover{ border-color:var(--pix-acc,#f66744); }
  .pix-vpp-pick .v{ flex:1 1 auto; min-width:0; color:#ccc; font-size:11px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pix-vpp-pick .c{ flex:none; color:var(--pix-acc,#f66744); font-size:9px; }
  .pix-vpp-missing{ color:#e08b6a; font-size:10px; margin:-2px 0 8px; }

  .pix-vpp-nums{ display:flex; gap:6px; margin-bottom:6px; }
  .pix-vpp-num{
    flex:1 1 0; min-width:0; display:flex; align-items:center; gap:6px;
    background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:5px 8px;
  }
  .pix-vpp-num label{ flex:none; color:var(--pix-acc,#f66744); font-size:10px; }
  .pix-vpp-num input{
    flex:1 1 auto; min-width:0; background:none; border:none; outline:none;
    color:#ccc; font:11px 'Segoe UI', sans-serif; text-align:right;
  }
  .pix-vpp-num:focus-within{ border-color:var(--pix-acc,#f66744); }

  .pix-vpp-adv{ color:#888; font-size:10px; cursor:pointer; user-select:none;
    margin-bottom:8px; }
  .pix-vpp-adv:hover{ color:#ccc; }

  .pix-vpp-tiers{ display:flex; gap:5px; flex-wrap:wrap; margin-bottom:6px; }
  .pix-vpp-tier{
    flex:1 1 60px; min-width:0; text-align:center; cursor:pointer;
    background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:6px 4px;
    color:#ddd; font:11px 'Segoe UI', sans-serif;
  }
  .pix-vpp-tier:hover{ border-color:var(--pix-acc,#f66744); }
  .pix-vpp-tier small{ display:block; color:#777; font-size:9px; margin-top:2px; }

  .pix-vpp-toggle{ display:flex; align-items:center; gap:8px; margin-bottom:6px;
    cursor:pointer; user-select:none; }
  .pix-vpp-sw{ flex:none; width:26px; height:14px; border-radius:7px;
    background:#444; position:relative; transition:background .12s; }
  .pix-vpp-sw i{ position:absolute; top:2px; left:2px; width:10px; height:10px;
    border-radius:50%; background:#888; transition:left .12s, background .12s; }
  .pix-vpp-toggle.is-on .pix-vpp-sw{ background:var(--pix-acc,#f66744); }
  .pix-vpp-toggle.is-on .pix-vpp-sw i{ left:14px; background:#fff; }
  .pix-vpp-toggle span{ color:#ccc; font-size:11px; }

  .pix-vpp-btns{ display:flex; gap:5px; flex-wrap:wrap; }
  .pix-vpp-btn{
    flex:1 1 auto; text-align:center; cursor:pointer;
    background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.15);
    border-radius:4px; padding:6px 8px; color:rgba(255,255,255,0.7);
    font:11px 'Segoe UI', sans-serif;
  }
  .pix-vpp-btn:hover{ background:var(--pix-acc,#f66744);
    border-color:var(--pix-acc,#f66744); color:#fff; }

  .pix-vpp-pop{
    position:fixed; z-index:1400; max-height:320px; overflow-y:auto;
    background:#1d1d1d; border:1px solid #555; border-radius:4px;
    box-shadow:0 6px 18px rgba(0,0,0,.5); padding:4px;
  }
  .pix-vpp-pop .pix-vpp-poplist div{ padding:5px 9px; border-radius:3px; color:#ccc;
    font:11px 'Segoe UI', sans-serif; cursor:pointer;
    display:flex; align-items:center; gap:8px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  /* the NAME shrinks and ellipsises; the SIZE never does, which is the point */
  .pix-vpp-pop .pix-vpp-poplist .pix-vpp-nm{
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pix-vpp-pop .pix-vpp-poplist .pix-vpp-sz{
    margin-left:auto; flex:0 0 auto; color:#7d7d7d; font-size:10px; }
  .pix-vpp-pop .pix-vpp-poplist div:hover{ background:#2a2a2a; }
  .pix-vpp-pop .pix-vpp-poplist div.is-on{ color:var(--pix-acc,#f66744); }
  /* cannot see a picture - dimmed, still selectable */
  .pix-vpp-pop .pix-vpp-poplist div.is-blind{ color:#6d6d6d; }
  .pix-vpp-pop .pix-vpp-poplist div.is-blind::after{
    content:" (no vision)"; font-size:10px; color:#5a5a5a;
  }
  .pix-vpp-popfilter{
    display:block; width:100%; box-sizing:border-box; margin:0 0 4px;
    background:#141414; color:#ddd; border:1px solid #444; border-radius:3px;
    padding:5px 8px; font:11px 'Segoe UI', sans-serif; outline:none;
  }
  .pix-vpp-popfilter:focus{ border-color:var(--pix-acc,#f66744); }

  /* the model row when a CLIP is wired: it is not the thing in charge */
  .pix-vpp-pick.is-locked{ opacity:.45; cursor:default; }
  .pix-vpp-pick.is-locked:hover{ border-color:#444; }
  .pix-vpp-note{ color:#e0a33a; font-size:10px; margin:-2px 0 8px; line-height:1.35; }

  /* Fullscreen formula editor */
  .pix-vpe-back{
    position:fixed; inset:0; z-index:1500; background:rgba(0,0,0,.72);
    display:flex; align-items:center; justify-content:center; padding:3vh 3vw;
  }
  .pix-vpe{
    display:flex; flex-direction:column; width:min(1100px,94vw); height:94vh;
    background:#2b2b2b; border:1px solid #555; border-radius:8px; overflow:hidden;
    font:12px 'Segoe UI', sans-serif;
  }
  .pix-vpe-head{ display:flex; align-items:center; gap:10px;
    padding:10px 14px; background:#333; border-bottom:1px solid #444; flex:none; }
  .pix-vpe-head b{ color:#fff; font-weight:400; font-size:13px; }
  .pix-vpe-head .cnt{ color:#777; font-size:11px; }
  .pix-vpe-head .sp{ flex:1 1 auto; }
  .pix-vpe textarea{
    flex:1 1 auto; margin:12px 14px; background:#1d1d1d; color:#ddd;
    border:1px solid #333; border-radius:4px; padding:10px 12px;
    font:12px/1.5 monospace; resize:none; outline:none;
  }
  .pix-vpe textarea:focus{ border-color:var(--pix-acc,#f66744); }
  .pix-vpe-foot{ display:flex; gap:6px; justify-content:flex-end;
    padding:0 14px 12px; flex:none; }
  `;
  document.head.appendChild(style);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------------------------------------------------------------------------
// A small dark dropdown. Never a native <select> - convention #14.
// ---------------------------------------------------------------------------
/** Mirror of _score_model()'s vision test in _video_prompt_helpers.py. Kept
 *  deliberately simple and identical: a filename with "vl" in it. */

let POP = null;
function closePop() {
  POP?.remove();
  POP = null;
}
function openPop(anchor, values, current, onPick, opts) {
  closePop();
  const pop = el("div", "pix-vpp-pop");

  // A text_encoders folder is a junk drawer - this box has 30-odd files in it -
  // so scrolling to find one is miserable. Filter above about a screenful by
  // default; a caller can lower the bar with opts.filterFrom (the model picker
  // passes 2, because the user asked for the same filter presets have).
  let filter = null;
  const list = el("div", "pix-vpp-poplist");
  const paint = (q) => {
    list.replaceChildren();
    const needle = (q || "").trim().toLowerCase();
    // Every space-separated word must appear, so "vl 8b" finds the 8B VL build
    // without caring what order the filename puts them in.
    const words = needle ? needle.split(/\s+/) : [];
    const hits = values.filter((v) => {
      const n = v.toLowerCase();
      return words.every((w) => n.includes(w));
    });
    if (!hits.length) {
      const none = el("div", null, values.length ? "Nothing matches" : "No text encoders found");
      none.style.color = "#888";
      list.appendChild(none);
    }
    for (const v of hits) {
      // Mark the ones that cannot see a picture. The list is the raw
      // text_encoders folder, so t5xxl and clip_l sit next to the real
      // choices - and picking one is SILENT: every tokenizer ends in
      // **kwargs, so image= is accepted and ignored, .generate exists, and
      // the node writes a lovely first-frame prompt for a picture the model
      // never saw. Marked, never blocked: a renamed VL file is legitimate.
      const vision = looksVision(v);
      const row = el("div", (v === current ? "is-on" : "") +
                            (vision ? "" : " is-blind"));
      // The name gets its OWN span so the row can be a flex line: the name
      // ellipsises when long, the size never does. Appending the size to the
      // row text instead would let text-overflow eat the very thing this is
      // for. And the filter above still runs on the raw name, so typing "9b"
      // cannot accidentally match a file size, while onPick keeps the exact
      // filename. Several sizes of one family are installed now and the names
      // differ by two characters, so the size is what tells them apart.
      row.appendChild(el("span", "pix-vpp-nm", v));
      const shown = formatModelSize(opts?.sizes?.[v]);
      if (shown) row.appendChild(el("span", "pix-vpp-sz", shown));
      row.title = vision ? v : v + "  -  does not look like a vision model, "
        + "so it cannot see your pictures";
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        closePop();
        onPick(v);
      });
      list.appendChild(row);
    }
  };

  if (values.length >= (opts?.filterFrom ?? 9)) {
    filter = document.createElement("input");
    filter.type = "text";
    filter.className = "pix-vpp-popfilter";
    filter.placeholder = "Filter, e.g. vl 8b";
    filter.addEventListener("input", () => paint(filter.value));
    // Never let a keystroke reach the canvas: ComfyUI binds single letters to
    // commands, so typing "b" here would otherwise also toggle bypass.
    filter.addEventListener("keydown", (e) => {
      if (passComfyShortcut(e, filter)) return;   // ComfyUI's save / run (UI#44)
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); closePop(); }
    });
    pop.appendChild(filter);
  }
  pop.appendChild(list);
  paint("");
  document.body.appendChild(pop);
  if (filter) setTimeout(() => filter.focus(), 0);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(window.innerWidth - pop.offsetWidth - 6, r.left)) + "px";
  pop.style.width = Math.max(r.width, 200) + "px";
  const below = window.innerHeight - r.bottom;
  if (below > pop.offsetHeight + 8 || below > r.top) pop.style.top = r.bottom + 3 + "px";
  else pop.style.top = Math.max(6, r.top - pop.offsetHeight - 3) + "px";
  POP = pop;
}

// ---------------------------------------------------------------------------
// Fullscreen formula editor
// ---------------------------------------------------------------------------
let EDITOR = null;
function closeEditor() {
  // Release the Escape listener HERE, not in the key handler. It used to remove
  // itself only on the Escape path, so closing with Cancel / Save / a backdrop
  // click / deleting the node left it bound - and because it is window+capture
  // and calls stopPropagation, each leaked one SWALLOWED the next Escape press
  // for the whole app. The symptom looked intermittent: "Escape sometimes needs
  // two presses".
  try { EDITOR?._pixEscOff?.(); } catch (e) { /* already gone */ }
  try { EDITOR?._pixUndoOff?.(); } catch (e) { /* already gone */ }
  EDITOR?.remove();
  EDITOR = null;
}

/**
 * The full-screen text box. Exported because the node FACE reuses it for the
 * idea (its Expand button) - one editor rather than a second one that would
 * drift from this.
 *
 * `opts.spellcheck` is on for prose and off for a formula; `opts.owner` names
 * the node it belongs to, so deleting that node takes the editor with it.
 */
export function openEditor(title, text, onSave, opts) {
  closeEditor();
  const back = el("div", "pix-vpe-back");
  const box = el("div", "pix-vpe");
  const head = el("div", "pix-vpe-head");
  const name = el("b", null, title);
  const cnt = el("span", "cnt", "");
  head.append(name, cnt, el("span", "sp"));
  const ta = el("textarea");
  ta.value = text || "";
  // Prose follows ComfyUI's spell check setting; a formula stays off.
  if (opts?.spellcheck === true) followSpellcheck(ta);
  else ta.spellcheck = false;
  back._pixOwner = opts?.owner || null;
  const foot = el("div", "pix-vpe-foot");
  const cancel = el("button", "pix-vpp-btn", "Cancel");
  cancel.style.flex = "0 0 auto";
  const save = el("button", "pix-vpp-btn", "Save");
  save.style.flex = "0 0 auto";
  foot.append(cancel, save);
  box.append(head, ta, foot);
  back.appendChild(box);

  const count = () => {
    cnt.textContent = ta.value.length.toLocaleString() + " characters";
  };
  count();
  ta.addEventListener("input", count);

  // Close THIS editor, not whatever is current. A slow Save that resolves after
  // the user has opened a different formula would otherwise close that one and
  // throw away their typing.
  const done = () => { if (EDITOR === back) closeEditor(); };
  cancel.addEventListener("click", done);
  back.addEventListener("mousedown", (e) => { if (e.target === back) done(); });
  save.addEventListener("click", async () => {
    if (save.disabled) return;          // no double-submit of a 12k formula
    save.disabled = true;
    save.textContent = "Saving...";
    const ok = await onSave(ta.value);
    if (!ok) { save.textContent = "Save failed"; save.disabled = false; return; }
    done();
  });
  const esc = (e) => {
    if (e.key !== "Escape" || EDITOR !== back) return;
    e.stopPropagation();
    done();
  };
  window.addEventListener("keydown", esc, true);
  back._pixEscOff = () => window.removeEventListener("keydown", esc, true);
  // Ctrl+Z must not reach the graph while this is open (it wiped the graph under
  // the editor: 2 nodes -> 0 in three presses). Why a textarea is no protection:
  // graph-undo-guard.md. Released in closeEditor.
  back._pixUndoOff = installGraphUndoGuard(() => !!back.isConnected);

  document.body.appendChild(back);
  EDITOR = back;
  ta.focus();
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function closeVideoPromptPanelFor(node) {
  // The idea editor is opened from the node FACE, so it can be up with no panel
  // open at all - in which case the early return below would leave a
  // full-screen box belonging to a node that no longer exists.
  if (node && EDITOR && EDITOR._pixOwner === node) closeEditor();
  if (node && PANEL_NODE !== node) return;
  closePop();
  closeEditor();
  try { CP_HANDLE?.close?.(); } catch (e) { /* already gone */ }
  CP_HANDLE = null;
  // The document/window listeners are the leak that matters: a workflow load or
  // a node deletion closes the panel with no click, so removing them only on a
  // user-driven close orphans one pair per open.
  try { PANEL?._pixCleanup?.(); } catch (e) { /* already gone */ }
  // COMMIT a half-typed number before the panel goes. The numeric fields commit
  // on change/blur, and Chrome fires NEITHER when a focused element is removed
  // from the document - and outsideClose runs on capture-phase pointerdown,
  // before the browser moves focus. So typing 0.9 into TOP P and clicking the
  // canvas silently threw the value away.
  try {
    const active = document.activeElement;
    if (active && PANEL && PANEL.contains(active) && typeof active.blur === "function") {
      active.blur();
    }
  } catch (e) { /* not fatal */ }
  PANEL?.remove();
  PANEL = null;
  PANEL_NODE = null;
  ON_CHANGE = null;
  // Reset on CLOSE, never on open: doing it on open would teach every new panel
  // to sit still wherever the last dragged one was.
  USER_MOVED = false;
}

// POINTERDOWN, not mousedown. Every other settings panel in this pack uses
// pointerdown, and that is not a style preference: LiteGraph calls
// preventDefault() on the canvas pointerdown, which suppresses the
// compatibility mouse events, so a mousedown listener NEVER FIRES for a click
// on the canvas. This panel shipped with mousedown for one commit and clicking
// the canvas did not close it, while clicking DOM elsewhere did - which is what
// made it look like a panel bug rather than an event-type bug.
function outsideClose(e) {
  if (!PANEL) return;
  // A themed dialog (askConfirm / sayIt, on <body>) sits ON TOP: answering it
  // must not close the panel or its dropdown underneath. FIRST, like Music
  // Prompt's, so the dropdown check below cannot take the list down with it.
  if (e.target?.closest?.(".pix-apk-back")) return;
  // The dropdown is position:fixed on <body>, so a click ELSEWHERE INSIDE the
  // panel used to leave it floating over a row that renderPanel had already
  // destroyed - anchored to nothing. Close it before the inside-the-panel
  // early return. The .pix-vpp-pick exemption keeps the anchor's own toggle
  // behaviour, since openPop already closes any previous one.
  if (POP && !POP.contains(e.target) && !e.target?.closest?.(".pix-vpp-pick")) {
    closePop();
  }
  // contains(), like Save Video, rather than a class selector: it cannot be
  // fooled by a child that happens not to match.
  if (PANEL.contains(e.target)) return;
  // These live on <body> too and this guard is capture-phase, so it runs before
  // their own handlers. Without the exemptions, picking a colour or an option
  // dismisses the panel underneath (node-settings-accent invariant 3).
  //
  // .pix-vp-gear is exempt for a different reason: it is what OPENS the panel,
  // and this fires on pointerdown while the button acts on click. Without it
  // the gear closed the panel and the click immediately reopened it, so a
  // second press looked like a no-op.
  if (e.target?.closest?.(".pix-vpp-pop, .pix-vpe-back, .pix-vp-gear, .pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop")) {
    return;
  }
  closeVideoPromptPanelFor(null);
}

/** Zoom or pan and the PANEL moves, because it follows its node - but a popup
 *  lives on <body> and does not, so it is left hanging in mid-air pointing at
 *  nothing. Same fix as AI Prompt, made here at the same time because this
 *  panel is the same shape and had the same gap; only the wheel was missing,
 *  since a pointerdown and Escape were already handled.
 *
 *  Scrolling INSIDE the popup is exempt, or a long model list could never be
 *  scrolled (Load Image pattern #14). */
function wheelClose(e) {
  if (!POP || POP.contains(e.target)) return;
  closePop();
}

function escClose(e) {
  if (e.key !== "Escape" || !PANEL) return;
  if (EDITOR) return;                 // the editor handles its own Escape
  // ...and so does a themed dialog (window+capture): Escape answers "no" there,
  // it must not also close the panel.
  if (document.querySelector(".pix-apk-back")) return;
  // Close the DROPDOWN first if one is open. This handler is on document with
  // capture, so it runs before the event reaches the filter input inside the
  // popup - the filter's own Escape branch could never fire, and pressing
  // Escape while filtering models dismissed the entire settings panel.
  if (POP) {
    e.stopPropagation();
    closePop();
    return;
  }
  e.stopPropagation();
  closeVideoPromptPanelFor(null);
}

function changed(node) {
  ON_CHANGE?.(node);
}

export async function openVideoPromptPanel(node, onChange) {
  injectCSS();
  if (PANEL && PANEL_NODE === node) { closeVideoPromptPanelFor(node); return; }
  closeVideoPromptPanelFor(null);
  PANEL_NODE = node;
  ON_CHANGE = onChange;

  const panel = el("div", "pix-vpp");
  const head = el("div", "pix-vpp-head");
  head.append(el("span", null, "Video Prompt settings"));
  const x = el("button", "pix-vpp-x", "✕");
  x.addEventListener("click", () => closeVideoPromptPanelFor(null));
  head.appendChild(x);
  const body = el("div", "pix-vpp-body");
  panel.append(head, body);
  document.body.appendChild(panel);
  PANEL = panel;

  placeBeside(panel, getNodeScreenRect(node));
  // ignoreSelector is NOT optional when a control lives inside the drag handle.
  // makeDraggable calls preventDefault() and takes pointer capture on
  // pointerdown, so without this the ✕ never receives its click and the panel
  // cannot be closed by the one control that exists to close it. Save Image and
  // Save Video both pass their own close-button selector for the same reason.
  makeDraggable(panel, head, {
    onUserMove: () => { USER_MOVED = true; },
    ignoreSelector: ".pix-vpp-x",
  });
  followNode(panel, node, {
    isCurrent: () => PANEL === panel && PANEL_NODE === node,
    isUserMoved: () => USER_MOVED,
  });
  // deferred so the click that OPENED the panel does not immediately close it
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
    document.addEventListener("wheel", wheelClose, true);
  }, 0);
  panel._pixCleanup = () => {
    document.removeEventListener("pointerdown", outsideClose, true);
    document.removeEventListener("keydown", escClose, true);
    document.removeEventListener("wheel", wheelClose, true);
  };

  body.textContent = "Loading...";
  DATA = await fetchAll();
  // The panel may have been closed while the request was in flight.
  if (PANEL !== panel) return;
  for (const mode of MODES) {
    const names = (DATA.modes?.[mode]?.durations || []).map((t) => t.name);
    cacheTiers(mode, names);
  }
  renderPanel(node, body);
  changed(node);
}

// QUIET commit: writes state WITHOUT re-rendering the panel.
//
// Committing through the usual set() rebuilt the whole body, which destroyed
// the field the user was moving to - click from TOP K into TOP P and the click
// had no live target left, so the second field never focused. Tab was worse:
// the order restarted at the top of the document. Nothing in the panel is
// derived from these six numbers, so a re-render buys nothing.
function numField(node, label, key, onQuiet, opts) {
  const wrap = el("div", "pix-vpp-num");
  wrap.append(el("label", null, label));
  const input = document.createElement("input");
  input.type = "text";
  input.value = String(readState(node)[key]);
  input.title = opts?.title || "";
  const commit = () => {
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) { input.value = String(readState(node)[key]); return; }
    onQuiet(opts?.int ? Math.trunc(raw) : raw);
    // Show what was actually stored, so a clamped value is visible immediately
    // rather than only after the panel is next opened.
    input.value = String(readState(node)[key]);
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  wrap.appendChild(input);
  return wrap;
}

function toggleRow(label, on, onFlip, title) {
  const row = el("div", "pix-vpp-toggle" + (on ? " is-on" : ""));
  const sw = el("span", "pix-vpp-sw");
  sw.appendChild(document.createElement("i"));
  row.append(sw, el("span", null, label));
  if (title) row.title = title;
  row.addEventListener("click", () => onFlip(!on));
  return row;
}

function renderPanel(node, body) {
  body.replaceChildren();
  const st = readState(node);
  const set = (patch) => {
    writeState(node, patch);
    renderPanel(node, body);
    changed(node);
  };

  if (!DATA.ok) {
    const err = el("div", "pix-vpp-missing",
      "Could not reach the server, so the formulas cannot be shown. " +
      "The node will still run with whatever is on disk.");
    body.appendChild(err);
  }

  // ---- model -------------------------------------------------------------
  body.appendChild(el("div", "pix-vpp-sec", "MODEL"));
  const models = Array.isArray(DATA.models) ? DATA.models : [];
  // A wired CLIP WINS at run time, so leaving this row live would let the panel
  // name one model while a different one is actually doing the work.
  const clipWired = (node.inputs || []).some(
    (i) => i && i.name === "clip" && i.link != null);
  const pick = el("div", "pix-vpp-pick" + (clipWired ? " is-locked" : ""));
  pick.append(el("span", "v", clipWired ? "using the wired CLIP" : st.model),
              el("span", "c", clipWired ? "" : "▼"));
  pick.title = clipWired
    ? "A Load CLIP node is wired into this node's clip input, and that model is "
      + "used instead of this setting. Unplug it to choose here."
    : st.model;
  if (!clipWired) {
    pick.addEventListener("click", (e) => {
      e.stopPropagation();
      openPop(pick, models, st.model, (v) => set({ model: v }),
              { filterFrom: 2, sizes: DATA.sizes });
    });
  }
  body.appendChild(pick);
  if (clipWired) {
    body.appendChild(el("div", "pix-vpp-note",
      "A Load CLIP node is wired in, so that model is used and this setting is "
      + "ignored. It must be a vision language model, and Load CLIP's type does "
      + "not matter. Unplug the wire to choose here again."));
  } else if (models.length && !hasModelFile(models, st.model)) {
    body.appendChild(el("div", "pix-vpp-note",
      "\"" + st.model + "\" is not in your text_encoders folder, so the node "
      + "picks the best vision model it can find. Choose one here to be sure."));
  } else if (!clipWired && !looksVision(st.model)) {
    // The silent failure this warns about: a text-only model accepts the image
    // argument and ignores it, so the first-frame modes describe nothing.
    body.appendChild(el("div", "pix-vpp-note",
      "That does not look like a vision model, so it cannot see your pictures. "
      + "The first frame modes will write about nothing. Pick a Qwen3-VL build "
      + "unless you know this one can see."));
  }

  // quiet = write state, tell the host, but do NOT rebuild the panel
  const quiet = (patch) => { writeState(node, patch); changed(node); };

  const nums = el("div", "pix-vpp-nums");
  nums.append(
    numField(node, "TEMP", "temperature", (v) => quiet({ temperature: v }),
      { title: "0.3 is what these formulas were measured at. Higher makes the model paste the formula's own example words." }),
    numField(node, "MAX LEN", "max_length", (v) => quiet({ max_length: v }),
      { int: true, title: "Token budget for the answer. 512 is enough for every tier." }),
  );
  body.appendChild(nums);

  const adv = el("div", "pix-vpp-adv",
    (node._pixVpAdvOpen ? "▼" : "▶") + " Advanced sampling");
  adv.addEventListener("click", () => {
    node._pixVpAdvOpen = !node._pixVpAdvOpen;
    renderPanel(node, body);
  });
  body.appendChild(adv);
  if (node._pixVpAdvOpen) {
    const a = el("div", "pix-vpp-nums");
    a.append(
      numField(node, "TOP K", "top_k", (v) => quiet({ top_k: v }), { int: true }),
      numField(node, "TOP P", "top_p", (v) => quiet({ top_p: v })),
    );
    const b = el("div", "pix-vpp-nums");
    b.append(
      numField(node, "MIN P", "min_p", (v) => quiet({ min_p: v })),
      numField(node, "REP", "repetition_penalty", (v) => quiet({ repetition_penalty: v })),
    );
    body.append(a, b);
  }

  // ---- formulas ----------------------------------------------------------
  body.appendChild(el("div", "pix-vpp-sec", "FORMULAS"));
  for (const mode of MODES) {
    const info = DATA.modes?.[mode] || {};
    const row = el("div", "pix-vpp-row" + (info.edited ? " is-edited" : ""));
    row.append(el("span", "name", MODE_LABELS[mode] || mode));
    const chars = Number(info.chars) || 0;
    row.append(el("span", "cnt",
      chars.toLocaleString() + (info.edited ? " · edited" : "")));

    const edit = el("button", "pix-vpp-icon", "✎");
    edit.title = "Edit this formula";
    edit.disabled = !DATA.ok;
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditor(MODE_LABELS[mode] || mode, info.formula || "", async (text) => {
        const ok = await saveFormula(mode, text);
        if (!ok) return false;
        DATA = await fetchAll();
        // NEVER repaint the closure-captured `body` after an await. Each open
        // builds a FRESH body, so closing the panel and reopening it for the
        // SAME node while a request is in flight leaves this closure holding a
        // detached tree - and a "is a panel open for this node" test still
        // passes, because it is. Measured: the old body reports isConnected
        // false while PANEL_NODE still matches. refreshVideoPromptPanel
        // re-queries the live body, so it is right in every case and no-ops
        // when the panel is gone. Same on all five async writes below.
        refreshVideoPromptPanel(node);
        changed(node);
        return true;
      });
    });

    const reset = el("button", "pix-vpp-icon", "↺");
    reset.title = info.edited
      ? "Put the shipped formula back"
      : "This is the shipped formula";
    reset.disabled = !info.edited;
    reset.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!await askConfirm("Put the shipped formula back?",
        "Put the shipped " + (MODE_LABELS[mode] || mode)
        + " formula back? Your edits to it are lost.", { okText: "Reset" })) return;
      await resetMode(mode);
      DATA = await fetchAll();
      for (const m of MODES) {
        cacheTiers(m, (DATA.modes?.[m]?.durations || []).map((t) => t.name));
      }
      refreshVideoPromptPanel(node);
      changed(node);
    });

    row.append(edit, reset);
    body.appendChild(row);
  }

  // ---- duration tiers ----------------------------------------------------
  body.appendChild(el("div", "pix-vpp-sec", "DURATION TIERS"));
  const activeMode = MODES.includes(node._pixVpTierMode)
    ? node._pixVpTierMode
    : MODES[0];
  const modeRow = el("div", "pix-vpp-pick");
  modeRow.append(el("span", "v", MODE_LABELS[activeMode]), el("span", "c", "▼"));
  modeRow.title = "Which mode's tiers to edit";
  modeRow.addEventListener("click", (e) => {
    e.stopPropagation();
    openPop(modeRow, MODES.map((m) => MODE_LABELS[m]), MODE_LABELS[activeMode],
      (label) => {
        node._pixVpTierMode = MODES.find((m) => MODE_LABELS[m] === label) || MODES[0];
        renderPanel(node, body);
      });
  });
  body.appendChild(modeRow);

  const tiers = DATA.modes?.[activeMode]?.durations || [];
  const tierBox = el("div", "pix-vpp-tiers");
  tiers.forEach((tier, i) => {
    const chip = el("button", "pix-vpp-tier");
    chip.append(document.createTextNode(tier.name));
    // The WORD TARGET, not a line count. The checklist items inside a tier are
    // semicolon-separated inside one long sentence, so counting sentences gave
    // the same number for every tier and told you nothing. The word target is
    // the number that actually differs and the one that drives the result.
    const words = /about\s+(\d+)\s+words/i.exec(String(tier.value || ""));
    chip.appendChild(el("small", null,
      words ? "~" + words[1] + " words" : String(tier.value || "").length + " chars"));
    chip.title = "Edit the length block for " + tier.name;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditor(MODE_LABELS[activeMode] + " · " + tier.name,
        tier.value || "", async (text) => {
          const next = tiers.map((t, j) => (j === i ? { ...t, value: text } : t));
          const ok = await saveDurations(activeMode, next);
          if (!ok) return false;
          DATA = await fetchAll();
          refreshVideoPromptPanel(node);
          changed(node);
          return true;
        });
    });
    tierBox.appendChild(chip);
  });
  if (!tiers.length) {
    tierBox.appendChild(el("div", "pix-vpp-missing", "No tiers on disk."));
  }
  body.appendChild(tierBox);

  // ---- video model -------------------------------------------------------
  // What the `frames` output has to satisfy. Defaults are MiniMax H3; this is
  // what lets somebody point the node at Wan or LTX with their own formula and
  // still get a frame count that model will accept.
  body.appendChild(el("div", "pix-vpp-sec", "VIDEO MODEL"));
  // matchRecipe returns null for hand-tuned numbers, which is a normal state -
  // say so rather than rendering the word "null".
  const current = matchRecipe({
    fps: st.fps, step: st.step, plus: st.plus, minFrames: st.min_frames,
  }) || "Custom";
  const rPick = el("div", "pix-vpp-pick");
  rPick.append(el("span", "v", current), el("span", "c", "▼"));
  rPick.title = "Which model the frames output has to suit";
  rPick.addEventListener("click", (e) => {
    e.stopPropagation();
    openPop(rPick, RECIPES.map((r) => r.name), current, (name) => {
      const r = recipeByName(name);
      if (!r) return;
      set({ fps: r.fps, step: r.step, plus: r.plus, min_frames: r.minFrames });
    });
  });
  body.appendChild(rPick);
  const rNums = el("div", "pix-vpp-nums");
  rNums.append(
    numField(node, "FPS", "fps", (v) => quiet({ fps: v }),
      { title: "Frames per second of the video model." }),
    numField(node, "STEP", "step", (v) => quiet({ step: v }),
      { int: true, title: "Frame counts must land on step x n + plus. 1 means no snapping." }),
    numField(node, "PLUS", "plus", (v) => quiet({ plus: v }),
      { int: true, title: "The plus in step x n + plus. MiniMax H3 is 17n + 5." }),
  );
  body.appendChild(rNums);

  // ---- behaviour ---------------------------------------------------------
  body.appendChild(el("div", "pix-vpp-sec", "BEHAVIOUR"));
  body.appendChild(toggleRow(
    "Add the length instructions to the prompt", st.length_block,
    (v) => set({ length_block: v }),
    "On: each duration also tells the model how much to write, which is how the "
    + "shipped formulas were measured. Turn it off when you are using your own "
    + "wording. The durations still set the frames and seconds outputs either way.",
  ));
  body.appendChild(toggleRow(
    "Hint when 5s meets a speaking idea", st.speech_hint,
    (v) => set({ speech_hint: v }),
    "5 seconds is the tightest fit for a speaking idea. This marks it rather than blocking it.",
  ));
  body.appendChild(toggleRow(
    "Faster writing (MTP), if the model has it", st.mtp,
    (v) => set({ mtp: v }),
    "Multi-token prediction: a model that ships MTP weights (Qwen3.5 files) guesses a few "
    + "words ahead and checks them, which writes faster. Other models ignore it. Turn it off "
    + "if a run stops with a CUDA error such as \"illegal memory access\". The same as the mtp "
    + "setting on ComfyUI's Generate Text node.",
  ));
  // "Free VRAM" deliberately does NOT appear here. It lives on the node face
  // next to Copy, because it is a per-workflow decision the user flips while
  // working, not a set-once preference - and two controls for one state is how
  // they drift.

  // ---- backup ------------------------------------------------------------
  body.appendChild(el("div", "pix-vpp-sec", "BACKUP"));
  const btns = el("div", "pix-vpp-btns");
  const exportBtn = el("button", "pix-vpp-btn", "Export");
  exportBtn.title = "Save every formula and tier to one file";
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const payload = { version: 1, modes: {} };
    for (const mode of MODES) {
      const info = DATA.modes?.[mode] || {};
      payload.modes[mode] = {
        formula: info.formula || "",
        durations: info.durations || [],
      };
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "minimax-h3-formulas.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  const importBtn = el("button", "pix-vpp-btn", "Import");
  importBtn.title = "Load formulas from a file";
  importBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      let payload = null;
      try {
        payload = JSON.parse(await file.text());
      } catch (err) {
        sayIt("Could not import it", "That file is not a formula export.");
        return;
      }
      const incoming = payload?.modes;
      if (!incoming || typeof incoming !== "object") {
        sayIt("Could not import it", "That file is not a formula export.");
        return;
      }

      // Import REPLACES what is on disk, so it is as destructive as Reset -
      // which asks. Without this, picking the wrong file from a folder of
      // exports silently destroys hand-edited formulas with no undo. Name the
      // modes being replaced so the file can be recognised as the wrong one
      // before it lands, not after.
      const affected = MODES.filter((mode) => {
        const m = incoming[mode];
        if (!m) return false;
        return (typeof m.formula === "string" && m.formula.trim())
          || (Array.isArray(m.durations) && m.durations.length);
      });
      if (!affected.length) {
        sayIt("Nothing to import", "That file has no formulas in it.");
        return;
      }
      const names = affected.map((mode) => MODE_LABELS[mode] || mode).join(", ");
      if (!await askConfirm("Replace these formulas?",
        "Replace the formulas for " + names + " with the ones in this file?\n\n"
        + "Your current wording for those is overwritten and cannot be undone.",
        { okText: "Replace" })) return;

      // Each save is its own request, so a failure part way through leaves a
      // HALF-applied import. Reporting nothing would look identical to success.
      const failed = [];
      for (const mode of affected) {
        const m = incoming[mode];
        if (typeof m.formula === "string" && m.formula.trim()) {
          if (!(await saveFormula(mode, m.formula))) failed.push(MODE_LABELS[mode] || mode);
        }
        if (Array.isArray(m.durations) && m.durations.length) {
          if (!(await saveDurations(mode, m.durations))) {
            const label = (MODE_LABELS[mode] || mode) + " durations";
            if (!failed.includes(label)) failed.push(label);
          }
        }
      }
      if (failed.length) {
        sayIt("Imported in part", "Some of that file could not be saved: "
          + failed.join(", ") + ".\nThe rest was imported.");
      }
      DATA = await fetchAll();
      for (const m of MODES) {
        cacheTiers(m, (DATA.modes?.[m]?.durations || []).map((t) => t.name));
      }
      refreshVideoPromptPanel(node);
      changed(node);
    });
    input.click();
  });

  const resetAll = el("button", "pix-vpp-btn", "Reset all");
  resetAll.title = "Put every shipped formula and tier back";
  resetAll.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!await askConfirm("Reset everything?",
      "Put every shipped formula and tier back? All of your edits are lost.",
      { okText: "Reset all" })) return;
    for (const mode of MODES) await resetMode(mode);
    DATA = await fetchAll();
    for (const m of MODES) {
      cacheTiers(m, (DATA.modes?.[m]?.durations || []).map((t) => t.name));
    }
    refreshVideoPromptPanel(node);
    changed(node);
  });

  btns.append(exportBtn, importBtn, resetAll);
  body.appendChild(btns);

  // ---- accent ------------------------------------------------------------
  const accent = createAccentSection(node, {
    onChange: () => {
      repaintAccent(node);
      changed(node);
    },
    // So a PROGRAMMATIC close reaches the picker. The user-driven paths already
    // self-close, but deleting the node or loading a workflow closes the panel
    // with no gesture and would strand the picker on document.body, anchored to
    // a swatch that no longer exists. Same handle Save Video keeps.
    onPickerOpen: (h) => { CP_HANDLE = h; },
  });
  if (accent) body.appendChild(accent);
}

/** True while this node's panel is the open one, so index.js can decide whether
 *  a repaint has anything to refresh. */
export function panelIsOpenFor(node) {
  return !!PANEL && PANEL_NODE === node;
}

/**
 * Repaint an OPEN panel for this node.
 *
 * Wiring or unplugging the clip input changes which model is really in charge,
 * and the panel has to say so - otherwise it keeps offering a picker that has
 * stopped mattering, or keeps claiming a wire is present after it was pulled.
 * No-op when the panel is closed or belongs to another node.
 */
export function refreshVideoPromptPanel(node) {
  if (!panelIsOpenFor(node)) return;
  const body = PANEL.querySelector(".pix-vpp-body");
  if (body) renderPanel(node, body);
}
