import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget, applyAdaptiveCanvasOnly, isVueNodes, measureRootContent } from "../shared/index.mjs";

// ─────────────────────────────────────────────────────────────────────────
// Seed Pixaroma — a seed source with Random / Fixed modes + buttons.
//
// Architecture mirrors Resolution Pixaroma: Python declares a single `hidden`
// SeedState input (no widget, no slot dot); the on-node UI is a DOM widget and
// state lives on node.properties.seedState (LiteGraph serializes it). The
// app.graphToPrompt hook at the bottom injects the resolved per-run seed.
//
// Behaviour:
//   • Random mode  → each Run rolls a fresh seed; "Last run" shows what ran.
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
    .pix-seed-seg {
      flex: 1;
      text-align: center;
      padding: 6px;
      border-radius: 5px;
      font-size: 12px;
      color: rgba(255,255,255,0.55);
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, color 0.08s;
    }
    .pix-seed-seg:hover:not(.active) { color: rgba(255,255,255,0.85); }
    .pix-seed-seg.active {
      background: ${BRAND};
      color: #fff;
      font-weight: 500;
    }
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
      color: rgba(255,255,255,0.42);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
  const style = document.createElement("style");
  style.id = "pixaroma-seed-css";
  style.textContent = css;
  document.head.appendChild(style);
}
injectCSS();

// Locked node WIDTH; the layout is fixed (no reason to resize), which also
// sidesteps the Nodes 2.0 resize-floor handling a draggable DOM node needs.
const NODE_W = 226;
// Body height is MEASURED from the actual content (see measureSeedHeight), not a
// hand-guessed constant — guessing the constant is what caused the gap-then-clip
// oscillation. This fallback is used ONLY before the body is laid out (a fresh
// drop / first paint); the real measure takes over the instant children exist.
const WIDGET_H_FALLBACK = 216;
const NODE_H_HINT = WIDGET_H_FALLBACK + 48; // starting height (replace-branch only)

const STATE_PROP = "seedState";
const HIDDEN_INPUT_NAME = "SeedState"; // matches Python INPUT_TYPES key

const DEFAULT_STATE = {
  seed: 0,
  mode: "random", // "random" | "fixed"
};
// The last-run seed is session-only RUNTIME state on node._pixSeedLastRun
// (NOT node.properties), so a run never rewrites serialized state and can never
// dirty a saved workflow (Vue Compat #18). It doesn't survive a reload, which
// matches the "this session's last run" meaning.

// Roll an exact integer in [0, 2^53) — within JS safe-integer range (so it
// round-trips precisely) and well inside ComfyUI's 0..2^64-1 seed bounds.
function rollSeed() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
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
  const MAX = 19, MIN = 11;
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

// Fill the "Last run" line for the current state (random: actual last seed;
// fixed: a plain hint so the line keeps a constant height = no layout gap).
function refreshLastRunEl(el, mode, lastSeed) {
  if (mode === "fixed") {
    el.textContent = "Fixed: same seed every run";
  } else if (lastSeed != null) {
    el.textContent = `Last run: ${lastSeed}`;
  } else {
    el.textContent = "Last run: not run yet";
  }
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
  const useLast = root.querySelector(".pix-seed-uselast");
  if (useLast) useLast.disabled = lastSeed == null;
}

// Toggle the Random|Fixed pill's active segment in place (no DOM rebuild), so
// committing the number field by clicking a pill/button never destroys that
// control mid-click.
function syncModeUI(root, mode) {
  root.querySelectorAll(".pix-seed-seg").forEach((s) => {
    s.classList.toggle("active", s.dataset.mode === mode);
  });
}

