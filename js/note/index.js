import { app } from "/scripts/app.js";
import { hideJsonWidget, allow_debug } from "../shared/index.mjs";
import { createNoteDOMWidget, renderContent, attachEditButton } from "./render.mjs";
import { NoteEditor } from "./core.mjs";

const DEFAULT_CFG = {
  version: 1,
  content: "",
  accentColor: "#f66744",
  backgroundColor: "transparent",
  width: 420,
  height: 320,
};

function parseCfg(node) {
  const w = (node.widgets || []).find((x) => x.name === "note_json");
  if (!w?.value || w.value === "{}") return { ...DEFAULT_CFG };
  try {
    return { ...DEFAULT_CFG, ...JSON.parse(w.value) };
  } catch (e) {
    return { ...DEFAULT_CFG };
  }
}

function openEditor(node) {
  // Prevent stacking overlays if user clicks Edit twice quickly or Vue removes the
  // overlay without firing close() (see CLAUDE.md §Vue rule 2 — overlay.isConnected).
  if (node._noteEditor?._el?.isConnected) return;
  if (node._noteEditor && !node._noteEditor._el?.isConnected) {
    node._noteEditor._cleanup();
  }
  const editor = new NoteEditor(node);
  node._noteEditor = editor;
  editor.open();
}

function setupNote(node) {
  try {
    hideJsonWidget(node.widgets, "note_json");
    node._noteCfg = parseCfg(node);

    // Build and register the DOM widget. nodeCreated only fires once per node
    // lifecycle (unlike prototype onNodeCreated + onConfigure overrides which
    // both fire on workflow reload), so this is always a fresh install.
    const wrap = createNoteDOMWidget(node);
    node._noteDOMWrap = wrap;
    node._noteBody = wrap.querySelector(".pix-note-body");
    attachEditButton(wrap, () => openEditor(node));
    node.addDOMWidget("note_dom", "custom", wrap, {
      serialize: false,
      getMinHeight: () => 80,
    });
  } catch (err) {
    console.error("[Pixaroma Note] setupNote error:", err);
  }
}

app.registerExtension({
  name: "Pixaroma.Note",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaNote") return;

    // Prototype-level: suppress double-click so only the hover-reveal Edit
    // button can open the editor. Applies to all instances of this type.
    nodeType.prototype.onDblClick = function () {
      return false;
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaNote") return;

    setupNote(node);

    // Apply default size only if the node is at LiteGraph's tiny default.
    // Workflow-restored nodes already have their saved size set before this
    // hook fires, so we leave those untouched.
    if (!node.size || node.size[0] < 200 || node.size[1] < 80) {
      node.size = [node._noteCfg?.width || 420, node._noteCfg?.height || 320];
    }

    if (allow_debug) console.log("PixaromaNote created", node);
  },
});
