// Pixaroma toolbar button - one-click access to the 👑 Pixaroma settings.
//
// Mounts a small button with the Pixaroma logo in the floating top toolbar,
// next to Align Pixaroma's button (and rgthree's button group). Clicking it
// opens ComfyUI's Settings dialog. From there the user clicks the
// 👑 Pixaroma category in the left sidebar to see all Pixaroma settings.
//
// Mount pattern: app.menu.settingsGroup.element.before(group) - same as
// Align Pixaroma uses, same as the rgthree pattern.

import { app } from "/scripts/app.js";

const LOGO_URL = "/pixaroma/assets/pixaroma_logo.svg";
const PNG_FALLBACK = "/pixaroma/assets/pixaroma_logo.png";
const CSS_ID = "pixaroma-toolbar-button-css";

const state = {
  mounted: false,
  btn: null,
};

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .pixaroma-toolbar-btn {
      background-color: #2a2c2e !important;
      color: #ddd !important;
      border-color: #444 !important;
      padding: 4px 6px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .pixaroma-toolbar-btn:hover {
      background-color: #3a3d40 !important;
      filter: brightness(1.08);
    }
    .pixaroma-toolbar-btn .pixaroma-toolbar-icon {
      width: 18px;
      height: 18px;
      display: block;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

// Try multiple known ComfyUI APIs for opening the Settings dialog. Different
// frontend versions expose different surfaces. Stop at the first one that works.
function openSettingsDialog() {
  const tryFns = [
    () => app.extensionManager?.setting?.openInDialog?.(),
    () => app.ui?.settings?.openDialog?.(),
    () => app.ui?.settings?.show?.(),
    () => app.extensionManager?.dialog?.showSettings?.(),
  ];
  for (const fn of tryFns) {
    try {
      const result = fn();
      if (result !== undefined) return true;
    } catch (_e) { /* try next */ }
  }
  // Last-resort fallback: simulate a click on the native settings cog so the
  // user still gets to the dialog even if our API guesses miss.
  const cog = document.querySelector(
    '[data-testid="settings-button"], .comfy-settings-btn, button[aria-label*="Setting" i]',
  );
  if (cog) { cog.click(); return true; }
  console.warn("[Pixaroma.ToolbarButton] could not open Settings dialog via any known API");
  return false;
}

function mount() {
  if (state.mounted && state.btn?.isConnected) return;
  const settingsGroupEl = app.menu?.settingsGroup?.element;
  if (!settingsGroupEl) {
    if (mount._tries == null) mount._tries = 0;
    if (++mount._tries > 20) {
      console.warn("[Pixaroma.ToolbarButton] toolbar mount: app.menu.settingsGroup never appeared");
      return;
    }
    setTimeout(mount, 250);
    return;
  }

  injectCSS();

  const btn = document.createElement("button");
  btn.className = "comfyui-button pixaroma-toolbar-btn";
  btn.title = "Open Pixaroma Settings";

  const img = document.createElement("img");
  img.className = "pixaroma-toolbar-icon";
  img.src = LOGO_URL;
  img.alt = "Pixaroma";
  img.draggable = false;
  img.addEventListener("error", () => {
    if (img.src !== PNG_FALLBACK) img.src = PNG_FALLBACK;
  });
  btn.appendChild(img);

  btn.addEventListener("click", openSettingsDialog);

  const group = document.createElement("div");
  group.className = "comfyui-button-group pixaroma-toolbar-group";
  group.appendChild(btn);

  settingsGroupEl.before(group);
  state.btn = btn;
  state.mounted = true;
}

app.registerExtension({
  name: "Pixaroma.ToolbarButton",
  async setup() {
    mount();
  },
});
