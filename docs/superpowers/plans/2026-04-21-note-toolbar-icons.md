# Note Pixaroma — Toolbar icons + folder-hint color follows Ln Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace text labels (A, ■, Bg, Btn, Ln) and unicode glyphs (🔗, ⟨/⟩, —) in the toolbar with tintable SVG mask-icons. For the 5 color pickers, the icon is colored in the currently-selected color — the icon IS the swatch, replacing the bottom-border indicator. Also: fold the folder-hint text color onto the `Ln` picker so user has contrast control over the "Place in: ComfyUI/…" line under button pills.

**Architecture:** CSS `mask-image` + `background-color: var(--pix-note-tbtn-tint, currentColor)` on a new `.pix-note-tbtn-maskicon` class. Each picker button writes `--pix-note-tbtn-tint` inline when its color changes. Plain action buttons (link, code, separator) don't write the var → icon falls back to `currentColor` (toolbar's default text color). Folder hint uses `var(--pix-note-line, #9a9a9a)` so it follows the Ln picker.

**Tech Stack:** Vanilla CSS + JS ES modules, no new dependencies. All 8 SVGs are already in `assets/icons/ui/`.

**Branch:** `Ioan`. Local commits only. Every commit uses:
```
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "<msg>"
```

---

## File Structure

**Modified:**
- `js/note/css.mjs` — add mask-icon base + 8 per-icon rules; remove bottom-border swatch lines where they still exist; update folder-hint color (~40 lines touched)
- `js/note/toolbar.mjs` — swap text labels / unicode for mask-icon spans at 8 sites; replace `borderBottom` swatch writes with `--pix-note-tbtn-tint` CSS-var writes (~50 lines touched)

**No new files.**

## Task 1: Mask icons + tint CSS var + folder hint tied to Ln

**Files:**
- Modify: `D:\ComfyTest\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-Pixaroma\js\note\css.mjs`
- Modify: `D:\ComfyTest\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-Pixaroma\js\note\toolbar.mjs`

### Step 1: Add mask-icon CSS in `css.mjs`

Append the following block to the CSS template literal, placed AFTER the existing `.pix-note-tbtn-icon` rules (the `<img>`-based block-pill icons — search for `pix-note-tbtn-icon` in `css.mjs`, place the new block immediately after):

```css
/* ── Tintable SVG mask icons for toolbar buttons ─────────────────────
   Used by the 5 color pickers (text, highlight, bg, button, line) and
   the 3 plain action buttons (link, code, separator). Mask stamps the
   SVG; background-color fills it. Picker buttons set --pix-note-tbtn-
   tint inline to the user's chosen color — the icon then reads that
   var. Plain buttons leave the var unset, so background-color falls
   back to currentColor (toolbar text color). */
.pix-note-tbtn-maskicon {
  display: inline-block;
  width: 14px;
  height: 14px;
  vertical-align: -2px;
  background-color: var(--pix-note-tbtn-tint, currentColor);
  -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
  -webkit-mask-position: center;
          mask-position: center;
  -webkit-mask-size: contain;
          mask-size: contain;
  pointer-events: none;
}
.pix-note-icon-text-color {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/text-color.svg);
          mask-image: url(/pixaroma/assets/icons/ui/text-color.svg);
}
.pix-note-icon-highlight-color {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/highlight-color.svg);
          mask-image: url(/pixaroma/assets/icons/ui/highlight-color.svg);
}
.pix-note-icon-bg-color {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/bg-color.svg);
          mask-image: url(/pixaroma/assets/icons/ui/bg-color.svg);
}
.pix-note-icon-button-color {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/button-color.svg);
          mask-image: url(/pixaroma/assets/icons/ui/button-color.svg);
}
.pix-note-icon-line-color {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/line-color.svg);
          mask-image: url(/pixaroma/assets/icons/ui/line-color.svg);
}
.pix-note-icon-separator {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/separator.svg);
          mask-image: url(/pixaroma/assets/icons/ui/separator.svg);
}
.pix-note-icon-code {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/code.svg);
          mask-image: url(/pixaroma/assets/icons/ui/code.svg);
}
.pix-note-icon-link {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/link.svg);
          mask-image: url(/pixaroma/assets/icons/ui/link.svg);
}
```

### Step 2: Update folder-hint to follow the Ln picker in `css.mjs`

Find the `.pix-note-folderhint` rule (around line 233–243, search for `pix-note-folderhint`):

```css
.pix-note-body .pix-note-folderhint,
.pix-note-editarea .pix-note-folderhint,
.pix-note-prevwrap .pix-note-folderhint {
  display: block;
  margin: 4px 2px 2px 2px;
  padding: 2px 0;
  color: #9a9a9a;
  font-size: 12px;
  font-style: italic;
  line-height: 1.4;
}
```

Change the `color: #9a9a9a;` line to:

```css
  color: var(--pix-note-line, #9a9a9a);
```

The ::before folder icon that follows is `background-color: currentColor;` — it automatically picks up the new color because `currentColor` on a pseudo-element inherits from the parent's `color` property. No other change needed there.

### Step 3: Add `makeMaskIcon` helper in `toolbar.mjs`

