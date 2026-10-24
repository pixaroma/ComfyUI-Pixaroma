import { app } from "../../../scripts/app.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";

// Split "Studio1/cat.png" into {subfolder:"Studio1", filename:"cat.png"}.
// ComfyUI's input/ folder can hold subfolders; the native image_upload combo
// values include the path-prefixed names (e.g. "Studio1/cat.png"). The /view
// endpoint expects subfolder + filename as SEPARATE query params - if we send
// the slash inside `filename=` and leave subfolder empty, the preview fetch
// silently 404s on some Comfy builds. Always split before building the URL.
export function splitFilenameSubfolder(path) {
  if (!path) return { subfolder: "", filename: "" };
  const norm = String(path).replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return { subfolder: "", filename: norm };
  return { subfolder: norm.slice(0, idx), filename: norm.slice(idx + 1) };
}

/**
 * Split ComfyUI's type annotation off a combo value.
 *
 * A value can be `clipspace-painted-masked-123.png [input]` - MEASURED, that is
 * exactly what the widget holds after a Mask Editor save. The annotation names
 * the folder the file lives in, and it must NEVER reach the `filename` query
 * parameter: doing so produced `...png+[input]` in the URL, a guaranteed 404,
 * and because the preview then never matched the widget the reconcile refetched
 * on every setup forever. Found by masking a real image and reloading.
 */
export function splitTypeAnnotation(value) {
  const s = String(value ?? "");
  const m = s.match(/^(.*?)\s*\[(input|output|temp)\]\s*$/i);
  if (!m) return { name: s, type: "input" };
  return { name: m[1], type: m[2].toLowerCase() };
}

// Fetch the image from ComfyUI's /view route and assign it to node.imgs so
// the native bottom-of-node preview updates. ComfyUI populates node.imgs
// automatically on workflow load via the image_upload combo's setter, but
// when we set widget.value programmatically the setter does NOT fire - so
// without this helper the preview stays stuck on the previously-loaded file.
//
// Defensive race-condition fix (issue #38 family): rapid pick-A-then-B picks
// queue two concurrent fetches; img.onload fires in LOAD order, not call
// order, so a slow A landing after a fast B would clobber node.imgs back to A.
// Per-node monotonic request-id discards stale onloads.
/**
 * Is the picture currently in `node.imgs` actually the file `filename` names?
 *
 * Needed on the LOAD path. ComfyUI populates node.imgs from the image_upload
 * combo's setter, but a restored workflow does not always fire it, so a node
 * can end up holding the PREVIOUS workflow's picture while its widget, its
 * filename cache and its origName all correctly name the new one. Reported
 * 2026-08-05 after switching workflows: the picker read one file and the
 * preview showed another.
 *
 * This is not cosmetic. node.imgs feeds the INPUT size card (the node reported
 * 1024x1024 for an image that is 1376x768) and is what Mask Editor and
 * Clipspace read.
 *
 * Compares the `filename` query parameter rather than a substring of the whole
 * URL, so a name that merely appears inside a subfolder or a cache-busting
 * parameter cannot produce a false match.
 */
export function previewMatches(node, filename) {
  const img = node?.imgs?.[0];
  if (!img?.src || !filename) return false;
  let loaded = null;
  try {
    loaded = new URL(img.src, window.location.href).searchParams.get("filename");
  } catch {
    loaded = decodeURIComponent(img.src).match(/[?&]filename=([^&]*)/)?.[1] ?? null;
  }
  if (loaded == null) return false;
  // Normalise BOTH sides. Our own updateNativePreview strips the annotation
  // before building the URL, but ComfyUI's native image_upload setter does NOT:
  // on a workflow load it sets node.imgs with `filename=...png+[input]` (that
  // URL works, its /view parses the annotation server-side). MEASURED after a
  // Mask Editor save plus a reload. Stripping only the widget side meant the
  // two could never agree behind a core-populated preview, so the reconcile
  // refetched on every single setup - wasteful, and it made "match" a
  // permanently false signal.
  const bare = (v) => splitFilenameSubfolder(splitTypeAnnotation(v).name).filename;
  return bare(loaded) === bare(filename);
}

