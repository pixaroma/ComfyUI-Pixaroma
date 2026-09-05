// LoRA Loader Pixaroma - stack many LoRAs in one node. One DOM widget (Add / All /
// gear + a row per LoRA), fixed MODEL + CLIP inputs and MODEL + CLIP + triggers
// outputs. Works in BOTH renderers.
//
// Architecture mirrors Sizes / Resolution: state on node.properties.loraLoaderState,
// injected into the hidden LoraLoaderState input by the graphToPrompt hook below
// (Vue Compat #9). Info panel, gear panel, dropdown, and row menu live in siblings.

import { app } from "/scripts/app.js";
import { hideJsonWidget, applyAdaptiveCanvasOnly, installCanvasZoomPassthrough, onNodeDefsRefresh, installRefreshHook } from "../shared/index.mjs";
import { listLoras, invalidateList, invalidateAllInfo } from "./api.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings } from "../shared/node_settings.mjs";
import {
  HIDDEN_INPUT, DEFAULT_STATE,
  readState, loadDefaults, promptState,
} from "./core.mjs";
import { injectCSS, renderNode, contentHeight } from "./render.mjs";
import { attachInteractions } from "./interaction.mjs";
import { openLoraPanel, closeLoraPanelFor } from "./settings.mjs";
import { closeInfoPanelFor } from "./info_panel.mjs";
import { closeLoraDropdown } from "./dropdown.mjs";
import { closeRowMenu } from "./interaction.mjs";
import { isQueueLoopActive } from "../shared/queue_drivers.mjs";
// Side-effect import: registers the XY Plot sweep provider so this node's rows show
// up in the XY picker and can be swept per cell.
import "./sweep.mjs";

const CLASS = "PixaromaLoraLoader";

// R (Refresh Node Definitions) must reach OUR picker too: drop both session
// caches, re-fetch the list, and repaint every LoRA node so the missing-file
// marks track reality. Fires once per refresh pass (deduped in refresh.mjs),
// and also on WebSocket reconnect - the same moments native combos refresh.
onNodeDefsRefresh(() => {
  invalidateList();
  invalidateAllInfo();
  listLoras().then(() => {
    // Recurse into subgraphs like buildIndex below does - a LoRA node nested in a
    // subgraph must get its missing-marks repainted too, not just top-level ones.
    const walk = (g) => {
      for (const n of (g?._nodes || [])) {
        if ((n.comfyClass === CLASS || n.type === CLASS) && n._pixLlRoot) renderNode(n);
        const sub = n.subgraph || n.graph || n._graph;
        if (sub && sub !== g) walk(sub);
      }
    };
    walk(app.graph);
  });
});
const MIN_W = 300;
const CHROME = 66;      // legacy fallback: title + 2 input + 3 output slot rows
const VUE_CHROME = 96;  // Nodes 2.0 fallback

function widgetH(node) { return contentHeight(readState(node)); }

// The node height that shows every row with no scrollbar. Delegate the chrome
// (title + the input/output slot rows) to LiteGraph's computeSize; fall back to a
// constant estimate only if it's unavailable.
function fitNodeH(node) {
  try {
    const cs = node.computeSize?.();
    if (cs && cs[1] > 0) return Math.round(cs[1]);
  } catch (_e) { /* fall through */ }
  return widgetH(node) + (isVueNodes() ? VUE_CHROME : CHROME);
}

// Auto-fit the node height to its content. USER ACTIONS ONLY (never on the load
// path, or a saved size gets rewritten and a clean workflow opens "modified" -
// Vue Compat #18). Preserves the current width so a manual widen sticks.
function fitToContent(node) {
  if (isGraphLoading()) return;
  const w = Math.max(node.size?.[0] || MIN_W, MIN_W);
  const h = fitNodeH(node);
  if (node.setSize) node.setSize([w, h]);
  else node.size = [w, h];
}

function makeRefresh(node) {
  return (structural) => {
    renderNode(node);
    if (structural) fitToContent(node);
    node.setDirtyCanvas?.(true, true);
  };
}

