# Note Pixaroma — Btn / Ln color split + toolbar reorg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the single `Ac` (accent) picker with two independent pickers — `Btn` (button color, drives all Download / View Page / Read More pills) and `Ln` (line color, drives grid borders + grid header underline + HR separator). Reorganize toolbar so each picker sits next to the elements it controls.

**Architecture:** Rename CSS variable `--pix-note-accent` → `--pix-note-btn` and add `--pix-note-line`. Expand the Btn-driven CSS rule to cover VP + RM pills. Thread new vars through `render.mjs` + `toolbar.mjs`. Split config field `accentColor` → `buttonColor` + `lineColor` with back-compat migration in `parseCfg`. Update Python widget default per Pattern #3. Reorg toolbar groups: remove Ac from G3, move Grid from G6 to end of G5, add Btn to G6 after Button Design, add Ln to end of G5.

**Tech Stack:** Vanilla JS ES modules, no new dependencies. All work inside `js/note/`, `nodes/node_note.py`, and CLAUDE.md.

**Spec:** `docs/superpowers/specs/2026-04-21-note-btn-ln-split-design.md` (approved 2026-04-21).

**Branch:** `Ioan`. Local commits only. Every commit uses the one-shot identity:
```
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "<msg>"
```
Never push without explicit user request.

---

## File Structure

**Modified:**
- `js/note/index.js` — DEFAULT_CFG schema + parseCfg migration (~8 lines)
- `nodes/node_note.py` — widget default JSON string (~1 line)
- `js/note/render.mjs` — renderContent writes both CSS vars (~5 lines)
- `js/note/toolbar.mjs` — remove Ac, add Btn in G6, add Ln in G5, move Grid to G5 (~80 lines touched — removal + two picker copies + button reposition)
- `js/note/css.mjs` — rename accent var, consolidate DL/VP/RM rules, swap hardcoded line colors for the new var (~30 lines touched)
- `CLAUDE.md` — new Pattern #18 for the split + toolbar org rule (~5 lines)

**No new files.**

## Verification

No test suite. Manual browser verification per task.

**This plan uses ONE task** — the config schema change, CSS var rename, and toolbar reorg are tightly coupled and can't be shipped half-done (CSS vars must match what toolbar writes; toolbar repositions depend on what's been removed). Single focused commit.

---

## Task 1: Complete Btn / Ln split + toolbar reorg

**Files:**
- Modify: `js/note/index.js`
- Modify: `nodes/node_note.py`
- Modify: `js/note/render.mjs`
- Modify: `js/note/toolbar.mjs`
- Modify: `js/note/css.mjs`
- Modify: `CLAUDE.md`

### Step 1: Config schema + migration in `js/note/index.js`

**a.** Find `DEFAULT_CFG` (around line 9). Current:

```javascript
const DEFAULT_CFG = {
  version: 1,
  content: "",
  accentColor: "#f66744",
  // ...
  backgroundColor: "#111111",
  width: 420,
  height: 320,
};
```

Replace the `accentColor` line with two new lines:

```javascript
  buttonColor: "#f66744",
  lineColor: "#f66744",
```

Final shape:

```javascript
const DEFAULT_CFG = {
  version: 1,
  content: "",
  buttonColor: "#f66744",
  lineColor: "#f66744",
  // ...
  backgroundColor: "#111111",
  width: 420,
  height: 320,
};
```

Keep whatever comments are above/below those lines — just replace the single `accentColor` line.

**b.** In `parseCfg`, add the migration. Find the existing `backgroundColor:"transparent"` migration block (around line 37-41):

```javascript
    if (parsed.backgroundColor === "transparent" && !parsed.content) {
      delete parsed.backgroundColor;
    }
    return { ...DEFAULT_CFG, ...parsed };
```

Immediately BEFORE the `return` line, insert:

```javascript
    // Migration: single accentColor → split buttonColor + lineColor.
    // Existing notes authored before the split get their accent preserved
    // as the button color. lineColor falls through to the DEFAULT_CFG
    // value rather than inheriting the old accent — accentColor wasn't
    // driving any lines before, so there's no prior-art line color to
    // preserve. See spec 2026-04-21-note-btn-ln-split-design.md.
    if (parsed.accentColor !== undefined && parsed.buttonColor === undefined) {
      parsed.buttonColor = parsed.accentColor;
    }
    delete parsed.accentColor;
```

### Step 2: Python widget default in `nodes/node_note.py`

Find the widget default string (in the `INPUT_TYPES` return, around line 14). Current:

```python
"default": '{"version":1,"content":"","accentColor":"#f66744","backgroundColor":"#111111","width":420,"height":320}',
```

Replace with:

```python
"default": '{"version":1,"content":"","buttonColor":"#f66744","lineColor":"#f66744","backgroundColor":"#111111","width":420,"height":320}',
```

