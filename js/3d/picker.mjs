// ============================================================
// Pixaroma 3D Editor — Add 3D Object modal picker
//
// Full-screen overlay modal that presents every available shape —
// primitives (SHAPES), decorative assets (bunny), and composite
// groups (COMPOSITES) — in a single categorised 5-column grid.
//
// Usage:
//   openShapePicker(editor)
// The picker handles the spawn itself (primitive → _addObject,
// composite → _addImportedGroup, bunny → importer.loadGLBFromURL),
// so callers just open it and forget.
// ============================================================

import { SHAPES, loadTeapotGeometry } from "./shapes.mjs";
import { COMPOSITES } from "./composites.mjs";

// ─── Category layout (5 columns per row) ────────────────────
// One flat list per section. Order inside each section is the
// display order. Anything outside this list is ignored — so the
// picker and the SHAPES registry don't have to stay in lockstep.
const SECTIONS = [
  {
    title: "Primitives",
    items: [
      // row 1
      { kind: "shape", id: "cube" },
      { kind: "shape", id: "sphere" },
      { kind: "shape", id: "cylinder" },
      { kind: "shape", id: "cone" },
      { kind: "shape", id: "torus" },
      // row 2
      { kind: "shape", id: "plane" },
      { kind: "shape", id: "pyramid" },
      { kind: "shape", id: "capsule" },
      { kind: "shape", id: "tube" },
      { kind: "shape", id: "ring" },
      // row 3
      { kind: "shape", id: "prism" },
      { kind: "shape", id: "crystal" },
      { kind: "shape", id: "dome" },
      { kind: "shape", id: "gear" },
      { kind: "shape", id: "teapot" },
    ],
  },
  {
    title: "Organic",
    items: [
      { kind: "bunny" },
      { kind: "shape", id: "blob" },
      { kind: "shape", id: "rock" },
      { kind: "shape", id: "terrain" },
      { kind: "composite", id: "cloud" },
    ],
  },
  {
    title: "Nature",
    items: [
      { kind: "composite", id: "tree" },
      { kind: "composite", id: "pinetree" },
      { kind: "composite", id: "flower" },
      { kind: "composite", id: "mushroom" },
      { kind: "composite", id: "cactus" },
    ],
  },
  {
    title: "Architecture",
    items: [
      { kind: "composite", id: "house" },
      { kind: "composite", id: "lamppost" },
      { kind: "composite", id: "fencepost" },
      { kind: "composite", id: "signpost" },
      { kind: "composite", id: "arch" },
    ],
  },
  {
    title: "Furniture",
    items: [
      { kind: "composite", id: "table" },
      { kind: "composite", id: "chair" },
      { kind: "composite", id: "bed" },
      { kind: "composite", id: "couch" },
      { kind: "composite", id: "bookshelf" },
    ],
  },
  {
    title: "Vessels",
    items: [
      { kind: "shape", id: "vase" },
      { kind: "shape", id: "bottle" },
      { kind: "shape", id: "goblet" },
      { kind: "shape", id: "bowl" },
      { kind: "shape", id: "plantpot" },
    ],
  },
];

// ─── One-time CSS injection ─────────────────────────────────
let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const css = `
.p3d-picker-backdrop{
  position:fixed;inset:0;background:rgba(10,12,14,0.72);
  display:flex;align-items:center;justify-content:center;
  z-index:2147483640;backdrop-filter:blur(2px);
}
.p3d-picker-modal{
  background:#1a1b1d;border:1px solid #3a3d40;border-radius:10px;
  box-shadow:0 12px 48px rgba(0,0,0,0.6);
  width:min(620px,94vw);max-height:86vh;display:flex;flex-direction:column;
  color:#ddd;font-family:inherit;
}
.p3d-picker-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 16px;border-bottom:1px solid #2a2c2e;
}
.p3d-picker-title{font-size:14px;font-weight:600;color:#eee;letter-spacing:0.2px;}
.p3d-picker-close{
  width:28px;height:28px;border:none;background:transparent;color:#aaa;
  font-size:18px;cursor:pointer;border-radius:4px;
  display:flex;align-items:center;justify-content:center;
}
.p3d-picker-close:hover{background:#2a2c2e;color:#f66744;}
.p3d-picker-body{padding:10px 16px 16px;overflow-y:auto;}
.p3d-picker-section{margin-top:12px;}
.p3d-picker-section:first-child{margin-top:4px;}
.p3d-picker-section-title{
  font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;
  margin:6px 2px 8px;font-weight:600;
}
.p3d-picker-grid{
  display:grid;grid-template-columns:repeat(5,1fr);gap:6px;
}
.p3d-picker-tile{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  height:72px;cursor:pointer;border:1px solid #3a3d40;background:#242628;
  color:#ccc;border-radius:6px;font-size:10.5px;gap:5px;padding:6px 4px;
  transition:all .12s;user-select:none;text-align:center;line-height:1.2;
}
.p3d-picker-tile:hover{
  background:#2a2c2e;border-color:#f66744;transform:translateY(-1px);
}
.p3d-picker-tile .p3d-picker-ico{
  width:28px;height:28px;background-color:#ccc;
  -webkit-mask-size:contain;mask-size:contain;
  -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
  -webkit-mask-position:center;mask-position:center;
  transition:background-color .12s;
}
.p3d-picker-tile:hover .p3d-picker-ico{background-color:#f66744;}
`;
  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-p3d-picker", "");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

