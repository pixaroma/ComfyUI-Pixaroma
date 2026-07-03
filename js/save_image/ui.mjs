// Save Image Pixaroma — node-body DOM + CSS (both renderers).
// The flex column lives on an INNER absolute layer (.pix-si-inner) because
// ComfyUI forces the addDOMWidget ROOT to inline display:block on rebuild /
// collapse (see the Nodes 2.0 clobber note in CLAUDE.md).

import { DEFAULT_STATE } from "./state.mjs";

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let _cssDone = false;
export function injectCSS() {
  if (_cssDone || document.getElementById("pix-si-css")) {
    _cssDone = true;
    return;
  }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-si-css";
  s.textContent = [
    ".pix-si-root{position:relative;width:100%;height:100%;box-sizing:border-box;}",
    ".pix-si-inner{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;padding:8px 10px;box-sizing:border-box;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;}",
    ".pix-si-lab{display:block;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#f66744;margin-bottom:4px;}",
    ".pix-si-row{display:flex;gap:6px;align-items:center;}",
    ".pix-si-field{flex:1;min-width:0;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#e0e0e0;padding:5px 8px;font-size:12px;outline:none;box-sizing:border-box;font-family:inherit;width:100%;}",
    ".pix-si-field:focus{border-color:#f66744;}",
    ".pix-si-field.mono{font-family:Consolas,ui-monospace,monospace;font-size:12px;}",
    ".pix-si-btn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.16);color:#ccc;border-radius:4px;padding:5px 10px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:0 0 auto;font-family:inherit;user-select:none;}",
    ".pix-si-btn:hover{background:#f66744;border-color:#f66744;color:#fff;}",
    ".pix-si-btn:disabled{opacity:.5;cursor:default;}",
    ".pix-si-btn:disabled:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.16);color:#ccc;}",
    ".pix-si-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}",
    ".pix-si-chip{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:#ccc;border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}",
    ".pix-si-chip:hover{border-color:#f66744;color:#eee;}",
    ".pix-si-prev{background:#1d1d1d;border:1px solid #444;border-radius:4px;padding:6px 8px;margin-top:6px;}",
    ".pix-si-prevlab{font-size:10px;color:#8f8f8f;margin-bottom:2px;}",
    ".pix-si-prevpath{font-family:Consolas,ui-monospace,monospace;font-size:11px;color:#ffb59e;word-break:break-all;line-height:1.45;}",
    ".pix-si-hint{font-size:10px;color:#8f8f8f;margin-top:4px;line-height:1.45;}",
    ".pix-si-seg{display:inline-flex;border:1px solid #444;border-radius:4px;overflow:hidden;flex:0 0 auto;}",
    ".pix-si-seg button{background:#1d1d1d;color:#aaa;border:none;padding:4px 13px;font-size:12px;cursor:pointer;font-family:inherit;}",
    ".pix-si-seg button.on{background:#f66744;color:#fff;}",
    ".pix-si-fmt-hint{font-size:10px;color:#8f8f8f;line-height:1.4;flex:1;min-width:0;}",
    ".pix-si-thumbs{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;}",
    ".pix-si-thumb{height:64px;width:64px;object-fit:cover;border-radius:4px;border:1px solid #444;background:#1d1d1d;display:block;}",
    ".pix-si-more{height:64px;min-width:36px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px;border:1px dashed #444;border-radius:4px;padding:0 8px;box-sizing:border-box;}",
    ".pix-si-status{display:flex;align-items:center;gap:7px;margin-top:6px;}",
    ".pix-si-stico{flex:0 0 auto;font-size:12px;line-height:1;}",
    ".pix-si-stico.ok{color:#3ec371;}",
    ".pix-si-stico.info{color:#9a9a9a;}",
    ".pix-si-sttxt{flex:1;min-width:0;font-size:11px;color:#c9c9c9;line-height:1.4;word-break:break-all;}",
    ".pix-si-open{padding:3px 8px;font-size:11px;}",
    // right-click settings panel (Run Timer palette so pickers/panels match)
    ".pix-si-panel{position:fixed;z-index:10010;width:300px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;}",
    ".pix-si-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-si-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-si-px:hover{color:#fff;}",
    ".pix-si-pbody{padding:12px;display:flex;flex-direction:column;gap:12px;color:#ddd;}",
    ".pix-si-prow{display:flex;align-items:center;gap:9px;}",
    ".pix-si-plab{font-size:12px;color:#ddd;}",
    ".pix-si-psub{font-size:10px;color:#8f8f8f;margin-top:2px;line-height:1.4;}",
    ".pix-si-qval{font-size:12px;color:#f66744;min-width:24px;text-align:right;}",
    ".pix-si-qsl{flex:1;min-width:0;}",
    '.pix-si-sw{width:30px;height:16px;border-radius:8px;background:#555;position:relative;display:inline-block;cursor:pointer;flex:0 0 auto;transition:background .15s;}',
    '.pix-si-sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#ccc;transition:left .15s;}',
    ".pix-si-sw.on{background:#f66744;}",
    ".pix-si-sw.on::after{left:16px;background:#fff;}",
    // Nodes 2.0: hide the native output-image preview panel for this node
    // (we emit ui.images for the Assets refresh; hideOutputImages is the
    // official switch, this CSS is belt-and-braces).
    ".lg-node:has(.pix-si-root) .image-preview{display:none !important;}",
  ].join("\n");
  document.head.appendChild(s);
}

