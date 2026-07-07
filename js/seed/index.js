import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget, applyAdaptiveCanvasOnly, isVueNodes, measureRootContent,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { openSeedSettings, closeSeedSettingsFor } from "./settings.mjs";

// ─────────────────────────────────────────────────────────────────────────
// Seed Pixaroma — a seed source with Random / Fixed modes + buttons.
//
// Architecture mirrors Resolution Pixaroma: Python declares a single `hidden`
// SeedState input (no widget, no slot dot); the on-node UI is a DOM widget and
// state lives on node.properties.seedState (LiteGraph serializes it). The
// app.graphToPrompt hook at the bottom injects the resolved per-run seed.
//
// Behaviour:
//   • Random mode  → each Run rolls a fresh seed; the big number updates to the
//                    seed that actually ran (display-only — never persisted).
//   • Fixed  mode  → the locked seed is used every Run (repeatable).
//   • New fixed random → roll a new seed and switch to Fixed (locks a roll).
//   • Use last seed    → load the previous run's seed and switch to Fixed.
//   • Copy             → put the current/last seed on the clipboard.
//   • Typing a number in the big field sets that exact seed (switches to Fixed).
// Works in both the Classic and Nodes 2.0 renderers (DOM widget + adaptive
// canvasOnly).
// ─────────────────────────────────────────────────────────────────────────

function injectCSS() {
  if (document.getElementById("pixaroma-seed-css")) return;
  const css = `
    .pix-seed-root {
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      color: #ddd;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    /* Big editable seed number. Dark inset box, monospace, brand border on focus. */
    .pix-seed-num {
      width: 100%;
      box-sizing: border-box;
      height: 42px; /* fixed box so the auto-fit font change can't alter the height */
      background: #171819;
      border: 1px solid #3a3d40;
      border-radius: 6px;
      padding: 9px 8px;
      color: #f2f2f2;
      font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
      /* font-size is the MAX; fitSeedFont() shrinks it inline so a long (up to
         16-digit) seed fits the narrower Nodes 2.0 body without being cut. */
      font-size: 19px;
      text-align: center;
      letter-spacing: 0;
      outline: none;
    }
    .pix-seed-num:focus { border-color: ${BRAND}; }
    /* Random | Fixed segmented pill. Active segment = solid brand. */
    .pix-seed-pill {
      display: flex;
      gap: 0;
      background: rgba(255,255,255,0.06);
      border-radius: 7px;
      padding: 3px;
    }
    /* Real <button>s (keyboard-reachable), styled to look like flat segments. */
    .pix-seed-seg {
      flex: 1;
      text-align: center;
      padding: 6px;
      border: none;
      border-radius: 5px;
      background: transparent;
      font-family: inherit;
      font-size: 12px;
      color: rgba(255,255,255,0.55);
      cursor: pointer;
      user-select: none;
      appearance: none;
      -webkit-appearance: none;
      outline: none;
      transition: background 0.08s, color 0.08s;
    }
    .pix-seed-seg:hover:not(.active) { color: rgba(255,255,255,0.85); }
    .pix-seed-seg.active {
      background: ${BRAND};
      color: #fff;
      font-weight: 500;
    }
    .pix-seed-seg:focus-visible { outline: 2px solid ${BRAND}; outline-offset: -2px; }
    /* Action buttons — semi-transparent white surface, brand fill on hover
       (matches the Text / Prompt Pack action-button family). */
    .pix-seed-btn {
      box-sizing: border-box;
      padding: 8px 10px;
      border-radius: 6px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.14);
      color: rgba(255,255,255,0.85);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
      text-align: center;
      transition: background 0.08s, border-color 0.08s, color 0.08s;
    }
    .pix-seed-newrandom { width: 100%; }
    .pix-seed-btn:hover {
      background: ${BRAND};
      border-color: ${BRAND};
      color: #fff;
    }
    .pix-seed-btn:disabled { opacity: 0.4; cursor: default; }
    .pix-seed-btn:disabled:hover {
      background: rgba(255,255,255,0.05);
      border-color: rgba(255,255,255,0.14);
      color: rgba(255,255,255,0.85);
    }
    /* Success flash after Copy — green wins over hover via higher specificity. */
    .pix-seed-btn.is-flashing,
    .pix-seed-btn.is-flashing:hover {
      background: #3ec371;
      border-color: #3ec371;
      color: #fff;
    }
    .pix-seed-row { display: flex; gap: 8px; }
    .pix-seed-uselast { flex: 1; }
    .pix-seed-copy { flex: 0 0 auto; min-width: 64px; }
    .pix-seed-lastrun {
      font-size: 11px;
      line-height: 1.6; /* room so descenders (y, g) aren't clipped at the node edge */
      color: rgba(255,255,255,0.55);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Compact one-line layout (right-click to toggle Compact / Full). */
    .pix-seed-minirow { display: flex; align-items: center; gap: 8px; }
    .pix-seed-num.compact {
      flex: 1;
      min-width: 0;
      width: auto;
      height: 32px;
      padding: 6px 8px;
      font-size: 14px;
    }
    .pix-seed-minitog {
      display: flex;
      flex: 0 0 auto;
      background: rgba(255,255,255,0.06);
      border-radius: 7px;
      padding: 3px;
    }
    .pix-seed-minitog .pix-seed-seg { flex: 0 0 auto; padding: 5px 9px; }
    .pix-seed-minicopy {
      flex: 0 0 auto;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 32px;
      min-width: 34px;
      padding: 0 8px;
      border-radius: 6px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.14);
      color: ${BRAND};
      cursor: pointer;
      transition: background 0.08s, border-color 0.08s, color 0.08s;
    }
    .pix-seed-minicopy:hover { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
    .pix-seed-minicopy.is-flashing,
    .pix-seed-minicopy.is-flashing:hover { background: #3ec371; border-color: #3ec371; color: #fff; }
  `;
  const style = document.createElement("style");
  style.id = "pixaroma-seed-css";
  style.textContent = css;
  document.head.appendChild(style);
}
injectCSS();

