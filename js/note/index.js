import { app } from "/scripts/app.js";
import { hideJsonWidget, allow_debug } from "../shared/index.mjs";
import { createNoteDOMWidget, renderContent, attachEditButton } from "./render.mjs";

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
  console.log("[Pixaroma Note] openEditor called — wiring in Task 6");
}

function setupNote(node) {
  try {
    hideJsonWidget(node.widgets, "note_json");
    node._noteCfg = parseCfg(node);

    if (!node._noteDOMWrap || !node._noteDOMWrap.isConnected) {
      // Clear stale refs and strip any widgets that aren't the Python-declared
      // `note_json`. Vue may restore extra widget stubs or leftover DOM widgets
      // from prior saves; leaving them attached causes doubled/blurred rendering
      // on reload because two widgets occupy the same slot. Also detach any
      // orphan widget DOM nodes so they don't keep painting under our body.
      node._noteDOMWrap = null;
      node._noteBody = null;
      if (node.widgets) {
        for (let i = node.widgets.length - 1; i >= 0; i--) {
          const w = node.widgets[i];
          if (w.name === "note_json") continue;
          if (w.element && w.element.parentNode) {
            w.element.parentNode.removeChild(w.element);
          }
          node.widgets.splice(i, 1);
        }
      }

      const wrap = createNoteDOMWidget(node);
      node._noteDOMWrap = wrap;
      node._noteBody = wrap.querySelector(".pix-note-body");
      attachEditButton(wrap, () => openEditor(node));
      node.addDOMWidget("note_dom", "custom", wrap, {
        serialize: false,
        getMinHeight: () => 80,
      });
    } else {
      renderContent(node, node._noteBody);
    }

  } catch (err) {
    console.error("[Pixaroma Note] setupNote error:", err);
  }
}

app.registerExtension({
  name: "Pixaroma.Note",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaNote") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _origCreated?.apply(this, arguments);
      setupNote(this);
      // Apply default size only on initial create (not on workflow reload).
      // onConfigure handles size restore natively via ComfyUI's graph deserialization.
      if (!this.size || this.size[0] < 200 || this.size[1] < 80) {
        this.size = [this._noteCfg?.width || 420, this._noteCfg?.height || 320];
      }
      if (allow_debug) console.log("PixaromaNote created", this);
      return r;
    };

    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const r = _origCfg?.apply(this, arguments);
      setupNote(this);
      return r;
    };

    const _origDblClick = nodeType.prototype.onDblClick;
    nodeType.prototype.onDblClick = function (e, pos) {
      // Intentional no-op: only the hover-reveal Edit button opens the editor.
      return false;
    };
  },
});
