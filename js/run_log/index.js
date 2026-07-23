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
// Longest per-run label. One line, clipped with an ellipsis when the row is too
// narrow (full text lives in the row tooltip).
const LABEL_MAX = 60;

// The panel always shows all 10 rows — the MIN height fits caption + 10 rows +
// footer, so the node can't be dragged small enough to clip runs (user feedback).
// Default = minimum (convention #5); width is still free, taller is harmless. Both
// heights are CONSTANTS → dirty-on-load safe (byte-identical every save/load).
// The screen is sized to EXACTLY the 10 rows and no more (flex:none, not flex:1).
// It used to stretch to fill the node, which left a black strip under the last
// row - measured at 20.7px, almost a whole row (user feedback, 2026-07-23). A
// fixed height means that strip cannot come back at any node size: spare height
// now sits outside the panel, as node background, instead of inside it as dead
// black. box-sizing is border-box, so this height INCLUDES the 5px padding and
// the 1px border: 10*20 + 10 + 2 = 212 → a 200px content box = exactly 10 rows.
const ROW_H = 20;
const SCREEN_H = HISTORY_MAX * ROW_H + 12;
// caption(14) + gap(6) + screen + gap(6) + footer(20).
// WHICH floor actually protects row 10 differs per renderer, and the comment
// that used to sit here named the wrong one (review, 2026-07-23):
//   Nodes 2.0 - getMinHeight / computeLayoutSize + installResizeFloor. Our widget
//     is an 'auto' grid track and every child is flex:none, so the node grows to
//     fit its content and the drag floor is pinned during a resize.
//   LEGACY    - the MIN_H clamp below, NOT getMinHeight. LiteGraph's DOM-widget
//     auto-grow converges on node.size[1] = WIDGET_MIN_H + 2, and getBounding
//     then hands the ELEMENT computedHeight - 2*margin, i.e. WIDGET_MIN_H - 20:
//     20px SHORT of the content. getMinHeight alone would clip row 10; MIN_H is
//     what actually delivers the full height.
const WIDGET_MIN_H = SCREEN_H + 46;      // 258
// Legacy chrome between node.size[1] and the widget element: widgets_start_y (2)
// + the DOM widget margin twice (10 each). NOT the title bar - node.size[1]
// EXCLUDES it (bodyHeight === size[1]), so a build with a taller title bar does
// not change this. Do NOT "correct" it to a NODE_TITLE_HEIGHT.
const NODE_CHROME_H = 22;
// Cushion so a future LiteGraph margin change degrades into a few px of node
// background under the panel instead of pushing the footer buttons out through
// the bottom of the node onto the canvas. .pix-rl-root also clips as a backstop.
const SAFETY_PAD = 4;
const DEFAULT_W = 300;   // room for a label; existing nodes keep their saved width
const DEFAULT_H = WIDGET_MIN_H + NODE_CHROME_H + SAFETY_PAD;   // 284
const MIN_W = 200;
const MIN_H = DEFAULT_H;

// ── DOM helper ──────────────────────────────────────────────────────────────
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

// ── time formatting ─────────────────────────────────────────────────────────
// Under a minute → seconds with one decimal (14.8s). A minute or more → m:ss
// (1:23). Math.floor so a float ms never leaks raw decimals.
function fmtTime(ms) {
  const s = ms / 1000;
  // Decide the format on the ROUNDED value: a hair under a minute (e.g. 59.96s)
  // would otherwise show "60.0s" (toFixed(1) rounds up) instead of flipping to "1:00".
  const r = Math.round(s * 10) / 10;
  if (r < 60) return r.toFixed(1) + "s";
  const total = Math.round(s);
  const m = Math.floor(total / 60), sec = total % 60;
  if (m < 60) return m + ":" + String(sec).padStart(2, "0");
  return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
}