// Default node WIDTH on a fresh drop. The node is horizontally resizable; the
// height stays content-driven (see onResize + the post-layout snap below).
const NODE_W = 226;
const MIN_W = 170; // resize floor — width shrinks to here, keeping the buttons usable
// Body height is MEASURED from the actual content (see measureSeedHeight), not a
// hand-guessed constant — guessing the constant is what caused the gap-then-clip
// oscillation. This fallback is used ONLY before the body is laid out (a fresh
// drop / first paint); the real measure takes over the instant children exist.
const WIDGET_H_FALLBACK = 216;
const NODE_H_HINT = WIDGET_H_FALLBACK + 48; // starting height (replace-branch only)

const STATE_PROP = "seedState";
const HIDDEN_INPUT_NAME = "SeedState"; // matches Python INPUT_TYPES key

const DEFAULT_SIZE_SETTING = "Pixaroma.Seed.DefaultSize"; // global default: new nodes start compact
const MIN_DIGITS = 4;
const MAX_DIGITS = 16; // 16 = the full safe-integer range (original behaviour)

const DEFAULT_STATE = {
  seed: 0,
  mode: "random", // "random" | "fixed"
  compact: false, // one-line layout (right-click to toggle; a setting sets the default for new nodes)
  digits: MAX_DIGITS, // how many digits a RANDOM seed can have (4-16); shorter = smaller seeds
};

function clampDigits(d) {
  d = Math.floor(Number(d));
  if (!Number.isFinite(d)) return MAX_DIGITS;
  return Math.max(MIN_DIGITS, Math.min(MAX_DIGITS, d));
}
// The last-run seed is session-only RUNTIME state on node._pixSeedLastRun
// (NOT node.properties), so a run never rewrites serialized state and can never
// dirty a saved workflow (Vue Compat #18). It doesn't survive a reload, which
// matches the "this session's last run" meaning.

// Roll an exact integer with up to `digits` digits. digits=16 uses the full JS
// safe-integer range (the original behaviour: round-trips precisely, well inside
// ComfyUI's 0..2^64-1 bounds); a smaller value rolls in [0, 10^digits) so the
// seed is shorter (some tools / users want a smaller seed - the digits option).
function rollSeed(digits) {
  const d = clampDigits(digits == null ? MAX_DIGITS : digits);
  if (d >= MAX_DIGITS) return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  return Math.floor(Math.random() * Math.pow(10, d));
}

function clampSeed(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return n;
}

