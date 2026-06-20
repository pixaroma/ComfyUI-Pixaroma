import { app } from "/scripts/app.js";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";

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
.pix-lv-media { position:relative; flex:1 1 0; min-height:0; }
.pix-lv-bar { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:5px 8px; box-sizing:border-box; background:rgba(0,0,0,0.30); }
.pix-lv-bar.is-disabled { opacity:0.40; pointer-events:none; }
.pix-lv-btn { width:24px; height:24px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; padding:0; border:none; border-radius:4px; background:transparent; cursor:pointer; }
.pix-lv-btn:hover { background:rgba(255,255,255,0.10); }
.pix-lv-ico { width:15px; height:15px; pointer-events:none; background-color:rgba(255,255,255,0.85); -webkit-mask:var(--ico) center/contain no-repeat; mask:var(--ico) center/contain no-repeat; }
.pix-lv-btn:hover .pix-lv-ico { background-color:#fff; }
.pix-lv-scrub { flex:1 1 auto; min-width:30px; height:6px; position:relative; border-radius:3px; background:rgba(255,255,255,0.16); cursor:pointer; }
.pix-lv-scrub-fill { position:absolute; left:0; top:0; height:100%; width:0%; border-radius:3px; background:#f66744; pointer-events:none; }
.pix-lv-scrub-handle { position:absolute; top:50%; left:0%; width:11px; height:11px; border-radius:50%; background:#fff; transform:translate(-50%,-50%); pointer-events:none; box-shadow:0 0 2px rgba(0,0,0,0.6); }
.pix-lv-time { flex:0 0 auto; font:11px monospace; color:rgba(255,255,255,0.70); white-space:nowrap; user-select:none; }
.pix-lv-toast { position:fixed; left:50%; bottom:40px; transform:translateX(-50%); background:#1d1d1d; color:#fff; border:1px solid #f66744; border-radius:6px; padding:8px 14px; font:13px sans-serif; z-index:99999; box-shadow:0 4px 12px rgba(0,0,0,0.5); pointer-events:none; }
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
const UI_ICON = "/pixaroma/assets/icons/ui/";

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
  return `/view?${params.toString()}`;
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
    `url(${UI_ICON}${playing ? "pause" : "play"}.svg)`
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
function setPreview(node) {
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
}

async function uploadVideo(node) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "video/*";
  inp.style.display = "none";
  inp.onchange = async () => {
    const file = inp.files?.[0];
    inp.remove();
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file, file.name);
    try {
      const res = await fetch("/pixaroma/api/load_video/upload", {
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
    } catch (e) {
      console.error("[Pixaroma] Load Video — upload error", e);
      showToast("Upload failed");
    }
  };
  document.body.appendChild(inp);
  inp.click();
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
      wrap.style.cssText =
        "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;border-radius:4px;overflow:hidden;display:flex;flex-direction:column;";

      const media = document.createElement("div");
      media.className = "pix-lv-media";
      wrap.appendChild(media);

      const video = document.createElement("video");
      video.loop = true; // no native controls — we draw our own bar
      // Not muted: playback only starts from an explicit play-button click (a
      // user gesture), so the browser allows sound — the user hears the source.
      video.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none;";
      media.appendChild(video);

      const placeholder = document.createElement("div");
      placeholder.className = "pix-lv-placeholder";
      placeholder.textContent = "(no video — click 'choose video to upload' or pick one above)";
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
      playIco.style.setProperty("--ico", `url(${UI_ICON}play.svg)`);
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
      dlIco.style.setProperty("--ico", `url(${UI_ICON}download.svg)`);
      dlBtn.appendChild(dlIco);
      bar.appendChild(dlBtn);

      const fsBtn = document.createElement("button");
      fsBtn.className = "pix-lv-btn";
      fsBtn.title = "Fullscreen";
      const fsIco = document.createElement("span");
      fsIco.className = "pix-lv-ico";
      fsIco.style.setProperty("--ico", `url(${UI_ICON}fit.svg)`);
      fsBtn.appendChild(fsIco);
      bar.appendChild(fsBtn);

      wrap.appendChild(bar);

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
      fsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!video.src) return;
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
      const onMove = (e) => { if (dragging) seekFrom(e); };
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
        return protoRemoved?.apply(this, arguments);
      };

      refreshBar(node); // initial grayed state

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

      // Refresh the preview whenever the user changes the selected video (drop-
      // down pick, prev/next arrow). Wrap the combo's own callback.
      const vw = this.widgets?.find((x) => x.name === "video");
      if (vw) {
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
      queueMicrotask(() => setPreview(node));

      // Fresh-node defaults (width floor + comfortable height). configure()
      // restores a saved node's size right after, so this never dirties a load.
      if (!this.size) this.size = [MIN_W, DEFAULT_H];
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;

      return ret;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      const node = this;
      // The DOM widget + restored combo value are in place by the next tick.
      queueMicrotask(() => setPreview(node));
      return r;
    };
  },
});
