import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

// =============================================================================
// Align Pixaroma - toggleable snap & alignment guides for the node canvas.
//
// Architecture: window-level pointermove listener does the snap math + node
// position mutation. LGraphCanvas.prototype.onDrawForeground is monkey-patched
// for guide rendering. Both early-return when disabled, so the cost when OFF
// is one boolean read per pointermove.
//
// Hook discovery (May 2026): in this ComfyUI version's Vue frontend, the
// drag handler is bound directly to a captured pointer (likely via
// _mousemove_callback bound to window during drag). Patching
// LGraphCanvas.prototype.processMouseMove had ZERO effect because that method
// is never invoked. Even the canvas DOM element doesn't see pointermove
// during drag (events are routed via setPointerCapture). The reliable hook
// is window.addEventListener("pointermove", ...) in the BUBBLE phase, so we
// run AFTER LiteGraph has applied its mouse delta to the node position.
//
// Drag detection signals (NOT node_dragged, that property is unset here):
//   - app.canvas.last_mouse_dragging === true   (LiteGraph drag flag)
//   - e.buttons & 1                              (left button held)
//   - app.canvas.selected_nodes                  (the dragged set)
//
// Toolbar button: DOM-mounted via `app.menu.settingsGroup.element.before(btn)`,
// the same pattern rgthree-comfy uses (web/comfyui/comfy_ui_bar.js).
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
    .pixaroma-align-btn:not(.pixaroma-align-on) {
      background-color: #2a2c2e !important;
      color: #ddd !important;
      border-color: #444 !important;
    }
    .pixaroma-align-btn:not(.pixaroma-align-on):hover {
      background-color: #3a3d40 !important;
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
  btn.title = "Toggle Align Pixaroma snap & alignment guides (hold Alt to bypass during drag)";
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
      name: "Align Pixaroma snap & guides",
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
      name: "Align snap distance (screen pixels)",
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
    // onChange fires only on subsequent changes, so read current values now so
    // a user who had Enabled=ON across a restart gets the snap immediately.
    const s = app.ui?.settings;
    if (s) {
      state.enabled = !!s.getSettingValue(SETTING_ENABLED);
      const d = Number(s.getSettingValue(SETTING_SNAP_DIST));
      if (Number.isFinite(d) && d >= 4 && d <= 16) state.snapDistPx = d;
    }
    console.log("[Pixaroma.Align] setup: enabled=", state.enabled, "snapDist=", state.snapDistPx);
    mountToolbarButton();
    installPointerHook();
  },
});

// =============================================================================
// Drag hook - bubble-phase pointermove on window. Runs AFTER LiteGraph has
// applied the mouse delta to node.pos (so we can read the post-move position
// and apply a snap correction on top). When state.enabled is false, the
// handler does nothing on the very first line.
// =============================================================================

let _hookInstalled = false;

function installPointerHook() {
  if (_hookInstalled) return;
  window.addEventListener("pointermove", onWindowPointerMove, false);
  _hookInstalled = true;
  console.log("[Pixaroma.Align] pointer hook installed");
}

function onWindowPointerMove(e) {
  if (!state.enabled) return;
  if (e.altKey) return;
  // Drag detection: LiteGraph sets last_mouse_dragging when a drag is active,
  // and the left mouse button must still be held.
  const c = app.canvas;
  if (!c?.last_mouse_dragging) return;
  if (!(e.buttons & 1)) return;
  // Snap math comes in Task 7+. Pass-through for now.
}
