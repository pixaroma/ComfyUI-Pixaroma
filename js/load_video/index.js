import { app } from "../../../scripts/app.js";
import { pixApiUrl, pixAsset } from "../shared/api_url.mjs";
import { attachVideoSnapshot } from "../shared/video_snapshot.mjs";
import { applyAdaptiveCanvasOnly,
  installCanvasZoomPassthrough, installNodeAccent, registerNodeAccent,
  onRendererChange, createSlotBand, settleSlotBand, watchSlotBand,
  notifyGraphChanged,
} from "../shared/index.mjs";

// Load Video Pixaroma — upload/pick a video and preview the SOURCE clip right
// on the node body (it plays immediately, no run needed). The control bar
// (play / time / scrub / download / fullscreen) is the same shape as Save Mp4
// Pixaroma, but here the <video> src comes from the selected input file rather
// than an encoded output. Built for both renderers (the preview is a plain DOM
// widget that fills the body; see Save Mp4 for the fill rationale).

let _lvCssInjected = false;
function injectCSS() {
  if (_lvCssInjected) return;
  _lvCssInjected = true;
  const style = document.createElement("style");
  style.id = "pix-lv-css";
  style.textContent = `
.pix-lv-inner { position:absolute; inset:0; display:flex; flex-direction:column; border-radius:4px; overflow:hidden; }
.pix-lv-media { position:relative; flex:1 1 0; min-height:0; overflow:hidden; }
.pix-lv-bar { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:5px 8px; box-sizing:border-box; background:rgba(0,0,0,0.30); }
.pix-lv-bar.is-disabled { opacity:0.40; pointer-events:none; }
.pix-lv-btn { width:24px; height:24px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; padding:0; border:none; border-radius:4px; background:transparent; cursor:pointer; }
.pix-lv-btn:hover { background:rgba(255,255,255,0.10); }
.pix-lv-ico { width:15px; height:15px; pointer-events:none; background-color:rgba(255,255,255,0.85); -webkit-mask:var(--ico) center/contain no-repeat; mask:var(--ico) center/contain no-repeat; }
.pix-lv-btn:hover .pix-lv-ico { background-color:#fff; }
.pix-lv-scrub { flex:1 1 auto; min-width:30px; height:6px; position:relative; border-radius:3px; background:rgba(255,255,255,0.16); cursor:pointer; }
.pix-lv-scrub-fill { position:absolute; left:0; top:0; height:100%; width:0%; border-radius:3px; background:var(--pix-acc,#f66744); pointer-events:none; }
.pix-lv-scrub-handle { position:absolute; top:50%; left:0%; width:11px; height:11px; border-radius:50%; background:#fff; transform:translate(-50%,-50%); pointer-events:none; box-shadow:0 0 2px rgba(0,0,0,0.6); }
.pix-lv-time { flex:0 0 auto; font:11px monospace; color:rgba(255,255,255,0.70); white-space:nowrap; user-select:none; }
.pix-lv-toast { position:fixed; left:50%; bottom:40px; transform:translateX(-50%); background:#1d1d1d; color:#fff; border:1px solid var(--pix-acc,#f66744); border-radius:6px; padding:8px 14px; font:13px sans-serif; z-index:99999; box-shadow:0 4px 12px rgba(0,0,0,0.5); pointer-events:none; }
`;
  document.head.appendChild(style);
}

const MIN_W = 320;
// Smallest the preview area can be dragged to (drives getMinHeight +
// computeLayoutSize, which is what the node's minimum height sums).
const PREVIEW_MIN_H = 170;
// Fresh-node default height (controls + a comfortable starting preview). Saved
// workflows keep their own size — configure() runs after onNodeCreated.
const DEFAULT_H = 540;
const UI_ICON = "icons/ui/";

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "pix-lv-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// Re-resolve the live <video> + bar elements after a Vue rebuild (the cached
// node._pixLvVideo can point at a detached element when the user switches
// workflow tabs and back).
function getLiveVideo(node) {
  if (node._pixLvVideo?.isConnected) return node._pixLvVideo;
  const w = node.widgets?.find((x) => x.name === "pixaroma_video_source");
  const root = w?.element;
  if (!root || !root.isConnected) return null;
  const vid = root.querySelector("video");
  if (!vid?.isConnected) return null;
  node._pixLvVideo = vid;
  node._pixLvPlaceholder = root.querySelector(".pix-lv-placeholder");
  node._pixLvBar = root.querySelector(".pix-lv-bar");
  node._pixLvPlayIco = root.querySelector(".pix-lv-btn .pix-lv-ico");
  node._pixLvFill = root.querySelector(".pix-lv-scrub-fill");
  node._pixLvHandle = root.querySelector(".pix-lv-scrub-handle");
  node._pixLvTime = root.querySelector(".pix-lv-time");
  return vid;
}

