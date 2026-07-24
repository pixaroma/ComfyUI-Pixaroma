// Shared resize-floor helper for DOM-widget nodes in the Nodes 2.0 renderer.
//
// THE PROBLEM: In Nodes 2.0 the manual-resize MINIMUM height is a live
// measurement of the node collapsed to --node-height:0 (NOT getMinHeight /
// computeLayoutSize - see CLAUDE.md). A flex DOM-widget root collapses below its
// content under that measurement, so the user can drag the node small enough that
// fixed content (a button row) spills out below the frame.
//
// THE FIX: while the user is actively dragging a RESIZE HANDLE, pin a hard
// min-height = the content height on the widget root. The collapse measurement
// then reads the true floor and the drag clamps there, so nothing spills. The
// min-height is set ONLY for the duration of the gesture (armed on the
// resize-handle pointerdown, cleared on pointerup/cancel), so it is NEVER present
// on the load path - grow-to-content can't inflate node.size on a workflow
// switch (no size jump, no false-dirty). Legacy ignores it (it floors via
// getMinHeight).
//
// Timing: the pointerdown listener is CAPTURE phase on window, so it runs before
// the frontend's resize handler (which measures on the handle's pointerdown), so
// our min-height is in place when the collapse measurement is taken.
//
// measureFn(root) -> the content height in px (each node passes its own).
// Returns an uninstall fn; call it in onRemoved.

import { isVueNodes } from "./nodes2.mjs";

// Generic content-height measure for a flex-column root: sum the visible
// children's offsetHeight + the row gaps + the root's vertical padding. Use this
// as the measureFn for a node that has no measure of its own (NOT root.scrollHeight,
// which the layout stretches - feedback loop).
export function measureRootContent(root) {
  if (!root) return 0;
  let h = 0;
  let count = 0;
  for (const child of root.children) {
    if (child.offsetParent === null) continue;
    h += child.offsetHeight;
    count += 1;
  }
  const cs = getComputedStyle(root);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;
  if (count > 1) h += gap * (count - 1);
  h += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return h;
}

// onRelease (optional): called once on the pointerup/cancel that ENDS a resize
// gesture this floor armed. Lets a node do post-resize work - e.g. snap the WIDTH
// back to a minimum, since Nodes 2.0 ignores min-width / computeLayoutSize.minWidth
// for the width drag (there is no live width clamp, only this after-the-fact snap).
export function installResizeFloor(root, measureFn, onRelease) {
  if (!root || typeof measureFn !== "function") return () => {};
  let armed = false;

  const clear = () => {
    if (!armed) return;
    armed = false;
    try { root.style.minHeight = ""; } catch (_e) {}
    if (typeof onRelease === "function") { try { onRelease(); } catch (_e) {} }
  };

  const onDown = (e) => {
    if (!isVueNodes() || !root.isConnected) return;
    // A press on WIDGET CONTENT is never a node resize - the resize handles live
    // on the node frame, not inside a widget. Skip it, or a widget that legitimately
    // uses a *-resize cursor (e.g. an ew-resize drag-slider) would falsely arm the
    // floor and make the node jump/shift on every drag, snapping back on release
    // (Outpaint Stitch Pixaroma sliders, Nodes 2.0).
    if (e.target?.closest?.(".lg-node-widget")) return;
    // A resize handle shows a *-resize cursor; anything else (title-bar move,
    // widget click) is not a resize, so leave the floor off.
    let cur = "";
    try { cur = (e.target && window.getComputedStyle(e.target).cursor) || ""; } catch (_e) {}
    if (cur.indexOf("resize") === -1) return;
    // Only arm for OUR node's handle (the handle lives in the same .lg-node).
    const myNode = root.closest(".lg-node");
    const downNode = e.target.closest && e.target.closest(".lg-node");
    if (myNode && downNode && myNode !== downNode) return;
    let h = 0;
    try { h = measureFn(root); } catch (_e) { return; }
    if (!(h > 0)) return;
    try { root.style.minHeight = Math.round(h) + "px"; armed = true; } catch (_e) {}
  };

  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointerup", clear, true);
  window.addEventListener("pointercancel", clear, true);

  return () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointerup", clear, true);
    window.removeEventListener("pointercancel", clear, true);
    clear();
  };
}