// Shrink the seed number's font until it fits the field (a 16-digit seed
// overflows the narrower Nodes 2.0 body at the base 19px). Idempotent and
// cheap; safe to call repeatedly. No-op until the field is laid out.
function fitSeedFont(num) {
  if (!num || !num.isConnected) return;
  // Compact mode's field is narrower, so start from a smaller max (still >= 11).
  const MAX = num.classList.contains("compact") ? 15 : 19, MIN = 11;
  num.style.fontSize = MAX + "px";
  if (!num.clientWidth) return; // not laid out yet — a scheduled retry will catch it
  let fs = MAX, guard = 0;
  while (fs > MIN && num.scrollWidth > num.clientWidth + 1 && guard++ < 24) {
    fs -= 1;
    num.style.fontSize = fs + "px";
  }
}

// Measure the body's content height (children offsetHeight + gaps + padding) so
// the node sizes itself with NO hand-guessed constant. Coarse-round to a 4px
// grid so font/sub-pixel jitter can't creep node.size across save/load
// (dirty-on-load, Vue Compat #18). Falls back to a placeholder before the body
// is laid out (children have offsetHeight 0 on a fresh drop).
function measureSeedHeight(root) {
  const h = root ? measureRootContent(root) : 0;
  if (!(h > 20)) return WIDGET_H_FALLBACK;
  return Math.round(h / 4) * 4;
}

const COMPACT_MIN_W = 256; // compact mode widens to at least this so the one-line seed stays readable

// Re-fit the node to the current content height (used after a Compact/Full
// toggle - a user action, so writing node.size is fine; NEVER call this on the
// load path). In compact mode it also nudges the width up to COMPACT_MIN_W so
// the single-row seed isn't cramped. Works in both renderers (setSize is the
// documented way to shrink a Nodes 2.0 node, which otherwise only grows).
function fitSeedNodeHeight(node) {
  if (typeof node.setSize !== "function") return;
  let w = Math.max(MIN_W, node.size[0] || NODE_W);
  if (readState(node).compact) w = Math.max(w, COMPACT_MIN_W);
  node.setSize([w, node.computeSize()[1]]);
  // Force an immediate repaint. Without this the node keeps drawing at its OLD
  // size until the user moves the mouse / presses a key (the "stuck + clipped
  // until I move" report) - setSize alone doesn't reliably schedule a redraw of
  // a DOM-widget node here.
  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
}

// Re-fit after a layout-changing action (Compact <-> Full). The FIRST pass is
// synchronous: when the node is already on the canvas (the toggle case) its DOM
// widget is attached, so reading offsetHeight forces layout and the measure is
// correct RIGHT NOW - the node resizes instantly, no delay. The rAF + timeout
// passes are idempotent backups for any frame where the body isn't laid out yet.
function refitSeedNode(node) {
  fitSeedNodeHeight(node);
  requestAnimationFrame(() => fitSeedNodeHeight(node));
  setTimeout(() => fitSeedNodeHeight(node), 130);
}

// Flip this node between Compact and Full, rebuild the body, and re-fit the size.
// User action (menu / panel), so writing node.size is fine (never on load).
function toggleSeedCompact(node, forceCompact) {
  const cur = readState(node);
  const next = typeof forceCompact === "boolean" ? forceCompact : !cur.compact;
  if (next === !!cur.compact) return;
  writeState(node, { ...cur, compact: next });
  renderUI(node);
  refitSeedNode(node);
}

function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return { ...DEFAULT_STATE, ...JSON.parse(v) }; }
    catch { /* fall through */ }
  }
  return { ...DEFAULT_STATE };
}

function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

// The number the big field should SHOW. In Random mode that is the seed that
// actually ran last (so the field tracks the output the user sees); before the
// first run it falls back to the stored value. Fixed mode shows the stored
// value. This is display-only: the last-run seed lives on the runtime field
// (node._pixSeedLastRun), never in node.properties, so a run can never dirty a
// saved workflow (Vue Compat #18).
function displayedSeed(node, state) {
  if (state.mode === "random" && node._pixSeedLastRun != null) {
    return clampSeed(node._pixSeedLastRun);
  }
  return state.seed;
}

// Fill the hint line under the buttons. The big number now carries the actual
// seed (see displayedSeed), so this line just explains the mode instead of
// repeating the number.
function refreshLastRunEl(el, mode, _lastSeed) {
  el.textContent =
    mode === "fixed"
      ? "Fixed: same seed every run"
      : "Random: rolls a new seed each run";
}

