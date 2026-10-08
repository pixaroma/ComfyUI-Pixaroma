// ╔═══════════════════════════════════════════════════════════════╗
// ║  Video snapshot: a paused node-body <video> that costs nothing ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// WHY THIS EXISTS (measured 2026-09-26, D:\Claude Tests\_perf_bench, CLAUDE.md
// node UI convention #41). A <video> on screen in a node body costs the
// browser's GPU process work on EVERY frame the page draws, even when it is
// PAUSED - exactly like a <canvas> (see canvas_snapshot.mjs). One Load Video
// put the GPU process at 25.3% of a core against 22.1% with its video hidden
// (22.2% for an empty page), and three of them made a real SD1.5 render 2.8%
// slower (paired +3.0%, GPU process +0.62 s per run); hidden, +0.2%.
//
// So while the video is PAUSED and settled, a lossless picture of its current
// frame is laid over it and the video is hidden. The moment it plays, seeks,
// loads a new clip or goes fullscreen, the live video comes back.
//
// Rules it relies on, each one load-bearing:
//  - It is driven by the video's OWN events, so a player does not have to call
//    in - with ONE exception: call wake() right BEFORE requestFullscreen(), or
//    the element would enter fullscreen while hidden (black).
//  - Show/hide is VISIBILITY on both elements, never display. The players own
//    the video's display (placeholder, "clip is gone") and must stay the only
//    ones writing it; a style watcher drops the picture whenever a player hides
//    the video, so the picture can never outlive its video.
//  - The picture is the video's next sibling, laid over the same box with
//    position:absolute + inset:0 + 100% size. That is how all four players
//    place their video; a video that is not absolutely positioned gets a no-op
//    handle (the live video simply stays, today's behaviour). object-fit,
//    object-position and the letterbox background are copied from the video's
//    COMPUTED style, so a class-styled video works as well as an inline one.
//  - pointer-events:none on the picture, and a hidden video is never hit, so a
//    click lands on the player's own media box - every player listens there.
//    The box carries the class "pix-video-still" while the picture shows, for
//    a player whose video set a cursor (Save Video) to put it on the box.
//  - A new clip drops the old picture AT ONCE (emptied / loadstart), and every
//    event bumps a generation number, so a picture that lands after a newer
//    event is thrown away unseen: a stale frame can never show.
//  - It degrades to today's behaviour whenever the frame cannot be read (a
//    cross-origin source taints the canvas, the frame is not decoded yet, the
//    page is hidden): the live video just stays up.
//  - dispose() on teardown: listeners off, picture removed, video visible.

const NOOP = { wake() {}, dispose() {}, get showing() { return "video"; } };

// The picture is drawn at the clip's own resolution (so zooming the canvas or
// resizing the node never needs a new one), capped here: a 4K frame is drawn
// at about 2700x1500, which object-fit:contain shows identically in a node.
// Encoding is a PNG, and past a few megapixels that stalls the page
// (canvas_snapshot.mjs measured 29 ms at 5 Mpx).
const MAX_PX = 4e6;

