// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - the floating frame                       ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Not a node and not a DOM widget, so none of the Nodes 2.0 widget rules apply
// and it renders identically in both renderers.
//
// Like the Help window it STAYS OPEN across workflow switches, so anything it
// shows that depends on the open graph must be re-read on render rather than
// cached. And it writes NOTHING that gets serialized into a workflow, so
// opening it can never make a clean workflow ask "Save Changes?".
//
// The drag and rect behaviour is shared with the Help window
// (js/shared/floating_window.mjs) - do not hand-roll a second copy, the pointer
// capture and the buttons-are-up guard in there are what stop a panel sticking
// to the cursor when a mouse release goes missing.

import { globalAccent, BRAND } from "../shared/index.mjs";
import { el, makeRect, startDrag } from "../shared/floating_window.mjs";
import { injectWorkflowCSS } from "./css.mjs";
import { installDropGuard } from "./drag.mjs";

const RECT_SETTING = "Pixaroma.Workflows.Rect";

const MIN_W = 560;   // below this the three columns stop being three columns
const MIN_H = 340;
const PREF_W = 1040;
const PREF_H = 720;
const EDGE = 24;
const HOME_X = 80;
const HOME_Y = 60;

const SIDE_DEF = 190;
const SIDE_MIN = 120;
const SIDE_MAX_FRAC = 0.45;

// The DETAIL pane is draggable too. Model filenames run long
// (wan2.2\Wan2.2-Fun-A14B-InP-LOW-HPS2.1_resized_dynamic_avg_rank_15_bf16),
// and a fixed 208px column wrapped every one of them into three lines.
const DET_DEF = 208;
const DET_MIN = 150;
const DET_MAX_FRAC = 0.5;
const detMax = (winW) => Math.max(DET_MIN, Math.round(winW * DET_MAX_FRAC));

const RECT = makeRect({
  settingKey: RECT_SETTING,
  minW: MIN_W, minH: MIN_H, prefW: PREF_W, prefH: PREF_H,
  edge: EDGE, homeX: HOME_X, homeY: HOME_Y,
  sideDef: SIDE_DEF, sideMin: SIDE_MIN, sideMaxFrac: SIDE_MAX_FRAC,
});
const { clampRect, readRect, saveRect, sideMax, floorY } = RECT;

export { el };

// ── "is the panel redrawing itself right now?" ────────────────────────────────
//
// An open rename box has to tell two things apart: the USER clicking away
// (commit what they typed) and a RE-RENDER tearing the box out from under them
// (keep it, and put it back afterwards). Both arrive as a plain blur.
//
// `input.isConnected` looks like the way to tell them apart and IS NOT. Measured
// in Chrome: removing a focused element fires blur while the element is still
// attached - isConnected is `true` inside the handler and only flips to false
// after it returns. A guard written that way never fires, so an unrelated
// refresh committed a half-typed name and renamed the file behind the user.
//
// So the answer comes from the renderer instead, which actually knows. A COUNT
// rather than a boolean, because render() redraws three columns and a nested
// call must not clear the flag for the outer one.
let renderDepth = 0;

export function markRendering(fn) {
  renderDepth++;
  try { return fn(); } finally { renderDepth--; }
}

export const isRendering = () => renderDepth > 0;

