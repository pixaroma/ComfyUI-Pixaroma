import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { registerNodeHelp } from "../shared/help.mjs";

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Run Log Pixaroma — the last 10 run times, on the node                ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// A companion to Run Timer. Frontend-only node (never runs in Python). It listens
// to ComfyUI's run events and, when a run FINISHES successfully, drops the whole-
// workflow time onto the top of a per-node list (newest first, last 10 kept). The
// list lives on node.properties.runLogHistory, so it travels WITH the workflow and
// survives a reload — "this workflow only", exactly as asked. Times only; no
// workflow names.
//
// This is a NORMAL titled node (unlike title-less Run Timer), so it uses ONE
// addDOMWidget for BOTH renderers — no canvas paint path needed (a titled node is
// dragged by its title bar, so a DOM body widget doesn't eat drag/right-click).
//
// Dirty-on-load safe (Vue Compat #18): the load path (nodeCreated microtask +
// onConfigure) only READS node.properties and rebuilds the DOM. The only writes to
// serialized state are the recorded time on a genuine finished run and the Clear
// action — both user/run driven, both accepted like Run Timer's runTimerLastMs.

const BRAND = "#f66744";
const NODE_NAME = "PixaromaRunLog";
const HIST_PROP = "runLogHistory";
const HISTORY_MAX = 10;

// The panel always shows all 10 rows — the MIN height fits caption + 10 rows +
// footer, so the node can't be dragged small enough to clip runs (user feedback).
// Default = minimum (convention #5); width is still free, taller is harmless. Both
// heights are CONSTANTS → dirty-on-load safe (byte-identical every save/load).
const DEFAULT_W = 240;
const DEFAULT_H = 282;
const MIN_W = 200;
const MIN_H = 282;        // node floor: can't shrink below all 10 rows + footer
const WIDGET_MIN_H = 258; // widget content floor: caption + 10 rows + footer

// ── DOM helper ──────────────────────────────────────────────────────────────
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

// ── time formatting ─────────────────────────────────────────────────────────
// Under a minute → seconds with one decimal (14.8s). A minute or more → m:ss
// (1:23). Math.floor so a float ms never leaks raw decimals.
function fmtTime(ms) {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  const m = Math.floor(s / 60);
  const rem = Math.floor(s - m * 60);
  return m + ":" + String(rem).padStart(2, "0");
}

// ── history (per node, on node.properties) ──────────────────────────────────
function getHist(node) {
  const raw = node.properties && node.properties[HIST_PROP];
  if (!Array.isArray(raw)) return [];
  return raw.filter((n) => typeof n === "number" && isFinite(n) && n >= 0).slice(0, HISTORY_MAX);
}
function pushHistory(node, ms) {
  const dur = Math.round(Number(ms));
  if (!isFinite(dur) || dur < 0) return;
  const next = [dur, ...getHist(node)].slice(0, HISTORY_MAX);
  if (!node.properties) node.properties = {};
  node.properties[HIST_PROP] = next;
}
function clearHistory(node) {
  if (!node.properties) node.properties = {};
  node.properties[HIST_PROP] = [];
  renderList(node);
  if (!isVueNodes()) node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}

