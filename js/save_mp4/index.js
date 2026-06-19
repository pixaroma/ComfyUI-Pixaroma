import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/index.mjs";

// Nodes 2.0 renders its own native .image-preview panel because this node
// emits ui.images (for the Media Assets refresh, Preview Image Pattern #14).
// An mp4 isn't a valid image, so that panel shows "Image failed to load". We
// have our OWN <video> preview, so hide the native panel — scoped to THIS
// node via :has() so nothing else is affected. Legacy has no .lg-node /
// .image-preview, so this rule is a no-op there. (CLAUDE.md Nodes 2.0.)
let _mp4CssInjected = false;
function injectCSS() {
  if (_mp4CssInjected) return;
  _mp4CssInjected = true;
  const style = document.createElement("style");
  style.id = "pix-mp4-css";
  style.textContent = `.lg-node:has(.pix-mp4-root) .image-preview { display: none !important; }`;
  document.head.appendChild(style);
}

// In-node video preview for Save Mp4 Pixaroma. The Python node returns
// `{"ui": {"images": [...], "pixaroma_videos": [...]}}` after each encode;
// we listen for the `executed` event, find our entry, and swap the
// <video> element's src.
//
// Stable-size pattern (mirrors Load Image / Preview Image — NOT VHS):
//   - The node does NOT resize when a clip loads. The <video> FIT-CONTAINS
//     the clip (object-fit:contain), so a portrait/landscape clip
//     letterboxes instead of growing the node over the user's other nodes.
//   - The preview-area height is a STORED per-node value (node.properties),
//     never derived from node.size. computeSize returns that stored value,
//     so it can NEVER feed back and grow the node. (The bug an earlier
//     "node.size minus estimated chrome" fill caused: the chrome estimate
//     was smaller than the real chrome, so each layout pass made the node's
//     minimum a few px TALLER than itself -> it ballooned and the preview
//     spilled past the bottom. A stored constant can't feed back.)
//   - Legacy: the user drag-resizes the node; onResize maps the dragged
//     height into the stored preview height (draggedH - chrome, chrome
//     captured once from a settled frame) so the video fills the body with
//     no feedback loop. Nodes 2.0: the flex computeLayoutSize fills the body.
//   - No setSize-on-load and no aspect dependency, so loading a clip never
//     changes node.size.

const MIN_W = 320;
// Floor for the preview area (legacy computeSize + Nodes 2.0
// computeLayoutSize + getMinHeight all use it).
const PREVIEW_MIN_H = 180;
// Default preview-area height for a fresh node. Stored per-node on
// node.properties[PREVIEW_PROP] and adjusted when the user drag-resizes.
const DEFAULT_PREVIEW_H = 240;
// Fresh-node default node height (LiteGraph re-settles it to chrome +
// preview via computeSize). Saved workflows keep their own size because
// configure() runs after onNodeCreated (Vue Compat #8).
const DEFAULT_H = 360;
// node.properties key for the persisted preview-area height.
const PREVIEW_PROP = "mp4PreviewH";

