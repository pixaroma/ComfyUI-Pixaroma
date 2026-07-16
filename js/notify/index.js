// Notify Pixaroma - plays a notification sound when the workflow reaches this
// node, AND times how long the run took to get there (a checkpoint timer).
//
// Timing is deliberately independent of the sound: the Python side always emits
// the `pixaroma_notify` event (carrying an `enabled` flag), so this node can
// record its checkpoint time even when the ding is muted. On every Run we stamp
// `_runStart` at `execution_start` and, when this node's `executed` event
// arrives, elapsed = now - _runStart = how long the workflow took to reach here.
// Put one at the end for the total, or branch several mid-graph and the
// differences between them are per-segment times.
//
// The last time is shown on the node face (a serialize:false CANVAS widget, so it
// renders in BOTH the classic and Nodes 2.0 renderers, never eats a click, and
// never saves into the workflow). Each node keeps its OWN history (right-click -> Notify time
// history), stored in a global ComfyUI setting keyed by a stable per-node id
// (node.properties.pixNotifyId). The recorded TIMES live in the setting, not on
// the node, so they stay local to this machine and do not travel in a shared
// workflow. Only the tiny id tag lives on the node - minted once (on a fresh
// drop, or on first Run for a node saved by an older version) and stable after.
// A duplicated node gets a fresh id (its own empty history), mirroring the Crop
// node's dedupe. Timing can be switched off per node from the right-click menu.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import {
  openNotifyHistory,
  closeNotifyHistoryFor,
  refreshNotifyHistory,
  fmtDur,
} from "./history.mjs";

const NODE_NAME = "NotifyPixaroma";
const ID_PROP = "pixNotifyId";
const TIMING_PROP = "pixNotifyTiming"; // per-node: false = timing off (default on)
const FOLD_PROP = "pixNotifyCollapsed"; // per-node, UI-only; Python ignores it
const READOUT_NAME = "pixaroma_notify_time";
const MASTER_ID = "Pixaroma.Notify.Enabled"; // master sound switch (registered below)

// Per-node time history lives in an unregistered ComfyUI setting (these persist
// - Vue Compat #20). One object keyed by pixNotifyId: { [id]: {ms,name,at}[] }.
// It never touches node.properties, so recording a time can't dirty a saved
// workflow, and it survives reloads. Local to this machine (not shared in the
// exported workflow), which is why it is per-node id rather than in the file.
const HISTORY_SETTING = "Pixaroma.Notify.History";
const HISTORY_MAX = 10;  // times kept per node
const MAX_NODES = 200;   // distinct node ids tracked before pruning the stalest

// ── run origin (shared by every Notify node on the canvas) ───────────────────
let _runStart = null;               // performance.now() at execution_start
const _recordedThisRun = new Set(); // pixNotifyIds already recorded this run
let _listenersInstalled = false;    // guard against hot-reload double-wiring

function mintId() {
  return "notify_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

function ensureId(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[ID_PROP]) node.properties[ID_PROP] = mintId();
  return node.properties[ID_PROP];
}

function isTimingOn(node) {
  return !(node && node.properties && node.properties[TIMING_PROP] === false);
}

function setTiming(node, on) {
  if (!node.properties) node.properties = {};
  node.properties[TIMING_PROP] = !!on;
  updateReadout(node);
}

