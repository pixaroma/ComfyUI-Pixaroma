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
    ".pix-si-saved{flex:1 1 0;min-height:0;display:flex;flex-direction:column;gap:6px;}",
    // the view is a bordered drop-zone box only while EMPTY; with an image it
    // goes frameless so the picture floats on the node like Preview Image
    ".pix-si-view{position:relative;flex:1 1 0;min-height:90px;background:#151515;border:1px solid #3c3c3c;border-radius:4px;overflow:hidden;}",
    ".pix-si-view.has{background:transparent;border-color:transparent;}",
    ".pix-si-big{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;cursor:pointer;}",
    ".pix-si-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#777;font-size:11px;padding:8px;text-align:center;}",
    ".pix-si-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.18);color:#ddd;border-radius:4px;padding:4px 7px;font-size:11px;cursor:pointer;display:none;}",
    ".pix-si-view.has:hover .pix-si-nav.show{display:block;}",
    ".pix-si-nav.prev{left:6px;}",
    ".pix-si-nav.next{right:6px;}",
    ".pix-si-nav:hover{background:#f66744;border-color:#f66744;color:#fff;}",
    ".pix-si-count{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.55);color:#ddd;font-size:11px;padding:1px 7px;border-radius:3px;display:none;}",
    ".pix-si-act{position:absolute;top:6px;right:6px;display:none;gap:4px;}",
    ".pix-si-view.has .pix-si-act{display:flex;}",
    ".pix-si-abtn{background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.18);color:#ddd;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:inherit;}",
    ".pix-si-abtn:hover{background:#f66744;border-color:#f66744;color:#fff;}",
    ".pix-si-dims{flex:0 0 auto;text-align:center;font-size:10px;color:#8f8f8f;display:none;}",
    ".pix-si-strip{display:flex;gap:5px;flex-wrap:wrap;flex:0 0 auto;}",
    ".pix-si-thumb{height:44px;width:44px;object-fit:cover;border-radius:4px;border:1px solid #444;background:#1d1d1d;display:block;cursor:pointer;}",
    ".pix-si-thumb.sel{border-color:#f66744;box-shadow:0 0 0 1px #f66744;}",
    ".pix-si-more{height:44px;min-width:32px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:11px;border:1px dashed #444;border-radius:4px;padding:0 7px;box-sizing:border-box;}",
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

  // ── mode (Save / Preview on the node face, like the format toggle) ──
  const secMode = el("div");
  secMode.appendChild(el("span", "pix-si-lab", "Mode"));
  const rowMode = el("div", "pix-si-row");
  const segMode = el("div", "pix-si-seg");
  const modeSave = el("button", null, "Save");
  modeSave.type = "button";
  modeSave.title = "Write the files on every run";
  const modePreview = el("button", null, "Preview");
  modePreview.type = "button";
  modePreview.title = "Show the images on the node without writing anything to your folder";
  segMode.appendChild(modeSave);
  segMode.appendChild(modePreview);
  rowMode.appendChild(segMode);
  secMode.appendChild(rowMode);
  const modeHint = el("div", "pix-si-hint", "");
  secMode.appendChild(modeHint);
  inner.appendChild(secMode);

  // ── saved this run: big preview (fills the node) + thumb strip + status ──
  const secSaved = el("div", "pix-si-saved");
  const savedLab = el("span", "pix-si-lab", "Saved this run");
  secSaved.appendChild(savedLab);
  const view = el("div", "pix-si-view");
  const bigImg = el("img", "pix-si-big");
  bigImg.style.display = "none";
  const ph = el("div", "pix-si-ph", "Run the workflow to save and preview the result here");
  const navPrev = el("button", "pix-si-nav prev", "◀");
  navPrev.type = "button";
  navPrev.title = "Previous image";
  const navNext = el("button", "pix-si-nav next", "▶");
  navNext.type = "button";
  navNext.title = "Next image";
  const counter = el("div", "pix-si-count", "");
  const act = el("div", "pix-si-act");
  const actCopy = el("button", "pix-si-abtn", "Copy");
  actCopy.type = "button";
  actCopy.title = "Copy the shown image to the clipboard";
  const actOpen = el("button", "pix-si-abtn", "Open");
  actOpen.type = "button";
  actOpen.title = "Open the shown image in a new browser tab";
  act.appendChild(actCopy);
  act.appendChild(actOpen);
  view.appendChild(bigImg);
  view.appendChild(ph);
  view.appendChild(navPrev);
  view.appendChild(navNext);
  view.appendChild(counter);
  view.appendChild(act);
  secSaved.appendChild(view);
  const dims = el("div", "pix-si-dims", "");
  secSaved.appendChild(dims);
  const strip = el("div", "pix-si-strip");
  secSaved.appendChild(strip);
  const status = el("div", "pix-si-status");
  const stIco = el("span", "pix-si-stico info", "●");
  const stTxt = el("span", "pix-si-sttxt", "No run yet");
  const openBtn = el("button", "pix-si-btn pix-si-open");
  openBtn.type = "button";
  openBtn.textContent = "Open folder";
  openBtn.title = "Open the save folder in your file explorer (the window can appear on the taskbar)";
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
    modeSave,
    modePreview,
    modeHint,
    savedSec: secSaved,
    savedLab,
    view,
    bigImg,
    ph,
    navPrev,
    navNext,
    counter,
    actCopy,
    actOpen,
    dims,
    strip,
    stIco,
    stTxt,
    openBtn,
  };
}
