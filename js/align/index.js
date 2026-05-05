import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

// =============================================================================
// Align Pixaroma — toggleable snap & alignment guides for the node canvas.
//
// Architecture: monkey-patches LGraphCanvas.prototype.processMouseMove (snap)
// and onDrawForeground (guide rendering). Both early-return when disabled, so
// the cost when OFF is one boolean read per mousemove.
//
// Patches WRAP, never REPLACE. We save the original at install time and call
// through. This lets us coexist with rgthree-comfy and similar extensions.
//
// Toolbar button: DOM-mounted via `app.menu.settingsGroup.element.before(btn)`,
// the same pattern rgthree-comfy uses (web/comfyui/comfy_ui_bar.js). The
// `commands` + `menuCommands` API in this ComfyUI version surfaces items in
// the menubar dropdowns, NOT the floating top action bar — so DOM mount is
// the right path for getting a button next to rgthree's logo.
// =============================================================================

const SETTING_ENABLED = "Pixaroma.Align.Enabled";
const SETTING_SNAP_DIST = "Pixaroma.Align.SnapDistance";

const state = {
  enabled: false,
  snapDistPx: 8,
  activeGuides: [],
  toolbarBtn: null,
};

const ICON_URL = "/pixaroma/assets/icons/ui/align-center-v.svg";

function toggleEnabled() {
  const s = app.ui?.settings;
  if (!s) return;
  const next = !s.getSettingValue(SETTING_ENABLED);
  s.setSettingValue(SETTING_ENABLED, next);
  // onChange handler updates state.enabled. Force toolbar tint refresh in case
  // onChange runs after this returns:
  state.enabled = next;
  updateToolbarTint();
}

function injectToolbarCSS() {
  if (document.getElementById("pixaroma-align-css")) return;
  const style = document.createElement("style");
  style.id = "pixaroma-align-css";
  style.textContent = `
    .pixaroma-align-btn .pixaroma-align-icon {
      display: inline-block;
      width: 18px;
      height: 18px;
      background-color: currentColor;
      mask-image: url(${ICON_URL});
      -webkit-mask-image: url(${ICON_URL});
      mask-size: contain;
      -webkit-mask-size: contain;
      mask-repeat: no-repeat;
      -webkit-mask-repeat: no-repeat;
      mask-position: center;
      -webkit-mask-position: center;
      pointer-events: none;
    }
    .pixaroma-align-btn.pixaroma-align-on {
      background-color: ${BRAND} !important;
      color: #fff !important;
      border-color: ${BRAND} !important;
    }
    .pixaroma-align-btn.pixaroma-align-on:hover {
      background-color: ${BRAND} !important;
      filter: brightness(1.08);
    }
  `;
  document.head.appendChild(style);
}

function updateToolbarTint() {
  const btn = state.toolbarBtn;
  if (!btn) return;
  btn.classList.toggle("pixaroma-align-on", state.enabled);
}

function mountToolbarButton() {
  if (state.toolbarBtn?.isConnected) return;
  // app.menu.settingsGroup is the gear-icon group on the right side of the
  // floating top action bar. Inserting before it places our button next to
  // rgthree's logo. If app.menu isn't ready yet, retry a few times.
  const settingsGroupEl = app.menu?.settingsGroup?.element;
  if (!settingsGroupEl) {
    if (mountToolbarButton._tries == null) mountToolbarButton._tries = 0;
    if (++mountToolbarButton._tries > 20) {
      console.warn("[Pixaroma.Align] toolbar mount: app.menu.settingsGroup never appeared");
      return;
    }
    setTimeout(mountToolbarButton, 250);
    return;
  }

  injectToolbarCSS();

  const btn = document.createElement("button");
  btn.className = "comfyui-button pixaroma-align-btn";
  btn.title = "Toggle Align Pixaroma — snap & alignment guides (Alt to bypass during drag)";
  // Keep `.comfyui-button` defaults for OFF state (matches other unfilled
  // buttons like the bookmark icon). The `.pixaroma-align-on` class swaps in
  // BRAND background + white icon when active, mirroring the Manager button.
  btn.innerHTML = `<span class="pixaroma-align-icon"></span>`;
  btn.addEventListener("click", toggleEnabled);

  // Wrap in a group element so it visually matches rgthree / native ComfyUI
  // button groups in the toolbar.
  const group = document.createElement("div");
  group.className = "comfyui-button-group pixaroma-align-group";
  group.appendChild(btn);

  settingsGroupEl.before(group);
  state.toolbarBtn = btn;
  updateToolbarTint();
}

app.registerExtension({
  name: "Pixaroma.Align",
  settings: [
    {
      id: SETTING_ENABLED,
      name: "Align Pixaroma — snap & guides",
      type: "boolean",
      defaultValue: false,
      category: ["👑 Pixaroma", "Align"],
      tooltip: "Snap nodes to others' edges and centers while dragging or resizing. Hold Alt to bypass.",
      onChange: (v) => {
        state.enabled = !!v;
        updateToolbarTint();
        console.log("[Pixaroma.Align] enabled =", state.enabled);
      },
    },
    {
      id: SETTING_SNAP_DIST,
      name: "Align — Snap distance (screen pixels)",
      type: "slider",
      defaultValue: 8,
      attrs: { min: 4, max: 16, step: 1 },
      category: ["👑 Pixaroma", "Align (advanced)"],
      tooltip: "How close (in screen pixels) an edge must be before snap engages.",
      onChange: (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 4 && n <= 16) state.snapDistPx = n;
      },
    },
  ],
  setup() {
    // onChange fires only on subsequent changes — read current values now so
    // a user who had Enabled=ON across a restart gets the snap immediately.
    const s = app.ui?.settings;
    if (s) {
      state.enabled = !!s.getSettingValue(SETTING_ENABLED);
      const d = Number(s.getSettingValue(SETTING_SNAP_DIST));
      if (Number.isFinite(d) && d >= 4 && d <= 16) state.snapDistPx = d;
    }
    console.log("[Pixaroma.Align] setup: enabled=", state.enabled, "snapDist=", state.snapDistPx);
    mountToolbarButton();
  },
});