// ── history (per node, on node.properties) ──────────────────────────────────
// An entry is { ms, label }. v1 (v1.4.54 and earlier) stored a BARE ms number,
// so getHist normalises both shapes on read and a bare number reads as an
// unlabelled entry. It deliberately NEVER writes the normalised form back: the
// load path must stay read-only or a plain open would dirty the workflow
// (Pattern #3, Vue Compat #18). Old entries are rewritten in the new shape only
// when a write was going to happen anyway - a finished run, a label edit, Clear.
function normEntry(e) {
  if (typeof e === "number") {
    return isFinite(e) && e >= 0 ? { ms: e, label: "" } : null;
  }
  if (e && typeof e === "object" && typeof e.ms === "number" && isFinite(e.ms) && e.ms >= 0) {
    // Normalise on READ exactly as setLabel normalises on write, so the two can
    // never disagree. A whitespace-only label (hand-edited file, or a future
    // writer that bypasses setLabel) would otherwise be truthy: the row would
    // show nothing AND lose its "add note" placeholder, and the row tooltip
    // would gain an empty segment.
    const label = typeof e.label === "string"
      ? e.label.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX) : "";
    return { ms: e.ms, label };
  }
  return null;
}
function getHist(node) {
  const raw = node.properties && node.properties[HIST_PROP];
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    const n = normEntry(e);
    if (n) out.push(n);
    if (out.length >= HISTORY_MAX) break;
  }
  return out;
}
function pushHistory(node, ms) {
  const dur = Math.round(Number(ms));
  if (!isFinite(dur) || dur < 0) return;
  const next = [{ ms: dur, label: "" }, ...getHist(node)].slice(0, HISTORY_MAX);
  if (!node.properties) node.properties = {};
  node.properties[HIST_PROP] = next;
}
// Write one entry's label. No-op when nothing actually changes, so opening an
// editor and pressing Escape (or clicking away untouched) never dirties the
// workflow. A real change does dirty it - same accepted precedent as recording
// a run (Pattern #3).
function setLabel(node, i, text) {
  const hist = getHist(node);
  if (!(i >= 0 && i < hist.length)) return;
  const label = String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  if (hist[i].label === label) return;
  hist[i] = { ms: hist[i].ms, label };
  if (!node.properties) node.properties = {};
  node.properties[HIST_PROP] = hist;
  renderList(node);
  if (!isVueNodes()) node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}
function clearHistory(node) {
  node._pixRlCommitEdit?.();   // see the note on exportTxt
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
  for (let i = 1; i < hist.length; i++) if (hist[i].ms < hist[bestIdx].ms) bestIdx = i;

  hist.forEach((entry, i) => {
    const isNow = i === 0;
    const isBest = i === bestIdx;
    const row = el("div", "pix-rl-row" + (isNow ? " pix-rl-row--now" : (isBest ? " pix-rl-row--best" : "")));
    const idx = el("span", "pix-rl-idx"); idx.textContent = String(i + 1).padStart(2, "0");
    // Fixed-width marker column: the bolt marks the fastest. Keeping it its own
    // column means labels stay aligned whether or not a row carries a bolt.
    const mark = el("span", "pix-rl-mark"); mark.textContent = isBest ? "⚡" : "";
    // The label owns the middle of the row (it replaced the LAST / BEST words -
    // both states are already carried by the orange bar and the bolt + colour).
    const lbl = el("span", "pix-rl-lbl" + (entry.label ? "" : " pix-rl-lbl--empty"));
    lbl.textContent = entry.label;
    const time = el("span", "pix-rl-time"); time.textContent = fmtTime(entry.ms);

    // The words are gone, so name the state in the tooltip - the information
    // must not be colour-only.
    const state = isNow ? (isBest ? "Newest run, and the fastest of the ten" : "Newest run")
                        : (isBest ? "Fastest of the ten" : "");
    row.title = [state, entry.label, "Double-click to add a note"]
      .filter(Boolean).join(" — ");

    row.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startEdit(node, i);
    });

    row.appendChild(idx); row.appendChild(mark); row.appendChild(lbl); row.appendChild(time);
    screen.appendChild(row);
  });
}

