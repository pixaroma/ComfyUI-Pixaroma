// Canvas zoom passthrough for in-node DOM widgets (Classic renderer only).
//
// ComfyUI binds its wheel-to-zoom listener on the <canvas> element, so a wheel
// event has to reach the canvas to zoom. An in-node DOM widget (addDOMWidget) is
// layered OVER the canvas, so wheeling over it - especially over a scrollable
// child like a textarea or a list - is consumed by the widget and never reaches
// the canvas, so zoom stops (issue #17). Nodes 2.0 already forwards the wheel to
// the canvas via its own node container, so this is a CLASSIC-ONLY fix that
// NO-OPS in Nodes 2.0.
//
// Mirrors ComfyUI's own preview widgets (useCanvasInteractions ->
// forwardEventToCanvas): forward the wheel to the canvas UNLESS the cursor is over
// a scrollable region that still has room to scroll in that direction (then let
// it scroll normally, e.g. a long prompt textarea or a checklist).

import { app } from "/scripts/app.js";
import { isVueNodes } from "./nodes2.mjs";

// True when an element between `target` and `root` (inclusive) is scrollable AND
// still has room to scroll in the wheel's direction - i.e. the wheel should
// scroll THAT element, not zoom the canvas.
function scrollRegionWantsWheel(target, root, deltaX, deltaY) {
  const vertical = Math.abs(deltaY) >= Math.abs(deltaX);
  let el = target;
  while (el && el !== root.parentElement) {
    if (el.nodeType === 1) {
      const cs = getComputedStyle(el);
      if (vertical) {
        const oy = cs.overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
          const atTop = el.scrollTop <= 0;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return true;
        }
      } else {
        const ox = cs.overflowX;
        if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1) {
          const atLeft = el.scrollLeft <= 0;
          const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
          if ((deltaX < 0 && !atLeft) || (deltaX > 0 && !atRight)) return true;
        }
      }
    }
    el = el.parentElement;
  }
  return false;
}

// Install wheel passthrough on an in-node DOM widget `root` so the mouse wheel
// zooms the ComfyUI canvas when the cursor is over the widget (Classic renderer),
// except over a scrollable region that still has room to scroll. Safe to call
// unconditionally - it no-ops in Nodes 2.0. Returns an uninstall fn (optional to
// call; the listener is garbage-collected with the element when the node is
// removed, and a detached element never receives wheel events).
export function installCanvasZoomPassthrough(root) {
  if (!root || typeof root.addEventListener !== "function") return () => {};
  const onWheel = (e) => {
    if (isVueNodes()) return;                  // Nodes 2.0 forwards to the canvas itself
    if (scrollRegionWantsWheel(e.target, root, e.deltaX, e.deltaY)) return;
    const canvasEl = app?.canvas?.canvas;      // read lazily; the canvas can be recreated
    if (!canvasEl) return;
    e.preventDefault();                        // needs a non-passive listener (below)
    e.stopPropagation();
    // Re-dispatch a synthetic wheel to the LiteGraph canvas so it zooms - exactly
    // what ComfyUI's own forwardEventToCanvas does for its preview nodes.
    const { clientX, clientY, deltaX, deltaY, deltaMode, ctrlKey, metaKey, shiftKey } = e;
    canvasEl.dispatchEvent(new WheelEvent("wheel", {
      clientX, clientY, deltaX, deltaY, deltaMode,
      ctrlKey, metaKey, shiftKey, bubbles: true, cancelable: true,
    }));
  };
  root.addEventListener("wheel", onWheel, { passive: false });
  return () => root.removeEventListener("wheel", onWheel);
}
