// Canvas zoom passthrough for in-node DOM widgets.
//
// ComfyUI binds its wheel-to-zoom listener on the <canvas> element, so a wheel
// event has to reach the canvas to zoom. An in-node DOM widget (addDOMWidget) is
// layered OVER the canvas, so wheeling over it - especially over a scrollable
// child like a textarea or a list - is consumed by the widget and never reaches
// the canvas, so zoom stops (issue #17). Nodes 2.0 already forwards the wheel to
// the canvas via its own node container, so the forwarding half is CLASSIC-ONLY
// and NO-OPS in Nodes 2.0.
//
// Nodes 2.0 has the OPPOSITE problem, handled by the other half (see
// keepWheelForFieldsInNodes2 below): core forwards EVERY wheel over a node to the
// canvas, so the "Scroll the field" setting was silently ignored there and a long
// prompt could not be scrolled with the wheel at all (reported 2026-10-03).
//
// Mirrors ComfyUI's own preview widgets (useCanvasInteractions ->
// forwardEventToCanvas): forward the wheel to the canvas UNLESS the cursor is over
// a scrollable region that still has room to scroll in that direction (then let
// it scroll normally, e.g. a long prompt textarea or a checklist).
//
// The same layering also swallowed MIDDLE-BUTTON PANNING: LiteGraph listens for
// pointerdown / pointermove / pointerup on the <canvas> itself, so a middle drag
// that starts on a node body never reached it and the canvas did not move
// (reported 2026-09-13 on Save Image and Pause Image; measured on every node with
// a DOM body). installCanvasZoomPassthrough forwards that too, see below.

import { app } from "../../../scripts/app.js";
import { isVueNodes } from "./nodes2.mjs";

// User setting: what the wheel does when the cursor is over a SCROLLABLE field
// inside a node (a long prompt textarea, a list). Registered in
// js/canvas_zoom/index.js; the two option strings are duplicated there and MUST
// stay in lockstep.
export const WHEEL_SETTING_ID = "Pixaroma.CanvasZoom.WheelOverFields";
export const WHEEL_SCROLL = "Scroll the field";   // default = the old behaviour
export const WHEEL_ZOOM = "Zoom the canvas";

// Read LIVE, not cached: changing the setting then takes effect immediately with
// no page reload, and a cache can never go stale if a future ComfyUI stops firing
// onChange. The cost is nil - this runs only while the cursor is over a Pixaroma
// node body, and a settings lookup is nothing next to the full-canvas repaint a
// zoom triggers. Any failure falls back to the default (scroll the field).
function wheelZoomsOverFields() {
  try {
    return app?.ui?.settings?.getSettingValue(WHEEL_SETTING_ID) === WHEEL_ZOOM;
  } catch { return false; }
}

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

// ---- Nodes 2.0: let a scrollable field keep the wheel ------------------------
// Core listens on the layer holding every node in the CAPTURE phase
// (GraphCanvas.vue onWheelCapture -> useCanvasInteractions.forwardEventToCanvas)
// and sends each wheel to the canvas, cancelling it, unless the element under the
// cursor sits inside data-capture-wheel="true" AND holds focus. That capture
// listener runs before anything inside the node, so the per-root listener in
// installCanvasZoomPassthrough never gets a say. Measured on frontend 1.52.7 and
// the same in core's main branch: wheel over a Prompt / Text / AI Prompt box with
// text left to scroll zoomed the canvas, the box never moved.
// So ONE document-level capture listener (it runs before core's) makes the same
// decision Classic makes and, when the field should scroll, stops the event going
// any deeper. It does NOT preventDefault, so the browser scrolls the field
// natively; other capture listeners on document (our popups closing on wheel)
// still run, stopPropagation only stops nodes below document.
// Left to core, unchanged: Ctrl/Cmd+wheel (core's canvas gesture), anything inside
// data-capture-wheel="true" (core's own opt-in, e.g. Load 3D's viewport), a field
// at the end of its scroll, and every wheel when the setting is "Zoom the canvas".
const _wheelRoots = new WeakSet();
let _nodes2WheelInstalled = false;

function wheelRootOf(el) {
  for (let e = el; e; e = e.parentElement) if (_wheelRoots.has(e)) return e;
  return null;
}