// Build a /view URL for the currently-selected input video. The combo value is
// relative to input/ (e.g. "clip.mp4" or "pixaroma/clip.mp4"); split the last
// slash into subfolder + filename.
function previewUrlFromWidget(node) {
  const w = node.widgets?.find((x) => x.name === "video");
  const val = w?.value;
  if (!val || typeof val !== "string") return null;
  const norm = val.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  const filename = i >= 0 ? norm.slice(i + 1) : norm;
  const subfolder = i >= 0 ? norm.slice(0, i) : "";
  const params = new URLSearchParams({
    filename,
    subfolder,
    type: "input",
    t: String(Date.now()), // cache-bust on a real selection change
  });
  return pixApiUrl(`/view?${params.toString()}`);
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Sync the control bar to the <video> state. Cheap + idempotent.
function refreshBar(node) {
  const v = node._pixLvVideo;
  const bar = node._pixLvBar;
  if (!v || !bar) return;
  const hasSrc = !!v.src;
  bar.classList.toggle("is-disabled", !hasSrc);
  const playing = hasSrc && !v.paused && !v.ended;
  node._pixLvPlayIco?.style.setProperty(
    "--ico",
    `url(${pixAsset(UI_ICON + (playing ? "pause" : "play") + ".svg")})`
  );
  const dur = isFinite(v.duration) ? v.duration : 0;
  const cur = isFinite(v.currentTime) ? v.currentTime : 0;
  const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
  const pct = (ratio * 100).toFixed(2) + "%";
  if (node._pixLvFill) node._pixLvFill.style.width = pct;
  if (node._pixLvHandle) node._pixLvHandle.style.left = pct;
  if (node._pixLvTime) node._pixLvTime.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
}

// Point the <video> at the selected file. Guarded so re-entrant calls (configure
// + microtask + callback) don't reload the same clip repeatedly.
// ── the size band ───────────────────────────────────────────────────────────
// Placement, the CSS and the measurements behind them live in
// js/shared/slot_band.mjs. This node only decides WHAT it says and WHEN.
// index 0 = the video_frames output, the top dot.
const BAND_OPTS = { side: "left", slot: "output", index: 0 };

function getBand(node) {
  const w = node.widgets?.find((x) => x.name === "pixaroma_video_source");
  const root = w?.element;
  if (!root || !root.isConnected) return null;
  const b = root.querySelector(".pix-slot-band");
  return b?.isConnected ? b : null;
}

function bandVideo(node) {
  const w = node.widgets?.find((x) => x.name === "pixaroma_video_source");
  return w?.element?.querySelector("video") || null;
}

function setBandFromVideo(node) {
  const band = getBand(node);
  if (!band) return;
  const v = bandVideo(node);
  const w = Number(v?.videoWidth) || 0;
  const h = Number(v?.videoHeight) || 0;
  if (!w || !h) { band.textContent = ""; return; }
  // The SOURCE clip's size, matching the preview. The node also has width and
  // height OUTPUTS for what actually leaves it, which differ only when
  // custom_width / custom_height are set (pattern #4).
  band.textContent = `${w}x${h}`;
  settleSlotBand(node, band, BAND_OPTS);
}

function clearBand(node) {
  const band = getBand(node);
  if (band) band.textContent = "";
}

function setPreview(node) {
  clearBand(node);   // the new clip's size is unknown until it reports
  const video = getLiveVideo(node);
  if (!video) return;
  const w = node.widgets?.find((x) => x.name === "video");
  const val = w?.value || "";
  if (node._pixLvCurVal === val && video.src) return;
  node._pixLvCurVal = val;

  const url = previewUrlFromWidget(node);
  if (!url) {
    video.removeAttribute("src");
    video.style.display = "none";
    if (node._pixLvPlaceholder?.isConnected) node._pixLvPlaceholder.style.display = "flex";
    refreshBar(node);
    return;
  }
  node._pixLvName = val.replace(/\\/g, "/").split("/").pop() || "video.mp4";
  video.src = url;
  video.style.display = "block";
  if (node._pixLvPlaceholder?.isConnected) node._pixLvPlaceholder.style.display = "none";
  video.load();
  refreshBar(node);
  // The fill preview area can be left collapsed (zero height) by a prior fold or
  // a workflow-tab switch - display was toggled without a re-layout. Kick a
  // re-fit so the just-selected video actually shows without a manual refresh.
  requestAnimationFrame(() => { try { window.dispatchEvent(new Event("resize")); } catch (_e) {} });
}

// Restore the preview once the DOM widget is actually mounted. On a fresh add
// (and a tab-switch restore) onNodeCreated/onConfigure run BEFORE the <video>
// element is in the document, so getLiveVideo() is null and a direct setPreview
// no-ops. Retry on animation frames until the element exists, then show it.
function restorePreview(node, tries = 0) {
  // Only one retry chain at a time — onNodeCreated AND onConfigure both kick
  // this off for a saved/duplicated node, and two parallel rAF chains would
  // race (harmless but wasteful). The flag serialises them.
  if (tries === 0) {
    if (node._pixLvRestoring) return;
    node._pixLvRestoring = true;
  }
  if (getLiveVideo(node)) {
    node._pixLvRestoring = false;
    setPreview(node);
    return;
  }
  if (tries >= 60) { // ~1s; give up rather than loop forever
    node._pixLvRestoring = false;
    return;
  }
  requestAnimationFrame(() => restorePreview(node, tries + 1));
}

// The extensions the upload route and the dropdown accept (VIDEO_EXTS in
// nodes/_video_helpers.py), to tell a dropped video from any other file.
const VIDEO_FILE_RE = /\.(mp4|mov|mkv|webm|avi|m4v|gif|mpg|mpeg|wmv|flv|ogv|ts)$/i;

// Upload one video FILE to input/ and select it on this node. Shared by the
// upload button and a file dropped on the node.
async function uploadVideoFile(node, file) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  try {
    const res = await fetch(pixApiUrl("/pixaroma/api/load_video/upload"), {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      let msg = `Upload failed (HTTP ${res.status})`;
      try { msg = (await res.json()).error || msg; } catch {}
      showToast(msg);
      return;
    }
    const data = await res.json();
    const name = data?.name;
    if (!name) { showToast("Upload failed"); return; }
    const vw = node.widgets?.find((x) => x.name === "video");
    if (vw) {
      const vals = Array.isArray(vw.options?.values) ? vw.options.values : [];
      if (!vals.includes(name)) {
        vw.options.values = [...vals, name].sort();
      }
      vw.value = name;
      vw.callback?.(name); // fires the wrapped callback -> setPreview
    }
    setPreview(node);
    node.graph?.setDirtyCanvas(true, true);
    // The pick lands after an async upload, long after the mouseup core
    // snapshots on (and a drop from the desktop has no mouseup at all), so
    // record it here or the workflow never looks modified (convention #31).
    notifyGraphChanged();
  } catch (e) {
    console.error("[Pixaroma] Load Video — upload error", e);
    showToast("Upload failed");
  }
}

async function uploadVideo(node) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "video/*";
  inp.style.display = "none";
  // Clean up the hidden input if the user dismisses the file dialog (otherwise
  // onchange never fires and the element would linger in the DOM).
  inp.addEventListener("cancel", () => inp.remove());
  inp.onchange = async () => {
    const file = inp.files?.[0];
    inp.remove();
    if (!file) return;
    await uploadVideoFile(node, file);
  };
  document.body.appendChild(inp);
  inp.click();
}