// ── master sound switch (GLOBAL) ─────────────────────────────────────────────
// The same switch as Settings -> Pixaroma -> Notify -> Enabled, also offered on
// the node's right-click menu (Run Timer does the same with its global mute, and
// the node menu is simply quicker to reach than the Settings dialog). It lives in
// a setting, never node.properties, so muting can't dirty a workflow.
function isMasterOn() {
  try { return app.ui.settings.getSettingValue(MASTER_ID) !== false; }
  catch (_e) { return true; }
}
function setMasterOn(on) {
  try {
    const s = app.ui.settings;
    const r = s.setSettingValueAsync
      ? s.setSettingValueAsync(MASTER_ID, !!on)
      : s.setSettingValue(MASTER_ID, !!on);
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (e) {
    console.warn("[Notify Pixaroma] could not save the mute setting:", e?.message || e);
  }
}

// ── fold (compact node) ──────────────────────────────────────────────────────
// Mirrors the Sizes node's chevron fold: a small arrow folds the node down to
// just the clock, hiding the sound controls. UI-only state on node.properties -
// Python never reads it.
function isFolded(node) {
  return !!(node && node.properties && node.properties[FOLD_PROP]);
}

// Hide/restore the sound widgets (see setWidgetHidden for the two flags the two
// renderers actually read). The clock row is never folded away - it is the thing
// worth keeping.
function applyFold(node) {
  const folded = isFolded(node);
  // Hiding a widget does NOT hide its widget-input socket. `hidden` is a no-op on
  // an input (nothing in the frontend reads it - socket visibility is decided by
  // mouseOver/isConnected), and a folded widget keeps its PRE-fold y, so those
  // sockets freeze on top of the folded body and hit-test BEFORE widgets: hovering
  // there pops phantom dots and a click drags a link out. What IS read is
  // `slot.pos` (calculateInputSlotPosFromSlot prefers it), and a widget-input
  // serializes as {widget:{name}} only - never pos - so parking it far off-body
  // while folded is save-safe. A WIRED socket is left alone: its link must stay
  // visible and reachable.
  for (const inp of node.inputs || []) {
    if (!inp || !inp.widget) continue; // the real 'any' input is never a widget
    if (folded) {
      if (inp.link != null) continue;
      if (!inp._pixNtFolded) {
        inp._pixNtFolded = true;
        inp._pixNtPrevPos = inp.pos;
      }
      inp.pos = [-10000, -10000]; // off-body: unhittable, undrawable
    } else if (inp._pixNtFolded) {
      if (inp._pixNtPrevPos) inp.pos = inp._pixNtPrevPos;
      else delete inp.pos; // let the layout recompute it
      delete inp._pixNtPrevPos;
      delete inp._pixNtFolded;
    }
  }
  for (const w of node.widgets || []) {
    if (!w || w.name === READOUT_NAME) continue;
    setWidgetHidden(w, folded);
  }
}

// The two renderers read DIFFERENT flags, so both must be written:
//   w.hidden          -> the legacy canvas (LGraphNode.isWidgetVisible reads the
//                        widget property, and computeSize consults it for the refit)
//   w.options.hidden  -> Nodes 2.0 (the Vue mapper snapshots options.hidden; the
//                        widget property is deliberately NOT a fallback there)
// ComfyUI's own hide code dual-writes the same way. Do NOT use options.canvasOnly
// for this: it means "never render as Vue" and it collides with the getter that
// applyAdaptiveCanvasOnly installs.
function setWidgetHidden(w, hidden) {
  if (!w.options) w.options = {};
  if (hidden) {
    if (w._pixNtFolded) return;
    w._pixNtFolded = true;
    w._pixNtPrevComputeSize = w.computeSize ?? null;
    w._pixNtPrevHidden = w.hidden;
    w.hidden = true;
    w.options.hidden = true;
    w.computeSize = () => [0, -4]; // legacy row collapse
  } else if (w._pixNtFolded) {
    w.hidden = w._pixNtPrevHidden ?? false;
    w.options.hidden = false;
    if (w._pixNtPrevComputeSize) w.computeSize = w._pixNtPrevComputeSize;
    else delete w.computeSize;
    delete w._pixNtPrevComputeSize;
    delete w._pixNtPrevHidden;
    delete w._pixNtFolded;
  }
}

// Nodes 2.0 wraps node.widgets in a shallowReactive array and SNAPSHOTS each
// widget's display options, so mutating a widget object in place changes nothing
// on screen. Only array-level writes trigger, and an identical reassign is gated
// out by Vue's hasChanged - so bounce through empty to force a real re-map.
// Vue only: in legacy node.widgets is a plain array with no setter, and this
// would simply wipe the widgets.
function invalidateVueWidgets(node) {
  if (!isVueNodes()) return;
  try {
    const snap = [...(node.widgets || [])]; // plain copy first: the getter hands back the live proxy
    node.widgets = [];
    node.widgets = snap;
  } catch (_e) {}
}

// Repaint a canvas widget. setDirtyCanvas only dirties the LiteGraph canvas -
// in Nodes 2.0 each canvas widget owns its own <canvas> element and repaints
// ONLY via the triggerDraw handle the Vue bridge assigns on mount. It is
// undefined in legacy, so this one call covers both renderers. Never cache the
// reference: it is reset to a no-op on unmount.
function repaintWidgets(node) {
  try {
    node.widgets?.forEach((w) => w.triggerDraw?.());
    node.setDirtyCanvas?.(true, true);
  } catch (_e) {}
}

// Re-fit the node height to its content. Never on the load path (writing size
// would open a saved workflow "modified" - Sizes' fitToContent does the same);
// the saved height already matches the saved fold state. Width is left alone so
// a manual widen sticks.
// Nodes 2.0 never auto-shrinks when a row disappears (the body floors at
// min-h-(--node-height), so the stored height keeps it tall), and computeSize()
// is meaningless there. Measure with the frontend's own collapse trick: pin
// --node-height to 0, read the natural height, put it back. Undershooting is
// safe - min-h clamps at the content, it cannot clip.
function measureVueBodyH(node) {
  const el = document.querySelector('.lg-node[data-node-id="' + node.id + '"]');
  if (!el) return null;
  const prev = el.style.getPropertyValue("--node-height");
  el.style.setProperty("--node-height", "0px");
  const px = el.getBoundingClientRect().height; // screen px
  el.style.setProperty("--node-height", prev || "");
  const scale = (app.canvas && app.canvas.ds && app.canvas.ds.scale) || 1;
  const h = px / scale; // -> graph units
  return h - (window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30); // the var excludes the title
}

function fitNotifyNode(node) {
  // Never on the load path, and never while LiteGraph title-collapsed: every
  // widget reads invisible then, so computeSize returns just the slot rows and we
  // would write a bogus ~20px body height over the real one.
  if (isGraphLoading() || node.flags?.collapsed) return;
  const w = node.size?.[0];
  // setSize (whole-array) is required in both: writing node.size[1] bypasses the
  // Vue layout store, which only bridges through the `size` setter.
  if (isVueNodes()) {
    // one frame later, so the hidden rows are actually gone before we measure
    requestAnimationFrame(() => {
      try {
        const h = measureVueBodyH(node);
        if (h > 0) node.setSize([w, Math.round(h)]);
      } catch (_e) {}
    });
    return;
  }
  try {
    const cs = node.computeSize?.();
    if (cs && cs[1] > 0) node.setSize([w, Math.round(cs[1])]);
  } catch (_e) {}
}

function toggleFold(node) {
  if (!node.properties) node.properties = {};
  node.properties[FOLD_PROP] = !isFolded(node);
  applyFold(node);
  invalidateVueWidgets(node); // without this the fold is invisible in Nodes 2.0
  fitNotifyNode(node);
  repaintWidgets(node);
}

// Give a DUPLICATE its own id (and therefore its own empty history); a plain
// reload keeps its saved id. Mirrors the Crop node's onConfigure dedupe: a
// copy/paste runs OUTSIDE loadGraphData (so isGraphLoading() is false) while the
// pasted clone still carries the parent's id and the parent is live -> collision
// -> re-mint. A clean load never has two nodes sharing an id, so it is a no-op.
function dedupeNotifyId(node) {
  try {
    const myId = node.properties && node.properties[ID_PROP];
    if (!myId) return;
    const g = node.graph || app.graph;
    const nodes = (g && (g._nodes || g.nodes)) || [];
    const collides = nodes.some(
      (n) => n !== node && n && n.comfyClass === node.comfyClass &&
             n.properties && n.properties[ID_PROP] === myId
    );
    if (!collides) return;
    node.properties[ID_PROP] = mintId();
  } catch (e) {
    console.warn("[Notify Pixaroma] dedupe id failed:", e?.message || e);
  }
}

// ── per-node history storage ─────────────────────────────────────────────────
// Authoritative in-memory copy of the whole history object. Several Notify
// nodes can record within ONE run ("branch several mid-graph"). If each node
// re-read the setting, an async persist that has not landed yet would let the
// next node read a stale object and clobber the previous node's entry. So all
// reads/writes go through this cache synchronously; the setting write is a
// side effect.
let _histCache = null;
function getAllHistory() {
  if (_histCache) return _histCache;
  try {
    const raw = app.ui?.settings?.getSettingValue?.(HISTORY_SETTING);
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    _histCache = obj && typeof obj === "object" ? obj : {};
  } catch (_e) { _histCache = {}; }
  return _histCache;
}
function saveAllHistory(obj) {
  _histCache = obj && typeof obj === "object" ? obj : {};
  try {
    const s = app.ui?.settings;
    const json = JSON.stringify(_histCache);
    // setSettingValueAsync is absent on older builds - fall back to the sync API.
    // Catch the promise: a rejection cannot be caught by the enclosing try.
    const r = s?.setSettingValueAsync
      ? s.setSettingValueAsync(HISTORY_SETTING, json)
      : s?.setSettingValue?.(HISTORY_SETTING, json);
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (_e) {}
}
function getNodeHistory(id) {
  const arr = getAllHistory()[id];
  return Array.isArray(arr) ? arr.filter((e) => e && isFinite(Number(e.ms))) : [];
}
// Keep the object from growing forever as nodes are created and deleted: past
// MAX_NODES ids, drop the ones whose most-recent time is oldest.
function pruneNodes(all) {
  const ids = Object.keys(all);
  if (ids.length <= MAX_NODES) return;
  const recency = ids.map((id) => {
    const list = all[id] || [];
    let m = 0;
    for (const e of list) { const t = Number(e && e.at) || 0; if (t > m) m = t; }
    return [id, m];
  }).sort((a, b) => b[1] - a[1]);
  for (const pair of recency.slice(MAX_NODES)) delete all[pair[0]];
}
function recordNodeHistory(id, ms, name) {
  const dur = Number(ms);
  if (!id || !isFinite(dur) || dur < 0) return;
  const all = getAllHistory();
  const list = Array.isArray(all[id]) ? all[id] : [];
  const entry = {
    ms: Math.round(dur),
    name: (typeof name === "string" && name) ? name : "Notify",
    at: Date.now(),
  };
  all[id] = [entry, ...list].slice(0, HISTORY_MAX);
  pruneNodes(all);
  saveAllHistory(all);
  refreshNotifyHistory(); // live-update the panel if it happens to be open
}
function clearNodeHistory(id) {
  const all = getAllHistory();
  if (all[id]) { delete all[id]; saveAllHistory(all); }
  refreshNotifyHistory();
}

// ── copy-to-clipboard (works over http LAN via an execCommand fallback) ──────
function copyToClipboard(text, flash) {
  const legacyCopy = () => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    let ok = false;
    try { document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); }
    catch (_e) { ok = false; }
    finally { ta.remove(); }
    flash(ok);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => flash(true)).catch(legacyCopy);
  else legacyCopy();
}

