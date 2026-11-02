// Pixaroma Canvas Zoom - the user setting for the in-node mouse-wheel behaviour.
//
// Background: ComfyUI binds wheel-to-zoom on the <canvas>, and a node's DOM panel
// (addDOMWidget) is layered OVER it, so wheeling on a node body would never reach
// the canvas and zoom would silently stop there (issue #17). Every Pixaroma node
// with a DOM panel therefore calls installCanvasZoomPassthrough (the helper in
// js/shared/canvas_zoom.mjs), which forwards the wheel to the canvas.
//
// The helper's one judgement call is what to do over a SCROLLABLE field inside
// that panel (a long prompt textarea, a list): scroll the field, or zoom anyway.
// This extension registers the setting that decides. It adds no node and patches
// nothing - the actual behaviour lives in the helper.

import { app } from "../../../scripts/app.js";
import {
  WHEEL_SETTING_ID,
  WHEEL_SCROLL,
  WHEEL_ZOOM,
} from "../shared/canvas_zoom.mjs";

app.registerExtension({
  name: "Pixaroma.CanvasZoom",
  settings: [
    {
      id: WHEEL_SETTING_ID,
      name: "Mouse wheel over a text box or list inside a node",
      type: "combo",
      defaultValue: WHEEL_SCROLL,
      options: [WHEEL_SCROLL, WHEEL_ZOOM],
      tooltip:
        "Choose what the mouse wheel does when the pointer is over a scrollable " +
        "text box or list inside a Pixaroma node. " +
        "\"Scroll the field\" scrolls the text, then zooms the canvas once the text " +
        "has nothing left to scroll. Once you click into a text box, the wheel only " +
        "scrolls that box and never zooms. " +
        "\"Zoom the canvas\" always zooms, and you move the text with its scrollbar. " +
        "Anywhere else on a node the wheel always zooms the canvas, and Ctrl + wheel " +
        "always zooms it.",
      // Distinct leaf category: settings that share a leaf collapse into one row.
      category: ["👑 Pixaroma", "Canvas zoom"],
      // No onChange needed: the helper reads this setting live on each wheel tick,
      // so a change applies straight away with no reload.
    },
  ],
});
