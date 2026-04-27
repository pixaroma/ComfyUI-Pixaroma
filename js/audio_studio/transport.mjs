// js/audio_studio/transport.mjs
// Mixin: transport bar UI (G1) + Web Audio playback (G2).
import { AudioStudioEditor } from "./core.mjs";
import { getAudioContext } from "./audio_analysis.mjs";

function injectTransportCSS() {
  if (document.getElementById("pix-as-transport-css")) return;
  const css = `
    /* Play button — circular, Pixaroma orange. The icon is rendered via
       CSS mask so we can recolor a single SVG (white inside the circle)
       and swap play/pause/stop without juggling images. */
    .pix-as-play-btn {
      width: 26px; height: 26px;
      background: #f66744;
      border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; user-select: none;
      flex-shrink: 0;
      border: none;
      padding: 0;
      transition: filter 0.1s;
    }
    .pix-as-play-btn:hover { filter: brightness(1.1); }
    .pix-as-play-btn .pix-as-play-icon {
      width: 12px; height: 12px;
      background-color: #fff;
      -webkit-mask: var(--pix-as-icon-url) center/contain no-repeat;
              mask: var(--pix-as-icon-url) center/contain no-repeat;
      pointer-events: none;
    }

    /* Stop button — same shape but next to play. */
    .pix-as-stop-btn {
      width: 26px; height: 26px;
      background: #3a3a3a;
      border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; user-select: none;
      flex-shrink: 0;
      border: none;
      padding: 0;
      transition: filter 0.1s, background 0.1s;
    }
    .pix-as-stop-btn:hover { background: #4a4a4a; }
    .pix-as-stop-btn .pix-as-stop-icon {
      width: 11px; height: 11px;
      background-color: #f66744;
      -webkit-mask: url(/pixaroma/assets/icons/ui/stop.svg) center/contain no-repeat;
              mask: url(/pixaroma/assets/icons/ui/stop.svg) center/contain no-repeat;
      pointer-events: none;
    }

    /* Loop toggle — same shape as Stop but tints the icon orange when ON.
       Default ON so end-of-clip restarts playback automatically (good for
       quick A/B testing); click to disable for a single play-through. */
    .pix-as-loop-btn {
      width: 26px; height: 26px;
      background: #3a3a3a;
      border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; user-select: none;
      flex-shrink: 0;
      border: none;
      padding: 0;
      transition: background 0.1s;
    }
    .pix-as-loop-btn:hover { background: #4a4a4a; }
    .pix-as-loop-btn .pix-as-loop-icon {
      width: 13px; height: 13px;
      background-color: #666;
      -webkit-mask: url(/pixaroma/assets/icons/ui/loop.svg) center/contain no-repeat;
              mask: url(/pixaroma/assets/icons/ui/loop.svg) center/contain no-repeat;
      pointer-events: none;
      transition: background-color 0.1s;
    }
    .pix-as-loop-btn.active .pix-as-loop-icon { background-color: #f66744; }

    .pix-as-time {
      color: #aaa;
      font-family: ui-monospace, monospace;
      font-size: 11px;
      min-width: 32px;
      text-align: center;
      flex-shrink: 0;
    }
    .pix-as-scrub {
      flex: 1;
      height: 8px;
      background: #1a1a1a;
      border-radius: 4px;
      position: relative;
      cursor: pointer;
    }
    .pix-as-scrub-spark {
      position: absolute;
      left: 0; right: 0; top: 50%;
      height: 1px;
      pointer-events: none;
      background: #f66744;
      opacity: 0.4;
      transform: translateY(-0.5px);
    }
    .pix-as-scrub-fill {
      position: absolute; left: 0; top: 0; bottom: 0;
      background: #f66744;
      border-radius: 4px;
      pointer-events: none;
      width: 0%;
    }
    .pix-as-scrub-handle {
      position: absolute; top: -3px;
      width: 14px; height: 14px;
      background: #fff;
      border-radius: 50%;
      transform: translateX(-50%);
      pointer-events: none;
      box-shadow: 0 0 4px rgba(0,0,0,0.5);
    }
    .pix-as-fps {
      color: #888; font-size: 11px;
      font-family: ui-monospace, monospace;
      flex-shrink: 0;
    }
    /* Frame step buttons — small icon-only buttons */
    .pix-as-frame-step {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; user-select: none;
      flex-shrink: 0;
      border: none;
      background: transparent;
      border-radius: 3px;
      padding: 0;
      transition: background 0.1s;
    }
    .pix-as-frame-step:hover { background: #3a3a3a; }
    .pix-as-frame-step img {
      width: 14px; height: 14px;
      pointer-events: none;
      filter: invert(78%) sepia(8%) saturate(0%) hue-rotate(180deg) brightness(95%) contrast(85%);
    }
    .pix-as-frame-step:hover img {
      filter: invert(100%);
    }
  `;
  const style = document.createElement("style");
  style.id = "pix-as-transport-css";
  style.textContent = css;
  document.head.appendChild(style);
}