// A drag from the desktop: while it is over the node only the item TYPES are
// readable (the files list stays empty until the drop), so accept any video
// type, and an untyped file (some systems give .mkv no type) that the drop then
// checks by name. Everything else is left to ComfyUI (a picture still makes a
// Load Image node, a workflow file still opens).
function draggingVideo(e) {
  const items = e?.dataTransfer?.items;
  if (!items) return false;
  return Array.from(items).some((it) =>
    it.kind === "file" && (!it.type || it.type.startsWith("video/") || it.type === "image/gif"));
}

// "max_frames_after_skip" (2026-11-19, load-video.md #20) is ON for a new node
// and OFF for a workflow saved before it existed, so an old workflow keeps
// giving Max frames - Skip frames. ComfyUI restores widget values BY POSITION:
// the switch sits at slot 6, where an old save holds the upload button's null
// (and the button then gets the preview's ""). A real save holds a boolean
// there; anything else = an old save. A named save (newer ComfyUI) is read by
// name first.
const AFTER_SKIP = "max_frames_after_skip";
const AFTER_SKIP_SLOT = 6;
function migrateAfterSkip(node, info) {
  const sw = node.widgets?.find((w) => w.name === AFTER_SKIP);
  if (!sw || !info) return;
  const named = info.widgets_values_named;
  if (named && typeof named === "object" && AFTER_SKIP in named) return;
  const vals = info.widgets_values;
  if (!Array.isArray(vals)) return;   // nothing saved: keep the default
  if (typeof vals[AFTER_SKIP_SLOT] === "boolean") return;
  sw.value = false;
  const btn = node.widgets?.find((w) => w.type === "button");
  if (btn) btn.value = null;          // the slot shift gave it the preview's ""
}

