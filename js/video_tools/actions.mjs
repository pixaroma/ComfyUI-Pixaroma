// Video Tools Pixaroma - every change to the settings goes through here: write
// the saved state, tell ComfyUI's change tracker on a FINISHED change (a click,
// Enter, leaving a field; not every keystroke), repaint the face.

import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { readState, writeState } from "./core.mjs";

function refresh(node) {
  try { node._pixVdtRefresh?.(); } catch (e) { console.warn("[Video Tools] repaint failed", e); }
}

/** One clip's setting (cutStart, cutEnd, reverse). */
export function setClip(node, index, key, value, quiet = false) {
  const st = readState(node);
  if (!st.clips[index] || !["cutStart", "cutEnd", "reverse"].includes(key)) return;
  if (st.clips[index][key] === value) { refresh(node); return; }
  st.clips[index][key] = value;
  writeState(node, st);
  if (!quiet) notifyGraphChanged();
  refresh(node);
}

/** Any other setting. */
export function setOption(node, key, value, quiet = false) {
  const st = readState(node);
  if (st[key] === value) { refresh(node); return; }
  st[key] = value;
  writeState(node, st);
  if (!quiet) notifyGraphChanged();
  refresh(node);
}
