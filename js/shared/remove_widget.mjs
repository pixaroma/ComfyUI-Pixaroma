// Take a widget OFF a node for good, the way the frontend wants it done.
//
// WHY (Vue Compat #27, the frontend team's docs/extensions/widgets-migration.md):
// `node.removeWidget(w)` runs the widget's own onRemove (which is what stops
// ComfyUI re-mounting a DOM widget, monitor.md #8), unlinks any input that
// pointed at it, and from frontend 1.54 also deletes the widget's entry in the
// widget value store. A bare `node.widgets.splice()` skips that last step:
// MEASURED on 1.54.12 (widget_stale_probe.mjs / rows_probe.mjs), every Nodes 2.0
// face torn down by a renderer flip and every removed Switch / Mute Switch /
// Sliders / Dropdown row left its store entry behind.
//
// NOT for MOVING a widget (take it out and put the same one back): removeWidget
// would run its onRemove and tear down the very element being moved. Those few
// places keep a plain splice on purpose (sliders/ui.mjs "+ Add" strip,
// set_get/get_node.mjs combo refresh).
//
// Never throws. On a frontend without removeWidget, or if it throws (1.52.x lets
// an onRemove error escape before its own splice), it falls back to
// onRemove + splice so the widget is gone either way. A widget that is no longer
// on the node still gets its onRemove (every caller did that before this helper:
// a teardown wants ComfyUI's own registration released either way). Returns true
// when the widget was on the node.
export function removeNodeWidget(node, widget) {
  if (!widget) return false;
  const list = node?.widgets;
  if (!Array.isArray(list) || list.indexOf(widget) < 0) {
    try { widget.onRemove?.(); } catch (_e) { /* element already detached */ }
    return false;
  }
  let onRemoveRan = false;
  if (typeof node.removeWidget === "function") {
    try {
      node.removeWidget(widget);
    } catch (_e) {
      // removeWidget calls onRemove before it splices; if that threw, the hook
      // already ran (or cannot run) - do not call it a second time below.
      onRemoveRan = true;
    }
    if (list.indexOf(widget) < 0) return true;
    onRemoveRan = true; // removeWidget ran its onRemove even if it left the widget in place
  }
  if (!onRemoveRan) {
    try { widget.onRemove?.(); } catch (_e) { /* element already detached */ }
  }
  const i = list.indexOf(widget);
  if (i >= 0) list.splice(i, 1);
  return true;
}
