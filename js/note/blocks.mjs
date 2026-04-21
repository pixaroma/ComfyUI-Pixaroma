import { NoteEditor } from "./core.mjs";

// Icon → pill class (must match css.mjs / sanitize.mjs allowlist).
const ICON_TO_CLASS = {
  dl: "pix-note-dl",
  vp: "pix-note-vp",
  rm: "pix-note-rm",
};

// Icon → default label used when the user leaves the label field blank.
const ICON_TO_FALLBACK_LABEL = {
  dl: "Download",
  vp: "View Page",
  rm: "Read More",
};

// Smart defaults applied whenever the user picks an icon. These are only
// applied to toggles the user hasn't manually flipped yet — so switching
// the icon mid-edit won't clobber an intentional override.
const ICON_DEFAULTS = {
  dl: { folderOn: true,  sizeOn: true,  label: "", labelPh: "e.g. Flux 2 Model",    folder: "models/diffusion_models" },
  vp: { folderOn: false, sizeOn: false, label: "", labelPh: "e.g. Flux 2 on HuggingFace", folder: "models/diffusion_models" },
  rm: { folderOn: false, sizeOn: false, label: "", labelPh: "e.g. Release notes",   folder: "models/diffusion_models" },
};

// Capture / restore helpers. When the block dialog opens, focus moves to
// the dialog's first input — the contenteditable loses its selection, so
// a naive execCommand("insertHTML") on submit has no target range and
// silently no-ops. We snapshot the range before the dialog opens and put
// it back before inserting.
function saveRange(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root || !root.contains(r.commonAncestorContainer)) return null;
  return r.cloneRange();
}

