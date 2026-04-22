# Resolution Pixaroma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PixaromaResolution` ComfyUI node that lets the user pick a resolution from a 3×3 ratio chip grid (or type a custom one) and outputs `width` + `height` as plain INTs, ready to wire into any latent / size input.

**Architecture:** Standard Pixaroma split — Python backend reads a JSON state from a hidden STRING widget and returns two ints; JS frontend (single `index.js` like Compare) renders a locked-size DOM widget with chip grid + size list (preset mode) or W/H number inputs (Custom Resolution mode), serializing state back to the hidden widget on every change so save/load round-trips cleanly.

**Tech Stack:** Python 3 (ComfyUI runtime, no extra deps), vanilla JS (no build step, ES modules), CSS injected at runtime. Reuses `BRAND` and `hideJsonWidget` from `js/shared/utils.mjs`.

**Spec:** [docs/superpowers/specs/2026-04-22-resolution-pixaroma-design.md](../specs/2026-04-22-resolution-pixaroma-design.md)

**Note on testing:** This project has no automated test framework (per CLAUDE.md). Each task ends with a manual verification step (reload ComfyUI in the browser, exercise the feature) followed by a local commit on the `Ioan` branch. Per CLAUDE.md Git Workflow: do NOT push to origin unless the user explicitly asks.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `nodes/node_resolution.py` | CREATE | Python node class. Parse JSON state widget, return clamped `(width, height)` ints. ~50 lines. |
| `js/resolution/index.js` | CREATE | Frontend extension. Locks node size, hides JSON widget, renders chip grid + size list / Custom panel, serializes state. ~350 lines (single file — node small enough not to need a directory split, follows Compare's pattern). |
| `__init__.py` | MODIFY | Add `node_resolution` import + merge into `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS`. |

No new backend routes, no new dependencies, no shared-code changes.

---

## Task 1: Backend node + registration

**Goal:** Get `Resolution Pixaroma` showing up in the Add Node menu under `👑 Pixaroma/Utils`, defaulting to 1024×1024 outputs even before any frontend exists.

**Files:**
- Create: `nodes/node_resolution.py`
- Modify: `__init__.py` (lines 1-53 area — imports + mapping merge)

- [ ] **Step 1: Create the Python node**

Write `nodes/node_resolution.py` with this exact content:

```python
"""Resolution Pixaroma — outputs width + height ints chosen via the JS UI."""

import json

DEFAULT_STATE = {
    "mode": "preset",
    "ratio": "1:1",
    "w": 1024,
    "h": 1024,
    "custom_w": 1024,
    "custom_h": 1024,
}


def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


class PixaromaResolution:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ResolutionState": (
                    "STRING",
                    {
                        "default": json.dumps(DEFAULT_STATE),
                        "multiline": False,
                    },
                ),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "get_resolution"
    CATEGORY = "👑 Pixaroma/Utils"

    def get_resolution(self, ResolutionState: str):
        try:
            state = json.loads(ResolutionState)
            w = int(state.get("w", 1024))
            h = int(state.get("h", 1024))
        except Exception:
            print("[PixaromaResolution] Malformed state, falling back to 1024x1024")
            w, h = 1024, 1024
        w = _clamp(w, 64, 16384)
        h = _clamp(h, 64, 16384)
        return (w, h)


NODE_CLASS_MAPPINGS = {"PixaromaResolution": PixaromaResolution}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaResolution": "Resolution Pixaroma"}
```

- [ ] **Step 2: Register the node in `__init__.py`**

Add a new import line in alphabetical-ish position with the other `_MAPS_*` imports (after the `_MAPS_PAINT` import block, before `_MAPS_SHOW_TEXT`):

```python
from .nodes.node_resolution import NODE_CLASS_MAPPINGS as _MAPS_RESOLUTION
from .nodes.node_resolution import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_RESOLUTION
```

Then add `**_MAPS_RESOLUTION,` to the `NODE_CLASS_MAPPINGS` dict-merge (insert in matching alphabetical position) and `**_NAMES_RESOLUTION,` to the `NODE_DISPLAY_NAME_MAPPINGS` dict-merge. Both dicts already exist — just add one line each.

- [ ] **Step 3: Restart ComfyUI and verify**

Restart the ComfyUI server. In the browser:
- Open the Add Node menu, navigate to `👑 Pixaroma/Utils` → confirm `Resolution Pixaroma` is listed.
- Drop the node onto the canvas. It will render with the default ComfyUI text widget showing the JSON string (this is fine for now — the JS will hide it in Task 2).
- Wire `width` and `height` outputs to e.g. `EmptyLatentImage` (or any INT consumer).
- Run the workflow. Confirm `EmptyLatentImage` receives `1024` and `1024`.
- Confirm the Pixaroma startup banner now reports one more node ("X+1 nodes Loaded").

- [ ] **Step 4: Commit**

```bash
git add nodes/node_resolution.py __init__.py
git commit -m "feat(resolution): add PixaromaResolution backend node"
```

---

## Task 2: Frontend skeleton — extension, locked size, hidden widget, empty DOM widget

**Goal:** Hide the raw JSON text widget and replace it with a locked-size empty DOM widget. No interactivity yet — just the shell.

**Files:**
- Create: `js/resolution/index.js`

- [ ] **Step 1: Create the frontend file**

Write `js/resolution/index.js` with this exact content:

```js
import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget } from "../shared/index.mjs";

// Locked node dimensions. Height is computed once we know chip + list heights;
// for Task 2 we use a placeholder constant we'll refine in Task 3 / 4.
const NODE_W = 240;
const NODE_H = 320; // placeholder — refined in Task 3 once CSS dictates real heights

const STATE_WIDGET = "ResolutionState";

const DEFAULT_STATE = {
  mode: "preset",
  ratio: "1:1",
  w: 1024,
  h: 1024,
  custom_w: 1024,
  custom_h: 1024,
};

function readState(node) {
  const w = (node.widgets || []).find((x) => x.name === STATE_WIDGET);
  if (!w?.value) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(w.value);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(node, state) {
  const w = (node.widgets || []).find((x) => x.name === STATE_WIDGET);
  if (w) w.value = JSON.stringify(state);
}

app.registerExtension({
  name: "Pixaroma.Resolution",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaResolution") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);

      // Hide the raw JSON widget — JS owns the UI.
      hideJsonWidget(this.widgets, STATE_WIDGET);

      // Lock the node size and disable resize handle.
      this.resizable = false;
      this.size = [NODE_W, NODE_H];

      // Initial state (from saved widget value or default).
      const state = readState(this);
      writeState(this, state); // normalize back so widget value is canonical

      // Empty placeholder DOM widget — Task 3 fills it in.
      const root = document.createElement("div");
      root.style.cssText = `
        width: 100%;
        min-height: 240px;
        background: #1d1d1d;
        border: 1px dashed #444;
        border-radius: 4px;
        color: ${BRAND};
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: ui-sans-serif, system-ui, sans-serif;
        font-size: 11px;
      `;
      root.textContent = "Resolution UI loading…";

      this.addDOMWidget("resolution_ui", "custom", root, {
        getValue: () => readState(this),
        setValue: (_v) => {}, // we read from the JSON widget, not from this DOM widget value
        getMinHeight: () => 240,
        getMaxHeight: () => 240,
        margin: 4,
      });

      this._pixResRoot = root;
    };

    // Re-clamp on every resize attempt so the node can never grow / shrink.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      this.size[0] = NODE_W;
      this.size[1] = NODE_H;
      if (_origResize) return _origResize.call(this, size);
    };
  },
});
```

- [ ] **Step 2: Reload ComfyUI in the browser and verify**

Hard-refresh the browser (Ctrl+Shift+R) to pick up the new JS file.
- Drop a fresh `Resolution Pixaroma` node.
- Confirm: no visible JSON text widget.
- Confirm: a dashed-bordered placeholder area shows "Resolution UI loading…" in orange.
- Confirm: trying to drag the node's resize handle does nothing — node stays exactly 240×320.
- Run the workflow. Confirm `EmptyLatentImage` still receives `1024 / 1024` (state round-trips through the hidden widget).
- Save the workflow. Reopen it. Confirm node still renders with the placeholder and outputs the same size.

- [ ] **Step 3: Commit**

```bash
git add js/resolution/index.js
git commit -m "feat(resolution): frontend skeleton — locked size, hidden widget"
```

---

## Task 3: CSS injection + chip grid (visual only, no click handlers)

**Goal:** Inject the scoped stylesheet, replace the placeholder with the real 3×3 chip grid. Still no click behavior yet — just markup and visual states (default 1:1 active).

**Files:**
- Modify: `js/resolution/index.js`

- [ ] **Step 1: Add CSS injection at module top-level**

After the imports, before the constants, add this CSS injection (uses a single `<style>` tag, scoped to `.pix-res-*` to avoid bleeding into other Pixaroma editors per CLAUDE.md isolation pattern):

```js
function injectCSS() {
  if (document.getElementById("pixaroma-resolution-css")) return;
  const css = `
    .pix-res-root {
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
    .pix-res-chips {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
    }
    .pix-res-chip {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 0;
      text-align: center;
      font-size: 10px;
      color: #ccc;
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, border-color 0.08s;
    }
    .pix-res-chip:hover { border-color: #666; }
    .pix-res-chip.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-res-chip.span-3 { grid-column: span 3; }
    .pix-res-list {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      min-height: 156px; /* 6 rows × 26px (5 rows of 5+1 spacing) — adjust if row height changes */
      display: flex;
      flex-direction: column;
    }
    .pix-res-row {
      flex: 1;
      padding: 4px 8px;
      border-bottom: 1px solid #2f2f2f;
      font-size: 11px;
      text-align: center;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ui-monospace, monospace;
      color: #ccc;
    }
    .pix-res-row:last-child { border-bottom: none; }
    .pix-res-row.active {
      background: rgba(246,103,68,0.15);
      color: ${BRAND};
      font-weight: 600;
    }
    .pix-res-row.empty {
      cursor: default;
      color: #2a2a2a;
    }
    .pix-res-custom {
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pix-res-custom-row { display: flex; gap: 8px; }
    .pix-res-custom-field { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .pix-res-custom-field label {
      font-size: 9px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
    }
    .pix-res-custom-field input {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      color: ${BRAND};
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      font-family: ui-monospace, monospace;
      box-sizing: border-box;
      width: 100%;
    }
    .pix-res-custom-field input:focus {
      outline: none;
      border-color: ${BRAND};
    }
    .pix-res-swap {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 5px;
      color: #aaa;
      font-size: 10px;
      cursor: pointer;
    }
    .pix-res-swap:hover { color: #ddd; border-color: #666; }
    .pix-res-readout {
      text-align: center;
      font-size: 10px;
      color: #777;
    }
    .pix-res-readout .accent { color: ${BRAND}; }
  `;
  const style = document.createElement("style");
  style.id = "pixaroma-resolution-css";
  style.textContent = css;
  document.head.appendChild(style);
}
injectCSS();
```

- [ ] **Step 2: Define the chip layout and a render function**

After the CSS injection block and before `app.registerExtension`, add:

```js
// Chip layout — order matches design spec
const CHIPS = [
  { id: "1:1",    label: "1:1" },
  { id: "16:9",   label: "16:9" },
  { id: "9:16",   label: "9:16" },
  { id: "2:1",    label: "2:1" },
  { id: "3:2",    label: "3:2" },
  { id: "2:3",    label: "2:3" },
  { id: "custom", label: "Custom Resolution", span3: true },
];

function renderChipGrid(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-chips";
  for (const c of CHIPS) {
    const el = document.createElement("div");
    el.className = "pix-res-chip" + (c.span3 ? " span-3" : "");
    el.textContent = c.label;
    el.dataset.chipId = c.id;
    const isActive =
      (c.id === "custom" && state.mode === "custom") ||
      (c.id !== "custom" && state.mode === "preset" && state.ratio === c.id);
    if (isActive) el.classList.add("active");
    wrap.appendChild(el);
  }
  return wrap;
}
```

- [ ] **Step 3: Replace the placeholder root with the real container**

In the `onNodeCreated` body, replace the placeholder block (the `root.style.cssText = …; root.textContent = "Resolution UI loading…";` part) with:

```js
const root = document.createElement("div");
root.className = "pix-res-root";

// Render chip grid (visual only — no click handlers yet)
root.appendChild(renderChipGrid(state));

// Empty list placeholder for Task 4
const listPlaceholder = document.createElement("div");
listPlaceholder.className = "pix-res-list";
root.appendChild(listPlaceholder);
```

Also update `NODE_H` at the top of the file to a value that visually fits chip grid + 6-row list + node title. Set:

```js
const NODE_H = 290;
```

(If the visual check in Step 4 shows it's too tall or too short, adjust by ±10–20 px.)

- [ ] **Step 4: Reload ComfyUI in the browser and verify**

Hard-refresh. Drop a fresh node:
- Confirm: 3×3 chip grid renders with `1:1`, `16:9`, `9:16` on row 1 and `2:1`, `3:2`, `2:3` on row 2.
- Confirm: `Custom Resolution` chip on row 3 spans the full width.
- Confirm: `1:1` chip is active (orange bg, white text).
- Confirm: hovering an idle chip lightens its border.
- Confirm: the empty list area below has the same dark bg as chips and visible 6-row height.
- Confirm: node is still locked at the configured size; no resize handle works.

- [ ] **Step 5: Commit**

```bash
git add js/resolution/index.js
git commit -m "feat(resolution): chip grid markup + scoped CSS"
```

---

## Task 4: Preset mode — chip click switches ratio + first size, size rows render and click-select

**Goal:** Make ratios and sizes clickable. Clicking a ratio chip switches and auto-selects the first size. Clicking a size row updates the selection. Outputs reflect the choice on the next workflow run.

**Files:**
- Modify: `js/resolution/index.js`

- [ ] **Step 1: Add the SIZES constant**

After the `CHIPS` array, add:

```js
// Sizes per ratio — exactly 6 entries each except 1:1 which has 5 (renders 6th row as empty space)
const SIZES = {
  "1:1":  [[1024,1024],[1280,1280],[1328,1328],[1408,1408],[1536,1536],[2048,2048]],
  "16:9": [[1344,768],[1536,864],[1600,896],[1664,928],[1792,1008],[1920,1088]],
  "9:16": [[768,1344],[864,1536],[896,1600],[928,1664],[1008,1792],[1088,1920]],
  "2:1":  [[1280,640],[1536,768],[1600,800],[1792,896],[1920,960],[2048,1024]],
  "3:2":  [[1152,768],[1344,896],[1536,1024],[1632,1088],[1728,1152],[1920,1280]],
  "2:3":  [[768,1152],[896,1344],[1024,1536],[1088,1632],[1152,1728],[1280,1920]],
};
```

(Note: 1:1 in this list still has 6 entries because we extended it with 2048×2048 in the spec. All 6 ratios now have 6 entries. The `.empty` CSS row class stays in case we ever ship a ratio with fewer entries — keeps the size area at fixed height regardless.)

- [ ] **Step 2: Add the size list renderer**

After `renderChipGrid`, add:

```js
function renderSizeList(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-list";
  if (state.mode !== "preset") return wrap; // Custom mode handled in Task 5
  const sizes = SIZES[state.ratio] || [];
  // Render 6 rows; pad with .empty rows if the ratio has fewer than 6
  for (let i = 0; i < 6; i++) {
    const row = document.createElement("div");
    row.className = "pix-res-row";
    if (i >= sizes.length) {
      row.classList.add("empty");
      row.textContent = ""; // visual gap, no caret on hover
      wrap.appendChild(row);
      continue;
    }
    const [w, h] = sizes[i];
    row.textContent = `${w} × ${h}`;
    row.dataset.w = String(w);
    row.dataset.h = String(h);
    if (state.w === w && state.h === h) row.classList.add("active");
    wrap.appendChild(row);
  }
  return wrap;
}
```

- [ ] **Step 3: Add a top-level render that rebuilds the whole UI from state**

After `renderSizeList`, add:

```js
function renderUI(node) {
  const state = readState(node);
  const root = node._pixResRoot;
  if (!root || !root.isConnected) return; // Vue may have detached us — Task 6 handles re-resolve

  // Rebuild children: chip grid + (size list OR custom panel)
  root.innerHTML = "";
  root.appendChild(renderChipGrid(state));
  root.appendChild(renderSizeList(state));
  // Custom panel comes in Task 5
}
```

- [ ] **Step 4: Wire chip and row clicks via event delegation on root**

Replace the body of `onNodeCreated`'s root construction with:

```js
const root = document.createElement("div");
root.className = "pix-res-root";

root.addEventListener("click", (e) => {
  const chip = e.target.closest(".pix-res-chip");
  if (chip) {
    const id = chip.dataset.chipId;
    const cur = readState(this);
    if (id === "custom") {
      // Custom mode UI lands in Task 5; for now just flip mode and let render show empty list
      writeState(this, { ...cur, mode: "custom" });
    } else {
      const sizes = SIZES[id];
      if (!sizes) return;
      const [w, h] = sizes[0];
      writeState(this, { ...cur, mode: "preset", ratio: id, w, h });
    }
    renderUI(this);
    return;
  }
  const row = e.target.closest(".pix-res-row");
  if (row && !row.classList.contains("empty") && row.dataset.w) {
    const w = parseInt(row.dataset.w, 10);
    const h = parseInt(row.dataset.h, 10);
    const cur = readState(this);
    writeState(this, { ...cur, w, h });
    renderUI(this);
    return;
  }
});

this.addDOMWidget("resolution_ui", "custom", root, {
  getValue: () => readState(this),
  setValue: (_v) => {},
  getMinHeight: () => 240,
  getMaxHeight: () => 240,
  margin: 4,
});

this._pixResRoot = root;
renderUI(this);
```

- [ ] **Step 5: Reload ComfyUI in the browser and verify**

Hard-refresh. Drop a fresh node:
- Default: `1:1` chip orange, `1024 × 1024` row orange-tinted.
- Click `16:9` chip. Verify: `16:9` becomes orange, the size list updates to show `1344 × 768` through `1920 × 1088`, and `1344 × 768` (first size) is auto-selected (orange-tinted).
- Click `1920 × 1088` row. Verify: orange highlight moves to that row.
- Click each other ratio chip in turn — verify lists update correctly and the first size auto-selects each time.
- Wire `width`/`height` outputs to `EmptyLatentImage`. Run workflow. Confirm the latent gets the picked size.
- Save workflow. Reload page. Confirm UI restores the exact ratio + selected size.

- [ ] **Step 6: Commit**

```bash
git add js/resolution/index.js
git commit -m "feat(resolution): preset mode — chip switching + size selection"
```

---

## Task 5: Custom Resolution mode — W/H inputs, swap, snap, clamp, readout

**Goal:** When `Custom Resolution` chip is active, replace the size list area with two number inputs + swap button + live ratio/MP readout. Snap to 16, clamp to [256, 4096], arrow keys nudge ±16. Persist `custom_w`/`custom_h` separately so the saved Custom values survive mode switches.

**Files:**
- Modify: `js/resolution/index.js`

- [ ] **Step 1: Add helpers for ratio / MP display**

After `SIZES` (or anywhere before `renderUI`), add:

```js
function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a || 1;
}

function ratioLabel(w, h) {
  const g = gcd(w, h);
  const rw = w / g, rh = h / g;
  // If the simplified ratio exactly matches one of our presets, label cleanly
  const known = ["1:1","16:9","9:16","2:1","1:2","3:2","2:3"];
  const simple = `${rw}:${rh}`;
  if (known.includes(simple)) return simple;
  // Otherwise show approximate decimal ratio
  const r = w / h;
  return r >= 1 ? `~${r.toFixed(2)}:1` : `~1:${(1 / r).toFixed(2)}`;
}

function megapixels(w, h) {
  return ((w * h) / 1_000_000).toFixed(2);
}

function snap16(n) { return Math.round(n / 16) * 16; }
function clampDim(n) { return Math.max(256, Math.min(4096, n)); }
```

- [ ] **Step 2: Add the Custom panel renderer**

After `renderSizeList`, add:

```js
function renderCustomPanel(node, state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-list pix-res-custom";

  const row = document.createElement("div");
  row.className = "pix-res-custom-row";

  const wField = document.createElement("div");
  wField.className = "pix-res-custom-field";
  const wLabel = document.createElement("label");
  wLabel.textContent = "Width";
  const wInput = document.createElement("input");
  wInput.type = "number";
  wInput.min = "256";
  wInput.max = "4096";
  wInput.step = "16";
  wInput.value = String(state.w);

  const hField = document.createElement("div");
  hField.className = "pix-res-custom-field";
  const hLabel = document.createElement("label");
  hLabel.textContent = "Height";
  const hInput = document.createElement("input");
  hInput.type = "number";
  hInput.min = "256";
  hInput.max = "4096";
  hInput.step = "16";
  hInput.value = String(state.h);

  wField.append(wLabel, wInput);
  hField.append(hLabel, hInput);
  row.append(wField, hField);

  const swap = document.createElement("button");
  swap.type = "button";
  swap.className = "pix-res-swap";
  swap.textContent = "⇄  Swap W ↔ H";

  const readout = document.createElement("div");
  readout.className = "pix-res-readout";

  function refreshReadout(w, h) {
    readout.innerHTML =
      `snaps to 16 px · <span class="accent">${ratioLabel(w, h)}</span> · ${megapixels(w, h)} MP`;
  }
  refreshReadout(state.w, state.h);

  function commit() {
    const wRaw = parseInt(wInput.value, 10);
    const hRaw = parseInt(hInput.value, 10);
    const wNew = clampDim(snap16(Number.isFinite(wRaw) ? wRaw : 1024));
    const hNew = clampDim(snap16(Number.isFinite(hRaw) ? hRaw : 1024));
    wInput.value = String(wNew);
    hInput.value = String(hNew);
    refreshReadout(wNew, hNew);
    const cur = readState(node);
    writeState(node, { ...cur, w: wNew, h: hNew, custom_w: wNew, custom_h: hNew });
  }

  // Live readout on input (no commit yet)
  function liveUpdate() {
    const wLive = parseInt(wInput.value, 10);
    const hLive = parseInt(hInput.value, 10);
    if (Number.isFinite(wLive) && Number.isFinite(hLive)) refreshReadout(wLive, hLive);
  }
  wInput.addEventListener("input", liveUpdate);
  hInput.addEventListener("input", liveUpdate);

  // Commit on blur or Enter
  wInput.addEventListener("blur", commit);
  hInput.addEventListener("blur", commit);
  wInput.addEventListener("keydown", (e) => { if (e.key === "Enter") wInput.blur(); });
  hInput.addEventListener("keydown", (e) => { if (e.key === "Enter") hInput.blur(); });

  // Stop arrow keys / typing from bubbling to ComfyUI canvas shortcuts
  for (const inp of [wInput, hInput]) {
    inp.addEventListener("keydown", (e) => e.stopPropagation());
  }

  swap.addEventListener("click", () => {
    const w = parseInt(wInput.value, 10) || state.w;
    const h = parseInt(hInput.value, 10) || state.h;
    wInput.value = String(h);
    hInput.value = String(w);
    commit();
  });

  wrap.append(row, swap, readout);
  return wrap;
}
```

- [ ] **Step 3: Wire the Custom panel into `renderUI`**

Update `renderUI` to call `renderCustomPanel` when the state is in Custom mode:

```js
function renderUI(node) {
  const state = readState(node);
  const root = node._pixResRoot;
  if (!root || !root.isConnected) return;

  root.innerHTML = "";
  root.appendChild(renderChipGrid(state));
  if (state.mode === "custom") {
    root.appendChild(renderCustomPanel(node, state));
  } else {
    root.appendChild(renderSizeList(state));
  }
}
```

- [ ] **Step 4: Update the chip-click handler to load saved custom values**

In the chip click handler in `onNodeCreated`, change the `if (id === "custom")` branch to:

```js
if (id === "custom") {
  writeState(this, {
    ...cur,
    mode: "custom",
    w: cur.custom_w ?? 1024,
    h: cur.custom_h ?? 1024,
  });
}
```

- [ ] **Step 5: Reload ComfyUI in the browser and verify**

Hard-refresh. Drop a fresh node:
- Click `Custom Resolution` chip. Verify: chip turns orange, size list disappears, replaced with Width/Height inputs both showing `1024`, swap button below, readout shows `snaps to 16 px · 1:1 · 1.05 MP`.
- Type `1500` into Width, blur. Verify: input snaps to `1504`, readout updates.
- Type `50` into Height, blur. Verify: clamps to `256`.
- Type `9999` into Width, blur. Verify: clamps to `4096`.
- Click Width input, press Up Arrow 3 times. Verify: each press increments by 16.
- Click Swap button. Verify: W and H swap instantly.
- Run the workflow. Verify outputs match.
- Click `1:1` chip. Click `Custom Resolution` again. Verify: the values you typed are restored (not reset to 1024×1024).
- Save workflow, reload page. Verify Custom mode + custom values persist exactly.

- [ ] **Step 6: Commit**

```bash
git add js/resolution/index.js
git commit -m "feat(resolution): Custom Resolution mode (W/H + swap + snap)"
```

---

## Task 6: Vue compat polish + state-transition edge cases + full spec verification

**Goal:** Handle Vue frontend's DOM detachment quirks (CLAUDE.md Vue compat #5), validate every behavior in the spec's testing checklist, and finalize.

**Files:**
- Modify: `js/resolution/index.js`

- [ ] **Step 1: Make `renderUI` re-resolve a detached root**

Vue can tear down the DOM widget element while the node remains. Update `renderUI` to recover:

```js
function renderUI(node) {
  const state = readState(node);
  let root = node._pixResRoot;
  if (!root || !root.isConnected) {
    // Vue may have detached the original element. Re-find via the DOM widget.
    const w = (node.widgets || []).find((x) => x.name === "resolution_ui");
    if (w?.element?.isConnected) {
      // The DOM widget container is still live; find our root inside or rebuild it.
      const found = w.element.querySelector(".pix-res-root");
      if (found) {
        node._pixResRoot = found;
        root = found;
      } else {
        // Container exists but our root is gone — append a new one.
        root = document.createElement("div");
        root.className = "pix-res-root";
        w.element.appendChild(root);
        node._pixResRoot = root;
      }
    } else {
      return; // nothing to render into
    }
  }

  root.innerHTML = "";
  root.appendChild(renderChipGrid(state));
  if (state.mode === "custom") {
    root.appendChild(renderCustomPanel(node, state));
  } else {
    root.appendChild(renderSizeList(state));
  }
}
```

Also: the click handler in `onNodeCreated` was attached to the *original* root element. If Vue re-creates the element later, the listener is lost. Move the click handler to be re-attached inside `renderUI` — but that re-binds on every render. Cheaper alternative: delegate at the DOM widget container level. Replace the `root.addEventListener("click", …)` block in `onNodeCreated` with a delegated listener attached on `this.addDOMWidget`'s returned widget's element instead. Concretely:

After the `addDOMWidget` call, capture and attach:

```js
const _widget = this.addDOMWidget("resolution_ui", "custom", root, {
  getValue: () => readState(this),
  setValue: (_v) => {},
  getMinHeight: () => 240,
  getMaxHeight: () => 240,
  margin: 4,
});

const _node = this;
const _onClick = (e) => {
  const chip = e.target.closest(".pix-res-chip");
  if (chip) {
    const id = chip.dataset.chipId;
    const cur = readState(_node);
    if (id === "custom") {
      writeState(_node, {
        ...cur, mode: "custom",
        w: cur.custom_w ?? 1024,
        h: cur.custom_h ?? 1024,
      });
    } else {
      const sizes = SIZES[id];
      if (!sizes) return;
      const [w, h] = sizes[0];
      writeState(_node, { ...cur, mode: "preset", ratio: id, w, h });
    }
    renderUI(_node);
    return;
  }
  const row = e.target.closest(".pix-res-row");
  if (row && !row.classList.contains("empty") && row.dataset.w) {
    const w = parseInt(row.dataset.w, 10);
    const h = parseInt(row.dataset.h, 10);
    const cur = readState(_node);
    writeState(_node, { ...cur, w, h });
    renderUI(_node);
  }
};

// Attach to both root and widget element so a Vue rebuild still routes events
root.addEventListener("click", _onClick);
if (_widget?.element) _widget.element.addEventListener("click", _onClick);

this._pixResRoot = root;
renderUI(this);
```

(Delete the earlier inline `root.addEventListener("click", …)` from Task 4 since this replaces it.)

- [ ] **Step 2: Reload ComfyUI and run the full spec testing checklist**

Hard-refresh. Walk through every item in the spec's "Testing checklist" section. Record any that fail.

The checklist (from the spec):

- [ ] Node appears in Add Node menu under `👑 Pixaroma/Utils`.
- [ ] Default state on create: 1:1 active, 1024×1024 selected, outputs emit 1024 / 1024.
- [ ] Clicking each ratio chip selects first size of that ratio; outputs update on next run.
- [ ] Clicking each size row updates the orange highlight + outputs.
- [ ] All 6 ratios show exactly 6 rows (1:1 has 6 entries after the spec extension).
- [ ] Custom Resolution chip swaps the size area to W / H inputs at 1024 × 1024 on first click.
- [ ] Switching to Custom and back to a preset preserves the preset's last selected size.
- [ ] Switching from a preset to Custom and back to Custom restores the last typed Custom values (not 1024×1024 again).
- [ ] Up arrow on Width input increments by 16. Down decrements by 16.
- [ ] Typing `1500` and blurring snaps to `1504` (nearest 16).
- [ ] Typing `50` and blurring clamps to `256`. Typing `9999` clamps to `4096`.
- [ ] Swap W↔H button flips the values.
- [ ] Live ratio + MP readout updates as inputs change.
- [ ] Save workflow → reload page → workflow restores the exact UI state including Custom values.
- [ ] Node cannot be resized (no resize handle, drag does nothing).
- [ ] Wiring `width` and `height` outputs to `EmptyLatentImage` / `EmptySD3LatentImage` works (drop-in replacement).
- [ ] Vue frontend (Comfy desktop default) — node renders, all interactions work.

If any item fails, fix in this task before committing.

- [ ] **Step 3: Final commit**

```bash
git add js/resolution/index.js
git commit -m "feat(resolution): Vue compat + final polish; checklist complete"
```

DONE.

---

## Self-Review

**Spec coverage:**

| Spec section | Implemented in |
|---|---|
| Identity (class, display name, category) | Task 1 (Python class + mappings, `__init__.py` registration) |
| Node UI (locked size, no resize handle) | Task 2 (`resizable=false`, `onResize` re-clamp), Task 6 (verification) |
| Chip grid (3×3, full-width Custom row) | Task 3 (CSS + markup), Task 4 (active-state wiring) |
| Preset mode (size list, 6-row fixed height) | Task 4 (`renderSizeList` + click) |
| Custom mode (W/H inputs, swap, readout) | Task 5 (`renderCustomPanel` + commit/snap/clamp) |
| Behavior table (default state, ratio switch, size click, mode switches) | Task 4 (preset transitions) + Task 5 (Custom transitions, custom_w/custom_h memory) |
| Data model (JSON schema, hidden widget) | Task 1 (Python `INPUT_TYPES` default) + Task 2 (`readState`/`writeState`/`hideJsonWidget`) |
| State transitions table (every row) | Task 4 + Task 5 click handlers |
| Sizes per ratio | Task 4 (`SIZES` const) |
| Backend (parse + clamp + return) | Task 1 (`get_resolution`) |
| Frontend file location & single-file structure | Task 2 (`js/resolution/index.js`) |
| Brand color usage table | Task 3 (CSS) — every surface uses `${BRAND}` |
| Out-of-scope (no batch_size, no thumbnails, no Settings entry) | N/A — explicitly omitted |
| Testing checklist | Task 6 step 2 (full pass) |
| Vue compat (DOM widget refresh on detach) | Task 6 step 1 |

No gaps.

**Placeholder scan:** No "TODO", "TBD", or hand-wavy steps. Every code-touching step shows the actual code. The only judgment-call note is the `NODE_H` value in Task 3 — explicitly documented as "adjust by ±10–20 px if visual check shows misfit", which is appropriate for a UI sizing constant that depends on rendered text metrics.

**Type/name consistency:**
- `STATE_WIDGET = "ResolutionState"` matches the Python `INPUT_TYPES` key `"ResolutionState"`. ✓
- `addDOMWidget` widget name `"resolution_ui"` is referenced consistently in Task 6 step 1's re-find logic. ✓
- `_pixResRoot` cached on `this` and read in both Task 5 (renderUI) and Task 6 (re-find). ✓
- CSS class names (`pix-res-root`, `pix-res-chips`, `pix-res-chip`, `pix-res-list`, `pix-res-row`, `pix-res-custom`, `pix-res-custom-row`, `pix-res-custom-field`, `pix-res-swap`, `pix-res-readout`) used consistently across CSS (Task 3) and JS (Tasks 3-5). ✓
- `readState` / `writeState` signatures stable from Task 2 onward. ✓

No issues found.
