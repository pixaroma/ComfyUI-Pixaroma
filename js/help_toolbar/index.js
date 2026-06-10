// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma - Help button in the node selection toolbar         ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Adds a single Help (?) button to ComfyUI's selection toolbar (the floating
// bar above a selected node, next to the native ⓘ Node Info). It appears ONLY
// when the selected node is a Pixaroma node that has registered help via
// registerNodeHelp(comfyClass, helpDef) (js/shared/help.mjs). Clicking it opens
// the same themed help popup the in-body ? buttons use.
//
// This is the OFFICIAL extension path (verified against frontend 1.44.19), not a
// monkey-patch: ComfyUI calls `getSelectionToolboxCommands(item)` on every
// extension to collect command IDs to show, looks each up in the command store,
// and renders it via ExtensionCommandButton as `<i :class="command.icon">` +
// `@click="command.function()"`. So we register one command and answer the hook.
// On older ComfyUI builds that lack the hook it's simply never called -> the
// command is registered but never shown (harmless, no error).

import { app } from "/scripts/app.js";
import { openHelpPopup, getNodeHelp } from "../shared/index.mjs";

const CMD_ID = "Pixaroma.ShowHelp";
const ICON_CLASS = "pix-help-toolbar-icon";
const CSS_ID = "pix-help-toolbar-css";
const BRAND = "#f66744";
const QUESTION_ICON = "/pixaroma/assets/icons/note/question-mark.svg";

// command.icon renders as the class on an <i>, so we draw the orange circle + ?
// purely in CSS: a filled BRAND circle with the SAME question.svg glyph (white)
// the in-body ? buttons use, so it matches the XY Plot / Find-and-Replace icon.
function injectIconCSS() {
  if (document.getElementById(CSS_ID)) return;
  const el = document.createElement("style");
  el.id = CSS_ID;
  el.textContent = `
    .${ICON_CLASS} {
      display: inline-flex; align-items: center; justify-content: center;
      width: 16px; height: 16px; border-radius: 50%;
      background: ${BRAND};
    }
    .${ICON_CLASS}::before {
      content: ""; width: 10px; height: 10px; background-color: #fff;
      -webkit-mask: url("${QUESTION_ICON}") center / contain no-repeat;
      mask: url("${QUESTION_ICON}") center / contain no-repeat;
    }
  `;
  document.head.appendChild(el);
}

// The first selected Pixaroma node that has registered help (or null). Reads
// both selection maps: selected_nodes (the node map in both renderers) and, as a
// fallback, selectedItems (a Set that can mix nodes + groups).
function selectedHelp() {
  const c = app.canvas;
  if (!c) return null;
  const nodes = [];
  if (c.selected_nodes) nodes.push(...Object.values(c.selected_nodes));
  if (c.selectedItems) for (const it of c.selectedItems) if (it && it.comfyClass) nodes.push(it);
  for (const n of nodes) {
    const help = getNodeHelp(n && n.comfyClass);
    if (help) return help;
  }
  return null;
}

app.registerExtension({
  name: "Pixaroma.HelpToolbar",
  commands: [
    {
      id: CMD_ID,
      label: "Help",
      icon: ICON_CLASS,
      function: () => {
        const help = selectedHelp();
        if (help) openHelpPopup(help);
      },
    },
  ],
  // ComfyUI asks each extension which toolbar commands to show for a selected
  // item. Show our Help button only for a Pixaroma node that registered help.
  getSelectionToolboxCommands(item) {
    if (item && item.comfyClass && getNodeHelp(item.comfyClass)) return [CMD_ID];
    return [];
  },
  setup() {
    injectIconCSS();
  },
});
