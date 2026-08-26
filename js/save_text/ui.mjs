// Save Text Pixaroma - node-body DOM + CSS (both renderers).
//
// Face, top to bottom: a topbar with the fold triangle and the gear, the text
// box (which gets ALL the free height), a one-line footer that always says
// where you stand, and one wrapping button row.
//
// The flex column lives on an INNER absolute layer because ComfyUI forces the
// addDOMWidget ROOT to inline display:block on rebuild and collapse, which
// would flatten an all-absolute child to nothing.

import { ACC } from "../shared/node_settings.mjs";
import { pixAsset } from "../shared/api_url.mjs";

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

let _cssDone = false;
export function injectCSS() {
  if (_cssDone || document.getElementById("pix-stx-css")) {
    _cssDone = true;
    return;
  }
  _cssDone = true;
  const gear = pixAsset("icons/note/gear.svg");
  const s = document.createElement("style");
  s.id = "pix-stx-css";
  s.textContent = [
    // flex:1 1 0 (ABSOLUTE basis) + min-height:0, never height:100% - see the long
    // note on .pix-sv-root in js/save_video/ui.mjs. A percentage basis against a
    // not-yet-definite parent degrades to our content height, which is ~0 here
    // because .pix-stx-inner is absolute, so the body stops filling and the text
    // box sticks at its 54px floor. Same defect, same face family.
    ".pix-stx-root{position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;}",
    ".pix-stx-inner{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;" +
      "padding:8px 10px 6px;box-sizing:border-box;overflow:hidden;" +
      "font-family:'Segoe UI',system-ui,sans-serif;}",

    // The gear lives in the BUTTON ROW, after Folder - it used to have a strip
    // of its own above the text box, and that strip cost ~22px of height for
    // one small button. In the row it costs nothing and behaves identically in
    // both renderers, with no slot-band float to maintain.
    //
    // It is the bundled SVG as a CSS mask, never the emoji: an emoji is drawn
    // by the OS, so it is a different shape, colour and baseline on every
    // platform (convention #28).
    // TWO classes, so this beats .pix-stx-btn's `flex:1 1 auto; min-width:86px`
    // no matter where it sits in the sheet. With a single-class selector the
    // later .pix-stx-btn rule won on equal specificity and the gear grew to
    // 380px and wrapped to its own line - MEASURED, and it looked like a flex
    // bug rather than a specificity one.
    ".pix-stx-btn.pix-stx-gear{flex:0 0 auto;min-width:0;width:30px;padding:5px 0;" +
      "display:inline-flex;align-items:center;justify-content:center;}",
    ".pix-stx-btn.pix-stx-gear::before{content:\"\";display:block;width:14px;height:14px;" +
      "background:currentColor;" +
      "-webkit-mask:url(\"" + gear + "\") center/contain no-repeat;" +
      "mask:url(\"" + gear + "\") center/contain no-repeat;}",

    // ── the collected text box: the star, takes all free height ──
    // flex-basis 0 makes it a pure "absorb the remainder" row, and the explicit
    // min-height is the floor the Nodes 2.0 resize handle measures against.
    ".pix-stx-box{flex:1 1 0;min-height:54px;width:100%;box-sizing:border-box;" +
      "background:#1d1d1d;color:#e0e0e0;border:1px solid #333;border-radius:4px;" +
      "padding:6px 8px;font:12px monospace;line-height:1.45;resize:none;outline:none;" +
      "white-space:pre-wrap;overflow-wrap:break-word;}",
    ".pix-stx-box:focus{border-color:" + ACC + ";}",
    ".pix-stx-box::placeholder{color:#6a6a6a;}",

    // ── footer: count on the left, file + state on the right ──
    ".pix-stx-foot{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;" +
      "gap:8px;font-size:11px;color:#9a9a9a;min-height:14px;}",
    ".pix-stx-count{flex:0 0 auto;white-space:nowrap;}",
    ".pix-stx-file{flex:1 1 auto;text-align:right;overflow:hidden;text-overflow:ellipsis;" +
      "white-space:nowrap;color:#9a9a9a;}",
    ".pix-stx-file.saved{color:#3ec371;}",
    ".pix-stx-file.dirty{color:" + ACC + ";}",
    ".pix-stx-file.bad{color:#e06c5a;}",

    // ── button row ──
    // flex-wrap because the Nodes 2.0 body is narrower than legacy, so a row
    // sized for legacy would spill its last button out of the right edge.
    ".pix-stx-btns{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:5px;user-select:none;}",
    ".pix-stx-btn{flex:1 1 auto;min-width:86px;box-sizing:border-box;text-align:center;" +
      "font-size:11px;color:rgba(255,255,255,.75);background:rgba(255,255,255,.05);" +
      "border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:5px 10px;" +
      "cursor:pointer;user-select:none;font-family:inherit;}",
    ".pix-stx-btn:hover{background:" + ACC + ";border-color:" + ACC + ";color:#fff;}",
    ".pix-stx-btn.primary{background:" + ACC + ";border-color:" + ACC + ";color:#fff;}",
    ".pix-stx-btn.primary:hover{filter:brightness(1.12);}",
    ".pix-stx-btn:disabled{opacity:.42;cursor:default;}",
    ".pix-stx-btn:disabled:hover{background:rgba(255,255,255,.05);" +
      "border-color:rgba(255,255,255,.14);color:rgba(255,255,255,.75);}",
    // Higher specificity than :hover so the green wins while the cursor is
    // still resting on the button that was just clicked (convention #2).
    ".pix-stx-btn.is-flashing,.pix-stx-btn.is-flashing:hover{background:#3ec371;" +
      "border-color:#3ec371;color:#fff;}",

    // ── the floating settings panel ──
    // Same palette and metrics as Save Image / Save Video / Run Timer, so the
    // pack's panels are one control surface rather than five lookalikes. The
    // placement, follow loop and drag come from js/shared/node_panel.mjs.
    ".pix-stx-panel{position:fixed;z-index:10010;width:320px;max-width:94vw;background:#1a1a1a;" +
      "border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);" +
      "font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;max-height:88vh;" +
      "display:flex;flex-direction:column;}",
    ".pix-stx-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;" +
      "border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-stx-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;" +
      "padding:2px 7px;border-radius:4px;}",
    ".pix-stx-px:hover{color:#fff;}",
    ".pix-stx-pbody{padding:12px;display:flex;flex-direction:column;gap:12px;color:#ddd;" +
      "overflow-y:auto;min-height:0;}",
    ".pix-stx-prow{display:flex;align-items:center;gap:9px;}",
    ".pix-stx-plab{font-size:12px;color:#ddd;}",
    ".pix-stx-psub{font-size:10px;color:#8f8f8f;margin-top:2px;line-height:1.4;}",
    ".pix-stx-field{flex:1;min-width:0;background:#1d1d1d;border:1px solid #444;border-radius:4px;" +
      "color:#e0e0e0;padding:5px 8px;font-size:12px;outline:none;box-sizing:border-box;" +
      "font-family:inherit;width:100%;}",
    ".pix-stx-field:focus{border-color:" + ACC + ";}",
    ".pix-stx-field.mono{font-family:Consolas,ui-monospace,monospace;}",
    ".pix-stx-pbtn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.16);color:#ccc;" +
      "border-radius:4px;padding:5px 10px;font-size:12px;cursor:pointer;white-space:nowrap;" +
      "flex:0 0 auto;font-family:inherit;user-select:none;}",
    ".pix-stx-pbtn:hover{background:" + ACC + ";border-color:" + ACC + ";color:#fff;}",
    ".pix-stx-bgrid{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}",
    ".pix-stx-bchip{flex:1 1 58px;background:#1d1d1d;border:1px solid #444;color:#aaa;" +
      "border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit;" +
      "user-select:none;}",
    ".pix-stx-bchip:hover{border-color:" + ACC + ";color:#ddd;}",
    ".pix-stx-bchip.on{background:" + ACC + ";border-color:" + ACC + ";color:#fff;}",
    ".pix-stx-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}",
    ".pix-stx-chip{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:#ccc;" +
      "border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer;font-family:inherit;" +
      "user-select:none;}",
    ".pix-stx-chip:hover{border-color:" + ACC + ";color:#eee;}",
    ".pix-stx-prev{background:#1d1d1d;border:1px solid #444;border-radius:4px;padding:6px 8px;margin-top:8px;}",
    ".pix-stx-prevlab{font-size:10px;color:#8f8f8f;margin-bottom:2px;}",
    ".pix-stx-prevpath{font-family:Consolas,ui-monospace,monospace;font-size:11px;color:#ffb59e;" +
      "word-break:break-all;line-height:1.45;}",
    ".pix-stx-prevpath.denied{color:#ffb020;}",
    ".pix-stx-qsl{flex:1;min-width:0;accent-color:" + ACC + ";}",
    ".pix-stx-qval{font-size:12px;color:" + ACC + ";min-width:92px;text-align:right;white-space:nowrap;}",
    ".pix-stx-sw{width:30px;height:16px;border-radius:8px;background:#555;position:relative;" +
      "display:inline-block;cursor:pointer;flex:0 0 auto;transition:background .15s;}",
    ".pix-stx-sw::after{content:\"\";position:absolute;top:2px;left:2px;width:12px;height:12px;" +
      "border-radius:50%;background:#ccc;transition:left .15s;}",
    ".pix-stx-sw.on{background:" + ACC + ";}",
    ".pix-stx-sw.on::after{left:16px;background:#fff;}",
  ].join("");
  document.head.appendChild(s);
}