/**
 * Put text on the clipboard, true if it landed.
 *
 * navigator.clipboard needs a SECURE context and ComfyUI is very often reached
 * over plain http on a LAN address, where the whole API is simply absent - so
 * the old textarea trick is the fallback rather than an afterthought. One copy
 * of this, because the panel now has three buttons that copy (the model list,
 * the missing-node list, the version line) and three hand-rolled versions is
 * three chances to forget the fallback.
 *
 * Note for anyone testing this: a SCRIPTED click carries no user activation, so
 * execCommand reports failure where a real click succeeds. Click it yourself.
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* no secure context, or permission refused */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function createWorkflowWindow({ onRender, onClose }) {
  injectWorkflowCSS();
  // Listens on `document`, not on this window: a drag that starts on a card can
  // be released anywhere, including a prompt box on the canvas behind the panel.
  // Idempotent, so rebuilding the panel cannot stack listeners.
  installDropGuard();

  const win = el("div", "pixwb-win");
  win.style.display = "none";

  // ── title ──
  const title = el("div", "pixwb-title");
  const name = el("div", "pixwb-name");
  const count = el("span", "pixwb-count", "");
  name.append(el("span", "pixwb-logo"), el("span", null, "Workflows"), count);
  const closeBtn = el("button", "pixwb-wbtn", "✕");
  closeBtn.type = "button";
  closeBtn.title = "Close (Esc)";
  title.append(name, el("div", "pixwb-sp"), closeBtn);

  // ── toolbar, folder column, grid, detail: filled by index.js ──
  const bar = el("div", "pixwb-bar");
  const body = el("div", "pixwb-body");
  const side = el("div", "pixwb-side");
  const sideGrip = el("div", "pixwb-sidegrip");
  sideGrip.title = "Drag to resize the list. Double-click to reset.";
  const main = el("div", "pixwb-main");
  const detail = el("div", "pixwb-detail");
  const detGrip = el("div", "pixwb-detgrip");
  detGrip.title = "Drag to resize. Double-click to reset.";
  body.append(side, sideGrip, main, detGrip, detail);

  const foot = el("div", "pixwb-foot");
  const grip = el("div", "pixwb-grip");
  win.append(title, bar, body, foot, grip);
  document.body.appendChild(win);

  let rect = readRect();
  let wasNarrow = null;
  const applyRect = () => {
    win.style.left = rect.x + "px";
    win.style.top = rect.y + "px";
    win.style.width = rect.w + "px";
    win.style.height = rect.h + "px";
    rect.sw = Math.max(SIDE_MIN, Math.min(rect.sw ?? SIDE_DEF, sideMax(rect.w)));
    side.style.width = rect.sw + "px";
    rect.dw = Math.max(DET_MIN, Math.min(rect.dw ?? DET_DEF, detMax(rect.w)));
    detail.style.width = rect.dw + "px";
    // The detail pane is the first thing to go on a narrow window: three
    // columns in 560px leaves the grid too thin to show anything. Its grip
    // goes with it, or there would be a handle for something invisible.
    const narrow = rect.w < 760;
    detail.classList.toggle("hidden", narrow);
    detGrip.classList.toggle("hidden", narrow);
    // Widening past the threshold REVEALS the detail pane, but the resize path
    // deliberately skips re-rendering (it fires per pointermove), so the pane
    // appeared and sat empty until something else happened to redraw it. Ask
    // for a REPAINT on the frame the visibility actually changes - a repaint,
    // not the full open-path rebuild: a bare onRender() here refetched the
    // whole index from the server in the middle of the drag, on every crossing
    // of the threshold, which is exactly what the resizeOnly guard one line
    // down in the caller exists to prevent. The data has not changed because
    // the window got wider; only the pane needs filling from what is already
    // loaded.
    if (wasNarrow !== null && wasNarrow !== narrow && !narrow) onRender?.({ repaintOnly: true });
    wasNarrow = narrow;
  };
  applyRect();

  const onDragEnd = () => {
    title.classList.remove("pixwb-dragging");
    saveRect(rect);
  };

  title.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pixwb-wbtn")) return;
    const ox = e.clientX - win.offsetLeft;
    const oy = e.clientY - win.offsetTop;
    if (!startDrag(title, e, (ev) => {
      rect.x = Math.max(0, Math.min(ev.clientX - ox, window.innerWidth - Math.min(rect.w, 160)));
      rect.y = Math.max(floorY(), Math.min(ev.clientY - oy, window.innerHeight - 40));
      applyRect();
    }, onDragEnd)) return;
    title.classList.add("pixwb-dragging");
  });

  grip.addEventListener("pointerdown", (e) => {
    const left = win.offsetLeft, top = win.offsetTop;
    // Where inside the grip the pointer landed, or the corner jumps under the
    // cursor the moment it is grabbed and the window looks like it twitched.
    const ox = e.clientX - (left + win.offsetWidth);
    const oy = e.clientY - (top + win.offsetHeight);
    startDrag(grip, e, (ev) => {
      rect.w = Math.max(MIN_W, Math.min(ev.clientX - ox - left, window.innerWidth - left));
      rect.h = Math.max(MIN_H, Math.min(ev.clientY - oy - top, window.innerHeight - top));
      applyRect();
      onRender?.({ resizeOnly: true });
    }, onDragEnd);
    e.stopPropagation();
  });

  sideGrip.addEventListener("pointerdown", (e) => {
    const bodyLeft = body.getBoundingClientRect().left;
    startDrag(sideGrip, e, (ev) => {
      rect.sw = Math.round(Math.max(SIDE_MIN, Math.min(ev.clientX - bodyLeft, sideMax(rect.w))));
      side.style.width = rect.sw + "px";
    }, onDragEnd);
    sideGrip.classList.add("pixwb-dragging");
    e.stopPropagation();
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) =>
    sideGrip.addEventListener(t, () => sideGrip.classList.remove("pixwb-dragging")));
  sideGrip.addEventListener("dblclick", () => {
    rect.sw = SIDE_DEF;
    applyRect();
    saveRect(rect);
  });

  // Same startDrag as everything else, so it inherits the pointer capture and
  // the buttons-are-up guard rather than being a third hand-rolled copy.
  // Measured from the RIGHT edge, since that is the edge this pane is pinned to.
  detGrip.addEventListener("pointerdown", (e) => {
    const bodyRight = body.getBoundingClientRect().right;
    startDrag(detGrip, e, (ev) => {
      rect.dw = Math.round(Math.max(DET_MIN, Math.min(bodyRight - ev.clientX, detMax(rect.w))));
      detail.style.width = rect.dw + "px";
    }, onDragEnd);
    detGrip.classList.add("pixwb-dragging");
    e.stopPropagation();
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) =>
    detGrip.addEventListener(t, () => detGrip.classList.remove("pixwb-dragging")));
  detGrip.addEventListener("dblclick", () => {
    rect.dw = DET_DEF;
    applyRect();
    saveRect(rect);
  });

  window.addEventListener("resize", () => {
    if (win.style.display === "none") return;
    rect = clampRect(rect);
    applyRect();
  });

  // Clicks inside must not reach the canvas, or browsing would deselect
  // whatever was selected before the panel was opened.
  win.addEventListener("pointerdown", (e) => e.stopPropagation());

  // ── keep the keyboard alive ──
  //
  // The footer promises the arrow keys move the selection, and they did not:
  // a card is a plain div, so clicking one BLURS the search box and focus falls
  // out to the page body, from where no keypress ever reaches this panel. The
  // arrows then worked only if you clicked back into the search box first,
  // which is exactly what got reported.
  //
  // The rule is simply that the search box holds focus unless you are editing
  // something. Typing keeps filtering and the arrows keep working, wherever you
  // last clicked.
  //
  // Note this can only be caught with a REAL click. A synthetic MouseEvent does
  // not move focus, so a scripted test of the arrows passes either way.
  win.addEventListener("mousedown", (e) => {
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && win.contains(a) && a.matches("input, textarea, [contenteditable]")) return;
      // The context menu lives in document.body, OUTSIDE this window, so the
      // test above cannot see it. Anything focused in there is deliberate.
      //
      // This is what makes a RIGHT-click safe, and it has to be this rather
      // than skipping non-left buttons entirely: the deferred refocus lands a
      // tick after the menu has focused its first entry, and without the test
      // it pulled focus straight back out so the menu's arrow keys did nothing.
      // But a right-click that opens NO menu still needs the rescue, or it
      // blurs the search box with nothing to bring it back.
      if (a && a.closest(".pixwb-menu")) return;
      // A question box is up (index.js ask()): focus belongs IN it. The search
      // box sits behind the dialog, and handing focus there sent typing, the
      // arrows and Enter to the panel the dialog covers - a click on the
      // dialog's own title was enough. Back to its text box if it has one,
      // otherwise its backdrop, where Enter is a safe cancel.
      const dlg = win.querySelector(".pixwb-ask");
      if (dlg) {
        if (!(a && dlg.contains(a) && a !== dlg)) (dlg.querySelector("input") || dlg).focus({ preventScroll: true });
        return;
      }
      bar.querySelector("input")?.focus({ preventScroll: true });
    }, 0);
  });

  // ── toast ──
  let toastEl = null, toastTimer = null;
  function toast(message) {
    // An empty message HIDES it. Showing a blank box is never what a caller
    // meant, and one did exactly that after every favourite toggle.
    if (!message) {
      if (toastEl) toastEl.style.display = "none";
      clearTimeout(toastTimer);
      return;
    }
    if (!toastEl) {
      toastEl = el("div", "pixwb-toast");
      body.appendChild(toastEl);          // inside the body, so it can never
    }                                     // land on top of the footer at any
    toastEl.textContent = message;        // footer height (help pattern #19)
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.display = "none"; }, 2600);
  }

  const api = {
    el: win, bar, side, main, detail, foot, title, count,
    isOpen: () => win.style.display !== "none",
    toast,
    setCount: (text) => { count.textContent = text; },
    isDetailVisible: () => !detail.classList.contains("hidden"),
    // The panel's "focus home". Anything that takes focus away on purpose -
    // the context menu is the one so far - hands it back here when it is done,
    // because focus on document.body means the keyboard stops reaching us.
    focusSearch: () => bar.querySelector("input")?.focus({ preventScroll: true }),
    open() {
      // Re-read the accent each open, so the panel follows a colour changed
      // while it was shut.
      win.style.setProperty("--pix-acc", globalAccent() || BRAND);
      rect = clampRect(rect);
      applyRect();
      win.style.display = "flex";
      onRender?.();
      setTimeout(() => bar.querySelector("input")?.focus(), 20);
    },
    close() {
      // Hiding the panel blurs whatever was focused inside it, and if that was
      // an open rename box the blur would COMMIT the half-typed name. Closing
      // is not "clicking away" - Alt+W reaches here with no click at all - so
      // the flag a re-render uses says "this blur is not the user's answer".
      //
      // Suppressing the commit is only half of it: onClose ALSO has to throw the
      // edit away. Leaving it meant reopening the panel restored the box, with
      // focus, still holding the half-typed name - and the next keystroke or
      // click committed a rename the user had walked away from. The edit really
      // is abandoned now, which is what Escape does too.
      markRendering(() => { win.style.display = "none"; });
      const q = bar.querySelector("input");
      // Emptying the BOX is not the same as clearing the search. The filter is
      // held in the panel's own state, so a panel closed mid-search reopened
      // looking unfiltered while still hiding most of the list. Fire the same
      // event typing does, so whatever listens clears its state too.
      if (q && q.value) { q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); }
      if (toastEl) toastEl.style.display = "none";
      onClose?.();
    },
    toggle() { api.isOpen() ? api.close() : api.open(); },
    destroy() { win.remove(); },
  };

  // Esc closes, but only when focus is inside, or this would swallow Escape for
  // the whole app.
  win.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const q = bar.querySelector("input");
      // Escape clears a search first: losing a typed query AND the window in
      // one keystroke is the wrong amount of undo for one key.
      if (q && q.value && document.activeElement === q) {
        q.value = "";
        q.dispatchEvent(new Event("input", { bubbles: true }));
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      api.close();
    }
  });

  closeBtn.addEventListener("click", () => api.close());
  return api;
}
