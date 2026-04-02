export const allow_debug = true;

export const PIXAROMA_LOGO = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 64 64">
  <g id="Symbol">
    <path id="Crown" d="M59.621,61.893H4.379c10.085,0,19.854-3.521,27.621-9.954,7.767,6.434,17.536,9.954,27.621,9.954ZM32,46.992c6.367,0,10.501-3.33,12.146-5.083l7.484-31.647-5.777,5.778c-.898.899-1.138,2.248-.646,3.42,1.292,3.077-.391,7.215-1.191,10.432l-4.331-3.955c-.998-.912-1.254-2.388-.609-3.576.938-1.728,1.758-4.537.142-7.681l-6.464-12.573v11.92c0,.716.331,1.382.877,1.845.577.488.931,1.23.892,2.053-.062,1.298-1.207,2.394-2.506,2.403-.006,0-.03,0-.036,0-1.299-.009-2.444-1.105-2.506-2.403-.039-.823.316-1.565.892-2.053.546-.462.877-1.129.877-1.845V2.107l-6.464,12.573c-1.617,3.144-.796,5.953.142,7.681.645,1.188.39,2.664-.609,3.576l-4.331,3.955c-.8-3.218-2.482-7.355-1.191-10.432.492-1.172.252-2.521-.646-3.42l-5.777-5.778,7.484,31.647c1.645,1.752,5.779,5.083,12.146,5.083Z" fill="#f66744"/>
  </g>
</svg>
`)}`;

export const BRAND = "#f66744";
const LOGO_URL = "/pixaroma/assets/pixaroma_logo.svg";

export function createDummyWidget(titleText, subtitleText, instructionText) {
  const imgSrc = PIXAROMA_LOGO;
  const container = document.createElement("div");
  container.style.cssText = `
      display: flex; 
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 20px;
      background-color: #121212;
      border-radius: 8px;
      width: 100%;
      height: 100%;
      color: #ffffff;
      font-family: sans-serif;
      text-align: center;
      box-sizing: border-box;
    `;

  // --- Logo/Icon ---
  const logo = document.createElement("img");
  logo.src = imgSrc || "";
  logo.style.cssText = `
      width: 45px;
      height: auto;
      margin-bottom: 10px;
    `;
  container.appendChild(logo);

  // --- Title ---
  const title = document.createElement("div");
  title.innerText = titleText;
  title.style.cssText = `
      font-size: 22px;
      font-weight: 700;
      margin: 0;
      line-height: 1.2;
    `;
  container.appendChild(title);

  // --- Subtitle ---
  const subtitle = document.createElement("div");
  subtitle.innerText = subtitleText;
  subtitle.style.cssText = `
      font-size: 18px;
      font-weight: 700;
      color: #ff6b4a;
      margin: 0;
      line-height: 1.2;
    `;
  container.appendChild(subtitle);

  // --- Instruction Text ---
  const instruction = document.createElement("div");
  instruction.innerText = instructionText;
  instruction.style.cssText = `
      font-size: 10px;
      color: #555555;
      margin-top: 12px;
    `;
  container.appendChild(instruction);

  return container;
}

export function installFocusTrap(overlay) {
  const trap = document.createElement("textarea");
  trap.dataset.pixaromaTrap = "1";
  trap.setAttribute("aria-hidden", "true");
  trap.style.cssText =
    "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";
  overlay.appendChild(trap);
  trap.focus();
  // Re-focus trap when user clicks on non-input areas of the overlay
  const refocus = (e) => {
    const tag = e.target?.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
      requestAnimationFrame(() => trap.focus());
    }
  };
  overlay.addEventListener("mouseup", refocus);
  return trap;
}

export function hideJsonWidget(widgets, widgetName) {
  const w = (widgets || []).find((x) => x.name === widgetName);
  if (w) {
    // Do NOT change w.type — ComfyUI uses it for prompt serialization.
    // Changing type to "hidden" can cause the widget to be skipped,
    // resulting in the Python node receiving the default value.
    w.hidden = true;
    w.computeSize = () => [0, -4];
    if (w.element) w.element.style.display = "none";
    // Delayed hide: DOM element may not exist yet during onNodeCreated
    requestAnimationFrame(() => {
      if (w.element) w.element.style.display = "none";
      if (w.inputEl) w.inputEl.style.display = "none";
    });
  }
  return w;
}

export function restorePreview(node, widgetName, app) {
  const w = (node.widgets || []).find((x) => x.name === widgetName);
  if (!w?.value || w.value === "{}") return;
  try {
    const meta = JSON.parse(w.value);
    if (!meta.composite_path) return;
    const img = new Image();
    img.onload = () => {
      node.imgs = [img];
      app.graph.setDirtyCanvas(true, true);
    };
    const fn = meta.composite_path.split(/[\\/]/).pop();
    img.src = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
  } catch (e) {
    console.warn("[Pixaroma] restore failed:", e);
  }
}

export function resizeNode(node, img, app) {
  const BASE_WIDTH = 380;
  node.size[0] = Math.max(node.size[0] || BASE_WIDTH, BASE_WIDTH);
  const aspect = img.naturalWidth / img.naturalHeight;
  node.size[1] = node.size[0] / aspect + 80;
  app.graph.setDirtyCanvas(true, true);
}

export function createPlaceholder(name, buttonLabel, node, app) {
  getLogo((logo) => {
    const cvs = document.createElement("canvas");
    cvs.width = 480;
    cvs.height = 270;
    const ctx = cvs.getContext("2d");
    ctx.fillStyle = "#171718";
    ctx.fillRect(0, 0, 480, 270);
    // Subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < 480; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 270);
      ctx.stroke();
    }
    for (let y = 0; y < 270; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(480, y);
      ctx.stroke();
    }
    // Logo
    if (logo) ctx.drawImage(logo, 220, 65, 40, 40);
    // Text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(name, 240, 128);
    ctx.fillStyle = BRAND;
    ctx.fillText("Pixaroma", 240, 150);
    ctx.fillStyle = "#555";
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Click '" + buttonLabel + "' to start", 240, 175);
    // Apply
    const prev = new Image();
    prev.onload = () => {
      node.imgs = [prev];
      resizeNode(node, prev, app);
    };
    prev.src = cvs.toDataURL();
  });
}

export function getLogo(cb) {
  let _logoCache = null;
  let _logoLoading = false;
  let _logoCbs = [];

  if (_logoCache) {
    cb(_logoCache);
    return;
  }
  _logoCbs.push(cb);
  if (_logoLoading) return;
  _logoLoading = true;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    _logoCache = img;
    _logoCbs.forEach((fn) => fn(img));
    _logoCbs = [];
  };
  img.onerror = () => {
    _logoCbs.forEach((fn) => fn(null));
    _logoCbs = [];
  };
  img.src = LOGO_URL;
}

// ── Label editor CSS (injected once on first use) ─────────────
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
