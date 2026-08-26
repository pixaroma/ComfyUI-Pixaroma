// Save Video Pixaroma - node-body DOM + CSS (both renderers).
//
// The face follows Save Image Pixaroma so the two read as one pair: a topbar
// with the fold triangle and the gear, the folder row, the FILENAME section
// with its chips and live "Will save as" line, one wrapping button row, then
// the player fills whatever height is left.
//
// The flex column lives on an INNER absolute layer (.pix-sv-inner) because
// ComfyUI forces the addDOMWidget ROOT to inline display:block on rebuild and
// collapse, which would flatten an all-absolute child to nothing.

import { DEFAULT_STATE, FORMATS } from "./state.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import { el } from "./player.mjs";

export { el };

let _cssDone = false;
export function injectCSS() {
  if (_cssDone || document.getElementById("pix-sv-css")) {
    _cssDone = true;
    return;
  }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-sv-css";
  s.textContent = [
    // flex:1 1 0 (an ABSOLUTE basis) + min-height:0, never height:100%. The host
    // is a flex column giving us flex:1 1 0% via its own *:flex-1 utility, and a
    // PERCENTAGE basis against a parent whose height is not yet definite degrades
    // to auto -> falls through to height -> 100% is a percentage too -> auto ->
    // our CONTENT height. The inner is position:absolute so that content measures
    // ~0, and the row then sits at computeLayoutSize().minHeight while the node
    // frame stays tall: dead space below, the player stuck at its 120px CSS floor,
    // and the button row clipped by the inner's overflow:hidden. MEASURED on a
    // fresh node the user ran: node 926, widgets column 409, stage 120. A cold
    // load looked perfect because by then the parent height IS definite, which is
    // why it read as "fine on reload, broken on a fresh drop or a corner drag".
    // Save Mp4 / Load Video / Load Video Frame / Preview / Compare all use the
    // absolute basis and were unaffected in the same session.
    ".pix-sv-root{position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;}",
    ".pix-sv-inner{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;padding:8px 10px 4px;box-sizing:border-box;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;}",
    // top strip: fold triangle + gear, pulled up so it hugs the slots
    ".pix-sv-topbar{display:flex;justify-content:flex-start;align-items:center;flex:0 0 auto;min-height:20px;margin:-6px 0 -6px;}",
    ".pix-sv-fold{width:24px;height:22px;border:none;border-radius:4px;background:var(--pix-acc,#f66744);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:0 0 auto;}",
    ".pix-sv-fold:hover{background:#ff7d58;}",
    ".pix-sv-fold i{display:block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;}",
    ".pix-sv-fold:not(.folded) i{border-bottom:6px solid #fff;}", // fold up
    ".pix-sv-fold.folded i{border-top:6px solid #fff;}", // open back up
    // The gear is the bundled SVG as a CSS mask, never the emoji: an emoji is
    // drawn by the OS, so it is a different shape and colour per platform
    // (convention #28).
    ".pix-sv-gear{width:24px;height:22px;border:none;border-radius:4px;background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:0 0 auto;margin-left:4px;}",
    ".pix-sv-gear::before{content:\"\";display:block;width:14px;height:14px;background:#bbb;" +
      "-webkit-mask:url(\"" + pixAsset("icons/note/gear.svg") + "\") center/contain no-repeat;" +
      "mask:url(\"" + pixAsset("icons/note/gear.svg") + "\") center/contain no-repeat;}",
    ".pix-sv-gear:hover::before{background:var(--pix-acc,#f66744);}",
    ".pix-sv-lab{display:block;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--pix-acc,#f66744);margin-bottom:4px;}",
    ".pix-sv-row{display:flex;gap:6px;align-items:center;}",
    ".pix-sv-field{flex:1;min-width:0;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#e0e0e0;padding:5px 8px;font-size:12px;outline:none;box-sizing:border-box;font-family:inherit;width:100%;}",
    ".pix-sv-field:focus{border-color:var(--pix-acc,#f66744);}",
    ".pix-sv-field.mono{font-family:Consolas,ui-monospace,monospace;font-size:12px;}",
    ".pix-sv-btn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.16);color:#ccc;border-radius:4px;padding:5px 10px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:0 0 auto;font-family:inherit;user-select:none;}",
    ".pix-sv-btn:hover{background:var(--pix-acc,#f66744);border-color:var(--pix-acc,#f66744);color:#fff;}",
    ".pix-sv-btn:disabled{opacity:.5;cursor:default;}",
    ".pix-sv-btn:disabled:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.16);color:#ccc;}",
    ".pix-sv-primary{background:var(--pix-acc,#f66744);border-color:var(--pix-acc,#f66744);color:#fff;}",
    ".pix-sv-primary:hover{background:#ff7d58;border-color:#ff7d58;color:#fff;}",
    ".pix-sv-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}",
    ".pix-sv-chip{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:#ccc;border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}",
    ".pix-sv-chip:hover{border-color:var(--pix-acc,#f66744);color:#eee;}",
    ".pix-sv-prev{background:#1d1d1d;border:1px solid #444;border-radius:4px;padding:6px 8px;margin-top:8px;}",
    ".pix-sv-prevlab{font-size:10px;color:#8f8f8f;margin-bottom:2px;}",
    ".pix-sv-prevpath{font-family:Consolas,ui-monospace,monospace;font-size:11px;color:#ffb59e;word-break:break-all;line-height:1.45;}",
    ".pix-sv-hint{font-size:10px;color:#8f8f8f;margin-top:4px;line-height:1.5;}",
    ".pix-sv-seg{display:inline-flex;border:1px solid #444;border-radius:999px;overflow:hidden;flex:0 0 auto;}",
    ".pix-sv-seg button{background:#1d1d1d;color:#aaa;border:none;padding:4px 11px;font-size:12px;cursor:pointer;font-family:inherit;}",
    ".pix-sv-seg button.on{background:var(--pix-acc,#f66744);color:#fff;}",
    ".pix-sv-btnrow{display:flex;flex-wrap:wrap;gap:6px;align-items:stretch;}",
    ".pix-sv-grow{flex:1 1 0;min-width:0;justify-content:center;}",
    // ── the player ──
    ".pix-sv-saved{flex:1 1 0;min-height:0;display:flex;flex-direction:column;gap:3px;}",
    ".pix-sv-stage{position:relative;flex:1 1 0;min-height:120px;background:#151515;border:1px solid #3c3c3c;border-radius:4px;overflow:hidden;display:flex;flex-direction:column;}",
    ".pix-sv-media{position:relative;flex:1 1 0;min-height:0;overflow:hidden;}",
    ".pix-sv-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;background:#000;cursor:pointer;}",
    ".pix-sv-vph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#777;font-size:11px;padding:10px;text-align:center;line-height:1.5;}",
    ".pix-sv-bar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:5px 8px;box-sizing:border-box;background:rgba(0,0,0,.30);}",
    ".pix-sv-bar.is-disabled{opacity:.40;pointer-events:none;}",
    ".pix-sv-btn2{width:24px;height:24px;}",
    ".pix-sv-btn.pix-sv-plain,.pix-sv-bar .pix-sv-btn{background:transparent;border:none;}",
    ".pix-sv-bar .pix-sv-btn{width:24px;height:24px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:4px;background:transparent;cursor:pointer;}",
    ".pix-sv-bar .pix-sv-btn:hover{background:rgba(255,255,255,.10);}",
    ".pix-sv-ico{width:15px;height:15px;pointer-events:none;background-color:rgba(255,255,255,.85);-webkit-mask:var(--ico) center/contain no-repeat;mask:var(--ico) center/contain no-repeat;}",
    ".pix-sv-bar .pix-sv-btn:hover .pix-sv-ico{background-color:#fff;}",
    ".pix-sv-scrub{flex:1 1 auto;min-width:30px;height:6px;position:relative;border-radius:3px;background:rgba(255,255,255,.16);cursor:pointer;}",
    ".pix-sv-scrub-fill{position:absolute;left:0;top:0;height:100%;width:0%;border-radius:3px;background:var(--pix-acc,#f66744);pointer-events:none;}",
    ".pix-sv-scrub-handle{position:absolute;top:50%;left:0%;width:11px;height:11px;border-radius:50%;background:#fff;transform:translate(-50%,-50%);pointer-events:none;box-shadow:0 0 2px rgba(0,0,0,.6);}",
    ".pix-sv-time{flex:0 0 auto;font:11px monospace;color:rgba(255,255,255,.70);white-space:nowrap;user-select:none;}",
    ".pix-sv-info{flex:0 0 auto;text-align:center;font-size:11px;color:#8f8f8f;min-height:12px;line-height:1.25;word-break:break-word;}",
    // ── the floating settings panel (Run Timer palette) ──
    ".pix-sv-panel{position:fixed;z-index:10010;width:320px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;max-height:88vh;display:flex;flex-direction:column;}",
    ".pix-sv-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-sv-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-sv-px:hover{color:#fff;}",
    ".pix-sv-pbody{padding:12px;display:flex;flex-direction:column;gap:12px;color:#ddd;overflow-y:auto;min-height:0;}",
    ".pix-sv-prow{display:flex;align-items:center;gap:9px;}",
    ".pix-sv-plab{font-size:12px;color:#ddd;}",
    ".pix-sv-psub{font-size:10px;color:#8f8f8f;margin-top:2px;line-height:1.4;}",
    // wide enough for "100 · Small file" without the slider jumping as it changes
    ".pix-sv-qval{font-size:12px;color:var(--pix-acc,#f66744);min-width:92px;text-align:right;white-space:nowrap;}",
    ".pix-sv-qsl{flex:1;min-width:0;accent-color:var(--pix-acc,#f66744);}",
    ".pix-sv-bgrid{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}",
    ".pix-sv-bchip{flex:1 1 58px;background:#1d1d1d;border:1px solid #444;color:#aaa;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}",
    ".pix-sv-bchip:hover{border-color:var(--pix-acc,#f66744);color:#ddd;}",
    ".pix-sv-bchip.on{background:var(--pix-acc,#f66744);border-color:var(--pix-acc,#f66744);color:#fff;}",
    ".pix-sv-bchip:disabled{opacity:.4;cursor:default;}",
    ".pix-sv-bchip:disabled:hover{border-color:#444;color:#aaa;}",
    '.pix-sv-sw{width:30px;height:16px;border-radius:8px;background:#555;position:relative;display:inline-block;cursor:pointer;flex:0 0 auto;transition:background .15s;}',
    '.pix-sv-sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#ccc;transition:left .15s;}',
    ".pix-sv-sw.on{background:var(--pix-acc,#f66744);}",
    ".pix-sv-sw.on::after{left:16px;background:#fff;}",
    // Nodes 2.0: hide the native output-image preview panel for this node - it
    // emits ui.images so the Assets panel refreshes, but an mp4 is not an image
    ".lg-node:has(.pix-sv-root) .image-preview{display:none !important;}",
  ].join("\n");
  document.head.appendChild(s);
}