// ── render the ledger (both renderers — one DOM widget) ─────────────────────
function renderList(node) {
  const screen = node._pixRlScreen;
  const status = node._pixRlStatus;
  if (!screen) return;
  const hist = getHist(node);

  // footer buttons are dead when there's nothing to export / clear
  const has = hist.length > 0;
  if (node._pixRlExportBtn) node._pixRlExportBtn.disabled = !has;
  if (node._pixRlClearBtn) node._pixRlClearBtn.disabled = !has;

  if (status) {
    if (node._rlRunning) {
      status.className = "pix-rl-status pix-rl-running";
      status.innerHTML = "";
      status.appendChild(el("span", "pix-rl-rdot"));
      status.appendChild(document.createTextNode("running"));
    } else {
      status.className = "pix-rl-status";
      status.textContent = "this workflow";
    }
  }

  screen.innerHTML = "";
  if (!hist.length) {
    const empty = el("div", "pix-rl-empty");
    const t = el("div", "pix-rl-empty-t"); t.textContent = "No runs yet";
    const s = el("div", "pix-rl-empty-s"); s.textContent = "Press Run to time this workflow";
    empty.appendChild(t); empty.appendChild(s);
    screen.appendChild(empty);
    return;
  }

  // fastest of the ten (index 0 is newest)
  let bestIdx = 0;
  for (let i = 1; i < hist.length; i++) if (hist[i] < hist[bestIdx]) bestIdx = i;

  hist.forEach((ms, i) => {
    const isNow = i === 0;
    const isBest = i === bestIdx;
    const row = el("div", "pix-rl-row" + (isNow ? " pix-rl-row--now" : (isBest ? " pix-rl-row--best" : "")));
    const idx = el("span", "pix-rl-idx"); idx.textContent = String(i + 1).padStart(2, "0");
    const meta = el("span", "pix-rl-meta");
    if (isNow) meta.textContent = isBest ? "last  ⚡" : "last";
    else if (isBest) meta.textContent = "⚡ best";
    else meta.textContent = "";
    const time = el("span", "pix-rl-time"); time.textContent = fmtTime(ms);
    row.appendChild(idx); row.appendChild(meta); row.appendChild(time);
    screen.appendChild(row);
  });
}

// ── run lifecycle (drives every Run Log on the canvas) ──────────────────────
// One shared run origin. On a finish we record performance.now() - _runStart on
// each live node, so every Run Log shows the same whole-workflow duration.
const _logs = new Set();
let _runStart = null;

function startRun() {
  _runStart = performance.now();
  for (const node of _logs) {
    node._rlRunning = true;
    renderList(node);
    if (!isVueNodes()) node.setDirtyCanvas && node.setDirtyCanvas(true, true);
  }
}
function finishRun(success) {
  const start = _runStart;
  for (const node of _logs) {
    if (!node._rlRunning) continue;   // idempotent: first finish wins (some builds
                                      // fire BOTH 'executing'(null) AND success)
    node._rlRunning = false;
    // Successes only — an interrupted / errored run gives a partial, misleading time.
    if (success && start != null) pushHistory(node, performance.now() - start);
    renderList(node);
    if (!isVueNodes()) node.setDirtyCanvas && node.setDirtyCanvas(true, true);
  }
}

let _listenersInstalled = false;
function installRunListeners() {
  if (_listenersInstalled) return;
  _listenersInstalled = true;
  api.addEventListener("execution_start", () => startRun());
  // 'executing' with a null node id = queue item finished (older builds);
  // execution_success covers newer builds.
  api.addEventListener("executing", (e) => {
    const d = e && e.detail;
    const nodeId = (d && typeof d === "object") ? d.node : d;
    if (nodeId == null) finishRun(true);
  });
  api.addEventListener("execution_success", () => finishRun(true));
  api.addEventListener("execution_error", () => finishRun(false));
  api.addEventListener("execution_interrupted", () => finishRun(false));
}

// ── copy to clipboard (works over http LAN via an execCommand fallback) ──────
function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  try { document.body.appendChild(ta); ta.select(); document.execCommand("copy"); }
  catch (_e) { /* ignore */ }
  finally { ta.remove(); }
}
function copyText(text) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  else legacyCopy(text);
}
function copyTimes(node) {
  const hist = getHist(node);
  if (!hist.length) return;
  copyText(hist.map((ms, i) => (i + 1) + ". " + fmtTime(ms)).join("\n"));
}
// Save the list as a plain .txt (user-initiated download of their OWN data).
function exportTxt(node) {
  const hist = getHist(node);
  if (!hist.length) return;
  const body = hist.map((ms, i) => String(i + 1).padStart(2, "0") + ".  " + fmtTime(ms)).join("\n");
  const text = "Run Log - last " + hist.length + (hist.length === 1 ? " run" : " runs") + "\n" + body + "\n";
  try {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "run-log.txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_e) {} }, 1000);
  } catch (e) {
    // Fallback (rare): copy to clipboard so the times aren't lost.
    copyText(text);
  }
}

