import { app } from "../../../scripts/app.js";
import { pixApiUrl, pixAsset } from "../shared/api_url.mjs";
import { api } from "../../../scripts/api.js";
import { applyAdaptiveCanvasOnly,
  installCanvasZoomPassthrough, installNodeAccent, registerNodeAccent,
  onRendererChange, createSlotBand, placeSlotBand, settleSlotBand, watchSlotBand,
} from "../shared/index.mjs";
import { installFilenameTokenResolver } from "../shared/filename_tokens.mjs";
import { buildVolumeControl, applyVideoVolume } from "../shared/video_volume.mjs";
import { attachVideoSnapshot } from "../shared/video_snapshot.mjs";
import { nodeSetting } from "../shared/node_settings.mjs";

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
.pix-mp4-inner { position:absolute; inset:0; display:flex; flex-direction:column; border-radius:4px; overflow:hidden; }
.pix-mp4-media { position:relative; flex:1 1 0; min-height:0; overflow:hidden; }
.pix-mp4-bar { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:5px 8px; box-sizing:border-box; background:rgba(0,0,0,0.30); }
.pix-mp4-bar.is-disabled { opacity:0.40; pointer-events:none; }
.pix-mp4-btn { width:24px; height:24px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; padding:0; border:none; border-radius:4px; background:transparent; cursor:pointer; }
.pix-mp4-btn:hover { background:rgba(255,255,255,0.10); }
.pix-mp4-ico { width:15px; height:15px; pointer-events:none; background-color:rgba(255,255,255,0.85); -webkit-mask:var(--ico) center/contain no-repeat; mask:var(--ico) center/contain no-repeat; }
.pix-mp4-btn:hover .pix-mp4-ico { background-color:#fff; }
.pix-mp4-scrub { flex:1 1 auto; min-width:30px; height:6px; position:relative; border-radius:3px; background:rgba(255,255,255,0.16); cursor:pointer; }
.pix-mp4-scrub-fill { position:absolute; left:0; top:0; height:100%; width:0%; border-radius:3px; background:var(--pix-acc,#f66744); pointer-events:none; }
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
const UI_ICON = "icons/ui/";
// The placeholder's normal text (nothing rendered yet). A constant because the
// same element doubles as the "that clip is gone" message below, so a later
// successful run has to be able to put this back.
const PLACEHOLDER_DEFAULT = "(no video yet — run the workflow)";

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
  return pixApiUrl(`/view?${params.toString()}`);
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
  // A src whose file FAILED to load is not a clip. Asking only `!!v.src` is what
  // left the bar looking live and clickable over a black rectangle when the
  // persisted clip's file had been deleted (see showClipMissing). The flag is a
  // runtime field, set by the <video>'s own error event and cleared whenever a
  // fresh load starts or succeeds, so a load that is merely still in flight is
  // never mistaken for a failed one.
  const hasClip = !!v.src && !node._pixMp4Failed;
  bar.classList.toggle("is-disabled", !hasClip);
  const playing = hasClip && !v.paused && !v.ended;
  node._pixMp4PlayIco?.style.setProperty(
    "--ico",
    `url(${pixAsset(UI_ICON + (playing ? "pause" : "play") + ".svg")})`
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
// ── the size band ───────────────────────────────────────────────────────────
// Placement, the CSS and every measurement behind them live in
// js/shared/slot_band.mjs (extracted when Load Video became the second
// consumer). This node only decides WHAT the band says and WHEN.
const BAND_OPTS = { side: "right", slot: "input", index: 0 };

function getBand(node) {
  const w = node.widgets?.find((x) => x.name === "pixaroma_video_preview");
  const root = w?.element;
  if (!root || !root.isConnected) return null;
  const band = root.querySelector(".pix-slot-band");
  return band?.isConnected ? band : null;
}

/** Fill the band from the loaded clip, or clear it with "". */
function setBandFromVideo(node) {
  const band = getBand(node);
  if (!band) return;
  const v = getLiveVideo(node) || node._pixaromaVideo;
  const w = Number(v?.videoWidth) || 0;
  const h = Number(v?.videoHeight) || 0;
  if (!w || !h) { band.textContent = ""; return; }
  // The RESOLUTION only. The length is already on the node, in the player's own
  // "0:00 / 0:15" readout a few rows down, so repeating it here just made the
  // one number people actually want smaller.
  band.textContent = `${w}x${h}`;
  settleSlotBand(node, band, BAND_OPTS);
}

function clearBand(node) {
  const band = getBand(node);
  if (band) band.textContent = "";
}

function applyVideoEntry(node, entry) {
  const video = getLiveVideo(node);
  if (!video || !entry || !entry.filename) return false;
  node._pixMp4Name = entry.filename.split("/").pop();
  node._pixMp4Failed = false; // a fresh load: not failed until its error event says so
  // Clear the old clip's size straight away: the new one's dimensions are not
  // known until its loadedmetadata fires, and showing the previous clip's
  // numbers over a loading video would be a quiet lie.
  clearBand(node);
  video.src = buildViewUrl(entry);
  video.style.display = "block";
  if (node._pixaromaPlaceholder?.isConnected) {
    // Put the normal text back — this element doubles as the "clip is gone"
    // message, and a later successful run has to clear that.
    node._pixaromaPlaceholder.textContent = PLACEHOLDER_DEFAULT;
    node._pixaromaPlaceholder.style.display = "none";
  }
  video.load();
  refreshBar(node);
  requestAnimationFrame(() => { try { window.dispatchEvent(new Event("resize")); } catch (_e) {} });
  return true;
}

// The clip's file is not on disk any more, so the <video> got a 404 and has
// nothing to show. Two routine ways that happens, and BOTH are normal use, not
// user error: save_mode=preview writes to ComfyUI's temp/, which is WIPED on
// every restart, and a save_mode=save file can be moved, renamed or deleted
// afterwards. The persisted entry (Pattern #7) still names it, so restorePreview
// happily points the player at a file that is gone.
//
// Without this the node showed a BLACK RECTANGLE with a fully-enabled control
// bar: applyVideoEntry had already hidden the placeholder, refreshBar only asked
// `!!v.src` (true), and the play button's play() rejection ("NotSupportedError:
// The element has no supported sources") was swallowed by its .catch(). Nothing
// anywhere said why. Reported as "sometimes only a black screen when I try to
// play, after switching workflows" — a workflow switch is simply when the stale
// entry gets re-applied.
//
// DISPLAY ONLY. This runs on the workflow LOAD path, so it must NEVER write
// node.properties / node.size / a widget value: clearing the persisted entry
// here would flag an untouched workflow "modified" on every open (Vue Compat
// #18). Leaving the entry in place is also what lets the message name the cause.
function showClipMissing(node) {
  node._pixMp4Failed = true;
  // No clip means no size to report. Leaving the old numbers up beside a
  // "clip is gone" message would contradict it.
  clearBand(node);
  const video = getLiveVideo(node) || node._pixaromaVideo;
  if (video) video.style.display = "none";
  const ph = node._pixaromaPlaceholder;
  if (ph?.isConnected) {
    ph.textContent =
      node.properties?.pixMp4Video?.type === "temp"
        ? "Preview clip is gone. ComfyUI clears temp/ on restart, so run again to make a new one."
        : "Clip not found. The file may have been moved, renamed or deleted. Run again to make a new one.";
    ph.style.display = "flex";
  }
  refreshBar(node); // greys the bar, so the play button no longer looks live
}

// Which entry in a node's ui payload is our clip?
//
// Prefer our own `pixaroma_videos` key, then fall back to the standard `images`
// list, which carries the SAME entry (node_save_mp4.py deliberately emits both).
// The fallback is what makes the preview survive a HOST that relays only the ui
// keys it recognises and drops custom ones: there the file saves perfectly well
// and the player just stays black, because the browser is never told the
// filename. Reported on a cloud platform, 2026-08-04. Do not "simplify" this
// back to reading only our own key.
function pickVideoEntry(output) {
  const own = output?.pixaroma_videos;
  if (own?.length) return own[0];
  const imgs = output?.images;
  if (!imgs?.length) return null;
  return (
    imgs.find(
      (e) => /^video\//.test(e?.format || "") || /\.mp4$/i.test(e?.filename || ""),
    ) || null
  );
}

// Persist the rendered clip so the preview survives a workflow-tab switch /
// collapse-expand (Vue tears down any node._xxx field; node.properties is
// serialized and restored - Preview Image Pattern #4), then show it.
// Idempotent, so it is safe for both delivery paths below to call it.
function commitVideoEntry(node, entry) {
  if (!node || !entry?.filename) return;
  node.properties = node.properties || {};
  node.properties.pixMp4Video = {
    filename: entry.filename,
    subfolder: entry.subfolder || "",
    type: entry.type || "output",
  };
  applyVideoEntry(node, entry);
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

      // Opt filename_prefix into ComfyUI's %NodeName.widget% token resolution
      // (ComfyUI only does it for its OWN save nodes). Lets the user write e.g.
      // clip_%Seed Pixaroma.seed% and get the seed baked into the mp4 filename.
      installFilenameTokenResolver(this);

      const node = this;

      // Preview wrap: a flex COLUMN — the media area fills the top, the custom
      // control bar is pinned at the bottom. flex:1 1 0 + min-height:0 fill the
      // allocated row in Nodes 2.0; in legacy the framework sets this element's
      // height each frame to the distributeSpace-allocated (filled) height.
      const wrap = document.createElement("div");
      wrap.className = "pix-mp4-root";
      // NO display:flex here — ComfyUI's DOM-widget manager sets wrap.style.display
      // itself (block to show, none to hide on collapse), which clobbers an inline
      // flex and collapses the media to 0 (verified via a live measurement: the
      // root's computed display became "block" after a rebuild/collapse, media_h 0
      // while media_grow 1). The flex column lives on an inner absolute-filled
      // layer ComfyUI never touches, so it always fills.
      // NOTE: border-radius + overflow:hidden moved to .pix-mp4-inner (see the
      // stylesheet). They have to leave the root because the size band below is
      // floated ABOVE the root, onto the slot row, and overflow:hidden here
      // clipped it away entirely. inner is inset:0 over the same box, so the
      // video's rounded clipping is unchanged.
      wrap.style.cssText =
        "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;";

      // The size readout. FIRST child of the root on purpose: if the float is
      // ever removed it degrades to a strip above the content rather than
      // sitting on top of the video (convention #39). Starts EMPTY - there is
      // no size to report until something has actually been encoded, and
      // :empty hides it so a fresh node shows nothing at all.
      const band = createSlotBand(wrap, "right");

      // Inner flex layer: position:absolute inset:0 fills the wrap regardless of
      // the wrap's display, and its display:flex column (stylesheet) survives.
      const inner = document.createElement("div");
      inner.className = "pix-mp4-inner";
      wrap.appendChild(inner);

      // Media area (flex:1) holds the <video> + placeholder, both absolute
      // inset:0 so exactly one shows at a time. object-fit:contain so a
      // portrait/landscape clip letterboxes instead of distorting.
      const media = document.createElement("div");
      media.className = "pix-mp4-media";
      inner.appendChild(media);

      const video = document.createElement("video");
      video.loop = true; // NOTE: no `controls` — we draw our own bar below
      video.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none;";
      media.appendChild(video);
      // While the clip is paused a still picture of its frame is shown and the
      // video is hidden: a video on screen, even paused, costs the GPU process
      // work on every frame the page draws, and that is taken out of a run
      // (CLAUDE.md #41). The picture sits between the video and the
      // placeholder; the media box still takes every click.
      this._pixMp4Snap = attachVideoSnapshot(video);

      // Appended AFTER the video so, as equal position:absolute siblings, it
      // stacks on top. Safe because exactly one of the two is display:block at
      // a time (placeholder until the first clip loads, video thereafter).
      const placeholder = document.createElement("div");
      placeholder.className = "pix-mp4-placeholder";
      placeholder.textContent = PLACEHOLDER_DEFAULT; // same string applyVideoEntry restores
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
      playIco.style.setProperty("--ico", `url(${pixAsset(UI_ICON + "play.svg")})`);
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
      dlIco.style.setProperty("--ico", `url(${pixAsset(UI_ICON + "download.svg")})`);
      dlBtn.appendChild(dlIco);
      bar.appendChild(dlBtn);

      // Volume, between the scrub and fullscreen. The exact same control Save
      // Video uses, and the level they share is a preference of the person, not
      // of the workflow - see js/shared/video_volume.mjs.
      const volume = buildVolumeControl(video);
      bar.appendChild(volume.group);

      const fsBtn = document.createElement("button");
      fsBtn.className = "pix-mp4-btn";
      fsBtn.title = "Fullscreen";
      const fsIco = document.createElement("span");
      fsIco.className = "pix-mp4-ico";
      fsIco.style.setProperty("--ico", `url(${pixAsset(UI_ICON + "fit.svg")})`);
      fsBtn.appendChild(fsIco);
      bar.appendChild(fsBtn);

      inner.appendChild(bar);

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
        node._pixMp4Snap?.wake(); // the video must be visible BEFORE it goes fullscreen
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
      // The file behind the clip is gone (or will not decode): say so instead of
      // leaving a dead black player with a live-looking play button. This is the
      // ONLY unambiguous signal - a load that is still in flight looks identical
      // to a failed one from the outside. See showClipMissing.
      video.addEventListener("error", () => showClipMissing(node));
      // A load that got as far as metadata succeeded, so it is not a failure any
      // more (covers a re-run after the previous clip had gone missing).
      video.addEventListener("loadedmetadata", () => {
        node._pixMp4Failed = false;
        // Re-assert the stored level on every clip, for the same reason Save
        // Video does: a Vue tab switch can replace the element under us.
        applyVideoVolume(video);
        // The only place the clip's real size is known. Reading it off the
        // media element means no Python change and no persisted state: a tab
        // switch re-applies the clip, which fires this again.
        setBandFromVideo(node);
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
      // The buttons-are-up guard. Without it a LOST mouseup (the cursor left the
      // window, a right-click's context menu ate the release, another element
      // took pointer capture) leaves `dragging` true forever, and from then on
      // every mouse move anywhere on the page seeks the clip under a bare
      // cursor - measured 0.506s -> 4.119s -> 2.054s with no button held. Same
      // guard js/align/index.js relies on. NOTE the lost-release half cannot be
      // reproduced with synthetic events, only with a real mouse, which is
      // exactly why a drag like this looks fine in testing.
      const onMove = (e) => {
        if (!(e.buttons & 1)) { dragging = false; return; }
        if (dragging) seekFrom(e);
      };
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
        this._pixMp4Snap?.dispose();
        this._pixMp4Snap = null;
        this._pixMp4RendererOff?.();
        this._pixMp4RendererOff = null;
        this._pixMp4BandRO?.();
        this._pixMp4BandRO = null;
        return protoRemoved?.apply(this, arguments);
      };

      // The band's offset differs between the renderers, and the setting flips
      // under a live node with no reload, so a one-time placement in
      // onNodeCreated does not survive it (convention #39 / the renderer-change
      // rule). Re-place on every flip; placement is DOM style only, so this can
      // never dirty a workflow.
      this._pixMp4RendererOff = onRendererChange(() => settleSlotBand(node, getBand(node), BAND_OPTS));

      // Re-place whenever the body actually changes size. Two things need this,
      // and BOTH were measured going wrong without it: on a fresh Nodes 2.0 page
      // load the first placement runs before the Vue layout has settled and
      // lands 8px off the dot, and in Classic the right-hand offset is derived
      // from node.size[0], so dragging the node wider left the band behind.
      // node.onResize is not reliable for a DOM widget (Vue Compat #13), so
      // observe the element. placeBand only writes the band's own top/right, so
      // it cannot change the root's size and cannot feed back into this.
      this._pixMp4BandRO = watchSlotBand(node, band, wrap, BAND_OPTS);

      refreshBar(node); // initial grayed state

      installCanvasZoomPassthrough(wrap);
      installNodeAccent(this, wrap);   // the face follows this node's accent colour
      const widget = this.addDOMWidget(
        "pixaroma_video_preview",
        "video_preview",
        wrap,
        { serialize: false, hideOnZoom: false, getMinHeight: () => PREVIEW_MIN_H }
      );
      // canvasOnly set adaptively: true in legacy (out of Parameters tab),
      // false in Nodes 2.0 so the <video> renders in the Vue body.
      applyAdaptiveCanvasOnly(widget);
      settleSlotBand(node, getBand(node), BAND_OPTS);  // first placement

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
      // A workflow saved BEFORE audio_fade_ms existed has one widgets_values
      // entry too few, and LiteGraph fills the gap positionally - the entry that
      // lands here is the video preview widget's persisted "" (that widget sets
      // options.serialize but not the top-level widget.serialize, so it has
      // always saved a junk empty string). Python already reads "" as "off", so
      // nothing renders wrong, but the number field on the node shows EMPTY,
      // which reads as broken. Coerce it to a real number.
      // Only fires when the value is not already numeric, so a node that has a
      // genuine value is never rewritten.
      // In a microtask, NOT inline: measured on frontend 1.49.x, the widget
      // value is still "" when this hook runs, so an inline fix silently does
      // nothing (it did, first try). By the microtask it is settled.
      queueMicrotask(() => {
        const fw = node.widgets?.find((w) => w.name === "audio_fade_ms");
        // ⚠ Test the TYPE, not Number(value). Number("") is 0, not NaN, so a
        // `!Number.isFinite(Number(v))` guard is FALSE for the empty string and
        // the fix silently never runs - which is exactly what happened first try.
        if (fw && (typeof fw.value !== "number" || !Number.isFinite(fw.value))) {
          fw.value = 0;
        }
      });
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

    // Delivery path 1 of 2: ComfyUI's STANDARD per-node result hook, called
    // with this node's ui payload. This is the path VideoHelperSuite uses, and
    // it is the one that survives a host whose frontend hands results to nodes
    // itself instead of re-broadcasting the raw "executed" socket event. Kept
    // ALONGSIDE the global listener below rather than replacing it, because a
    // given host may deliver through either; commitVideoEntry is idempotent, so
    // being called twice just re-applies the same clip.
    const onExecutedProto = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      const r = onExecutedProto?.apply(this, arguments);
      const entry = pickVideoEntry(output);
      if (entry) commitVideoEntry(this, entry);
      return r;
    };
  },
});

// Delivery path 2 of 2: the raw execution event. This is what shipped
// originally and is what fires on a normal local install.
api.addEventListener("executed", ({ detail }) => {
  let node = app.graph.getNodeById(detail?.node);
  if (!node && typeof detail?.node === "string") {
    node = app.graph.getNodeById(parseInt(detail.node, 10));
  }
  // Resolve the node BEFORE picking an entry, and require it to be ours: the
  // `images` fallback inside pickVideoEntry would otherwise happily match a
  // clip reported by somebody else's node.
  if (!node || node.comfyClass !== "PixaromaSaveMp4") return;
  const entry = pickVideoEntry(detail?.output);
  // Show it now (its own loadedmetadata / timeupdate events drive the bar from
  // here). commitVideoEntry sets the Download basename + kicks the re-fit.
  if (entry) commitVideoEntry(node, entry);
});

// The colour option: a right-click "Save Mp4 settings" entry, the gear in the
// selection toolbar, and the shared colour panel behind both. The Civitai switch
// (civitai-meta.md #17) rides in the same panel as a setting, exactly like
// Preview Image's: this node has no state blob, and a new widget would shift
// its positional widgets_values (save-mp4.md #19 / #20).
registerNodeAccent("PixaromaSaveMp4", {
  title: "Save Mp4",
  rows: [
    { kind: "toggle", setting: "Pixaroma.SaveMp4.CivitaiMeta", defaultValue: false,
      label: "Add Civitai generation info",
      hint: "Civitai then shows the prompt, steps, seed and sampler of videos you upload. Your workflow stays inside the video as before" },
  ],
});

// ── Civitai flag -> the hidden CivitaiMeta input ─────────────────────────────
// A setting is not a widget, so Python cannot see it: inject it the way Preview
// Image does (hidden input + graphToPrompt, Vue Compat #9). Read LIVE per call so
// flipping the switch applies to the very next Run with no reload.
function injectCivitaiFlag(result) {
  const out = result?.output;
  if (!out) return;
  const on = !!nodeSetting("Pixaroma.SaveMp4.CivitaiMeta", false);
  for (const id in out) {
    const entry = out[id];
    if (!entry || entry.class_type !== "PixaromaSaveMp4") continue;
    if (!entry.inputs) entry.inputs = {};
    entry.inputs.CivitaiMeta = on ? "1" : "0";
  }
}

if (!app._pixSaveMp4CivitaiPatched) {
  app._pixSaveMp4CivitaiPatched = true;
  const _orig_fn = app.graphToPrompt;
  const orig = (...a) => _orig_fn.apply(app, a);
  app.graphToPrompt = async function (...args) {
    const result = await orig(...args);
    try {
      injectCivitaiFlag(result);
    } catch (e) {
      console.warn("[Save Mp4] Civitai flag inject failed", e);
    }
    return result;
  };
}
