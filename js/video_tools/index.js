// Video Tools Pixaroma - wiring.
//
// Join, trim, reverse, loop and fade up to eight clips (frames + sound) from
// any video model. Classic and Nodes 2.0 alike.
//
// core.mjs state + the plan (pure) | actions.mjs changes | layout.mjs the input
// pairs, the dots, the size | ui.mjs the face | settings.mjs the gear panel |
// css.mjs | help.mjs

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings } from "../shared/node_settings.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { runTab, eachRestoredOutput } from "../shared/run_tab.mjs";
import { CLASS, HIDDEN_INPUT, injectedState } from "./core.mjs";
import { VIDEO_TOOLS_HELP } from "./help.mjs";
import {
  clipSoundSlot, defaultHeight, fitAfterPairs, growToFloor, isOurLabel, liftClassic, nodeFloor, savedPairs, settleLift,
  shortLabel, sizeBefore, syncInputs, trimToSaved, unwatchLift, watchLift,
} from "./layout.mjs";
import { closeSettingsPanelFor, openSettingsPanel } from "./settings.mjs";
import { MIN_W, buildFace, destroyFace, renderFace, setPlaying } from "./ui.mjs";

const DEFAULT_W = 560;
const COPY_CHECK_MS = 5000;

// A throwaway COPY (Ctrl+C, Alt-drag, Clone and Convert to subgraph all build
// a clone() that never joins a graph and never gets onRemoved, VC#8) lets go
// of what its face holds outside itself: 6 window listeners and the renderer
// signal per copy (measured: 30 listeners left after 5 copies, copyleak.sh).
function releaseCopy(node) {
  try { node._pixVdtRendererOff?.(); } catch {}
  node._pixVdtRendererOff = null;
  try { node._pixVdtFace?.floorOff?.(); } catch {}
  try { node._pixVdtFace?.widthOff?.(); } catch {}
}

registerNodeHelp(CLASS, VIDEO_TOOLS_HELP);
registerNodeSettings(CLASS, {
  title: "Video Tools",
  open: (node) => openSettingsPanel(node),
  closeFor: (node) => closeSettingsPanelFor(node),
});

function applyRun(node, message) {
  const entry = message?.pixaroma_video_tools?.[0];
  if (!entry) return;
  // Runtime only, never serialized: the temp files do not outlive the server.
  node._pixVdtRun = entry;
  node._pixVdtPlaying = false;
  renderFace(node);
}

// A new Run stops every moving preview, so nothing animates while it works.
// app.graph is the ROOT graph; an opened subgraph is app.canvas.graph.
api.addEventListener("execution_start", () => {
  for (const g of new Set([app.graph, app.canvas?.graph])) {
    for (const n of g?._nodes || []) {
      if ((n.comfyClass === CLASS || n.type === CLASS) && n._pixVdtPlaying) setPlaying(n, false);
    }
  }
});