function keepWheelForFieldsInNodes2(e) {
  if (!isVueNodes() || e.ctrlKey || e.metaKey) return;
  const target = e.target;
  if (!(target instanceof Element)) return;
  const root = wheelRootOf(target);
  if (!root || wheelZoomsOverFields()) return;
  if (target.closest('[data-capture-wheel="true"]')) return;
  if (!scrollRegionWantsWheel(target, root, e.deltaX, e.deltaY)) return;
  e.stopPropagation();
}

// ---- middle-button pan -------------------------------------------------------
// A copy of what ComfyUI itself does in Nodes 2.0, so both renderers behave the
// same: GraphCanvas.vue listens on the layer holding every node in the CAPTURE
// phase and re-dispatches any middle press, held move or release on the canvas
// (useCanvasInteractions.forwardEventToCanvas), before the node's own handlers
// see it. The one exception is also core's: a text field that already HAS FOCUS
// keeps its middle press (shouldIgnoreCopyPaste + activeElement check).
// CAPTURE is deliberate: dozens of our text boxes and buttons stop pointerdown
// from bubbling, and a bubble listener would leave a dead zone on every one.
// Once the canvas gets the press, its CanvasPointer takes pointer capture, so the
// moves and the release go straight to it; forwarding them here as well is core's
// safety net for a capture that did not take.
const isMiddlePress = (e) => e.button === 1 || e.buttons === 4;  // core: isMiddlePointerInput
const isMiddleHeld = (e) => (e.buttons & 4) === 4;                // core: isMiddleButtonHeld
const isMiddleRelease = (e) => e.button === 1;                    // core: isMiddleButtonEvent

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "file", "hidden", "image", "radio", "range", "reset", "search", "submit",
]);

// core's shouldIgnoreCopyPaste, limited (as core limits it) to the focused element.
function focusedFieldKeepsPress(target) {
  if (!target || target !== document.activeElement) return false;
  const isTextInput = target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type));
  if (isTextInput) return true;
  try { return !!window.getSelection?.()?.toString(); } catch { return false; }
}

function forwardPanToCanvas(e, matches) {
  if (isVueNodes()) return;                    // Nodes 2.0 forwards these itself
  if (!matches(e) || focusedFieldKeepsPress(e.target)) return;
  const canvasEl = app?.canvas?.canvas;        // read lazily; the canvas can be recreated
  if (!canvasEl) return;
  e.preventDefault();
  e.stopImmediatePropagation();                // the node's own handlers never see it
  canvasEl.dispatchEvent(new PointerEvent(e.type, e));
}

// Install wheel passthrough on an in-node DOM widget `root` so the mouse wheel
// zooms the ComfyUI canvas when the cursor is over the widget (Classic renderer),
// except over a scrollable region that still has room to scroll - and the
// middle-button pan passthrough above. In Nodes 2.0 both forwarders no-op and the
// root is registered with keepWheelForFieldsInNodes2 instead, so its scrollable
// fields scroll there too. Safe to call unconditionally. Returns an uninstall fn
// (optional to call; the listeners are garbage-collected with the element when the
// node is removed, and a detached element never receives these events).
export function installCanvasZoomPassthrough(root) {
  if (!root || typeof root.addEventListener !== "function") return () => {};
  _wheelRoots.add(root);
  if (!_nodes2WheelInstalled) {
    _nodes2WheelInstalled = true;
    document.addEventListener("wheel", keepWheelForFieldsInNodes2, { capture: true, passive: true });
  }
  const onWheel = (e) => {
    if (isVueNodes()) return;                  // Nodes 2.0 forwards to the canvas itself
    // "Zoom the canvas" makes the wheel zoom everywhere on the node, including
    // over a scrollable field (that field is then scrolled with its scrollbar).
    if (!wheelZoomsOverFields() && scrollRegionWantsWheel(e.target, root, e.deltaX, e.deltaY)) return;
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
  const onPanDown = (e) => forwardPanToCanvas(e, isMiddlePress);
  const onPanMove = (e) => forwardPanToCanvas(e, isMiddleHeld);
  const onPanUp = (e) => forwardPanToCanvas(e, isMiddleRelease);
  root.addEventListener("pointerdown", onPanDown, true);
  root.addEventListener("pointermove", onPanMove, true);
  root.addEventListener("pointerup", onPanUp, true);
  return () => {
    _wheelRoots.delete(root);
    root.removeEventListener("wheel", onWheel);
    root.removeEventListener("pointerdown", onPanDown, true);
    root.removeEventListener("pointermove", onPanMove, true);
    root.removeEventListener("pointerup", onPanUp, true);
  };
}