In `toolbar.mjs`, find the `_buildToolbar` method. Near the top of the method body (after the opening `const tb = el(...)` or wherever other helper `const`s live — before any button setup begins), add:

```javascript
  // Build a tintable SVG mask-icon span for a toolbar button. The
  // icon's fill color comes from CSS custom property --pix-note-tbtn-
  // tint on the button element (set inline by color pickers to reflect
  // the current selection) or falls back to currentColor for plain
  // action buttons. `name` must match a CSS class suffix declared in
  // css.mjs — e.g. "text-color" → ".pix-note-icon-text-color".
  const makeMaskIcon = (name) => {
    const span = document.createElement("span");
    span.className = `pix-note-tbtn-maskicon pix-note-icon-${name}`;
    return span;
  };
```

### Step 4: Swap `textColorBtn` label → text-color icon

Find `textColorBtn` setup (around line 318):

```javascript
  const textColorBtn = el("button", "pix-note-tbtn");
  textColorBtn.type = "button";
  textColorBtn.textContent = "A";
  textColorBtn.title = "Text color";
  textColorBtn.style.fontWeight = "bold";
  textColorBtn.style.borderBottom = `3px solid ${SWATCHES[0]}`;
```

Change to:

```javascript
  const textColorBtn = el("button", "pix-note-tbtn");
  textColorBtn.type = "button";
  textColorBtn.title = "Text color";
  textColorBtn.appendChild(makeMaskIcon("text-color"));
  textColorBtn.style.setProperty("--pix-note-tbtn-tint", SWATCHES[0]);
```

(Remove the `textContent = "A"`, `fontWeight = "bold"`, `borderBottom = ...` lines. Replace with the icon append + `setProperty`.)

Then find where this button's swatch updates on color selection (the `openColorPop(...)` click callback around line 340). There's a line like:

```javascript
        textColorBtn.style.borderBottom = `3px solid ${c}`;
```

Change to:

```javascript
        textColorBtn.style.setProperty("--pix-note-tbtn-tint", c);
```

Also find the "mirror the selection's current computed text color" block that runs via `_activeChecks` (around line 356–362). It has:

```javascript
    textColorBtn.style.borderBottom = `3px solid #${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
```

Change to:

```javascript
    textColorBtn.style.setProperty("--pix-note-tbtn-tint", `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`);
```

### Step 5: Swap `hiColorBtn` (highlight) label → highlight-color icon

Find `hiColorBtn` setup (around line 364):

```javascript
  const hiColorBtn = el("button", "pix-note-tbtn");
  hiColorBtn.type = "button";
  hiColorBtn.textContent = "\u25A0";
  hiColorBtn.title = "Highlight color";
```

Change to:

```javascript
  const hiColorBtn = el("button", "pix-note-tbtn");
  hiColorBtn.type = "button";
  hiColorBtn.title = "Highlight color";
  hiColorBtn.appendChild(makeMaskIcon("highlight-color"));
```

Then find the place that updates the button's apparent color when the user picks a highlight (around line 399):

```javascript
        hiColorBtn.style.color = c;
```

Change to:

```javascript
        hiColorBtn.style.setProperty("--pix-note-tbtn-tint", c);
```

And the `_activeChecks` block that mirrors the selection's background color (around line 439):

```javascript
    hiColorBtn.style.color = bg || "";
```

Change to:

```javascript
    if (bg) hiColorBtn.style.setProperty("--pix-note-tbtn-tint", bg);
    else hiColorBtn.style.removeProperty("--pix-note-tbtn-tint");
```

### Step 6: Swap `bgColorBtn` label → bg-color icon

Find `bgColorBtn` setup (around line 446):

```javascript
  const bgColorBtn = el("button", "pix-note-tbtn");
  bgColorBtn.type = "button";
  bgColorBtn.textContent = "Bg";
  bgColorBtn.title = "Page background color";
  bgColorBtn.style.fontWeight = "bold";
  const refreshBgSwatch = () => {
    const c = this.cfg.backgroundColor || "#111111";
    bgColorBtn.style.borderBottom = `3px solid ${c}`;
  };
```

Change to:

```javascript
  const bgColorBtn = el("button", "pix-note-tbtn");
  bgColorBtn.type = "button";
  bgColorBtn.title = "Page background color";
  bgColorBtn.appendChild(makeMaskIcon("bg-color"));
  const refreshBgSwatch = () => {
    const c = this.cfg.backgroundColor || "#111111";
    bgColorBtn.style.setProperty("--pix-note-tbtn-tint", c);
  };