app.registerExtension({
  name: "Pixaroma.VideoTools",

  onNodeOutputsUpdated(nodeOutputs) {
    eachRestoredOutput(nodeOutputs, CLASS, (node, output) => applyRun(node, output));
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    if (nodeType.prototype._pixVdtPatched) return;
    nodeType.prototype._pixVdtPatched = true;

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      const node = this;
      // Read ONCE, here (Vue Compat #19): a deferred frame cannot tell.
      const bornInLoad = isGraphLoading();
      buildFace(node, { onGear: () => openSettingsPanel(node) });
      node._pixVdtRefresh = () => renderFace(node);
      // The face sits beside the input dots, under the outputs (layout.mjs).
      liftClassic(node);
      watchLift(node);
      settleLift(node);

      // Fresh size, SYNCHRONOUSLY (configure() restores a saved one next, #9).
      if (!Array.isArray(node.size)) node.size = [DEFAULT_W, defaultHeight()];
      node.size[0] = DEFAULT_W;
      node.size[1] = defaultHeight();

      queueMicrotask(() => {
        // A fresh drop shows fps + two clip pairs instead of all eight. A loaded,
        // pasted or undone node keeps what it was saved with (onConfigure).
        if (!bornInLoad && node.graph && !node._pixVdtConfigured) syncInputs(node);
        renderFace(node);
      });
      node._pixVdtRendererOff = onRendererChange(() => {
        liftClassic(node);
        renderFace(node);
        settleLift(node);
      });
      // A node joins its graph in the same task it is made (a drop, an open, a
      // paste, an undo); one still out of every graph later is a throwaway copy.
      setTimeout(() => { if (!node.graph) releaseCopy(node); }, COPY_CHECK_MS);
    };

    // The configure flag covers the link replay configure() does for every
    // input (VC#17): a replayed connection must not add or trim pairs.
    const _configureFn = nodeType.prototype.configure;
    nodeType.prototype.configure = function (info) {
      this._pixVdtConfiguring = true;
      // The pairs the node was SAVED with, read HERE: core's own configure
      // (ComfyNode) adds every missing def input to `info` before onConfigure
      // sees it (measured on an undo: 8 saved, 18 in onConfigure's info).
      this._pixVdtSavedPairs = savedPairs(info);
      try {
        return _configureFn.apply(this, arguments);
      } finally {
        this._pixVdtConfiguring = false;
      }
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // Core puts back EVERY def input on configure (open and each Ctrl+Z,
      // VC#32): trim to the pairs the node was SAVED with (counted in the
      // configure wrapper above), which leaves it exactly as saved
      // (diff-gated). Nothing else here may write size, properties or slots (VC#18).
      this._pixVdtConfigured = true;
      const saved = this._pixVdtSavedPairs;
      if (saved) trimToSaved(this, saved);
      liftClassic(this);
      delete this._pixVdtRun;
      this._pixVdtPlaying = false;
      renderFace(this);
      settleLift(this);
      return r;
    };

    // A clip wired into the last free pair adds a pair; unwiring the last clip
    // takes the spare away. Deferred one tick: LiteGraph clears the link only
    // AFTER this callback (sliders.md #13). Never during a load or a configure.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type) {
      const r = _conn?.apply(this, arguments);
      if (type === 1 /* INPUT */ && !this._pixVdtConfiguring && !isGraphLoading()) {
        const self = this;
        setTimeout(() => {
          if (!self.graph || isGraphLoading() || !self._pixVdtFace) return;
          const before = sizeBefore(self);
          syncInputs(self);
          fitAfterPairs(self, before);
          renderFace(self);
          growToFloor(self);   // the Music row appears when a song is wired
          settleLift(self);
        }, 0);
      }
      queueMicrotask(() => renderFace(this));
      return r;
    };

    // A sound wire dropped on the BODY (not on a dot) or wired from the search
    // box goes to a clip's free sound before the song (clipSoundSlot). Core's
    // three lookups: findInputByType (a drop on the node, both renderers, and
    // its hover hint), findInputSlotByType and findSlotByType (connectByType).
    const _byType = nodeType.prototype.findInputByType;
    nodeType.prototype.findInputByType = function (type) {
      const i = clipSoundSlot(this, type);
      if (i >= 0) return { index: i, slot: this.inputs[i] };
      return _byType?.apply(this, arguments);
    };
    const _slotByType = nodeType.prototype.findInputSlotByType;
    nodeType.prototype.findInputSlotByType = function (type, returnObj) {
      const i = clipSoundSlot(this, type);
      if (i >= 0) return returnObj ? this.inputs[i] : i;
      return _slotByType?.apply(this, arguments);
    };
    const _slotOfType = nodeType.prototype.findSlotByType;
    nodeType.prototype.findSlotByType = function (input, type, returnObj) {
      const i = input ? clipSoundSlot(this, type) : -1;
      if (i >= 0) return returnObj ? this.inputs[i] : i;
      return _slotOfType?.apply(this, arguments);
    };

    // The dots' short labels ("fps", "v1", "a1") are made at runtime: keep them
    // out of the file. Chained onSerialize, returning ITS result (VC#29).
    const _onSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (o) {
      const r = _onSerialize?.apply(this, arguments);
      for (const inp of o?.inputs || []) {
        const short = inp?.name === "fps" ? "fps" : shortLabel(inp?.name);
        if (inp && short && inp.label === short && isOurLabel(inp)) delete inp.label;
      }
      return r;
    };

    const _executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      _executed?.apply(this, arguments);
      queueMicrotask(() => {
        if (runTab(message) === "other") return;
        applyRun(this, message);
      });
    };

    // Classic-only clamps, never during a load (#7 + VC#18). The floor is the
    // measured content with the picture at its smallest (rows wrap when narrow;
    // the next move re-measures).
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading() && this._pixVdtFace) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        const floor = nodeFloor(this);
        if (floor != null && size[1] < floor) size[1] = floor;
      }
      return _resize?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      unwatchLift(this);
      try { this._pixVdtRendererOff?.(); } catch {}
      this._pixVdtRendererOff = null;
      try { closeSettingsPanelFor(this); } catch {}
      destroyFace(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: put the settings into the hidden input ──────────────────
function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph) => {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  for (const sg of app.graph?.subgraphs?.values?.() || []) visit(sg);
  return index;
}

function findNode(index, id) {
  const s = String(id);
  if (index.has(s)) return index.get(s);
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
}

// A BYPASSED Video Tools (Ctrl+B): core passes each output on from the input at
// the SAME place when the type fits, and place 1 is `music`, so the sound came
// from the song or, with no song wired, was DROPPED (Save Video saved a silent
// clip; a node that needs a sound failed the Run; measured 2026-10-25). A
// dropped sound gets clip 1's sound back, the way the node itself would pass
// it. Root graph only, only an input core left out; anything else stays as
// core built it (the shape of js/shared/bypass_repair.mjs).
function repairBypassedSound(out) {
  const g = app.rootGraph || app.graph;
  const linkOf = (id) => (g?.links?.get ? g.links.get(id) : g?.links?.[id]);
  for (const n of g?._nodes || []) {
    if ((n.comfyClass || n.type) !== CLASS || n.mode !== 4) continue;
    const a1 = n.inputs?.find((i) => i?.name === "audio_1");
    const src = a1?.link != null ? linkOf(a1.link) : null;
    const origin = src ? g.getNodeById(src.origin_id) : null;
    if (!origin || origin.mode !== 0 || !out[String(origin.id)]) continue;
    const sound = n.outputs?.find((o) => o?.name === "audio");
    for (const id of sound?.links || []) {
      const l = linkOf(id);
      const t = l ? g.getNodeById(l.target_id) : null;
      const entry = t ? out[String(t.id)] : null;
      const name = t?.inputs?.[l.target_slot]?.name;
      if (!entry || !name || entry.inputs?.[name] !== undefined) continue;
      entry.inputs = entry.inputs || {};
      entry.inputs[name] = [String(origin.id), src.origin_slot];
    }
  }
}

const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    if (result?.output) repairBypassedSound(result.output);
  } catch (e) {
    console.error("[Pixaroma.VideoTools] could not pass the sound through a bypassed node", e);
  }
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildIndex();
        const node = findNode(index, id);
        if (!node) continue;
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(injectedState(node));
      }
    }
  } catch (e) {
    console.error("[Pixaroma.VideoTools] could not add the settings to the prompt", e);
  }
  return result;
};
