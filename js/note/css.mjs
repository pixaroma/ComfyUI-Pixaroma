import { BRAND } from "../shared/index.mjs";

let _injected = false;

export function injectCSS() {
  if (_injected) return;
  _injected = true;
  const s = document.createElement("style");
  s.setAttribute("data-pixaroma-note", "1");
  s.textContent = `
/* ── On-canvas node body ───────────────────────────────────── */
.pix-note-body {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: #e4e4e4;
  word-wrap: break-word;
  user-select: text;
  text-decoration: none !important;
  text-shadow: none;
}
.pix-note-body::-webkit-scrollbar { width: 6px; }
.pix-note-body::-webkit-scrollbar-track { background: transparent; }
.pix-note-body::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
.pix-note-body::-webkit-scrollbar-thumb:hover { background: ${BRAND}; }
.pix-note-body h1 { font-size: 20px; font-weight: 700; margin: 4px 0 8px; color: #fff; }
.pix-note-body h2 { font-size: 16px; font-weight: 700; margin: 10px 0 6px; color: #fff; }
.pix-note-body h3 { font-size: 14px; font-weight: 700; margin: 8px 0 4px; color: #fff; }
.pix-note-body p  { margin: 6px 0; }
.pix-note-body hr { border: none; border-top: 1px solid #555; margin: 10px 0; }
.pix-note-body ul, .pix-note-body ol { margin: 4px 0 4px 20px; padding: 0; }
.pix-note-body li { margin: 2px 0; }
.pix-note-body code {
  background: #2a2a2a; padding: 0 5px; border-radius: 3px;
  font-family: "Consolas", "Courier New", monospace; font-size: 0.92em;
}
.pix-note-body pre {
  position: relative;
  background: #1a1a1a; border: 1px solid #333; border-radius: 4px;
  padding: 8px 10px; overflow-x: auto; margin: 8px 0;
  font-family: "Consolas", "Courier New", monospace; font-size: 12px;
}
.pix-note-body pre code { background: transparent; padding: 0; }
/* Copy-to-clipboard button revealed on pre hover */
.pix-note-copybtn {
  position: absolute; top: 4px; right: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  background: rgba(0,0,0,0.55); border: 1px solid #333; border-radius: 3px;
  cursor: pointer; opacity: 0; transition: opacity 120ms, background 120ms;
}
.pix-note-body pre:hover .pix-note-copybtn { opacity: 0.9; }
.pix-note-copybtn:hover { background: ${BRAND}; border-color: ${BRAND}; opacity: 1; }
.pix-note-copybtn.copied { background: #5bd45b; border-color: #5bd45b; opacity: 1; }
.pix-note-copybtn img {
  width: 12px; height: 12px; pointer-events: none;
  filter: brightness(0) invert(1);
}
.pix-note-body a { color: ${BRAND}; text-decoration: underline; cursor: pointer; }
.pix-note-body a:hover { text-decoration: none; }
.pix-note-body label { display: inline-flex; align-items: center; gap: 6px; cursor: default; }

/* Placeholder shown when content empty */
.pix-note-placeholder {
  color: #666; font-style: italic; pointer-events: none;
  text-decoration: none !important;
}

/* Pixaroma block pills — flat style matching the Edit button. Rules
   target both the on-canvas body AND the editor interior so the user
   sees the real pill while editing (WYSIWYG), not a plain link. */
.pix-note-body a.pix-note-dl,
.pix-note-body a.pix-note-yt,
.pix-note-body a.pix-note-discord,
.pix-note-editarea a.pix-note-dl,
.pix-note-editarea a.pix-note-yt,
.pix-note-editarea a.pix-note-discord {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin: 2px;
  color: #fff;
  border-radius: 4px;
  text-decoration: none !important;
  font-weight: 600;
  font-size: 11px;
  line-height: 1.2;
  box-shadow: 0 2px 6px rgba(0,0,0,.4);
  cursor: pointer;
  vertical-align: middle;
}
.pix-note-body a.pix-note-dl,
.pix-note-editarea a.pix-note-dl {
  background: var(--pix-note-accent, ${BRAND});
}
.pix-note-body a.pix-note-yt,
.pix-note-editarea a.pix-note-yt { background: #ff3838; }
.pix-note-body a.pix-note-discord,
.pix-note-editarea a.pix-note-discord { background: #5865f2; }
.pix-note-body a.pix-note-dl:hover,
.pix-note-body a.pix-note-yt:hover,
.pix-note-body a.pix-note-discord:hover,
.pix-note-editarea a.pix-note-dl:hover,
.pix-note-editarea a.pix-note-yt:hover,
.pix-note-editarea a.pix-note-discord:hover { filter: brightness(1.1); }

/* Block icons via SVG mask so they follow text colour (white on a
   coloured pill). One base rule for size + currentColor, then per-class
   rules for the mask image. */
.pix-note-body a.pix-note-dl::before,
.pix-note-body a.pix-note-yt::before,
.pix-note-body a.pix-note-discord::before,
.pix-note-editarea a.pix-note-dl::before,
.pix-note-editarea a.pix-note-yt::before,
.pix-note-editarea a.pix-note-discord::before {
  content: "";
  display: inline-block;
  width: 12px; height: 12px;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain;    mask-size: contain;
}
.pix-note-body a.pix-note-dl::before,
.pix-note-editarea a.pix-note-dl::before {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/download.svg);
          mask-image: url(/pixaroma/assets/icons/ui/download.svg);
}
.pix-note-body a.pix-note-yt::before,
.pix-note-editarea a.pix-note-yt::before {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/youtube.svg);
          mask-image: url(/pixaroma/assets/icons/ui/youtube.svg);
}
.pix-note-body a.pix-note-discord::before,
.pix-note-editarea a.pix-note-discord::before {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/discord.svg);
          mask-image: url(/pixaroma/assets/icons/ui/discord.svg);
}

/* Hover-reveal Edit button */
.pix-note-editbtn {
  position: absolute;
  top: 6px; right: 10px;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  background: ${BRAND};
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 10;
  box-shadow: 0 2px 6px rgba(0,0,0,.4);
}
.pix-note-editbtn-icon {
  width: 12px; height: 12px; pointer-events: none;
  /* SVG is rendered black by default; tint to white to match button text. */
  filter: brightness(0) invert(1);
}
.pix-note-wrap:hover .pix-note-editbtn { opacity: 0.95; }
.pix-note-editbtn:hover { opacity: 1 !important; filter: brightness(1.1); }

.pix-note-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

/* Toast for clipboard feedback */
.pix-note-toast {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  background: #222;
  border: 1px solid ${BRAND};
  color: #fff;
  padding: 8px 14px;
  border-radius: 5px;
  font-size: 13px;
  z-index: 100000;
  box-shadow: 0 4px 14px rgba(0,0,0,.5);
  pointer-events: none;
  opacity: 0;
  transition: opacity 180ms ease;
}
.pix-note-toast.show { opacity: 1; }

/* ── Editor overlay ───────────────────────────────────────── */
.pix-note-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.72);
  z-index: 99990; display: flex; align-items: center; justify-content: center;
  font-family: "Segoe UI", system-ui, sans-serif;
}
.pix-note-panel {
  background: #1b1b1b; border: 1px solid #333; border-radius: 8px;
  width: min(920px, 94vw); height: min(720px, 90vh);
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,.6);
  position: relative;
}
.pix-note-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: #252525; border-bottom: 1px solid #333;
  color: #eee;
}
.pix-note-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; }
.pix-note-title-logo { width: 18px; height: 18px; }
.pix-note-title-brand { color: ${BRAND}; }
.pix-note-close {
  background: none; border: none; color: #aaa; font-size: 22px; cursor: pointer;
  width: 28px; height: 28px; line-height: 1; border-radius: 4px;
}
.pix-note-close:hover { background: #333; color: #fff; }

.pix-note-main {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.pix-note-editarea {
  flex: 1; overflow-y: auto; padding: 14px 18px; color: #e4e4e4; font-size: 13px;
  line-height: 1.55; background: #151515; outline: none;
}
.pix-note-editarea:focus-visible { outline: 1px solid ${BRAND}; outline-offset: -2px; }
/* Consistent vertical spacing between blocks. The browser's default p margin
   (1em ≈ 16px) was way larger than its default div margin (0), which made
   old content and new Enter-pressed content look mismatched. */
.pix-note-editarea p, .pix-note-editarea div { margin: 0 0 6px 0; }
.pix-note-editarea p:last-child, .pix-note-editarea div:last-child { margin-bottom: 0; }
.pix-note-editarea h1 { font-size: 22px; font-weight: 700; margin: 4px 0 8px; color: #fff; }
.pix-note-editarea h2 { font-size: 17px; font-weight: 700; margin: 10px 0 6px; color: #fff; }
.pix-note-editarea h3 { font-size: 15px; font-weight: 700; margin: 8px 0 4px; color: #fff; }
.pix-note-editarea hr { border:none; border-top: 1px solid #555; margin: 10px 0; }

/* Code / Preview view toggle (right-aligned in toolbar) */
.pix-note-viewtoggle {
  margin-left: auto; display: inline-flex; background: #111;
  padding: 2px; border-radius: 4px; gap: 2px;
}
.pix-note-viewtoggle button {
  background: transparent; border: none; color: #888;
  padding: 3px 10px; font-size: 11px; font-weight: 600;
  border-radius: 3px; cursor: pointer;
}
.pix-note-viewtoggle button.active { background: ${BRAND}; color: #fff; }

.pix-note-codearea {
  flex: 1; background: #0d0d0d; color: #e0e0e0;
  font-family: "Consolas", "Courier New", monospace; font-size: 12.5px;
  padding: 12px 16px; border: none; outline: none;
  line-height: 1.5; resize: none; white-space: pre-wrap;
}
.pix-note-codearea:focus-visible { outline: 1px solid ${BRAND}; outline-offset: -2px; }

/* In-panel help overlay — covers the whole editor panel when the user
   clicks ? Help in the footer. */
.pix-note-help {
  position: absolute; inset: 0; background: rgba(0,0,0,.82); z-index: 10;
  overflow-y: auto; padding: 24px 36px; color: #ddd; font-size: 13px;
}
.pix-note-help h3 { color: #fff; margin: 0 0 8px; }
.pix-note-help p { margin: 4px 0; line-height: 1.6; }
.pix-note-help b { color: #fff; }
.pix-note-help a { color: ${BRAND}; }
.pix-note-help-close {
  position: absolute; top: 10px; right: 14px; background: none;
  color: #aaa; border: none; font-size: 22px; cursor: pointer;
}
.pix-note-help-close:hover { color: #fff; }
.pix-note-editarea a  { color: ${BRAND}; text-decoration: underline; }
.pix-note-editarea code { background: #2a2a2a; padding: 0 5px; border-radius: 3px; font-family: "Consolas", monospace; font-size: 0.92em; }
.pix-note-editarea pre  { background: #1a1a1a; border:1px solid #333; border-radius: 4px; padding: 8px 10px; font-family: "Consolas", monospace; font-size: 12px; }
/* Reset inline-code styling when nested inside <pre> — otherwise the
   editor shows the dark <pre> panel AND the inline <code> gray-per-word
   highlight, and <code>'s left padding only applies to the first line of
   multiline content (pushing "text1" right but leaving text2/3 flush). */
.pix-note-editarea pre code { background: transparent; padding: 0; font-size: inherit; }
.pix-note-editarea ul, .pix-note-editarea ol { margin: 4px 0 4px 20px; }

.pix-note-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 10px 14px; background: #202020; border-top: 1px solid #333;
}
.pix-note-btn {
  padding: 6px 14px; border-radius: 4px; font-size: 12px; font-weight: 600;
  border: 1px solid #333; background: #2a2a2a; color: #ddd; cursor: pointer;
}
.pix-note-btn:hover { background: #333; }
.pix-note-btn.primary { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
.pix-note-btn.primary:hover { filter: brightness(1.08); }
.pix-note-btn.ghost { background: transparent; }

/* ── Unsaved-changes confirm modal ───────────────────────── */
.pix-note-confirm-backdrop {
  position: absolute; inset: 0;
  background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 100010;
}
.pix-note-confirm-box {
  min-width: 360px; max-width: 460px;
  background: #1e1e1e;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  padding: 18px 22px 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,.6);
}
.pix-note-confirm-title {
  font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 6px;
}
.pix-note-confirm-text {
  font-size: 12px; color: #bbb; margin-bottom: 14px; line-height: 1.45;
  text-wrap: pretty;
}
.pix-note-confirm-actions {
  display: flex; justify-content: flex-end; gap: 8px;
}

/* ── Toolbar ──────────────────────────────────────────────── */
.pix-note-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 3px;
  padding: 6px 8px; background: #202020; border-bottom: 1px solid #333;
}
.pix-note-tbtn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 26px; height: 26px; padding: 0 7px;
  background: #2a2a2a; border: 1px solid transparent; border-radius: 3px;
  color: #ddd; font-size: 12px; font-weight: 600; cursor: pointer;
  user-select: none;
}
.pix-note-tbtn:hover { background: #333; border-color: #444; }
.pix-note-tbtn.active { background: ${BRAND}; color: #fff; border-color: ${BRAND}; }
.pix-note-tbtn.pix-note-tbtn-accent {
  background: ${BRAND}; color: #fff; border-color: ${BRAND};
}
.pix-note-tbtn.pix-note-tbtn-accent:hover { filter: brightness(1.1); background: ${BRAND}; }
.pix-note-tbtn-icon {
  width: 14px; height: 14px; pointer-events: none;
  filter: brightness(0) invert(1);
}
.pix-note-tbtn.italic { font-style: italic; font-family: Georgia, serif; }
.pix-note-tbtn.under { text-decoration: underline; }
.pix-note-tbtn.strike { text-decoration: line-through; }
.pix-note-tsep { width: 1px; height: 18px; background: #3a3a3a; margin: 0 4px; }
.pix-note-tgroup { display: inline-flex; gap: 3px; }
.pix-note-tspacer { flex: 1 1 auto; min-width: 8px; }

/* ── Color popover ───────────────────────────────────────── */
.pix-note-colorpop {
  position: absolute; background: #222; border: 1px solid #444; border-radius: 5px;
  padding: 8px; z-index: 100000; display: flex; flex-direction: column; gap: 6px;
  box-shadow: 0 6px 18px rgba(0,0,0,.5);
}
.pix-note-swatches { display: grid; grid-template-columns: repeat(7, 18px); gap: 4px; }
.pix-note-swatch {
  width: 18px; height: 18px; border-radius: 3px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.1);
}
.pix-note-swatch.active { outline: 2px solid ${BRAND}; outline-offset: 1px; }
.pix-note-colorrow { display: flex; gap: 4px; align-items: center; }
.pix-note-colorrow input[type="color"] { width: 26px; height: 22px; padding: 0; border: 1px solid #444; border-radius: 3px; background: #1a1a1a; cursor: pointer; }
.pix-note-colorrow input[type="text"] {
  flex: 1; width: 80px; background: #1a1a1a; border: 1px solid #444;
  color: #ddd; padding: 3px 6px; font-size: 11px; font-family: "Consolas", monospace;
  border-radius: 3px;
}
.pix-note-colorrow .clearbtn {
  background: repeating-conic-gradient(#888 0 25%, #444 0 50%) 50%/8px 8px;
  width: 22px; height: 22px; border: 1px solid #444; border-radius: 3px; cursor: pointer;
}

/* ── Insert-link dialog inputs ───────────────────────────── */
.pix-note-linklbl {
  font-size: 10.5px; color: #888; text-transform: uppercase;
  letter-spacing: 0.5px; margin: 6px 0 3px;
}
.pix-note-linkinput {
  width: 100%; box-sizing: border-box;
  background: #0f0f0f; border: 1px solid #333; border-radius: 3px;
  color: #ddd; font-size: 12px; padding: 6px 8px;
  font-family: "Consolas", monospace;
}
.pix-note-linkinput:focus { outline: 1px solid ${BRAND}; outline-offset: -1px; border-color: ${BRAND}; }
.pix-note-linkerr {
  color: #e25b5b; font-size: 11px; margin-top: 6px; min-height: 14px;
}
.pix-note-confirm-box.wide { min-width: 560px; max-width: 720px; }
.pix-note-codeinput {
  width: 100%; box-sizing: border-box;
  background: #0f0f0f; border: 1px solid #333; border-radius: 3px;
  color: #ddd; font-size: 12px; padding: 6px 8px;
  font-family: "Consolas", "Courier New", monospace;
  resize: vertical; min-height: 120px;
  white-space: pre; tab-size: 2;
}
.pix-note-codeinput:focus { outline: 1px solid ${BRAND}; outline-offset: -1px; border-color: ${BRAND}; }

/* ── Block edit dialog ───────────────────────────────────── */
.pix-note-blockdlg {
  position: fixed; background: #1b1b1b; border: 1px solid #444;
  border-radius: 6px; padding: 14px 16px; z-index: 100001;
  box-shadow: 0 10px 30px rgba(0,0,0,.6);
  min-width: 420px; max-width: 90vw;
  font-family: "Segoe UI", system-ui, sans-serif;
}
.pix-note-blockdlg h4 { margin: 0 0 10px; color: #fff; font-size: 14px; }
.pix-note-blockdlg .field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.pix-note-blockdlg label.lbl { font-size: 10.5px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
.pix-note-blockdlg input {
  background: #0f0f0f; border: 1px solid #333; border-radius: 3px;
  color: #ddd; font-size: 12px; padding: 5px 8px;
}
.pix-note-blockdlg input:focus { outline: 1px solid ${BRAND}; outline-offset: -1px; }
.pix-note-blockdlg .dlgfooter { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }

  `;
  document.head.appendChild(s);
}
