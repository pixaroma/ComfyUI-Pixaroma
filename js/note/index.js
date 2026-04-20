import { app } from "/scripts/app.js";
import { hideJsonWidget, allow_debug } from "../shared/index.mjs";

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

function setupNote(node) {
  try {
    hideJsonWidget(node.widgets, "note_json");
    node._noteCfg = parseCfg(node);
    const cfg = node._noteCfg;
    if (node.size) {
      node.size[0] = cfg.width || 420;
      node.size[1] = cfg.height || 320;
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
      if (allow_debug) console.log("PixaromaNote created", this);
      return r;
    };

    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const r = _origCfg?.apply(this, arguments);
      setupNote(this);
      return r;
    };
  },
});