function setupNode(node) {
  hideJsonWidget(node.widgets, HIDDEN_INPUT); // no-op: the Python input is hidden

  const root = document.createElement("div");
  root.className = "pix-ll-root";
  const inner = document.createElement("div");
  inner.className = "pix-ll-inner";
  root.appendChild(inner);

  const widget = node.addDOMWidget("loras_ui", "pixaroma_lora_loader", root, {
    getValue: () => readState(node),
    setValue: () => {},
    getMinHeight: () => widgetH(node),
    getMaxHeight: () => widgetH(node),
    margin: 4,
    serialize: false,
  });
  widget.computeLayoutSize = () => ({ minHeight: widgetH(node), minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);
  // Wheel over the LoRA list must still zoom the canvas (Classic; no-ops in Nodes
  // 2.0). The chips list keeps its own scroll - the helper yields to a scrollable
  // region that still has room to scroll.
  installCanvasZoomPassthrough(root);

  node._pixLlRoot = root;
  node._pixLlInner = inner;

  // Fresh default size (configure() overrides this for a loaded node, Vue Compat #8).
  // Mutate in place rather than replacing the array (Vue may hold a reactive proxy).
  if (!Array.isArray(node.size)) node.size = [336, 0];
  node.size[0] = Math.max(node.size[0] || 0, 336);
  node.size[1] = fitNodeH(node);

  attachInteractions(node, widget.element || root, makeRefresh(node));

  // Defer the first populate past configure() so a restored workflow renders its
  // saved rows, not the default (Vue Compat #8). fitToContent bails on the load path.
  queueMicrotask(() => { renderNode(node); fitToContent(node); });

  // Warm the list so the missing-file marks can show WITHOUT the picker ever being
  // opened (a workflow whose LoRA was renamed on disk should say so on load).
  // Cached after the first node; the repaint is DOM-only, so it can't dirty a
  // freshly loaded workflow (Vue Compat #18).
  listLoras().then(() => { if (node._pixLlRoot) renderNode(node); });
}

app.registerExtension({
  name: "Pixaroma.LoraLoader",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixLlPatched) return;
    nodeType.prototype._pixLlPatched = true;

    injectCSS();
    // Core calls node.refreshComboInNode(defs) on every graph node when the user
    // presses R - this wires that signal into the cache invalidation above.
    installRefreshHook(nodeType);

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      if (this._pixLlRoot) { renderNode(this); fitToContent(this); }
      return r;
    };

    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      // Legacy ONLY: in Nodes 2.0 the rendered size lives in the Vue layout store and
      // getMinHeight/computeLayoutSize already lock the height - clamping node.size
      // here would desync and pop on a workflow-tab switch (Nodes 2.0 resize rule).
      if (!isVueNodes()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        this.size[1] = fitNodeH(this);
      }
      if (_origResize) return _origResize.call(this, size);
    };

    // Belt-and-braces for the same clamp (node UI convention #7): onResize does not
    // fire on every legacy resize path, so a grow-then-shrink cycle could otherwise
    // leave the node under MIN_W with the row controls clipped past its right edge.
    // Legacy only, for exactly the reason spelled out on onResize above.
    const _origDrawFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      // MUST also be gated on isGraphLoading(): this is the only width clamp that
      // can run on the LOAD path (onConfigure's fitToContent already bails during a
      // load), and node.size is serialized - so a node saved narrower than MIN_W in
      // Nodes 2.0 and reopened in Classic would be rewritten on the first frame and
      // flag an untouched workflow "modified" (Vue Compat #18).
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return _origDrawFg?.apply(this, arguments);
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeLoraPanelFor(this);
      closeInfoPanelFor(this);
      closeLoraDropdown(); // transient - also auto-closes on the canvas click that deletes
      closeRowMenu();
      return _origRemoved?.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS) return;
    setupNode(node);
  },

  getNodeMenuItems(node) {
    if (node?.comfyClass !== CLASS) return [];
    return [
      { content: "⚙ LoRA Loader settings", callback: () => openLoraPanel(node, makeRefresh(node)) },
    ];
  },
});

// ── graphToPrompt: inject the per-node state (INJECT ONLY, never prune) ──────
function buildIndex() {
  const index = new Map();
  const visit = (graph, prefix) => {
    if (!graph) return;
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      // Composite id (prefix "" at top level, "5:"-style inside a subgraph) so a
      // subgraph node exact-matches its "5:3" prompt id and can't collide with a
      // top-level node that happens to share the bare id (Load Image Mini fix).
      const cid = String(prefix) + n.id;
      if (n.comfyClass === CLASS || n.type === CLASS) {
        index.set(cid, n);
        // Bare id, FIRST-write-wins (top level visited first) so a subgraph node
        // never clobbers a top-level node's exact-id resolution.
        if (!index.has(String(n.id))) index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner, cid + ":");
    }
  };
  visit(app.graph, "");
  return index;
}
function findNode(index, id) {
  const s = String(id);
  if (index.has(s)) return index.get(s);
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
}