```

### Step 7: Update `makeColorPicker` factory (Btn + Ln)

Find the `makeColorPicker` factory (around line 480). Change:

```javascript
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
```

To take a new `iconName` parameter and use the mask icon:

```javascript
  const makeColorPicker = (iconName, title, cfgKey, cssVar, fallback) => {
    const btn = el("button", "pix-note-tbtn");
    btn.type = "button";
    btn.title = title;
    btn.appendChild(makeMaskIcon(iconName));
    const refreshSwatch = () => {
      const c = this.cfg[cfgKey] || fallback;
      btn.style.setProperty("--pix-note-tbtn-tint", c);
    };
```

(Removed `label` parameter, `textContent`, `fontWeight`, `borderBottom`. Replaced with `iconName` parameter, `appendChild(makeMaskIcon(iconName))`, and `setProperty`.)

Then find the two `makeColorPicker` call sites and update them. The current Btn call:

```javascript
  const btnColorBtn = makeColorPicker(
    "Btn",
    "Button color (Download / View Page / Read More pills)",
    "buttonColor",
    "--pix-note-btn",
    "#f66744"
  );
```

Change `"Btn"` to `"button-color"`:

```javascript
  const btnColorBtn = makeColorPicker(
    "button-color",
    "Button color (Download / View Page / Read More pills)",
    "buttonColor",
    "--pix-note-btn",
    "#f66744"
  );
```

And the Ln call:

```javascript
  const lnColorBtn = makeColorPicker(
    "Ln",
    "Line color (grid borders, grid header underline, HR separator)",
    "lineColor",
    "--pix-note-line",
    "#f66744"
  );
```

Change `"Ln"` to `"line-color"`:

```javascript
  const lnColorBtn = makeColorPicker(
    "line-color",
    "Line color (grid borders, grid header underline, HR separator)",
    "lineColor",
    "--pix-note-line",
    "#f66744"
  );
```

### Step 8: Swap link / code-block / HR unicode glyphs for icons

These three buttons use `makeBtn(icon, tooltip, ...)` where the first arg is an HTML string. Change each call's first arg to render a mask-icon span.

Currently `makeBtn` accepts an icon string that gets set via `innerHTML`. Look at how `makeBtn` constructs the button (search for `function makeBtn` or `const makeBtn = ` in `toolbar.mjs`). If it uses `innerHTML`, you can pass an HTML string that includes the mask-icon span. If it accepts a DOM node, use that.

Find `makeBtn` definition. If the first arg gets assigned via `innerHTML` (most likely), change the call sites as follows.

**Link button** (around line 519):

```javascript
  const linkBtn = makeBtn("\uD83D\uDD17", "Insert link", "", () => {
```

Change the first arg to:

```javascript
  const linkBtn = makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-link"></span>',
    "Insert link", "", () => {
```

**Code block button** (search for `codeBlockBtn` or `\u27E8/\u27E9`):

```javascript
  const codeBlockBtn = makeBtn("\u27E8/\u27E9", "Code block", "", () => {
```

Change to:

```javascript
  const codeBlockBtn = makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-code"></span>',
    "Code block", "", () => {
```

**HR button** (search for `hrBtn` or `\u2014` or `makeBtn.*Separator` / `Horizontal`):

Whatever the current first arg is (likely `"\u2014"` or similar em dash), change to:

```javascript
  /* existing: makeBtn("\u2014", ...) */
  makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-separator"></span>',
    /* keep the rest of the args as they were */
```

(Keep the tooltip, active-state tag, and callback unchanged.)

If `makeBtn` does NOT use `innerHTML` but instead `textContent`, we have a problem — let the implementer report NEEDS_CONTEXT. The existing block-pill buttons use `<img class="pix-note-tbtn-icon" ...>` passed via `makeBtn`, and those work, so `makeBtn` is very likely `innerHTML`-based. Verify by reading its definition.

### Step 9: Syntax check + commit

```bash
cd /d/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma
node --check js/note/css.mjs
node --check js/note/toolbar.mjs
```

Both must pass. Commit:

```bash
git add js/note/css.mjs js/note/toolbar.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): SVG mask-icons for toolbar pickers + actions; folder-hint follows Ln"
```

### Step 10: Manual verify (user)

1. Hard-refresh ComfyUI (Ctrl+F5).
2. Open a note. Toolbar should show:
   - G3: three icons (text-color, highlight-color, bg-color) — each tinted in its respective currently-picked color
   - G5: link / code / separator / grid icons (plain toolbar color), then Ln icon (orange by default)
   - G6: Button Design (unchanged) / button-color icon (orange by default) / YouTube / Discord
3. Click the text-color picker, pick red. The icon itself turns red. No bottom-border swatch.
4. Click in a block of red text — the text-color icon should update to red automatically (existing mirror behavior).
5. Same check for highlight-color: select highlighted text, the highlight-color icon should mirror that color.
6. Change Bg color — bg-color icon updates.
7. Change Btn color — button-color icon updates. DL/VP/RM pills repaint.
8. Change Ln color — line-color icon updates. Grid borders + header underline + HR + **folder hint text under Button Design pills** all repaint.
9. Code / Link / Separator icons: default toolbar color, unaffected by any picker.
10. No regressions: existing formatting, grid insert, pencil edits, save/load all still work.

If any icon doesn't render, check the SVG file path is correct and the `mask-image` URL resolves. If tint doesn't apply, check that `--pix-note-tbtn-tint` is being set inline on the button.

## Regression risk

- Low. Pure UI swap with no behavior change. CSS var fallbacks ensure graceful degradation.
- The `_activeChecks` logic for text/highlight color mirroring — verify the setProperty path doesn't fight with the existing behavior (it shouldn't; we're just swapping the visual indicator).
