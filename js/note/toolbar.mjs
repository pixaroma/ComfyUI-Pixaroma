import { NoteEditor } from "./core.mjs";

// Range helpers are kept for future modal-backed buttons (e.g. link dialog)
// where focus genuinely leaves the edit area. For the current buttons,
// mousedown+preventDefault already keeps focus and selection intact.
function saveRange(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return null;
  return r.cloneRange();
}

function restoreRange(range) {
  if (!range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// 4 rows × 7 = 28 swatches, grouped by purpose so the rows read as a
// proper palette rather than a random grid. The CSS grid below lays them
// out in 7 columns so the row structure stays intact visually.
//
//   Row 1 — Neutrals: white through black, covers 90% of "just a note"
//           backgrounds and is where default (#111111) lives.
//   Row 2 — Bright accents: Pixaroma brand orange plus saturated hues,
//           most useful for text/highlight colour or for an attention-
//           grabbing note ("IMPORTANT").
//   Row 3 — ComfyUI-style muted: approximates the dusty tones from the
//           Vue canvas right-click 'Colors' menu, so Pixaroma notes can
//           colour-coordinate with the built-in node palette.
//   Row 4 — Modern soft / deep: pastels for calm light notes and deep
//           tones for rich dark notes.
const SWATCHES = [
  // Row 1 — Neutrals
  "#ffffff","#d4d4d4","#888888","#555555","#2a2a2a","#111111","#000000",
  // Row 2 — Bright accents (Pixaroma brand first)
  "#f66744","#e74c3c","#f1c40f","#5bd45b","#00bcd4","#4a90e2","#b565e2",
  // Row 3 — ComfyUI-muted node colours
  "#a85848","#a66a3d","#a08147","#6f8e46","#537c90","#4c6db9","#a968c2",
  // Row 4 — Modern soft + deep
  "#ff79c6","#f4a261","#c9a96e","#3a5a40","#1e3a5f","#4a3d6b","#2c3e50",
];

function openColorPop(anchorBtn, currentColor, onPick, allowClear = false) {
  const pop = document.createElement("div");
  pop.className = "pix-note-colorpop";
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.left = `${rect.left}px`;
  pop.style.top = `${rect.bottom + 4}px`;

  const sw = document.createElement("div");
  sw.className = "pix-note-swatches";
  SWATCHES.forEach((c) => {
    const s = document.createElement("div");
    s.className = "pix-note-swatch";
    s.style.background = c;
    if (c.toLowerCase() === (currentColor || "").toLowerCase()) s.classList.add("active");
    s.addEventListener("mousedown", (e) => e.preventDefault());
    s.addEventListener("click", (e) => { e.stopPropagation(); onPick(c); close(); });
    sw.appendChild(s);
  });
  pop.appendChild(sw);

  const row = document.createElement("div");
  row.className = "pix-note-colorrow";
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = /^#[0-9a-f]{6}$/i.test(currentColor || "") ? currentColor : "#f66744";
  picker.addEventListener("mousedown", (e) => e.stopPropagation());
  // Use `change` (fires once when native picker dialog closes) instead of
  // `input` (fires on every drag). Native picker steals focus from the
  // contenteditable; repeated live applies operate on a stale range.
  picker.addEventListener("change", () => { onPick(picker.value); hex.value = picker.value; });
  const hex = document.createElement("input");
  hex.type = "text";
  hex.value = currentColor || "";
  hex.placeholder = "#rrggbb";
  hex.addEventListener("mousedown", (e) => e.stopPropagation());
  hex.oninput = () => {
    const v = hex.value.startsWith("#") ? hex.value : `#${hex.value}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) { onPick(v); picker.value = v; }
  };
  row.appendChild(picker);
  row.appendChild(hex);
  if (allowClear) {
    const cl = document.createElement("div");
    cl.className = "clearbtn";
    cl.title = "Clear";
    cl.addEventListener("mousedown", (e) => e.preventDefault());
    cl.addEventListener("click", (e) => { e.stopPropagation(); onPick(null); close(); });
    row.appendChild(cl);
  }
  pop.appendChild(row);

  document.body.appendChild(pop);

  const onDocClick = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorBtn) close();
  };
  function close() {
    document.removeEventListener("mousedown", onDocClick, true);
    pop.remove();
  }
  setTimeout(() => document.addEventListener("mousedown", onDocClick, true), 0);
}

NoteEditor.prototype._buildToolbar = function () {
  const tb = this._toolbarEl;
  tb.innerHTML = "";
  this._activeChecks = [];

  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

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

  // Two-layer sibling of makeMaskIcon for color pickers. Outline stays
  // currentColor; drop takes --pix-note-tbtn-tint. Uses CSS ::before +
  // ::after so no extra inner DOM nodes are needed. See css.mjs
  // .pix-note-tbtn-maskicon-multi for the layered rendering.
  const makeMaskIconMulti = (name) => {
    const span = document.createElement("span");
    span.className = `pix-note-tbtn-maskicon-multi pix-note-icon-${name}`;
    return span;
  };

  const makeBtn = (label, title, cls, onClick, queryCmd) => {
    const b = el("button", `pix-note-tbtn ${cls || ""}`.trim());
    b.type = "button";
    b.innerHTML = label;
    b.title = title;
    // mousedown prevents the editArea from losing focus + selection
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const r = saveRange(this._editArea);
      this._editArea.focus();
      restoreRange(r);
      onClick(b);
      this._dirty = true;
      this._refreshActiveStates();
    });
    if (queryCmd) {
      this._activeChecks.push(() => {
        let on = false;
        try { on = document.queryCommandState(queryCmd); } catch (e) {}
        b.classList.toggle("active", on);
      });
    }
    return b;
  };

  // Group 1 — text style
  const g1 = el("div", "pix-note-tgroup");
  // Bold uses a custom active check: queryCommandState("bold") returns true
  // inside H1/H2/H3 because those render bold by default, making the button
  // misleadingly light up. Walk up the DOM and only activate when a real
  // <b>/<strong> wraps the selection.
  const bBtn = makeBtn("<b>B</b>", "Bold (Ctrl+B)", "", () =>
    document.execCommand("bold"));
  this._activeChecks.push(() => {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    let explicit = false;
    if (anchor && this._editArea?.contains(anchor)) {
      let n = anchor;
      while (n && n !== this._editArea) {
        if (n.nodeType === 1 && (n.tagName === "B" || n.tagName === "STRONG")) {
          explicit = true; break;
        }
        n = n.parentNode;
      }
    }
    bBtn.classList.toggle("active", explicit);
  });
  g1.appendChild(bBtn);
  g1.appendChild(makeBtn("<i>I</i>", "Italic (Ctrl+I)", "italic", () =>
    document.execCommand("italic"), "italic"));
  g1.appendChild(makeBtn("<span class='under'>U</span>", "Underline (Ctrl+U)", "", () =>
    document.execCommand("underline"), "underline"));
  g1.appendChild(makeBtn("<span class='strike'>S</span>", "Strikethrough", "", () =>
    document.execCommand("strikeThrough"), "strikeThrough"));
  // Clear formatting — always-on orange icon button. Strips inline format
  // (bold/italic/underline/colors), unlinks anchors, unwraps <code>/<pre>
  // (execCommand leaves those alone), and demotes the current block
  // (heading) back to a paragraph. List items are left alone — removing a
  // bullet/numbered wrapper requires toggling the list button itself.
  const clearFmtLabel = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/clear-format.svg" draggable="false">`;
  g1.appendChild(makeBtn(clearFmtLabel, "Clear all formatting on selection", "pix-note-tbtn-accent", () => {
    const sel = window.getSelection();
    if (sel?.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const ca = range.commonAncestorContainer;
      const scope = ca.nodeType === 1 ? ca : ca.parentElement;
      const toUnwrap = new Set();
      const walkUp = (start) => {
        let n = start;
        while (n && n !== this._editArea) {
          if (n.nodeType === 1 && (n.tagName === "CODE" || n.tagName === "PRE")) {
            toUnwrap.add(n);
          }
          n = n.parentNode;
        }
      };
      walkUp(range.startContainer);
      walkUp(range.endContainer);
      if (scope?.querySelectorAll) {
        for (const el of scope.querySelectorAll("code, pre")) {
          if (range.intersectsNode(el)) toUnwrap.add(el);
        }
      }
      for (const el of toUnwrap) {
        const parent = el.parentNode;
        if (!parent) continue;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
      // Also unwrap any UL/OL intersected by the selection: promote every LI
      // to a P and drop the list wrapper. execCommand("removeFormat") doesn't
      // touch lists, so without this step a bulleted/numbered selection still
      // shows its bullets after Tx.
      const listsToUnwrap = new Set();
      const walkUpList = (start) => {
        let n = start;
        while (n && n !== this._editArea) {
          if (n.nodeType === 1 && (n.tagName === "UL" || n.tagName === "OL")) {
            listsToUnwrap.add(n);
          }
          n = n.parentNode;
        }
      };
      walkUpList(range.startContainer);
      walkUpList(range.endContainer);
      if (scope?.querySelectorAll) {
        for (const el of scope.querySelectorAll("ul, ol")) {
          if (range.intersectsNode(el)) listsToUnwrap.add(el);
        }
      }
      for (const list of listsToUnwrap) {
        const parent = list.parentNode;
        if (!parent) continue;
        const lis = Array.from(list.children).filter((c) => c.tagName === "LI");
        for (const li of lis) {
          const p = document.createElement("p");
          while (li.firstChild) p.appendChild(li.firstChild);
          parent.insertBefore(p, list);
        }
        parent.removeChild(list);
      }
    }
    document.execCommand("removeFormat");
    document.execCommand("unlink");
    // Demote headings / blockquotes into plain paragraphs by manual DOM
    // replacement. execCommand("formatBlock", false, "p") sometimes leaves
    // the heading wrapper intact or nests elements awkwardly, especially
    // after the list/code unwrap steps above have already mutated the DOM.
    const sel2 = window.getSelection();
    if (sel2?.rangeCount > 0) {
      const range2 = sel2.getRangeAt(0);
      const ca2 = range2.commonAncestorContainer;
      const scope2 = ca2.nodeType === 1 ? ca2 : ca2.parentElement;
      const blocks = new Set();
      const walkUpBlock = (start) => {
        let n = start;
        while (n && n !== this._editArea) {
          if (n.nodeType === 1 && /^(H1|H2|H3|BLOCKQUOTE)$/.test(n.tagName)) {
            blocks.add(n);
          }
          n = n.parentNode;
        }
      };
      walkUpBlock(range2.startContainer);
      walkUpBlock(range2.endContainer);
      if (scope2?.querySelectorAll) {
        for (const el of scope2.querySelectorAll("h1, h2, h3, blockquote")) {
          if (range2.intersectsNode(el)) blocks.add(el);
        }
      }
      for (const el of blocks) {
        const parent = el.parentNode;
        if (!parent) continue;
        const p = document.createElement("p");
        while (el.firstChild) p.appendChild(el.firstChild);
        parent.replaceChild(p, el);
      }
    }
  }));
  tb.appendChild(g1);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Group 2 — headings
  const mkHeading = (tag, label) =>
    makeBtn(label, `Heading ${tag.toUpperCase()}`, "", () =>
      document.execCommand("formatBlock", false, tag)
    );
  const g2 = el("div", "pix-note-tgroup");
  const h1Btn = mkHeading("h1", "H1");
  const h2Btn = mkHeading("h2", "H2");
  const h3Btn = mkHeading("h3", "H3");
  g2.appendChild(h1Btn);
  g2.appendChild(h2Btn);
  g2.appendChild(h3Btn);
  // No paragraph-reset button — the Tx clear-format button in Group 1
  // already demotes headings back to paragraphs via its manual DOM unwrap.
  tb.appendChild(g2);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Heading active-state: queryCommandValue returns the current block tag
  // (e.g. "h1", "p"). Some browsers wrap it in angle brackets ("<h1>").
  const headingMap = { h1: h1Btn, h2: h2Btn, h3: h3Btn };
  this._activeChecks.push(() => {
    let block = "";
    try { block = (document.queryCommandValue("formatBlock") || "").toString(); } catch (e) {}
    block = block.toLowerCase().replace(/[<>]/g, "");
    for (const [tag, btn] of Object.entries(headingMap)) {
      btn.classList.toggle("active", block === tag);
    }
  });

  // Group 3 — colors
  const g3 = el("div", "pix-note-tgroup");

  const textColorBtn = el("button", "pix-note-tbtn");
  textColorBtn.type = "button";
  textColorBtn.title = "Text color";
  textColorBtn.appendChild(makeMaskIconMulti("text-color"));
  // No initial tint — icon falls back to currentColor (toolbar text
  // color) so it's immediately visible on the dark toolbar. The
  // _activeChecks mirror + openColorPop onPick below will setProperty
  // with the user's real color once anything actually happens.
  textColorBtn.addEventListener("mousedown", (e) => e.preventDefault());
  textColorBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const r = saveRange(this._editArea);
    openColorPop(textColorBtn, null, (c) => {
      this._editArea.focus();
      restoreRange(r);
      // Force CSS output (<span style="color:...">) instead of legacy
      // <font color="..."> so headings and the sanitizer preserve the color.
      document.execCommand("styleWithCSS", false, true);
      if (c == null) {
        // "Clear" means reset to the body's default text color rather than
        // execCommand("removeFormat") which would strip bold/italic/etc too.
        document.execCommand("foreColor", false, "#e4e4e4");
      } else {
        document.execCommand("foreColor", false, c);
      }
      this._dirty = true;
      // Run active-state mirrors FIRST. The text-color mirror reads
      // getComputedStyle at the cursor; for a collapsed selection that
      // returns the parent's (unchanged) color, not our just-picked
      // value, which would clobber the icon tint. Setting tint AFTER
      // the mirror ensures the explicit pick wins visually.
      this._refreshActiveStates();
      if (c != null) {
        textColorBtn.style.setProperty("--pix-note-tbtn-tint", c);
      }
    }, true);
  });
  g3.appendChild(textColorBtn);

  // "Sticky" text-color mirror: walks the selection's ancestors for
  // an EXPLICIT inline style.color. If found, reflect it on the icon.
  // If not found, do nothing — the user's last picked color stays,
  // which matches Notion / Google Docs behaviour and avoids two bugs:
  //   1. A just-picked color getting clobbered by a selectionchange
  //      event that fires when the popup closes (collapsed selection
  //      → no coloured span in DOM → mirror would reset to default).
  //   2. Picking a highlight color then silently resetting the text-
  //      color icon (and vice versa) because queryCommandValue's
  //      internal state gets confused across chained colour commands.
  //
  // Trade-off: if the cursor sits in default-coloured text after the
  // user picked red for something else, the icon stays red ("this is
  // the colour that will apply next / was last picked") rather than
  // tracking the cursor strictly. That's the common editor pattern.
  this._activeChecks.push(() => {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    if (!anchor || !this._editArea?.contains(anchor)) return;
    let n = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    let explicit = "";
    while (n && n !== this._editArea) {
      if (n.style?.color) { explicit = n.style.color; break; }
      n = n.parentElement;
    }
    if (!explicit) return; // Leave the last-picked tint alone.
    // Inline style.color can be either "rgb(r, g, b)" or a hex literal.
    const m = explicit.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (m) {
      const hex = (n) => Number(n).toString(16).padStart(2, "0");
      textColorBtn.style.setProperty("--pix-note-tbtn-tint", `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`);
    } else if (/^#[0-9a-f]{3,8}$/i.test(explicit)) {
      textColorBtn.style.setProperty("--pix-note-tbtn-tint", explicit);
    }
  });

  const hiColorBtn = el("button", "pix-note-tbtn");
  hiColorBtn.type = "button";
  hiColorBtn.title = "Highlight color";
  hiColorBtn.appendChild(makeMaskIconMulti("highlight-color"));
  hiColorBtn.addEventListener("mousedown", (e) => e.preventDefault());
  hiColorBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const r = saveRange(this._editArea);
    openColorPop(hiColorBtn, null, (c) => {
      this._editArea.focus();
      restoreRange(r);
      document.execCommand("styleWithCSS", false, true);
      if (c == null) {
        // hiliteColor("transparent") creates a nested span instead of
        // unsetting the parent span/li's color, so the old highlight
        // persists. Walk the selection's ancestors + descendants and
        // directly strip inline background-color.
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const ca = sel.getRangeAt(0).commonAncestorContainer;
          const scope = ca.nodeType === 1 ? ca : ca.parentNode;
          const targets = new Set([scope, ...scope.querySelectorAll("*")]);
          let p = scope.parentNode;
          while (p && p !== this._editArea && p !== document.body) {
            targets.add(p); p = p.parentNode;
          }
          for (const el of targets) {
            if (el.style && el.style.backgroundColor) {
              el.style.backgroundColor = "";
              if (!el.getAttribute("style")) el.removeAttribute("style");
            }
          }
        }
      } else {
        document.execCommand("hiliteColor", false, c);
        // Chrome quirk: execCommand("hiliteColor", ...) on a collapsed
        // selection CREATES a new <span style="background-color:..."> at
        // the cursor, and in doing so it CLEARS any previously-staged
        // foreColor. If the user just picked a text color (staged but
        // not yet in the DOM), typing would then get the default text
        // color instead. Restage the text color by replaying
        // execCommand("foreColor") immediately after hiliteColor so the
        // two combine. We read the color back from the text-color
        // icon's inline tint so we pick up the most recent A-button
        // choice.
        const stagedFg = textColorBtn.style.getPropertyValue("--pix-note-tbtn-tint").trim();
        if (stagedFg) {
          try { document.execCommand("foreColor", false, stagedFg); } catch (e) {}
        }
      }
      this._dirty = true;
      // Same ordering fix as text-color: run mirrors before setting
      // the tint, so the highlight mirror (which reads ancestor
      // backgroundColor — empty for a collapsed selection not inside
      // a highlighted span) doesn't clobber our explicit pick.
      this._refreshActiveStates();
      if (c != null) {
        hiColorBtn.style.setProperty("--pix-note-tbtn-tint", c);
      }
    }, true);
  });
  g3.appendChild(hiColorBtn);

  // Sticky highlight mirror — same pattern as the text-color mirror
  // above. Walk ancestors for an explicit inline style.backgroundColor;
  // if found, reflect it. If not, leave the last-picked tint alone
  // (common-editor behaviour: icon shows the most recent highlight
  // choice, not strictly what's at the cursor).
  this._activeChecks.push(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this._editArea?.contains(range.commonAncestorContainer)) return;
    const findAncestorBg = (node) => {
      let n = node?.nodeType === 1 ? node : node?.parentElement;
      while (n && n !== this._editArea) {
        if (n.style?.backgroundColor) return n.style.backgroundColor;
        n = n.parentElement;
      }
      return "";
    };
    let bg = findAncestorBg(range.startContainer) || findAncestorBg(range.endContainer);
    if (!bg && !range.collapsed) {
      // Partial selection crossing a highlighted span.
      const ca = range.commonAncestorContainer;
      const scope = ca.nodeType === 1 ? ca : ca.parentElement;
      if (scope) {
        for (const el of scope.querySelectorAll("*")) {
          if (el.style?.backgroundColor && range.intersectsNode(el)) {
            bg = el.style.backgroundColor;
            break;
          }
        }
      }
    }
    if (bg) hiColorBtn.style.setProperty("--pix-note-tbtn-tint", bg);
    // Intentionally no else-branch: don't remove the tint when nothing
    // is found. That keeps the last-picked colour visible.
  });

  // Page background colour — affects the whole editor interior AND the
  // on-canvas node body after save (WYSIWYG). Default is the editor's
  // dark-gray (#111111, matches .pix-note-editarea CSS); Clear resets
  // to that.
  const bgColorBtn = el("button", "pix-note-tbtn");
  bgColorBtn.type = "button";
  bgColorBtn.title = "Page background color";
  bgColorBtn.appendChild(makeMaskIconMulti("bg-color"));
  const refreshBgSwatch = () => {
    const c = this.cfg.backgroundColor || "#111111";
    bgColorBtn.style.setProperty("--pix-note-tbtn-tint", c);
  };
  refreshBgSwatch();
  bgColorBtn.addEventListener("mousedown", (e) => e.preventDefault());
  bgColorBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openColorPop(bgColorBtn, this.cfg.backgroundColor || "#111111", (c) => {
      // null = Clear → reset to the dark-gray default rather than making
      // the editor transparent. Explicit "transparent" would need a
      // separate UI affordance; keep the picker simple for now.
      this.cfg.backgroundColor = (c == null) ? "#111111" : c;
      this._applyEditAreaBg?.();
      refreshBgSwatch();
      this._dirty = true;
    }, true);
  });
  g3.appendChild(bgColorBtn);

  tb.appendChild(g3);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Shared color-picker factory for Btn + Ln (and Bg/Ac before them).
  // Returns a configured button that: reads cfg[cfgKey], sets the named
  // CSS var on editArea, shows a bottom-border swatch in the picker's
  // color, opens openColorPop on click, and is live-previewed via the
  // onChange. Factory moves construction logic out of G5/G6 wiring so
  // the two new pickers don't duplicate the Ac pattern five ways.
  const makeColorPicker = (iconName, title, cfgKey, cssVar, fallback) => {
    const btn = el("button", "pix-note-tbtn");
    btn.type = "button";
    btn.title = title;
    // Two-layer icon: factory pickers are always color pickers, so the
    // outline-stays-white-and-drop-takes-tint treatment is the right
    // default. Single-layer (makeMaskIcon) is only used for plain
    // action buttons like link / code / separator.
    btn.appendChild(makeMaskIconMulti(iconName));
    const refreshSwatch = () => {
      const c = this.cfg[cfgKey] || fallback;
      btn.style.setProperty("--pix-note-tbtn-tint", c);
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

  // Group 4 — lists
  const g4 = el("div", "pix-note-tgroup");
  g4.appendChild(makeBtn("&bull; List", "Bulleted list", "", () =>
    document.execCommand("insertUnorderedList"), "insertUnorderedList"
  ));
  g4.appendChild(makeBtn("1. List", "Numbered list", "", () =>
    document.execCommand("insertOrderedList"), "insertOrderedList"
  ));
  tb.appendChild(g4);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Group 5 — inserts
  const g5 = el("div", "pix-note-tgroup");

  const linkBtn = makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-link"></span>',
    "Insert link", "", () => {
    const selText = window.getSelection()?.toString() || "";
    const savedRange = saveRange(this._editArea);
    this._promptLinkUrl(selText).then((result) => {
      if (!result) return;
      this._editArea.focus();
      restoreRange(savedRange);
      const { url, label } = result;
      document.execCommand(
        "insertHTML", false,
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
      );
      this._dirty = true;
      this._refreshActiveStates();
    });
  });
  g5.appendChild(linkBtn);

  const isSelectionInsideTag = (tagNames) => {
    const s = window.getSelection();
    const anchor = s?.anchorNode;
    if (!anchor || !this._editArea?.contains(anchor)) return false;
    let n = anchor;
    while (n && n !== this._editArea) {
      if (n.nodeType === 1 && tagNames.includes(n.tagName)) return true;
      n = n.parentNode;
    }
    return false;
  };

  // Code block is a toggle: if cursor is inside an existing <pre>, clicking
  // unwraps it back to a paragraph; otherwise it inserts a new block with
  // the placeholder pre-selected. Inline <code> was removed — one
  // code style keeps the allowed HTML shapes simple and predictable.
  const codeBlockBtn = makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-code"></span>',
    "Code block", "", () => {
    // Toggle off: unwrap the current <pre> (and any nested <code>) into a
    // plain paragraph containing its text.
    if (isSelectionInsideTag(["PRE"])) {
      const sel = window.getSelection();
      const anchor = sel?.anchorNode;
      let pre = null;
      let n = anchor;
      while (n && n !== this._editArea) {
        if (n.nodeType === 1 && n.tagName === "PRE") { pre = n; break; }
        n = n.parentNode;
      }
      if (pre?.parentNode) {
        this._snapBefore?.();
        const p = document.createElement("p");
        p.textContent = pre.textContent;
        pre.parentNode.replaceChild(p, pre);
        const r = document.createRange();
        r.selectNodeContents(p);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
        this._snapAfter?.();
      }
      return;
    }
    // Refuse if cursor is inside an inline <code> (leftover from older
    // notes) — nesting <pre> inside <code> violates HTML spec.
    if (isSelectionInsideTag(["CODE"])) return;
    // Safety net: wrap any loose text/inline nodes at the editArea root in
    // <p> before we capture block references. Without this, typing on a
    // fresh note leaves raw text as a direct editArea child, and
    // findTopBlock() returns null for it — the code-block insert then
    // silently appends instead of replacing.
    this._normalizeEditArea?.();
    // Walk up to the top-level block inside editArea. We capture BOTH
    // endpoints of the selection as direct element references before the
    // modal opens — restoring a Range after the modal's focus change is
    // unreliable on Chrome (intersectsNode sometimes misses the first
    // block), so we keep references instead.
    const findTopBlock = (node) => {
      if (!node) return null;
      if (node.nodeType !== 1) node = node.parentNode;
      while (node && node.parentNode !== this._editArea && node !== this._editArea) {
        node = node.parentNode;
      }
      return node && node.parentNode === this._editArea ? node : null;
    };
    let startBlock = null, endBlock = null, wasCollapsed = true;
    const sel0 = window.getSelection();
    if (sel0?.rangeCount > 0) {
      const r0 = sel0.getRangeAt(0);
      wasCollapsed = r0.collapsed;
      startBlock = findTopBlock(r0.startContainer);
      endBlock = findTopBlock(r0.endContainer);
    }
    // Collect code through a modal so the block is built as one clean
    // DOM insert — avoids the edge cases that came from letting the user
    // type directly inside a fresh <pre><code> (cursor escaping, nested
    // inserts, node-vanishing on save).
    // Trim the selected-text preview: Chrome's selection.toString() across
    // block boundaries injects newlines/spaces around block edges, which
    // otherwise shows as a stray leading blank inside the code modal.
    const rawSel = window.getSelection()?.toString() || "";
    const selText = rawSel.replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, "");
    this._promptCodeBlock(selText).then((code) => {
      if (code == null) return;
      this._snapBefore?.();
      // Build the replacement nodes: <pre><code>…</code></pre> plus a
      // trailing empty <p> so the user has somewhere to type below.
      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      const trailing = document.createElement("p");
      trailing.appendChild(document.createElement("br"));
      // Walk from startBlock to endBlock (inclusive) using direct element
      // references captured before the modal. If either reference became
      // detached (e.g. user clicked elsewhere between open and Insert),
      // fall back to append.
      const toReplace = [];
      if (
        !wasCollapsed &&
        startBlock?.parentNode === this._editArea &&
        endBlock?.parentNode === this._editArea
      ) {
        let n = startBlock;
        while (n) {
          toReplace.push(n);
          if (n === endBlock) break;
          n = n.nextElementSibling;
        }
      }
      if (toReplace.length > 0) {
        const first = toReplace[0];
        this._editArea.insertBefore(pre, first);
        this._editArea.insertBefore(trailing, pre.nextSibling);
        for (const b of toReplace) {
          if (b.parentNode === this._editArea) this._editArea.removeChild(b);
        }
      } else if (startBlock && startBlock.parentNode === this._editArea) {
        startBlock.parentNode.insertBefore(pre, startBlock.nextSibling);
        pre.parentNode.insertBefore(trailing, pre.nextSibling);
      } else {
        this._editArea.appendChild(pre);
        this._editArea.appendChild(trailing);
      }
      const r = document.createRange();
      r.selectNodeContents(trailing);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      this._editArea.focus();
      this._snapAfter?.();
      this._dirty = true;
      this._refreshActiveStates();
    });
  });
  g5.appendChild(codeBlockBtn);

  g5.appendChild(makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-separator"></span>',
    "Horizontal separator", "", () => {
    document.execCommand("insertHTML", false, `<hr><p><br></p>`);
  }));

  const gridIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/grid.svg" draggable="false">`;
  const gridBtn = makeBtn(gridIcon, "Insert grid (table)", "", () => {});
  gridBtn.onclick = (e) => {
    e.preventDefault();
    this._insertGridBlock(gridBtn);
  };
  g5.appendChild(gridBtn);

  const lnColorBtn = makeColorPicker(
    "line-color",
    "Line color (grid borders, grid header underline, HR separator)",
    "lineColor",
    "--pix-note-line",
    "#f66744"
  );
  g5.appendChild(lnColorBtn);

  // Active-state for link / code block: walk up from selection anchor and
  // toggle .active when the matching ancestor exists.
  this._activeChecks.push(() => {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    let inA = false, inPre = false;
    if (anchor && this._editArea?.contains(anchor)) {
      let n = anchor;
      while (n && n !== this._editArea) {
        if (n.nodeType === 1) {
          if (n.tagName === "A") inA = true;
          else if (n.tagName === "PRE") inPre = true;
        }
        n = n.parentNode;
      }
    }
    linkBtn.classList.toggle("active", inA);
    codeBlockBtn.classList.toggle("active", inPre);
  });

  tb.appendChild(g5);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Group 6 — Pixaroma blocks
  const g6 = el("div", "pix-note-tgroup");

  // Unified "Button Design" entry — opens a rich dialog where the user
  // picks an icon (Download / View Page / Read More) and toggles whether
  // to attach a folder suggestion and a size hint. The 3 pill types still
  // exist as CSS classes so old notes keep rendering.
  const bdIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/button-design.svg" draggable="false">`;
  const bdBtn = makeBtn(bdIcon, "Insert button (Download / View Page / Read More)", "", () => {});
  bdBtn.onclick = (e) => {
    e.preventDefault();
    this._insertButtonBlock(bdBtn);
  };
  g6.appendChild(bdBtn);

  const btnColorBtn = makeColorPicker(
    "button-color",
    "Button color (Download / View Page / Read More pills)",
    "buttonColor",
    "--pix-note-btn",
    "#f66744"
  );
  g6.appendChild(btnColorBtn);

  const ytIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/youtube.svg" draggable="false">`;
  const ytBtn = makeBtn(ytIcon, "Insert YouTube link", "", () => {});
  ytBtn.onclick = (e) => {
    e.preventDefault();
    this._insertYouTubeBlock(ytBtn);
  };
  g6.appendChild(ytBtn);

  const dcIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/discord.svg" draggable="false">`;
  const dcBtn = makeBtn(dcIcon, "Insert Discord link", "", () => {});
  dcBtn.onclick = (e) => {
    e.preventDefault();
    this._insertDiscordBlock(dcBtn);
  };
  g6.appendChild(dcBtn);

  tb.appendChild(g6);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Right-aligned undo / redo. Flex spacer pushes this group to the end
  // of the toolbar so it sits opposite the editing controls on the left.
  const spacer = el("div", "pix-note-tspacer");
  tb.appendChild(spacer);
  const gURight = el("div", "pix-note-tgroup");
  const undoLabel = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/undo.svg" draggable="false">`;
  const redoLabel = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/redo.svg" draggable="false">`;
  gURight.appendChild(makeBtn(undoLabel, "Undo (Ctrl+Z)", "pix-note-tbtn-accent", () => {
    this.doUndo?.();
  }));
  gURight.appendChild(makeBtn(redoLabel, "Redo (Ctrl+Shift+Z)", "pix-note-tbtn-accent", () => {
    this.doRedo?.();
  }));
  tb.appendChild(gURight);

  // View toggle: WYSIWYG vs raw-HTML. Sits on the far right so users
  // can flip views without hunting for the button.
  const tog = el("div", "pix-note-viewtoggle");
  const codeBtn = document.createElement("button");
  codeBtn.type = "button";
  codeBtn.textContent = "Code";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.textContent = "Preview";
  prevBtn.classList.add("active");
  tog.appendChild(codeBtn);
  tog.appendChild(prevBtn);
  tb.appendChild(tog);

  const switchTo = (mode) => {
    if (mode === "code") {
      codeBtn.classList.add("active"); prevBtn.classList.remove("active");
      this._enterCodeView?.();
    } else {
      prevBtn.classList.add("active"); codeBtn.classList.remove("active");
      this._enterPreviewView?.();
    }
  };
  codeBtn.addEventListener("mousedown", (e) => e.preventDefault());
  prevBtn.addEventListener("mousedown", (e) => e.preventDefault());
  codeBtn.onclick = () => switchTo("code");
  prevBtn.onclick = () => switchTo("preview");

  this._afterToolbarBuilt?.();

  // Reflect selection state into button `.active` classes.
  if (!this._selectionChangeHandler) {
    this._selectionChangeHandler = () => {
      // Only update when the selection is inside our edit area, else queries
      // reflect whatever other element has focus.
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!this._editArea?.contains(sel.anchorNode)) return;
      this._refreshActiveStates();
    };
    document.addEventListener("selectionchange", this._selectionChangeHandler);
  }
};