// Vue can tear down a node's DOM widget and rebuild it (e.g. when the
// user switches workflow tabs and back). The cached node._pixaromaVideo
// then points at the OLD detached element. Look up the live <video> via
// the widget element and re-cache it so subsequent runs work.
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
      injectCSS();

      // Suppress ComfyUI's native output-image preview. This node emits
      // ui.images so saved mp4s refresh the Media Assets panel (Preview
      // Image Pattern #14), but an mp4 isn't an image. In Nodes 2.0 that
      // native preview is an extra flex:1 panel that would SPLIT the node's
      // free height with our <video> widget (a gap above the video);
      // hideOutputImages makes the Vue preview-media computed early-return
      // while ui.images still fires for Assets. Legacy is unaffected (the
      // mp4 entry simply fails to load as an image and is skipped).
      this.hideOutputImages = true;

      const node = this;

      // Preview wrap: position:relative so the absolutely-filled children
      // stack inside it. flex:1 1 0 + min-height:0 make it FILL the
      // allocated row in Nodes 2.0 (Vue wraps DOM widgets in a flex column);
      // in legacy the height is pinned explicitly in computeSize below.
      const wrap = document.createElement("div");
      wrap.className = "pix-mp4-root";
      wrap.style.cssText =
        "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;border-radius:4px;overflow:hidden;";

      // object-fit:contain = fill the wrap, never distort. absolute inset:0
      // so the wrap's (pinned/flex) height is the box the clip fits into.
      const video = document.createElement("video");
      video.controls = true;
      video.loop = true;
      video.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;border-radius:4px;display:none;";
      wrap.appendChild(video);

      // Appended AFTER the video so, as equal position:absolute siblings, it
      // stacks on top. Safe because exactly one of the two is display:block at
      // a time (placeholder until the first clip loads, video thereafter).
      const placeholder = document.createElement("div");
      placeholder.textContent = "(no video yet — run the workflow)";
      placeholder.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;text-align:center;padding:16px;box-sizing:border-box;background:#1a1a1a;border-radius:4px;";
      wrap.appendChild(placeholder);

      this._pixaromaVideo = video;
      this._pixaromaPlaceholder = placeholder;

      const widget = this.addDOMWidget(
        "pixaroma_video_preview",
        "video_preview",
        wrap,
        { serialize: false, hideOnZoom: false, getMinHeight: () => PREVIEW_MIN_H }
      );
      // canvasOnly set adaptively: true in legacy (out of Parameters tab),
      // false in Nodes 2.0 so the <video> renders in the Vue body.
      applyAdaptiveCanvasOnly(widget);

      // computeSize returns the STORED preview height (never a value derived
      // from node.size), so it can't feed back and grow the node. See the
      // header comment for the growth bug this replaced.
      widget.computeSize = function (width) {
        const ph = Math.max(
          PREVIEW_MIN_H,
          node.properties?.[PREVIEW_PROP] ?? DEFAULT_PREVIEW_H
        );
        this.computedHeight = ph;
        // Legacy: pin the element height (absolute children would otherwise
        // collapse the wrap to 0). Nodes 2.0: clear any pin so the flex fill
        // (computeLayoutSize) governs — this also un-sticks a height left over
        // from a live Legacy->Nodes 2.0 renderer toggle.
        if (isVueNodes()) wrap.style.height = "";
        else wrap.style.height = ph + "px";
        return [width, ph];
      };

      // Nodes 2.0: become the node's sole auto-grow row so the preview fills
      // the body (the native widgets above are min-content rows). minWidth:1
      // so the saved node width round-trips (Compare gotcha 2).
      widget.computeLayoutSize = () => ({ minHeight: PREVIEW_MIN_H, minWidth: 1 });

      // Capture the node "chrome" (height of everything above the preview)
      // ONCE from a settled frame: chrome = node.size[1] - preview height.
      // Used only to map a drag-resize back into the stored preview height.
      // Retried via rAF so it runs after the first layout has set node.size
      // and the widget's computedHeight. Legacy only (Nodes 2.0 fills via the
      // flex computeLayoutSize and doesn't need this).
      let chromeTries = 0;
      const captureChrome = () => {
        if (node._mp4Chrome != null || isVueNodes()) return;
        // Derive chrome from the SAME ph that computeSize contributes, NOT
        // widget.computedHeight (LiteGraph's arrange path can set the latter
        // to ph + 4, which would shave 4px off the captured chrome).
        const ph = Math.max(
          PREVIEW_MIN_H,
          node.properties?.[PREVIEW_PROP] ?? DEFAULT_PREVIEW_H
        );
        const ch = (node.size?.[1] || 0) - ph;
        if (ch > 0) node._mp4Chrome = ch;
        else if (chromeTries++ < 20) requestAnimationFrame(captureChrome);
      };
      requestAnimationFrame(captureChrome);

      // Legacy drag-resize: map the dragged node height into the STORED
      // preview height (absolute: draggedH - chrome). No node.size feedback
      // loop, no floor glitch. Diff-write so a configure-time call with the
      // restored size can't dirty the workflow on load. Nodes 2.0 resizes via
      // the flex computeLayoutSize, so skip there.
      const protoResize = nodeType.prototype.onResize;
      this.onResize = function (size) {
        protoResize?.apply(this, arguments);
        if (isVueNodes() || this._mp4Chrome == null) return;
        const ph = Math.max(PREVIEW_MIN_H, Math.round(size[1] - this._mp4Chrome));
        if (!this.properties) this.properties = {};
        if (this.properties[PREVIEW_PROP] !== ph) this.properties[PREVIEW_PROP] = ph;
      };

      // Fresh-node default. LiteGraph already set node.size to computeSize()
      // (= chrome + preview height) before onNodeCreated ran, so only enforce
      // the WIDTH floor here — do NOT reset the height. Resetting it would
      // override the computeSize-settled height and could make the preview
      // spill below the node (the height is governed by computeSize alone).
      // The !this.size branch is purely defensive (LiteGraph always sets it).
      if (!this.size) this.size = [MIN_W, DEFAULT_H];
      else if (this.size[0] < MIN_W) this.size[0] = MIN_W;

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