export function buildRoot() {
  const root = el("div", "pix-stx-root");
  const inner = el("div", "pix-stx-inner");
  root.appendChild(inner);

  const box = el("textarea", "pix-stx-box");
  box.spellcheck = false;
  box.placeholder =
    "Nothing collected yet.\n\nWire some text in and run: each run adds an entry here.";
  box.title = "Everything collected so far. Edit or delete freely, then press Save .txt.";
  inner.appendChild(box);

  const foot = el("div", "pix-stx-foot");
  const count = el("span", "pix-stx-count", "0 entries");
  const file = el("span", "pix-stx-file", "");
  foot.appendChild(count);
  foot.appendChild(file);
  inner.appendChild(foot);

  const btns = el("div", "pix-stx-btns");
  const copyBtn = el("button", "pix-stx-btn", "Copy all");
  copyBtn.type = "button";
  copyBtn.title = "Copy everything in the box to the clipboard.";
  const saveBtn = el("button", "pix-stx-btn primary", "Save .txt");
  saveBtn.type = "button";
  saveBtn.title = "Write the box to its .txt file now. Use this after editing.";
  const clearBtn = el("button", "pix-stx-btn", "Clear");
  clearBtn.type = "button";
  clearBtn.title =
    "Empty the box and start a NEW file. The file already written is kept, not erased.";
  // A plain text label, like Save Image and Save Video: the pack already has a
  // "Folder" button and this is the same action, so it says the same word.
  const folderBtn = el("button", "pix-stx-btn", "Folder");
  folderBtn.type = "button";
  folderBtn.title =
    "Open the save folder in your file explorer. The window may open behind the browser.";
  // Shares .pix-stx-btn so it matches the row, plus .pix-stx-gear for the icon
  // and the narrow width (it opts out of the 86px equal-width rule).
  const gear = el("button", "pix-stx-btn pix-stx-gear");
  gear.type = "button";
  gear.title = "Save Text settings: folder, file name, and how entries are added.";
  gear.setAttribute("aria-label", "Save Text settings");

  btns.appendChild(copyBtn);
  btns.appendChild(saveBtn);
  btns.appendChild(clearBtn);
  btns.appendChild(folderBtn);
  btns.appendChild(gear);
  inner.appendChild(btns);

  return { root, inner, gear, box, foot, count, file, btns,
           copyBtn, saveBtn, clearBtn, folderBtn };
}
