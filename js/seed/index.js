import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget, applyAdaptiveCanvasOnly, isVueNodes, measureRootContent,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { openSeedSettings, closeSeedSettingsFor } from "./settings.mjs";
import { openSeedHistory, closeSeedHistoryFor, refreshSeedHistory } from "./history.mjs";

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
    /* Rows keep their intrinsic height even when the node is momentarily clamped
       short (right after a Compact->Full rebuild). WITHOUT this, flex-shrink lets
       the rows compress to fit the clamped body, so the height measure comes back
       SHORT and the node settles ~1 row too short (clipped bottom line). */
    .pix-seed-root > * { flex-shrink: 0; }
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
    /* Number field + up/down (±1) spinner sit side-by-side. The wrap takes the
       number's place in the column, so the height measure is unchanged. */
    .pix-seed-numwrap { display: flex; align-items: stretch; }
    .pix-seed-numwrap .pix-seed-num {
      flex: 1;
      min-width: 0;
      width: auto;
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    .pix-seed-spin {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      width: 26px;
      border: 1px solid #3a3d40;
      border-left: none;
      border-radius: 0 6px 6px 0;
      overflow: hidden;
    }
    .pix-seed-spinbtn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: #1f2123;
      color: rgba(255,255,255,0.75);
      font-size: 9px;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      user-select: none;
      appearance: none;
      -webkit-appearance: none;
      transition: background 0.08s, color 0.08s;
    }
    .pix-seed-spinbtn + .pix-seed-spinbtn { border-top: 1px solid #3a3d40; }
    .pix-seed-spinbtn:hover { background: ${BRAND}; color: #fff; }
    .pix-seed-spinbtn:active { background: #ff8a5e; }
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
    /* Square action button in the compact row (the "N" = new fixed random).
       Orange glyph at rest, brand fill on hover. */
    .pix-seed-minibtn {
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
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, border-color 0.08s, color 0.08s;
    }
    .pix-seed-minibtn:hover { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
    /* Hover popover on the compact number: shows the FULL seed (the narrow field
       can clip a long one) + a copy button. Dark to match the seed box; floats on
       document.body so it escapes the node's clipping. */
    .pix-seed-tip {
      position: fixed;
      z-index: 2147483000;
      display: none;
      align-items: center;
      gap: 8px;
      background: #171819;
      border: 1px solid #3a3d40;
      border-radius: 6px;
      padding: 6px 8px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.5);
    }
    .pix-seed-tip-val {
      color: #f2f2f2;
      font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
      font-size: 14px;
      letter-spacing: 0.3px;
      white-space: nowrap;
      user-select: text;
    }
    .pix-seed-tip-copy {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 5px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.14);
      color: ${BRAND};
      cursor: pointer;
      transition: background 0.08s, border-color 0.08s, color 0.08s;
    }
    .pix-seed-tip-copy:hover { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
    .pix-seed-tip-copy.is-flashing,
    .pix-seed-tip-copy.is-flashing:hover { background: #3ec371; border-color: #3ec371; color: #fff; }
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
// Compact body is a single row - use a SMALL fallback for it. Using the full
// 216 fallback whenever the body isn't measured yet (mid-drag, mid-reload) made
// a compact node's floor jump to full height, so it could not shrink back
// (Legacy) and grew on a hard refresh (Nodes 2.0). This keeps a compact node's
// floor small in those windows.
const COMPACT_H_FALLBACK = 48;
const NODE_H_HINT = WIDGET_H_FALLBACK + 48; // starting height (replace-branch only)

const STATE_PROP = "seedState";
const HIDDEN_INPUT_NAME = "SeedState"; // matches Python INPUT_TYPES key

const DEFAULT_SIZE_SETTING = "Pixaroma.Seed.DefaultSize"; // global default: new nodes start compact
const MIN_DIGITS = 3; // was 4; users wanted small, memorable seeds (0-999 at 3 digits)
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
  // Shrink the moment the text overflows AT ALL. The old `+ 1` tolerance let a
  // number that was 1px too wide through, so the last digit's edge got clipped
  // (reported on Legacy). For an <input>, scrollWidth == clientWidth exactly
  // when the text fits, so this stops as soon as it fits - no over-shrink.
  while (fs > MIN && num.scrollWidth > num.clientWidth && guard++ < 24) {
    fs -= 1;
    num.style.fontSize = fs + "px";
  }
}

// Measure the body's content height (children offsetHeight + gaps + padding) so
// the node sizes itself with NO hand-guessed constant. Coarse-round to a 4px
// grid so font/sub-pixel jitter can't creep node.size across save/load
// (dirty-on-load, Vue Compat #18). Falls back to a placeholder before the body
// is laid out (children have offsetHeight 0 on a fresh drop).
function measureSeedHeight(root, compact) {
  const h = root ? measureRootContent(root) : 0;
  // Not laid out yet -> a MODE-AWARE fallback (compact must NOT start at the tall
  // full-height fallback, or it can't shrink back / grows on reload).
  if (!(h > 20)) return compact ? COMPACT_H_FALLBACK : WIDGET_H_FALLBACK;
  return Math.round(h / 4) * 4;
}

const COMPACT_MIN_W = 300; // compact mode widens to at least this so a 16-digit seed sits comfortably (not shrunk small / clipped)

// Re-fit the node to the current content height (used after a Compact/Full
// toggle - a user action, so writing node.size is fine; NEVER call this on the
// load path). In compact mode it also nudges the width up to COMPACT_MIN_W so
// the single-row seed isn't cramped. Works in both renderers (setSize is the
// documented way to shrink a Nodes 2.0 node, which otherwise only grows).
function fitSeedNodeHeight(node) {
  if (typeof node.setSize !== "function") return;
  // Full snaps back to the DEFAULT width so a toggled node matches a fresh one
  // (the "shorter and wider than a new node" report); Compact widens to at least
  // COMPACT_MIN_W so the one-line seed stays readable (keeping any wider width).
  const w = readState(node).compact
    ? Math.max(MIN_W, node.size[0] || NODE_W, COMPACT_MIN_W)
    : NODE_W;
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

// Write `text` to the clipboard, calling flash(ok) when done. Falls back to a
// throwaway-textarea + execCommand for INSECURE contexts (ComfyUI served over
// http://<LAN-IP>), where navigator.clipboard is undefined but a user-gesture
// copy still works. Mirrors Version Check / Show Text.
function copyToClipboard(text, flash) {
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

function copySeed(node, btn, iconMode) {
  const state = readState(node);
  // What-you-see-is-what-you-copy: copy exactly the seed shown in the big field
  // (the last-run seed in Random mode, the locked value in Fixed).
  const text = String(clampSeed(displayedSeed(node, state)));
  copyToClipboard(text, (ok) => {
    // iconMode (compact copy button): flash the colour only, keep the SVG icon
    // (rewriting textContent would wipe it).
    btn.classList.toggle("is-flashing", ok);
    if (!iconMode) btn.textContent = ok ? "Copied" : "No clipboard";
    setTimeout(() => {
      btn.classList.remove("is-flashing");
      if (!iconMode) btn.textContent = "Copy";
    }, 700);
  });
}

// ── Seed history (global, persistent) ─────────────────────────────────────
// The last N distinct seeds that ACTUALLY RAN, stored in a global ComfyUI
// setting (unregistered settings persist — Vue Compat #20). Deliberately GLOBAL,
// not per-node: it never writes node.properties, so recording a run can't dirty
// a saved workflow (the same reason the last-run seed is runtime-only), and it
// survives reloads. Shown/used from any Seed node's right-click "Seed history".
const HISTORY_SETTING = "Pixaroma.Seed.History";
const HISTORY_MAX = 10;

function getSeedHistory() {
  try {
    const raw = app.ui?.settings?.getSettingValue?.(HISTORY_SETTING);
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map((n) => Number(n)).filter((n) => Number.isFinite(n)).map((n) => clampSeed(n));
  } catch {
    return [];
  }
}

function saveSeedHistory(arr) {
  try {
    app.ui?.settings?.setSettingValueAsync?.(
      HISTORY_SETTING,
      JSON.stringify(arr.slice(0, HISTORY_MAX))
    );
  } catch {}
}

// Record one or more just-run seeds (most-recent first), deduped + capped. Skips
// the write when nothing changed, so Fixed-mode re-runs don't churn the setting.
function recordSeedHistory(seeds) {
  const add = (Array.isArray(seeds) ? seeds : [seeds]).map((s) => clampSeed(s));
  if (!add.length) return;
  const cur = getSeedHistory();
  const seen = new Set();
  const next = [];
  for (const s of [...add, ...cur]) {
    if (seen.has(s)) continue;
    seen.add(s);
    next.push(s);
    if (next.length >= HISTORY_MAX) break;
  }
  if (next.length === cur.length && next.every((s, i) => s === cur[i])) return;
  saveSeedHistory(next);
  refreshSeedHistory(); // update the panel if it happens to be open
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

// ── Hover popover for the COMPACT number field ────────────────────────────
// The compact field can clip a long (16-digit) seed and has no room for a Copy
// button, so hovering it pops a small dark popover showing the FULL seed + a
// copy button. ONE reusable element lives on document.body (escapes the node's
// clipping / z-order); a short grace timer lets the cursor travel from the field
// into the popover to click Copy.
let _seedTipEl = null;
let _seedTipNode = null;
let _seedTipHideTimer = null;

function ensureSeedTip() {
  if (_seedTipEl) return _seedTipEl;
  const tip = document.createElement("div");
  tip.className = "pix-seed-tip";
  const val = document.createElement("span");
  val.className = "pix-seed-tip-val";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pix-seed-tip-copy";
  btn.title = "Copy the seed to the clipboard.";
  btn.innerHTML = COPY_SVG;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (_seedTipNode) copySeed(_seedTipNode, btn, true);
  });
  tip.append(val, btn);
  // Keep the popover open while the cursor is over it (so Copy stays clickable);
  // hide once the cursor leaves it.
  tip.addEventListener("mouseenter", () => {
    if (_seedTipHideTimer) { clearTimeout(_seedTipHideTimer); _seedTipHideTimer = null; }
  });
  tip.addEventListener("mouseleave", () => hideSeedTip());
  document.body.appendChild(tip);
  _seedTipEl = tip;
  return tip;
}

function showSeedTip(node, num) {
  const tip = ensureSeedTip();
  _seedTipNode = node;
  if (_seedTipHideTimer) { clearTimeout(_seedTipHideTimer); _seedTipHideTimer = null; }
  const state = readState(node);
  tip.querySelector(".pix-seed-tip-val").textContent =
    String(clampSeed(displayedSeed(node, state)));
  // Measure while hidden, then place ABOVE the field (flip below if there's no
  // room), clamped to the viewport. getBoundingClientRect is post-zoom SCREEN
  // coords, so a position:fixed popover lands correctly at any graph zoom.
  tip.style.visibility = "hidden";
  tip.style.display = "flex";
  const r = num.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const left = Math.max(4, Math.min(r.left, window.innerWidth - tw - 4));
  let top = r.top - th - 6;
  if (top < 4) top = r.bottom + 6;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  tip.style.visibility = "visible";
}

function scheduleHideSeedTip() {
  if (_seedTipHideTimer) clearTimeout(_seedTipHideTimer);
  _seedTipHideTimer = setTimeout(hideSeedTip, 180);
}

function hideSeedTip() {
  if (_seedTipHideTimer) { clearTimeout(_seedTipHideTimer); _seedTipHideTimer = null; }
  if (_seedTipEl) _seedTipEl.style.display = "none";
  _seedTipNode = null;
}

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
  // Compact only: hovering the (possibly clipped) number shows a popover with
  // the FULL seed + a copy button. Full mode has a real Copy button + a wide
  // field, so it needs neither.
  if (compact) {
    num.addEventListener("mouseenter", () => showSeedTip(node, num));
    num.addEventListener("mouseleave", scheduleHideSeedTip);
  }
  return num;
}

// Nudge the seed by ±1. Nudging picks a specific value, so it locks Fixed (same
// as typing an exact number). Clamps to [0, MAX_SAFE_INTEGER]; a no-op at the
// bounds. Updates the field + pill IN PLACE (no rebuild) so the spinner isn't
// destroyed mid-hold.
function stepSeed(node, root, num, dir) {
  const cur = readState(node);
  // Base off the number the field currently SHOWS — this covers an uncommitted
  // typed value and a Random last-run seed alike; fall back to the effective
  // seed if the field is missing / non-numeric.
  const raw = num ? num.value.replace(/[^\d]/g, "") : "";
  const base = raw !== "" ? clampSeed(raw) : clampSeed(displayedSeed(node, cur));
  const v = clampSeed(base + dir);
  if (v === base) return; // at 0 going down, or at the max going up
  writeState(node, { ...cur, seed: v, mode: "fixed" });
  if (num) { num.value = String(v); fitSeedFont(num); }
  syncModeUI(root, "fixed");
  refreshLastRun(node);
  // Keep the compact hover popover (if it happens to be showing this node) in sync.
  if (_seedTipNode === node && _seedTipEl && _seedTipEl.style.display !== "none") {
    const tv = _seedTipEl.querySelector(".pix-seed-tip-val");
    if (tv) tv.textContent = String(v);
  }
}

// Press-and-hold auto-repeat for a spinner button: one step on press, then repeat
// after a short delay. Self-cleaning on pointerup / cancel / leave (no leaks).
function bindHoldRepeat(btn, fn) {
  btn.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return; // primary button only
    e.preventDefault();
    e.stopPropagation(); // don't let the canvas start a node drag
    fn();
    let iv = null;
    const to = setTimeout(() => { iv = setInterval(fn, 80); }, 400);
    const end = () => {
      clearTimeout(to);
      if (iv) clearInterval(iv);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      btn.removeEventListener("pointerleave", end);
    };
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    btn.addEventListener("pointerleave", end);
  });
}

// The stacked ▲ / ▼ nudge column shown to the right of the seed number (Full
// layout). Literal triangle glyphs in JS text (NOT a CSS \u escape in the CSS
// template literal, which would be an illegal octal — convention #12).
function makeSeedSpinner(node, root, num) {
  const spin = document.createElement("div");
  spin.className = "pix-seed-spin";
  const up = document.createElement("button");
  up.type = "button";
  up.className = "pix-seed-spinbtn";
  up.textContent = "▲";
  up.title = "Increase the seed by 1 (locks it as Fixed). Hold to repeat.";
  up.tabIndex = -1;
  const down = document.createElement("button");
  down.type = "button";
  down.className = "pix-seed-spinbtn";
  down.textContent = "▼";
  down.title = "Decrease the seed by 1 (locks it as Fixed). Hold to repeat.";
  down.tabIndex = -1;
  bindHoldRepeat(up, () => stepSeed(node, root, num, +1));
  bindHoldRepeat(down, () => stepSeed(node, root, num, -1));
  spin.append(up, down);
  return spin;
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
  // The old number element (which the hover popover points at) is about to be
  // destroyed — hide the popover if it belonged to this node.
  if (_seedTipNode === node) hideSeedTip();
  root.innerHTML = "";
  root.classList.toggle("compact", !!state.compact);

  const fitLater = (num) => {
    // Fit the number font now and shortly after — covers the fresh-drop case
    // where the widget isn't laid out on the first frame (in either renderer).
    requestAnimationFrame(() => fitSeedFont(num));
    setTimeout(() => fitSeedFont(num), 60);
    setTimeout(() => fitSeedFont(num), 220);
  };

  // ── COMPACT: one row — number + R|F toggle + N (new fixed random) ──
  // Copy lives in the number's hover popover (which also reveals a clipped seed).
  if (state.compact) {
    const row = document.createElement("div");
    row.className = "pix-seed-minirow";
    const num = makeSeedNumberInput(node, root, true);
    const tog = document.createElement("div");
    tog.className = "pix-seed-minitog";
    tog.appendChild(makeModeSeg(node, root, "random", "R", "Random: roll a new seed every run."));
    tog.appendChild(makeModeSeg(node, root, "fixed", "F", "Fixed: same seed every run."));
    // N = new fixed random (the compact stand-in for the full layout's "New fixed
    // random" button): roll a fresh seed AND lock it (switches to Fixed).
    const nb = document.createElement("button");
    nb.type = "button";
    nb.className = "pix-seed-minibtn";
    nb.textContent = "N";
    nb.title = "New fixed random: roll a new seed and lock it (Fixed).";
    nb.addEventListener("click", () => {
      const cur = readState(node);
      writeState(node, { ...cur, seed: rollSeed(cur.digits), mode: "fixed" });
      renderUI(node);
    });
    row.append(num, tog, nb);
    root.appendChild(row);
    fitLater(num);
    return;
  }

  // ── FULL (default) ──
  const num = makeSeedNumberInput(node, root, false);
  // Number + ▲/▼ nudge spinner in one row (spinner is Full-only; Compact stays a
  // single tight line).
  const numWrap = document.createElement("div");
  numWrap.className = "pix-seed-numwrap";
  numWrap.append(num, makeSeedSpinner(node, root, num));
  root.appendChild(numWrap);

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
    getMinHeight: () => measureSeedHeight(root, readState(node).compact),
    margin: 4,
    serialize: false, // state lives on node.properties, not this widget
  });
  applyAdaptiveCanvasOnly(_widget);
  // Nodes 2.0: a widget WITH computeLayoutSize is the grower row (CLAUDE.md). It's
  // the sole visible widget, so it's safely the grower. Full uses minWidth:1 so
  // the saved width round-trips (Compare gotcha 2); Compact uses a real floor so
  // the one-line seed number isn't clipped in Nodes 2.0 (the compact width is
  // always >= this floor, so it never overrides a wider saved width).
  _widget.computeLayoutSize = () => {
    const compact = readState(node).compact;
    // minWidth stays 1 in BOTH modes so the saved width round-trips. A REAL
    // minWidth makes Nodes 2.0 snap the node WIDER on every reload (Compare
    // gotcha 2) - that was the Ctrl+Shift+R growth. The compact width comes from
    // setSize (fitSeedNodeHeight on a fresh drop / toggle), which persists as
    // node.size and round-trips with minWidth:1.
    return { minHeight: measureSeedHeight(root, compact), minWidth: 1 };
  };
  node._pixSeedRoot = root;

  // Re-fit the seed number font whenever the body's width settles or changes
  // (Vue Compat #13: node.onResize is unreliable for DOM widgets, and in Nodes
  // 2.0 the compact field can settle NARROWER than the first fit measured, which
  // clipped the number). A font change doesn't alter the root's box, so this
  // never loops.
  try {
    node._pixSeedRO = new ResizeObserver(() => {
      const num = root.querySelector(".pix-seed-num");
      if (num) fitSeedFont(num);
    });
    node._pixSeedRO.observe(root);
  } catch {}

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
    const fresh = !node.properties?.[STATE_PROP];
    if (fresh) {
      // Fresh drop: start in the size the user set as their default (a global
      // Pixaroma setting), else Full. Restored nodes keep their saved size.
      const defCompact = !!app.ui?.settings?.getSettingValue?.(DEFAULT_SIZE_SETTING);
      writeState(node, { ...DEFAULT_STATE, seed: rollSeed(DEFAULT_STATE.digits), compact: defCompact });
      // Set the compact width up front so the first paint isn't briefly narrow
      // (the snap below then confirms width + height in both renderers).
      if (defCompact && node.size[0] < COMPACT_MIN_W) node.size[0] = COMPACT_MIN_W;
    }
    // Build into the captured `root` directly — it may not be attached to the
    // page yet on a fresh drop, but the content shows once LiteGraph draws it.
    buildSeedBody(node, root);
    const snap = () => {
      if (typeof node.setSize !== "function") return;
      if (fresh) {
        // Fresh drop: fit to the ACTUAL content (width + height) in BOTH renderers.
        // Nodes 2.0 grows-but-doesn't-shrink, so a fresh COMPACT node would else
        // keep the tall fallback height with a big empty gap below the one-line
        // body (user report). A fresh node has no saved size to preserve, so
        // setSize is safe here (NOT a dirty-on-load path).
        fitSeedNodeHeight(node);
      } else if (!isVueNodes()) {
        // Restored + Legacy: re-fit the (saved) content height, preserving the
        // user's width. NOT Nodes 2.0 for a restored node - that risks dirty-on-
        // load; Vue sizes it via computeLayoutSize. Coarse-rounded + idempotent.
        const w = Math.max(MIN_W, node.size[0] || NODE_W);
        node.setSize([w, node.computeSize()[1]]);
      }
    };
    requestAnimationFrame(snap);
    setTimeout(snap, 120);
    setTimeout(snap, 280); // late pass: the tall Nodes 2.0 fallback settles, THEN shrink
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
        // quick one-click size flip (a size glyph, not the crown, so it stands
        // out from the crowded crown items)
        content: st.compact ? "↕ Seed full size" : "↕ Seed compact size",
        callback: () => toggleSeedCompact(node),
      },
      {
        // the full panel: size (this node + new-node default) + seed digits.
        // Gear icon to match the other Pixaroma settings panels (Save Image etc.)
        content: "⚙ Seed settings",
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
      {
        // recent seeds (global), with Use / Copy / Export .txt. A clock glyph,
        // off the crown, so it stands out from the crowded crown items.
        content: "🕘 Seed history",
        callback: () =>
          openSeedHistory(node, {
            getHistory: getSeedHistory,
            clearHistory: () => { saveSeedHistory([]); refreshSeedHistory(); },
            copyToClipboard,
            useSeed: (seed) => {
              const cur = readState(node);
              writeState(node, { ...cur, seed: clampSeed(seed), mode: "fixed" });
              renderUI(node);
            },
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
      if (!isVueNodes()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        // Height is content-driven; onResize is unreliable (Vue Compat #13), so
        // heal it here too - snap an OVERSIZED height back down to the content so
        // a compact node can't get stuck tall (the user could grow it but not
        // shrink it back). Only when meaningfully too tall, so a correctly-sized
        // node writes nothing (dirty-on-load safe: measureSeedHeight is coarse-
        // rounded, so the target is stable across save/load).
        const target = this.computeSize()[1];
        if (this.size[1] > target + 2) this.size[1] = target;
      }
      if (_origDraw) return _origDraw.apply(this, arguments);
    };

    // Close the settings panel if it belonged to a node that's being removed.
    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSeedSettingsFor(this);
      closeSeedHistoryFor(this);
      if (_seedTipNode === this) hideSeedTip();
      try {
        this._pixSeedRO?.disconnect();
      } catch {}
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
      const ranSeeds = [];
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
          ranSeeds.push(runSeed);
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
      // Remember the seeds that actually ran (global history; never touches
      // node.properties, so it can't dirty a saved workflow).
      if (ranSeeds.length) recordSeedHistory(ranSeeds);
    }
  } catch (e) {
    console.warn("[PixaromaSeed] graphToPrompt inject failed", e);
  }
  return result;
};