// ── inline label editor ─────────────────────────────────────────────────────
// Swaps the label cell for a focused text input. Enter / blur commit, Escape
// reverts, empty clears the label. node._pixRlCommitEdit lets the run lifecycle
// flush an in-progress edit BEFORE a new run shifts every index (see finishRun).
function startEdit(node, i) {
  // Flush any other open editor FIRST - committing can rebuild the whole screen,
  // which would detach the row element. Only then resolve the row, by INDEX, so
  // we always act on the live DOM. (Capturing the cell first left the editor
  // inserted into an orphaned row: focus() silently no-ops, the double-click
  // appears dead, and because the input never gains focus the next keystrokes
  // reach ComfyUI's canvas shortcuts - Delete would remove the node.)
  node._pixRlCommitEdit?.();
  const screen = node._pixRlScreen;
  const row = screen && screen.children[i];
  const cell = row && row.querySelector(".pix-rl-lbl");
  if (!cell) return;                       // no such row, or already editing it
  const hist = getHist(node);
  const cur = hist[i] ? hist[i].label : "";
  // Identity of the run being edited, so commit can tell whether the list moved.
  const msAtOpen = hist[i] ? hist[i].ms : null;

  const input = el("input", "pix-rl-lblin");
  input.type = "text";
  input.maxLength = LABEL_MAX;
  input.value = cur;
  input.placeholder = "what was different?";
  input.spellcheck = false;
  cell.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    node._pixRlCommitEdit = null;
    // Only write if index i STILL means the run that was being edited. Test the
    // ENTRY (its time), not input.isConnected: a detached input does not imply a
    // shifted list - Nodes 2.0 re-parents the widget root, which would throw the
    // text away for nothing - and a shifted list does not imply a detached input.
    // No renderList in this branch: whatever moved the list is mid-rebuild and
    // will draw the row correctly (re-rendering here can duplicate the rows).
    const now = getHist(node);
    if (!now[i] || now[i].ms !== msAtOpen) return;
    setLabel(node, i, save ? input.value : cur);
    renderList(node);   // also restores the cell when setLabel was a no-op
  };
  node._pixRlCommitEdit = () => commit(true);

  // Keep typing away from ComfyUI's canvas shortcuts, and clicks from starting a
  // node drag or re-triggering the row's dblclick.
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    else if (e.key === "Escape") { e.preventDefault(); commit(false); }
  });
  input.addEventListener("blur", () => commit(true));
  for (const ev of ["mousedown", "pointerdown", "dblclick", "click"]) {
    input.addEventListener(ev, (e) => e.stopPropagation());
  }
}

// ── run lifecycle (drives every Run Log on the canvas) ──────────────────────
// Each live node stamps the run origin on itself at start (node._rlRunStart), the
// same way Run Timer does (node._rtStart), so a node's recorded time is always
// measured from the origin captured when its own run began. ComfyUI runs the queue
// sequentially (one execution_start per finish), so runs don't overlap in practice.
const _logs = new Set();
let _runStart = null;