function restoreRange(range) {
  if (!range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Shared URL validation. Returns { ok: true } or { ok: false, message }.
// Matches the policy used by the link dialog and the sanitizer so users
// see the same error up-front as the sanitizer would apply at save time.
// Native alert() was the old fallback but context-switches out of the
// editor and loses the user's typing — inline messages in the dialog are
// much smoother.
function validateUrl(url) {
  if (!url) return { ok: false, message: "URL is required" };
  if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
    return { ok: false, message: "URL must start with http://, https://, or mailto:" };
  }
  try {
    const u = new URL(url);
    if ((u.protocol === "http:" || u.protocol === "https:") && !u.hostname) {
      return { ok: false, message: "URL must include a domain (e.g. example.com)" };
    }
  } catch {
    return { ok: false, message: "That doesn't look like a valid URL" };
  }
  return { ok: true };
}

function makeDialog(anchorBtn, title, fields, onSubmit, initialValues) {
  const dlg = document.createElement("div");
  dlg.className = "pix-note-blockdlg";

  const rect = anchorBtn.getBoundingClientRect();
  dlg.style.left = `${Math.max(8, rect.left)}px`;
  dlg.style.top = `${rect.bottom + 6}px`;

  const h = document.createElement("h4");
  h.textContent = title;
  dlg.appendChild(h);

  const inputs = {};
  for (const [key, labelText, defaultVal, placeholder] of fields) {
    const row = document.createElement("div");
    row.className = "field";
    const lbl = document.createElement("label");
    lbl.className = "lbl";
    lbl.textContent = labelText;
    const inp = document.createElement("input");
    inp.type = "text";
    // initialValues wins over defaultVal — it's only passed when the
    // dialog opens from a pencil-edit, in which case we want the
    // block's actual current value, not the "fresh insert" default.
    const pre = (initialValues && Object.prototype.hasOwnProperty.call(initialValues, key))
      ? initialValues[key]
      : defaultVal;
    inp.value = pre || "";
    if (placeholder) inp.placeholder = placeholder;
    row.appendChild(lbl);
    row.appendChild(inp);
    dlg.appendChild(row);
    inputs[key] = inp;
  }

  // Inline error row — used for themed validation feedback (invalid URL
  // etc.) so the user doesn't get bounced to a native alert() that
  // steals focus and can lose their typing.
  const err = document.createElement("div");
  err.className = "pix-note-linkerr";
  dlg.appendChild(err);

  const footer = document.createElement("div");
  footer.className = "dlgfooter";
  const cancel = document.createElement("button");
  cancel.className = "pix-note-btn";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.className = "pix-note-btn primary";
  // Button label reads "Update" when editing an existing block,
  // "Insert" when inserting a new one. Visual reminder that the
  // action replaces the block vs. appends a new one.
  ok.textContent = initialValues ? "Update" : "Insert";
  footer.appendChild(cancel);
  footer.appendChild(ok);
  dlg.appendChild(footer);

  document.body.appendChild(dlg);
  setTimeout(() => inputs[Object.keys(inputs)[0]]?.focus(), 10);

  function close() { dlg.remove(); document.removeEventListener("mousedown", onOutside, true); }
  const onOutside = (e) => { if (!dlg.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  cancel.onclick = close;
  // onSubmit can:
  //   - call ctx.showError(msg) and return false  → dialog stays open
  //   - return anything else (or undefined)        → dialog closes
  ok.onclick = () => {
    const values = {};
    for (const k of Object.keys(inputs)) values[k] = inputs[k].value.trim();
    err.textContent = "";
    const showError = (msg) => { err.textContent = msg || ""; };
    const result = onSubmit(values, { showError });
    if (result !== false) close();
  };
  [...dlg.querySelectorAll("input")].forEach((i) =>
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") ok.click(); })
  );
}

// Run `buildHtml` inside the editor's saved range so execCommand("insertHTML")
// has a valid target. Falls back to appending at the end of editArea if the
// range was lost (e.g. the user clicked into an empty-padding area that
// never had a selection).
function insertAtSavedRange(editor, savedRange, html) {
  const area = editor._editArea;
  if (!area) return;
  area.focus();
  if (savedRange) {
    restoreRange(savedRange);
  } else {
    const r = document.createRange();
    r.selectNodeContents(area);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  document.execCommand("insertHTML", false, html);
  editor._dirty = true;
}

NoteEditor.prototype._insertButtonBlock = function (anchorBtn) {
  const savedRange = saveRange(this._editArea);
  makeButtonDesignDialog(anchorBtn, (v, ctx) => {
    const check = validateUrl(v.url);
    if (!check.ok) {
      ctx.showError(check.message);
      return false; // keep dialog open, user can fix the URL
    }
    insertAtSavedRange(this, savedRange, renderButtonHTML(v));
    return true; // close dialog
  });
};

// Build the final HTML for a Button Design block. The pill sits on its own
// line; if the size hint is enabled, a subtle middle-dot separator + muted
// size appears inside the pill. If the folder hint is enabled, a second
// line underneath reads "Place in: ComfyUI/<folder>" with a folder icon.
// The whole thing is wrapped in a <span class="pix-note-btnblock"> so the
// pair can be deleted in a single backspace and laid out as one unit.
function renderButtonHTML(v) {
  const cls = ICON_TO_CLASS[v.icon] || "pix-note-dl";
  const labelFallback = ICON_TO_FALLBACK_LABEL[v.icon] || "Download";
  const labelText = escapeHtml(v.label || labelFallback);
  const sizeInner = (v.sizeOn && v.size)
    ? `<span class="pix-note-btnsize">${escapeHtml(v.size)}</span>`
    : "";
  const pill = `<a class="${cls}" href="${escapeHtml(v.url)}"` +
    ` target="_blank" rel="noopener noreferrer">${labelText}${sizeInner}</a>`;
  const hint = (v.folderOn && v.folder)
    ? `<span class="pix-note-folderhint">Place in: ComfyUI/${escapeHtml(v.folder)}</span>`
    : "";
  return `<span class="pix-note-btnblock">${pill}${hint}</span>&nbsp;`;
}

// Kept as backwards-compatible alias so nothing that still calls the
// old method name crashes — redirects to the new unified button dialog.
NoteEditor.prototype._insertDownloadBlock = NoteEditor.prototype._insertButtonBlock;

NoteEditor.prototype._insertYouTubeBlock = function (anchorBtn) {
  const savedRange = saveRange(this._editArea);
  makeDialog(
    anchorBtn,
    "Insert YouTube link",
    [
      ["label", "Label", "Pixaroma YouTube Channel", ""],
      ["url", "URL", "https://www.youtube.com/@pixaroma", ""],
    ],
    (v, ctx) => {
      const check = validateUrl(v.url);
      if (!check.ok) { ctx.showError(check.message); return false; }
      const html = `<a class="pix-note-yt" href="${escapeHtml(v.url)}"` +
        ` target="_blank" rel="noopener noreferrer">${escapeHtml(v.label || "YouTube")}</a>&nbsp;`;
      insertAtSavedRange(this, savedRange, html);
    }
  );
};

NoteEditor.prototype._insertDiscordBlock = function (anchorBtn) {
  const savedRange = saveRange(this._editArea);
  makeDialog(
    anchorBtn,
    "Insert Discord link",
    [
      ["label", "Label", "Join Discord", ""],
      ["url", "URL", "https://discord.com/invite/gggpkVgBf3", ""],
    ],
    (v, ctx) => {
      const check = validateUrl(v.url);
      if (!check.ok) { ctx.showError(check.message); return false; }
      const html = `<a class="pix-note-discord" href="${escapeHtml(v.url)}"` +
        ` target="_blank" rel="noopener noreferrer">${escapeHtml(v.label || "Join Discord")}</a>&nbsp;`;
      insertAtSavedRange(this, savedRange, html);
    }
  );
};

// Rich "Button Design" dialog with a live preview pill, icon segmented
// control, and on/off toggles for the folder suggestion + size hint. The
// pill class (download / view page / read more) is chosen by the icon
// picker, and the submit callback receives all fields as one object.
//
// onSubmit: ({icon, url, label, folderOn, folder, sizeOn, size}) → boolean
//   Return true to close the dialog, false to keep it open (e.g. to show
//   a validation error without losing the user's typing).
function makeButtonDesignDialog(anchorBtn, onSubmit, initialValues) {
  const state = {
    icon: "dl",
    url: "",
    label: "",
    folderOn: true,
    folder: "models/diffusion_models",
    sizeOn: true,
    size: "",
  };
  // Tracks toggles the user explicitly flipped. Flipped toggles are never
  // overwritten by ICON_DEFAULTS when the icon changes.
  const touched = { folderOn: false, sizeOn: false };

  // Editing an existing block: overlay initial values onto state and
  // mark both toggles as "touched" so a subsequent icon change doesn't
  // clobber the user's original choices.
  if (initialValues) {
    Object.assign(state, initialValues);
    touched.folderOn = true;
    touched.sizeOn = true;
  }

  const dlg = document.createElement("div");
  dlg.className = "pix-note-blockdlg pix-note-btndesign";
  const rect = anchorBtn.getBoundingClientRect();
  dlg.style.left = `${Math.max(8, rect.left)}px`;
  dlg.style.top = `${rect.bottom + 6}px`;

  // Header
  const h = document.createElement("h4");
  h.textContent = initialValues ? "Edit button" : "Insert button";
  dlg.appendChild(h);

  // --- Live preview pill --------------------------------------------------
  // Mirrors the HTML shape produced by renderButtonHTML() — same
  // .pix-note-btnblock wrapper, .pix-note-{dl,vp,rm} pill, optional
  // .pix-note-btnsize inside the pill, and optional .pix-note-folderhint
  // line below. The preview container (.pix-note-prevwrap) is included as
  // an ancestor in the pill CSS selectors so the styling matches on-canvas.
  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-note-prevwrap";
  const previewBlock = document.createElement("span");
  previewBlock.className = "pix-note-btnblock";
  const preview = document.createElement("a");
  preview.className = "pix-note-dl";
  preview.href = "#";
  const previewLabel = document.createTextNode("Model Name");
  const previewSize = document.createElement("span");
  previewSize.className = "pix-note-btnsize";
  preview.appendChild(previewLabel);
  preview.appendChild(previewSize);
  preview.addEventListener("click", (e) => e.preventDefault());
  const previewHint = document.createElement("span");
  previewHint.className = "pix-note-folderhint";
  previewBlock.appendChild(preview);
  previewBlock.appendChild(previewHint);
  previewWrap.appendChild(previewBlock);
  dlg.appendChild(previewWrap);

  // --- Icon segmented control ---------------------------------------------
  const iconRow = document.createElement("div");
  iconRow.className = "pix-note-iconpick";
  const ICON_OPTS = [
    { id: "dl", label: "Download",  svg: "download-model.svg" },
    { id: "vp", label: "View Page", svg: "view-model-page.svg" },
    { id: "rm", label: "Read More", svg: "read-more.svg" },
  ];
  const iconBtns = {};
  for (const opt of ICON_OPTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.icon = opt.id;
    const ico = document.createElement("span");
    ico.className = "ico";
    const url = `url(/pixaroma/assets/icons/ui/${opt.svg})`;
    ico.style.webkitMaskImage = url;
    ico.style.maskImage = url;
    const txt = document.createElement("span");
    txt.className = "ico-lbl";
    txt.textContent = opt.label;
    b.appendChild(ico);
    b.appendChild(txt);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => { setIcon(opt.id); });
    iconBtns[opt.id] = b;
    iconRow.appendChild(b);
  }
  dlg.appendChild(iconRow);

  // --- Label + URL --------------------------------------------------------
  const labelRow = makeField("Label");
  const labelInput = labelRow.querySelector("input");
  labelInput.placeholder = ICON_DEFAULTS.dl.labelPh;
  labelInput.addEventListener("input", () => { state.label = labelInput.value; refresh(); });
  dlg.appendChild(labelRow);

  const urlRow = makeField("URL");
  const urlInput = urlRow.querySelector("input");
  urlInput.placeholder = "https://...";
  urlInput.addEventListener("input", () => { state.url = urlInput.value; });
  dlg.appendChild(urlRow);

  // --- Folder suggestion: header row (label + toggle) + input row ---------
  const folderHead = makeToggleHead("Suggest folder");
  const folderToggle = folderHead.toggle;
  folderHead.row.addEventListener("click", (e) => {
    if (e.target.closest("input")) return;
    state.folderOn = !state.folderOn; touched.folderOn = true; refresh();
  });
  dlg.appendChild(folderHead.row);

  const folderInputRow = document.createElement("div");
  folderInputRow.className = "pix-note-optinput";
  const folderIco = document.createElement("span");
  folderIco.className = "folderico";
  folderInputRow.appendChild(folderIco);
  const folderInput = document.createElement("input");
  folderInput.type = "text";
  folderInput.placeholder = "e.g. models/loras";
  folderInput.value = state.folder;
  folderInput.addEventListener("input", () => { state.folder = folderInput.value; refresh(); });
  folderInputRow.appendChild(folderInput);
  dlg.appendChild(folderInputRow);

  // --- Size hint: header row + input row ----------------------------------
  const sizeHead = makeToggleHead("Show size hint");
  const sizeToggle = sizeHead.toggle;
  sizeHead.row.addEventListener("click", (e) => {
    if (e.target.closest("input")) return;
    state.sizeOn = !state.sizeOn; touched.sizeOn = true; refresh();
  });
  dlg.appendChild(sizeHead.row);

  const sizeInputRow = document.createElement("div");
  sizeInputRow.className = "pix-note-optinput";
  const sizeInput = document.createElement("input");
  sizeInput.type = "text";
  sizeInput.placeholder = "e.g. 9.4 GB";
  sizeInput.addEventListener("input", () => { state.size = sizeInput.value; refresh(); });
  sizeInputRow.appendChild(sizeInput);
  dlg.appendChild(sizeInputRow);

  // --- Inline error row (themed, lives above the footer) -----------------
  // Populated when the user clicks Insert with an invalid URL. Keeps the
  // dialog open so typing isn't lost — unlike the old alert() which was
  // also blocked by some browsers when fired from inside an overlay.
  const errEl = document.createElement("div");
  errEl.className = "pix-note-linkerr";
  dlg.appendChild(errEl);

  // --- Footer -------------------------------------------------------------
  const footer = document.createElement("div");
  footer.className = "dlgfooter";
  const cancel = document.createElement("button");
  cancel.className = "pix-note-btn";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.className = "pix-note-btn primary";
  ok.textContent = initialValues ? "Update" : "Insert";
  footer.appendChild(cancel);
  footer.appendChild(ok);
  dlg.appendChild(footer);

  document.body.appendChild(dlg);

  // --- Wiring / helpers ---------------------------------------------------
  function setIcon(id) {
    state.icon = id;
    const d = ICON_DEFAULTS[id];
    if (!touched.folderOn) state.folderOn = d.folderOn;
    if (!touched.sizeOn) state.sizeOn = d.sizeOn;
    labelInput.placeholder = d.labelPh;
    refresh();
  }

  function refresh() {
    // Icon picker active state
    for (const [id, btn] of Object.entries(iconBtns)) {
      btn.classList.toggle("active", id === state.icon);
    }
    // Preview pill class + text. Use textContent on the label node (not
    // innerHTML) so any angle brackets the user typed stay as literal
    // characters rather than becoming live HTML in the preview.
    preview.className = ICON_TO_CLASS[state.icon];
    previewLabel.nodeValue = state.label || ICON_TO_FALLBACK_LABEL[state.icon];
    if (state.sizeOn && state.size) {
      previewSize.textContent = state.size;
      previewSize.style.display = "";
    } else {
      previewSize.textContent = "";
      previewSize.style.display = "none";
    }
    if (state.folderOn && folderInput.value.trim()) {
      previewHint.textContent = `Place in: ComfyUI/${folderInput.value.trim()}`;
      previewHint.style.display = "";
    } else {
      previewHint.textContent = "";
      previewHint.style.display = "none";
    }
    // Toggles
    folderToggle.classList.toggle("on", state.folderOn);
    sizeToggle.classList.toggle("on", state.sizeOn);
    // Disable optional inputs visually when off
    folderInputRow.classList.toggle("disabled", !state.folderOn);
    sizeInputRow.classList.toggle("disabled", !state.sizeOn);
  }

  function close() {
    dlg.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  }
  const onOutside = (e) => { if (!dlg.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    urlInput.focus();
  }, 0);

  function submit() {
    const values = {
      icon: state.icon,
      url: urlInput.value.trim(),
      label: labelInput.value.trim(),
      folderOn: state.folderOn,
      folder: folderInput.value.trim(),
      sizeOn: state.sizeOn,
      size: sizeInput.value.trim(),
    };
    // Clear any prior error so the user sees a fresh state each submit.
    // onSubmit can call ctx.showError(msg) + return false to keep the
    // dialog open with the message visible.
    errEl.textContent = "";
    const showError = (msg) => {
      errEl.textContent = msg || "";
      urlInput.focus();
    };
    const r = onSubmit(values, { showError });
    if (r !== false) close();
  }
  cancel.addEventListener("click", close);
  ok.addEventListener("click", submit);

  // Pre-populate the four visible text inputs from state — these are
  // wired only to `state` on input, so the initial state values need
  // an explicit DOM write or the fields render empty even though the
  // preview reads state correctly.
  urlInput.value = state.url || "";
  labelInput.value = state.label || "";
  folderInput.value = state.folder || "";
  sizeInput.value = state.size || "";
  if (state.icon && state.icon !== "dl") setIcon(state.icon);

  // Initial render
  refresh();
}

// Simple labelled text-input row, reused for Label + URL inside the
// Button Design dialog.
function makeField(labelText) {
  const row = document.createElement("div");
  row.className = "field";
  const lbl = document.createElement("label");
  lbl.className = "lbl";
  lbl.textContent = labelText;
  const inp = document.createElement("input");
  inp.type = "text";
  row.appendChild(lbl);
  row.appendChild(inp);
  return row;
}

// Labelled row with a pill-style on/off toggle on the right. Clicking the
// label area flips the toggle (handled by the dialog's own listener); we
// just return the switch element so `.on` can be toggled.
function makeToggleHead(labelText) {
  const row = document.createElement("div");
  row.className = "pix-note-optrow";
  const lbl = document.createElement("div");
  lbl.className = "lbl";
  lbl.textContent = labelText;
  const toggle = document.createElement("div");
  toggle.className = "pix-note-toggle";
  row.appendChild(lbl);
  row.appendChild(toggle);
  return { row, toggle };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Extract value objects from rendered block DOM ─────────────────────
// Each helper returns the exact shape its matching dialog's onSubmit
// produces, so a round-trip (extract → pre-fill → submit → renderXxxHTML)
// is lossless. Returns null if the element doesn't match the expected
// shape — callers treat null as "no pencil for this block".

// Derived inverse of ICON_TO_CLASS (top of file) — read the pill's
// class list to recover the icon id the user originally chose. Built
// at module load so adding a new icon only requires updating
// ICON_TO_CLASS. Callers default to "dl" when no class matches, so
// unknown shapes at least round-trip as a Download pill.
const CLASS_TO_ICON = Object.fromEntries(
  Object.entries(ICON_TO_CLASS).map(([icon, cls]) => [cls, icon])
);

export function extractButtonValues(el) {
  if (!el || el.nodeType !== 1) return null;
  if (!el.classList || !el.classList.contains("pix-note-btnblock")) return null;
  const a = el.querySelector(":scope > a");
  if (!a) return null;
  let icon = "dl";
  for (const c of a.classList) {
    if (CLASS_TO_ICON[c]) { icon = CLASS_TO_ICON[c]; break; }
  }
  // Size lives in a nested <span class="pix-note-btnsize">. Pull it
  // out (text only) before reading the pill label, then remove the
  // span from a temporary clone so label extraction sees only the
  // user's label text.
  const sizeSpan = a.querySelector(":scope > .pix-note-btnsize");
  const size = sizeSpan ? (sizeSpan.textContent || "").trim() : "";
  const sizeOn = !!(sizeSpan && size);
  const clone = a.cloneNode(true);
  const innerSize = clone.querySelector(":scope > .pix-note-btnsize");
  if (innerSize) innerSize.remove();
  let label = (clone.textContent || "").trim();
  // If the label exactly matches the icon's fallback (e.g. "Download"
  // for dl), the user originally left the field blank and
  // renderButtonHTML filled in the default for rendering. Return ""
  // so the dialog's placeholder shows instead of the cosmetic default,
  // preserving the round-trip invariant for the common "no label"
  // case. A user who genuinely typed "Download" accepts this tiny
  // ambiguity — same rendered pill either way.
  if (ICON_TO_FALLBACK_LABEL[icon] && label === ICON_TO_FALLBACK_LABEL[icon]) {
    label = "";
  }
  // Folder hint is a sibling of the <a> inside the block wrapper. The
  // rendered text always has the "Place in: ComfyUI/" prefix; strip it
  // so we return the raw folder the user typed.
  const hint = el.querySelector(":scope > .pix-note-folderhint");
  const hintText = hint ? (hint.textContent || "").trim() : "";
  const prefix = "Place in: ComfyUI/";
  let folder = "";
  let folderOn = false;
  if (hintText.startsWith(prefix)) {
    folder = hintText.slice(prefix.length);
    folderOn = true;
  } else if (hintText) {
    // Legacy or manually-edited blocks — keep whatever's there.
    folder = hintText;
    folderOn = true;
  }
  return {
    icon,
    url: a.getAttribute("href") || "",
    label,
    folderOn,
    folder,
    sizeOn,
    size,
  };
}

// Dialog-shape for the generic makeDialog link fields. Also used for
// plain <a> (no pix-note-* class) and YT / Discord pencils.
export function extractLinkValues(el) {
  if (!el || el.nodeType !== 1 || el.tagName !== "A") return null;
  return {
    label: (el.textContent || "").trim(),
    url: el.getAttribute("href") || "",
  };
}

// Code block: accept <pre> (with or without child <code>). Returns the
// plain text the user originally typed.
export function extractCodeValues(el) {
  if (!el || el.nodeType !== 1 || el.tagName !== "PRE") return null;
  const code = el.querySelector(":scope > code");
  const text = (code ? code.textContent : el.textContent) || "";
  // Defensive trailing-newline strip: the canonical insert path in
  // toolbar.mjs doesn't add one, but browsers sometimes normalize
  // pasted / contenteditable-produced <pre> content with a trailing
  // newline. Strip at most one so round-trips don't accumulate blank
  // lines on repeated edits.
  return { code: text.replace(/\n$/, "") };
}

// ── Pencil dispatcher: open the right dialog pre-filled, replace the
// target block on submit, bracket with undo snapshots. ───────────────
//
// `editor` is the NoteEditor instance (gives us _editArea, _snapBefore,
// _snapAfter, _promptLinkUrl, _promptCodeBlock, _dirty). `target` is
// the DOM element under the pencil.
NoteEditor.prototype._dispatchBlockEdit = function (target, anchorBtn) {
  if (!target || !this._editArea || !this._editArea.contains(target)) return;

  // Button Design block: span.pix-note-btnblock
  if (target.tagName === "SPAN" && target.classList.contains("pix-note-btnblock")) {
    const values = extractButtonValues(target);
    if (!values) return;
    makeButtonDesignDialog(anchorBtn, (v, ctx) => {
      const check = validateUrl(v.url);
      if (!check.ok) { ctx.showError(check.message); return false; }
      this._snapBefore?.();
      // renderButtonHTML returns "<span …>…</span>&nbsp;". When editing
      // we replace only the span, not the trailing &nbsp;; otherwise
      // consecutive pencil-edits would keep appending nbsp chars.
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderButtonHTML(v);
      const newBlock = wrapper.querySelector(".pix-note-btnblock");
      if (newBlock) target.replaceWith(newBlock);
      this._snapAfter?.();
      this._dirty = true;
      return true;
    }, values);
    return;
  }

  // YouTube / Discord: a.pix-note-yt / a.pix-note-discord
  if (target.tagName === "A" && target.classList.contains("pix-note-yt")) {
    return openLinkEditor(this, target, "Edit YouTube link", "pix-note-yt", anchorBtn);
  }
  if (target.tagName === "A" && target.classList.contains("pix-note-discord")) {
    return openLinkEditor(this, target, "Edit Discord link", "pix-note-discord", anchorBtn);
  }

  // Plain link: <a> without any pix-note-* class. Reuse _promptLinkUrl
  // which already has the themed URL-validation UX.
  if (target.tagName === "A") {
    const current = extractLinkValues(target);
    this._editArea.focus();
    // Pass both label AND url as presets so the dialog round-trips the
    // existing link cleanly (step 0 extended _promptLinkUrl for this).
    this._promptLinkUrl(current.label, current.url).then((result) => {
      if (!result) return;
      this._snapBefore?.();
      target.setAttribute("href", result.url);
      target.textContent = result.label;
      this._snapAfter?.();
      this._dirty = true;
    });
    return;
  }

  // Code block: <pre>
  if (target.tagName === "PRE") {
    const current = extractCodeValues(target);
    this._promptCodeBlock(current?.code || "").then((code) => {
      if (code === null || code === undefined) return;
      this._snapBefore?.();
      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = code + (code.endsWith("\n") ? "" : "\n");
      pre.appendChild(codeEl);
      target.replaceWith(pre);
      this._snapAfter?.();
      this._dirty = true;
    });
    return;
  }
};

// YouTube + Discord pencils share one path: same dialog shape, same
// HTML output differing only in the pill class.
function openLinkEditor(editor, target, title, className, anchorBtn) {
  const values = extractLinkValues(target);
  makeDialog(
    anchorBtn,
    title,
    [
      ["label", "Label", "", ""],
      ["url", "URL", "", ""],
    ],
    (v, ctx) => {
      const check = validateUrl(v.url);
      if (!check.ok) { ctx.showError(check.message); return false; }
      editor._snapBefore?.();
      target.setAttribute("href", v.url);
      target.textContent = v.label || v.url;
      target.setAttribute("target", "_blank");
      target.setAttribute("rel", "noopener noreferrer");
      target.className = className;
      editor._snapAfter?.();
      editor._dirty = true;
    },
    values,
  );
}
