// A DOM widget's label follows its node's title (App mode, Discord 2026-10-29).
//
// WHY: ComfyUI's App mode names each input `widget.label || widget.name`
// (AppModeWidgetList.vue, frontend 1.57). Our DOM widgets set no label, so every
// Prompt Stack read "promptstack" and every Load Image Mini
// "pixaroma_load_image_mini_ui", and two stacks in one app could not be told
// apart. Read LIVE, so a node retitled "FACE PROMPT" shows as FACE PROMPT the
// next time the app panel draws.
//
// App mode's own Rename writes `widget.label`; that wins until the page reloads
// (core saves a label only through an input slot, and these widgets have none),
// and an empty one goes back to the title. Nothing here is saved with the
// workflow, and `widget.name` (what the node's code looks widgets up by) is
// untouched.
export function labelFromNodeTitle(node, widget) {
  if (!node || !widget) return;
  let own;
  Object.defineProperty(widget, "label", {
    configurable: true,
    enumerable: true,
    get: () => own || node.title || undefined,
    set: (v) => { own = v || undefined; },
  });
}
