// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Shared — Label Editor CSS Injection                ║
// ╚═══════════════════════════════════════════════════════════════╝

let _labelCssInjected = false;
export function injectLabelCSS() {
  if (_labelCssInjected) return;
  _labelCssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
.pix-lbl-body {
    max-height: 400px; overflow-y: auto; padding-right: 8px;
}
.pix-lbl-body::-webkit-scrollbar { width: 6px; }
.pix-lbl-body::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); border-radius: 10px; }
.pix-lbl-body::-webkit-scrollbar-thumb { background: #555; border-radius: 10px; }
.pix-lbl-body::-webkit-scrollbar-thumb:hover { background: #888; }
.pix-lbl-body { scrollbar-width: thin; scrollbar-color: #555 rgba(0,0,0,0.1); }
.pix-lbl-overlay {
    position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', system-ui, sans-serif;
}
.pix-lbl-panel {
    background: #171718; border: 1px solid #333; border-radius: 10px;
    width: 660px; max-height: 90vh; overflow-y: auto;
    box-shadow: 0 12px 40px rgba(0,0,0,0.6); position: relative;
}
.pix-lbl-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid #2a2a2a;
}
.pix-lbl-header span { color: #fff; font-size: 15px; font-weight: 600; }
.pix-lbl-close {
    background: none; border: none; color: #666; font-size: 20px;
    cursor: pointer; padding: 0 4px; line-height: 1;
}
.pix-lbl-close:hover { color: #fff; }
.pix-lbl-body { padding: 16px 18px; }
.pix-lbl-field { margin-bottom: 14px; }
.pix-lbl-field > .pix-lbl-lbl {
    display: block; color: #777; font-size: 10px; margin-bottom: 5px;
    text-transform: uppercase; letter-spacing: 0.6px;
}
.pix-lbl-field textarea {
    width: 100%; box-sizing: border-box; background: #222; border: 1px solid #333;
    border-radius: 5px; color: #ddd; padding: 8px 10px; font-size: 13px;
    font-family: inherit; outline: none; resize: vertical; min-height: 56px;
}
.pix-lbl-field textarea:focus { border-color: #f66744; }
.pix-lbl-preview {
    margin-bottom: 14px; background: #111; border-radius: 6px; padding: 12px;
    min-height: 36px; display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.pix-lbl-preview canvas { max-width: 100%; height: auto; }
.pix-lbl-btns { display: flex; gap: 4px; flex-wrap: wrap; }
.pix-lbl-btn {
    padding: 5px 12px; border: 1px solid #444; border-radius: 4px;
    background: #2a2c2e; color: #999; font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.pix-lbl-btn:hover { border-color: #666; color: #ccc; }
.pix-lbl-btn.active { background: #f66744; border-color: #f66744; color: #fff; }
.pix-lbl-bold { font-weight: bold; min-width: 32px; text-align: center; }
.pix-lbl-range-wrap { display: flex; align-items: center; gap: 8px; }
.pix-lbl-range-wrap input[type="range"] { flex: 1; accent-color: #f66744; }
.pix-lbl-range-wrap .pix-lbl-val { color: #999; font-size: 12px; min-width: 32px; text-align: right; }
.pix-lbl-row { display: flex; gap: 12px; align-items: flex-end; }
.pix-lbl-row > .pix-lbl-field { flex: 1; margin-bottom: 0; }
.pix-lbl-swatches { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.pix-lbl-swatch {
    width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
    border: 2px solid transparent; transition: border-color 0.15s; box-sizing: border-box;
}
.pix-lbl-swatch:hover { border-color: #888; }
.pix-lbl-swatch.active { border-color: #fff; }
.pix-lbl-swatch-transp {
    width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
    border: 2px solid transparent; box-sizing: border-box;
    background: repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 50%/10px 10px;
}
.pix-lbl-swatch-transp:hover { border-color: #888; }
.pix-lbl-swatch-transp.active { border-color: #fff; }
.pix-lbl-color-row { display: flex; align-items: center; gap: 6px; }
.pix-lbl-color-row input[type="color"] {
    width: 30px; height: 26px; padding: 0; border: 1px solid #444;
    border-radius: 4px; background: #222; cursor: pointer;
}
.pix-lbl-color-row .pix-lbl-hex {
    width: 76px; background: #222; border: 1px solid #333; border-radius: 4px;
    color: #ddd; padding: 4px 6px; font-size: 11px; font-family: monospace; outline: none;
}
.pix-lbl-color-row .pix-lbl-hex:focus { border-color: #f66744; }
.pix-lbl-footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 18px; border-top: 1px solid #2a2a2a;
}
.pix-lbl-footer button {
    padding: 8px 20px; border: none; border-radius: 5px;
    font-size: 13px; cursor: pointer; font-weight: 500;
}
.pix-lbl-btn-cancel { background: #2a2a2a; color: #ccc; }
.pix-lbl-btn-cancel:hover { background: #363636; }
.pix-lbl-btn-save { background: #f66744; color: #fff; }
.pix-lbl-btn-save:hover { opacity: 0.9; }
.pix-lbl-align-icon { display: flex; flex-direction: column; gap: 2px; width: 14px; align-items: flex-start; }
.pix-lbl-align-icon span { display: block; height: 2px; background: currentColor; border-radius: 1px; }
.pix-lbl-align-left .pix-lbl-align-icon span:nth-child(1) { width: 14px; }
.pix-lbl-align-left .pix-lbl-align-icon span:nth-child(2) { width: 10px; }
.pix-lbl-align-left .pix-lbl-align-icon span:nth-child(3) { width: 12px; }
.pix-lbl-align-center .pix-lbl-align-icon { align-items: center; }
.pix-lbl-align-center .pix-lbl-align-icon span:nth-child(1) { width: 14px; }
.pix-lbl-align-center .pix-lbl-align-icon span:nth-child(2) { width: 10px; }
.pix-lbl-align-center .pix-lbl-align-icon span:nth-child(3) { width: 12px; }
.pix-lbl-align-right .pix-lbl-align-icon { align-items: flex-end; }
.pix-lbl-align-right .pix-lbl-align-icon span:nth-child(1) { width: 14px; }
.pix-lbl-align-right .pix-lbl-align-icon span:nth-child(2) { width: 10px; }
.pix-lbl-align-right .pix-lbl-align-icon span:nth-child(3) { width: 12px; }
.pix-lbl-help-overlay {
    position: absolute; inset: 0; background: #171718; border-radius: 10px;
    padding: 28px; overflow-y: auto; color: #ccc; font-size: 13px; line-height: 1.7; z-index: 10;
}
.pix-lbl-help-overlay h3 { color: #f66744; margin: 0 0 12px 0; font-size: 16px; }
.pix-lbl-help-overlay p { margin: 0 0 8px 0; }
.pix-lbl-help-overlay kbd {
    background: #333; border: 1px solid #555; border-radius: 3px;
    padding: 1px 5px; font-size: 11px; font-family: monospace; color: #ddd;
}
.pix-lbl-help-close {
    position: absolute; top: 12px; right: 16px;
    background: none; border: none; color: #666; font-size: 20px; cursor: pointer;
}
.pix-lbl-help-close:hover { color: #fff; }
.pix-lbl-btn-help { background: #2a2a2a; color: #999; font-size: 12px; padding: 8px 14px; }
.pix-lbl-btn-help:hover { background: #363636; color: #ccc; }
`;
  document.head.appendChild(style);
}