function openNotifyHistoryPanel(node) {
  const id = ensureId(node);
  openNotifyHistory(node, {
    getHistory: () => getNodeHistory(id),
    clearHistory: () => clearNodeHistory(id),
    copyToClipboard,
  });
}

// ── on-node readout (canvas custom widget, both renderers, never serialized) ──
// addCustomWidget rather than a DOM widget (the Preview node's precedent, and
// the same reason Run Timer paints its classic clock on canvas): LiteGraph
// RESERVES the vertical space, so the readout always sits inside the node body;
// it repaints with the widget area; it stays crisp at any zoom; and - being
// canvas rather than an HTML element sitting on top of the node - it cannot
// swallow a right-click or a drag. A DOM widget is sized 0x0 by the classic
// renderer, which pushed the readout outside the node frame. draw() reads the
// live state, so there is nothing to keep in sync.
const READOUT_H = 18;

// Click target for the fold arrow, measured from the row's RIGHT edge (see draw).
// EDGE_PAD keeps the box inside the band LiteGraph actually routes to a widget -
// getWidgetOnPos only matches node-local x in [6, size[0]-6), so a hit box flush
// with the right edge would have a dead outer sliver.
const CHEV_HIT_W = 30;
const CHEV_EDGE_PAD = 6;

function createReadoutWidget() {
  return {
    name: READOUT_NAME,
    type: "custom",
    value: null,
    serialize: false, // transient; never saves into the workflow
    options: {},
    computeSize(width) {
      return [width, READOUT_H];
    },
    draw(ctx, node, widget_width, y) {
      try {
        if (node.flags?.collapsed) return; // LiteGraph's own title-bar collapse
        const folded = isFolded(node);
        const on = isTimingOn(node);
        const ms = node._pixNtLastMs;
        // A silent node must not look identical to a working one - especially
        // folded, where the enabled widget is hidden. Show a mute marker when the
        // ding would not play, whether that is this node's own sound toggle or the
        // master switch. draw() reads live state, so this costs nothing.
        const enabledW = node.widgets && node.widgets.find((w) => w.name === "enabled");
        const muted = (enabledW && enabledW.value === false) || !isMasterOn();
        const text =
          (muted ? "🔇 " : "") +
          (on
            ? "⏱ " + (typeof ms === "number" && isFinite(ms) ? fmtDur(ms) : "--:--.---")
            : "⏱ timer off");
        const mid = y + READOUT_H / 2;
        ctx.save();
        ctx.textBaseline = "middle";
        // Fold arrow on the RIGHT edge. Not the left: that is the input-socket
        // column, and ComfyUI RE-REVEALS widget-input sockets whenever the node is
        // hovered - so a left-hand arrow sits under them and the click drags a
        // link out instead of folding. Notify has no outputs, so the right edge is
        // free. Big enough to be an easy target: it is the only way back out of a
        // folded node.
        ctx.font = "16px 'Segoe UI',system-ui,sans-serif";
        ctx.fillStyle = node._pixNtChevHover ? "#ffffff" : "#9a9a9a";
        ctx.textAlign = "center";
        ctx.fillText(folded ? "▸" : "▾", widget_width - CHEV_EDGE_PAD - CHEV_HIT_W / 2, mid);
        // clock
        ctx.font = "12px ui-monospace,Consolas,'DejaVu Sans Mono',monospace";
        ctx.fillStyle = on ? "#cfcfcf" : "#7a7a7a";
        ctx.textAlign = "center";
        ctx.fillText(text, widget_width / 2, mid);
        ctx.restore();
        // hit box for mouse(), in the same node-space coords draw() is given
        node._pixNtChevRect = {
          x: widget_width - CHEV_EDGE_PAD - CHEV_HIT_W,
          y,
          w: CHEV_HIT_W,
          h: READOUT_H,
        };
      } catch (_e) {}
    },
    // LiteGraph routes clicks inside the widget's bounds here (pos is node-space,
    // matching the rect stashed by draw). Return true to consume the click so it
    // does not also start a node drag. NOTE: only clicks - a widget's mouse() sees
    // moves ONLY while a button is held (the Preview node documents the same), so
    // hover is tracked at node level instead (onMouseMove / onMouseLeave).
    mouse(event, pos, node) {
      const type = event?.type;
      if (type !== "pointerdown" && type !== "mousedown") return false;
      const r = node._pixNtChevRect;
      if (!r) return false;
      const inChev =
        pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h;
      if (!inChev) return false;
      toggleFold(node);
      return true;
    },
  };
}