export function updateNativePreview(node, filename) {
  if (!filename) return;
  node._pixLiPreviewReqId = (node._pixLiPreviewReqId | 0) + 1;
  const myReq = node._pixLiPreviewReqId;
  // Peel the type annotation off BEFORE splitting, and use it as the /view
  // `type`. A Mask Editor save leaves the widget holding
  // "clipspace-painted-masked-123.png [input]"; without this the annotation
  // ended up inside filename= as "...png+[input]", which 404s.
  const { name: bare, type } = splitTypeAnnotation(filename);
  const { subfolder, filename: name } = splitFilenameSubfolder(bare);
  const img = new Image();
  img.onload = () => {
    if (node._pixLiPreviewReqId !== myReq) return; // stale, newer pick won
    node.imgs = [img];
    node.graph?.setDirtyCanvas?.(true, true);
    // Notify the index.js side that natural dims are now available, so
    // the input/output dims info bar can refresh. The hook is attached
    // by setupLoadImageNode and may be absent on stray calls.
    node._pixLiOnImageLoaded?.();
  };
  img.onerror = () => {
    if (node._pixLiPreviewReqId !== myReq) return;
    console.warn("[PixaromaLoadImage] preview fetch failed for", filename);
  };
  img.src = pixApiUrl(`/view?filename=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`);
}

/**
 * Point ComfyUI's OWN per-node picture store at the file we just picked.
 *
 * MEASURED 2026-08-10, from a Load Image Mini report ("still the wrong image")
 * with a screen recording: pick a new file, switch workflow tab, come back, and
 * the picker names the new file while the preview and the INPUT size card show
 * the OLD one.
 *
 * ComfyUI keeps a picture per node id in `app.nodeOutputs`. On a workflow
 * restore it replays that entry as a preview load AT THE SAME TIME as the load
 * the restored widget value triggers - two async fetches writing the same
 * `node.imgs`, so the one that finishes LAST wins. Core's native image combo
 * writes this store on every commit (its callback is
 * `node.imgs = undefined; setNodeOutputs(node, widget.value); ...`), so for a
 * native LoadImage both loads name the same file and the race cannot be seen.
 * Our DOM picker wrote only the widget, so the store kept naming the PREVIOUS
 * file and the two loads genuinely disagreed. Measured on real picks: the stale
 * load landed 3ms AFTER the correct one in one run and 3ms BEFORE it in
 * another - which is why the report was intermittent and why a quick retest
 * "looked fixed".
 *
 * Losing that race is not cosmetic: `node.imgs` also feeds the INPUT size card
 * and is what Mask Editor and Clipspace read, so the node reports the wrong
 * dimensions for the file it names, and a mask would be taken against the wrong
 * picture.
 *
 * Same shape as `notifyGraphChanged` below: a native widget quietly updates a
 * piece of core state that a DOM control has to update by hand. Keeping the
 * store in step removes the stale load at its source rather than trying to win
 * a race (verified: with this, core's two loads name the same file, exactly as
 * they do for its own LoadImage).
 */
function syncCoreImageStore(node, filename) {
  try {
    const store = app?.nodeOutputs;
    if (!store || node?.id == null) return;
    // Same normalising as the /view URL builder: the annotation names the
    // FOLDER, and must not be left inside the filename.
    const { name, type } = splitTypeAnnotation(filename);
    const { subfolder, filename: bare } = splitFilenameSubfolder(name);
    store[node.id] = { images: [{ filename: bare, subfolder, type }], animated: [false] };
  } catch (e) {
    // Degrade to the old behaviour (core may replay a stale preview on the next
    // restore) rather than breaking the pick itself.
    console.warn("[Pixaroma] could not sync ComfyUI's preview store", e);
  }
}