Keep the leading `# NOTE` comments that were above it — just change the one line.

### Step 3: `renderContent` writes both CSS vars in `js/note/render.mjs`

Find `renderContent` (around line 43). Find the accent write line:

```javascript
  bodyEl.style.setProperty("--pix-note-accent", cfg.accentColor || "#f66744");
```

Replace with:

```javascript
  // Two independent pickers after the Btn/Ln split. Both CSS vars are
  // written up-front so on-canvas rendering matches the editor view.
  bodyEl.style.setProperty("--pix-note-btn", cfg.buttonColor || "#f66744");
  bodyEl.style.setProperty("--pix-note-line", cfg.lineColor || "#f66744");
```

### Step 4: Toolbar rewire in `js/note/toolbar.mjs`

This is the largest edit. Four sub-edits.

**4a. Remove the existing `Ac` picker from G3.**

Find the accent picker block (starts around line 471 with the comment `// Per-note accent colour — drives the orange highlight...` and ends with `g3.appendChild(accColorBtn);` around line 500). DELETE the entire block (the comment, the `accColorBtn` setup, the `refreshAccSwatch`, the `applyAccent`, the click handler, and the `g3.appendChild(accColorBtn);` line). G3 should now end with `g3.appendChild(bgColorBtn);` (the bg picker — that stays).

**4b. Build reusable color-picker factory.**

After G3 is fully built and appended (search for `tb.appendChild(g3);` — after deleting the Ac block in 4a, this line now immediately follows `g3.appendChild(bgColorBtn);`). Immediately AFTER `tb.appendChild(g3);` but BEFORE any `g4`/list-group setup begins, define a helper function that creates a picker button. Add:

```javascript
  // Shared color-picker factory for Btn + Ln (and Bg/Ac before them).
  // Returns a configured button that: reads cfg[cfgKey], sets the named
  // CSS var on editArea, shows a bottom-border swatch in the picker's
  // color, opens openColorPop on click, and is live-previewed via the
  // onChange. Factory moves construction logic out of G5/G6 wiring so
  // the two new pickers don't duplicate the Ac pattern five ways.
  const makeColorPicker = (label, title, cfgKey, cssVar, fallback) => {
    const btn = el("button", "pix-note-tbtn");
    btn.type = "button";
    btn.textContent = label;
    btn.title = title;
    btn.style.fontWeight = "bold";
    const refreshSwatch = () => {
      const c = this.cfg[cfgKey] || fallback;
      btn.style.borderBottom = `3px solid ${c}`;
    };
    const apply = () => {
      const c = this.cfg[cfgKey] || fallback;
      this._editArea?.style.setProperty(cssVar, c);
    };
    refreshSwatch();
    apply();
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openColorPop(btn, this.cfg[cfgKey] || fallback, (c) => {
        this.cfg[cfgKey] = (c == null) ? fallback : c;
        apply();
        refreshSwatch();
        this._dirty = true;
      }, true);
    });
    return btn;
  };
```

This factory is used in steps 4c and 4d below.

**4c. Move the Grid button to G5 AND add the Ln picker at the end of G5.**

Find the G5 setup (search for the `g5` variable and the link/code/hr buttons). It currently looks something like:

```javascript
  const g5 = el("div", "pix-note-tgroup");
  // ... linkBtn, codeBlockBtn, hrBtn setup + g5.appendChild calls ...
  tb.appendChild(g5);
  tb.appendChild(el("div", "pix-note-tsep"));
```

You need to:
- Keep the existing link, code block, hr entries.
- BEFORE `tb.appendChild(g5);`, append the Grid button (currently in G6) + the Ln picker.

First, find where the Grid button is currently built (search for `gridIcon` / `gridBtn` in G6 — should be around line 732-738 after the Discord button). The Grid block looks like:

```javascript
  const gridIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/grid.svg" draggable="false">`;
  const gridBtn = makeBtn(gridIcon, "Insert grid (table)", "", () => {});
  gridBtn.onclick = (e) => {
    e.preventDefault();
    this._insertGridBlock(gridBtn);
  };
  g6.appendChild(gridBtn);
```

**Move this entire block** (cut from G6, paste into G5) so it runs AFTER the hr button setup + `g5.appendChild(hrBtn)` but BEFORE `tb.appendChild(g5);`. Change the one `g6.appendChild(gridBtn);` line to `g5.appendChild(gridBtn);`.

Then AFTER the Grid block but still BEFORE `tb.appendChild(g5);`, add the Ln picker:

```javascript
  const lnColorBtn = makeColorPicker(
    "Ln",
    "Line color (grid borders, grid header underline, HR separator)",
    "lineColor",
    "--pix-note-line",
    "#f66744"
  );
  g5.appendChild(lnColorBtn);
