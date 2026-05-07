import { NoteEditor } from "./core.mjs";
import {
  createPixaromaColorPicker,
  openPixaromaCompactColorPickerPopup,
} from "../shared/color_picker.mjs";

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
//
// After the insert, re-stage the currently-picked text/highlight colors.
// Block-level insertHTML (a <table>, a <pre>, an <hr>) splits the caret
// out of the surrounding inline formatting context, silently dropping
// any staged foreColor/hiliteColor — without the restage, typing into
// a fresh grid cell or below the block comes out in the default color
// until the user re-picks. See _restageColors() in toolbar.mjs for the
// full rationale. Safe no-op for inline inserts.
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
  editor._restageColors?.();
  editor._dirty = true;
}

NoteEditor.prototype._insertButtonBlock = function (anchorBtn) {
  const savedRange = saveRange(this._editArea);
  makeButtonModal(this, (v, ctx) => {
    const check = validateUrl(v.url);
    if (!check.ok) {
      ctx.showError(check.message);
      return false; // keep modal open, user can fix the URL
    }
    insertAtSavedRange(this, savedRange, renderButtonHTML(v));
    return true; // close modal
  });
};

NoteEditor.prototype._insertFolderHintBlock = function (anchorBtn) {
  const savedRange = saveRange(this._editArea);
  makeFolderHintModal(this, (v) => {
    insertAtSavedRange(this, savedRange, renderFolderHintHTML(v));
  });
};

