import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// In-node video preview for Save Mp4 Pixaroma. The Python node returns
// `{"ui": {"images": [...], "pixaroma_videos": [...]}}` after each encode;
// we listen for the `executed` event, find our entry, and swap the
// <video> element's src.

const MIN_W = 320;
const MIN_H = 360;
const PLACEHOLDER_H = 180;

// Vue can tear down a node's DOM widget and rebuild it (e.g. when the
// user switches workflow tabs and back). The cached node._pixaromaVideo
// then points at the OLD detached element. Look up the live <video> via
// the widget element and re-cache + re-attach the loadedmetadata
// listener so subsequent runs work.
function getLiveVideo(node) {
  if (node._pixaromaVideo?.isConnected) return node._pixaromaVideo;
  const w = node.widgets?.find((x) => x.name === "pixaroma_video_preview");
  const root = w?.element;
  if (!root || !root.isConnected) return null;
  const vid = root.querySelector("video");
  const placeholder = root.querySelector("div");
  if (!vid?.isConnected) return null;
  node._pixaromaVideo = vid;
  node._pixaromaPlaceholder = placeholder;
  // Re-attach metadata listener so the freshly-found element drives the
  // aspect-ratio resize on the next loaded video.
  if (!vid._pixaromaMetadataAttached) {
    vid.addEventListener("loadedmetadata", () => {
      if (vid.videoWidth > 0 && vid.videoHeight > 0) {
        node._pixaromaAspect = vid.videoWidth / vid.videoHeight;
        node._pixaromaEnforceAspect?.();
      }
    });
    vid._pixaromaMetadataAttached = true;
  }
  return vid;
}

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

      const node = this;

      // Snap node height so the widget area is exactly width / aspect.
      // Called from: loadedmetadata (initial), and ResizeObserver below
      // (catches user drags + any other Vue-frontend layout change).
      // rAF-debounced so RO -> setSize -> RO doesn't loop.
      let aspectRafId = null;
      const enforceAspect = () => {
        if (aspectRafId !== null) return;
        aspectRafId = requestAnimationFrame(() => {
          aspectRafId = null;
          const aspect = node._pixaromaAspect;
          if (!aspect) return;
          if (typeof node.computeSize !== "function") return;
          const desired = node.computeSize();
          if (!desired || !desired[1]) return;
          const targetH = Math.max(MIN_H, desired[1]);
          const targetW = Math.max(MIN_W, node.size?.[0] || MIN_W);
          if (
            Math.abs((node.size?.[1] || 0) - targetH) > 1 ||
            Math.abs((node.size?.[0] || 0) - targetW) > 1
          ) {
            node.setSize([targetW, targetH]);
            node.setDirtyCanvas?.(true, true);
          }
        });
      };
      node._pixaromaEnforceAspect = enforceAspect;

      video.addEventListener("loadedmetadata", () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          node._pixaromaAspect = video.videoWidth / video.videoHeight;
          enforceAspect();
        }
      });
      video._pixaromaMetadataAttached = true;

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

      // Watch the wrap for any size change (Vue resize, manual drag, layout
      // shift) and re-snap the node height. ResizeObserver is the only
      // mechanism that fires for ALL Vue-frontend resize paths — onResize
      // hooks miss some of them.
      try {
        const ro = new ResizeObserver(enforceAspect);
        ro.observe(wrap);
        node._pixaromaResizeObserver = ro;
      } catch (_) { /* old browser, fall through */ }

      const onRemoved = this.onRemoved;
      this.onRemoved = function () {
        try { node._pixaromaResizeObserver?.disconnect(); } catch (_) {}
        return onRemoved?.apply(this, arguments);
      };

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
  if (!node) return;
  // Vue may have torn down the original <video> + placeholder; getLiveVideo
  // re-finds the live elements from the widget and re-attaches the
  // metadata listener so subsequent runs work correctly.
  const video = getLiveVideo(node);
  if (!video) return;
  const url = buildViewUrl(entries[0]);
  video.src = url;
  video.style.display = "block";
  if (node._pixaromaPlaceholder?.isConnected) {
    node._pixaromaPlaceholder.style.display = "none";
  }
  video.load();
});
