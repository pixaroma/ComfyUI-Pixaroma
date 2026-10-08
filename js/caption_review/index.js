// Caption Review Pixaroma - frontend: two buttons under the folder field
// ("Browse folder", "Review captions") and the review window (review.mjs).
// The node never runs (Python: nodes/node_caption_review.py); everything it does
// happens in the window. Native widgets only on the face, so it looks and sizes
// the same in Classic and Nodes 2.0.

import { app } from "../../../scripts/app.js";
import { pickFolderInto } from "../shared/folder_pick.mjs";
import { openCaptionReview } from "./review.mjs";

const COMFY_CLASS = "PixaromaCaptionReview";

function noSerialize(w) {
  if (!w) return;
  w.serialize = false;
  w.options = { ...(w.options || {}), serialize: false };
}

app.registerExtension({
  name: "Pixaroma.CaptionReview",
  nodeCreated(node) {
    if (node.comfyClass !== COMFY_CLASS) return;
    // Appended AFTER the native folder widget (VC#23); buttons carry no value.
    noSerialize(node.addWidget("button", "Browse folder", null, () => {
      pickFolderInto(node, "folder", "Caption Review");
    }));
    noSerialize(node.addWidget("button", "Review captions", null, () => {
      const w = node.widgets?.find((x) => x.name === "folder");
      openCaptionReview(node, w ? String(w.value || "") : "");
    }));
    const origRemoved = node.onRemoved;
    node.onRemoved = function () {
      try { node._pixCrClose?.(); } catch { /* window already gone */ }
      return origRemoved?.apply(this, arguments);
    };
  },
});
