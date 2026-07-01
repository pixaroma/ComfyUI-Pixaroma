import { app } from "/scripts/app.js";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";

// Load Video Frame Pixaroma — pick ONE exact frame out of a video and output it
// as an image (a "Load Image, but for video"). The node body shows a preview of
// the picked frame plus a frame scrubber: drag the slider, step with ◀ / ▶, or
// type the frame number in the native `frame` box above. The browser <video> is
// seeked to `frame / fps` for the preview; Python decodes that exact frame on
// run. Built for both renderers (the preview is a DOM widget that fills the body
// — same fill recipe as Load Video / Save Mp4). The upload button reuses Load
// Video's upload route; a small /meta route gives us fps + frame count (the
// browser <video> exposes neither).

let _lvfCssInjected = false;
function injectCSS() {
  if (_lvfCssInjected) return;
  _lvfCssInjected = true;
  const style = document.createElement("style");
  style.id = "pix-lvf-css";
  style.textContent = `
.pix-lvf-inner { position:absolute; inset:0; display:flex; flex-direction:column; }
.pix-lvf-media { position:relative; flex:1 1 0; min-height:0; overflow:hidden; }
.pix-lvf-bar { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:6px 8px; box-sizing:border-box; background:rgba(0,0,0,0.30); }
.pix-lvf-bar.is-disabled { opacity:0.40; pointer-events:none; }
.pix-lvf-step { width:26px; height:24px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; padding:0; border:1px solid rgba(255,255,255,0.16); border-radius:4px; background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.85); font:13px/1 sans-serif; cursor:pointer; user-select:none; }
.pix-lvf-step:hover { border-color:#f66744; color:#fff; }
.pix-lvf-scrub { flex:1 1 auto; min-width:30px; height:6px; position:relative; border-radius:3px; background:rgba(255,255,255,0.16); cursor:pointer; }
.pix-lvf-scrub-fill { position:absolute; left:0; top:0; height:100%; width:0%; border-radius:3px; background:#f66744; pointer-events:none; }
.pix-lvf-scrub-handle { position:absolute; top:50%; left:0%; width:12px; height:12px; border-radius:50%; background:#fff; transform:translate(-50%,-50%); pointer-events:none; box-shadow:0 0 2px rgba(0,0,0,0.6); }
.pix-lvf-frame { flex:0 0 auto; font:11px monospace; color:rgba(255,255,255,0.72); white-space:pre; user-select:none; }
.pix-lvf-toast { position:fixed; left:50%; bottom:40px; transform:translateX(-50%); background:#1d1d1d; color:#fff; border:1px solid #f66744; border-radius:6px; padding:8px 14px; font:13px sans-serif; z-index:99999; box-shadow:0 4px 12px rgba(0,0,0,0.5); pointer-events:none; }
`;
  document.head.appendChild(style);
}

const MIN_W = 320;
const PREVIEW_MIN_H = 170;   // smallest the preview area can be dragged to
const DEFAULT_H = 480;       // fresh-node height (saved workflows keep their own)

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "pix-lvf-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// Re-resolve the live <video> + bar elements after a Vue rebuild (the cached
// node._pixLvfVideo can point at a detached element after a tab switch).
function getLiveVideo(node) {
  if (node._pixLvfVideo?.isConnected) return node._pixLvfVideo;
  const w = node.widgets?.find((x) => x.name === "pixaroma_video_frame_source");
  const root = w?.element;
  if (!root || !root.isConnected) return null;
  const vid = root.querySelector("video");
  if (!vid?.isConnected) return null;
  node._pixLvfVideo = vid;
  node._pixLvfPlaceholder = root.querySelector(".pix-lvf-placeholder");
  node._pixLvfBar = root.querySelector(".pix-lvf-bar");
  node._pixLvfScrub = root.querySelector(".pix-lvf-scrub");
  node._pixLvfFill = root.querySelector(".pix-lvf-scrub-fill");
  node._pixLvfHandle = root.querySelector(".pix-lvf-scrub-handle");
  node._pixLvfReadout = root.querySelector(".pix-lvf-frame");
  return vid;
}

// Build a /view URL for the selected input video (combo value is relative to
// input/, so split the last slash into subfolder + filename).
function previewUrlFromWidget(node) {
  const w = node.widgets?.find((x) => x.name === "video");
  const val = w?.value;
  if (!val || typeof val !== "string") return null;
  const norm = val.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  const filename = i >= 0 ? norm.slice(i + 1) : norm;
  const subfolder = i >= 0 ? norm.slice(0, i) : "";
  const params = new URLSearchParams({
    filename, subfolder, type: "input", t: String(Date.now()),
  });
  return `/view?${params.toString()}`;
}

