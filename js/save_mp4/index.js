import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// In-node video preview for Save Mp4 Pixaroma. The Python node returns
// `{"ui": {"images": [...], "pixaroma_videos": [...]}}` after each encode;
// we listen for the `executed` event, find our entry, and swap the
// <video> element's src.
//
// Aspect-locking pattern (mirrors VHS_VideoCombine — the only thing the
// Vue frontend honors):
//   - The <video> has `width: 100%` and NO height / NO object-fit. Its
//     intrinsic ratio drives its rendered height, so the wrap div ends up
//     exactly the video's bounding box — no letterbox space ever exists.
//   - The widget's `computeSize` callback writes `this.computedHeight`
//     synchronously. Vue reads `widget.computedHeight` directly during
//     layout (it does NOT call computeSize again), so this is the only
//     value that actually affects the rendered widget area height.
//   - `fitHeight(node)` calls `node.setSize` once on metadata-load and
//     once per user resize, which forces LiteGraph to refresh
//     computedHeight from computeSize and Vue to re-layout.
//   - No ResizeObserver: that produced a feedback loop with the user's
//     drag and made the player flicker.

const MIN_W = 320;
const PLACEHOLDER_H = 180;
// ComfyUI's modern Vue frontend renders DOM widgets nearly edge-to-edge.
// 20 was overshooting → the height we computed for a SMALLER assumed
// width was also smaller than the real video render height, and the
// wrap's overflow:hidden clipped a few pixels off the bottom.
const WIDGET_PAD = 4;
// Small buffer added to the computed height so floating-point rounding
// + sub-pixel layout differences never under-allocate. Cheap insurance
// against the same clipping bug recurring; visually a couple pixels of
// dark strip below the video in worst case.
const HEIGHT_BUFFER = 4;

function fitHeight(node) {
  if (!node || typeof node.computeSize !== "function") return;
  const desired = node.computeSize([node.size[0], node.size[1]]);
  node.setSize([node.size[0], desired[1]]);
  node.graph?.setDirtyCanvas(true, true);
}

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
  if (!vid._pixaromaMetadataAttached) {
    vid.addEventListener("loadedmetadata", () => {
      if (vid.videoWidth > 0 && vid.videoHeight > 0) {
        node._pixaromaAspect = vid.videoWidth / vid.videoHeight;
        fitHeight(node);
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

      // Wrap sizes itself to its child <video>'s intrinsic dimensions —
      // no fixed height, no background (so there's no surface to
      // letterbox into).
      const wrap = document.createElement("div");
      wrap.style.cssText = `
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        border-radius: 4px;
        overflow: hidden;
      `;

      // CRITICAL: width-only, no height, no object-fit. Lets the video's
      // intrinsic aspect drive its rendered height.
      const video = document.createElement("video");
      video.controls = true;
      video.loop = true;
      video.style.cssText = `
        display: none;
        width: 100%;
        background: #000;
        border-radius: 4px;
      `;
      wrap.appendChild(video);

      const placeholder = document.createElement("div");
      placeholder.textContent = "(no video yet — run the workflow)";
      placeholder.style.cssText = `
        color: #888;
        font-size: 12px;
        padding: 16px;
        text-align: center;
        width: 100%;
        min-height: ${PLACEHOLDER_H}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        border-radius: 4px;
      `;
      wrap.appendChild(placeholder);

      this._pixaromaVideo = video;
      this._pixaromaPlaceholder = placeholder;
      this._pixaromaAspect = null;

      const node = this;

      video.addEventListener("loadedmetadata", () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          node._pixaromaAspect = video.videoWidth / video.videoHeight;
          fitHeight(node);
        }
      });
      video._pixaromaMetadataAttached = true;

      const widget = this.addDOMWidget(
        "pixaroma_video_preview",
        "video_preview",
        wrap,
        { serialize: false, hideOnZoom: false }
      );

      // Vue's layout loop reads `widget.computedHeight` directly, NOT the
      // return value of computeSize. We must SET it here every time the
      // callback fires, and return [w, h] for legacy LiteGraph paths too.
      widget.computeSize = function (width) {
        const aspect = node._pixaromaAspect;
        if (!aspect) {
          this.computedHeight = PLACEHOLDER_H;
          return [width, PLACEHOLDER_H];
        }
        const w = Math.max(0, (node.size?.[0] || width) - WIDGET_PAD);
        // ceil + buffer so we never under-allocate. If the computed area
        // ends up slightly taller than the video, the wrap shows a thin
        // dark strip below — strictly better than clipping the bottom.
        const h = Math.max(PLACEHOLDER_H, Math.ceil(w / aspect) + HEIGHT_BUFFER);
        this.computedHeight = h;
        return [width, h];
      };

      // After a user drag, re-derive height from the new width so the
      // node stays aspect-locked. No flicker because this fires only on
      // commit (not on every animation frame like ResizeObserver did).
      const origResize = nodeType.prototype.onResize;
      const onResize = function (size) {
        if (origResize) origResize.apply(this, arguments);
        if (this._pixaromaAspect) {
          const desired = this.computeSize([size[0], size[1]]);
          size[1] = desired[1];
        }
      };
      // Patch on the instance (not prototype) so subsequent
      // beforeRegisterNodeDef calls don't double-wrap.
      this.onResize = onResize;

      if (!this.size || this.size[0] < MIN_W) {
        this.size = [MIN_W, PLACEHOLDER_H + 100];
      }

      return ret;
    };
  },
});

api.addEventListener("executed", ({ detail }) => {
  const entries = detail?.output?.pixaroma_videos;
  if (!entries || !entries.length) return;
  let node = app.graph.getNodeById(detail.node);
  if (!node && typeof detail.node === "string") {
    node = app.graph.getNodeById(parseInt(detail.node, 10));
  }
  if (!node) return;
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