// A subtle footer icon button (grey mask icon → brand orange on hover). Reuses the
// shared UI SVGs served at /pixaroma/assets/icons/ui/.
function iconBtn(iconFile, title) {
  const b = el("button", "pix-rl-fbtn");
  b.type = "button"; b.title = title;
  const ico = el("span", "pix-rl-ico");
  const url = "url(/pixaroma/assets/icons/ui/" + iconFile + ")";
  ico.style.webkitMaskImage = url; ico.style.maskImage = url;
  b.appendChild(ico);
  return b;
}

// ── CSS (no backticks inside the strings — house convention) ────────────────
let _cssDone = false;
function injectCSS() {
  if (_cssDone || document.getElementById("pix-rl-css")) { _cssDone = true; return; }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-rl-css";
  s.textContent = [
    ".pix-rl-root{display:flex;flex-direction:column;gap:6px;width:100%;height:100%;box-sizing:border-box;padding:0;user-select:none;-webkit-user-select:none;font-family:'Segoe UI',system-ui,sans-serif;}",
    ".pix-rl-cap{display:flex;align-items:center;justify-content:space-between;flex:none;padding:0 2px;height:14px;}",
    ".pix-rl-caplbl{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#6c6960;}",
    ".pix-rl-status{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#57544d;display:flex;align-items:center;gap:5px;}",
    ".pix-rl-running{color:#49c97a;}",
    ".pix-rl-rdot{width:6px;height:6px;border-radius:50%;background:#49c97a;animation:pixRlPulse 1.1s infinite;}",
    "@keyframes pixRlPulse{0%,100%{opacity:1;}50%{opacity:0.25;}}",
    ".pix-rl-screen{flex:1;min-height:0;overflow:hidden;background:#141417;border:1px solid #050506;border-radius:6px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.03),inset 0 0 20px rgba(0,0,0,0.35);padding:5px;box-sizing:border-box;}",
    ".pix-rl-row{display:grid;grid-template-columns:22px 1fr auto;align-items:center;gap:8px;padding:0 8px;border-radius:4px;height:20px;box-sizing:border-box;}",
    ".pix-rl-row:nth-child(even){background:rgba(255,255,255,0.022);}",
    ".pix-rl-idx{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-size:11px;color:#6c6960;text-align:right;}",
    ".pix-rl-meta{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8781;justify-self:start;white-space:nowrap;}",
    ".pix-rl-time{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;font-size:13px;color:#b8b4ad;font-weight:500;}",
    ".pix-rl-row--now{background:rgba(246,103,68,0.16);box-shadow:inset 2px 0 0 #f66744;}",
    ".pix-rl-row--now .pix-rl-time{color:#f66744;font-weight:700;}",
    ".pix-rl-row--now .pix-rl-idx{color:#ff8a63;}",
    ".pix-rl-row--now .pix-rl-meta{color:#f66744;}",
    ".pix-rl-row--best .pix-rl-time{color:#49c97a;font-weight:600;}",
    ".pix-rl-row--best .pix-rl-meta{color:#49c97a;}",
    ".pix-rl-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;}",
    ".pix-rl-empty-t{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-size:13px;color:#7a776f;}",
    ".pix-rl-empty-s{font-size:11px;color:#57544d;}",
    // Footer: two subtle icon buttons, right-aligned (Export .txt, Clear). Grey
    // icon → brand orange on hover (Pixaroma UI convention #13).
    ".pix-rl-foot{display:flex;align-items:center;justify-content:flex-end;gap:2px;flex:none;height:20px;padding:0 2px;}",
    ".pix-rl-fbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:18px;border:0;background:transparent;cursor:pointer;border-radius:4px;padding:0;}",
    ".pix-rl-fbtn:hover{background:rgba(255,255,255,0.06);}",
    ".pix-rl-fbtn:disabled{opacity:0.3;cursor:default;}",
    ".pix-rl-fbtn:disabled:hover{background:transparent;}",
    ".pix-rl-ico{width:13px;height:13px;background-color:#7a776f;-webkit-mask-position:center;mask-position:center;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:contain;mask-size:contain;transition:background-color 0.12s;}",
    ".pix-rl-fbtn:hover:not(:disabled) .pix-rl-ico{background-color:#f66744;}",
    "@media (prefers-reduced-motion:reduce){.pix-rl-rdot{animation:none;}}",
    // Hide any native widget-input dot column beside our DOM widget in Nodes 2.0
    // (the node has no inputs, so there is nothing to plug in).
    ".lg-node:has(.pix-rl-root) .lg-node-widget > *:first-child:empty{display:none;}",
  ].join("\n");
  (document.head || document.documentElement).appendChild(s);
}

