// Sketch Pixaroma - drawing with the mouse or a tablet pen.
//
// Shared by the node face and the big view: each passes its own picture area
// and a getView() that says where the picture sits inside it.
//
// The drag follows convention #20 to the letter: pointer capture on the area
// AND "no button held -> finish", because a lost release otherwise leaves a
// mark glued to the cursor. Synthetic events cannot reproduce that, so it is
// guarded rather than trusted.

import { isComfyTextShortcut } from "../shared/text_shortcuts.mjs";
import { MAX_POINTS, MAX_TEXT } from "./core.mjs";
import { isClosedLoop, linePx } from "./draw.mjs";
import { commitMark, uiState } from "./actions.mjs";

/**
 * getView() -> { rect: {x,y,w,h} picture box in the area's CSS px, W, H } | null
 * onDraft(mark|null) repaints with the mark being drawn.
 * onAdded() runs after a mark (or a word) was really added, on THIS surface.
 */
export function attachDrawing(node, area, getView, onDraft, onAdded) {
  let draft = null;
  let pointerId = null;
  let lastPx = null;

  // Pointer position -> picture fractions. getBoundingClientRect is in SCREEN
  // pixels (the graph zoom scales the node body), the picture box is in the
  // area's layout pixels, so convert through the area's own ratio.
  const toPicture = (e, v) => {
    const r = area.getBoundingClientRect();
    const k = r.width > 0 ? area.clientWidth / r.width : 1;
    const x = (e.clientX - r.left) * k;
    const y = (e.clientY - r.top) * k;
    return {
      p: [Math.min(1, Math.max(0, (x - v.rect.x) / v.rect.w)), Math.min(1, Math.max(0, (y - v.rect.y) / v.rect.h))],
      px: [x, y],
    };
  };

  const finish = (keep) => {
    if (!draft) return;
    const d = draft;
    const v = getView();
    draft = null;
    lastPx = null;
    if (pointerId != null) { try { area.releasePointerCapture(pointerId); } catch {} }
    pointerId = null;
    onDraft(null);
    if (keep && v) commit(d, v);
  };

  const commit = (d, v) => {
    const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]];
    const wPx = Math.abs(b[0] - a[0]) * v.rect.w;
    const hPx = Math.abs(b[1] - a[1]) * v.rect.h;
    // A press that never really moved is a click, and a click makes nothing:
    // a stray tap must not leave a dot-sized box behind.
    if (d.type === "box" || d.type === "ellipse") { if (wPx < 6 || hPx < 6) return; }
    else if (d.type === "arrow") { if (Math.hypot(wPx, hPx) < 12) return; }
    else if (d.type === "pen") {
      if (d.pts.length < 3) return;
      let len = 0;
      for (let i = 1; i < d.pts.length; i++) {
        len += Math.hypot((d.pts[i][0] - d.pts[i - 1][0]) * v.rect.w, (d.pts[i][1] - d.pts[i - 1][1]) * v.rect.h);
      }
      if (len < 10) return;
      const P = d.pts.map(([x, y]) => [x * v.W, y * v.H]);
      d.closed = isClosedLoop(P, linePx(d.w, Math.max(v.W, v.H)));
    }
    if (commitMark(node, d, v.W / v.H)) onAdded?.();
  };

  area.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || draft) return;
    const v = getView();
    if (!v) return;                               // no picture yet: nothing to mark
    e.stopPropagation();
    e.preventDefault();
    const ui = uiState(node);
    const { p, px } = toPicture(e, v);
    if (ui.tool === "text") { askText(node, area, px, p, ui, onAdded); return; }
    try { area.setPointerCapture(e.pointerId); } catch {}
    pointerId = e.pointerId;
    lastPx = px;
    draft = { type: ui.tool, color: ui.color, w: ui.width, pts: [p, p], note: "" };
    if (ui.tool === "pen") draft.pts = [p];
    onDraft(draft);
  });

  area.addEventListener("pointermove", (e) => {
    if (!draft || e.pointerId !== pointerId) return;
    if (!(e.buttons & 1)) { finish(true); return; }
    const v = getView();
    if (!v) return;
    const { p, px } = toPicture(e, v);
    if (draft.type === "pen") {
      if (lastPx && Math.hypot(px[0] - lastPx[0], px[1] - lastPx[1]) < 1.5) return;
      if (draft.pts.length >= MAX_POINTS) return;
      draft.pts.push(p);
    } else {
      draft.pts[1] = p;
    }
    lastPx = px;
    onDraft(draft);
  });

  area.addEventListener("pointerup", (e) => { if (e.pointerId === pointerId) finish(true); });
  area.addEventListener("pointercancel", () => finish(false));
  area.addEventListener("lostpointercapture", () => finish(true));

  return { cancel: () => finish(false) };
}

/** A small box where you clicked; Enter or clicking away adds the words. */
function askText(node, area, px, p, ui, onAdded) {
  // A word still open is ADDED before the new box opens, through its own
  // close(), never a bare remove(): removing a focused box fires its blur, the
  // blur handler removes it too, and the outer remove() then throws (measured:
  // "no longer a child of this node"), which aborted the new box and lost the
  // next word typed.
  area.querySelector(".pix-sketch-txt")?._pixClose?.(true);
  const inp = document.createElement("input");
  inp.className = "pix-sketch-txt";
  inp.maxLength = MAX_TEXT;
  inp.placeholder = "type a word, then Enter";
  inp.style.left = Math.max(2, Math.min(area.clientWidth - 150, px[0])) + "px";
  inp.style.top = Math.max(2, Math.min(area.clientHeight - 30, px[1] - 13)) + "px";
  area.appendChild(inp);
  const color = ui.color;
  const w = ui.width;
  let done = false;
  const close = (keep) => {
    if (done) return;
    done = true;                    // first: the remove() below fires blur, which lands here again
    const text = inp.value.trim();
    inp.remove();
    if (keep && text) {
      const aspect = node._pixSkPic?.ok ? (node._pixSkPic.realW / node._pixSkPic.realH) : null;
      if (commitMark(node, { type: "text", color, w, pts: [p], text, note: "" }, aspect)) onAdded?.();
    }
  };
  inp._pixClose = close;
  inp.addEventListener("keydown", (k) => {
    // Ctrl+Enter adds the word AND still runs the workflow (it has to reach
    // ComfyUI); Ctrl+S adds it AND saves, or the save would miss the word still
    // being typed. Every other key stays in the box, so typing fires no shortcut.
    if (isComfyTextShortcut(k)) {
      if (k.key === "Enter" || k.key === "s" || k.key === "S") close(true);
      return;
    }
    k.stopPropagation();
    if (k.key === "Enter") { k.preventDefault(); close(true); }
    else if (k.key === "Escape") { k.preventDefault(); close(false); }
  });
  inp.addEventListener("pointerdown", (k) => k.stopPropagation());
  inp.addEventListener("blur", () => close(true));
  setTimeout(() => inp.focus(), 0);
}
