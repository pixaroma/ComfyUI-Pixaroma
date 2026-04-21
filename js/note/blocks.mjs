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

function makeDialog(anchorBtn, title, fields, onSubmit) {
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
    inp.value = defaultVal || "";
    if (placeholder) inp.placeholder = placeholder;
    row.appendChild(lbl);
    row.appendChild(inp);
    dlg.appendChild(row);
    inputs[key] = inp;
  }

  const footer = document.createElement("div");
  footer.className = "dlgfooter";
  const cancel = document.createElement("button");
  cancel.className = "pix-note-btn";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.className = "pix-note-btn primary";
  ok.textContent = "Insert";
  footer.appendChild(cancel);
  footer.appendChild(ok);
  dlg.appendChild(footer);

  document.body.appendChild(dlg);
  setTimeout(() => inputs[Object.keys(inputs)[0]]?.focus(), 10);

  function close() { dlg.remove(); document.removeEventListener("mousedown", onOutside, true); }
  const onOutside = (e) => { if (!dlg.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  cancel.onclick = close;
  ok.onclick = () => {
    const values = {};
    for (const k of Object.keys(inputs)) values[k] = inputs[k].value.trim();
    onSubmit(values);
    close();
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
  makeButtonDesignDialog(anchorBtn, (v) => {
    if (!v.url || !/^https?:\/\//i.test(v.url)) {
      alert("URL must start with http:// or https://");
      return false; // keep dialog open
    }
    const cls = ICON_TO_CLASS[v.icon] || "pix-note-dl";
    const labelFallback = ICON_TO_FALLBACK_LABEL[v.icon] || "Download";
    const sizeStr = (v.sizeOn && v.size) ? ` (${escapeHtml(v.size)})` : "";
    const attrs = [
      `class="${cls}"`,
      `href="${escapeHtml(v.url)}"`,
      `target="_blank"`,
      `rel="noopener noreferrer"`,
    ];
    if (v.folderOn && v.folder) attrs.push(`data-folder="${escapeHtml(v.folder)}"`);
    if (v.sizeOn && v.size) attrs.push(`data-size="${escapeHtml(v.size)}"`);
    const html = `<a ${attrs.join(" ")}>${escapeHtml(v.label || labelFallback)}${sizeStr}</a>&nbsp;`;
    insertAtSavedRange(this, savedRange, html);
    return true; // close dialog
  });
};

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
    (v) => {
      if (!v.url || !/^https?:\/\//i.test(v.url)) {
        alert("URL must start with http:// or https://");
        return;
      }
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
      ["label", "Label", "Join Here", ""],
      ["url", "URL", "https://discord.com/invite/gggpkVgBf3", ""],
    ],
    (v) => {
      if (!v.url || !/^https?:\/\//i.test(v.url)) {
        alert("URL must start with http:// or https://");
        return;
      }
      const html = `<a class="pix-note-discord" href="${escapeHtml(v.url)}"` +
        ` target="_blank" rel="noopener noreferrer">${escapeHtml(v.label || "Discord")}</a>&nbsp;`;
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
function makeButtonDesignDialog(anchorBtn, onSubmit) {
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

  const dlg = document.createElement("div");
  dlg.className = "pix-note-blockdlg pix-note-btndesign";
  const rect = anchorBtn.getBoundingClientRect();
  dlg.style.left = `${Math.max(8, rect.left)}px`;
  dlg.style.top = `${rect.bottom + 6}px`;

  // Header
  const h = document.createElement("h4");
  h.textContent = "Insert button";
  dlg.appendChild(h);

  // --- Live preview pill --------------------------------------------------
  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-note-prevwrap";
  const preview = document.createElement("a");
  preview.className = "pix-note-dl";
  preview.href = "#";
  preview.textContent = "Model Name";
  preview.addEventListener("click", (e) => e.preventDefault());
  previewWrap.appendChild(preview);
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
  folderInput.addEventListener("input", () => { state.folder = folderInput.value; });
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

  // --- Footer -------------------------------------------------------------
  const footer = document.createElement("div");
  footer.className = "dlgfooter";
  const cancel = document.createElement("button");
  cancel.className = "pix-note-btn";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.className = "pix-note-btn primary";
  ok.textContent = "Insert";
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
    // Preview pill: class + text
    const cls = ICON_TO_CLASS[state.icon];
    preview.className = cls;
    const labelText = state.label || ICON_TO_FALLBACK_LABEL[state.icon];
    const sizeSuffix = (state.sizeOn && state.size) ? ` (${state.size})` : "";
    preview.textContent = `${labelText}${sizeSuffix}`;
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
    const r = onSubmit(values);
    if (r !== false) close();
  }
  cancel.addEventListener("click", close);
  ok.addEventListener("click", submit);

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