// opts.fills: the caller vouches that the video is position:absolute and fills
// its parent (inset 0, 100% size) through a CLASS. Needed when the video is
// built before it is in the page, where its class styles cannot be read yet
// (Save Video). An inline position:absolute is read directly.
export function attachVideoSnapshot(video, opts = {}) {
  if (!video || !video.parentNode) return NOOP;
  if ((video.style.position || "") !== "absolute" && opts.fills !== true) return NOOP;
  const idleMs = opts.idleMs ?? 400;

  const img = document.createElement("img");
  img.className = "pix-video-snapshot";
  img.alt = "";
  img.draggable = false;
  img.decoding = "async";
  img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;"
    + "border:0;box-sizing:border-box;display:block;pointer-events:none;visibility:hidden;";
  video.insertAdjacentElement("afterend", img);

  let url = null;
  let timer = 0;
  let gen = 0;
  let disposed = false;
  let showing = "video";

  // While the picture shows, the media box carries this class, so a player
  // whose VIDEO set a cursor (Save Video's pointer) can put it on the box: the
  // hidden video no longer decides the cursor.
  const box = video.parentNode;
  const showVideo = () => {
    video.style.visibility = "";
    img.style.visibility = "hidden";
    box?.classList?.remove("pix-video-still");
    showing = "video";
  };
  // Something is moving (or gone): the live video, now, and cancel any picture
  // still being made.
  const live = () => {
    gen++;
    clearTimeout(timer);
    timer = 0;
    showVideo();
  };
  // Settled (maybe): the live video for now, and a picture after idleMs if it
  // is still paused then.
  const settle = () => {
    if (disposed) return;
    live();
    blackTries = 0;
    timer = setTimeout(capture, idleMs);
  };

  const inFullscreen = () => {
    const fe = document.fullscreenElement || document.webkitFullscreenElement;
    return !!fe && (fe === video || fe.contains(video));
  };
  const hiddenByPlayer = () => {
    if (video.style.display === "none") return true;
    try { return getComputedStyle(video).display === "none"; } catch (_e) { return true; }
  };
  // ⚠️ A video that is OFF SCREEN draws as pure BLACK (MEASURED: a clip that
  // loaded while its node was off screen drew 0 lit pixels in both renderers,
  // and the picture stayed black after panning back while the video itself had
  // its frame). So a picture is made only while the video is on screen, and a
  // fresh one when it comes back into view.
  let onScreen = false;
  const ready = () =>
    !disposed && onScreen && video.isConnected && video.paused && !video.seeking
    && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
    && !inFullscreen() && !hiddenByPlayer();

  // Belt and braces for the same trap: a frame the browser has not presented
  // yet draws as pure black, so an all-black frame is refused and retried a few
  // times, then the live video simply stays (a genuinely black frame costs the
  // saving, never a wrong picture).
  let blackTries = 0;
  const looksBlack = () => {
    const s = document.createElement("canvas");
    s.width = 16;
    s.height = 16;
    const x = s.getContext("2d");
    x.drawImage(video, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 6) return false;
    return true;
  };

  const capture = () => {
    timer = 0;
    if (!ready()) return;
    try {
      if (looksBlack()) {
        if (blackTries++ < 3) timer = setTimeout(capture, 1000);
        return;
      }
    } catch (_e) {
      return; // a cross-origin source cannot be read: keep the live video
    }
    blackTries = 0;
    const my = gen;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const k = Math.min(1, Math.sqrt(MAX_PX / (vw * vh)));
    const w = Math.max(1, Math.round(vw * k));
    const h = Math.max(1, Math.round(vh * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    try {
      c.getContext("2d").drawImage(video, 0, 0, w, h);
      c.toBlob((blob) => {
        c.width = 0; // let the scratch canvas go
        if (disposed || my !== gen || !blob) return;
        const next = URL.createObjectURL(blob);
        img.src = next;
        img.decode().then(() => {
          if (my !== gen || !ready()) { URL.revokeObjectURL(next); return; }
          if (url && url !== next) URL.revokeObjectURL(url);
          url = next;
          try {
            const cs = getComputedStyle(video);
            img.style.objectFit = cs.objectFit;
            img.style.objectPosition = cs.objectPosition;
            img.style.backgroundColor = cs.backgroundColor;
          } catch (_e) { /* keep the defaults */ }
          img.style.visibility = "visible";
          video.style.visibility = "hidden";
          box?.classList?.add("pix-video-still");
          showing = "image";
        }, () => {
          URL.revokeObjectURL(next);
        });
      }, "image/png");
    } catch (_e) {
      // A cross-origin source taints the canvas: keep the live video.
      c.width = 0;
    }
  };

  // Paused or finished moving: try for a picture. Anything else: live video.
  const onSettle = () => { if (video.paused) settle(); else live(); };
  const onLive = () => live();
  const events = [
    ["play", onLive], ["playing", onLive], ["seeking", onLive], ["waiting", onLive],
    ["emptied", onLive], ["loadstart", onLive], ["abort", onLive], ["error", onLive],
    ["pause", onSettle], ["seeked", onSettle], ["loadeddata", onSettle],
    ["canplay", onSettle], ["ended", onSettle], ["resize", onSettle],
  ];
  for (const [ev, fn] of events) video.addEventListener(ev, fn);

  // fullscreenchange is fired AT the element going in or out and bubbles, so
  // listening on the video itself is enough - and, unlike a document listener,
  // it cannot outlive a throwaway Ctrl+C copy that never gets its teardown.
  const onFullscreen = () => {
    if (inFullscreen()) live();
    else if (showing === "video") onSettle();
  };
  video.addEventListener("fullscreenchange", onFullscreen);
  video.addEventListener("webkitfullscreenchange", onFullscreen);

  // On screen or not (see ready()). ComfyUI parks an off-screen DOM widget at
  // display:none (Classic) or lays it out far away (Nodes 2.0), and can detach
  // it; none of that fires a media event, so without this a video that paused
  // or loaded out of view would keep its live, costly element up until the
  // next click. Our own visibility writes do not move it: an observer tracks
  // the box, and visibility:hidden keeps the box.
  let io = null;
  if (typeof IntersectionObserver === "function") {
    try {
      io = new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        const was = onScreen;
        onScreen = !!(e && e.isIntersecting);
        if (onScreen && !was && showing === "video" && !timer) onSettle();
      });
      io.observe(video);
    } catch (_e) { io = null; }
  }
  if (!io) onScreen = true; // no observer: behave as if always on screen

  // A player hides the video (no clip, "clip is gone"): the picture goes too.
  let mo = null;
  try {
    mo = new MutationObserver(() => {
      if (showing === "image" && hiddenByPlayer()) live();
    });
    mo.observe(video, { attributes: true, attributeFilter: ["style", "class"] });
  } catch (_e) { mo = null; }

  // A RIGHT-click must reach the live video. With the picture up, the press lands
  // on the media box (the picture is pointer-events:none and the video hidden), so
  // the browser showed its plain PAGE menu instead of the VIDEO one - no Save
  // video as, Save / Copy video frame, Open video in new tab (reported 2026-10-08
  // on Save Mp4; MEASURED in all players: contextmenu target DIV.pix-mp4-media /
  // DIV.pix-lv-media). The contextmenu event is hit-tested when it fires, AFTER
  // this press, so bringing the video back on the press is enough. The picture
  // returns on the first pointer move with no button held: none reaches the page
  // while a native menu is open, so it never swaps under an open menu.
  let pressMove = null;
  const resettleLater = () => {
    if (pressMove) return;
    pressMove = (e) => {
      if (e.buttons !== 0) return; // the button is still held: the menu is not up yet
      window.removeEventListener("pointermove", pressMove, true);
      pressMove = null;
      if (!disposed && video.paused) settle();
    };
    window.addEventListener("pointermove", pressMove, true);
  };
  const onPress = (e) => {
    // button 2 = right; Ctrl+click is the context menu on a Mac
    if (e.button !== 2 && !(e.button === 0 && e.ctrlKey)) return;
    if (showing !== "image") return;
    live();
    resettleLater();
  };
  box?.addEventListener?.("pointerdown", onPress, true);

  // A video that is already loaded and paused when we attach.
  if (video.readyState >= 2 && video.paused) settle();

  return {
    // Show the live video NOW (call right before requestFullscreen). A picture
    // is tried again later only if the video is still paused and on the node.
    wake() {
      if (disposed) return;
      settle();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gen++;
      clearTimeout(timer);
      for (const [ev, fn] of events) video.removeEventListener(ev, fn);
      video.removeEventListener("fullscreenchange", onFullscreen);
      video.removeEventListener("webkitfullscreenchange", onFullscreen);
      box?.removeEventListener?.("pointerdown", onPress, true);
      if (pressMove) window.removeEventListener("pointermove", pressMove, true);
      pressMove = null;
      try { mo?.disconnect(); } catch (_e) { /* ignore */ }
      try { io?.disconnect(); } catch (_e) { /* ignore */ }
      video.style.visibility = "";
      box?.classList?.remove("pix-video-still");
      try { img.remove(); } catch (_e) { /* ignore */ }
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
    get showing() { return showing; },
  };
}