AudioStudioEditor.prototype._buildTransport = function () {
  injectTransportCSS();
  const t = this.transportEl;
  t.textContent = "";

  // Play / pause button — orange circle with a white SVG icon. The icon is
  // toggled via the --pix-as-icon-url CSS var so we don't replace the DOM
  // element on every play/pause toggle.
  const playBtn = document.createElement("button");
  playBtn.className = "pix-as-play-btn";
  playBtn.title = "Play / Pause (Space)";
  const playIcon = document.createElement("span");
  playIcon.className = "pix-as-play-icon";
  playIcon.style.setProperty("--pix-as-icon-url", "url(/pixaroma/assets/icons/ui/play.svg)");
  playBtn.appendChild(playIcon);
  playBtn.addEventListener("click", () => this._togglePlay());
  t.appendChild(playBtn);
  this._playBtn = playBtn;
  this._playIcon = playIcon;

  // Stop button — pause + reset to frame 0
  const stopBtn = document.createElement("button");
  stopBtn.className = "pix-as-stop-btn";
  stopBtn.title = "Stop (pause and rewind to start)";
  const stopIcon = document.createElement("span");
  stopIcon.className = "pix-as-stop-icon";
  stopBtn.appendChild(stopIcon);
  stopBtn.addEventListener("click", () => this._stopPlayback());
  t.appendChild(stopBtn);

  // Loop toggle — when ON, end-of-track restarts playback at frame 0 instead
  // of pausing. ON by default since most use is iterative tweaking against
  // a short clip. Transient state — resets to ON every editor open.
  if (this._loopPlayback === undefined) this._loopPlayback = true;
  const loopBtn = document.createElement("button");
  loopBtn.type = "button";
  loopBtn.className = "pix-as-loop-btn" + (this._loopPlayback ? " active" : "");
  loopBtn.title = this._loopPlayback
    ? "Loop is ON — click to play once and stop"
    : "Loop is OFF — click to repeat playback";
  const loopIcon = document.createElement("span");
  loopIcon.className = "pix-as-loop-icon";
  loopBtn.appendChild(loopIcon);
  loopBtn.addEventListener("click", () => {
    this._loopPlayback = !this._loopPlayback;
    loopBtn.classList.toggle("active", this._loopPlayback);
    loopBtn.title = this._loopPlayback
      ? "Loop is ON — click to play once and stop"
      : "Loop is OFF — click to repeat playback";
  });
  t.appendChild(loopBtn);
  this._loopBtn = loopBtn;

  const curTime = document.createElement("span");
  curTime.className = "pix-as-time";
  curTime.textContent = "0:00";
  t.appendChild(curTime);
  this._curTimeEl = curTime;

  const scrub = document.createElement("div");
  scrub.className = "pix-as-scrub";
  this._scrubEl = scrub;

  const spark = document.createElement("canvas");
  spark.className = "pix-as-scrub-spark";
  this._sparkCanvas = spark;
  scrub.appendChild(spark);

  const fill = document.createElement("div");
  fill.className = "pix-as-scrub-fill";
  scrub.appendChild(fill);
  this._scrubFill = fill;

  const handle = document.createElement("div");
  handle.className = "pix-as-scrub-handle";
  handle.style.left = "0%";
  scrub.appendChild(handle);
  this._scrubHandle = handle;

  t.appendChild(scrub);

  const totalTime = document.createElement("span");
  totalTime.className = "pix-as-time";
  totalTime.textContent = "0:00";
  t.appendChild(totalTime);
  this._totalTimeEl = totalTime;

  const fpsEl = document.createElement("span");
  fpsEl.className = "pix-as-fps";
  fpsEl.textContent = `${this.cfg.fps}fps`;
  t.appendChild(fpsEl);
  this._fpsEl = fpsEl;

  // Frame step buttons — small chevron-style icons. The play.svg from the
  // shared icon library is reused (rotated for back) since we have no
  // dedicated chevron-left/right icons; tinted via CSS filter so they
  // don't shout.
  const stepBack = document.createElement("button");
  stepBack.className = "pix-as-frame-step";
  stepBack.title = "Frame back (Left arrow; Shift+Left = 1s)";
  const stepBackIcon = document.createElement("img");
  stepBackIcon.src = "/pixaroma/assets/icons/ui/play.svg";
  stepBackIcon.style.transform = "rotate(180deg)";
  stepBack.appendChild(stepBackIcon);
  stepBack.addEventListener("click", () => this._stepFrame(-1));
  t.appendChild(stepBack);

  const stepFwd = document.createElement("button");
  stepFwd.className = "pix-as-frame-step";
  stepFwd.title = "Frame forward (Right arrow; Shift+Right = 1s)";
  const stepFwdIcon = document.createElement("img");
  stepFwdIcon.src = "/pixaroma/assets/icons/ui/play.svg";
  stepFwd.appendChild(stepFwdIcon);
  stepFwd.addEventListener("click", () => this._stepFrame(1));
  t.appendChild(stepFwd);

  // Scrub interaction — mousedown on track + drag captures globally so
  // releasing outside the scrub element still ends the drag cleanly.
  let dragging = false;
  const seekFromEvent = (ev) => {
    const rect = scrub.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
    const ratio = rect.width > 0 ? x / rect.width : 0;
    const total = Math.max(1, this._totalFrames - 1);
    this._currentFrame = Math.round(ratio * total);
    this._refreshTransport();
    this._render();
    if (this._isPlaying) this._restartPlayback();
  };
  scrub.addEventListener("mousedown", (e) => {
    dragging = true;
    seekFromEvent(e);
    e.preventDefault();
  });
  // Stash listeners so forceClose can detach them — otherwise leaking
  // closures keep the editor alive after close.
  this._scrubMove = (e) => { if (dragging) seekFromEvent(e); };
  this._scrubUp = () => { dragging = false; };
  window.addEventListener("mousemove", this._scrubMove);
  window.addEventListener("mouseup", this._scrubUp);
};