// ─── Resolve an item's display info (icon, label) ───────────
function resolveItem(item) {
  if (item.kind === "shape") {
    const s = SHAPES[item.id];
    if (!s) return null;
    return { icon: s.icon, label: s.label };
  }
  if (item.kind === "composite") {
    const c = COMPOSITES[item.id];
    if (!c) return null;
    return { icon: c.icon, label: c.label };
  }
  if (item.kind === "bunny") {
    return { icon: "bunny.svg", label: "Bunny" };
  }
  return null;
}

// ─── Spawn logic — dispatches to the correct editor method ──
async function spawnItem(editor, item) {
  try {
    if (item.kind === "shape") {
      // Teapot geometry is fetched lazily the first time.
      if (item.id === "teapot") {
        await loadTeapotGeometry();
      }
      editor._addObject(item.id, { ...SHAPES[item.id].defaults });
      return;
    }
    if (item.kind === "bunny") {
      const { loadGLBFromURL } = await import("./importer.mjs");
      try {
        const group = await loadGLBFromURL(
          "/pixaroma/assets/models/bunny.glb",
        );
        editor._addImportedGroup(group, "bunny", { name: "Bunny" });
      } catch (e) {
        console.error("[P3D] bunny load failed", e);
        editor._setStatus?.("Bunny file missing — added placeholder sphere");
        editor._addObject("sphere", { radius: 0.5, widthSegs: 32, heightSegs: 32 });
        if (editor.activeObj) editor.activeObj.userData.type = "bunny";
      }
      return;
    }
    if (item.kind === "composite") {
      const { buildComposite, COMPOSITES, getCompositeDefaults } =
        await import("./composites.mjs");
      const defaults = getCompositeDefaults(item.id);
      const group = buildComposite(item.id, defaults);
      if (!group) {
        console.warn(`[P3D] composite "${item.id}" not found`);
        return;
      }
      const label = COMPOSITES[item.id].label;
      // Composites default to keepOriginalMaterials: true so the baked
      // per-part colors (trunk brown + leaves green, walls tan + roof
      // red, etc.) render from the first frame — same pattern as GLB
      // imports. geoParams gives the shape panel real sliders to edit.
      editor._addImportedGroup(group, item.id, {
        name: label,
        keepOriginalMaterials: true,
        geoParams: defaults,
        // Composites are built with pivot at base-center origin; skip
        // the XZ bbox-recenter that wrapImportPivot does for imports.
        skipPivotWrap: true,
      });
    }
  } catch (e) {
    console.error("[P3D] shape spawn failed", e);
    editor._setStatus?.("Spawn error: " + (e.message || e));
  }
}

// ─── Public: open the modal ─────────────────────────────────
export function openShapePicker(editor) {
  injectCSS();
  // If already open, bail — prevents double-click weirdness.
  if (document.querySelector(".p3d-picker-backdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.className = "p3d-picker-backdrop";
  const modal = document.createElement("div");
  modal.className = "p3d-picker-modal";
  backdrop.appendChild(modal);

  // Header
  const head = document.createElement("div");
  head.className = "p3d-picker-head";
  // Left side: stacked title + small hint so the user immediately
  // knows the interaction (just click an object to drop it in).
  const titleWrap = document.createElement("div");
  titleWrap.style.cssText = "display:flex;flex-direction:column;gap:2px;";
  const title = document.createElement("div");
  title.className = "p3d-picker-title";
  title.textContent = "Add 3D Object";
  const hint = document.createElement("div");
  hint.style.cssText =
    "font-size:11px;color:#888;font-weight:400;letter-spacing:0.2px;";
  hint.textContent = "Click any object to add it to the scene";
  titleWrap.append(title, hint);
  const closeBtn = document.createElement("button");
  closeBtn.className = "p3d-picker-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  head.append(titleWrap, closeBtn);
  modal.appendChild(head);

  // Body
  const body = document.createElement("div");
  body.className = "p3d-picker-body";
  modal.appendChild(body);

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);

  // Render sections
  for (const section of SECTIONS) {
    const sec = document.createElement("div");
    sec.className = "p3d-picker-section";
    const h = document.createElement("div");
    h.className = "p3d-picker-section-title";
    h.textContent = section.title;
    sec.appendChild(h);

    const grid = document.createElement("div");
    grid.className = "p3d-picker-grid";
    let rendered = 0;
    for (const item of section.items) {
      const info = resolveItem(item);
      if (!info) continue; // skip anything not yet registered
      rendered++;
      const tile = document.createElement("div");
      tile.className = "p3d-picker-tile";
      tile.title = "Add " + info.label;
      const ico = document.createElement("span");
      ico.className = "p3d-picker-ico";
      ico.setAttribute("role", "img");
      ico.setAttribute("aria-label", info.label);
      const iconUrl = `url("/pixaroma/assets/icons/3D/${info.icon}")`;
      ico.style.webkitMaskImage = iconUrl;
      ico.style.maskImage = iconUrl;
      const lbl = document.createElement("span");
      lbl.textContent = info.label;
      tile.append(ico, lbl);
      tile.addEventListener("click", async () => {
        // Close first so the spawn animation isn't blocked by the
        // modal still consuming pointer events.
        close();
        await spawnItem(editor, item);
      });
      grid.appendChild(tile);
    }
    if (rendered === 0) continue;
    sec.appendChild(grid);
    body.appendChild(sec);
  }

  document.body.appendChild(backdrop);
}
