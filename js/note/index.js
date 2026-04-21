import { app } from "/scripts/app.js";
import { hideJsonWidget, allow_debug } from "../shared/index.mjs";
import { createNoteDOMWidget, renderContent, attachEditButton } from "./render.mjs";
import { NoteEditor } from "./core.mjs";
import "./toolbar.mjs";
import "./blocks.mjs";
import "./icons.mjs";


const DEFAULT_CFG = {
  version: 1,
  content: "",
  buttonColor: "#f66744",
  lineColor: "#f66744",
  // Match the editor's interior dark gray so a freshly-created note's
  // node body looks identical to what the user will see when they open
  // the editor. Value is intentionally a step darker than #151515 —
  // LiteGraph / the Vue canvas renders node bgcolor with a subtle
  // compositing that lifts the apparent brightness a few values, so
  // setting it lower here lands the canvas rendering at the same
  // perceived dark as the editarea. Users can change this via the Bg
  // picker; "transparent" (the only value that clears
  // node.color/bgcolor) is still honoured on notes saved with it.
  backgroundColor: "#111111",
  width: 420,
  height: 320,
};

function parseCfg(node) {
  const w = (node.widgets || []).find((x) => x.name === "note_json");
  if (!w?.value || w.value === "{}") return { ...DEFAULT_CFG };
  try {
    const parsed = JSON.parse(w.value);
    // Migration: earlier versions of node_note.py shipped the widget
    // default with backgroundColor:"transparent". A brand-new Note node
    // therefore loads that value even though it was never a deliberate
    // user choice, and our renderContent then clears node.color/bgcolor —
    // making the canvas node fall back to LiteGraph's theme gray instead
    // of matching the editor interior. If we see the old default shape
    // (transparent + empty content), drop it so DEFAULT_CFG takes over.
    if (parsed.backgroundColor === "transparent" && !parsed.content) {
      delete parsed.backgroundColor;
    }
    // Migration: single accentColor → split buttonColor + lineColor.
    // Existing notes authored before the split get their accent preserved
    // as the button color. lineColor falls through to the DEFAULT_CFG
    // value rather than inheriting the old accent — accentColor wasn't
    // driving any lines before, so there's no prior-art line color to
    // preserve. See spec 2026-04-21-note-btn-ln-split-design.md.
    if (parsed.accentColor !== undefined && parsed.buttonColor === undefined) {
      parsed.buttonColor = parsed.accentColor;
    }
    delete parsed.accentColor;
    return { ...DEFAULT_CFG, ...parsed };
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

    // Workflow reload path: nodeCreated fires BEFORE configure populates
    // widget values, so parseCfg() during setupNote reads empty defaults.
    // Re-parse + re-render after configure has set note_json.value.
    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const r = _origCfg?.apply(this, arguments);
      this._noteCfg = parseCfg(this);
      const body =
        this._noteBody || this._noteDOMWrap?.querySelector(".pix-note-body");
      if (body) renderContent(this, body);
      return r;
    };

    // Persist node size on resize so the width/height survive workflow
    // reload. The editor's save() also stamps the current size into cfg,
    // but users may resize on the canvas without opening the editor at
    // all — without this hook those nodes would revert to 420x320 on
    // reload.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = _origResize?.apply(this, arguments);
      if (this._noteCfg && Array.isArray(size)) {
        this._noteCfg.width = Math.max(160, size[0]);
        this._noteCfg.height = Math.max(80, size[1]);
        const w = (this.widgets || []).find((x) => x.name === "note_json");
        if (w) w.value = JSON.stringify(this._noteCfg);
      }
      return r;
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
