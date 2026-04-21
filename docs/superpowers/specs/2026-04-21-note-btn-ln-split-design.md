# Note Pixaroma — Button / Line color split + toolbar reorg

**Date:** 2026-04-21
**Branch:** Ioan
**Status:** Approved, ready for implementation plan

## Problem

The single `Ac` (accent) picker drives only one thing visually — the Download pill background. Grid borders, grid header underline, and the HR separator are hardcoded (`#333` / `${BRAND}` / `#555`), so they're invisible or clash when the user picks an unusual background color. Additionally, `Ac` sits in the text-color group (`G3`) even though it doesn't affect text — discoverability is poor.

## Goals

- Split `Ac` into two independent pickers: **Btn** (button color) and **Ln** (line color).
- Each drives a clearly-scoped set of visuals.
- Pickers live next to the elements they control (not in the text-color group).
- Back-compat: existing notes with `accentColor` set migrate seamlessly to `buttonColor`.

## Non-goals

- New toolbar groups beyond what's already there. We reorg within existing groups.
- Per-button-type color control (e.g. separately colored DL vs VP vs RM). Btn drives all three at once.
- Changing YouTube / Discord pill colors. They stay YouTube-red and Discord-blue respectively (brand recognition).
- Text color customization — `A` / `■` / `Bg` unchanged.

## Design decisions (locked)

### What each picker drives

**Btn** (new name for what `Ac` used to be, scope expanded):
- `a.pix-note-dl` (Download pill) background
- `a.pix-note-vp` (View Page pill) background — previously hardcoded neutral gray
- `a.pix-note-rm` (Read More pill) background — previously hardcoded neutral gray

Scope expansion note: before this change, VP + RM shared a neutral slate-gray while DL used the accent. After: DL/VP/RM all share the user's Btn pick. The icon (download arrow / page / book-open) remains the semantic distinguisher.

**Ln** (new picker):
- Grid cell borders (currently `#333`)
- Grid header underline (currently `${BRAND}` orange hardcoded)
- HR horizontal-rule separator (currently `#555`)

**Unchanged** (keep their existing colors):
- `a.pix-note-yt` — `#ff3838` (YouTube brand)
- `a.pix-note-discord` — `#5865f2` (Discord brand)

### Defaults

- `buttonColor` defaults to `#f66744` (brand orange — matches previous `accentColor` default, zero visual change for fresh DL pills).
- `lineColor` defaults to `#f66744` (brand orange). Fresh grids get an orange header underline + orange borders; fresh HRs become orange. This is a small cosmetic change for *existing* notes that contain HRs (previously gray `#555`) on first-open after upgrade, but it's intentional — the whole point is that lines should now be branded and visible.

### Toolbar reorganization

**Current layout** (6 groups):

| Group | Contents |
|---|---|
| G1 | B / I / U / S / Clear format |
| G2 | H1 / H2 / H3 |
| G3 | A (text) · ■ (highlight) · Bg · **Ac** |
| G4 | • List · 1. List |
| G5 | 🔗 · ⟨/⟩ · — (hr) |
| G6 | Button Design · YouTube · Discord · Grid |

**New layout:**

| Group | Contents | Change |
|---|---|---|
| G1 | B / I / U / S / Clear format | unchanged |
| G2 | H1 / H2 / H3 | unchanged |
| G3 | A (text) · ■ (highlight) · Bg | **Ac removed** (split below) |
| G4 | • List · 1. List | unchanged |
| G5 | 🔗 · ⟨/⟩ · — (hr) · ⊞ (grid) · **Ln** | **Grid moved here from G6**; **Ln added at end** |
| G6 | Button Design · **Btn** · YouTube · Discord | **Btn added after Button Design**; **Grid removed** (moved to G5) |

Rationale:
- Ln sits directly next to HR and Grid — the two elements its color drives. Discovery-by-adjacency.
- Btn sits directly next to Button Design — the primary pill insert. Glance tells you what it does.
- G5 becomes "things that insert HTML blocks / lines + their line color".
- G6 becomes "branded pill blocks + their button color".
- G3 is decluttered to pure text-adjacent colors.