// ── frame math ───────────────────────────────────────────────────────────────
function frameWidget(node) {
  return node.widgets?.find((x) => x.name === "frame");
}
function totalFrames(node) {
  const n = node._pixLvfMeta?.frame_count;
  return typeof n === "number" && n > 0 ? n : 0;
}
function rawFrame(node) {
  const v = Number(frameWidget(node)?.value);
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}
// The frame we DISPLAY / seek to (clamped to the video length for the preview).
// We never rewrite the widget here, so an out-of-range saved value can't dirty a
// freshly-loaded workflow — Python clamps it the same way on run.
function currentFrame(node) {
  const total = totalFrames(node);
  let f = rawFrame(node);
  if (total > 0) f = Math.min(f, total - 1);
  return f;
}

function seekToFrame(node, frame) {
  const v = getLiveVideo(node);
  if (!v || !v.src) return;
  const fps = node._pixLvfMeta?.fps;
  if (fps && fps > 0) {
    const t = frame / fps;
    if (isFinite(t)) { try { v.currentTime = Math.max(0, t); } catch (_e) {} }
  }
}

function updateBar(node) {
  const total = totalFrames(node);
  const frame = currentFrame(node);
  const maxIdx = total > 0 ? total - 1 : 0;
  const ratio = maxIdx > 0 ? Math.max(0, Math.min(1, frame / maxIdx)) : 0;
  const pct = (ratio * 100).toFixed(2) + "%";
  if (node._pixLvfFill) node._pixLvfFill.style.width = pct;
  if (node._pixLvfHandle) node._pixLvfHandle.style.left = pct;
  if (node._pixLvfReadout) {
    if (total > 0) {
      // Right-pad the frame number to the widest it can get (digits of the last
      // frame) so the readout width never changes as you scrub. Without this, a
      // 1->3 digit change widens the readout, which squeezes the flex slider and
      // nudges the ▶ arrow. Monospace + white-space:pre keeps the padding exact.
      const w = String(total - 1).length;
      node._pixLvfReadout.textContent = `frame ${String(frame).padStart(w, " ")} · ${total} frames`;
    } else {
      node._pixLvfReadout.textContent = `frame ${frame}`;
    }
  }
  const hasVid = !!getLiveVideo(node)?.src;
  node._pixLvfBar?.classList.toggle("is-disabled", !hasVid);
}

// Write a new frame from a UI action (slider / arrows). Clamps, updates the
// native `frame` widget, seeks the preview. Not called on the load path.
function setFrameFromUI(node, frame) {
  if (frame == null || !isFinite(frame)) return;
  const total = totalFrames(node);
  let f = Math.max(0, Math.round(frame));
  if (total > 0) f = Math.min(f, total - 1);
  const fw = frameWidget(node);
  if (fw) fw.value = f;
  seekToFrame(node, f);
  updateBar(node);
  node.graph?.setDirtyCanvas(true, true);
}

// Slider position -> frame. Uses the real frame count when known; otherwise
// estimates from the browser video's duration x fps (degraded, but usable).
function frameFromClientX(node, clientX) {
  const scrub = node._pixLvfScrub;
  if (!scrub) return null;
  const rect = scrub.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const total = totalFrames(node);
  if (total > 0) return Math.round(ratio * (total - 1));
  const v = getLiveVideo(node);
  const fps = node._pixLvfMeta?.fps;
  if (v && fps && isFinite(v.duration) && v.duration > 0) {
    return Math.round(ratio * v.duration * fps);
  }
  return null;
}

// Fetch fps + frame count for the selected video so the slider can map to
// frames. Guarded against a superseded selection.
async function fetchMeta(node) {
  const vw = node.widgets?.find((x) => x.name === "video");
  const val = vw?.value;
  if (!val) { node._pixLvfMeta = null; updateBar(node); return; }
  node._pixLvfMetaFor = val;
  try {
    const res = await fetch(
      `/pixaroma/api/load_video_frame/meta?video=${encodeURIComponent(val)}`
    );
    if (node._pixLvfMetaFor !== val) return; // a newer selection won
    if (!res.ok) { node._pixLvfMeta = null; updateBar(node); return; }
    const meta = await res.json();
    if (node._pixLvfMetaFor !== val) return;
    if (meta && !meta.error) node._pixLvfMeta = meta;
    seekToFrame(node, currentFrame(node));
    updateBar(node);
  } catch (_e) {
    node._pixLvfMeta = null;
    updateBar(node);
  }
}

