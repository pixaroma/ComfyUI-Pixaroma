// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay backend wrappers                               ║
// ╚═══════════════════════════════════════════════════════════════╝

export async function saveThumbnail(dataURL, filenamePrefix = "text_overlay") {
  const resp = await fetch("/pixaroma/api/text_overlay/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_b64: dataURL, filename_prefix: filenamePrefix }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Save failed: HTTP ${resp.status} ${err}`);
  }
  return resp.json();
}

export function buildPreviewURL(saveResult) {
  if (!saveResult) return "";
  const q = new URLSearchParams({
    filename: saveResult.filename,
    type: saveResult.type || "temp",
    subfolder: saveResult.subfolder || "",
    t: String(Date.now()),
  });
  return `/view?${q.toString()}`;
}
