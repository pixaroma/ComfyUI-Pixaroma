// Reference Images Pixaroma - one stylesheet for the node face, its popup and
// its settings panel.
//
// The CSS below is a JS template literal: NO backticks and NO double-slash
// comments inside it (a backtick ends the literal and blanks every Pixaroma
// node; a double-slash line silently eats the next rule - convention #35).
// Use /* */ comments only, and run node --check after editing.

import { pixAsset } from "../shared/api_url.mjs";
import { ACC, ACC_HOVER } from "../shared/node_settings.mjs";
import { textSize } from "../shared/text_size.mjs";
import { EMPTY_H, GAP, GUTTER, STRIP_H, TEXT_MIN } from "./layout.mjs";

const CSS_ID = "pix-rfi-css";

export function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const gear = pixAsset("icons/note/gear.svg");
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = `
/* the DOM widget root fills its row and never sizes itself (nodes2-preview-fill #4) */
.pix-rfi-root{position:relative;flex:1 1 0;min-height:0;box-sizing:border-box;pointer-events:none;}
/* the output dots sit in the gutter right of the bar and the pictures (layout.mjs):
   only the face's own parts take the pointer, the gaps let a wire start from a dot */
.dom-widget:has(> .pix-rfi-root){pointer-events:none !important;}
/* the layout lives on an INNER layer: ComfyUI sets the root's display itself */
.pix-rfi-inner{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;padding:6px 8px 8px;
  box-sizing:border-box;overflow:hidden;font:11px "Segoe UI",system-ui,sans-serif;color:#ddd;pointer-events:none;}
.pix-rfi-inner > *{flex-shrink:0;pointer-events:auto;}
.pix-rfi-bar{display:flex;align-items:center;gap:6px;min-width:0;height:26px;margin-right:${GUTTER}px;}
.pix-rfi-grow{flex:1 1 auto;min-width:4px;}
.pix-rfi-model{height:26px;display:inline-flex;align-items:center;gap:6px;padding:0 8px;border-radius:4px;
  background:#1d1d1d;border:1px solid #444;color:#aaa;cursor:pointer;font:11px "Segoe UI",sans-serif;min-width:0;
  max-width:100%;box-sizing:border-box;user-select:none;}
.pix-rfi-model:hover{border-color:${ACC};color:#ddd;}
.pix-rfi-model b{color:#e6e6e6;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pix-rfi-model .k{color:#8f8f8f;white-space:nowrap;}
.pix-rfi-model .v{font-size:9px;color:#8f8f8f;}
.pix-rfi-count{color:#8f8f8f;white-space:nowrap;user-select:none;}
.pix-rfi-btn{width:28px;height:26px;padding:0;border-radius:4px;background:#1d1d1d;border:1px solid #444;color:#aaa;
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;box-sizing:border-box;}
.pix-rfi-btn:hover{border-color:${ACC};color:#ddd;}
.pix-rfi-gear::before{content:"";display:block;width:15px;height:15px;background:currentColor;
  -webkit-mask:url("${gear}") center/contain no-repeat;mask:url("${gear}") center/contain no-repeat;}

/* the picture grid: exactly its rows (layout.mjs gridHeight is the same sum), up to 4 a row,
   the column count set from its width by ui.mjs */
.pix-rfi-grid{flex:0 0 auto;overflow:hidden;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  gap:${GAP}px;align-content:start;margin-right:${GUTTER}px;}
.pix-rfi-grid.drop{outline:2px dashed ${ACC};outline-offset:-2px;border-radius:6px;}
.pix-rfi-card{display:flex;flex-direction:column;gap:4px;min-width:0;}
.pix-rfi-thumb{position:relative;width:100%;aspect-ratio:1/1;border-radius:6px;overflow:hidden;background:#151515;
  border:1px solid #2c2c2c;cursor:pointer;box-sizing:border-box;}
.pix-rfi-thumb:hover{border-color:${ACC};}
.pix-rfi-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;
  pointer-events:none;user-select:none;}
.pix-rfi-thumb .miss{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  text-align:center;padding:8px;color:#ffd27a;font-size:10px;line-height:1.35;}
.pix-rfi-badge{position:absolute;left:5px;top:5px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;
  background:${ACC};color:#fff;font:700 11px "Segoe UI",sans-serif;display:flex;align-items:center;
  justify-content:center;box-sizing:border-box;cursor:pointer;border:none;box-shadow:0 1px 3px rgba(0,0,0,.5);}
.pix-rfi-badge:hover{background:${ACC_HOVER};}
.pix-rfi-x,.pix-rfi-mv{position:absolute;width:24px;height:24px;border-radius:4px;border:none;padding:0;
  background:rgba(0,0,0,.62);color:#eee;font:13px "Segoe UI",sans-serif;line-height:24px;cursor:pointer;
  opacity:0;transition:opacity .12s;display:flex;align-items:center;justify-content:center;}
.pix-rfi-x{right:4px;top:4px;font-size:15px;}
.pix-rfi-mv.l{left:4px;bottom:4px;}
.pix-rfi-mv.r{right:4px;bottom:4px;}
.pix-rfi-thumb:hover .pix-rfi-x,.pix-rfi-thumb:hover .pix-rfi-mv,
.pix-rfi-card:focus-within .pix-rfi-x,.pix-rfi-card:focus-within .pix-rfi-mv{opacity:1;}
.pix-rfi-x:hover{background:#c0392b;color:#fff;}
.pix-rfi-mv:hover{background:${ACC};color:#fff;}
.pix-rfi-mv:disabled{display:none;}
.pix-rfi-role{height:22px;display:flex;align-items:center;gap:4px;padding:0 6px;border-radius:4px;background:#1d1d1d;
  border:1px solid #444;color:#ccc;cursor:pointer;font:11px "Segoe UI",sans-serif;box-sizing:border-box;width:100%;
  min-width:0;user-select:none;}
.pix-rfi-role:hover{border-color:${ACC};color:#fff;}
.pix-rfi-role span{flex:1 1 auto;min-width:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pix-rfi-role i{font-style:normal;font-size:8px;color:#8f8f8f;flex:0 0 auto;}
.pix-rfi-name{height:22px;width:100%;box-sizing:border-box;background:#1d1d1d;color:#e0e0e0;border:1px solid #333;
  border-radius:4px;padding:2px 6px;font:11px "Segoe UI",sans-serif;outline:none;min-width:0;}
.pix-rfi-name:focus{border-color:${ACC};}
.pix-rfi-name::placeholder,.pix-rfi-text::placeholder{color:#707070;}

/* the Add tile: a square like a picture, or a wide drop zone while the node is empty */
.pix-rfi-add{width:100%;aspect-ratio:1/1;border-radius:6px;border:1px dashed rgba(255,255,255,.22);
  background:rgba(255,255,255,.03);color:#aaa;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:4px;cursor:pointer;box-sizing:border-box;font:11px "Segoe UI",sans-serif;padding:6px;
  text-align:center;user-select:none;}
.pix-rfi-add:hover{border-color:${ACC};color:#ddd;background:rgba(255,255,255,.05);}
.pix-rfi-add .plus{font-size:22px;line-height:1;color:${ACC};}
.pix-rfi-add .sub{font-size:10px;color:#8a8a8a;line-height:1.35;}
/* an empty node: one wide drop zone; under a full row: a slim strip (no empty row) */
.pix-rfi-add.wide{grid-column:1 / -1;aspect-ratio:auto;height:${EMPTY_H}px;}
.pix-rfi-add.strip{grid-column:1 / -1;aspect-ratio:auto;height:${STRIP_H}px;flex-direction:row;gap:6px;padding:0 8px;}
.pix-rfi-add.strip .plus{font-size:16px;}
.pix-rfi-add.busy{cursor:default;color:#8f8f8f;}

.pix-rfi-head{display:flex;align-items:center;gap:6px;height:16px;color:#9a9a9a;font-size:11px;user-select:none;}
.pix-rfi-head .t{color:#bdbdbd;font-weight:600;}
.pix-rfi-head .h{color:#7d7d7d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
/* "Your prompt" takes the node's extra height, and gives up to 24 px when short: a node sized in Classic
   opens in Nodes 2.0, whose frame needs 20 px more, without the bottom cut off */
.pix-rfi-text{height:auto;min-height:40px;flex:1 1 ${TEXT_MIN}px !important;resize:none;box-sizing:border-box;background:#1d1d1d;color:#e0e0e0;
  border:1px solid #333;border-radius:4px;padding:6px 8px;font:12px monospace;font-size:${textSize(12)};
  line-height:1.35;outline:none;width:100%;}
.pix-rfi-text:focus{border-color:${ACC};}
.pix-rfi-text:disabled{opacity:.55;cursor:default;}
.pix-rfi-warn{height:14px;line-height:14px;color:#ffd27a;font-size:10px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;user-select:none;}
.pix-rfi-sent{height:58px;flex:0 0 58px;box-sizing:border-box;background:#2d2d2d;color:#d8d8d8;
  border:1px solid #3a3a3a;border-radius:4px;padding:6px 8px;font:12px monospace;font-size:${textSize(12)};
  line-height:1.35;overflow-y:auto;white-space:pre-wrap;word-break:break-word;user-select:text;cursor:text;}
.pix-rfi-sent.empty{color:#7d7d7d;}
.pix-rfi-copy{height:20px;min-width:58px;padding:0 10px;border-radius:4px;background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.15);color:#ccc;font:11px "Segoe UI",sans-serif;cursor:pointer;
  box-sizing:border-box;user-select:none;flex:0 0 auto;}
.pix-rfi-copy:hover{background:${ACC};border-color:${ACC};color:#fff;}
.pix-rfi-copy.is-flashing{background:#3ec371;border-color:#3ec371;color:#fff;}

/* ---- the dropdown list (on document.body, follows the canvas zoom) ---- */
.pix-rfi-pop{position:fixed;z-index:10900;background:#181818;border:1px solid #555;border-radius:6px;
  box-shadow:0 8px 24px rgba(0,0,0,.55);max-height:340px;overflow:auto;font-family:"Segoe UI",sans-serif;
  padding:.25em 0;}
.pix-rfi-pop .it{padding:.42em .85em;cursor:pointer;color:#ddd;white-space:nowrap;border-bottom:1px solid #222;}
.pix-rfi-pop .it:last-child{border-bottom:none;}
.pix-rfi-pop .it:hover{background:#2a2a2a;}
.pix-rfi-pop .it.on{color:${ACC};font-weight:600;}
.pix-rfi-pop .it small{display:block;color:#8a8a8a;font-size:.85em;font-weight:400;margin-top:1px;}

/* ---- the settings panel (copied from Save Video's) ---- */
.pix-rfi-panel{position:fixed;z-index:10010;width:340px;max-width:94vw;background:#1a1a1a;border:1px solid #444;
  border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden;
  max-height:88vh;display:flex;flex-direction:column;}
.pix-rfi-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;
  border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}
.pix-rfi-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}
.pix-rfi-px:hover{color:#fff;}
.pix-rfi-pbody{padding:12px;display:flex;flex-direction:column;gap:14px;color:#ddd;overflow-y:auto;min-height:0;}
.pix-rfi-plab{font-size:12px;color:#ddd;}
.pix-rfi-psub{font-size:10px;color:#8f8f8f;margin-top:2px;line-height:1.4;}
.pix-rfi-bgrid{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}
.pix-rfi-bchip{flex:1 1 58px;background:#1d1d1d;border:1px solid #444;color:#aaa;border-radius:4px;padding:4px 8px;
  font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}
.pix-rfi-bchip:hover{border-color:${ACC};color:#ddd;}
.pix-rfi-bchip.on{background:${ACC};border-color:${ACC};color:#fff;}
.pix-rfi-pin{height:24px;width:100%;box-sizing:border-box;background:#1d1d1d;color:#e0e0e0;border:1px solid #333;
  border-radius:4px;padding:3px 7px;font:12px monospace;outline:none;margin-top:6px;}
.pix-rfi-pin:focus{border-color:${ACC};}
.pix-rfi-prole{display:grid;grid-template-columns:78px minmax(0,1fr);align-items:center;gap:6px;margin-top:6px;}
.pix-rfi-prole .pix-rfi-pin{margin-top:0;}
.pix-rfi-prole label{font-size:11px;color:#bbb;}
.pix-rfi-reset{margin-top:8px;height:24px;padding:0 12px;border-radius:4px;background:transparent;border:1px solid #444;
  color:#aaa;font:11px "Segoe UI",sans-serif;cursor:pointer;}
.pix-rfi-reset:hover{border-color:${ACC};color:#ddd;}
`;
  document.head.appendChild(s);
}