export function buildRoot() {
  const root = el("div", "pix-si-root");
  const inner = el("div", "pix-si-inner");
  root.appendChild(inner);

  // ── folder ──
  const secFolder = el("div");
  secFolder.appendChild(el("span", "pix-si-lab", "Folder"));
  const rowF = el("div", "pix-si-row");
  const folderInput = el("input", "pix-si-field");
  folderInput.type = "text";
  folderInput.spellcheck = false;
  folderInput.placeholder = "ComfyUI output folder";
  folderInput.title = "Where the images are saved. Type or paste any path on your computer, or click Browse. Empty = ComfyUI's output folder.";
  const browseBtn = el("button", "pix-si-btn");
  browseBtn.type = "button";
  const browseLbl = el("span", null, "Browse");
  browseBtn.appendChild(browseLbl);
  browseBtn.title = "Pick a folder with the system folder dialog";
  rowF.appendChild(folderInput);
  rowF.appendChild(browseBtn);
  secFolder.appendChild(rowF);
  secFolder.appendChild(
    el("div", "pix-si-hint", "Leave empty to use the ComfyUI output folder. You can paste any path.")
  );
  inner.appendChild(secFolder);

  // ── filename ──
  const secName = el("div");
  secName.appendChild(el("span", "pix-si-lab", "Filename"));
  const patternInput = el("input", "pix-si-field mono");
  patternInput.type = "text";
  patternInput.spellcheck = false;
  patternInput.placeholder = DEFAULT_STATE.pattern;
  patternInput.title = "Filename pattern. Click the chips to insert tokens; the line below shows the exact next file.";
  secName.appendChild(patternInput);
  const chipsWrap = el("div", "pix-si-chips");
  secName.appendChild(chipsWrap);
  const prev = el("div", "pix-si-prev");
  prev.appendChild(el("div", "pix-si-prevlab", "Will save as"));
  const prevPath = el("div", "pix-si-prevpath", "");
  prev.appendChild(prevPath);
  secName.appendChild(prev);
  secName.appendChild(
    el(
      "div",
      "pix-si-hint",
      "Type / in the name to create subfolders. Files never overwrite: the counter continues from the highest number already in the folder."
    )
  );
  inner.appendChild(secName);

  // ── format ── (hint on its OWN full-width line below the buttons, so
  // switching PNG/JPG never wraps to a second line and never shifts layout)
  const secFmt = el("div");
  secFmt.appendChild(el("span", "pix-si-lab", "Format"));
  const rowFmt = el("div", "pix-si-row");
  const seg = el("div", "pix-si-seg");
  const fmtPng = el("button", null, "PNG");
  fmtPng.type = "button";
  fmtPng.title = "Lossless PNG. Keeps transparency and can embed the workflow for drag-back reload.";
  const fmtJpg = el("button", null, "JPG");
  fmtJpg.type = "button";
  fmtJpg.title = "Smaller JPG files. Quality is in the right-click settings. No transparency. Workflows reload from PNG only.";
  seg.appendChild(fmtPng);
  seg.appendChild(fmtJpg);
  rowFmt.appendChild(seg);
  secFmt.appendChild(rowFmt);
  const fmtHint = el("div", "pix-si-hint", "");
  secFmt.appendChild(fmtHint);
  inner.appendChild(secFmt);

  // ── saved this run ──
  const secSaved = el("div");
  secSaved.appendChild(el("span", "pix-si-lab", "Saved this run"));
  const thumbs = el("div", "pix-si-thumbs");
  secSaved.appendChild(thumbs);
  const status = el("div", "pix-si-status");
  const stIco = el("span", "pix-si-stico info", "●");
  const stTxt = el("span", "pix-si-sttxt", "No run yet");
  const openBtn = el("button", "pix-si-btn pix-si-open");
  openBtn.type = "button";
  openBtn.textContent = "Open folder";
  openBtn.title = "Open the save folder in your file explorer";
  status.appendChild(stIco);
  status.appendChild(stTxt);
  status.appendChild(openBtn);
  secSaved.appendChild(status);
  inner.appendChild(secSaved);

  return {
    root,
    inner,
    folderInput,
    browseBtn,
    browseLbl,
    patternInput,
    chipsWrap,
    prevPath,
    fmtPng,
    fmtJpg,
    fmtHint,
    thumbs,
    stIco,
    stTxt,
    openBtn,
  };
}