// Build the final HTML for a Button Design block. The pill sits on its own
// line; if the size hint is enabled, a subtle middle-dot separator + muted
// size appears inside the pill. If the folder hint is enabled, a second
// line underneath reads "Place in: ComfyUI/<folder>" with a folder icon.
// The whole thing is wrapped in a <span class="pix-note-btnblock"> so the
// pair can be deleted in a single backspace and laid out as one unit.
// `v.icon` accepts "dl" / "vp" / "rm" / "none". `none` renders a plain
// pill without the leading icon. `v.color` is a hex string stamped as
// inline `style="background-color:..."` so the pill is independent of
// the toolbar Btn picker. Folder bundling has been retired — use the
// dedicated folder-hint toolbar button to add a "Place in: ..." line.
function renderButtonHTML(v) {
  const cls = v.icon === "none"
    ? "pix-note-btn-plain"
    : (ICON_TO_CLASS[v.icon] || "pix-note-dl");
  // Fallback label only applies to icon variants — "none" with no
  // label gets a generic "Click here" so the pill is at least
  // pressable.
  const labelFallback = v.icon === "none"
    ? "Click here"
    : (ICON_TO_FALLBACK_LABEL[v.icon] || "Download");
  const labelText = escapeHtml(v.label || labelFallback);
  const sizeInner = (v.sizeOn && v.size)
    ? `<span class="pix-note-btnsize">${escapeHtml(v.size)}</span>`
    : "";
  const colorAttr = /^#[0-9a-f]{3,8}$/i.test(v.color || "")
    ? ` style="background-color: ${v.color}"`
    : "";
  const pill = `<a class="${cls}"${colorAttr} href="${escapeHtml(v.url)}"` +
    ` target="_blank" rel="noopener noreferrer">${labelText}${sizeInner}</a>`;
  // Wrapper kept for backwards compat (existing notes still have it
  // around bundled pill+folder pairs); for new buttons it's just the
  // pill, but the wrapper keeps the inserted unit selectable as one
  // chunk for backspace + makes the pencil dispatcher consistent.
  return `<span class="pix-note-btnblock">${pill}</span>&nbsp;`;
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

// Centred modal for the Button Design block. Picks per-instance colour,
// icon variant (Download / View Page / Read More / no icon), label,
// URL, and an optional size hint. Folder bundling moved out into its
// own dedicated toolbar entry / picker. Session-sticky on the editor
// (_btnPickerColor / _btnPickerIcon / _btnPickerSizeOn).
const _BTN_ICON_OPTS = [
  { id: "dl",   label: "Download",  svg: "download-model.svg"  },
  { id: "vp",   label: "View Page", svg: "view-model-page.svg" },
  { id: "rm",   label: "Read More", svg: "read-more.svg"       },
  { id: "none", label: "No icon",   svg: null                  },
];

function makeButtonModal(editor, onSubmit, initialValues) {
  const state = {
    icon:   editor._btnPickerIcon   || "dl",
    color:  editor._btnPickerColor  || "#f66744",
    label:  "",
    url:    "",
    sizeOn: editor._btnPickerSizeOn || false,
    size:   "",
  };
  if (initialValues) Object.assign(state, initialValues);

  const backdrop = document.createElement("div");
  backdrop.className = "pix-note-modal-backdrop";
  const pop = document.createElement("div");
  pop.className = "pix-note-modal";
  backdrop.appendChild(pop);

  const hint = document.createElement("div");
  hint.className = "pix-note-modal-hint";
  hint.textContent =
    "Pick a colour and a button style, fill in the label and URL, then click Insert.";
  pop.appendChild(hint);

  // Colour swatch row
  const colorRow = document.createElement("div");
  colorRow.className = "pix-note-modal-row";
  const colorLbl = document.createElement("span");
  colorLbl.className = "lbl";
  colorLbl.textContent = "Button colour";
  colorRow.appendChild(colorLbl);
  const colorSwatch = document.createElement("button");
  colorSwatch.type = "button";
  colorSwatch.className = "pix-note-modal-swatch";
  colorSwatch.title = "Click to pick the button colour";
  colorSwatch.style.background = state.color;
  colorSwatch.addEventListener("mousedown", (e) => e.preventDefault());
  colorSwatch.addEventListener("click", (e) => {
    e.stopPropagation();
    openPixaromaCompactColorPickerPopup(colorSwatch, {
      initialColor: state.color,
      showClear: false,
      resetColor: "#f66744",
      onPick: (c) => {
        const next = c || "#f66744";
        state.color = next;
        editor._btnPickerColor = next;
        colorSwatch.style.background = next;
        refresh();
      },
    });
  });
  colorRow.appendChild(colorSwatch);
  pop.appendChild(colorRow);

  // Button-type segmented control (Download / View Page / Read More / No icon)
  const typeLbl = document.createElement("div");
  typeLbl.className = "lbl";
  typeLbl.style.marginTop = "10px";
  typeLbl.style.fontSize = "11px";
  typeLbl.style.color = "#bbb";
  typeLbl.style.textTransform = "uppercase";
  typeLbl.style.letterSpacing = "0.5px";
  typeLbl.style.fontWeight = "600";
  typeLbl.textContent = "Button type";
  pop.appendChild(typeLbl);
  const iconRow = document.createElement("div");
  iconRow.className = "pix-note-modal-btnpick";
  const iconBtns = {};
  for (const opt of _BTN_ICON_OPTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.icon = opt.id;
    if (opt.svg) {
      const ico = document.createElement("span");
      ico.className = "ico";
      const url = `url(/pixaroma/assets/icons/ui/${opt.svg})`;
      ico.style.webkitMaskImage = url;
      ico.style.maskImage = url;
      b.appendChild(ico);
    } else {
      const ico = document.createElement("span");
      ico.className = "ico-none";
      b.appendChild(ico);
    }
    const txt = document.createElement("span");
    txt.textContent = opt.label;
    b.appendChild(txt);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      state.icon = opt.id;
      editor._btnPickerIcon = opt.id;
      refresh();
    });
    iconBtns[opt.id] = b;
    iconRow.appendChild(b);
  }
  pop.appendChild(iconRow);

  // Label input
  const labelField = makeModalField("Label");
  const labelInput = labelField.querySelector("input");
  labelInput.placeholder = "e.g. Flux 2 Model";
  labelInput.addEventListener("input", () => {
    state.label = labelInput.value;
    refresh();
  });
  pop.appendChild(labelField);

  // URL input
  const urlField = makeModalField("URL");
  const urlInput = urlField.querySelector("input");
  urlInput.placeholder = "https://...";
  urlInput.addEventListener("input", () => { state.url = urlInput.value; });
  pop.appendChild(urlField);

  // Size hint toggle + input
  const sizeHead = document.createElement("div");
  sizeHead.className = "pix-note-optrow";
  const sizeHeadLbl = document.createElement("div");
  sizeHeadLbl.className = "lbl";
  sizeHeadLbl.textContent = "Show size hint";
  const sizeToggle = document.createElement("div");
  sizeToggle.className = "pix-note-toggle";
  sizeHead.appendChild(sizeHeadLbl);
  sizeHead.appendChild(sizeToggle);
  sizeHead.addEventListener("click", (e) => {
    if (e.target.closest("input")) return;
    state.sizeOn = !state.sizeOn;
    editor._btnPickerSizeOn = state.sizeOn;
    refresh();
  });
  pop.appendChild(sizeHead);

  const sizeField = makeModalField("");
  sizeField.classList.remove("pix-note-modal-field");
  sizeField.className = "pix-note-modal-field";
  const sizeInput = sizeField.querySelector("input");
  sizeInput.placeholder = "e.g. 9.4 GB";
  sizeInput.addEventListener("input", () => {
    state.size = sizeInput.value;
    refresh();
  });
  // Drop the empty label so the size input doesn't have a hanging
  // header — the toggle row above already names it.
  const sizeFieldLbl = sizeField.querySelector(".lbl");
  if (sizeFieldLbl) sizeFieldLbl.remove();
  pop.appendChild(sizeField);

  // Live preview pill
  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-note-prevwrap";
  previewWrap.style.marginTop = "10px";
  const previewBlock = document.createElement("span");
  previewBlock.className = "pix-note-btnblock";
  const preview = document.createElement("a");
  preview.href = "#";
  preview.addEventListener("click", (e) => e.preventDefault());
  const previewLabel = document.createTextNode("");
  const previewSize = document.createElement("span");
  previewSize.className = "pix-note-btnsize";
  preview.appendChild(previewLabel);
  preview.appendChild(previewSize);
  previewBlock.appendChild(preview);
  previewWrap.appendChild(previewBlock);
  pop.appendChild(previewWrap);

  // Inline error row
  const errEl = document.createElement("div");
  errEl.className = "pix-note-linkerr";
  pop.appendChild(errEl);

  // Footer: Reset | Cancel | Insert
  const footer = document.createElement("div");
  footer.className = "pix-note-modal-footer";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "pix-note-modal-btn pix-note-modal-btn-reset";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Reset all options to defaults";
  resetBtn.addEventListener("mousedown", (e) => e.preventDefault());
  resetBtn.addEventListener("click", () => {
    state.icon = "dl";
    state.color = "#f66744";
    state.sizeOn = false;
    state.size = "";
    sizeInput.value = "";
    editor._btnPickerIcon = state.icon;
    editor._btnPickerColor = state.color;
    editor._btnPickerSizeOn = state.sizeOn;
    colorSwatch.style.background = state.color;
    refresh();
  });
  footer.appendChild(resetBtn);
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pix-note-modal-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("mousedown", (e) => e.preventDefault());
  cancelBtn.addEventListener("click", () => close());
  footer.appendChild(cancelBtn);
  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.className = "pix-note-modal-btn primary";
  insertBtn.textContent = initialValues ? "Update" : "Insert";
  insertBtn.addEventListener("mousedown", (e) => e.preventDefault());
  insertBtn.addEventListener("click", () => submit());
  footer.appendChild(insertBtn);
  pop.appendChild(footer);

  document.body.appendChild(backdrop);

  // Pre-populate inputs from state — they only sync to state via
  // `input` events, so the initial values need an explicit DOM write.
  urlInput.value   = state.url   || "";
  labelInput.value = state.label || "";
  sizeInput.value  = state.size  || "";

  function refresh() {
    // Icon segmented-control active state
    for (const [id, btn] of Object.entries(iconBtns)) {
      btn.classList.toggle("active", id === state.icon);
    }
    // Preview pill class + colour + label + size
    const cls = state.icon === "none"
      ? "pix-note-btn-plain"
      : (ICON_TO_CLASS[state.icon] || "pix-note-dl");
    preview.className = cls;
    preview.style.backgroundColor = state.color;
    const fb = state.icon === "none" ? "Click here" : (ICON_TO_FALLBACK_LABEL[state.icon] || "Download");
    previewLabel.nodeValue = state.label || fb;
    if (state.sizeOn && state.size) {
      previewSize.textContent = state.size;
      previewSize.style.display = "";
    } else {
      previewSize.textContent = "";
      previewSize.style.display = "none";
    }
    sizeToggle.classList.toggle("on", state.sizeOn);
    sizeField.classList.toggle("disabled", !state.sizeOn);
  }
  refresh();

  function submit() {
    const values = {
      icon:   state.icon,
      url:    urlInput.value.trim(),
      label:  labelInput.value.trim(),
      color:  state.color,
      sizeOn: state.sizeOn,
      size:   sizeInput.value.trim(),
    };
    errEl.textContent = "";
    const showError = (msg) => {
      errEl.textContent = msg || "";
      urlInput.focus();
    };
    const r = onSubmit(values, { showError });
    if (r !== false) close();
  }

  const onBackdropDown = (e) => { if (e.target === backdrop) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    else if (e.key === "Enter" && !e.shiftKey) {
      e.stopPropagation(); e.preventDefault(); submit();
    }
  };
  backdrop.addEventListener("mousedown", onBackdropDown);
  window.addEventListener("keydown", onKey, true);

  function close() {
    backdrop.removeEventListener("mousedown", onBackdropDown);
    window.removeEventListener("keydown", onKey, true);
    backdrop.remove();
  }

  // Focus URL on open — the most-likely-empty field for fresh inserts.
  setTimeout(() => urlInput.focus(), 0);
}