AudioStudioEditor.prototype._stepFrame = function (delta) {
  const total = Math.max(1, this._totalFrames);
  this._currentFrame = ((this._currentFrame || 0) + delta + total) % total;
  this._refreshTransport();
  this._render();
};

AudioStudioEditor.prototype._formatTime = function (seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

AudioStudioEditor.prototype._refreshTransport = function () {
  if (!this._playBtn) return;
  const fps = this.cfg.fps || 24;
  const cur = this._currentFrame || 0;
  const total = this._totalFrames || 0;
  const ratio = total > 0 ? cur / Math.max(1, total - 1) : 0;
  this._scrubFill.style.width = (ratio * 100).toFixed(2) + "%";
  this._scrubHandle.style.left = (ratio * 100).toFixed(2) + "%";
  this._curTimeEl.textContent = this._formatTime(cur / fps);
  this._totalTimeEl.textContent = this._formatTime(total / fps);
  this._fpsEl.textContent = `${fps}fps`;
};

AudioStudioEditor.prototype._drawSparkline = function () {
  if (!this._sparkCanvas || !this._totalFrames) return;
  const c = this._sparkCanvas;
  const rect = this._scrubEl.getBoundingClientRect();
  c.width = Math.max(64, rect.width | 0);
  c.height = 1;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  // Pull current band from envelope
  const idx = ({ full: 0, bass: 1, mids: 2, treble: 3 })[this.cfg.audio_band] ?? 0;
  // _envArray is cached by core.mjs _recomputeAudio (F2)
  const env = this._envArray;
  if (!env) return;
  ctx.fillStyle = "rgba(246, 103, 68, 0.7)";
  for (let x = 0; x < c.width; x++) {
    const f = Math.floor(x / c.width * this._totalFrames);
    const v = env[f * 4 + idx];
    if (v > 0.05) ctx.fillRect(x, 0, 1, 1);
  }
};

// ---------------------------------------------------------------------------
// G2 — Web Audio API playback synced to playhead
// ---------------------------------------------------------------------------

AudioStudioEditor.prototype._togglePlay = function () {
  if (!this._audioBuffer) return;
  if (this._isPlaying) this._pausePlayback();
  else this._startPlayback();
};

AudioStudioEditor.prototype._setPlayIcon = function (kind /* "play" | "pause" */) {
  if (!this._playIcon) return;
  this._playIcon.style.setProperty(
    "--pix-as-icon-url",
    kind === "pause"
      ? "url(/pixaroma/assets/icons/ui/pause.svg)"
      : "url(/pixaroma/assets/icons/ui/play.svg)",
  );
};

AudioStudioEditor.prototype._startPlayback = function () {
  const fps = this.cfg.fps || 24;
  const offsetSec = (this._currentFrame || 0) / fps;
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = this._audioBuffer;
  src.connect(ctx.destination);
  src.start(0, offsetSec);
  this._sourceNode = src;
  this._playStartCtxTime = ctx.currentTime;
  this._playStartOffsetSec = offsetSec;
  this._isPlaying = true;
  this._setPlayIcon("pause");

  const loop = () => {
    if (!this._isPlaying) return;
    const elapsed = ctx.currentTime - this._playStartCtxTime;
    const sec = this._playStartOffsetSec + elapsed;
    const newFrame = Math.floor(sec * fps);
    if (newFrame >= this._totalFrames) {
      // End of clip — loop button decides what happens next.
      // Stop / pause buttons still bypass this branch (they hit
      // _pausePlayback / _stopPlayback directly), so loop only triggers
      // on natural end-of-track.
      if (this._loopPlayback) {
        this._currentFrame = 0;
        this._restartPlayback();
        return;
      }
      this._pausePlayback();
      this._currentFrame = 0;
      this._refreshTransport();
      this._render();
      return;
    }
    this._currentFrame = newFrame;
    this._refreshTransport();
    this._render();
    this._rafId = requestAnimationFrame(loop);
  };
  this._rafId = requestAnimationFrame(loop);
};

AudioStudioEditor.prototype._pausePlayback = function () {
  if (this._sourceNode) {
    try { this._sourceNode.stop(); } catch {}
    try { this._sourceNode.disconnect(); } catch {}
    this._sourceNode = null;
  }
  if (this._rafId) cancelAnimationFrame(this._rafId);
  this._rafId = 0;
  this._isPlaying = false;
  this._setPlayIcon("play");
};

AudioStudioEditor.prototype._restartPlayback = function () {
  // Called when user scrubs while playing — Web Audio sources can't be
  // restarted, so we tear down and create a fresh source at the new offset.
  this._pausePlayback();
  this._startPlayback();
};

/**
 * Stop = pause + rewind to frame 0. Convenience action for the stop button
 * next to play/pause. Differs from pause (keeps current frame) in that the
 * playhead resets and the canvas re-renders frame 0.
 */
AudioStudioEditor.prototype._stopPlayback = function () {
  this._pausePlayback();
  this._currentFrame = 0;
  this._refreshTransport?.();
  this._render?.();
};

AudioStudioEditor.prototype._detachTransportListeners = function () {
  if (this._scrubMove) {
    window.removeEventListener("mousemove", this._scrubMove);
    this._scrubMove = null;
  }
  if (this._scrubUp) {
    window.removeEventListener("mouseup", this._scrubUp);
    this._scrubUp = null;
  }
};
