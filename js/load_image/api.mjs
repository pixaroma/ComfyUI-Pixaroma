// Fetch the image from ComfyUI's /view route and assign it to node.imgs so
// the native bottom-of-node preview updates. ComfyUI populates node.imgs
// automatically on workflow load via the image_upload combo's setter, but
// when we set widget.value programmatically the setter does NOT fire — so
// without this helper the preview stays stuck on the previously-loaded file.
export function updateNativePreview(node, filename) {
  if (!filename) return;
  const img = new Image();
  img.onload = () => {
    node.imgs = [img];
    node.graph?.setDirtyCanvas?.(true, true);
  };
  img.onerror = () => {
    // Don't crash — the file might be temp or moved. Just log.
    console.warn("[PixaromaLoadImage] preview fetch failed for", filename);
  };
  // `subfolder=` empty + `type=input` matches the upload route's storage.
  img.src = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=&t=${Date.now()}`;
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

  // Update the underlying `image` combo widget.
  const imageWidget = node._pixLiImageWidget || (node.widgets || []).find((w) => w.name === "image");
  if (imageWidget) {
    if (!imageWidget.options) imageWidget.options = {};
    const values = imageWidget.options.values || [];
    if (!values.includes(saved)) {
      values.push(saved);
      values.sort();
      imageWidget.options.values = values;
    }
    imageWidget.value = saved;
    // Native preview hook — setting widget.value programmatically doesn't
    // fire ComfyUI's image_upload setter, so fetch + assign node.imgs manually.
    updateNativePreview(node, saved);
  }
  node.graph?.setDirtyCanvas?.(true, true);
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
