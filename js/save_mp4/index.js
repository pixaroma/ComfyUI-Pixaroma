import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// In-node video preview for Save Mp4 Pixaroma. The Python node returns
// `{"ui": {"images": [...], "pixaroma_videos": [...]}}` after each encode;
// we listen for the `executed` event, find our entry, and swap the
// <video> element's src.

const MIN_W = 320;
const MIN_H = 360;
const PLACEHOLDER_H = 180;

function buildViewUrl(entry) {
  const params = new URLSearchParams({
    filename: entry.filename,
    subfolder: entry.subfolder || "",
    type: entry.type || "output",
    // Cache-bust so the browser doesn't reuse a stale file when the
    // counter happens to land on the same name.
    t: String(Date.now()),
  });
  return `/view?${params.toString()}`;
}

app.registerExtension({
  name: "Pixaroma.SaveMp4",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaSaveMp4") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const ret = onNodeCreated?.apply(this, arguments);

      // Wrapper that holds the video element + placeholder. The widget's
      // actual height is driven by computeSize (below) which returns the
      // exact pixel height needed for the loaded video's aspect ratio at
      // the current node width — so the player fits with no black bars.
      const wrap = document.createElement("div");
      wrap.style.cssText = `
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #000;
        border-radius: 4px;
        overflow: hidden;
        min-height: ${PLACEHOLDER_H}px;
      `;

      const video = document.createElement("video");
      video.controls = true;
      video.loop = true;  // auto-loop so the user can preview without re-clicking
      video.style.cssText = `
        display: none;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #000;
      `;
      wrap.appendChild(video);

      const placeholder = document.createElement("div");
      placeholder.textContent = "(no video yet — run the workflow)";
      placeholder.style.cssText = `
        color: #888;
        font-size: 12px;
        padding: 16px;
        text-align: center;
      `;
      wrap.appendChild(placeholder);

      this._pixaromaVideo = video;
      this._pixaromaPlaceholder = placeholder;
      this._pixaromaAspect = null;  // set when video metadata loads

      // When metadata arrives, capture aspect ratio and ask ComfyUI to
      // re-size the node so the widget area matches the video exactly.
      const node = this;
      video.addEventListener("loadedmetadata", () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          node._pixaromaAspect = video.videoWidth / video.videoHeight;
          // Force layout recompute. computeSize() will pick up the new
          // aspect via the widget's computeSize callback below.
          if (typeof node.computeSize === "function") {
            const sz = node.computeSize();
            node.setSize([Math.max(sz[0], MIN_W), Math.max(sz[1], MIN_H)]);
          }
          node.setDirtyCanvas?.(true, true);
        }
      });

      this.addDOMWidget("pixaroma_video_preview", "video_preview", wrap, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => PLACEHOLDER_H,
        // Drive the widget's own height from the video aspect ratio so the
        // player fills it exactly (no letterbox bars).
        computeSize: function (width) {
          const aspect = node._pixaromaAspect;
          if (!aspect || width <= 0) return [width, PLACEHOLDER_H];
          const h = Math.max(PLACEHOLDER_H, Math.round(width / aspect));
          return [width, h];
        },
      });

      const w = (this.size && this.size[0]) || MIN_W;
      const h = (this.size && this.size[1]) || MIN_H;
      this.size = [Math.max(w, MIN_W), Math.max(h, MIN_H)];

      return ret;
    };
  },
});

api.addEventListener("executed", ({ detail }) => {
  const entries = detail?.output?.pixaroma_videos;
  if (!entries || !entries.length) return;
  // Node id may be string or number depending on Comfy version.
  let node = app.graph.getNodeById(detail.node);
  if (!node && typeof detail.node === "string") {
    node = app.graph.getNodeById(parseInt(detail.node, 10));
  }
  // CLAUDE.md Vue compat note 5: Vue can tear down a node's DOM widget while
  // we still hold a stale element reference. Skip if the cached <video> isn't
  // actually in the live DOM — its .src write would otherwise be a no-op
  // network fetch into a detached element.
  if (!node || !node._pixaromaVideo || !node._pixaromaVideo.isConnected) return;
  const url = buildViewUrl(entries[0]);
  node._pixaromaVideo.src = url;
  node._pixaromaVideo.style.display = "block";
  node._pixaromaPlaceholder.style.display = "none";
  node._pixaromaVideo.load();
});