function startRun() {
  _runStart = performance.now();
  for (const node of _logs) {
    node._pixRlCommitEdit?.();   // renderList below would discard an open editor
    node._rlRunning = true;
    node._rlRunStart = _runStart; // stamp the origin on the node (Run Timer parity)
    renderList(node);
    if (!isVueNodes()) node.setDirtyCanvas && node.setDirtyCanvas(true, true);
  }
}
function finishRun(success) {
  for (const node of _logs) {
    if (!node._rlRunning) continue;   // idempotent: first finish wins (some builds
                                      // fire BOTH 'executing'(null) AND success)
    // Flush an open editor BEFORE pushHistory: a new run unshifts the list, so
    // committing afterwards would write the typed text onto the wrong row.
    node._pixRlCommitEdit?.();
    node._rlRunning = false;
    // Successes only — an interrupted / errored run gives a partial, misleading time.
    if (success && node._rlRunStart != null) pushHistory(node, performance.now() - node._rlRunStart);
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
// One text line per entry: "01.   14.8s  with style lora" (label only when set).
// The time is right-aligned in a fixed width so the labels line up in the file.
function fmtLine(entry, i) {
  const line = String(i + 1).padStart(2, "0") + ". " + fmtTime(entry.ms).padStart(7);
  return entry.label ? line + "  " + entry.label : line;
}
function copyTimes(node) {
  node._pixRlCommitEdit?.();   // see the note on exportTxt
  const hist = getHist(node);
  if (!hist.length) return;
  copyText(hist.map(fmtLine).join("\n"));
}
// Save the list as a plain .txt (user-initiated download of their OWN data).
// Flush an open editor FIRST: a note that is still being typed is visible on the
// node, so leaving it out of the file would be a silent lie. Clicking a footer
// button usually blurs the input (which commits) before the click lands, but
// that is browser- and platform-dependent, and the right-click menu path may not
// blur at all - so do not rely on it.
function exportTxt(node) {
  node._pixRlCommitEdit?.();
  const hist = getHist(node);
  if (!hist.length) return;
  const body = hist.map(fmtLine).join("\n");
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
    // overflow:hidden is a backstop: every child is flex:none, so if a future
    // LiteGraph change ever made the element shorter than the content, the
    // footer would otherwise paint outside the node frame, over the canvas.
    ".pix-rl-root{display:flex;flex-direction:column;gap:6px;width:100%;height:100%;box-sizing:border-box;padding:0;overflow:hidden;user-select:none;-webkit-user-select:none;font-family:'Segoe UI',system-ui,sans-serif;}",
    ".pix-rl-cap{display:flex;align-items:center;justify-content:space-between;flex:none;padding:0 2px;height:14px;}",
    ".pix-rl-caplbl{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#6c6960;}",
    ".pix-rl-status{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#57544d;display:flex;align-items:center;gap:5px;}",
    ".pix-rl-running{color:#49c97a;}",
    ".pix-rl-rdot{width:6px;height:6px;border-radius:50%;background:#49c97a;animation:pixRlPulse 1.1s infinite;}",
    "@keyframes pixRlPulse{0%,100%{opacity:1;}50%{opacity:0.25;}}",
    // flex:none + an exact height — see SCREEN_H. Never flex:1, or the panel
    // stretches and leaves a black strip under the last row.
    ".pix-rl-screen{flex:none;height:" + SCREEN_H + "px;overflow:hidden;background:#141417;border:1px solid #050506;border-radius:6px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.03),inset 0 0 20px rgba(0,0,0,0.35);padding:5px;box-sizing:border-box;}",
    // [index][bolt marker][label][time]. The marker is its own fixed column so
    // labels stay aligned whether or not a row carries the bolt.
    ".pix-rl-row{display:grid;grid-template-columns:22px 12px 1fr auto;align-items:center;gap:6px;padding:0 8px;border-radius:4px;height:" + ROW_H + "px;box-sizing:border-box;}",
    ".pix-rl-row:nth-child(even){background:rgba(255,255,255,0.022);}",
    // The WHOLE row is the double-click target, so the whole row must respond to
    // the pointer (UI convention #13 - borderless cells inside a bordered
    // container hover to a white tint). Without this a row that already HAS a
    // label had no hover feedback at all, since the only response was the
    // placeholder brightening. Declared after :nth-child(even) so it wins at
    // equal specificity; the newest row keeps its own colour, just brighter.
    ".pix-rl-row:hover{background:rgba(255,255,255,0.06);}",
    ".pix-rl-idx{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-size:11px;color:#6c6960;text-align:right;}",
    ".pix-rl-mark{font-size:9.5px;line-height:1;text-align:center;color:#8a8781;}",
    // cursor:text lives on the ROW, not here: the double-click listener is on the
    // row, so pointing at the index, the bolt or the time must look editable too.
    ".pix-rl-row{cursor:text;}",
    ".pix-rl-lbl{font-size:11px;color:#b8b4ad;justify-self:stretch;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    // Discoverability: an unlabelled row ALWAYS reads "add note", like
    // placeholder text in a form, in the same grey as the row numbers so it
    // recedes once real labels are typed. (A hover-only hint was tried first and
    // was invisible in practice - user feedback, 2026-07-23.) It brightens on
    // hover so the row still confirms it is interactive.
    ".pix-rl-lbl--empty::after{content:'add note';color:#6c6960;transition:color 0.12s;}",
    ".pix-rl-row:hover .pix-rl-lbl--empty::after{color:#9a968e;}",
    // On the newest row the backdrop is orange-tinted, so the neutral grey would
    // read as dead - warm it to match.
    ".pix-rl-row--now .pix-rl-lbl--empty::after{color:#a8776a;}",
    ".pix-rl-row--now:hover .pix-rl-lbl--empty::after{color:#d9917f;}",
    // The inline editor takes the label's grid column and centres in the 20px
    // row, so the row never shifts VERTICALLY when it opens (the text does move
    // right by the border + padding, which is deliberate - it reads as a field).
    // Explicit line-height so an 11px font in a 14px content box cannot clip a
    // descender on a different font stack.
    ".pix-rl-lblin{grid-column:3;justify-self:stretch;min-width:0;width:100%;box-sizing:border-box;height:16px;line-height:14px;font-family:'Segoe UI',system-ui,sans-serif;font-size:11px;color:#e6e2da;background:#1d1d1d;border:1px solid #f66744;border-radius:3px;padding:0 4px;outline:none;}",
    ".pix-rl-lblin::placeholder{color:#57544d;}",
    ".pix-rl-time{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;font-size:13px;color:#b8b4ad;font-weight:500;}",
    ".pix-rl-row--now{background:rgba(246,103,68,0.16);box-shadow:inset 2px 0 0 #f66744;}",
    ".pix-rl-row--now:hover{background:rgba(246,103,68,0.24);}",
    // The row classes are mutually exclusive, so when the newest run is ALSO the
    // fastest it carries --now only and the --best bolt rule never applies. Warm
    // the bolt here or it is the one grey element left on an orange row.
    ".pix-rl-row--now .pix-rl-mark{color:#f66744;}",
    ".pix-rl-row--now .pix-rl-time{color:#f66744;font-weight:700;}",
    ".pix-rl-row--now .pix-rl-idx{color:#ff8a63;}",
    ".pix-rl-row--now .pix-rl-lbl{color:#f0cfc4;}",
    ".pix-rl-row--best .pix-rl-time{color:#49c97a;font-weight:600;}",
    ".pix-rl-row--best .pix-rl-mark{color:#49c97a;}",
    ".pix-rl-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;}",
    ".pix-rl-empty-t{font-family:'Consolas','DejaVu Sans Mono',ui-monospace,monospace;font-size:13px;color:#7a776f;}",
    ".pix-rl-empty-s{font-size:11px;color:#57544d;}",
    // Footer: two subtle icon buttons, right-aligned (Export .txt, Clear). Grey
    // icon → brand orange on hover (Pixaroma UI convention #13).
    // margin-top:auto keeps the buttons in the bottom corner if the node is
    // dragged taller than the exact fit (spare height falls between the panel
    // and the footer rather than stranding the footer mid-node).
    ".pix-rl-foot{display:flex;align-items:center;justify-content:flex-end;gap:2px;flex:none;margin-top:auto;height:20px;padding:0 2px;}",
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
  node._rlRunStart = null;

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
    { heading: "Reading the list", body: "The newest run sits at the top, highlighted in orange with an orange bar down its left edge. The fastest of the ten is marked with a lightning bolt, in green (or in orange when the newest run is also the fastest). Times under a minute show as seconds (for example 14.8s); longer runs show as minutes and seconds (for example 1:23). While a run is going a small green 'running' marker shows in the corner, and the new time drops in on top the moment it finishes." },
    { heading: "Label your runs", body: "A list of times tells you that something changed, not what. Double-click any row and type a short note about that run: 'with style lora', 'seed 12345', 'base, no LLM'. Press Enter to save, or click away, which also saves. Escape leaves it as it was. Clearing the text removes the note again.\n\nThe note belongs to that run, so as newer runs push it down the list it travels with its own time, and it disappears with it when it drops off the bottom. Notes are saved in the workflow like the times, and they are included when you export or copy the list." },
    { heading: "This workflow only", body: "The list lives on the node and is saved inside the workflow, so it is only the times for this workflow and it stays with it. Open the workflow again another day and the list is still there. A different workflow keeps its own separate list." },
    { heading: "The two buttons", body: "In the bottom-right corner are two small buttons. The download icon exports the list as a plain .txt file you can save or share. The trash icon clears the list back to 'No runs yet'. The same actions are also on the right-click menu, along with Copy times." },
    { heading: "Right-click options", defs: [
      ["Copy times", "Copies the whole list as plain text, with your notes, so you can paste it into notes or a message."],
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
      this._pixRlCommitEdit = null;   // never write a label to a deleted node
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