/**
 * Put the picture back after an EXTERNAL write left the node blank.
 *
 * MEASURED on frontend 1.47.12 in the CLASSIC renderer, from a user report that
 * "Copy/Paste (Clipspace) is not working" on both loaders. Instrumenting every
 * `node.imgs` write across one paste gives the whole story in three lines:
 *
 *   pasteFromClipspace   node.imgs = [the pasted picture]
 *   m.callback           node.imgs = undefined
 *   (nothing, ever)
 *
 * Core's paste assigns the picture, then fires the image widget's own callback,
 * whose first act is `node.imgs = undefined` before it re-derives the preview
 * from `app.nodeOutputs`. That re-derive is `syncLegacyNodeImgs`, and its first
 * line is `if (!vueNodesMode) return` - so in Classic nothing ever repopulates
 * it and the node is left naming the pasted file with no picture at all. It is
 * NOT our bug: ComfyUI's own LoadImage does exactly the same thing on the same
 * paste (verified with a real right-click, both directions), and in Nodes 2.0
 * both nodes are fine. We repair it anyway because the report lands on us, and
 * because a blank preview here is not cosmetic - `node.imgs` feeds the INPUT
 * size card and is what Mask Editor and a later Copy (Clipspace) read.
 *
 * Deliberately narrow, since it rides the widget-value setter that fires on
 * EVERY write:
 *   - `_pixLiPreviewReqId` unchanged since the write == none of our own pick
 *     paths started a fetch, so a normal pick never double-fetches (they write
 *     the value and THEN call updateNativePreview, which bumps the id).
 *   - `previewMatches` == the right picture is already loaded, so a paste whose
 *     source carried no `image` widget (a Save Image node: no callback fires, so
 *     core's own assignment survives) and the Mask Editor are left alone.
 *     MEASURED: this does NOT make us a no-op in Nodes 2.0 - core clears
 *     `node.imgs` there too, so at +0ms there is nothing to match and we fetch
 *     as well. Both fetches name the same file, so the picture is right either
 *     way; the cost is one extra local request per paste, and the benefit is
 *     that a regression in core's Nodes-2.0 repopulate cannot blank our nodes.
 *   - Never on the load path: node SETUP already reconciles the preview there,
 *     and the load path is the one place a stray write does damage.
 * A 0ms timer is enough because core's whole paste is synchronous; the measured
 * trace shows no further `node.imgs` write for at least 3 seconds after it.
 */
export function schedulePreviewRepair(node) {
  if (!node) return;
  const reqAtWrite = node._pixLiPreviewReqId | 0;
  clearTimeout(node._pixLiPreviewRepairT);
  node._pixLiPreviewRepairT = setTimeout(() => {
    node._pixLiPreviewRepairT = null;
    try {
      if (!node.graph) return;                                  // node removed
      if (isGraphLoading()) return;                             // setup owns the load path
      if ((node._pixLiPreviewReqId | 0) !== reqAtWrite) return;  // one of ours is already fetching
      const want = node._pixLiImageWidget?.value
        || (node.widgets || []).find((w) => w.name === "image")?.value;
      if (!want) return;
      if (previewMatches(node, want)) return;                    // right picture already there
      updateNativePreview(node, want);
    } catch (e) {
      console.warn("[Pixaroma] could not restore the node preview", e);
    }
  }, 0);
}

