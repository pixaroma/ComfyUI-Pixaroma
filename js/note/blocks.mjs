import { NoteEditor } from "./core.mjs";

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

NoteEditor.prototype._insertDownloadBlock = function (anchorBtn) {
  makeDialog(
    anchorBtn,
    "Insert download button",
    [
      ["label", "Label", "Model Name", "e.g. Flux 2 Model"],
      ["url", "Direct URL", "", "https://huggingface.co/..."],
      ["folder", "Suggested folder (for clipboard)", "models/diffusion_models", ""],
      ["size", "Size hint (optional)", "", "e.g. 9.4 GB"],
    ],
    (v) => {
      if (!v.url || !/^https?:\/\//i.test(v.url)) {
        alert("URL must start with http:// or https://");
        return;
      }
      const sizeStr = v.size ? ` (${escapeHtml(v.size)})` : "";
      const html = `<a class="pix-note-dl" href="${escapeHtml(v.url)}"` +
        ` data-folder="${escapeHtml(v.folder)}"` +
        (v.size ? ` data-size="${escapeHtml(v.size)}"` : "") +
        ` target="_blank" rel="noopener noreferrer">⬇ ${escapeHtml(v.label || "Download")}${sizeStr}</a>&nbsp;`;
      document.execCommand("insertHTML", false, html);
      this._dirty = true;
    }
  );
};

NoteEditor.prototype._insertYouTubeBlock = function (anchorBtn) {
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
      document.execCommand("insertHTML", false, html);
      this._dirty = true;
    }
  );
};

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
