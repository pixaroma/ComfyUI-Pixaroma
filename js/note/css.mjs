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
.pix-note-body hr { border: none; border-top: 1px solid #333; margin: 10px 0; }
.pix-note-body ul, .pix-note-body ol { margin: 4px 0 4px 20px; padding: 0; }
.pix-note-body li { margin: 2px 0; }
.pix-note-body code {
  background: #2a2a2a; padding: 1px 5px; border-radius: 3px;
  font-family: "Consolas", "Courier New", monospace; font-size: 12px;
}
.pix-note-body pre {
  background: #1a1a1a; border: 1px solid #333; border-radius: 4px;
  padding: 8px 10px; overflow-x: auto; margin: 8px 0;
  font-family: "Consolas", "Courier New", monospace; font-size: 12px;
}
.pix-note-body pre code { background: transparent; padding: 0; }
.pix-note-body a { color: ${BRAND}; text-decoration: underline; cursor: pointer; }
.pix-note-body a:hover { text-decoration: none; }
.pix-note-body label { display: inline-flex; align-items: center; gap: 6px; cursor: default; }

/* Placeholder shown when content empty */
.pix-note-placeholder {
  color: #666; font-style: italic; pointer-events: none;
  text-decoration: none !important;
}

/* Pixaroma block: Download pill */
.pix-note-body .pix-note-dl {
  display: inline-block;
  padding: 5px 12px;
  margin: 2px 0;
  background: linear-gradient(180deg, var(--pix-note-accent, ${BRAND}), color-mix(in srgb, var(--pix-note-accent, ${BRAND}) 70%, black));
  color: #fff;
  border-radius: 5px;
  text-decoration: none !important;
  font-weight: 600;
  font-size: 12px;
  box-shadow: 0 2px 6px rgba(0,0,0,.3);
  cursor: pointer;
}
.pix-note-body .pix-note-dl:hover { filter: brightness(1.08); }

/* Pixaroma block: YouTube line */
.pix-note-body .pix-note-yt {
  color: #ff3838;
  font-weight: 600;
  text-decoration: underline;
}
.pix-note-body .pix-note-yt::before { content: "🎥 "; }

/* Pixaroma block: Discord line */
.pix-note-body .pix-note-discord {
  color: #5865f2;
  font-weight: 600;
  text-decoration: underline;
}
.pix-note-body .pix-note-discord::before { content: "💬 "; }

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
.pix-note-editarea h1 { font-size: 22px; font-weight: 700; margin: 4px 0 8px; color: #fff; }
.pix-note-editarea h2 { font-size: 17px; font-weight: 700; margin: 10px 0 6px; color: #fff; }
.pix-note-editarea h3 { font-size: 15px; font-weight: 700; margin: 8px 0 4px; color: #fff; }
.pix-note-editarea hr { border:none; border-top: 1px solid #333; margin: 10px 0; }
.pix-note-editarea a  { color: ${BRAND}; text-decoration: underline; }
.pix-note-editarea code { background: #2a2a2a; padding: 1px 5px; border-radius: 3px; font-family: "Consolas", monospace; font-size: 12px; }
.pix-note-editarea pre  { background: #1a1a1a; border:1px solid #333; border-radius: 4px; padding: 8px 10px; font-family: "Consolas", monospace; font-size: 12px; }
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
  min-width: 280px; max-width: 380px;
  background: #1e1e1e;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  padding: 18px 20px 14px;
  box-shadow: 0 12px 40px rgba(0,0,0,.6);
}
.pix-note-confirm-title {
  font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 6px;
}
.pix-note-confirm-text {
  font-size: 12px; color: #bbb; margin-bottom: 14px; line-height: 1.45;
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
.pix-note-tbtn.italic { font-style: italic; font-family: Georgia, serif; }
.pix-note-tbtn.under { text-decoration: underline; }
.pix-note-tbtn.strike { text-decoration: line-through; }
.pix-note-tsep { width: 1px; height: 18px; background: #3a3a3a; margin: 0 4px; }
.pix-note-tgroup { display: inline-flex; gap: 3px; }

  `;
  document.head.appendChild(s);
}
