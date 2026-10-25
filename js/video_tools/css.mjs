// Video Tools Pixaroma - one stylesheet for the node face and its settings panel.
//
// The CSS below is a JS template literal: NO backticks and NO double-slash
// comments inside it (convention #35). Use /* */ comments only, and run
// node --check after editing.

import { pixAsset } from "../shared/api_url.mjs";
import { ACC } from "../shared/node_settings.mjs";
import { GUTTER_L } from "./layout.mjs";

const CSS_ID = "pix-vdt-css";

export function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const gear = pixAsset("icons/note/gear.svg");
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = `
.pix-vdt-root{position:relative;flex:1 1 0;min-height:0;box-sizing:border-box;pointer-events:none;}
/* the input dots (fps, v1, a1...) run down the left edge beside the face (layout.mjs): only the face's own
   parts take the pointer, so a wire can start from a dot in the gutter */
.dom-widget:has(> .pix-vdt-root){pointer-events:none !important;}
.pix-vdt-inner{position:absolute;inset:0;display:flex;flex-direction:column;gap:7px;padding:6px 8px 8px ${GUTTER_L}px;
  box-sizing:border-box;overflow:hidden;font:11px "Segoe UI",system-ui,sans-serif;color:#ddd;pointer-events:none;}
.pix-vdt-inner > *{flex-shrink:0;pointer-events:auto;}

/* the result: a still of the finished video, played on request */
/* a soft well, not a black box: a tall (phone) video leaves the sides calm */
.pix-vdt-stage{position:relative;flex:1 1 0 !important;min-height:60px;border-radius:6px;overflow:hidden;
  background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.08);}
.pix-vdt-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;
  user-select:none;pointer-events:none;}
.pix-vdt-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;
  padding:12px;color:#7d7d7d;font-size:11px;line-height:1.45;}
.pix-vdt-play{position:absolute;left:8px;bottom:8px;height:26px;padding:0 12px 0 10px;border-radius:4px;border:none;
  background:rgba(0,0,0,.62);color:#eee;font:11px "Segoe UI",sans-serif;cursor:pointer;display:none;
  align-items:center;gap:6px;}
.pix-vdt-play:hover{background:${ACC};color:#fff;}
.pix-vdt-stage.has .pix-vdt-play{display:inline-flex;}
.pix-vdt-gear{position:absolute;right:6px;top:6px;width:28px;height:26px;padding:0;border-radius:4px;
  background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.15);color:#ccc;display:inline-flex;align-items:center;
  justify-content:center;cursor:pointer;box-sizing:border-box;}
.pix-vdt-gear:hover{border-color:${ACC};color:#fff;}
.pix-vdt-gear::before{content:"";display:block;width:15px;height:15px;background:currentColor;
  -webkit-mask:url("${gear}") center/contain no-repeat;mask:url("${gear}") center/contain no-repeat;}

/* the timeline: one coloured block per clip, joins, loops and fades on it */
.pix-vdt-tl{position:relative;height:18px;border-radius:4px;background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.1);overflow:hidden;box-sizing:border-box;}
.pix-vdt-tl .seg{position:absolute;top:0;bottom:0;}
.pix-vdt-tl .cyc{position:absolute;top:0;bottom:0;}
.pix-vdt-tl .rep{opacity:.55;}
.pix-vdt-tl .sep{position:absolute;top:0;bottom:0;width:1px;background:rgba(0,0,0,.6);}
.pix-vdt-tl .hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7d7d7d;
  font-size:10px;}
.pix-vdt-inforow{display:flex;align-items:center;gap:8px;height:26px;}
.pix-vdt-info{flex:1 1 auto;min-width:0;height:14px;line-height:14px;color:#9a9a9a;font-size:10.5px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;user-select:none;}
.pix-vdt-fps{flex:0 0 auto;}
.pix-vdt-fps.wired{opacity:.55;}
.pix-vdt-fps.wired button{cursor:default;}
.pix-vdt-info b{color:#d6d6d6;font-weight:600;}

/* the clip rows */
.pix-vdt-clips{display:grid;grid-template-columns:22px 46px minmax(0,1fr) auto auto 28px;column-gap:6px;row-gap:4px;
  align-items:center;}
.pix-vdt-cut{display:inline-flex;align-items:center;gap:4px;}
.pix-vdt-cut small{color:#7d7d7d;font-size:10px;min-width:30px;}
/* a narrow node keeps the clip's own length readable: the cut seconds step aside
   (the clip line already says the kept seconds) */
.pix-vdt-clips{container-type:inline-size;}
@container (max-width: 470px){.pix-vdt-cut small{display:none;}}
.pix-vdt-clips .hd{color:#8a8a8a;font-size:10px;text-align:center;user-select:none;}
.pix-vdt-badge{width:20px;height:20px;border-radius:50%;font:700 11px "Segoe UI",sans-serif;display:flex;
  align-items:center;justify-content:center;color:#fff;user-select:none;}
.pix-vdt-th{width:46px;height:26px;border-radius:3px;background:#151515;border:1px solid #2c2c2c;overflow:hidden;
  box-sizing:border-box;}
.pix-vdt-th img{width:100%;height:100%;object-fit:cover;display:block;}
.pix-vdt-cinfo{color:#bdbdbd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.pix-vdt-cinfo.off{color:#6f6f6f;}
.pix-vdt-row-off .pix-vdt-badge,.pix-vdt-row-off .pix-vdt-step,.pix-vdt-row-off .pix-vdt-rev{opacity:.4;}

/* a number with - and + (one sunken field, borderless cells inside) */
.pix-vdt-step{display:inline-flex;align-items:stretch;height:26px;border-radius:4px;background:#1d1d1d;
  border:1px solid #444;box-sizing:border-box;overflow:hidden;}
.pix-vdt-step:focus-within{border-color:${ACC};}
.pix-vdt-step button{width:24px;border:none;background:transparent;color:#aaa;cursor:pointer;padding:0;
  font:13px "Segoe UI",sans-serif;line-height:1;}
.pix-vdt-step button:hover{background:rgba(255,255,255,.08);color:#fff;}
.pix-vdt-step input{width:30px;border:none;outline:none;background:transparent;color:#e0e0e0;text-align:center;
  font:11px "Segoe UI",sans-serif;padding:0;-moz-appearance:textfield;}
.pix-vdt-step input::-webkit-outer-spin-button,.pix-vdt-step input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
.pix-vdt-rev{width:28px;height:26px;border-radius:4px;background:#1d1d1d;border:1px solid #444;color:#aaa;cursor:pointer;
  padding:0;font:13px "Segoe UI",sans-serif;box-sizing:border-box;}
.pix-vdt-rev:hover{border-color:${ACC};color:#ddd;}
.pix-vdt-rev.on{background:${ACC};border-color:${ACC};color:#fff;}

/* Join / Loop / Fade rows */
.pix-vdt-sec{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;min-height:28px;}
.pix-vdt-sec.dim > :not(.pix-vdt-lab){opacity:.4;}
.pix-vdt-lab{width:34px;color:#bdbdbd;font-weight:600;user-select:none;flex:0 0 auto;}
.pix-vdt-seg{display:inline-flex;height:28px;border-radius:4px;background:rgba(0,0,0,.25);padding:2px;gap:2px;
  box-sizing:border-box;}
.pix-vdt-seg button{border:none;background:transparent;color:#aaa;border-radius:3px;padding:0 7px;cursor:pointer;
  font:11px "Segoe UI",sans-serif;white-space:nowrap;}
.pix-vdt-seg button:hover{background:rgba(255,255,255,.08);color:#ddd;}
.pix-vdt-seg button.on{background:${ACC};color:#fff;}
.pix-vdt-f{display:inline-flex;align-items:center;gap:5px;color:#9a9a9a;white-space:nowrap;}
/* a field that does not apply to the current choice is left out, not dimmed:
   a dimmed one still took the room and wrapped the row */
.pix-vdt-f.off{display:none;}
.pix-vdt-f small{color:#7d7d7d;font-size:10px;}
.pix-vdt-sw{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:#bbb;user-select:none;white-space:nowrap;min-height:24px;}
.pix-vdt-sw i{width:28px;height:16px;border-radius:8px;background:#555;position:relative;display:inline-block;
  transition:background .15s;}
.pix-vdt-sw i::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;
  background:#ccc;transition:left .15s;}
.pix-vdt-sw.on i{background:${ACC};}
.pix-vdt-sw.on i::after{left:14px;background:#fff;}

/* ---- the settings panel (copied from Save Video's) ---- */
.pix-vdt-panel{position:fixed;z-index:10010;width:320px;max-width:94vw;background:#1a1a1a;border:1px solid #444;
  border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden;
  max-height:88vh;display:flex;flex-direction:column;}
.pix-vdt-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;
  border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}
.pix-vdt-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}
.pix-vdt-px:hover{color:#fff;}
.pix-vdt-pbody{padding:12px;display:flex;flex-direction:column;gap:14px;color:#ddd;overflow-y:auto;min-height:0;}
.pix-vdt-plab{font-size:12px;color:#ddd;}
.pix-vdt-psub{font-size:10px;color:#8f8f8f;margin-top:2px;line-height:1.4;}
.pix-vdt-bgrid{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}
.pix-vdt-bchip{flex:1 1 58px;background:#1d1d1d;border:1px solid #444;color:#aaa;border-radius:4px;padding:4px 8px;
  font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}
.pix-vdt-bchip:hover{border-color:${ACC};color:#ddd;}
.pix-vdt-bchip.on{background:${ACC};border-color:${ACC};color:#fff;}
.pix-vdt-prow{display:flex;align-items:center;gap:9px;margin-top:7px;}
.pix-vdt-qsl{flex:1;min-width:0;accent-color:${ACC};}
.pix-vdt-qval{font-size:12px;color:${ACC};min-width:44px;text-align:right;}
`;
  document.head.appendChild(s);
}
