// Pause Image Pixaroma - the node body UI, built as ONE DOM widget so it
// renders identically in the Classic and Nodes 2.0 renderers with zero
// isVueNodes() branching (the project's recommended dual-mode strategy).
// Layout top->bottom: toggle pill (Pause | Pass), status line, the two
// action buttons (Continue, Regenerate), then the preview image filling the
// remaining height at the bottom.
import { BRAND } from "../shared/utils.mjs";
import { getState } from "./state.mjs";

const HEADER_H = 96;        // toggle + status + buttons block
const PREVIEW_MIN_H = 150;  // minimum preview area
const DIMS_H = 16;          // the dimensions line under the preview
export const NODE_MIN_W = 240;
// Constant getMinHeight (Vue Compat #18): a fixed number is byte-identical on
// every save/load, so node.size never jitters and the workflow is never
// falsely flagged "modified".
export const NODE_MIN_H = HEADER_H + PREVIEW_MIN_H + DIMS_H;

function injectCSS() {
  if (document.getElementById("pix-pause-css")) return;
  const s = document.createElement("style");
  s.id = "pix-pause-css";
  s.textContent = `
    .pix-pi-root { display:flex; flex-direction:column; flex:1 1 0; min-height:0;
      box-sizing:border-box; padding:6px; gap:6px; font:12px sans-serif; color:#ddd; }
    .pix-pi-toggle { display:flex; background:rgba(0,0,0,0.25); border-radius:6px; padding:2px; gap:2px; flex:0 0 auto; }
    .pix-pi-seg { flex:1 1 0; text-align:center; padding:4px 0; border-radius:5px; cursor:pointer;
      color:rgba(255,255,255,0.6); user-select:none; border:1px solid transparent; }
    .pix-pi-seg.active { background:${BRAND}; color:#fff; border-color:${BRAND}; }
    .pix-pi-seg:not(.active):hover { border-color:${BRAND}; color:#ddd; }
    .pix-pi-status { flex:0 0 auto; font-size:11px; color:rgba(255,255,255,0.7); min-height:14px; text-align:center; }
    .pix-pi-btns { display:flex; gap:6px; flex:0 0 auto; }
    .pix-pi-btn { flex:1 1 0; min-width:0; height:26px; line-height:24px; border-radius:4px;
      border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.05);
      color:rgba(255,255,255,0.85); font:12px sans-serif; cursor:pointer; padding:0 6px;
      box-sizing:border-box; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; user-select:none; }
    .pix-pi-btn:hover:not(:disabled) { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    .pix-pi-btn.primary:not(:disabled) { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    .pix-pi-btn.primary:hover:not(:disabled) { background:#ff8a5e; border-color:#ff8a5e; }
    .pix-pi-btn:disabled { opacity:0.45; cursor:default; }
    .pix-pi-preview { flex:1 1 0; min-height:0; position:relative; background:#1d1d1d;
      border:1px solid #333; border-radius:4px; overflow:hidden; }
    .pix-pi-img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; display:none; }
    .pix-pi-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      text-align:center; color:#777; font-size:11px; padding:8px; box-sizing:border-box; }
    .pix-pi-dims { flex:0 0 auto; text-align:center; font-size:10px; color:#aaa;
      min-height:13px; line-height:13px; }
  `;
  document.head.appendChild(s);
}