### Config schema

**Before:**
```json
{ "accentColor": "#f66744" }
```

**After:**
```json
{ "buttonColor": "#f66744", "lineColor": "#f66744" }
```

### Back-compat migration

In `parseCfg` (js/note/index.js), after the existing `backgroundColor:"transparent"` migration:

```javascript
// Migration: single accentColor → split buttonColor + lineColor. Existing
// notes authored before the split get their old accent preserved as the
// button color, while lineColor seeds from the DEFAULT (not the old
// accent) so upgrading users don't get a surprise orange HR+grid unless
// they explicitly pick one. New notes written post-split skip this branch.
if (parsed.accentColor !== undefined && parsed.buttonColor === undefined) {
  parsed.buttonColor = parsed.accentColor;
}
delete parsed.accentColor;
```

Decision on existing-note upgrade path: preserve `accentColor` → `buttonColor` (so DL pill stays the same color), but let `lineColor` fall through to the new default (so existing HRs unchanged for users who'd saved notes before — `accentColor` wasn't driving lines anyway, so this is safe).

Wait — spec above says `lineColor` default is `#f66744` (orange). If an upgrading user has an HR saved at `#555` (hardcoded previously), their HR WILL change from gray to orange on first open. That's accepted — the whole point.

If post-testing the user finds this jarring, we can switch the lineColor default to `#555` (neutral gray) or have migration preserve the old hardcoded values explicitly. Flag for V1 feedback.

### Python widget default sync

Per CLAUDE.md Pattern #3: `nodes/node_note.py` ships a JSON `default` for the `note_json` widget. Before save, ComfyUI pre-fills this into the widget value, so the Python default wins against JS `DEFAULT_CFG` on fresh node creation. The default string must be updated to match the new schema:

```python
'default': '{"version":1,"content":"","buttonColor":"#f66744","lineColor":"#f66744","backgroundColor":"#111111","width":420,"height":320}'
```

### CSS changes

- Rename CSS variable `--pix-note-accent` → `--pix-note-btn` (single rename, one consumer: DL pill background).
- DL pill rule: consolidate with VP + RM into a single selector list that uses `var(--pix-note-btn, #f66744)`.
- Remove the VP + RM rule that hardcoded the slate-gray.
- Grid border rule: change `#333` → `var(--pix-note-line, #f66744)`.
- Grid header underline rule (both `.pix-note-body` and `.pix-note-editarea` scopes): change hardcoded `${BRAND}` → `var(--pix-note-line, #f66744)`.
- HR rules (both scopes): change hardcoded `#555` → `var(--pix-note-line, #f66744)`.

### render.mjs + toolbar.mjs CSS-var writes

Two sites currently write `--pix-note-accent`:
- `render.mjs` `renderContent` (for on-canvas body).
- `toolbar.mjs` `applyAccent` (for the editor's contenteditable).

Both sites get updated to:
1. Write `--pix-note-btn` from `cfg.buttonColor`.
2. Write `--pix-note-line` from `cfg.lineColor`.

## Non-goals (restated, explicit)

- No change to the color-picker popup (`openColorPop`) — same swatches, same behavior, same inline error (none needed).
- No change to sanitizer — the CSS variables are inline-style sets, not class allowlist entries.
- No change to the existing undo / save flow.
- No change to the Grid dialog itself. Only the button's toolbar position changes.

## Hard-won patterns to preserve

- **Pattern #3** (Python widget default sync with JS `DEFAULT_CFG`) — the `node_note.py` default string MUST be updated when the JS schema changes.
- **Pattern #14** (`#111111` bg default synced in five places) — we're not touching `backgroundColor`, but the adjacent lines in parseCfg / Python default are the ones we ARE touching; easy to miss a site.
- Inline style writes for CSS custom properties (not classes) — keep `setProperty` pattern, don't add the picker values to the sanitize allowlist.

## Open questions

None. Design is locked.
