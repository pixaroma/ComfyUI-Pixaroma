// js/audio_studio/api.mjs
"use strict";

const UPLOAD_ENDPOINT = "/pixaroma/api/audio_studio/upload";

/**
 * Upload an inline image / audio source for a node.
 *
 * @param {string|number} nodeId — the LiteGraph node id
 * @param {"image"|"audio"} kind
 * @param {Blob} blob
 * @param {string} filename — drives extension validation server-side
 * @returns {Promise<{path: string}>} — relative path under input/pixaroma/
 */
export async function uploadSource(nodeId, kind, blob, filename) {
  const fd = new FormData();
  fd.append("node_id", String(nodeId));
  fd.append("kind", kind);
  fd.append("file", blob, filename);
  const res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: fd });
  if (!res.ok) {
    let msg = `upload failed: HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Resolve a URL to fetch upstream image bytes for the editor.
 * Handles LoadImage (widget["image"] with filename) and any node with
 * cached imgs[].
 *
 * Uses the dual graph.links access pattern from CLAUDE.md Vue point #3
 * (Map vs plain object).
 *
 * @param {LGraph} graph
 * @param {LGraphNode} node — the AudioStudio node
 * @returns {string|null}
 */
export function getUpstreamImageUrl(graph, node) {
  if (!graph || !node) return null;
  const inp = (node.inputs || []).find(i => i.name === "image");
  if (!inp || inp.link == null) return null;

  // graph.links may be a Map or plain object (CLAUDE.md Vue point #3)
  let link = graph.links?.[inp.link];
  if (!link && typeof graph.links?.get === "function") {
    link = graph.links.get(inp.link);
  }
  if (!link) return null;

  const src = graph.getNodeById(link.origin_id);
  if (!src) return null;

  if (src.comfyClass === "LoadImage" || src.type === "LoadImage") {
    const w = src.widgets?.find(w => w.name === "image");
    if (w && w.value) {
      const fn = String(w.value).split(/[\\/]/).pop();
      return `/view?filename=${encodeURIComponent(fn)}` +
             `&type=input&subfolder=&t=${Date.now()}`;
    }
  }
  if (Array.isArray(src.imgs) && src.imgs.length) {
    const img = src.imgs[link.origin_slot] || src.imgs[0];
    return typeof img === "string" ? img : (img?.src || null);
  }
  return null;
}

/**
 * Build the URL to fetch an inline-loaded source via ComfyUI's /view route.
 * No custom server endpoint needed — files saved via uploadSource() land
 * under input/pixaroma/audio_studio/<id>/<kind>.<ext>, which /view can
 * serve directly with the right subfolder.
 *
 * @param {string} path — the relative path returned by uploadSource()
 *   (e.g. "audio_studio/<node_id>/image.png")
 * @returns {string|null}
 */
export function getInlineSourceUrl(path) {
  if (!path) return null;
  // path looks like "audio_studio/<id>/image.png" — split into subfolder + filename
  const parts = path.split("/");
  const filename = parts.pop();
  const subfolder = ["pixaroma", ...parts].join("/");
  return `/view?filename=${encodeURIComponent(filename)}` +
         `&type=input&subfolder=${encodeURIComponent(subfolder)}` +
         `&t=${Date.now()}`;
}
