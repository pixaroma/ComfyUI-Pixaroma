import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";

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
  style.textContent = `
.lg-node:has(.pix-mp4-root) .image-preview { display: none !important; }
.pix-mp4-media { position:relative; flex:1 1 0; min-height:0; overflow:hidden; }
.pix-mp4-bar { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:5px 8px; box-sizing:border-box; background:rgba(0,0,0,0.30); }
.pix-mp4-bar.is-disabled { opacity:0.40; pointer-events:none; }
.pix-mp4-btn { width:24px; height:24px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; padding:0; border:none; border-radius:4px; background:transparent; cursor:pointer; }
.pix-mp4-btn:hover { background:rgba(255,255,255,0.10); }
.pix-mp4-ico { width:15px; height:15px; pointer-events:none; background-color:rgba(255,255,255,0.85); -webkit-mask:var(--ico) center/contain no-repeat; mask:var(--ico) center/contain no-repeat; }
.pix-mp4-btn:hover .pix-mp4-ico { background-color:#fff; }
.pix-mp4-scrub { flex:1 1 auto; min-width:30px; height:6px; position:relative; border-radius:3px; background:rgba(255,255,255,0.16); cursor:pointer; }
.pix-mp4-scrub-fill { position:absolute; left:0; top:0; height:100%; width:0%; border-radius:3px; background:#f66744; pointer-events:none; }
.pix-mp4-scrub-handle { position:absolute; top:50%; left:0%; width:11px; height:11px; border-radius:50%; background:#fff; transform:translate(-50%,-50%); pointer-events:none; box-shadow:0 0 2px rgba(0,0,0,0.6); }
.pix-mp4-time { flex:0 0 auto; font:11px monospace; color:rgba(255,255,255,0.70); white-space:nowrap; user-select:none; }
`;
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
//   - The preview is a plain DOM widget with NO custom computeSize. Legacy
//     LiteGraph treats ANY widget that has a computeSize as fixed-height,
//     which both pins the node's minimum to the current height (so it can't
//     be dragged smaller) and drops it from the fill pool (so it spills) —
//     that was the bug. Instead: getMinHeight gives a small constant floor
//     (so the node can be dragged down to chrome + floor), and NO
//     getMaxHeight lets the widget absorb all free vertical space (so it
//     FILLS the body, no spill). The framework sizes the element each frame;
//     the <video> object-fit:contains inside it.
//   - One mechanism drives BOTH renderers (legacy distributeSpace + the Vue
//     computeLayoutSize flex row), so there is no per-renderer branch.
//   - The node size is the user's drag, serialized natively by LiteGraph;
//     loading a clip never changes it.

const MIN_W = 320;
// Smallest the preview area can be dragged to. Drives the DOM widget's
// getMinHeight + computeLayoutSize, which is what the node's minimum height
// sums — so the node can shrink down to (chrome + this), and no further.
const PREVIEW_MIN_H = 180;
// Fresh-node default node height (a comfortable starting preview). Saved
// workflows keep their own size because configure() runs after onNodeCreated
// (Vue Compat #8).
const DEFAULT_H = 420;
// Shared mask-image icon set (borrowed from AudioReact's transport bar).
const UI_ICON = "/pixaroma/assets/icons/ui/";