// Point the <video> at the selected file + fetch its frame info. Guarded so
// re-entrant calls don't reload the same clip.
function setPreview(node) {
  const video = getLiveVideo(node);
  if (!video) return;
  const w = node.widgets?.find((x) => x.name === "video");
  const val = w?.value || "";
  if (node._pixLvfCurVal === val && video.src) return;
  node._pixLvfCurVal = val;
  node._pixLvfMeta = null; // clear stale meta before the new fetch

  const url = previewUrlFromWidget(node);
  if (!url) {
    video.removeAttribute("src");
    video.style.display = "none";
    if (node._pixLvfPlaceholder?.isConnected) node._pixLvfPlaceholder.style.display = "flex";
    updateBar(node);
    return;
  }
  node._pixLvfName = val.replace(/\\/g, "/").split("/").pop() || "video.mp4";
  video.src = url;
  video.style.display = "block";
  if (node._pixLvfPlaceholder?.isConnected) node._pixLvfPlaceholder.style.display = "none";
  video.load();
  updateBar(node);
  fetchMeta(node);
  // The fill area can be left collapsed by a prior fold / tab switch; kick a
  // re-fit so the just-selected video shows without a manual refresh.
  requestAnimationFrame(() => { try { window.dispatchEvent(new Event("resize")); } catch (_e) {} });
}

// Restore the preview once the DOM widget is actually mounted (onNodeCreated /
// onConfigure run before the <video> is in the document).
function restorePreview(node, tries = 0) {
  if (tries === 0) {
    if (node._pixLvfRestoring) return;
    node._pixLvfRestoring = true;
  }
  if (getLiveVideo(node)) {
    node._pixLvfRestoring = false;
    setPreview(node);
    return;
  }
  if (tries >= 60) { node._pixLvfRestoring = false; return; }
  requestAnimationFrame(() => restorePreview(node, tries + 1));
}

async function uploadVideo(node) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "video/*";
  inp.style.display = "none";
  inp.addEventListener("cancel", () => inp.remove());
  inp.onchange = async () => {
    const file = inp.files?.[0];
    inp.remove();
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file, file.name);
    try {
      // Reuse Load Video's upload route (saves into input/ root).
      const res = await fetch("/pixaroma/api/load_video/upload", { method: "POST", body: fd });
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
        if (!vals.includes(name)) vw.options.values = [...vals, name].sort();
        vw.value = name;
        vw.callback?.(name);
      }
      setPreview(node);
      node.graph?.setDirtyCanvas(true, true);
    } catch (e) {
      console.error("[Pixaroma] Load Video Frame — upload error", e);
      showToast("Upload failed");
    }
  };
  document.body.appendChild(inp);
  inp.click();
}

