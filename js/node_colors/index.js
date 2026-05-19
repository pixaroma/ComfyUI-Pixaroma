import { app } from "/scripts/app.js";
import { createPixaromaColorPicker } from "../shared/color_picker.mjs";

// ── Pixaroma node colors: right-click menu + presets + favorite ──────────
// Right-click on any ComfyUI node:
//   • 👑 Pixaroma colors → submenu of 6 dark presets + Favorite (from
//     Settings) + Pick custom... (opens a side-by-side modal with live
//     node preview).
//   • 👑 Reset node colors clears the override.
//
// Colors are written to each node's .color / .bgcolor, so they serialize
// into the workflow JSON and travel to recipients without requiring this
// plugin installed.
//
// Multi-select aware: when 2+ nodes are selected AND the right-clicked
// node is one of them, the action applies to all of them, and the label
// shows "(N nodes)".

// 6 curated dark presets (title slightly darker than body, matching the
// brand convention from js/brand/index.js). Hues are spread around the
// wheel so users can visually group nodes by function (samplers green,
// upscalers teal, prompts wine, etc.).
const PRESETS = [
  { id: "dark",   label: "Dark",   title: "#1d1d1d", body: "#2a2a2a" },
  { id: "slate",  label: "Slate",  title: "#1a2332", body: "#25334a" },
  { id: "forest", label: "Forest", title: "#13261c", body: "#1d3a2d" },
  { id: "plum",   label: "Plum",   title: "#2a1a2e", body: "#3d2842" },
  { id: "wine",   label: "Wine",   title: "#2a141b", body: "#3d1d28" },
  { id: "teal",   label: "Teal",   title: "#102b2f", body: "#1a3f44" },
];

const FAVORITE_TITLE_ID = "Pixaroma.NodeColors.FavoriteTitle";
const FAVORITE_BODY_ID  = "Pixaroma.NodeColors.FavoriteBody";

function getFavorite() {
  const s = app.ui?.settings;
  const t = s?.getSettingValue?.(FAVORITE_TITLE_ID) || "#1d1d1d";
  const b = s?.getSettingValue?.(FAVORITE_BODY_ID)  || "#2a2a2a";
  return { title: t, body: b };
}

function setFavorite(title, body) {
  const s = app.ui?.settings;
  if (!s) return;
  try {
    if (typeof s.setSettingValueAsync === "function") {
      s.setSettingValueAsync(FAVORITE_TITLE_ID, title);
      s.setSettingValueAsync(FAVORITE_BODY_ID,  body);
    } else if (typeof s.setSettingValue === "function") {
      s.setSettingValue(FAVORITE_TITLE_ID, title);
      s.setSettingValue(FAVORITE_BODY_ID,  body);
    }
  } catch (e) { /* non-fatal: colors are already applied to the nodes */ }
}

function getTargetNodes(currentNode) {
  const sel = app.canvas?.selected_nodes;
  if (sel) {
    const nodes = Object.values(sel);
    if (nodes.length > 1 && nodes.includes(currentNode)) return nodes;
  }
  return [currentNode];
}

function applyColors(nodes, titleHex, bodyHex) {
  for (const n of nodes) {
    n.color   = titleHex;
    n.bgcolor = bodyHex;
  }
  app.graph?.setDirtyCanvas(true, true);
}

function resetColors(nodes) {
  for (const n of nodes) {
    delete n.color;
    delete n.bgcolor;
  }
  app.graph?.setDirtyCanvas(true, true);
}

// ── Custom-colors modal: side-by-side title + body pickers with a live
// node preview. Built from scratch (not openPixaromaColorPickerModal)
// because we want both pickers visible at once and a preview that
// updates as the user drags either SV plane.