```

**4d. Add the Btn picker to G6 (after Button Design, before YouTube).**

Find the Button Design setup in G6 (around line 708 — `bdIcon`, `bdBtn`, `g6.appendChild(bdBtn);`). Immediately AFTER `g6.appendChild(bdBtn);`, insert:

```javascript
  const btnColorBtn = makeColorPicker(
    "Btn",
    "Button color (Download / View Page / Read More pills)",
    "buttonColor",
    "--pix-note-btn",
    "#f66744"
  );
  g6.appendChild(btnColorBtn);
```

After this step, G6 should contain in order: Button Design, Btn picker, YouTube, Discord. (Grid has moved to G5; the Grid build block that used to live here has been cut.)

### Step 5: CSS swap in `js/note/css.mjs`

**5a. Rename the accent CSS var + consolidate DL/VP/RM rules.** Find the DL pill rule (around line 112-115):

```css
.pix-note-body a.pix-note-dl,
.pix-note-editarea a.pix-note-dl,
.pix-note-prevwrap a.pix-note-dl {
  background: var(--pix-note-accent, ${BRAND});
}
```

And the VP + RM rule (around line 125-130):

```css
.pix-note-body a.pix-note-vp,
.pix-note-editarea a.pix-note-vp,
.pix-note-prevwrap a.pix-note-vp,
.pix-note-body a.pix-note-rm,
.pix-note-editarea a.pix-note-rm,
.pix-note-prevwrap a.pix-note-rm { background: #3f3f46; }
```

REPLACE both rules with a single consolidated rule (and update the comment that was just above the VP/RM rule):

```css
/* Btn picker drives all three Pixaroma-styled pills (Download, View
   Page, Read More) via the --pix-note-btn CSS var. Icon is the
   semantic distinguisher; color is unified. YouTube and Discord pills
   keep their brand colors below (recognition is the whole point). */
.pix-note-body a.pix-note-dl,
.pix-note-editarea a.pix-note-dl,
.pix-note-prevwrap a.pix-note-dl,
.pix-note-body a.pix-note-vp,
.pix-note-editarea a.pix-note-vp,
.pix-note-prevwrap a.pix-note-vp,
.pix-note-body a.pix-note-rm,
.pix-note-editarea a.pix-note-rm,
.pix-note-prevwrap a.pix-note-rm {
  background: var(--pix-note-btn, ${BRAND});
}
```

The YT + Discord rules stay as-is. Remove the old standalone DL rule + old VP/RM rule (they're replaced by the consolidated one above).

**5b. HR — both scopes.** Find `.pix-note-body hr` (line 37) and `.pix-note-editarea hr` (line 354). Change:

```css
.pix-note-body hr { border: none; border-top: 1px solid #555; margin: 10px 0; }
```

To:

```css
.pix-note-body hr { border: none; border-top: 1px solid var(--pix-note-line, ${BRAND}); margin: 10px 0; }
```

And similarly:

```css
.pix-note-editarea hr { border:none; border-top: 1px solid #555; margin: 10px 0; }
```

To:

```css
.pix-note-editarea hr { border:none; border-top: 1px solid var(--pix-note-line, ${BRAND}); margin: 10px 0; }
```

**5c. Grid cell borders.** Find the grid cell rule (around line 774-784). Current:

```css
.pix-note-body table.pix-note-grid th,
.pix-note-body table.pix-note-grid td,
.pix-note-editarea table.pix-note-grid th,
.pix-note-editarea table.pix-note-grid td {
  border: 1px solid #333;
  padding: 6px 8px;
  vertical-align: middle;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  text-align: center;
}
```

Change `border: 1px solid #333;` to:

```css
  border: 1px solid var(--pix-note-line, ${BRAND});
```

**5d. Grid header underline — both scopes.** Find the grid `thead th` rule (around line 785-791):

```css
.pix-note-body table.pix-note-grid thead th,
.pix-note-editarea table.pix-note-grid thead th {
  background: #1a1a1a;
  color: #fff;
  font-weight: 700;
  border-bottom: 2px solid ${BRAND};
}
```

Change `border-bottom: 2px solid ${BRAND};` to:

```css
  border-bottom: 2px solid var(--pix-note-line, ${BRAND});
```

**5e. Grid preview (dialog) header underline.** Find the `.pix-note-gridprevcell.head` rule (around line 815-818):

```css
.pix-note-gridprevcell.head {
  background: #333;
  border-bottom: 2px solid ${BRAND};
}
```

This is the mini-preview inside the Grid insert dialog. It should also follow the user's current Ln pick so the dialog's preview matches what the inserted grid will actually look like. Change `border-bottom: 2px solid ${BRAND};` to:

```css
  border-bottom: 2px solid var(--pix-note-line, ${BRAND});
```

Note: the Grid dialog is appended to `document.body`, not inside `.pix-note-editarea` — so the CSS variable must cascade from a parent the dialog actually has. Verify this by checking the dialog's `parentElement` chain. If the `--pix-note-line` var isn't reaching the dialog, the fallback `${BRAND}` kicks in automatically (orange), which matches the dialog's original color — so there's no visual regression either way. The preview will just show whatever Ln is (or orange fallback if the var didn't cascade). This is acceptable for V1; if users complain we can explicitly mirror the var onto `document.body` or the dialog root.

### Step 6: CLAUDE.md pattern #18

In `D:\ComfyTest\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-Pixaroma\CLAUDE.md`, find the "Note Pixaroma Patterns (do not regress)" section. After existing item #17 (the grid/Tab-intercept one), append:

```markdown
18. **Btn / Ln color split + toolbar group colocation** — `js/note/toolbar.mjs` exposes two independent color pickers: **Btn** (drives `--pix-note-btn` CSS var; controls Download / View Page / Read More pill backgrounds via CSS rule consolidation) and **Ln** (drives `--pix-note-line`; controls grid cell borders, grid header underline, and HR separator). YouTube pill (`#ff3838`) and Discord pill (`#5865f2`) stay hardcoded (brand recognition). Btn lives in G6 immediately after Button Design; Ln lives in G5 immediately after Grid. The colocation is intentional — pickers sit next to what they drive. Config schema split from single `accentColor` into `buttonColor` + `lineColor`; `parseCfg` back-compat migrates `accentColor` → `buttonColor` (lineColor falls through to DEFAULT_CFG since accentColor wasn't driving any lines historically). Three sync points for the schema change: `js/note/index.js` DEFAULT_CFG, `parseCfg` migration, and `nodes/node_note.py` widget default — miss one and the canvas node renders with defaults out-of-sync with the editor (same risk class as Pattern #3). Both `render.mjs` and `toolbar.mjs` must write BOTH CSS vars (one on the on-canvas body, one on the editor's contenteditable) — see `_editArea.style.setProperty` sites. Adding a new picker? Use the `makeColorPicker` factory in `toolbar.mjs` — it handles swatch refresh + live preview + openColorPop wiring with a single call.
```

### Step 7: Syntax check + commit

```bash
cd /d/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma
node --check js/note/index.js
node --check js/note/render.mjs
node --check js/note/toolbar.mjs
node --check js/note/css.mjs
```

All four must pass. Then commit:

```bash
git add js/note/index.js js/note/render.mjs js/note/toolbar.mjs js/note/css.mjs nodes/node_note.py CLAUDE.md
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): split Ac into Btn/Ln pickers, reorg toolbar groups for colocation"
```

### Step 8: Manual verify (user in browser, you can't run it)

User verification steps:

1. Hard-refresh ComfyUI (Ctrl+F5).
2. Drop a **new** Note Pixaroma node. Click Edit. Toolbar should show:
   - G3 with A / ■ / Bg (no Ac).
   - G5 with 🔗 / ⟨/⟩ / — / ⊞ / **Ln** (Ln at the end).
   - G6 with Button Design / **Btn** / YouTube / Discord.
3. Insert one each: Download pill, View Page pill, Read More pill, YouTube, Discord, Grid (3x3 with header on), HR.
   - DL / VP / RM all orange `#f66744`.
   - YT still red, Discord still blue.
   - Grid header underline orange. Grid cell borders orange. HR orange.
4. Click **Btn**. Pick a different color (e.g. blue). DL + VP + RM pill backgrounds all update immediately. YT + Discord unchanged.
5. Click **Ln**. Pick a different color (e.g. green). Grid borders + header underline + HR all update immediately. Pills unchanged.
6. Save → Cancel editor → Open again. Both custom colors persist.
7. Open an **existing** note (from a workflow file that has the old `accentColor` field). The Btn color should match the old accent. The Ln color should be the default orange. No fields missing.
8. Code view → Preview round-trip: no visual regressions.

Regression gate: the existing feature set (pencil edit, syntax highlighting, grid insert, Tab navigation, etc.) all continue to work unchanged.

### Step 9: If step 8 passes, report DONE

Print a clear DONE banner. Don't push. User will verify and decide when to push.

---

## Hard-won patterns to preserve

- Pattern #3 (Python ↔ JS default sync) — updated as part of Step 2.
- Pattern #8 (button pill HTML + sanitizer allowlist) — unchanged; we're only recoloring, not changing pill HTML shapes.
- Pattern #14 (`#111111` bg default) — unchanged, not touched.
- Pattern #17 (Grid + Tab intercept) — unchanged, only the Grid button's toolbar group changes.