// Modal-style labelled text input — used by makeButtonModal for the
// Label / URL / Size fields and by makeFolderHintModal for Folder.
function makeModalField(labelText) {
  const row = document.createElement("div");
  row.className = "pix-note-modal-field";
  const lbl = document.createElement("label");
  lbl.className = "lbl";
  lbl.textContent = labelText;
  const inp = document.createElement("input");
  inp.type = "text";
  row.appendChild(lbl);
  row.appendChild(inp);
  return row;
}

// Centred modal for the standalone folder hint block. Picks the line
// colour and the folder path. Output:
//   <span class="pix-note-folderhint" style="color: COLOR">
//     Place in: ComfyUI/{folder}
//   </span>&nbsp;
function makeFolderHintModal(editor, onSubmit, initialValues) {
  const state = {
    color:  editor._folderHintPickerColor  || "#f66744",
    folder: editor._folderHintPickerFolder || "models/diffusion_models",
  };
  if (initialValues) Object.assign(state, initialValues);

  const backdrop = document.createElement("div");
  backdrop.className = "pix-note-modal-backdrop";
  const pop = document.createElement("div");
  pop.className = "pix-note-modal";
  backdrop.appendChild(pop);

  const hint = document.createElement("div");
  hint.className = "pix-note-modal-hint";
  hint.textContent = "Pick a colour and a folder path, then click Insert.";
  pop.appendChild(hint);

  // Colour swatch row
  const colorRow = document.createElement("div");
  colorRow.className = "pix-note-modal-row";
  const colorLbl = document.createElement("span");
  colorLbl.className = "lbl";
  colorLbl.textContent = "Hint colour";
  colorRow.appendChild(colorLbl);
  const colorSwatch = document.createElement("button");
  colorSwatch.type = "button";
  colorSwatch.className = "pix-note-modal-swatch";
  colorSwatch.title = "Click to pick the hint colour";
  colorSwatch.style.background = state.color;
  colorSwatch.addEventListener("mousedown", (e) => e.preventDefault());
  colorSwatch.addEventListener("click", (e) => {
    e.stopPropagation();
    openPixaromaCompactColorPickerPopup(colorSwatch, {
      initialColor: state.color,
      showClear: false,
      resetColor: "#f66744",
      onPick: (c) => {
        const next = c || "#f66744";
        state.color = next;
        editor._folderHintPickerColor = next;
        colorSwatch.style.background = next;
        refresh();
      },
    });
  });
  colorRow.appendChild(colorSwatch);
  pop.appendChild(colorRow);

  // Folder path input
  const folderField = makeModalField("Folder path");
  const folderInput = folderField.querySelector("input");
  folderInput.placeholder = "e.g. models/loras";
  folderInput.value = state.folder;
  folderInput.addEventListener("input", () => {
    state.folder = folderInput.value;
    editor._folderHintPickerFolder = folderInput.value;
    refresh();
  });
  pop.appendChild(folderField);

  // Live preview line
  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-note-prevwrap";
  previewWrap.style.marginTop = "10px";
  const preview = document.createElement("span");
  preview.className = "pix-note-folderhint";
  previewWrap.appendChild(preview);
  pop.appendChild(previewWrap);

  // Footer: Reset | Cancel | Insert
  const footer = document.createElement("div");
  footer.className = "pix-note-modal-footer";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "pix-note-modal-btn pix-note-modal-btn-reset";
  resetBtn.textContent = "Reset";
  resetBtn.addEventListener("mousedown", (e) => e.preventDefault());
  resetBtn.addEventListener("click", () => {
    state.color  = "#f66744";
    state.folder = "models/diffusion_models";
    editor._folderHintPickerColor  = state.color;
    editor._folderHintPickerFolder = state.folder;
    colorSwatch.style.background = state.color;
    folderInput.value = state.folder;
    refresh();
  });
  footer.appendChild(resetBtn);
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pix-note-modal-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("mousedown", (e) => e.preventDefault());
  cancelBtn.addEventListener("click", () => close());
  footer.appendChild(cancelBtn);
  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.className = "pix-note-modal-btn primary";
  insertBtn.textContent = initialValues ? "Update" : "Insert";
  insertBtn.addEventListener("mousedown", (e) => e.preventDefault());
  insertBtn.addEventListener("click", () => commit());
  footer.appendChild(insertBtn);
  pop.appendChild(footer);

  document.body.appendChild(backdrop);

  function refresh() {
    preview.style.color = state.color;
    preview.textContent = state.folder
      ? `Place in: ComfyUI/${state.folder}`
      : "Place in: ComfyUI/...";
  }
  refresh();

  function commit() {
    if (!state.folder.trim()) return;
    onSubmit({ color: state.color, folder: state.folder.trim() });
    close();
  }

  const onBackdropDown = (e) => { if (e.target === backdrop) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    else if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); commit(); }
  };
  backdrop.addEventListener("mousedown", onBackdropDown);
  window.addEventListener("keydown", onKey, true);

  function close() {
    backdrop.removeEventListener("mousedown", onBackdropDown);
    window.removeEventListener("keydown", onKey, true);
    backdrop.remove();
  }

  setTimeout(() => folderInput.focus(), 0);
}