// Lightweight refresh used by the graphToPrompt hook — updates the last-run
// line + the "Use last seed" disabled state WITHOUT rebuilding the DOM (so an
// in-progress number edit isn't disrupted).
function refreshLastRun(node) {
  const root = node._pixSeedRoot;
  if (!root || !root.isConnected) return;
  const state = readState(node);
  const lastSeed = node._pixSeedLastRun ?? null;
  const lr = root.querySelector(".pix-seed-lastrun");
  if (lr) refreshLastRunEl(lr, state.mode, lastSeed);
  // Random mode: reflect the seed that actually ran in the big number, so the
  // field changes each run to match the output. Visual only (never written to
  // properties). Skip while the field is focused so it can't yank a number the
  // user is mid-typing.
  const num = root.querySelector(".pix-seed-num");
  if (num && document.activeElement !== num && state.mode === "random" && lastSeed != null) {
    num.value = String(clampSeed(lastSeed));
    fitSeedFont(num);
  }
  const useLast = root.querySelector(".pix-seed-uselast");
  if (useLast) useLast.disabled = lastSeed == null;
}

// Keep a hidden widget named "seed" in sync with the current run seed. ComfyUI's
// %NodeName.seed% filename token (native Save Image) and our own save nodes'
// resolver both read a VISIBLE widget by name; Seed Pixaroma keeps its value on
// node.properties, so this mirror is what makes `%Seed Pixaroma.seed%` resolvable
// in a filename. serialize:false + hidden, so it never renders or dirties a saved
// workflow. Its value is written by the graphToPrompt pre-pass BEFORE ComfyUI
// serializes, so the filename matches the seed that actually runs (Random mode).
function setSeedMirror(node, seed) {
  const w = (node.widgets || []).find((x) => x.name === "seed");
  if (w) w.value = String(clampSeed(seed));
}

// Toggle the Random|Fixed pill's active segment in place (no DOM rebuild), so
// committing the number field by clicking a pill/button never destroys that
// control mid-click.
function syncModeUI(root, mode) {
  root.querySelectorAll(".pix-seed-seg").forEach((s) => {
    s.classList.toggle("active", s.dataset.mode === mode);
  });
}

function copySeed(node, btn, iconMode) {
  const state = readState(node);
  // What-you-see-is-what-you-copy: copy exactly the seed shown in the big field
  // (the last-run seed in Random mode, the locked value in Fixed).
  const text = String(clampSeed(displayedSeed(node, state)));
  const flash = (ok) => {
    // iconMode (compact copy button): flash the colour only, keep the SVG icon
    // (rewriting textContent would wipe it).
    btn.classList.toggle("is-flashing", ok);
    if (!iconMode) btn.textContent = ok ? "Copied" : "No clipboard";
    setTimeout(() => {
      btn.classList.remove("is-flashing");
      if (!iconMode) btn.textContent = "Copy";
    }, 700);
  };
  // Fallback for INSECURE contexts (ComfyUI served over http://<LAN-IP>), where
  // navigator.clipboard is undefined — a throwaway textarea + execCommand still
  // works because the click is a user gesture. Mirrors Version Check / Show Text.
  const legacyCopy = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    let ok = false;
    try {
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
    } catch (_e) {
      ok = false;
    } finally {
      ta.remove(); // always remove, even if execCommand throws
    }
    flash(ok);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => flash(true)).catch(legacyCopy);
  } else {
    legacyCopy();
  }
}

// Build the node body into `root` (the DOM widget element). Kept separate from
// renderUI so the INITIAL render can target the captured root element even
// before LiteGraph has attached it — bailing on isConnected there (the first
// version did) left the body blank on a fresh drop.
// SVG copy icon (Lucide "copy") for the compact button. stroke=currentColor, so
// it takes the button's `color` - brand orange at rest, white on hover/flash.
// Built as a plain JS string (NOT in the CSS template literal), so no escape
// hazards.
const COPY_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