const _origGraphToPrompt_fn = app.graphToPrompt;
const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildIndex();
        entry.inputs = entry.inputs || {};
        // A queue-driver sweep (XY Plot) may already have written this cell's state.
        // Hook order between two graphToPrompt wrappers is load-order dependent, so
        // defer to a value that is already there instead of clobbering it (the same
        // defer guard Outpaint Stitch uses for its swept slider values). Outside a
        // sweep loop nothing else ever writes this input, so a normal run is
        // untouched.
        if (isQueueLoopActive() && typeof entry.inputs[HIDDEN_INPUT] === "string" && entry.inputs[HIDDEN_INPUT]) continue;
        const node = findNode(index, id);
        const st = node ? readState(node) : { ...DEFAULT_STATE, ...loadDefaults(), loras: [] };
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(promptState(st));
      }
    }
  } catch (e) {
    console.warn("[LoRA Loader Pixaroma] could not inject state:", (e && e.message) || e);
  }
  return result;
};

registerNodeHelp(CLASS, {
  title: "LoRA Loader Pixaroma",
  tagline: "Stack many LoRAs in one node, with trigger words read straight from each file.",
  sections: [
    {
      heading: "What it does",
      body:
        "Add as many LoRAs as you want, each on its own line with its own on/off switch and strength. " +
        "Wire your model (and clip) in the top, and the modified model and clip come out. You can chain " +
        "several of these nodes if you like.",
    },
    {
      heading: "Model and CLIP",
      body:
        "A LoRA can change two things: the image model (the drawing side, the required " +
        "model input) and CLIP (the part that reads your prompt words, the optional clip " +
        "input). Most of a LoRA's look comes from the model side, so it works with only " +
        "model connected. Connect clip too (checkpoint clip through this node and on to " +
        "your text encode) when you want the LoRA to also tune how its trigger words are " +
        "read - it matters most for trigger-word LoRAs. Leave clip unwired only in " +
        "model-only setups.",
    },
    {
      heading: "Each row",
      bullets: [
        "The name box opens a searchable list of your LoRAs (grouped by subfolder).",
        "The strength box: type a number, or use the small up/down arrows.",
        "The i button opens the info panel.",
        "The switch on the right turns that LoRA on or off; an off row dims.",
      ],
    },
    {
      heading: "Trigger words",
      body:
        "Pick a LoRA and its trigger word is ticked for you straight away, so a LoRA that needs one just " +
        "works. The ticked words come out of the triggers output as plain text you can wire into your " +
        "prompt.\n\n" +
        "Only the real trigger is ticked: the words the maker declared in the file, or the ones saved from " +
        "Civitai. Many LoRAs also carry a long list of tags from their training pictures, and those are " +
        "offered in the panel but never ticked for you, because they are labels rather than the word the " +
        "LoRA is waiting for.\n\n" +
        "Click the i on a row to see everything it has and change the picks. Un-tick a word and it stays " +
        "un-ticked, even after a run and after closing the panel. If a LoRA has no words in its file you " +
        "can type your own in the box at the bottom, or use the optional Civitai button to look them up " +
        "online (only when you click it) and save them for next time. All of this is read from the file, " +
        "so it works offline.",
    },
    {
      heading: "Your own trigger words are remembered",
      body:
        "A word you type is kept for that LoRA, not just for the row you typed it on. Use the same LoRA " +
        "in another row, another node or another workflow and your words are waiting in its panel. " +
        "Swap a row to a different LoRA and back, and they come back too.\n\n" +
        "They are stored on this computer, alongside your other Pixaroma settings, so they survive an " +
        "update and nothing is written into your models folder. Tap a word to send it to the triggers " +
        "output, the same as any other word: being remembered means it is offered again, not that it is " +
        "switched on for you. The small x on a word forgets it for that LoRA everywhere.",
    },
    {
      heading: "Use your own picture",
      body:
        "The little picture at the top left of the info panel is the LoRA's preview. Click it to " +
        "choose an image from your computer, or drop one onto it, or copy an image and press Ctrl+V " +
        "over the panel. Handy for a LoRA you trained yourself, one that is not on Civitai, or simply " +
        "when you would rather see your own example than the one that came with it.\n\n" +
        "Your picture wins over everything else, including a later Civitai lookup, and the small x on " +
        "the corner removes it and brings the automatic one back. Nothing is overwritten: the picture " +
        "is kept on this computer alongside your other Pixaroma settings, never written into your " +
        "models folder, so it survives an update and works even when your models sit on a read-only " +
        "or network drive. It follows the LoRA, so every row and every workflow using that LoRA shows it.\n\n" +
        "If you would rather see no pictures at all, for instance while recording, switch off Show " +
        "preview thumbnails in the gear. The picture box then disappears from the panel entirely, and " +
        "any pictures you have set are kept safe for when you switch it back on.",
    },
    {
      heading: "Comparing LoRAs side by side",
      body:
        "XY Plot Pixaroma can drive this node. In its picker your rows show up under this " +
        "node's name, counted from the top: LoRA 1 file tries a different LoRA file in " +
        "every square, LoRA 1 strength sweeps that row's weight, LoRA 2 file is the next " +
        "row down, and so on (there is a separate clip strength entry when you have split " +
        "model and clip in the gear). The list you then tick is every LoRA on your " +
        "computer, because the point is to try ones you have not loaded yet, and each tick " +
        "makes one more square rather than stacking them together. " +
        "An axis drives ONE row. The row being compared is switched on for every square, " +
        "and the other rows stay exactly as you left them, which means a second switched-on " +
        "LoRA is applied on top of every square and can hide what the compared row is doing. " +
        "Switch off anything you are not comparing, and XY Plot will name the row in an " +
        "orange line under its picker when one would get in the way. To compare two LoRAs in " +
        "every combination instead, put one on the X axis and the other on Y. One thing " +
        "to know when you compare LoRA FILES: that row's ticked trigger words are left out " +
        "of every square, because they belonged to one particular LoRA and keeping them " +
        "would give a single square wording none of the others have. Other rows keep their " +
        "words as normal, and anything you want in every square belongs in your prompt.",
    },
    {
      heading: "Buttons and settings",
      body:
        "Add LoRA, the all on/off switch, and the gear sit in the middle of the node. The gear opens the " +
        "settings (default strength, step size, separate model and clip strengths, the trigger separator, " +
        "the Civitai button, thumbnails, your Civitai account, and the highlight colour). Right-click a row " +
        "to move it, duplicate it, or remove it.",
    },
    {
      heading: "When Civitai cannot find your LoRA",
      body:
        "Civitai hides adult-rated models from anyone who has not signed in, and it hides them by " +
        "answering exactly the same way it answers for a file it has never seen. So the lookup " +
        "reports \"not found\" and there is no way to tell the two apart. If that is happening to " +
        "you, the Civitai account section in the gear has the two things that fix it.\n\n" +
        "Add key takes an API key from your Civitai account (on their site: your profile menu, " +
        "Account settings, then API Keys). The lookup then asks as you rather than as a stranger, " +
        "so anything your own Civitai settings let you see comes back normally. Ask this site " +
        "first switches between civitai.com and civitai.red, their unrestricted address - try " +
        "Unrestricted if a LoRA still is not found. Whichever you choose, the other address is " +
        "asked as well when the first one comes back with nothing, so nothing you could reach " +
        "before stops working. Your key is sent to whichever of the two is being asked, since " +
        "that is what lets either of them show you a hidden model.\n\n" +
        "Your key is kept on this computer, in ComfyUI's own user folder, and is never written " +
        "into a workflow - so sharing a workflow, or an image with a workflow inside it, cannot " +
        "give your key away. It is not shown again after you save it either: the settings only " +
        "show the last four characters so you can tell which key is loaded.\n\n" +
        "Allow adult preview images is separate and off to begin with. A LoRA whose example " +
        "pictures are all adult shows no picture at all unless you turn this on.",
    },
    {
      heading: "LoRA memory use",
      body:
        "In the gear. Standard keeps only the last used LoRA file in memory between runs, the way ComfyUI " +
        "itself does - the balanced default. Fast keeps the whole stack loaded for the quickest re-runs, " +
        "which can hold a lot of memory with several large LoRAs. Lowest keeps nothing and re-reads the " +
        "files each run - the best choice on a machine with limited memory. If a LoRA's file has been " +
        "renamed or removed, its row shows a red warning and it is skipped until you pick the file again.",
    },
  ],
  footer: "Trigger words are read from the file, so it works offline. Civitai is optional and off until you click it.",
});

// The gear in the node selection toolbar opens the same panel the right-click
// entry does. ownMenuItem: this node already adds its own menu line.
registerNodeSettings(CLASS, {
  title: "LoRA Loader",
  // paints from its OWN --acc var - run its own render (see Control Panel)
  onChange: (node) => makeRefresh(node)(),
  ownMenuItem: true,
  open: (node) => openLoraPanel(node, makeRefresh(node)),
});