function renderFolderHintHTML(v) {
  const colorAttr = /^#[0-9a-f]{3,8}$/i.test(v.color || "")
    ? ` style="color: ${v.color}"`
    : "";
  return `<span class="pix-note-folderhint"${colorAttr}>` +
    `Place in: ComfyUI/${escapeHtml(v.folder)}</span>&nbsp;`;
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

// Convert "rgb(r, g, b)" / "rgba(...)" / "#hex" to "#rrggbb". Returns
// null when the input doesn't parse as either form. Used by the
// extract-* helpers below to read inline `style="background-color:..."`
// /  "color:..." back into the hex format the modals expect.
function styleColorToHex(rgbStr) {
  if (!rgbStr) return null;
  const trimmed = rgbStr.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      // #rgb → #rrggbb
      return "#" + trimmed.slice(1).split("").map((c) => c + c).join("");
    }
    return trimmed.toLowerCase();
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (!m) return null;
  return "#" + [m[1], m[2], m[3]]
    .map((n) => parseInt(n, 10).toString(16).padStart(2, "0"))
    .join("");
}

export function extractButtonValues(el) {
  if (!el || el.nodeType !== 1) return null;
  if (!el.classList || !el.classList.contains("pix-note-btnblock")) return null;
  const a = el.querySelector(":scope > a");
  if (!a) return null;
  let icon = "dl";
  if (a.classList.contains("pix-note-btn-plain")) {
    icon = "none";
  } else {
    for (const c of a.classList) {
      if (CLASS_TO_ICON[c]) { icon = CLASS_TO_ICON[c]; break; }
    }
  }
  // Per-instance colour (added in the per-instance overhaul). May be
  // missing on legacy buttons authored before the change — those
  // round-trip with the editor's session-default colour applied on
  // save (the modal preselects editor._btnPickerColor when color is
  // null, which is fine: the rendered pill stays unchanged on cancel).
  const styleAttr = a.getAttribute("style") || "";
  const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(styleAttr);
  const color = bgMatch ? (styleColorToHex(bgMatch[1]) || null) : null;
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
  // Same fallback collapse for "Click here" on the no-icon variant.
  if (icon === "none" && label === "Click here") label = "";
  return {
    icon,
    color: color || undefined,
    url: a.getAttribute("href") || "",
    label,
    sizeOn,
    size,
  };
}