function injectCSS() {
  if (document.getElementById("pix-nc-css")) return;
  const s = document.createElement("style");
  s.id = "pix-nc-css";
  s.textContent = `
.pix-nc-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 10000;
  display: flex; align-items: center; justify-content: center;
}
.pix-nc-modal {
  background: #1f1f1f;
  color: #e0e0e0;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  padding: 18px 22px 16px;
  min-width: 600px;
  max-width: 90vw;
  font: 13px system-ui, sans-serif;
}
.pix-nc-modal-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 14px;
  text-align: center;
  color: #e0e0e0;
}
.pix-nc-preview-wrap {
  display: flex; justify-content: center;
  padding: 4px 0 18px;
}
.pix-nc-preview-node {
  width: 220px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 4px 14px rgba(0,0,0,0.5);
  overflow: hidden;
  transition: background 0.08s linear;
}
.pix-nc-preview-titlebar {
  padding: 6px 10px;
  font: 12px system-ui, sans-serif;
  font-weight: 500;
  color: rgba(255,255,255,0.92);
  transition: background 0.08s linear;
}
.pix-nc-preview-body {
  padding: 8px 10px 10px;
  transition: background 0.08s linear;
}
.pix-nc-preview-row {
  font: 11px system-ui, sans-serif;
  color: rgba(255,255,255,0.6);
  padding: 2px 0;
  display: flex; align-items: center; gap: 6px;
}
.pix-nc-preview-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #f66744;
  display: inline-block;
  flex-shrink: 0;
}
.pix-nc-pickers {
  display: flex; gap: 20px;
  justify-content: center;
  margin-bottom: 12px;
}
.pix-nc-picker-col {
  display: flex; flex-direction: column;
  align-items: center;
}
.pix-nc-picker-label {
  font: 11px system-ui, sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #999;
  margin: 0 0 8px;
  align-self: stretch;
  text-align: center;
}
.pix-nc-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 8px;
}
.pix-nc-btn {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.88);
  padding: 7px 18px;
  border-radius: 4px;
  font: 12px system-ui, sans-serif;
  cursor: pointer;
  min-width: 84px;
  transition: background 0.1s, border-color 0.1s;
}
.pix-nc-btn:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.3);
}
.pix-nc-btn.primary {
  background: #f66744;
  border-color: #f66744;
  color: #fff;
}
.pix-nc-btn.primary:hover {
  background: #e85a3a;
  border-color: #e85a3a;
}
  `;
  document.head.appendChild(s);
}

function buildPreviewNode(initialTitle, initialBody) {
  const el = document.createElement("div");
  el.className = "pix-nc-preview-node";

  const titleBar = document.createElement("div");
  titleBar.className = "pix-nc-preview-titlebar";
  titleBar.textContent = "Example Node";
  titleBar.style.background = initialTitle;
  el.appendChild(titleBar);

  const body = document.createElement("div");
  body.className = "pix-nc-preview-body";
  body.style.background = initialBody;
  el.appendChild(body);

  function row(label) {
    const r = document.createElement("div");
    r.className = "pix-nc-preview-row";
    const dot = document.createElement("span");
    dot.className = "pix-nc-preview-dot";
    r.appendChild(dot);
    const t = document.createElement("span");
    t.textContent = label;
    r.appendChild(t);
    return r;
  }
  body.appendChild(row("input"));
  body.appendChild(row("another input"));
  body.appendChild(row("widget"));

  return {
    el,
    setTitle: (c) => { titleBar.style.background = c; },
    setBody:  (c) => { body.style.background = c; },
  };
}

function openCustomColorsModal(opts) {
  injectCSS();
  const { initialTitle, initialBody, onApply, onCancel = () => {} } = opts;
  let titleHex = initialTitle;
  let bodyHex  = initialBody;

  const backdrop = document.createElement("div");
  backdrop.className = "pix-nc-backdrop";

  const modal = document.createElement("div");
  modal.className = "pix-nc-modal";

  const titleEl = document.createElement("div");
  titleEl.className = "pix-nc-modal-title";
  titleEl.textContent = "Pick custom colors";
  modal.appendChild(titleEl);

  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-nc-preview-wrap";
  const preview = buildPreviewNode(titleHex, bodyHex);
  previewWrap.appendChild(preview.el);
  modal.appendChild(previewWrap);

  const pickers = document.createElement("div");
  pickers.className = "pix-nc-pickers";

  // Title bar picker column
  const titleCol = document.createElement("div");
  titleCol.className = "pix-nc-picker-col";
  const titleLabel = document.createElement("div");
  titleLabel.className = "pix-nc-picker-label";
  titleLabel.textContent = "Title bar color";
  titleCol.appendChild(titleLabel);
  const titlePicker = createPixaromaColorPicker({
    initialColor: titleHex,
    hideReset: true,
    onChange: (c) => { titleHex = c; preview.setTitle(c); },
  });
  titleCol.appendChild(titlePicker.element);
  pickers.appendChild(titleCol);

  // Body picker column
  const bodyCol = document.createElement("div");
  bodyCol.className = "pix-nc-picker-col";
  const bodyLabel = document.createElement("div");
  bodyLabel.className = "pix-nc-picker-label";
  bodyLabel.textContent = "Body color";
  bodyCol.appendChild(bodyLabel);
  const bodyPicker = createPixaromaColorPicker({
    initialColor: bodyHex,
    hideReset: true,
    onChange: (c) => { bodyHex = c; preview.setBody(c); },
  });
  bodyCol.appendChild(bodyPicker.element);
  pickers.appendChild(bodyCol);

  modal.appendChild(pickers);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "pix-nc-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pix-nc-btn";
  cancelBtn.textContent = "Cancel";
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "pix-nc-btn primary";
  applyBtn.textContent = "Apply";
  actions.appendChild(cancelBtn);
  actions.appendChild(applyBtn);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  function close() {
    window.removeEventListener("keydown", onKey, true);
    titlePicker.destroy();
    bodyPicker.destroy();
    if (backdrop.parentNode) backdrop.remove();
  }

  applyBtn.addEventListener("click", () => { onApply(titleHex, bodyHex); close(); });
  cancelBtn.addEventListener("click", () => { onCancel(); close(); });

  // Click-outside-to-cancel, but ONLY if both mousedown AND click happened
  // on the backdrop. A drag that starts in the SV plane and releases off
  // the modal would otherwise cancel and discard the user's pick.
  let mouseDownOnBackdrop = false;
  backdrop.addEventListener("mousedown", (e) => {
    mouseDownOnBackdrop = (e.target === backdrop);
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && mouseDownOnBackdrop) { onCancel(); close(); }
    mouseDownOnBackdrop = false;
  });

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopImmediatePropagation();
      e.preventDefault();
      onCancel();
      close();
    } else if (e.key === "Enter") {
      e.stopImmediatePropagation();
      e.preventDefault();
      onApply(titleHex, bodyHex);
      close();
    }
  }
  window.addEventListener("keydown", onKey, true);
}