app.registerExtension({
  name: "Pixaroma.LoadVideoFrame",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaLoadVideoFrame") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const ret = onNodeCreated?.apply(this, arguments);
      injectCSS();
      const node = this;

      // Upload button (before the preview so layout is: combo + frame box ->
      // upload -> preview fills the rest).
      this.addWidget("button", "choose video to upload", null,
        () => uploadVideo(node), { serialize: false });

      // Preview wrap: flex column on an inner absolute layer (ComfyUI forces the
      // root's display to block on rebuild/collapse; see Load Video / Save Mp4).
      const wrap = document.createElement("div");
      wrap.className = "pix-lvf-root";
      wrap.style.cssText =
        "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;border-radius:4px;overflow:hidden;";

      const inner = document.createElement("div");
      inner.className = "pix-lvf-inner";
      wrap.appendChild(inner);

      const media = document.createElement("div");
      media.className = "pix-lvf-media";
      inner.appendChild(media);

      const video = document.createElement("video");
      video.muted = true;           // frame picker: never plays audio, just seeks
      video.preload = "auto";
      video.playsInline = true;
      video.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none;";
      media.appendChild(video);

      const placeholder = document.createElement("div");
      placeholder.className = "pix-lvf-placeholder";
      placeholder.textContent = "(no video — click 'choose video to upload' or pick one above)";
      placeholder.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;text-align:center;padding:16px;box-sizing:border-box;background:#1a1a1a;";
      media.appendChild(placeholder);

      const bar = document.createElement("div");
      bar.className = "pix-lvf-bar is-disabled";
      bar.addEventListener("mousedown", (e) => e.stopPropagation());
      bar.addEventListener("pointerdown", (e) => e.stopPropagation());

      const prevBtn = document.createElement("button");
      prevBtn.className = "pix-lvf-step";
      prevBtn.title = "Previous frame";
      prevBtn.textContent = "◀";
      bar.appendChild(prevBtn);

      const scrub = document.createElement("div");
      scrub.className = "pix-lvf-scrub";
      scrub.title = "Drag to scrub to any frame";
      const fill = document.createElement("div");
      fill.className = "pix-lvf-scrub-fill";
      scrub.appendChild(fill);
      const handle = document.createElement("div");
      handle.className = "pix-lvf-scrub-handle";
      scrub.appendChild(handle);
      bar.appendChild(scrub);

      const nextBtn = document.createElement("button");
      nextBtn.className = "pix-lvf-step";
      nextBtn.title = "Next frame";
      nextBtn.textContent = "▶";
      bar.appendChild(nextBtn);

      const readout = document.createElement("span");
      readout.className = "pix-lvf-frame";
      readout.textContent = "frame 0";
      bar.appendChild(readout);

      inner.appendChild(bar);

      this._pixLvfVideo = video;
      this._pixLvfPlaceholder = placeholder;
      this._pixLvfBar = bar;
      this._pixLvfScrub = scrub;
      this._pixLvfFill = fill;
      this._pixLvfHandle = handle;
      this._pixLvfReadout = readout;

      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!video.src) return;
        setFrameFromUI(node, currentFrame(node) - 1);
      });
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!video.src) return;
        setFrameFromUI(node, currentFrame(node) + 1);
      });

      // The preview updates itself as the video seeks; keep the bar in sync.
      video.addEventListener("loadedmetadata", () => { seekToFrame(node, currentFrame(node)); updateBar(node); });
      video.addEventListener("seeked", () => updateBar(node));

      // Scrub: click/drag to pick a frame. Global listeners so a release outside
      // the track still ends the drag; detached in onRemoved.
      let dragging = false;
      const scrubFrom = (ev) => {
        if (!video.src) return;
        setFrameFromUI(node, frameFromClientX(node, ev.clientX));
      };
      scrub.addEventListener("mousedown", (e) => {
        dragging = true; scrubFrom(e);
        e.preventDefault(); e.stopPropagation();
      });
      const onMove = (e) => { if (dragging) scrubFrom(e); };
      const onUp = () => { dragging = false; };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      this._pixLvfScrubMove = onMove;
      this._pixLvfScrubUp = onUp;

      const protoRemoved = nodeType.prototype.onRemoved;
      this.onRemoved = function () {
        if (this._pixLvfScrubMove) window.removeEventListener("mousemove", this._pixLvfScrubMove);
        if (this._pixLvfScrubUp) window.removeEventListener("mouseup", this._pixLvfScrubUp);
        this._pixLvfScrubMove = this._pixLvfScrubUp = null;
        return protoRemoved?.apply(this, arguments);
      };

      updateBar(node); // initial grayed state

      const widget = this.addDOMWidget(
        "pixaroma_video_frame_source", "pixaroma_video_frame", wrap,
        { serialize: false, hideOnZoom: false, getMinHeight: () => PREVIEW_MIN_H }
      );
      applyAdaptiveCanvasOnly(widget);
      // No custom computeSize (see Load Video / Save Mp4): the node's min height
      // sums this widget's computeLayoutSize().minHeight, and with no maxHeight it
      // absorbs the free vertical space to fill the body in both renderers.
      widget.computeLayoutSize = () => ({ minHeight: PREVIEW_MIN_H, minWidth: 1 });

      // Refresh preview + frame info when the selected video changes.
      const vw = this.widgets?.find((x) => x.name === "video");
      if (vw && !vw._pixLvfWrapped) {
        vw._pixLvfWrapped = true;
        const origCb = vw.callback;
        vw.callback = function () {
          const r = origCb?.apply(this, arguments);
          setPreview(node);
          return r;
        };
      }

      // Typing / spinning the native `frame` box re-seeks the preview. Clamp on
      // this user action (not on load) so the box can't show a frame past the end.
      const fw = this.widgets?.find((x) => x.name === "frame");
      if (fw && !fw._pixLvfWrapped) {
        fw._pixLvfWrapped = true;
        const origCb = fw.callback;
        fw.callback = function () {
          const r = origCb?.apply(this, arguments);
          const total = totalFrames(node);
          if (this.value < 0) this.value = 0;
          if (total > 0 && this.value > total - 1) this.value = total - 1;
          seekToFrame(node, currentFrame(node));
          updateBar(node);
          return r;
        };
      }

      queueMicrotask(() => restorePreview(node));

      // Fresh-node defaults; configure() restores a saved node's size right
      // after, so this never dirties a load.
      if (!this.size) this.size = [MIN_W, DEFAULT_H];
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;

      return ret;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      const node = this;
      queueMicrotask(() => restorePreview(node));
      return r;
    };

    // Collapsing hides the preview; on expand re-fit / re-show.
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