// Standalone folder hint: <span class="pix-note-folderhint">Place in: …</span>.
// Returns null when the element is inside a Button Design block (which
// owns the folder line). Pencil dispatch (in core.mjs) escalates such
// targets to the parent btnblock, so this null is a safety net.
export function extractFolderHintValues(el) {
  if (!el || el.nodeType !== 1) return null;
  if (!el.classList || !el.classList.contains("pix-note-folderhint")) return null;
  if (el.parentElement?.classList?.contains("pix-note-btnblock")) return null;
  const text = (el.textContent || "").trim();
  const prefix = "Place in: ComfyUI/";
  const folder = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  const styleAttr = el.getAttribute("style") || "";
  const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(styleAttr);
  const color = colorMatch ? (styleColorToHex(colorMatch[1]) || null) : null;
  return { folder, color: color || undefined };
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
    makeButtonModal(this, (v, ctx) => {
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

  // Standalone folder hint: span.pix-note-folderhint NOT inside a
  // btnblock (the in-btnblock case is escalated to the btnblock by
  // the pencil mouseover handler in core.mjs).
  if (target.tagName === "SPAN" && target.classList.contains("pix-note-folderhint")) {
    const values = extractFolderHintValues(target);
    if (!values) return;
    makeFolderHintModal(this, (v) => {
      this._snapBefore?.();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderFolderHintHTML(v);
      const newBlock = wrapper.querySelector(".pix-note-folderhint");
      if (newBlock) target.replaceWith(newBlock);
      this._snapAfter?.();
      this._dirty = true;
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

// ── Grid (table) block ───────────────────────────────────────────────
// Dialog + insert path. Cells are empty <br> placeholders so
// contenteditable has a landing point; users click into any cell and
// type. No per-cell dialog — per spec 2026-04-21-note-grid-design.md.

const GRID_COL_MIN = 2;
const GRID_COL_MAX = 4;
const GRID_ROW_MIN = 1;
const GRID_ROW_MAX = 10;

function renderGridHTML(cols, rows, header, borderColor, headerBg) {
  const cell = "<td><br></td>";
  const headCell = "<th><br></th>";
  const bodyRow = `<tr>${cell.repeat(cols)}</tr>`;
  const headRow = `<tr>${headCell.repeat(cols)}</tr>`;
  const thead = header ? `<thead>${headRow}</thead>` : "";
  const tbody = `<tbody>${bodyRow.repeat(rows)}</tbody>`;
  // Per-instance colours stamped as CSS custom properties on the
  // <table>. CSS rules read them with fallback to --pix-note-line so
  // grids authored before per-instance colour still render correctly.
  const styleParts = [];
  if (/^#[0-9a-f]{3,8}$/i.test(borderColor || "")) {
    styleParts.push(`--pix-note-grid-border: ${borderColor}`);
  }
  if (header && /^#[0-9a-f]{3,8}$/i.test(headerBg || "")) {
    styleParts.push(`--pix-note-grid-header-bg: ${headerBg}`);
  }
  const style = styleParts.length ? ` style="${styleParts.join("; ")}"` : "";
  // Trailing <p><br></p> so the caret has a paragraph to land in after
  // the table — otherwise the user has to click BELOW the table in the
  // padding area to keep typing, which Chrome sometimes routes into the
  // last table cell instead.
  return `<table class="pix-note-grid"${style}>${thead}${tbody}</table><p><br></p>`;
}

function makeGridModal(editor, onSubmit) {
  const state = {
    cols:   editor._gridPickerCols   || 3,
    rows:   editor._gridPickerRows   || 3,
    header: editor._gridPickerHeader || false,
    borderColor: editor._gridPickerBorderColor || "#f66744",
    headerBg:    editor._gridPickerHeaderBg    || "#1a1a1a",
  };

  const backdrop = document.createElement("div");
  backdrop.className = "pix-note-modal-backdrop";
  const pop = document.createElement("div");
  pop.className = "pix-note-modal pix-note-gridmodal";
  backdrop.appendChild(pop);

  const hint = document.createElement("div");
  hint.className = "pix-note-modal-hint";
  hint.textContent = "Pick colours, set columns and rows, then click Insert.";
  pop.appendChild(hint);

  // ── Border colour row ──────────────────────────────────────────
  const borderRow = document.createElement("div");
  borderRow.className = "pix-note-modal-row";
  const borderLbl = document.createElement("span");
  borderLbl.className = "lbl";
  borderLbl.textContent = "Border colour";
  borderRow.appendChild(borderLbl);
  const borderSwatch = document.createElement("button");
  borderSwatch.type = "button";
  borderSwatch.className = "pix-note-modal-swatch";
  borderSwatch.title = "Click to pick the border colour";
  borderSwatch.style.background = state.borderColor;
  borderSwatch.addEventListener("mousedown", (e) => e.preventDefault());
  borderSwatch.addEventListener("click", (e) => {
    e.stopPropagation();
    openPixaromaCompactColorPickerPopup(borderSwatch, {
      initialColor: state.borderColor,
      showClear: false,
      resetColor: "#f66744",
      onPick: (c) => {
        const next = c || "#f66744";
        state.borderColor = next;
        editor._gridPickerBorderColor = next;
        borderSwatch.style.background = next;
        refresh();
      },
    });
  });
  borderRow.appendChild(borderSwatch);
  pop.appendChild(borderRow);

  // ── Header colour row (greyed when toggle is off) ──────────────
  const headerColorRow = document.createElement("div");
  headerColorRow.className = "pix-note-modal-row";
  const headerColorLbl = document.createElement("span");
  headerColorLbl.className = "lbl";
  headerColorLbl.textContent = "Header colour";
  headerColorRow.appendChild(headerColorLbl);
  const headerColorSwatch = document.createElement("button");
  headerColorSwatch.type = "button";
  headerColorSwatch.className = "pix-note-modal-swatch";
  headerColorSwatch.title = "Click to pick the header background colour";
  headerColorSwatch.style.background = state.headerBg;
  headerColorSwatch.addEventListener("mousedown", (e) => e.preventDefault());
  headerColorSwatch.addEventListener("click", (e) => {
    e.stopPropagation();
    if (headerColorSwatch.disabled) return;
    openPixaromaCompactColorPickerPopup(headerColorSwatch, {
      initialColor: state.headerBg,
      showClear: false,
      resetColor: "#1a1a1a",
      onPick: (c) => {
        const next = c || "#1a1a1a";
        state.headerBg = next;
        editor._gridPickerHeaderBg = next;
        headerColorSwatch.style.background = next;
        refresh();
      },
    });
  });
  headerColorRow.appendChild(headerColorSwatch);
  pop.appendChild(headerColorRow);

  // The header-toggle elements and the preview grid are created up
  // front (but appended later, in visual order) so the stepper's
  // initial set() → refresh() call below has live references to them.
  // Same TDZ pattern the legacy makeGridDialog used.
  const headRow = document.createElement("div");
  headRow.className = "pix-note-optrow";
  const headLbl = document.createElement("div");
  headLbl.className = "lbl";
  headLbl.textContent = "First row as header";
  const headToggle = document.createElement("div");
  headToggle.className = "pix-note-toggle";
  headRow.appendChild(headLbl);
  headRow.appendChild(headToggle);
  headRow.addEventListener("click", (e) => {
    if (e.target.closest("input")) return;
    state.header = !state.header;
    editor._gridPickerHeader = state.header;
    refresh();
  });

  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-note-prevwrap";
  const preview = document.createElement("div");
  preview.className = "pix-note-gridprev";
  previewWrap.appendChild(preview);

  // ── Stepper builder (cols + rows) ──────────────────────────────
  function makeStepper(labelText, key, min, max) {
    const row = document.createElement("div");
    row.className = "pix-note-modal-row";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = labelText;
    row.appendChild(lbl);
    const stepper = document.createElement("div");
    stepper.className = "pix-note-stepper";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "pix-note-step";
    minus.textContent = "−";
    const num = document.createElement("span");
    num.className = "pix-note-stepnum";
    num.textContent = String(state[key]);
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "pix-note-step";
    plus.textContent = "+";
    stepper.appendChild(minus);
    stepper.appendChild(num);
    stepper.appendChild(plus);
    row.appendChild(stepper);
    function set(v) {
      state[key] = Math.max(min, Math.min(max, v));
      editor[`_gridPicker${key === "cols" ? "Cols" : "Rows"}`] = state[key];
      num.textContent = String(state[key]);
      minus.disabled = state[key] <= min;
      plus.disabled = state[key] >= max;
      refresh();
    }
    minus.addEventListener("mousedown", (e) => e.preventDefault());
    plus.addEventListener("mousedown", (e) => e.preventDefault());
    minus.addEventListener("click", () => set(state[key] - 1));
    plus.addEventListener("click", () => set(state[key] + 1));
    set(state[key]);
    // Expose `set` so Reset can drive the stepper from outside
    // without re-implementing the clamp + button-disabled logic.
    return { row, setValue: set };
  }
  const colsStep = makeStepper("Columns", "cols", GRID_COL_MIN, GRID_COL_MAX);
  const rowsStep = makeStepper("Rows",    "rows", GRID_ROW_MIN, GRID_ROW_MAX);
  pop.appendChild(colsStep.row);
  pop.appendChild(rowsStep.row);
  pop.appendChild(headRow);
  pop.appendChild(previewWrap);

  // ── Footer ─────────────────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "pix-note-modal-footer";

  // Reset to defaults — sits on the left (margin-right: auto in CSS).
  // Restores both colours, cols/rows, and the header toggle to their
  // factory defaults. Useful when the sticky session state has drifted.
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "pix-note-modal-btn pix-note-modal-btn-reset";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Reset all options to defaults";
  resetBtn.addEventListener("mousedown", (e) => e.preventDefault());
  resetBtn.addEventListener("click", () => {
    state.borderColor = "#f66744";
    state.headerBg    = "#1a1a1a";
    state.header      = false;
    editor._gridPickerBorderColor = state.borderColor;
    editor._gridPickerHeaderBg    = state.headerBg;
    editor._gridPickerHeader      = state.header;
    borderSwatch.style.background      = state.borderColor;
    headerColorSwatch.style.background = state.headerBg;
    colsStep.setValue(3);
    rowsStep.setValue(3);
    refresh();
  });
  footer.appendChild(resetBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pix-note-modal-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("mousedown", (e) => e.preventDefault());
  cancelBtn.addEventListener("click", () => close());
  footer.appendChild(cancelBtn);
  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.className = "pix-note-modal-btn primary";
  insertBtn.textContent = "Insert";
  insertBtn.addEventListener("mousedown", (e) => e.preventDefault());
  insertBtn.addEventListener("click", () => commit());
  footer.appendChild(insertBtn);
  pop.appendChild(footer);

  document.body.appendChild(backdrop);

  function refresh() {
    preview.innerHTML = "";
    preview.style.gridTemplateColumns = `repeat(${state.cols}, 1fr)`;
    const totalRows = state.rows + (state.header ? 1 : 0);
    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const cell = document.createElement("div");
        cell.className = "pix-note-gridprevcell";
        cell.style.borderColor = state.borderColor;
        if (state.header && r === 0) {
          cell.classList.add("head");
          cell.style.background = state.headerBg;
          cell.style.borderBottom = `2px solid ${state.borderColor}`;
        }
        preview.appendChild(cell);
      }
    }
    headToggle.classList.toggle("on", state.header);
    headerColorSwatch.disabled = !state.header;
    headerColorRow.classList.toggle("disabled", !state.header);
  }
  refresh();

  const onBackdropDown = (e) => { if (e.target === backdrop) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    else if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); commit(); }
  };
  backdrop.addEventListener("mousedown", onBackdropDown);
  window.addEventListener("keydown", onKey, true);

  function close() {
    backdrop.removeEventListener("mousedown", onBackdropDown);
    window.removeEventListener("keydown", onKey, true);
    backdrop.remove();
  }
  function commit() {
    onSubmit({ ...state });
    close();
  }
}


NoteEditor.prototype._insertGridBlock = function (anchorBtn) {
  // Capture the saved range AND the top-level block containing it, like
  // the code-block insert path does. We bypass execCommand("insertHTML")
  // for the grid because block-level insertHTML of a <table> has two
  // sharp edges in Chrome:
  //
  //   1. Caret placement is unpredictable — often the caret lands inside
  //      the last <td> instead of the trailing <p>, so the next keystroke
  //      adds text to a cell the user didn't intend.
  //   2. The insert splits the surrounding inline formatting context and
  //      drops any staged foreColor/hiliteColor. Even with the
  //      _restageColors() compensation in insertAtSavedRange, caret
  //      placement inside a <td> then stages the color against the cell
  //      rather than the trailing paragraph.
  //
  // Direct DOM manipulation side-steps both: we insert the table as a
  // sibling of the current top-level block, drop a trailing <p><br></p>
  // after it, and explicitly position the caret inside that <p>.
  const savedRange = saveRange(this._editArea);
  this._normalizeEditArea?.();
  makeGridModal(this, (v) => {
    this._snapBefore?.();
    // Build the nodes: <table> + trailing <p><br></p> for caret landing.
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderGridHTML(
      v.cols, v.rows, v.header, v.borderColor, v.headerBg
    );
    const table = wrapper.querySelector("table");
    const trailing = wrapper.querySelector("p");
    if (!table || !trailing) { this._snapAfter?.(); return true; }

    // Find the top-level block inside editArea that contains the saved
    // range (or fall back to end-of-editArea).
    const findTopBlock = (node) => {
      if (!node) return null;
      if (node.nodeType !== 1) node = node.parentNode;
      while (node && node.parentNode !== this._editArea && node !== this._editArea) {
        node = node.parentNode;
      }
      return node && node.parentNode === this._editArea ? node : null;
    };
    let anchorBlock = null;
    if (savedRange) {
      anchorBlock = findTopBlock(savedRange.startContainer);
    }
    if (anchorBlock && anchorBlock.parentNode === this._editArea) {
      // Insert AFTER the anchor block so the user's existing content
      // keeps its inline formatting — split-through-insertHTML was
      // the main way colors were getting dropped.
      this._editArea.insertBefore(table, anchorBlock.nextSibling);
      this._editArea.insertBefore(trailing, table.nextSibling);
    } else {
      this._editArea.appendChild(table);
      this._editArea.appendChild(trailing);
    }

    // Position the caret inside the trailing <p>. Use a collapsed range
    // at the start of the <p> so typing lands there (not in the table).
    const r = document.createRange();
    r.selectNodeContents(trailing);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    this._editArea.focus();

    // Re-stage the picked colors AFTER caret placement so the stage
    // targets the trailing <p>, not whatever Chrome thought was current.
    this._restageColors?.();

    this._snapAfter?.();
    this._dirty = true;
    return true;
  });
};

// ── Separator picker ─────────────────────────────────────────────
// Centred modal with backdrop, colour picker, 5 variant tiles, and
// Insert / Cancel buttons. Mirrors the icon picker UX (Pattern #29
// modal shell). Each inserted <hr> carries inline `style="color:..."`
// so the colour is independent of the toolbar Ln picker — picking a
// red separator HERE doesn't change other separators in the note.
const _SEP_VARIANTS = [
  { id: "solid",  label: "Solid line"      },
  { id: "dashed", label: "Dashed line"     },
  { id: "dotted", label: "Dotted line"     },
  { id: "double", label: "Double line"     },
  { id: "thick",  label: "Thick solid line"},
];

NoteEditor.prototype._insertSeparatorBlock = function (anchorBtn) {
  if (!this._editArea) return;

  // Capture caret position synchronously — modal focus moves into the
  // colour picker's hex input and would otherwise drop the selection.
  const savedRange = (() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    if (!this._editArea.contains(r.commonAncestorContainer)) return null;
    return r.cloneRange();
  })();

  const editor = this;

  const backdrop = document.createElement("div");
  backdrop.className = "pix-note-modal-backdrop";
  const pop = document.createElement("div");
  pop.className = "pix-note-modal";
  backdrop.appendChild(pop);

  // Hint
  const hint = document.createElement("div");
  hint.className = "pix-note-modal-hint";
  hint.textContent = "Pick a colour, choose a separator style, then click Insert.";
  pop.appendChild(hint);

  // Colour picker — own state on editor._sepPickerColor so it doesn't
  // share with the toolbar Ln colour picker.
  const cp = createPixaromaColorPicker({
    initialColor: editor._sepPickerColor || "#f66744",
    showClear: false,
    resetColor: "#f66744",
    onChange: (c) => {
      editor._sepPickerColor = c;
      repaintVariants();
    },
  });
  pop.appendChild(cp.element);

  // Variant chooser — 5 tiles, each rendering an actual <hr> sample.
  const variantWrap = document.createElement("div");
  variantWrap.className = "pix-note-sep-variants";
  let selectedVariant = editor._sepPickerVariant || "solid";
  const variantTiles = new Map();
  for (const v of _SEP_VARIANTS) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "pix-note-sep-variant";
    tile.title = v.label;
    tile.setAttribute("data-variant", v.id);
    if (v.id === selectedVariant) tile.classList.add("selected");
    tile.addEventListener("mousedown", (e) => e.preventDefault());
    tile.addEventListener("click", (e) => {
      e.stopPropagation();
      const prev = variantTiles.get(selectedVariant);
      if (prev) prev.classList.remove("selected");
      selectedVariant = v.id;
      editor._sepPickerVariant = v.id;
      tile.classList.add("selected");
    });
    tile.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      commit();
    });
    const sampleHr = document.createElement("hr");
    sampleHr.className = `pix-note-hr-${v.id}`;
    tile.appendChild(sampleHr);
    variantWrap.appendChild(tile);
    variantTiles.set(v.id, tile);
  }
  pop.appendChild(variantWrap);

  function repaintVariants() {
    // Set the color directly on the inner <hr> element. Setting it on
    // the wrapping <button> looked like it should work via currentColor
    // inheritance, but Chrome's user-agent stylesheet on <hr> wins on
    // border-color (the inherited color isn't picked up by border via
    // currentColor in this configuration). Stamping the color on the
    // hr itself sidesteps the inheritance question entirely.
    const c = editor._sepPickerColor || "#f66744";
    for (const tile of variantTiles.values()) {
      const hr = tile.querySelector("hr");
      if (hr) hr.style.color = c;
    }
  }
  repaintVariants();

  // Footer
  const footer = document.createElement("div");
  footer.className = "pix-note-modal-footer";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pix-note-modal-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("mousedown", (e) => e.preventDefault());
  cancelBtn.addEventListener("click", () => close());
  footer.appendChild(cancelBtn);
  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.className = "pix-note-modal-btn primary";
  insertBtn.textContent = "Insert";
  insertBtn.addEventListener("mousedown", (e) => e.preventDefault());
  insertBtn.addEventListener("click", () => commit());
  footer.appendChild(insertBtn);
  pop.appendChild(footer);

  document.body.appendChild(backdrop);

  const onBackdropDown = (e) => { if (e.target === backdrop) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    else if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); commit(); }
  };
  backdrop.addEventListener("mousedown", onBackdropDown);
  window.addEventListener("keydown", onKey, true);

  function close() {
    backdrop.removeEventListener("mousedown", onBackdropDown);
    window.removeEventListener("keydown", onKey, true);
    cp.destroy();
    backdrop.remove();
  }

  function commit() {
    close();
    const color = editor._sepPickerColor || "#f66744";
    const variant = selectedVariant;

    editor._normalizeEditArea?.();
    editor._editArea.focus();
    editor._snapBefore?.();

    // Build the nodes: <hr> + trailing <p><br></p> for caret landing.
    const wrapper = document.createElement("div");
    wrapper.innerHTML =
      `<hr class="pix-note-hr-${variant}" style="color: ${color}">` +
      `<p><br></p>`;
    const hr = wrapper.firstElementChild;
    const trailing = wrapper.lastElementChild;

    // Find the top-level block inside editArea that contains the saved
    // range (or fall back to end-of-editArea). Direct DOM insert mirrors
    // _insertGridBlock — execCommand("insertHTML") on a block element
    // mishandles caret placement and drops staged colours.
    const findTopBlock = (node) => {
      if (!node) return null;
      if (node.nodeType !== 1) node = node.parentNode;
      while (node && node.parentNode !== editor._editArea && node !== editor._editArea) {
        node = node.parentNode;
      }
      return node && node.parentNode === editor._editArea ? node : null;
    };
    let anchorBlock = null;
    if (savedRange) anchorBlock = findTopBlock(savedRange.startContainer);
    if (anchorBlock && anchorBlock.parentNode === editor._editArea) {
      editor._editArea.insertBefore(hr, anchorBlock.nextSibling);
      editor._editArea.insertBefore(trailing, hr.nextSibling);
    } else {
      editor._editArea.appendChild(hr);
      editor._editArea.appendChild(trailing);
    }

    // Caret in the trailing <p> so typing lands below the rule.
    const r = document.createRange();
    r.selectNodeContents(trailing);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);

    editor._restageColors?.();
    editor._snapAfter?.();
    editor._dirty = true;
    editor._refreshActiveStates?.();
  }
};