export function buildRoot() {
  const root = el("div", "pix-sv-root");
  const inner = el("div", "pix-sv-inner");
  root.appendChild(inner);

  // ── topbar: fold + gear ──
  const topbar = el("div", "pix-sv-topbar");
  const foldBtn = el("button", "pix-sv-fold");
  foldBtn.type = "button";
  foldBtn.title = "Fold the node down to just the video";
  foldBtn.appendChild(el("i"));
  topbar.appendChild(foldBtn);
  const gearBtn = el("button", "pix-sv-gear");
  gearBtn.type = "button";
  gearBtn.title = "Settings: quality, colour depth, trim to audio, and more";
  topbar.appendChild(gearBtn);
  inner.appendChild(topbar);

  // ── folder ──
  const secFolder = el("div");
  const rowF = el("div", "pix-sv-row");
  const folderInput = el("input", "pix-sv-field");
  folderInput.type = "text";
  folderInput.spellcheck = false;
  folderInput.placeholder = "ComfyUI output folder";
  folderInput.title =
    "Where the video is saved. Empty = ComfyUI's output folder. To use a folder of " +
    "your own, click Browse and pick it once - that approves it for good, and you " +
    "can type or paste it from then on.";
  const browseBtn = el("button", "pix-sv-btn");
  browseBtn.type = "button";
  const browseLbl = el("span", null, "Browse");
  browseBtn.appendChild(browseLbl);
  browseBtn.title = "Pick a folder with the system folder dialog";
  rowF.appendChild(folderInput);
  rowF.appendChild(browseBtn);
  secFolder.appendChild(rowF);
  secFolder.appendChild(
    el("div", "pix-sv-hint",
      "Leave empty for the ComfyUI output folder. For your own folder, click Browse once.")
  );
  inner.appendChild(secFolder);

  // ── filename ──
  const secName = el("div");
  secName.appendChild(el("span", "pix-sv-lab", "Filename"));
  const patternInput = el("input", "pix-sv-field mono");
  patternInput.type = "text";
  patternInput.spellcheck = false;
  patternInput.placeholder = DEFAULT_STATE.pattern;
  patternInput.title =
    "Filename pattern. Click the chips to insert tokens; the line below shows the " +
    "exact next file. Videos never overwrite: the counter continues from the highest " +
    "number already in the folder.";
  secName.appendChild(patternInput);
  const chipsWrap = el("div", "pix-sv-chips");
  secName.appendChild(chipsWrap);
  const prev = el("div", "pix-sv-prev");
  prev.appendChild(el("div", "pix-sv-prevlab", "Will save as"));
  const prevPath = el("div", "pix-sv-prevpath", "");
  prev.appendChild(prevPath);
  secName.appendChild(prev);
  secName.appendChild(el("div", "pix-sv-hint", "Type / in the name to create subfolders."));
  inner.appendChild(secName);

  // ── one wrapping button row: actions + format + mode ──
  const secBtns = el("div");
  const btnRow = el("div", "pix-sv-btnrow");
  const btnOpen = el("button", "pix-sv-btn pix-sv-primary pix-sv-grow", "Open");
  btnOpen.type = "button";
  btnOpen.title = "Open the video in a new browser tab";
  const btnDownload = el("button", "pix-sv-btn pix-sv-primary pix-sv-grow", "Download");
  btnDownload.type = "button";
  btnDownload.title = "Save a copy of the video through your browser";
  const btnFolder = el("button", "pix-sv-btn pix-sv-primary pix-sv-grow", "Folder");
  btnFolder.type = "button";
  btnFolder.title =
    "Open the save folder in your file explorer (the window can appear on the taskbar)";
  const segFmt = el("div", "pix-sv-seg");
  const fmtBtns = {};
  for (const f of FORMATS) {
    const b = el("button", null, f.label);
    b.type = "button";
    b.dataset.fmt = f.id;
    b.title = f.title;
    segFmt.appendChild(b);
    fmtBtns[f.id] = b;
  }
  const segMode = el("div", "pix-sv-seg");
  const modeSave = el("button", null, "Save");
  modeSave.type = "button";
  modeSave.title = "Write the video to your folder on every run";
  const modePreview = el("button", null, "Preview");
  modePreview.type = "button";
  modePreview.title =
    "Play the video on the node without writing to your folder. It goes to ComfyUI's " +
    "temp folder instead, which is cleared on restart.";
  segMode.appendChild(modeSave);
  segMode.appendChild(modePreview);
  btnRow.appendChild(btnOpen);
  btnRow.appendChild(btnDownload);
  btnRow.appendChild(btnFolder);
  btnRow.appendChild(segFmt);
  btnRow.appendChild(segMode);
  secBtns.appendChild(btnRow);
  inner.appendChild(secBtns);

  // ── the player (media + control bar) fills the rest ──
  const secSaved = el("div", "pix-sv-saved");
  const stage = el("div", "pix-sv-stage");
  secSaved.appendChild(stage);
  const infoLine = el("div", "pix-sv-info", "");
  secSaved.appendChild(infoLine);
  inner.appendChild(secSaved);

  return {
    root, inner, topbar, foldBtn, gearBtn,
    secFolder, secName, secBtns,
    folderInput, browseBtn, browseLbl,
    patternInput, chipsWrap, prevPath,
    segFmt, fmtBtns, segMode, modeSave, modePreview,
    btnOpen, btnDownload, btnFolder,
    savedSec: secSaved, stage, infoLine,
  };
}
