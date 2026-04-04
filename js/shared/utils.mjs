// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Shared — Constants & Utility Functions             ║
// ╚═══════════════════════════════════════════════════════════════╝

export const allow_debug = false;

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

  const logo = document.createElement("img");
  logo.src = imgSrc || "";
  logo.style.cssText = `
      width: 45px;
      height: auto;
      margin-bottom: 10px;
    `;
  container.appendChild(logo);

  const title = document.createElement("div");
  title.innerText = titleText;
  title.style.cssText = `
      font-size: 22px;
      font-weight: 700;
      margin: 0;
      line-height: 1.2;
    `;
  container.appendChild(title);

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
    w.hidden = true;
    w.computeSize = () => [0, -4];
    if (w.element) w.element.style.display = "none";
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

export function createPlaceholder(name, buttonLabel, node, app) {
  getLogo((logo) => {
    const cvs = document.createElement("canvas");
    cvs.width = 480;
    cvs.height = 270;
    const ctx = cvs.getContext("2d");
    ctx.fillStyle = "#171718";
    ctx.fillRect(0, 0, 480, 270);
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
    if (logo) ctx.drawImage(logo, 220, 65, 40, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(name, 240, 128);
    ctx.fillStyle = BRAND;
    ctx.fillText("Pixaroma", 240, 150);
    ctx.fillStyle = "#555";
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Click '" + buttonLabel + "' to start", 240, 175);
    const prev = new Image();
    prev.onload = () => {
      node.imgs = [prev];
      resizeNode(node, prev, app);
    };
    prev.src = cvs.toDataURL();
  });
}

export async function downloadDataURL(dataURL, suggestedName = "pixaroma_export.png") {
  if (!dataURL) return;
  const mimeMatch = dataURL.match(/^data:([^;]+);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  const name = suggestedName.endsWith(`.${ext}`) ? suggestedName : `${suggestedName}.${ext}`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "Image", accept: { [mime]: [`.${ext}`] } }],
      });
      const blob = await (await fetch(dataURL)).blob();
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
      console.warn("[Pixaroma] showSaveFilePicker failed, falling back:", e);
    }
  }
  const a = document.createElement("a");
  a.href = dataURL;
  a.download = name;
  a.click();
}