// The editable big seed number + its commit logic. Shared by the Full and
// Compact layouts (compact adds a modifier class for the smaller sizing).
function makeSeedNumberInput(node, root, compact) {
  const state = readState(node);
  const num = document.createElement("input");
  num.type = "text";
  num.spellcheck = false;
  num.autocomplete = "off";
  num.inputMode = "numeric";
  num.className = "pix-seed-num" + (compact ? " compact" : "");
  num.value = String(displayedSeed(node, state));
  num.title = "The seed value. Type a number to set an exact seed (switches to Fixed).";
  const commitNum = () => {
    const cleaned = num.value.replace(/[^\d]/g, "");
    const cur = readState(node);
    // Compare against what the field was SHOWING (the last-run seed in Random,
    // else the stored value), so a bare focus/blur in Random mode - where the
    // field shows the last run, not state.seed - doesn't look like an edit and
    // flip the mode to Fixed.
    const baseline = displayedSeed(node, cur);
    // Empty / non-numeric input keeps the shown seed instead of wiping to 0.
    const v = cleaned === "" ? baseline : clampSeed(cleaned);
    num.value = String(v); // reflect any clamp
    fitSeedFont(num); // a newly-typed long seed may need a smaller font to fit
    // No real change -> don't flip the mode on a bare focus/blur, and don't rebuild.
    if (v === baseline) return;
    // Typing an exact seed locks it (Fixed).
    writeState(node, { ...cur, seed: v, mode: "fixed" });
    // Surgical UI sync (NOT a full renderUI rebuild) so blurring the field by
    // clicking a pill/button can't destroy that control mid-click.
    syncModeUI(root, "fixed");
    refreshLastRun(node);
  };
  num.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keep ComfyUI canvas shortcuts from firing while typing
    if (e.key === "Enter") { e.preventDefault(); num.blur(); }
  });
  num.addEventListener("blur", commitNum);
  return num;
}

// One Random|Fixed segment button. Keeps the .pix-seed-seg class so syncModeUI
// finds it; shared by Full ("Random"/"Fixed") and Compact ("R"/"F") with the
// same click behaviour.
function makeModeSeg(node, root, m, label, title) {
  const state = readState(node);
  const seg = document.createElement("button");
  seg.type = "button";
  seg.className = "pix-seed-seg" + (state.mode === m ? " active" : "");
  seg.textContent = label;
  seg.dataset.mode = m;
  seg.title = title;
  seg.addEventListener("click", () => {
    const cur = readState(node);
    if (cur.mode === m) return;
    const next = { ...cur, mode: m };
    // Switching Random -> Fixed locks the seed the user is CURRENTLY seeing
    // (the last run), not the older stored value, so the number doesn't jump.
    if (m === "fixed" && cur.mode === "random" && node._pixSeedLastRun != null) {
      next.seed = clampSeed(node._pixSeedLastRun);
    }
    writeState(node, next);
    renderUI(node);
  });
  return seg;
}