function pickCustom(nodes) {
  const fav = getFavorite();
  openCustomColorsModal({
    initialTitle: fav.title,
    initialBody:  fav.body,
    onApply: (titleHex, bodyHex) => {
      applyColors(nodes, titleHex, bodyHex);
      setFavorite(titleHex, bodyHex);
    },
  });
}

function buildSubmenuOptions(targets) {
  const items = PRESETS.map((p) => ({
    content: p.label,
    callback: () => applyColors(targets, p.title, p.body),
  }));
  items.push(null); // separator
  items.push({
    content: "Favorite (from settings)",
    callback: () => {
      const fav = getFavorite();
      applyColors(targets, fav.title, fav.body);
    },
  });
  items.push({
    content: "Pick custom...",
    callback: () => pickCustom(targets),
  });
  return items;
}

app.registerExtension({
  name: "Pixaroma.NodeColors",

  settings: [
    {
      id: FAVORITE_TITLE_ID,
      name: "Favorite Title Color (default #1d1d1d)",
      type: "color",
      defaultValue: "#1d1d1d",
      tooltip: "Your personal favorite title bar color. Applied by the 'Favorite' entry in the right-click menu under '👑 Pixaroma colors'. NOTE: ComfyUI's color field shows saved values without '#' but requires '#' when typing, so enter '#1d1d1d' to reset, or use the color picker.",
      category: ["👑 Pixaroma", "Favorite Title"],
    },
    {
      id: FAVORITE_BODY_ID,
      name: "Favorite Body Color (default #2a2a2a)",
      type: "color",
      defaultValue: "#2a2a2a",
      tooltip: "Your personal favorite body color. Applied by the 'Favorite' entry in the right-click menu under '👑 Pixaroma colors'. NOTE: same '#' typing rule as the Favorite Title setting.",
      category: ["👑 Pixaroma", "Favorite Body"],
    },
  ],

  async setup() {
    if (typeof LGraphCanvas === "undefined" || !LGraphCanvas?.prototype?.getNodeMenuOptions) {
      return;
    }
    const origGetNodeMenuOptions = LGraphCanvas.prototype.getNodeMenuOptions;
    LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
      const options = origGetNodeMenuOptions.apply(this, arguments);
      const targets = getTargetNodes(node);
      const count   = targets.length;
      const suffix  = count > 1 ? ` (${count} nodes)` : "";
      options.push(
        null,
        {
          content: `👑 Pixaroma colors${suffix}`,
          has_submenu: true,
          callback: function (value, opts, e, menu) {
            new LiteGraph.ContextMenu(
              buildSubmenuOptions(targets),
              { event: e, parentMenu: menu, node: node }
            );
          },
        },
        {
          content: `👑 Reset node colors${suffix}`,
          callback: () => resetColors(targets),
        }
      );
      return options;
    };
  },
});
