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

  `;
  document.head.appendChild(s);
}