// Vue can tear down a node's DOM widget and rebuild it (e.g. when the
// user switches workflow tabs and back). The cached node._pixaromaVideo
// then points at the OLD detached element. Look up the live <video> via
// the widget element and re-cache it (+ the placeholder and the control-bar
// elements) so subsequent runs and bar updates work.
function getLiveVideo(node) {
  if (node._pixaromaVideo?.isConnected) return node._pixaromaVideo;
  const w = node.widgets?.find((x) => x.name === "pixaroma_video_preview");
  const root = w?.element;
  if (!root || !root.isConnected) return null;
  const vid = root.querySelector("video");
  if (!vid?.isConnected) return null;
  node._pixaromaVideo = vid;
  node._pixaromaPlaceholder = root.querySelector(".pix-mp4-placeholder");
  node._pixMp4Bar = root.querySelector(".pix-mp4-bar");
  node._pixMp4PlayIco = root.querySelector(".pix-mp4-btn .pix-mp4-ico");
  node._pixMp4Fill = root.querySelector(".pix-mp4-scrub-fill");
  node._pixMp4Handle = root.querySelector(".pix-mp4-scrub-handle");
  node._pixMp4Time = root.querySelector(".pix-mp4-time");
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

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Sync the custom control bar to the <video>'s current state: enabled/grayed,
// play vs pause icon, scrub fill + handle, and the "cur / total" time text.
// Called from the video's own events and from the executed handler. Cheap +
// idempotent, so wiring it to timeupdate is fine.
function refreshBar(node) {
  const v = node._pixaromaVideo;
  const bar = node._pixMp4Bar;
  if (!v || !bar) return;
  const hasSrc = !!v.src;
  bar.classList.toggle("is-disabled", !hasSrc);
  const playing = hasSrc && !v.paused && !v.ended;
  node._pixMp4PlayIco?.style.setProperty(
    "--ico",
    `url(${UI_ICON}${playing ? "pause" : "play"}.svg)`
  );
  const dur = isFinite(v.duration) ? v.duration : 0;
  const cur = isFinite(v.currentTime) ? v.currentTime : 0;
  const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
  const pct = (ratio * 100).toFixed(2) + "%";
  if (node._pixMp4Fill) node._pixMp4Fill.style.width = pct;
  if (node._pixMp4Handle) node._pixMp4Handle.style.left = pct;
  if (node._pixMp4Time) node._pixMp4Time.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
}

// Apply a rendered-video entry to the <video>: set src, show it, hide the
// placeholder, sync the bar, and kick a re-fit (the flex column can be left
// collapsed by a tab-switch rebuild or a collapse/expand — display was toggled
// without a re-layout). Returns false if the <video> isn't mounted yet.
function applyVideoEntry(node, entry) {
  const video = getLiveVideo(node);
  if (!video || !entry || !entry.filename) return false;
  node._pixMp4Name = entry.filename.split("/").pop();
  video.src = buildViewUrl(entry);
  video.style.display = "block";
  if (node._pixaromaPlaceholder?.isConnected) node._pixaromaPlaceholder.style.display = "none";
  video.load();
  refreshBar(node);
  requestAnimationFrame(() => { try { window.dispatchEvent(new Event("resize")); } catch (_e) {} });
  return true;
}

// Restore the preview after a Vue rebuild (workflow-tab switch). The last
// rendered clip is persisted on node.properties (a runtime node._xxx field is
// torn down by the tab switch; node.properties is serialized + restored —
// Preview Image Pattern #4). On a fresh add / tab-switch restore the <video>
// isn't mounted yet when onNodeCreated/onConfigure run, so retry on animation
// frames until it exists, then apply (or just re-fit if nothing was rendered).
function restorePreview(node, tries = 0) {
  if (tries === 0) {
    if (node._pixMp4Restoring) return; // serialise the onNodeCreated + onConfigure kicks
    node._pixMp4Restoring = true;
  }
  if (getLiveVideo(node)) {
    node._pixMp4Restoring = false;
    const entry = node.properties?.pixMp4Video;
    if (entry && entry.filename) {
      applyVideoEntry(node, entry);
    } else {
      // No prior render — re-fit so the placeholder lays out correctly (and,
      // with .pix-mp4-media overflow:hidden, can't overflow onto the bar).
      requestAnimationFrame(() => { try { window.dispatchEvent(new Event("resize")); } catch (_e) {} });
    }
    return;
  }
  if (tries >= 60) { node._pixMp4Restoring = false; return; } // ~1s, then give up
  requestAnimationFrame(() => restorePreview(node, tries + 1));
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

      // Preview wrap: a flex COLUMN — the media area fills the top, the custom
      // control bar is pinned at the bottom. flex:1 1 0 + min-height:0 fill the
      // allocated row in Nodes 2.0; in legacy the framework sets this element's
      // height each frame to the distributeSpace-allocated (filled) height.
      const wrap = document.createElement("div");
      wrap.className = "pix-mp4-root";
      wrap.style.cssText =
        "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;border-radius:4px;overflow:hidden;display:flex;flex-direction:column;";

      // Media area (flex:1) holds the <video> + placeholder, both absolute
      // inset:0 so exactly one shows at a time. object-fit:contain so a
      // portrait/landscape clip letterboxes instead of distorting.
      const media = document.createElement("div");
      media.className = "pix-mp4-media";
      wrap.appendChild(media);

      const video = document.createElement("video");
      video.loop = true; // NOTE: no `controls` — we draw our own bar below
      video.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none;";
      media.appendChild(video);

      // Appended AFTER the video so, as equal position:absolute siblings, it
      // stacks on top. Safe because exactly one of the two is display:block at
      // a time (placeholder until the first clip loads, video thereafter).
      const placeholder = document.createElement("div");
      placeholder.className = "pix-mp4-placeholder";
      placeholder.textContent = "(no video yet — run the workflow)";
      placeholder.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;text-align:center;padding:16px;box-sizing:border-box;background:#1a1a1a;";
      media.appendChild(placeholder);

      // Custom control bar UNDER the video, ALWAYS visible (grayed via
      // .is-disabled when there's nothing to play). Replaces the native
      // <video controls> overlay, which can't be moved below the picture.
      // Order: play | time | scrub (fills) | fullscreen.
      const bar = document.createElement("div");
      bar.className = "pix-mp4-bar is-disabled";
      // Swallow mouse/pointer-down so interacting with the bar never starts a
      // node drag (both events, matching the Prompt Stack pattern — the legacy
      // canvas drags on mouse, Nodes 2.0 on pointer).
      bar.addEventListener("mousedown", (e) => e.stopPropagation());
      bar.addEventListener("pointerdown", (e) => e.stopPropagation());

      const playBtn = document.createElement("button");
      playBtn.className = "pix-mp4-btn";
      playBtn.title = "Play / Pause";
      const playIco = document.createElement("span");
      playIco.className = "pix-mp4-ico";
      playIco.style.setProperty("--ico", `url(${UI_ICON}play.svg)`);
      playBtn.appendChild(playIco);
      bar.appendChild(playBtn);

      const timeEl = document.createElement("span");
      timeEl.className = "pix-mp4-time";
      timeEl.textContent = "0:00 / 0:00";
      bar.appendChild(timeEl);

      const scrub = document.createElement("div");
      scrub.className = "pix-mp4-scrub";
      const fill = document.createElement("div");
      fill.className = "pix-mp4-scrub-fill";
      scrub.appendChild(fill);
      const handle = document.createElement("div");
      handle.className = "pix-mp4-scrub-handle";
      scrub.appendChild(handle);
      bar.appendChild(scrub);

      const dlBtn = document.createElement("button");
      dlBtn.className = "pix-mp4-btn";
      dlBtn.title = "Download .mp4";
      const dlIco = document.createElement("span");
      dlIco.className = "pix-mp4-ico";
      dlIco.style.setProperty("--ico", `url(${UI_ICON}download.svg)`);
      dlBtn.appendChild(dlIco);
      bar.appendChild(dlBtn);

      const fsBtn = document.createElement("button");
      fsBtn.className = "pix-mp4-btn";
      fsBtn.title = "Fullscreen";
      const fsIco = document.createElement("span");
      fsIco.className = "pix-mp4-ico";
      fsIco.style.setProperty("--ico", `url(${UI_ICON}fit.svg)`);
      fsBtn.appendChild(fsIco);
      bar.appendChild(fsBtn);

      wrap.appendChild(bar);

      this._pixaromaVideo = video;
      this._pixaromaPlaceholder = placeholder;
      this._pixMp4Bar = bar;
      this._pixMp4PlayIco = playIco;
      this._pixMp4Fill = fill;
      this._pixMp4Handle = handle;
      this._pixMp4Time = timeEl;

      // Play / pause.
      playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!video.src) return;
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      });
      // Click anywhere on the picture to play / pause too (like a video player).
      media.addEventListener("click", (e) => {
        if (!video.src) return;
        e.stopPropagation();
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      });
      // Fullscreen (native; falls back to the webkit prefix on old Safari).
      fsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!video.src) return;
        (video.requestFullscreen || video.webkitRequestFullscreen)?.call(video);
      });
      // Download the current clip to the user's computer. The /view URL is
      // same-origin, so an <a download> forces a save with the real filename
      // regardless of the server's Content-Disposition (no blob fetch needed).
      dlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!video.src) return;
        const a = document.createElement("a");
        a.href = video.src;
        a.download = node._pixMp4Name || "video.mp4";
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
      // Keep the bar in sync with playback.
      ["play", "pause", "ended", "timeupdate", "loadedmetadata", "durationchange"].forEach(
        (ev) => video.addEventListener(ev, () => refreshBar(node))
      );

      // Scrub: click/drag to seek. Global mousemove/mouseup capture so a drag
      // that releases outside the track still ends cleanly. Listeners are
      // stashed on the node so onRemoved can detach them (no window leak).
      let dragging = false;
      const seekFrom = (ev) => {
        if (!video.src) return;
        const rect = scrub.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const dur = isFinite(video.duration) ? video.duration : 0;
        if (dur > 0) {
          video.currentTime = ratio * dur;
          refreshBar(node);
        }
      };
      scrub.addEventListener("mousedown", (e) => {
        dragging = true;
        seekFrom(e);
        e.preventDefault();
        e.stopPropagation();
      });
      const onMove = (e) => { if (dragging) seekFrom(e); };
      const onUp = () => { dragging = false; };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      this._pixMp4ScrubMove = onMove;
      this._pixMp4ScrubUp = onUp;

      // Detach the window scrub listeners when the node is removed (instance
      // patch so re-registration can't double-wrap).
      const protoRemoved = nodeType.prototype.onRemoved;
      this.onRemoved = function () {
        if (this._pixMp4ScrubMove) window.removeEventListener("mousemove", this._pixMp4ScrubMove);
        if (this._pixMp4ScrubUp) window.removeEventListener("mouseup", this._pixMp4ScrubUp);
        this._pixMp4ScrubMove = this._pixMp4ScrubUp = null;
        return protoRemoved?.apply(this, arguments);
      };

      refreshBar(node); // initial grayed state

      const widget = this.addDOMWidget(
        "pixaroma_video_preview",
        "video_preview",
        wrap,
        { serialize: false, hideOnZoom: false, getMinHeight: () => PREVIEW_MIN_H }
      );
      // canvasOnly set adaptively: true in legacy (out of Parameters tab),
      // false in Nodes 2.0 so the <video> renders in the Vue body.
      applyAdaptiveCanvasOnly(widget);

      // NO custom computeSize on purpose (see header). The node's minimum
      // height sums this widget's computeLayoutSize().minHeight, so the floor
      // is PREVIEW_MIN_H and the node can be dragged smaller down to it; with
      // NO maxHeight the widget absorbs all free vertical space and fills the
      // body. This one method drives both the legacy distributeSpace path and
      // the Nodes 2.0 flex row. minWidth:1 so the saved node width round-trips
      // (Compare gotcha 2).
      widget.computeLayoutSize = () => ({ minHeight: PREVIEW_MIN_H, minWidth: 1 });

      // Fresh-node defaults (width floor + a comfortable starting height).
      // These run for a SAVED node too, but configure() restores the saved
      // size right after onNodeCreated (Vue Compat #8), so saved sizes win and
      // this never dirties a loaded workflow. The node can still be dragged
      // smaller afterwards (down to chrome + PREVIEW_MIN_H).
      if (!this.size) this.size = [MIN_W, DEFAULT_H];
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;

      // Restore a previously-rendered clip after a Vue rebuild (workflow-tab
      // switch). queueMicrotask defers past configure() (Vue Compat #8) so
      // node.properties.pixMp4Video is in place by the time we read it.
      queueMicrotask(() => restorePreview(node));

      return ret;
    };

    // Belt-and-braces restore for the workflow-load / tab-switch path.
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      const node = this;
      queueMicrotask(() => restorePreview(node));
      return r;
    };

    // Collapsing hides the DOM widget; on expand the flex column needs a
    // re-layout or the media can be left collapsed (placeholder overflowing the
    // control bar). If the widget was rebuilt empty (Nodes 2.0), re-apply the
    // persisted clip; otherwise just kick a re-fit. Harmless when collapsing.
    const onCollapseProto = nodeType.prototype.onCollapse;
    nodeType.prototype.onCollapse = function () {
      const r = onCollapseProto?.apply(this, arguments);
      const node = this;
      requestAnimationFrame(() => {
        const v = getLiveVideo(node);
        if (!v) return;
        if (!v.src && node.properties?.pixMp4Video?.filename) {
          applyVideoEntry(node, node.properties.pixMp4Video);
        } else {
          try { window.dispatchEvent(new Event("resize")); } catch (_e) {}
        }
      });
      return r;
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
  const entry = entries[0];
  // Persist the rendered clip so the preview survives a workflow-tab switch /
  // collapse-expand: Vue tears down the node + any node._xxx field, but
  // node.properties is serialized and restored (Preview Image Pattern #4).
  // Store just what buildViewUrl needs.
  node.properties = node.properties || {};
  node.properties.pixMp4Video = {
    filename: entry.filename,
    subfolder: entry.subfolder || "",
    type: entry.type || "output",
  };
  // Show it now (its own loadedmetadata / timeupdate events drive the bar from
  // here). applyVideoEntry sets the Download basename + kicks the re-fit.
  applyVideoEntry(node, entry);
});