// ── node setup ──────────────────────────────────────────────────────────────
function setupNode(node) {
  injectCSS();
  node._rlRunning = false;

  const root = el("div", "pix-rl-root");
  const cap = el("div", "pix-rl-cap");
  const lbl = el("span", "pix-rl-caplbl"); lbl.textContent = "Last 10 runs";
  const status = el("span", "pix-rl-status");
  cap.appendChild(lbl); cap.appendChild(status);
  const screen = el("div", "pix-rl-screen");
  const foot = el("div", "pix-rl-foot");
  const exportBtn = iconBtn("download.svg", "Export the times as a .txt file");
  const clearBtn = iconBtn("delete.svg", "Clear the list");
  exportBtn.addEventListener("click", (e) => { e.stopPropagation(); exportTxt(node); });
  clearBtn.addEventListener("click", (e) => { e.stopPropagation(); clearHistory(node); });
  foot.appendChild(exportBtn); foot.appendChild(clearBtn);
  root.appendChild(cap); root.appendChild(screen); root.appendChild(foot);

  node._pixRlRoot = root;
  node._pixRlScreen = screen;
  node._pixRlStatus = status;
  node._pixRlExportBtn = exportBtn;
  node._pixRlClearBtn = clearBtn;

  installCanvasZoomPassthrough(root);
  const widget = node.addDOMWidget("run_log_ui", "pixaroma_run_log", root, {
    getValue: () => "",
    setValue: () => {},
    getMinHeight: () => WIDGET_MIN_H,
    serialize: false, // history lives on node.properties
  });
  applyAdaptiveCanvasOnly(widget);
  // computeLayoutSize makes the widget an 'auto' grower in Nodes 2.0 so the screen
  // fills the node height; minWidth:1 lets the saved node width round-trip.
  widget.computeLayoutSize = () => ({ minHeight: WIDGET_MIN_H, minWidth: 1 });
  node._pixRlWidget = widget;
  node._pixRlFloorOff = installResizeFloor(root, () => WIDGET_MIN_H);

  // Fresh-drop default size. configure() runs AFTER nodeCreated (Vue Compat #8/#9)
  // and restores the saved size for a loaded workflow / duplicate, so existing
  // nodes keep their size. Mutate size[0/1] (don't replace the array) for Vue's
  // reactive proxy.
  if (Array.isArray(node.size)) { node.size[0] = DEFAULT_W; node.size[1] = DEFAULT_H; }
  else node.size = [DEFAULT_W, DEFAULT_H];

  _logs.add(node);
  // Render after configure restores node.properties (Vue Compat #8). Read-only →
  // dirty-on-load safe.
  queueMicrotask(() => renderList(node));
}

