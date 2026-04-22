# Resolution Pixaroma — Design Spec

**Date:** 2026-04-22
**Status:** Approved (brainstorm complete, awaiting implementation plan)
**Branch:** Ioan

## Problem

Picking width / height for an `EmptyLatent` (or any size-driven downstream node) currently means typing two numbers or wiring two `INT` nodes. Users want a single node that:

- Outputs `width` and `height` as plain ints (drop-in for any latent / size input).
- Lets them pick a common AI-friendly size with one or two clicks.
- Visually groups sizes by aspect ratio so the right shape is obvious.
- Falls back to a custom W × H when none of the presets fit.
- Looks finished — no scroll bars, no resize handles, no awkward empty space.

## Identity

| Field | Value |
|---|---|
| Class name | `PixaromaResolution` |
| Display name | `Resolution Pixaroma` |
| Category | `👑 Pixaroma/Utils` |
| Outputs | `width: INT`, `height: INT` |
| Backend file | `nodes/node_resolution.py` |
| Frontend file | `js/resolution/index.js` (single file — node small enough not to need a directory split, follows the Compare node's single-file pattern) |
| Registration | Add to `__init__.py` mapping merge in alphabetical position with the other `_MAPS_*` imports |

## UI

### Layout (locked node, no resize handle)

- Approximate width: **240 px**.
- Height = title bar + chip area + size area + output strip. Computed once at create time, locked. `node.resizable = false` and `node.size` re-enforced in `onResize` (Compare-style guard).
- Title bar shows the standard ComfyUI title with a brand orange dot accent.

### Chip grid (always visible)

- CSS grid: `grid-template-columns: repeat(3, 1fr); gap: 5px;` — every chip the same width, no manual sizing.
- 3 rows × 3 columns:
  - Row 1: `1:1` · `16:9` · `9:16`
  - Row 2: `2:1` · `3:2` · `2:3`
  - Row 3: `Custom Resolution` (`grid-column: span 3`)
- States:
  - Idle: dark bg (`#1d1d1d`), 1 px border (`#444`), grey text (`#ccc`).
  - Active: brand orange bg (`#f66744`), white text, orange border.
  - Hover (idle only): subtle border lift.

### Preset mode (any ratio chip selected)

- Below chips: a fixed-height list sized to fit exactly **6 rows** so it never scrolls or crops.
- Each row: centered `WIDTH × HEIGHT` in monospace.
- Click selects. Selected row: orange-tint bg (`rgba(246,103,68,0.15)`) + orange text, bold.
- All 6 ratios have 6 entries each (1:1 was extended to include `2048×2048` during brainstorm so the list is uniformly populated). The `.empty`-row code path is kept as a defensive fallback for any future ratio with fewer than 6 sizes.

### Custom mode (Custom Resolution chip selected)

The size area (same height) is replaced with:

- Two number inputs (Width / Height) — orange digits, monospace, large enough to scan.
- Swap button: `⇄ Swap W ↔ H`.
- Live readout below the swap button: `snaps to 16 px · {ratio} · {MP} MP` where `{ratio}` is the simplified fraction (e.g. `16:9`) or `~16:9` if it doesn't simplify to a known ratio, and `{MP}` is `(w * h / 1_000_000).toFixed(2)`.

Behavior:

- Arrow Up / Down on focused input: ±16 px.
- On commit (blur / Enter): snap to nearest multiple of 16, clamp to `[256, 4096]`.
- Initial values when first switching to Custom: `1024 × 1024` (NOT inherited from previous preset — confirmed in brainstorm).
- Subsequent re-entries to Custom remember the last custom values (round-trip via persistence below).

## Behavior

| Event | Result |
|---|---|
| Node create | Default state: `mode="preset"`, `ratio="1:1"`, `w=1024`, `h=1024`. |
| Click ratio chip | Switch ratio. **Always select the first size of the new ratio.** |
| Click size row | Update `w` / `h` to that row's values. |
| Click `Custom Resolution` chip | Switch to custom mode. Load saved custom W/H if present, else `1024 × 1024`. |
| Edit Width / Height input | Live update (without commit). On commit, snap + clamp. |
| Click Swap | Swap W ↔ H instantly. |
| Workflow save | Serialized JSON state persists in a hidden widget. |
| Workflow load | Hidden widget value drives initial UI state. |

## Data model

A single hidden widget on the node holds JSON:

```json
{
  "mode": "preset",        // "preset" | "custom"
  "ratio": "1:1",          // one of "1:1" | "16:9" | "9:16" | "2:1" | "3:2" | "2:3" — only meaningful when mode == "preset"
  "w": 1024,
  "h": 1024,
  "custom_w": 1024,        // last custom width, restored when user re-enters custom mode
  "custom_h": 1024
}
```

`w` and `h` are the canonical truth — backend reads only these to produce outputs.

### State transitions

| Action | Fields written |
|---|---|
| Click ratio chip `R` | `mode = "preset"`, `ratio = R`, `w / h = first size of R`. `custom_w / custom_h` untouched. |
| Click size row in preset list | `w / h = row values`. `custom_w / custom_h` untouched. |
| Click `Custom Resolution` chip | `mode = "custom"`, `w = custom_w`, `h = custom_h`. `ratio` untouched (preserved so returning to a preset chip keeps a sensible last-active ratio if needed for future polish — not currently surfaced in UI). |
| Edit Width / Height in Custom mode | `w / h = new values` AND `custom_w / custom_h = new values` (kept in sync so the saved-Custom memory always reflects what's on screen). |
| Click Swap in Custom mode | Swap `w ↔ h` and `custom_w ↔ custom_h`. |
| Workflow load with unknown `ratio` (not in the 6-key set) | Fall back to default state (`1:1`, `1024 × 1024`), preserve `custom_w / custom_h` if valid. |
| Workflow load with `mode` != `"preset"` and != `"custom"` | Fall back to default state entirely. |

## Sizes per ratio (8 each)

Extended from the original 6-each (post-implementation, 2026-04-22) to cover AI-video model standards (Wan 2.2, CogVideoX, AnimateDiff). The first two entries of 16:9 / 9:16 / 2:1 are the de facto video sizes and aren't mathematically exact for the ratio (e.g. 832×480 ≈ 1.733 vs 16:9 = 1.778) but are grouped under the closest preset.

| Ratio | Sizes |
|---|---|
| 1:1 | `512×512`, `768×768`, `1024×1024`, `1280×1280`, `1328×1328`, `1408×1408`, `1536×1536`, `2048×2048` |
| 16:9 | `832×480`, `1280×720`, `1344×768`, `1536×864`, `1600×896`, `1664×928`, `1792×1008`, `1920×1088` |
| 9:16 | `480×832`, `720×1280`, `768×1344`, `864×1536`, `896×1600`, `928×1664`, `1008×1792`, `1088×1920` |
| 2:1 | `512×256`, `1024×512`, `1280×640`, `1536×768`, `1600×800`, `1792×896`, `1920×960`, `2048×1024` |
| 3:2 | `768×512`, `1024×680`, `1152×768`, `1344×896`, `1536×1024`, `1632×1088`, `1728×1152`, `1920×1280` |
| 2:3 | `512×768`, `680×1024`, `768×1152`, `896×1344`, `1024×1536`, `1088×1632`, `1152×1728`, `1280×1920` |

These live as a single JS const (`SIZES` keyed by ratio) — the source of truth for both the chip → list rendering and the "first size of new ratio" default.

## Backend (`nodes/node_resolution.py`)

```python
class PixaromaResolution:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ResolutionState": ("STRING", {
                    "default": '{"mode":"preset","ratio":"1:1","w":1024,"h":1024,"custom_w":1024,"custom_h":1024}',
                    "multiline": False,
                }),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "get_resolution"
    CATEGORY = "👑 Pixaroma/Utils"

    def get_resolution(self, ResolutionState: str):
        # Parse, fall back to safe default if malformed.
        # Clamp to [64, 16384] as a final safety net.
        ...
```

- No file I/O, no model loading, no `OUTPUT_NODE`. Pure compute.
- Unknown / malformed JSON → return `(1024, 1024)` and log a single warning.
- Width / height clamped to `[64, 16384]` before return as a defensive backstop (the JS already snaps + clamps, but the backend can't trust client state).

## Frontend (`js/resolution/index.js`)

Single file, single `app.registerExtension` block. Estimated ~300–400 lines including CSS injection. Key responsibilities:

1. `beforeRegisterNodeDef` — hook the node class:
   - In `onNodeCreated`:
     - Lock size: `this.resizable = false`, `this.size = [240, COMPUTED_H]`.
     - Hide the raw `ResolutionState` text widget (use `hideJsonWidget` from `js/shared/utils.mjs` if it works for plain STRING widgets, else inline `widget.hidden = true` + `widget.computeSize = () => [0, -4]`).
     - Add a DOM widget that builds the chip grid + size area.
     - Parse the existing widget value, or apply default state.
     - Render initial UI.
   - In `onResize`: re-clamp size to `[240, COMPUTED_H]`.
2. State management — pure JS object mirroring the JSON schema. Mutations call `_writeBack()` which serializes to the hidden widget and re-renders the affected DOM region.
3. CSS injected once into `<head>` (single `<style id="pixaroma-resolution-css">` block) — scoped to a `.pix-res-*` class prefix to avoid bleeding into other Pixaroma editors (CLAUDE.md 3D CSS isolation pattern).
4. Vue compat:
   - DOM widget element refresh on detach: cache the root element, but on every `_writeBack` verify `root.isConnected`; if not, re-find it from `node.widgets` (CLAUDE.md Vue compat #5 pattern).
   - No `installFocusTrap` — node has plain `<input type="number">`s and Vue's keyboard handling is fine for these (no contenteditable).
5. No backend routes needed — node is pure compute.

## Brand color usage

| Surface | Color |
|---|---|
| Active ratio chip bg | `#f66744` (BRAND) |
| Active ratio chip text | `#fff` |
| Selected size row text + bold | `#f66744` |
| Selected size row bg | `rgba(246,103,68,0.15)` |
| Custom mode number input values | `#f66744` |
| Custom mode `{ratio} · {MP} MP` readout | `{ratio}` in `#f66744`, rest grey |
| Output line W / H values | `#f66744` |
| Title dot accent | `#f66744` |

`BRAND` const imported from `js/shared/utils.mjs`.

## Out of scope (explicitly)

- No `batch_size` output (matches user spec — width + height only; `EmptyLatent` keeps its own `batch_size` widget).
- No "preview rectangle" thumbnail of the chosen ratio.
- No tooltip on size rows (compact display already shows W × H).
- No registered ComfyUI Settings entry (no user preferences worth persisting at this point).
- No keyboard shortcuts beyond Up / Down nudge inside the Custom inputs.
- No "save my custom presets" feature.

## Testing checklist (manual, post-impl)

- [ ] Node appears in Add Node menu under `👑 Pixaroma/Utils`.
- [ ] Default state on create: 1:1 active, 1024×1024 selected, outputs emit 1024 / 1024.
- [ ] Clicking each ratio chip selects first size of that ratio; outputs update.
- [ ] Clicking each size row updates the orange highlight + outputs.
- [ ] All 6 ratios show exactly 6 populated rows, no scroll bar.
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