function copySeed(node, btn) {
  const state = readState(node);
  // What-you-see-is-what-you-copy: copy exactly the seed shown in the big
  // field. To grab the actual last-run seed in Random mode, click "Use last
  // seed" first (it loads that seed into the field), then Copy.
  const text = String(clampSeed(state.seed));
  const flash = (ok) => {
    btn.classList.toggle("is-flashing", ok);
    btn.textContent = ok ? "Copied" : "No clipboard";
    setTimeout(() => { btn.classList.remove("is-flashing"); btn.textContent = "Copy"; }, 700);
  };
  // Fallback for INSECURE contexts (ComfyUI served over http://<LAN-IP>), where
  // navigator.clipboard is undefined — a throwaway textarea + execCommand still
  // works because the click is a user gesture. Mirrors Version Check / Show Text.
  const legacyCopy = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      flash(ok);
    } catch (_e) {
      flash(false);
    }
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
function buildSeedBody(node, root) {
  const state = readState(node);
  const lastSeed = node._pixSeedLastRun ?? null; // session-only (see DEFAULT_STATE note)
  root.innerHTML = "";

  // ── big editable seed number ──────────────────────────────────
  const num = document.createElement("input");
  num.type = "text";
  num.spellcheck = false;
  num.autocomplete = "off";
  num.inputMode = "numeric";
  num.className = "pix-seed-num";
  num.value = String(state.seed);
  num.title = "The seed value. Type a number to set an exact seed (switches to Fixed).";
  const commitNum = () => {
    const cleaned = num.value.replace(/[^\d]/g, "");
    const cur = readState(node);
    // Empty / non-numeric input keeps the existing seed instead of wiping to 0.
    const v = cleaned === "" ? cur.seed : clampSeed(cleaned);
    num.value = String(v); // reflect any clamp
    fitSeedFont(num); // a newly-typed long seed may need a smaller font to fit
    // No change -> don't flip the mode on a bare focus/blur, and don't rebuild.
    if (v === cur.seed) return;
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
  root.appendChild(num);

  // ── Random | Fixed pill ───────────────────────────────────────
  const pill = document.createElement("div");
  pill.className = "pix-seed-pill";
  for (const [m, label] of [["random", "Random"], ["fixed", "Fixed"]]) {
    const seg = document.createElement("div");
    seg.className = "pix-seed-seg" + (state.mode === m ? " active" : "");
    seg.textContent = label;
    seg.dataset.mode = m;
    seg.title = m === "random"
      ? "Roll a new random seed every run."
      : "Keep the same seed every run (repeatable result).";
    seg.addEventListener("click", () => {
      const cur = readState(node);
      if (cur.mode === m) return;
      writeState(node, { ...cur, mode: m });
      renderUI(node);
    });
    pill.appendChild(seg);
  }
  root.appendChild(pill);

  // ── New fixed random ──────────────────────────────────────────
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "pix-seed-btn pix-seed-newrandom";
  newBtn.textContent = "New fixed random";
  newBtn.title = "Roll a brand-new random seed and lock it (switches to Fixed).";
  newBtn.addEventListener("click", () => {
    const cur = readState(node);
    writeState(node, { ...cur, seed: rollSeed(), mode: "fixed" });
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

  // Fit the number font now and shortly after — covers the fresh-drop case
  // where the widget isn't laid out on the first frame (in either renderer).
  requestAnimationFrame(() => fitSeedFont(num));
  setTimeout(() => fitSeedFont(num), 60);
  setTimeout(() => fitSeedFont(num), 220);
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

  node.resizable = false;
  // Lock WIDTH only; do NOT force the height. getMinHeight (measured) is the
  // floor and there is no getMaxHeight, so LiteGraph sizes the node to exactly
  // chrome + content — no gap, no clip. Forcing a height is what produced the
  // gap-then-clip oscillation. (The replace branch needs a starting height; the
  // post-layout snap below corrects it immediately.)
  if (Array.isArray(node.size)) { node.size[0] = NODE_W; }
  else { node.size = [NODE_W, NODE_H_HINT]; }

  const root = document.createElement("div");
  root.className = "pix-seed-root";
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

  // Deferred initial render — nodeCreated fires BEFORE configure() restores a
  // saved workflow's properties (Vue Compat #8). A fresh node (no saved state)
  // gets a random starting seed so the big number isn't a lonely 0; a restored
  // node already has seedState so we leave it untouched (no dirty-on-load).
  queueMicrotask(() => {
    if (!node.properties?.[STATE_PROP]) {
      writeState(node, { ...DEFAULT_STATE, seed: rollSeed() });
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
        node.setSize([NODE_W, node.computeSize()[1]]);
      }
    };
    requestAnimationFrame(snap);
    setTimeout(snap, 120);
  });
}

app.registerExtension({
  name: "Pixaroma.Seed",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaSeed") return;

    // Re-render when a different workflow is configured into an existing node.
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      if (this._pixSeedRoot) renderUI(this);
      return r;
    };

    // Lock WIDTH only, and only in LEGACY — in Nodes 2.0 the rendered size lives
    // in the Vue layout store, so writing node.size there desyncs it. Height is
    // governed by the measured getMinHeight / computeLayoutSize.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) this.size[0] = NODE_W;
      if (_origResize) return _origResize.call(this, size);
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

let _seedRunNonce = 0; // monotonic per-call nonce for Random mode (see hook below)
const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== "PixaromaSeed") continue;
        if (!index) index = buildSeedNodeIndex();
        const node = findSeedNode(index, id);
        let runSeed = 0;
        let isRandom = false;
        if (node) {
          const st = readState(node);
          isRandom = st.mode === "random";
          runSeed = isRandom ? rollSeed() : clampSeed(st.seed);
          // Record the last-run seed on a RUNTIME field only (never
          // node.properties) so a run can't dirty a saved workflow (Vue Compat #18).
          node._pixSeedLastRun = runSeed;
          refreshLastRun(node);
        }
        entry.inputs = entry.inputs || {};
        // Random: add a per-call nonce so the injected string ALWAYS differs and
        // the node re-runs even on the ~1-in-2^53 chance two rolls collide.
        // Fixed: NO nonce, so the string is constant and ComfyUI caches it
        // (repeatable). get_seed ignores the nonce.
        entry.inputs[HIDDEN_INPUT_NAME] = isRandom
          ? JSON.stringify({ runSeed, _n: ++_seedRunNonce })
          : JSON.stringify({ runSeed });
      }
    }
  } catch (e) {
    console.warn("[PixaromaSeed] graphToPrompt inject failed", e);
  }
  return result;
};