// ── help ─────────────────────────────────────────────────────────────────────
const HELP = {
  title: "Run Log Pixaroma",
  tagline: "Keeps the last 10 run times for this workflow on the canvas.",
  sections: [
    { heading: "What it does", body: "A companion to Run Timer. Every time you press Run it times the whole workflow and adds the finished time to the top of the list. It keeps the last 10, newest first, so you can watch a workflow get faster over a session or notice when a change has made it slower." },
    { heading: "Reading the list", body: "The newest run sits at the top and is highlighted in orange. The fastest of the ten is marked with a lightning bolt in green. Times under a minute show as seconds (for example 14.8s); longer runs show as minutes and seconds (for example 1:23). While a run is going a small green 'running' marker shows in the corner, and the new time drops in on top the moment it finishes." },
    { heading: "This workflow only", body: "The list lives on the node and is saved inside the workflow, so it is only the times for this workflow and it stays with it. Open the workflow again another day and the list is still there. A different workflow keeps its own separate list." },
    { heading: "The two buttons", body: "In the bottom-right corner are two small buttons. The download icon exports the list as a plain .txt file you can save or share. The trash icon clears the list back to 'No runs yet'. The same actions are also on the right-click menu, along with Copy times." },
    { heading: "Right-click options", defs: [
      ["Copy times", "Copies the whole list as plain text, so you can paste it into notes or a message."],
      ["Export as .txt", "Saves the list as a plain text file (same as the download button)."],
      ["Clear Run Log", "Empties the list for this node, back to 'No runs yet' (same as the trash button)."],
    ]},
    { heading: "Good to know", body: "It does not need to be wired to anything; just drop it on the canvas. The node always shows all ten slots and cannot be made too small to read them. Only completed runs are logged; a run you stop or that errors out is skipped. Because the list is saved with the workflow, a small 'unsaved changes' dot appears on the tab after a run, which is normal. It works the same in both the classic and the new node interface." },
  ],
};

app.registerExtension({
  name: "Pixaroma.RunLog",

  setup() {
    installRunListeners();
  },

  getNodeMenuItems(node) {
    // node.type fallback (comfyClass isn't populated on every build/timing).
    if (!node || (node.type !== NODE_NAME && node.comfyClass !== NODE_NAME)) return [];
    const empty = getHist(node).length === 0;
    return [
      null,
      { content: "📋 Copy times", disabled: empty, callback: () => copyTimes(node) },
      { content: "💾 Export as .txt", disabled: empty, callback: () => exportTxt(node) },
      { content: "🧹 Clear Run Log", disabled: empty, callback: () => clearHistory(node) },
    ];
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    if (nodeType.prototype._pixRlPatched) return; // hot-reload: don't double-wrap
    nodeType.prototype._pixRlPatched = true;

    // Re-render from restored node.properties on load. READ-ONLY → dirty-on-load
    // safe (never writes serialized state here).
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure ? _origConfigure.apply(this, arguments) : undefined;
      renderList(this);
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      _logs.delete(this);
      try { if (this._pixRlFloorOff) this._pixRlFloorOff(); } catch (_e) {}
      this._pixRlFloorOff = null;
      if (_origRemoved) return _origRemoved.apply(this, arguments);
    };

    // LEGACY-ONLY min clamps (Nodes 2.0 gotcha #1: clamping node.size in Vue
    // desyncs the layout store → jump-on-switch). Nodes 2.0 floors via
    // installResizeFloor + computeLayoutSize instead.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      if (_origResize) return _origResize.apply(this, arguments);
    };
    const _origFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origFg ? _origFg.apply(this, arguments) : undefined;
      if (ctx && !isVueNodes() && !this.flags?.collapsed) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return r;
    };
  },

  nodeCreated(node) {
    if (node.type !== NODE_NAME && node.comfyClass !== NODE_NAME) return;
    setupNode(node);
  },
});

registerNodeHelp(NODE_NAME, HELP);
