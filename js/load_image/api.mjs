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
export function updateNativePreview(node, filename) {
  if (!filename) return;
  node._pixLiPreviewReqId = (node._pixLiPreviewReqId | 0) + 1;
  const myReq = node._pixLiPreviewReqId;
  const { subfolder, filename: name } = splitFilenameSubfolder(filename);
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
  img.src = `/view?filename=${encodeURIComponent(name)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`;
}

// Single source of truth for picking an image (dropdown click, arrow nav,
// upload, drag-drop, paste). Centralises:
//   - widget.value write
//   - per-node `_pixLiSelectedFilename` cache (defensive sync used by the
//     graphToPrompt hook, in case some Vue path resets widget.value back)
//   - native preview refresh (via updateNativePreview)
//   - dropdown label refresh (via the registered hook)
//   - dirty canvas
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
  w.value = filename;
  node._pixLiSelectedFilename = filename;
  updateNativePreview(node, filename);
  node._pixLiOnFilenameChanged?.(filename);
  node.graph?.setDirtyCanvas?.(true, true);
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

  const resp = await fetch("/upload/image", { method: "POST", body: form });
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
export async function pasteFromClipboard(node) {
  if (!navigator.clipboard?.read) {
    throw new Error("Clipboard read not supported in this browser");
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    for (const type of item.types) {
      if (type.startsWith("image/")) {
        const blob = await item.getType(type);
        const ext = type.split("/")[1] || "png";
        const name = `pasted_${Date.now()}.${ext}`;
        return uploadImageToInput(node, blob, name);
      }
    }
  }
  return null; // no image in clipboard
}