function inChevRect(node, pos) {
  const r = node && node._pixNtChevRect;
  return !!r && !!pos &&
    pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h;
}

function setChevHover(node, on) {
  if (!!node._pixNtChevHover === !!on) return;
  node._pixNtChevHover = !!on;
  repaintWidgets(node);
}

// The widget draws from live state, so "updating" it is just asking for a repaint.
function updateReadout(node) {
  repaintWidgets(node);
}

// ── sound ────────────────────────────────────────────────────────────────────
async function playSound(filename, volume01) {
  if (typeof filename !== "string" || !filename) return;
  const url = `/pixaroma/assets/sounds/${encodeURIComponent(filename)}`;
  const audio = new Audio(url);
  const v = Number(volume01);
  audio.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
  try {
    await audio.play();
  } catch (e) {
    console.warn("[Notify Pixaroma] playback failed:", e?.message || e);
  }
}

app.registerExtension({
  name: "Pixaroma.Notify",

  settings: [
    {
      id: MASTER_ID,
      name: "Enabled",
      type: "boolean",
      defaultValue: true,
      tooltip:
        "Master switch for all Notify Pixaroma sounds. When off, no Notify node plays sound (checkpoint timers still record).",
      category: ["👑 Pixaroma", "Notify"],
    },
  ],

  setup() {
    if (_listenersInstalled) return;
    _listenersInstalled = true;

    // One run-level origin per Run (same trick as Run Timer). Reset the
    // per-run record guard so each node records at most once per Run.
    api.addEventListener("execution_start", () => {
      _runStart = performance.now();
      _recordedThisRun.clear();
    });

    api.addEventListener("executed", (e) => {
      const detail = e && e.detail;
      const out = detail && detail.output && detail.output.pixaroma_notify;
      if (!Array.isArray(out) || out.length === 0) return;

      // Resolve the firing node. detail.node is usually a number; some builds
      // send a numeric string. Only coerce a pure-digit string - a subgraph
      // path id like "12:5" must NOT be truncated to a wrong root node.
      let node = app.graph?.getNodeById?.(detail.node);
      if (!node && typeof detail.node === "string" && /^\d+$/.test(detail.node)) {
        node = app.graph?.getNodeById?.(parseInt(detail.node, 10));
      }
      // Confirm we resolved OUR node type - a mis-resolved id must never write
      // timing state onto some unrelated node.
      const isNotify =
        !!node && (node.comfyClass === NODE_NAME || node.type === NODE_NAME);

      // Master sound switch (isMasterOn reads defensively, so a settings hiccup
      // can never take timing down with it).
      const masterOn = isMasterOn();

      for (const ev of out) {
        // 1) Checkpoint timing - independent of the sound. The on-node readout
        // is per-node object state, so it updates on every fire; the history
        // entry is recorded at most once per Run (guarded by pixNotifyId).
        if (isNotify && _runStart != null && isTimingOn(node)) {
          const id = ensureId(node);
          // FIRST reach wins, for the face as well as the history - so the number
          // on the node and the history's newest row always agree, even if a node
          // is somehow reached twice in one Run.
          if (id && !_recordedThisRun.has(id)) {
            _recordedThisRun.add(id);
            const ms = performance.now() - _runStart;
            node._pixNtLastMs = ms;
            updateReadout(node);
            const name =
              (ev.label || "").trim() ||
              (ev.sound ? String(ev.sound).replace(/\.[^.]+$/, "") : "Notify");
            recordNodeHistory(id, ms, name);
          }
        }

        // 2) Sound - gated on the per-node sound toggle AND the master switch.
        if (ev.enabled !== false && masterOn) {
          console.log(
            `[Notify Pixaroma] ▶ ${ev.label}  (${ev.sound} @ ${ev.volume}%)`
          );
          playSound(ev.sound, (ev.volume ?? 80) / 100);
        }
      }
    });

    // Clear the run origin when a run ends, so a stray 'executed' arriving with
    // no fresh 'execution_start' can never be timed against a stale origin.
    const endRun = () => { _runStart = null; };
    api.addEventListener("execution_success", endRun);
    api.addEventListener("execution_error", endRun);
    api.addEventListener("execution_interrupted", endRun);
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    // Guard against re-registration (dev hot-reload) double-wrapping the
    // prototype hooks, which would stack a 2nd Preview button + readout widget.
    if (nodeType.prototype._pixNotifyPatched) return;
    nodeType.prototype._pixNotifyPatched = true;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onCreated?.apply(this, arguments);

      // Preview button (existing behaviour) - bypasses both toggles.
      this.addWidget("button", "▶ Preview", null, () => {
        const sound = this.widgets.find((w) => w.name === "sound")?.value;
        const volume = this.widgets.find((w) => w.name === "volume")?.value ?? 80;
        if (sound) playSound(sound, volume / 100);
      });

      // Mint a stable id for FRESH drops only. Restored / pasted nodes get theirs
      // from configure() (+ dedupe re-mints a paste). Skip during load so a
      // reload never churns the id or dirties the workflow.
      if (!this.properties) this.properties = {};
      if (!isGraphLoading() && !this.properties[ID_PROP]) {
        this.properties[ID_PROP] = mintId();
      }

      // Canvas readout - LiteGraph reserves its row, so it renders inside the
      // node body and never eats a click.
      try {
        applyAdaptiveCanvasOnly(this.addCustomWidget(createReadoutWidget()));
      } catch (e) {
        console.warn("[Notify Pixaroma] readout widget failed:", e?.message || e);
      }
    };

    // Duplicate detection + reflect restored timing state (Vue Compat #11:
    // onConfigure fires AFTER properties are restored; defer with queueMicrotask
    // so a pasted clone is fully attached and its sibling is live before we scan).
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const ret = onConfigure?.apply(this, arguments);
      queueMicrotask(() => { if (!isGraphLoading()) dedupeNotifyId(this); });
      // Restore the saved fold. Deliberately no re-fit here: the saved height
      // already matches the saved fold state, and writing size on the load path
      // would open the workflow "modified". The invalidate is required for the
      // same reason toggleFold needs it - applyFold only mutates widget fields,
      // which Nodes 2.0 never re-reads - and it is dirty-safe: the array keeps
      // the same widgets, so widgets_values is unchanged.
      queueMicrotask(() => {
        applyFold(this);
        invalidateVueWidgets(this);
        updateReadout(this);
      });
      return ret;
    };

    // Fold-arrow hover, tracked at node level (see the readout's mouse() note).
    // onMouseLeave is what stops the highlight sticking on when the pointer exits
    // past the right edge, which is exactly where the arrow lives.
    // Legacy only: in Nodes 2.0 onMouseMove hands back node-local GRAPH coords,
    // while draw() there is called with y=1, so _pixNtChevRect lives in
    // widget-canvas space and the two cannot be compared. The highlight is purely
    // cosmetic, so it is skipped there rather than chased.
    const onMouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (e, pos) {
      if (!isVueNodes()) setChevHover(this, inChevRect(this, pos));
      return onMouseMove?.apply(this, arguments);
    };
    const onMouseLeave = nodeType.prototype.onMouseLeave;
    nodeType.prototype.onMouseLeave = function () {
      setChevHover(this, false);
      return onMouseLeave?.apply(this, arguments);
    };

    // Close this node's history panel when the node is deleted.
    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try { closeNotifyHistoryFor(this); } catch (_e) {}
      return onRemoved?.apply(this, arguments);
    };
  },

  getNodeMenuItems(node) {
    if (!node || (node.comfyClass !== NODE_NAME && node.type !== NODE_NAME)) return [];
    const timing = isTimingOn(node);
    const folded = isFolded(node);
    const masterOn = isMasterOn();
    // ComfyUI has no checkable menu item, so the label carries the state and is
    // rebuilt on every right-click (the Seed node's idiom).
    return [
      null, // separator
      { content: folded ? "▾ Expand" : "▸ Collapse", callback: () => toggleFold(node) },
      { content: (timing ? "☑ Record time" : "☐ Record time"), callback: () => setTiming(node, !timing) },
      { content: "⏱ Notify time history", callback: () => openNotifyHistoryPanel(node) },
      {
        content: masterOn ? "🔇 Mute all Notify sounds" : "🔊 Unmute all Notify sounds",
        callback: () => setMasterOn(!masterOn),
      },
    ];
  },
});