// Single source of truth for picking an image (dropdown click, arrow nav,
// upload, drag-drop, paste). Centralises:
//   - widget.value write
//   - per-node `_pixLiSelectedFilename` cache (defensive sync used by the
//     graphToPrompt hook, in case some Vue path resets widget.value back)
//   - native preview refresh (via updateNativePreview)
//   - dropdown label refresh (via the registered hook)
//   - dirty canvas
//   - telling ComfyUI's change tracker the workflow now differs from its file
// Call this instead of touching imageWidget.value directly in new code.
export function setSelectedImage(node, filename) {
  if (!filename) return;
  const w = node._pixLiImageWidget;
  if (!w) return;
  // Ensure the value exists in the combo's options - upload paths push first
  // then call this; arrow/dropdown paths already have it. Defensive only.
  if (!w.options) w.options = {};
  const values = w.options.values || (w.options.values = []);
  if (!values.includes(filename)) {
    values.push(filename);
    values.sort();
  }
  const oldValue = w.value;
  w.value = filename;
  node._pixLiSelectedFilename = filename;
  // Tell core the value changed, the way its own combo does (widget.setValue
  // calls node.onWidgetChanged). Core clears a "Missing Inputs" warning, raised
  // when a workflow opened with a picture that is not on disk, ONLY through that
  // hook, so without it the warning stayed after a real pick. Called even for the
  // same name: uploading the missing file under its own name must clear it too.
  try { node.onWidgetChanged?.(w.name, filename, oldValue, w); }
  catch (e) { console.warn("[LoadImage] onWidgetChanged failed:", e); }
  // A picture taken from one of the user's folders records where it came from
  // (folders.mjs sets it just before calling here). Any OTHER pick means the
  // picture no longer comes from that folder, so the arrows go back to stepping
  // through the input folder. Every caller of this function is a real pick.
  const fp = node.properties?.pixLiFolderPick;
  if (fp && fp.name !== filename) delete node.properties.pixLiFolderPick;
  // Track the original (non-clipspace) name directly here too, not only via the
  // imageWidget.value setter — that setter is skipped when the widget's `value`
  // property is non-configurable, and every caller of this fn is a real pick
  // (dropdown / arrow / upload / paste), never a clipspace copy (issue #51).
  if (!/clipspace/i.test(filename)) node._pixLiOrigName = filename;
  // Before the preview fetch, so core's store already names the new file if
  // anything reads it while the image is in flight.
  syncCoreImageStore(node, filename);
  updateNativePreview(node, filename);
  node._pixLiOnFilenameChanged?.(filename);
  node.graph?.setDirtyCanvas?.(true, true);
  // setDirtyCanvas is only a REDRAW flag - it tells the change tracker nothing.
  // Our pick commits on `click`, which is AFTER the `mouseup` that core
  // snapshots on, so without this the pick is never recorded: the workflow is
  // never marked modified, ComfyUI never offers to save it, and reopening
  // restores the file's original image. Safe here because every caller of this
  // function is a real user pick (dropdown / arrow / upload / paste / drop) -
  // there is no load-path caller - and the helper re-checks isGraphLoading().
  notifyGraphChanged();
}

// Upload an image File/Blob to ComfyUI's /upload/image route and update the
// node's `image` combo widget to select the new file.
//
// Returns a Promise<string> resolving to the saved filename (or rejecting on
// network/HTTP error).

