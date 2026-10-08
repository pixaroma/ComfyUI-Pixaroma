// "Browse folder" for a node whose folder is a plain STRING widget
// (Load Texts from Folder, Caption Review). Opens the native folder dialog on
// the ComfyUI host through Load Images from Folder's existing pick_native route
// (choosing a folder there APPROVES it, path-containment #4) and writes the
// chosen path into the widget. Added 2026-10-08.
//
// The value goes in through widget.value + its callback (VC#25), and the change
// is announced with notifyGraphChanged because it lands after an await (UI#31).

import { app } from "../../../scripts/app.js";
import { pixApiUrl } from "./api_url.mjs";
import { notifyGraphChanged } from "./graph_changed.mjs";

function say(summary, detail) {
  try {
    app.extensionManager?.toast?.add({ severity: "warn", summary, detail, life: 6000 });
  } catch {
    /* no toast service on this frontend: the console line below still tells */
  }
  console.warn(`[Pixaroma] ${summary}: ${detail}`);
}

// Returns the chosen path, or "" when nothing changed.
export async function pickFolderInto(node, widgetName, who) {
  const w = node?.widgets?.find((x) => x.name === widgetName);
  if (!w) return "";
  if (node._pixFolderPickBusy) return "";
  node._pixFolderPickBusy = true;
  let r;
  try {
    const url = pixApiUrl(`/pixaroma/api/load_images_folder/pick_native?path=${encodeURIComponent(w.value || "")}`);
    r = await (await fetch(url)).json();
  } catch (e) {
    r = { ok: false, message: String(e) };
  } finally {
    node._pixFolderPickBusy = false;
  }
  if (r?.ok && r.path) {
    // The node may have been deleted while the dialog was open.
    if (!node.graph) return "";
    w.value = r.path;
    try { w.callback?.(r.path); } catch { /* a callback error must not lose the path */ }
    node.setDirtyCanvas?.(true, true);
    notifyGraphChanged();
    return r.path;
  }
  if (r?.cancelled) return "";
  if (r?.busy) say(who, "Another folder dialog is already open. Close it first.");
  else if (r?.unavailable) say(who, "This ComfyUI has no folder dialog (a remote or headless install). Type the folder path instead.");
  else say(who, r?.message || "The folder dialog could not open.");
  return "";
}