// Build the DOM widget element. callbacks: { onGate(gate), onContinue(), onRegenerate() }.
// Caches element refs on node._pixPauseEls for renderPause / showFrame.
export function buildPauseWidget(node, callbacks) {
  injectCSS();
  const root = document.createElement("div");
  root.className = "pix-pi-root";

  const toggle = document.createElement("div");
  toggle.className = "pix-pi-toggle";
  const segPause = document.createElement("div");
  segPause.className = "pix-pi-seg";
  segPause.textContent = "Pause";
  segPause.title = "Pause here on Run so you can preview before continuing";
  const segPass = document.createElement("div");
  segPass.className = "pix-pi-seg";
  segPass.textContent = "Pass";
  segPass.title = "Pass straight through; run the whole workflow in one go";
  toggle.append(segPause, segPass);
  segPause.addEventListener("click", () => callbacks.onGate("pause"));
  segPass.addEventListener("click", () => callbacks.onGate("pass"));

  const status = document.createElement("div");
  status.className = "pix-pi-status";

  const btns = document.createElement("div");
  btns.className = "pix-pi-btns";
  const btnContinue = document.createElement("button");
  btnContinue.className = "pix-pi-btn primary";
  btnContinue.textContent = "▶ Continue";
  btnContinue.title = "Run only the rest of the workflow, from the snapshot";
  const btnRegen = document.createElement("button");
  btnRegen.className = "pix-pi-btn";
  btnRegen.textContent = "⟳ Regenerate";
  btnRegen.title = "Roll a new image at this point (respects your seed)";
  btns.append(btnContinue, btnRegen);
  // stopPropagation so the click doesn't reach the canvas (deselect / drag).
  btnContinue.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onContinue(); });
  btnRegen.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onRegenerate(); });

  const preview = document.createElement("div");
  preview.className = "pix-pi-preview";
  const img = document.createElement("img");
  img.className = "pix-pi-img";
  const empty = document.createElement("div");
  empty.className = "pix-pi-empty";
  empty.textContent = "Press Run to preview the image here";
  preview.append(img, empty);

  // Dimensions line sits BELOW the preview (its own row), not over the image.
  const dims = document.createElement("div");
  dims.className = "pix-pi-dims";

  root.append(toggle, status, btns, preview, dims);

  node._pixPauseEls = { segPause, segPass, status, btnContinue, btnRegen, img, empty, dims };
  return root;
}

// Re-render the controls from current state. DOM-only (never touches node.size
// or node.properties values), so it is safe to call on the load path.
export function renderPause(node) {
  const els = node._pixPauseEls;
  if (!els) return;
  const s = getState(node);
  const paused = s.gate === "pause";
  els.segPause.classList.toggle("active", paused);
  els.segPass.classList.toggle("active", !paused);

  // The action buttons only make sense in Pause mode.
  els.btnRegen.disabled = !paused;
  els.btnContinue.disabled = !paused || !s.hasSnapshot;

  if (node._pixPauseBusy) {
    els.status.textContent = node._pixPauseBusy;
  } else if (!paused) {
    els.status.textContent = "Passing through: whole workflow runs";
  } else if (s.hasSnapshot) {
    els.status.textContent = "Paused and ready. Continue to run the rest.";
  } else {
    els.status.textContent = "Paused. Press Run to preview.";
  }
}

// Load + show a snapshot frame in the preview. frame = {filename, subfolder, type}.
// On success enables Continue; on error (temp PNG cleared after a restart) shows
// an "expired" message and disables Continue.
export function showFrame(node, frame) {
  const els = node._pixPauseEls;
  if (!els || !frame || !frame.filename) return;
  const params = new URLSearchParams({
    filename: frame.filename,
    subfolder: frame.subfolder || "",
    type: frame.type || "temp",
    t: String(Date.now()),  // cache-bust the deterministic snapshot filename
  });
  const url = `/view?${params.toString()}`;
  const { img, empty, dims } = els;
  img.onload = () => {
    img.style.display = "block";
    empty.style.display = "none";
    dims.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
    const s = getState(node);
    s.hasSnapshot = true;
    s.dims = dims.textContent;
    renderPause(node);
  };
  img.onerror = () => {
    img.style.display = "none";
    empty.style.display = "flex";
    empty.textContent = "Preview expired. Press Run to pause again.";
    dims.textContent = "";
    const s = getState(node);
    s.hasSnapshot = false;
    renderPause(node);
  };
  img.src = url;
}