export async function uploadImageToInput(node, file, filenameHint = null) {
  const form = new FormData();
  // ComfyUI's /upload/image accepts:
  //   image: the File/Blob
  //   subfolder: optional, defaults to ""
  //   overwrite: "true" / "false"
  //   type: "input" (default) or "temp"
  // When `file` is a Blob (paste path), we need to give it a name.
  if (file instanceof Blob && !(file instanceof File) && filenameHint) {
    form.append("image", file, filenameHint);
  } else if (file instanceof File && filenameHint) {
    // Rename to filenameHint
    form.append("image", new File([file], filenameHint, { type: file.type }));
  } else {
    form.append("image", file);
  }

  const resp = await fetch(pixApiUrl("/upload/image"), { method: "POST", body: form });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Upload failed (${resp.status}): ${text || resp.statusText}`);
  }
  const json = await resp.json();
  const saved = json?.name;
  if (!saved) throw new Error("Upload succeeded but response had no filename");

  // Route through setSelectedImage so we hit ALL the same side effects as
  // dropdown/arrow picks (cache, preview, label refresh, dirty canvas).
  const imageWidget = node._pixLiImageWidget || (node.widgets || []).find((w) => w.name === "image");
  if (imageWidget) {
    if (!node._pixLiImageWidget) node._pixLiImageWidget = imageWidget;
    setSelectedImage(node, saved);
  }
  return saved;
}

// Opens a hidden <input type="file"> picker; on selection, uploads the file.
export function pickAndUploadFile(node) {
  return new Promise((resolve, reject) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.style.display = "none";
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      if (!file) { inp.remove(); resolve(null); return; }
      try {
        const saved = await uploadImageToInput(node, file);
        resolve(saved);
      } catch (e) {
        reject(e);
      } finally {
        inp.remove();
      }
    });
    document.body.appendChild(inp);
    inp.click();
  });
}

// Reads clipboard for an image; uploads as pasted_<ts>.png.
// Used by the Mini's Paste BUTTON only: a click carries no clipboard data, so
// this is the one path that has to ask the browser. Ctrl+V goes through
// installLoaderPaste below and never asks.
export async function pasteFromClipboard(node) {
  if (!navigator.clipboard?.read) {
    throw new Error("Clipboard read not supported in this browser");
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    for (const type of item.types) {
      if (type.startsWith("image/")) {
        const blob = await item.getType(type);
        return uploadPastedImage(node, blob, type);
      }
    }
  }
  return null; // no image in clipboard
}

// Upload a pasted picture under the name every paste path uses.
function uploadPastedImage(node, blob, type) {
  const ext = String(type || blob.type || "").split("/")[1] || "png";
  return uploadImageToInput(node, blob, `pasted_${Date.now()}.${ext}`);
}

// The picture a PASTE EVENT carries, or null when it carries none (copied
// nodes, text).
function clipboardImageFile(dt) {
  const items = dt?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.kind === "file" && String(item.type || "").startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

// Ctrl+V onto the selected loader. One call per loader module, handed that
// module's own "which node is selected" getter.
//
// Take the picture from the PASTE EVENT, never from the Ctrl+V KEYDOWN (fixed
// 2026-09-29, Discord). Both loaders used to preventDefault the keydown and then
// call navigator.clipboard.read(), which broke two things:
//   - cancelling the keydown cancels the paste event, and that event is how
//     ComfyUI pastes copied NODES, so with a loader selected Ctrl+V, Ctrl+Shift+V
//     and copy-paste of the loader itself did nothing at all;
//   - clipboard.read() needs permission: Chrome asks once, Firefox and Zen ask on
//     EVERY paste and throw when refused.
// The event's own data needs no permission (the user's Ctrl+V is the consent), so
// this is what ComfyUI and the Crop editors already do. Only a paste that
// carries a picture is taken; anything else passes through to ComfyUI untouched.
export function installLoaderPaste(getNode, { beforeUpload, afterUpload, onError } = {}) {
  // Ctrl+Shift+V is ComfyUI's "paste nodes WITH their connections", which core's
  // own paste handler leaves to LiteGraph even when a picture is on the
  // clipboard. Match that. Only RECORDED here, never cancelled.
  let shiftPaste = false;
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "v") {
      shiftPaste = e.shiftKey;
    }
  }, true);
  // Capture phase on window: runs before ComfyUI's own paste listener on the
  // document, so stopImmediatePropagation keeps core from ALSO pasting the
  // picture as a new Load Image node.
  window.addEventListener("paste", (e) => {
    const shift = shiftPaste;
    shiftPaste = false; // a later paste from a menu has no keydown of its own
    const node = getNode();
    if (!node || shift) return;
    const t = e.target;
    const tag = String(t?.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
    const file = clipboardImageFile(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    beforeUpload?.(node);
    uploadPastedImage(node, file, file.type).then(
      (saved) => afterUpload?.(node, saved),
      (err) => onError?.(err),
    );
  }, true);
}