function buildSeedBody(node, root) {
  const state = readState(node);
  const lastSeed = node._pixSeedLastRun ?? null; // session-only (see DEFAULT_STATE note)
  root.innerHTML = "";
  root.classList.toggle("compact", !!state.compact);

  const fitLater = (num) => {
    // Fit the number font now and shortly after — covers the fresh-drop case
    // where the widget isn't laid out on the first frame (in either renderer).
    requestAnimationFrame(() => fitSeedFont(num));
    setTimeout(() => fitSeedFont(num), 60);
    setTimeout(() => fitSeedFont(num), 220);
  };

  // ── COMPACT: one row — number + R|F toggle + orange copy icon ──
  if (state.compact) {
    const row = document.createElement("div");
    row.className = "pix-seed-minirow";
    const num = makeSeedNumberInput(node, root, true);
    const tog = document.createElement("div");
    tog.className = "pix-seed-minitog";
    tog.appendChild(makeModeSeg(node, root, "random", "R", "Random: roll a new seed every run."));
    tog.appendChild(makeModeSeg(node, root, "fixed", "F", "Fixed: same seed every run."));
    const cp = document.createElement("button");
    cp.type = "button";
    cp.className = "pix-seed-minicopy";
    cp.title = "Copy the seed to the clipboard.";
    cp.innerHTML = COPY_SVG;
    cp.addEventListener("click", () => copySeed(node, cp, true));
    row.append(num, tog, cp);
    root.appendChild(row);
    fitLater(num);
    return;
  }

  // ── FULL (default) ──
  const num = makeSeedNumberInput(node, root, false);
  root.appendChild(num);

  const pill = document.createElement("div");
  pill.className = "pix-seed-pill";
  pill.appendChild(makeModeSeg(node, root, "random", "Random", "Roll a new random seed every run."));
  pill.appendChild(makeModeSeg(node, root, "fixed", "Fixed", "Keep the same seed every run (repeatable result)."));
  root.appendChild(pill);

  // ── New fixed random ──────────────────────────────────────────
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "pix-seed-btn pix-seed-newrandom";
  newBtn.textContent = "New fixed random";
  newBtn.title = "Roll a brand-new random seed and lock it (switches to Fixed).";
  newBtn.addEventListener("click", () => {
    const cur = readState(node);
    writeState(node, { ...cur, seed: rollSeed(cur.digits), mode: "fixed" });
    renderUI(node);
  });
  root.appendChild(newBtn);

  // ── Use last seed · Copy ──────────────────────────────────────
  const row = document.createElement("div");
  row.className = "pix-seed-row";

  const useLast = document.createElement("button");
  useLast.type = "button";
  useLast.className = "pix-seed-btn pix-seed-uselast";
  useLast.textContent = "Use last seed";
  useLast.title = "Load the seed from the previous run and lock it (Fixed).";
  useLast.disabled = lastSeed == null;
  useLast.addEventListener("click", () => {
    const last = node._pixSeedLastRun;
    if (last == null) return;
    const cur = readState(node);
    writeState(node, { ...cur, seed: clampSeed(last), mode: "fixed" });
    renderUI(node);
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "pix-seed-btn pix-seed-copy";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Copy the seed shown above to the clipboard.";
  copyBtn.addEventListener("click", () => copySeed(node, copyBtn));

  row.append(useLast, copyBtn);
  root.appendChild(row);

  // ── last-run line ─────────────────────────────────────────────
  const lr = document.createElement("div");
  lr.className = "pix-seed-lastrun";
  refreshLastRunEl(lr, state.mode, lastSeed);
  root.appendChild(lr);

  fitLater(num);
}

// Resolve the live root element (adopting the widget's element if Vue swapped
// it out) and (re)build the body. Does NOT bail merely because the element
// isn't attached yet — it builds into the cached root so the content is there
// the moment LiteGraph draws the widget. Used for re-renders (clicks, configure).
function renderUI(node) {
  let root = node._pixSeedRoot;
  if (!root || !root.isConnected) {
    const w = (node.widgets || []).find((x) => x.name === "seed_ui");
    const el = w?.element;
    if (el) {
      root = el.classList?.contains("pix-seed-root")
        ? el
        : (el.querySelector(".pix-seed-root") || (() => {
            const r = document.createElement("div");
            r.className = "pix-seed-root";
            el.appendChild(r);
            return r;
          })());
      node._pixSeedRoot = root;
    }
  }
  if (!root) return;
  buildSeedBody(node, root);
}

function setupSeedNode(node) {
  // Defensive: hide any SeedState widget (none exists with the hidden input).
  hideJsonWidget(node.widgets, HIDDEN_INPUT_NAME);

  node.resizable = true; // horizontal resize allowed (issue #10); height stays content-driven
  // Do NOT force the height. getMinHeight (measured) is the floor and there is no
  // getMaxHeight, so LiteGraph sizes the node to exactly chrome + content — no gap,
  // no clip. Forcing a height is what produced the gap-then-clip oscillation. Width
  // starts at NODE_W; onResize lets the user change it (floored at MIN_W) and locks
  // the height to the content. (The replace branch needs a starting height; the
  // post-layout snap below corrects it immediately.)
  if (Array.isArray(node.size)) { node.size[0] = NODE_W; }
  else { node.size = [NODE_W, NODE_H_HINT]; }

  const root = document.createElement("div");
  root.className = "pix-seed-root";
  installCanvasZoomPassthrough(root);
  const _widget = node.addDOMWidget("seed_ui", "pixaroma_seed", root, {
    getValue: () => readState(node),
    setValue: () => {},
    // Measured content height, and NO getMaxHeight: a single-widget node has no
    // slack consumer, so an upper cap can only clip the bottom line (that was
    // the bug). Without a cap, LiteGraph sizes the body to exactly the content.
    getMinHeight: () => measureSeedHeight(root),
    margin: 4,
    serialize: false, // state lives on node.properties, not this widget
  });
  applyAdaptiveCanvasOnly(_widget);
  // Nodes 2.0: a widget WITH computeLayoutSize is the grower row (CLAUDE.md). It's
  // the sole visible widget, so it's safely the grower; minWidth:1 keeps the
  // locked width round-tripping (Compare gotcha 2).
  _widget.computeLayoutSize = () => ({ minHeight: measureSeedHeight(root), minWidth: 1 });
  node._pixSeedRoot = root;

  // Hidden mirror widget named "seed" so ComfyUI's %Node.seed% filename token
  // (and our save nodes) can read the current seed (see setSeedMirror). Added
  // once; serialize:false keeps it out of the saved workflow (no dirty-on-load)
  // and out of the XY-plot / Parameters surfaces; hideJsonWidget hides it in both
  // renderers. The value is refreshed by the graphToPrompt pre-pass each run.
  if (!(node.widgets || []).some((w) => w.name === "seed")) {
    const mirror = node.addWidget(
      "text", "seed", String(clampSeed(readState(node).seed)), () => {}, {}
    );
    mirror.serialize = false;             // LiteGraph top-level flag (the one serialize checks)
    mirror.options = mirror.options || {};
    mirror.options.serialize = false;     // belt-and-braces for any path that reads options.serialize
    hideJsonWidget(node.widgets, "seed");
  }

  // Deferred initial render — nodeCreated fires BEFORE configure() restores a
  // saved workflow's properties (Vue Compat #8). A fresh node (no saved state)
  // gets a random starting seed so the big number isn't a lonely 0; a restored
  // node already has seedState so we leave it untouched (no dirty-on-load).
  queueMicrotask(() => {
    if (!node.properties?.[STATE_PROP]) {
      // Fresh drop: start in the size the user set as their default (a global
      // Pixaroma setting), else Full. Restored nodes keep their saved size.
      const defCompact = !!app.ui?.settings?.getSettingValue?.(DEFAULT_SIZE_SETTING);
      writeState(node, { ...DEFAULT_STATE, seed: rollSeed(DEFAULT_STATE.digits), compact: defCompact });
      // A fresh compact node wants a touch more width so the one-line seed reads
      // well. Fresh ONLY (restored nodes keep their saved width - never widened
      // here, or that would dirty the saved workflow).
      if (defCompact && node.size[0] < COMPACT_MIN_W) node.size[0] = COMPACT_MIN_W;
    }
    // Build into the captured `root` directly — it may not be attached to the
    // page yet on a fresh drop, but the content shows once LiteGraph draws it.
    buildSeedBody(node, root);
    // Once the body is laid out, snap the node to the measured content height
    // (LEGACY only — Nodes 2.0 sizes via computeLayoutSize). Coarse-rounded, so
    // this is idempotent on reload and never dirties a saved workflow. Two
    // attempts cover whichever frame the body finishes laying out on.
    const snap = () => {
      if (!isVueNodes() && typeof node.setSize === "function") {
        // Preserve the user's (possibly resized) width — only re-fit the height.
        const w = Math.max(MIN_W, node.size[0] || NODE_W);
        node.setSize([w, node.computeSize()[1]]);
      }
    };
    requestAnimationFrame(snap);
    setTimeout(snap, 120);
  });
}

app.registerExtension({
  name: "Pixaroma.Seed",

  settings: [
    {
      id: DEFAULT_SIZE_SETTING,
      name: "New Seed nodes start compact",
      type: "boolean",
      defaultValue: false,
      tooltip:
        "New Seed Pixaroma nodes drop in the small one-line layout. Any node can still be switched with right-click.",
      category: ["👑 Pixaroma", "Seed"],
    },
  ],

  // Right-click → toggle this node between the Full and Compact (one-line)
  // layouts. Writes only on the click (a user action), so no dirty-on-load.
  getNodeMenuItems(node) {
    if (node?.comfyClass !== "PixaromaSeed") return [];
    const st = readState(node);
    return [
      null,
      {
        // quick one-click size flip
        content: st.compact ? "👑 Seed full size" : "👑 Seed compact size",
        callback: () => toggleSeedCompact(node),
      },
      {
        // the full panel: size (this node + new-node default) + seed digits
        content: "👑 Seed settings",
        callback: () =>
          openSeedSettings(node, {
            readState,
            writeState,
            applyResize: (n) => {
              renderUI(n);
              refitSeedNode(n);
            },
            settingId: DEFAULT_SIZE_SETTING,
            MIN_DIGITS,
            MAX_DIGITS,
            clampDigits,
          }),
      },
    ];
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaSeed") return;

    // Re-render when a different workflow is configured into an existing node.
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      if (this._pixSeedRoot) renderUI(this);
      return r;
    };

    // Classic only: free HORIZONTAL resize (floored at MIN_W); lock the height to
    // the content so a corner-drag stays horizontal (issue #10). In Nodes 2.0 the
    // rendered size lives in the Vue layout store, so writing node.size there
    // desyncs it — Vue uses computeLayoutSize (minWidth:1 + measured height).
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        this.size[1] = this.computeSize()[1];
      }
      if (_origResize) return _origResize.call(this, size);
    };

    // Belt-and-braces width floor (Vue Compat #13: onResize is unreliable for DOM
    // widgets, and Align can write node.size directly). Width ONLY — never write the
    // height here (a per-paint height write risks dirty-on-load, Compat #18).
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (!isVueNodes() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (_origDraw) return _origDraw.apply(this, arguments);
    };

    // Close the settings panel if it belonged to a node that's being removed.
    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSeedSettingsFor(this);
      if (_origRemoved) return _origRemoved.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaSeed") return;
    setupSeedNode(node);
  },
});