NoteEditor.prototype._refreshActiveStates = function () {
  (this._activeChecks || []).forEach((fn) => fn());
};

// Themed URL prompt that matches the editor's dark modal style (same look as
// the unsaved-changes confirm dialog). Returns Promise<{url, label}|null>.
// If `presetLabel` is non-empty (user had text selected before clicking),
// it pre-fills the label field; otherwise the URL is used as the label.
NoteEditor.prototype._promptLinkUrl = function (presetLabel, presetUrl) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-note-confirm-backdrop";
    const box = document.createElement("div");
    box.className = "pix-note-confirm-box";
    const title = document.createElement("div");
    title.className = "pix-note-confirm-title";
    title.textContent = "Insert link";

    const urlLbl = document.createElement("div");
    urlLbl.className = "pix-note-linklbl";
    urlLbl.textContent = "URL";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "pix-note-linkinput";
    urlInput.value = presetUrl || "https://";

    const labelLbl = document.createElement("div");
    labelLbl.className = "pix-note-linklbl";
    labelLbl.textContent = "Label (what you'll see in the note)";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "pix-note-linkinput";
    labelInput.value = presetLabel || "";
    labelInput.placeholder = "Leave empty to show the URL";

    const err = document.createElement("div");
    err.className = "pix-note-linkerr";

    const actions = document.createElement("div");
    actions.className = "pix-note-confirm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pix-note-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "pix-note-btn primary";
    okBtn.textContent = "Insert";
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);

    box.appendChild(title);
    box.appendChild(urlLbl);
    box.appendChild(urlInput);
    box.appendChild(labelLbl);
    box.appendChild(labelInput);
    box.appendChild(err);
    box.appendChild(actions);
    backdrop.appendChild(box);
    (this._el || document.body).appendChild(backdrop);

    const finish = (v) => { backdrop.remove(); resolve(v); };
    cancelBtn.addEventListener("click", () => finish(null));
    okBtn.addEventListener("click", () => {
      const url = urlInput.value.trim();
      if (!url) { finish(null); return; }
      if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
        err.textContent = "URL must start with http://, https://, or mailto:";
        urlInput.focus();
        return;
      }
      // Fully parse so we reject URLs the sanitizer would later drop —
      // e.g. 'https://' with no host. Without this check users could hit
      // Insert on the default 'https://' placeholder, the anchor would
      // be written into the DOM, and save-time sanitization would later
      // throw on new URL() and strip the whole anchor.
      try {
        const u = new URL(url);
        if ((u.protocol === "http:" || u.protocol === "https:") && !u.hostname) {
          err.textContent = "URL must include a domain (e.g. example.com)";
          urlInput.focus();
          return;
        }
      } catch {
        err.textContent = "That doesn't look like a valid URL";
        urlInput.focus();
        return;
      }
      const label = labelInput.value.trim() || url;
      finish({ url, label });
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(null);
    });
    requestAnimationFrame(() => {
      // If we pre-filled the label (user had selection), focus URL first.
      // Otherwise also focus URL — it's the required field.
      urlInput.focus();
      urlInput.select();
    });
  });
};

