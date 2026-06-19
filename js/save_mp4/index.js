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
//   - The node does NOT resize when a clip loads. The <video> FILLS
//     whatever vertical space the node body gives it and FIT-CONTAINS the
//     clip (object-fit:contain), so a portrait/landscape clip letterboxes
//     instead of growing the node over the user's other nodes.
//   - The preview is the node's sole auto-grow widget: in Nodes 2.0 via
//     computeLayoutSize (flex fill); in legacy via computeSize returning
//     "fill from the widget's top to the node bottom" + pinning the
//     element height. Either way the height is INDEPENDENT of the clip's
//     aspect, so loading a video never changes node.size.
//   - The user resizes the preview by dragging the node; there is no
//     setSize-on-load (that was the auto-grow the node used to do).

const MIN_W = 320;
// Floor for the preview area (legacy computeSize + Nodes 2.0
// computeLayoutSize + getMinHeight all use it).
const PREVIEW_MIN_H = 180;
// Fresh-node default height. Saved workflows keep their own size because
// configure() runs after onNodeCreated (Vue Compat #8).
const DEFAULT_H = 360;
// Small gap kept below the preview down to the node's bottom edge (legacy
// fill math), so the <video> doesn't touch the very bottom border.
const WIDGET_BOTTOM_PAD = 6;
// First-frame fallback for the widget's top, used only before the initial
// draw populates widget.last_y. Roughly: title + 4 native widgets + the 2
// input slots. Once last_y is set, the real value is used instead.
const ESTIMATED_CHROME = 170;

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

      // Legacy fill: from the widget's top (last_y) down to the node bottom,
      // floored at PREVIEW_MIN_H. INDEPENDENT of the clip aspect, so loading
      // a video never changes node height. Pin the element height so the
      // absolute <video> gets a real box (legacy DOM widgets otherwise size
      // to content, and absolute children would collapse the wrap to 0).
      // Nodes 2.0 ignores computeSize for layout (it uses computeLayoutSize
      // + flex), so don't pin there.
      widget.computeSize = function (width) {
        const top = (typeof this.last_y === "number" && this.last_y > 0)
          ? this.last_y
          : ESTIMATED_CHROME;
        const nodeH = node.size?.[1] || (ESTIMATED_CHROME + PREVIEW_MIN_H);
        const h = Math.max(PREVIEW_MIN_H, nodeH - top - WIDGET_BOTTOM_PAD);
        this.computedHeight = h;
        // Legacy: pin the element height (absolute children would otherwise
        // collapse the wrap to 0). Nodes 2.0: clear any pin so the flex fill
        // (computeLayoutSize) governs — this also un-sticks a height left over
        // from a live Legacy->Nodes 2.0 renderer toggle.
        if (isVueNodes()) wrap.style.height = "";
        else wrap.style.height = h + "px";
        return [width, h];
      };

      // Nodes 2.0: become the node's sole auto-grow row so the preview fills
      // the body (the native widgets above are min-content rows). minWidth:1
      // so the saved node width round-trips (Compare gotcha 2).
      widget.computeLayoutSize = () => ({ minHeight: PREVIEW_MIN_H, minWidth: 1 });

      // Fresh-node default only. Mutate indices rather than replacing the
      // array (plays nicer with Vue's reactive proxy, convention #9).
      // configure() runs AFTER onNodeCreated and restores saved-workflow
      // sizes, so this never clobbers a saved size.
      if (!this.size) this.size = [MIN_W, DEFAULT_H];
      if (this.size[0] < MIN_W) {
        this.size[0] = MIN_W;
        this.size[1] = DEFAULT_H;
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