// ── Inject the resolved per-run seed into the API prompt ──────────────────
// Python's hidden SeedState input gets no value from the workflow JSON (no
// widget). On each graphToPrompt (≈ once per Run) we roll a fresh seed for
// Random-mode nodes, record it as the last-run seed, and inject it. Fixed-mode
// nodes inject their locked value (constant → ComfyUI caches → repeatable).
//
// Subgraph-safe: identify entries by class_type and resolve the live node via
// a recursive walk (composite ids like "5:12"), same as Resolution Pixaroma.
// NOTE: graphToPrompt also runs for non-queue actions (e.g. "Save (API
// format)"); a spurious extra roll there only bumps the cosmetic last-run
// readout — harmless.
function buildSeedNodeIndex() {
  const index = new Map(); // String(node.id) → node
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaSeed" || n.type === "PixaromaSeed") {
        index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findSeedNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  // PRE-PASS (runs BEFORE ComfyUI serializes): decide each live Seed node's run
  // seed and write it to the hidden "seed" mirror widget. This is what lets
  // ComfyUI's own %Node.seed% filename token (native Save Image) AND our save
  // nodes' resolver read the SAME seed that actually runs this frame - essential
  // in Random mode, where the seed changes every run. The rolled values are
  // cached so the post-pass injects the exact same numbers (no second roll, so
  // the filename and the generated image always agree).
  const seedIndex = buildSeedNodeIndex();
  const rolled = new Map();
  for (const [nid, node] of seedIndex) {
    if (!node) continue;
    const st = readState(node);
    const runSeed = st.mode === "random" ? rollSeed(st.digits) : clampSeed(st.seed);
    rolled.set(nid, runSeed);
    setSeedMirror(node, runSeed);
  }

  const result = await _origGraphToPrompt(...args);

  try {
    const out = result?.output;
    if (out) {
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== "PixaromaSeed") continue;
        const node = findSeedNode(seedIndex, id);
        // Every node in seedIndex was pre-rolled into `rolled`, and findSeedNode
        // only ever returns a seedIndex node, so rolled.get is defined whenever
        // node is non-null (using the SAME seed the pre-pass wrote to the mirror -
        // so the filename and the injected seed always agree). If a PixaromaSeed
        // entry can't be matched to a live node (deleted mid-queue, or a deep
        // nested-subgraph id collision - the pre-existing findSeedNode limit),
        // runSeed stays 0, same as before this change.
        let runSeed = 0;
        if (node) {
          runSeed = rolled.get(String(node.id)) ?? 0;
          // Record the last-run seed on a RUNTIME field only (never
          // node.properties) so a run can't dirty a saved workflow (Vue Compat
          // #18). Only nodes that actually run (are in `out`) update the readout,
          // so a dangling Seed node's display doesn't flicker each frame.
          node._pixSeedLastRun = runSeed;
          refreshLastRun(node);
        }
        entry.inputs = entry.inputs || {};
        // Inject ONLY the seed value (no nonce) so the cache key IS the seed,
        // exactly like ComfyUI's native seed and rgthree. Random rolls a fresh
        // seed each run -> different string -> re-run; Fixed / "Use last seed"
        // reuse a value -> identical string -> ComfyUI caches (no re-run).
        // This is why "Use last seed" now returns the cached output instantly
        // instead of regenerating once first (issue #11): the Random run that
        // PRODUCED the seed and the Fixed run that REUSES it inject byte-identical
        // SeedState. A ~1-in-2^53 random collision merely cache-hits an IDENTICAL
        // image (same seed = same result), which is correct, not a re-run we want.
        entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify({ runSeed });
      }
    }
  } catch (e) {
    console.warn("[PixaromaSeed] graphToPrompt inject failed", e);
  }
  return result;
};