// Themed code-block prompt — multi-line textarea. Returns Promise<string|null>.
// Using a dialog instead of inserting a placeholder and letting the user type
// inside the contenteditable <pre><code> avoids a family of edge cases
// (cursor escaping the block, nested inserts, node-wiping on save).
NoteEditor.prototype._promptCodeBlock = function (presetCode) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-note-confirm-backdrop";
    const box = document.createElement("div");
    box.className = "pix-note-confirm-box wide";
    const title = document.createElement("div");
    title.className = "pix-note-confirm-title";
    title.textContent = "Insert code block";
    const lbl = document.createElement("div");
    lbl.className = "pix-note-linklbl";
    lbl.textContent = "Paste or type your code (plain text, no formatting)";
    const ta = document.createElement("textarea");
    ta.className = "pix-note-codeinput";
    ta.rows = 10;
    ta.placeholder = "// your code here";
    ta.value = presetCode || "";
    const actions = document.createElement("div");
    actions.className = "pix-note-confirm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pix-note-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "pix-note-btn primary";
    okBtn.textContent = "Insert";
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(title);
    box.appendChild(lbl);
    box.appendChild(ta);
    box.appendChild(actions);
    backdrop.appendChild(box);
    (this._el || document.body).appendChild(backdrop);
    const finish = (v) => { backdrop.remove(); resolve(v); };
    cancelBtn.addEventListener("click", () => finish(null));
    okBtn.addEventListener("click", () => {
      const v = ta.value;
      if (!v) { finish(null); return; }
      finish(v);
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(null);
    });
    requestAnimationFrame(() => { ta.focus(); });
  });
};