app.registerExtension({
  name: "Pixaroma.LoadVideo",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaLoadVideo") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const ret = onNodeCreated?.apply(this, arguments);
      injectCSS();
      const node = this;

      // Upload button — added before the preview so layout is:
      // [video combo + number controls] -> [upload] -> [preview fills the rest].
      this.addWidget(
        "button",
        "choose video to upload",
        null,
        () => uploadVideo(node),
        { serialize: false }
      );

      // Preview wrap: flex COLUMN — media fills the top, control bar pinned
      // below (same fill strategy as Save Mp4).
      const wrap = document.createElement("div");
      wrap.className = "pix-lv-root";
      // NO display:flex here — ComfyUI's DOM-widget manager sets wrap.style.display
      // itself (block to show, none to hide on collapse), which clobbers an inline
      // flex and collapses the media to 0. The flex column lives on an inner
      // absolute-filled layer ComfyUI never touches (see Save Mp4 for the verified
      // measurement), so it always fills.
      // border-radius + overflow:hidden moved to .pix-lv-inner: the size band
      // below is floated ABOVE this root, onto the output slot row, and an
      // overflow:hidden here clips it away entirely. inner is inset:0 over the
      // same box, so the video is clipped exactly as before.
      wrap.style.cssText =
        "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;";
      // A file dragged over the PREVIEW: in Classic it sits above the canvas,
      // so core's canvas dragover never sees the node there and the drop was
      // refused. Allow it and name this node as the target; core's document
      // drop handler then calls onDragDrop below. (Nodes 2.0 does the same
      // from the node element; setting it twice is harmless.)
      wrap.addEventListener("dragover", (e) => {
        if (!node.onDragOver?.(e)) return;
        e.preventDefault();
        app.dragOverNode = node;
      });

      // The source clip's size, on the LEFT of the slot band - this node's dead
      // space is that side, because all seven dots are outputs on the right.
      // It describes the clip in the player, which is deliberately the SOURCE
      // (pattern #6), so the two always agree.
      const band = createSlotBand(wrap, "left");

      const inner = document.createElement("div");
      inner.className = "pix-lv-inner";
      wrap.appendChild(inner);

      const media = document.createElement("div");
      media.className = "pix-lv-media";
      inner.appendChild(media);

      const video = document.createElement("video");
      video.loop = true; // no native controls — we draw our own bar
      // Not muted: playback only starts from an explicit play-button click (a
      // user gesture), so the browser allows sound — the user hears the source.
      video.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none;";
      media.appendChild(video);
      // While the clip is paused a still picture of its frame is shown and the
      // video is hidden: a video on screen, even paused, costs the GPU process
      // work on every frame the page draws, and that is taken out of a run
      // (CLAUDE.md #41). The picture sits between the video and the
      // placeholder, and the media box below still takes every click.
      this._pixLvSnap = attachVideoSnapshot(video);

      const placeholder = document.createElement("div");
      placeholder.className = "pix-lv-placeholder";
      placeholder.textContent = "(no video: click 'choose video to upload', drop a video file here, or pick one above)";
      placeholder.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;text-align:center;padding:16px;box-sizing:border-box;background:#1a1a1a;";
      media.appendChild(placeholder);

      const bar = document.createElement("div");
      bar.className = "pix-lv-bar is-disabled";
      bar.addEventListener("mousedown", (e) => e.stopPropagation());
      bar.addEventListener("pointerdown", (e) => e.stopPropagation());

      const playBtn = document.createElement("button");
      playBtn.className = "pix-lv-btn";
      playBtn.title = "Play / Pause";
      const playIco = document.createElement("span");
      playIco.className = "pix-lv-ico";
      playIco.style.setProperty("--ico", `url(${pixAsset(UI_ICON + "play.svg")})`);
      playBtn.appendChild(playIco);
      bar.appendChild(playBtn);

      const timeEl = document.createElement("span");
      timeEl.className = "pix-lv-time";
      timeEl.textContent = "0:00 / 0:00";
      bar.appendChild(timeEl);

      const scrub = document.createElement("div");
      scrub.className = "pix-lv-scrub";
      const fill = document.createElement("div");
      fill.className = "pix-lv-scrub-fill";
      scrub.appendChild(fill);
      const handle = document.createElement("div");
      handle.className = "pix-lv-scrub-handle";
      scrub.appendChild(handle);
      bar.appendChild(scrub);

      const dlBtn = document.createElement("button");
      dlBtn.className = "pix-lv-btn";
      dlBtn.title = "Download this video";
      const dlIco = document.createElement("span");
      dlIco.className = "pix-lv-ico";
      dlIco.style.setProperty("--ico", `url(${pixAsset(UI_ICON + "download.svg")})`);
      dlBtn.appendChild(dlIco);
      bar.appendChild(dlBtn);

      const fsBtn = document.createElement("button");
      fsBtn.className = "pix-lv-btn";
      fsBtn.title = "Fullscreen";
      const fsIco = document.createElement("span");
      fsIco.className = "pix-lv-ico";
      fsIco.style.setProperty("--ico", `url(${pixAsset(UI_ICON + "fit.svg")})`);
      fsBtn.appendChild(fsIco);
      bar.appendChild(fsBtn);

      inner.appendChild(bar);

      this._pixLvVideo = video;
      this._pixLvPlaceholder = placeholder;
      this._pixLvBar = bar;
      this._pixLvPlayIco = playIco;
      this._pixLvFill = fill;
      this._pixLvHandle = handle;
      this._pixLvTime = timeEl;

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
      fsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!video.src) return;
        node._pixLvSnap?.wake(); // the video must be visible BEFORE it goes fullscreen
        (video.requestFullscreen || video.webkitRequestFullscreen)?.call(video);
      });
      dlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!video.src) return;
        const a = document.createElement("a");
        a.href = video.src;
        a.download = node._pixLvName || "video.mp4";
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
      ["play", "pause", "ended", "timeupdate", "loadedmetadata", "durationchange"].forEach(
        (ev) => video.addEventListener(ev, () => refreshBar(node))
      );

      // The only place the source's real size is known. Reading it off the media
      // element means no Python change and nothing persisted: every re-pick and
      // every rebuild re-fires this.
      video.addEventListener("loadedmetadata", () => setBandFromVideo(node));
      video.addEventListener("emptied", () => clearBand(node));
      video.addEventListener("error", () => clearBand(node));

      // Scrub: click/drag to seek. Global listeners so a release outside the
      // track still ends the drag; detached in onRemoved.
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
      // No button held = the mouseup was LOST (released outside the window, a
      // context menu ate it): end the drag instead of seeking on every move
      // (convention #20, save-mp4.md #11).
      const onMove = (e) => {
        if (!dragging) return;
        if (!(e.buttons & 1)) { dragging = false; return; }
        seekFrom(e);
      };
      const onUp = () => { dragging = false; };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      this._pixLvScrubMove = onMove;
      this._pixLvScrubUp = onUp;

      const protoRemoved = nodeType.prototype.onRemoved;
      this.onRemoved = function () {
        if (this._pixLvScrubMove) window.removeEventListener("mousemove", this._pixLvScrubMove);
        if (this._pixLvScrubUp) window.removeEventListener("mouseup", this._pixLvScrubUp);
        this._pixLvScrubMove = this._pixLvScrubUp = null;
        this._pixLvSnap?.dispose();
        this._pixLvSnap = null;
        this._pixLvRendererOff?.();
        this._pixLvRendererOff = null;
        this._pixLvBandRO?.();
        this._pixLvBandRO = null;
        return protoRemoved?.apply(this, arguments);
      };

      refreshBar(node); // initial grayed state

      installCanvasZoomPassthrough(wrap);
      installNodeAccent(this, wrap);   // the face follows this node's accent colour
      const widget = this.addDOMWidget(
        "pixaroma_video_source",
        "video_preview",
        wrap,
        { serialize: false, hideOnZoom: false, getMinHeight: () => PREVIEW_MIN_H }
      );
      applyAdaptiveCanvasOnly(widget);
      // No custom computeSize (see Save Mp4): the node's min height sums this
      // widget's computeLayoutSize().minHeight (= PREVIEW_MIN_H floor), and with
      // no maxHeight the widget absorbs all free vertical space to fill the body
      // in both renderers. minWidth:1 so the saved node width round-trips.
      widget.computeLayoutSize = () => ({ minHeight: PREVIEW_MIN_H, minWidth: 1 });

      // The band's offsets differ per renderer and the setting flips under a
      // live node, so re-place on every flip; the observer catches a drag-resize
      // (which moves the Classic horizontal offset); and the burst catches the
      // root MOVING without resizing as the rows above it settle. All three
      // write only the band's own style, so none can dirty a workflow.
      this._pixLvRendererOff = onRendererChange(() => settleSlotBand(node, getBand(node), BAND_OPTS));
      this._pixLvBandRO = watchSlotBand(node, band, wrap, BAND_OPTS);
      settleSlotBand(node, band, BAND_OPTS);

      // Refresh the preview whenever the user changes the selected video (drop-
      // down pick, prev/next arrow). Wrap the combo's own callback.
      const vw = this.widgets?.find((x) => x.name === "video");
      if (vw && !vw._pixLvWrapped) {
        vw._pixLvWrapped = true;
        const origCb = vw.callback;
        vw.callback = function () {
          const r = origCb?.apply(this, arguments);
          setPreview(node);
          return r;
        };
      }

      // Restore the preview from the selected value. queueMicrotask defers past
      // configure() for a saved/duplicated node (Vue Compat #8); the initial
      // value of a fresh node is its combo default. onConfigure is the belt-and-
      // braces path for workflow-tab switching.
      queueMicrotask(() => restorePreview(node));

      // Fresh-node defaults (width floor + comfortable height). configure()
      // restores a saved node's size right after, so this never dirties a load.
      if (!this.size) this.size = [MIN_W, DEFAULT_H];
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;

      return ret;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = onConfigure?.apply(this, arguments);
      const node = this;
      migrateAfterSkip(this, info);
      // The DOM widget + restored combo value are in place by the next tick.
      queueMicrotask(() => restorePreview(node));
      return r;
    };

    // Drop a video file on the node to load it, like Load Image. Core asks
    // onDragOver while the drag is over the node (both renderers) and calls
    // onDragDrop on the drop; true = handled here, false = ComfyUI does its
    // own thing (it used to make a SECOND, core video node beside this one).
    // A COLLAPSED node declines (ComfyUI handles the drop as before): in Nodes
    // 2.0 its body is unmounted, so the preview could not follow and showed the
    // old clip after expanding. Checked in onDragDrop too, because Nodes 2.0
    // names the node as the drop target whatever onDragOver answered.
    nodeType.prototype.onDragOver = function (e) {
      if (this.flags?.collapsed) return false;
      return draggingVideo(e);
    };
    nodeType.prototype.onDragDrop = async function (e) {
      if (!this.graph || this.flags?.collapsed) return false;
      const file = Array.from(e?.dataTransfer?.files || [])
        .find((f) => VIDEO_FILE_RE.test(f.name || ""));
      if (!file) return false;
      await uploadVideoFile(this, file);
      return true;
    };

    // Collapsing hides the preview; on expand re-fit (and re-show the source if
    // the widget was rebuilt empty in Nodes 2.0) so the picture returns without
    // a manual re-select. setPreview's own guard skips a redundant reload.
    const onCollapseProto = nodeType.prototype.onCollapse;
    nodeType.prototype.onCollapse = function () {
      const r = onCollapseProto?.apply(this, arguments);
      const node = this;
      requestAnimationFrame(() => {
        const v = getLiveVideo(node);
        if (!v) return;
        if (!v.src) restorePreview(node);
        else { try { window.dispatchEvent(new Event("resize")); } catch (_e) {} }
      });
      return r;
    };
  },
});

// The colour option: a right-click "Load Video settings" entry, the gear in the
// selection toolbar, and the shared colour panel behind both.
registerNodeAccent("PixaromaLoadVideo", { title: "Load Video" });
