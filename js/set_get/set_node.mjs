// ╔═══════════════════════════════════════════════════════════════╗
// ║  Set Pixaroma - virtual "named variable" sink                 ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Virtual node: ONE input (adopts whatever type is wired) + an editable name +
// a passthrough OUTPUT. Wire the output straight to a nearby node, or read the
// value back from anywhere with Get Pixaroma - same value either way. Purely
// frontend (isVirtualNode), so it never reaches the backend; both the Get nodes
// and the passthrough output resolve straight to the real upstream source.

import { app } from "/scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import {
  SET_TYPE,
  GET_TYPE,
  getLink,
  firstWiredInput,
  getGraphAncestors,
  collectNodesOfType,
  findGettersByName,
  findSetterByName,
  findSubgraphNodeFor,
  refreshAllGetCombos,
  pasteRenameMap,
} from "./scope.mjs";
import { ensureValueWidget, refreshValue, paintReadout } from "./value_preview.mjs";

const BRAND_TITLE = "#1d1d1d"; // matches js/brand/index.js (auto-applied to Python nodes; we set it here)
const BRAND_BODY = "#2a2a2a";
const CATEGORY = "👑 Pixaroma/🔀 Logic & Flow";

export function registerPixaromaSetNode() {
  const LGraphNode = LiteGraph.LGraphNode;

  class PixaromaSetNode extends LGraphNode {
    static title = "Set Pixaroma";
    static category = CATEGORY;

    constructor(title) {
      super(title);
      // isVirtualNode → pruned from the prompt; resolved on the frontend only.
      this.isVirtualNode = true;
      this.serialize_widgets = true;
      // comfyClass lets the Help (?) toolbar button find our help (convention
      // #16). ComfyUI sets it on the def class it generates from node_set_get.py,
      // but registerCustomNodes replaces that class with this one, so we set it
      // here too.
      this.comfyClass = SET_TYPE;

      this.properties = this.properties || {};
      if (this.properties.previousName == null) this.properties.previousName = "";

      // Brand dark defaults. js/brand/index.js applies these via
      // beforeRegisterNodeDef, but that runs on ComfyUI's generated def class
      // which we replace with this one, so we set them here too. Guarded so
      // workflow-restore + right-click Colors still win.
      if (!this.color) this.color = BRAND_TITLE;
      if (!this.bgcolor) this.bgcolor = BRAND_BODY;

      this.addWidget(
        "text",
        "name",
        "",
        () => {
          if (!this.graph || app.configuringGraph) return;
          this.validateName(this.graph);
          this.refreshTitle();
          this.update();
          this.properties.previousName = this.widgets[0].value;
        },
        {}
      );

      this.addInput("*", "*");
      this.addOutput("*", "*"); // passthrough: emits whatever is wired in
      this.refreshTitle();
    }

    refreshTitle() {
      const v = this.widgets?.[0]?.value;
      this.title = v ? `Set: ${v}` : "Set Pixaroma";
    }

    onDrawForeground(ctx) {
      super.onDrawForeground?.(ctx);
      paintReadout(this, ctx);
    }

    // Set the input AND the passthrough output to one type. Colour is left to
    // the user (right-click -> Colors); the Get nodes mirror whatever it is.
    setAdoptedType(type) {
      const t = type || "*";
      if (this.inputs?.[0]) {
        this.inputs[0].type = t;
        this.inputs[0].name = t;
      }
      if (this.outputs?.[0]) {
        this.outputs[0].type = t;
        this.outputs[0].name = t;
      }
    }

    onConnectionsChange(slotType, slot, isConnect, link_info) {
      // Skip during load AND the link-restore window that fires after
      // configure() (Vue Compat #19) so we never rewrite saved state.
      if (app.configuringGraph || isGraphLoading()) return;

      // Input disconnect → revert to the wildcard type.
      if (slotType === LiteGraph.INPUT && !isConnect) {
        this.setAdoptedType("*");
        this.update();
        refreshValue(this);
        return;
      }

      // Input connect → adopt the upstream type (input + output both take it).
      if (link_info && this.graph && slotType === LiteGraph.INPUT && isConnect) {
        let type;
        if (typeof link_info.resolve === "function") {
          const r = link_info.resolve(this.graph);
          type = (r?.subgraphInput ?? r?.output)?.type;
        }
        if (!type) {
          // Fallback: read the origin output type directly.
          const src = this.graph.getNodeById(link_info.origin_id);
          type = src?.outputs?.[link_info.origin_slot]?.type;
        }
        if (type) {
          this.setAdoptedType(type);
          this.validateName(this.graph);
          this.properties.previousName = this.widgets[0].value;
        }
      }

      // Output event → keep the output type mirrored to the input.
      if (slotType === LiteGraph.OUTPUT && this.outputs?.[0]) {
        const inType = this.inputs?.[0]?.type ?? "*";
        this.outputs[0].type = inType;
        this.outputs[0].name = inType;
      }

      this.update();
      refreshValue(this);
    }

    // Passthrough: a node wired to our output resolves to whatever feeds our
    // input (same source the Get nodes read). isVirtualNode + this is the
    // reroute contract; cross-graph is rare for a directly-wired output, so the
    // same-graph link path covers it.
    getInputLink() {
      // Read the FIRST WIRED input (not just slot 0) so a stale duplicate slot
      // can't break the passthrough output.
      const si = firstWiredInput(this);
      if (!si || si.link == null) return null;
      return getLink(this.graph, si.link);
    }

    // Ensure the name is unique within scope (own graph + ancestors). Returns
    // true if it had to change. sameGraphOnly is used on paste/clone.
    validateName(graph, sameGraphOnly) {
      let value = this.widgets[0].value;
      if (value === "") return false;
      const scope = sameGraphOnly ? [graph] : getGraphAncestors(graph);
      const existing = new Set();
      for (const e of collectNodesOfType(scope, SET_TYPE)) {
        if (e.node !== this) existing.add(e.node.widgets?.[0]?.value);
      }
      const original = value;
      const base = this._justAdded ? value.replace(/_\d+$/, "") : value;
      let tries = 0;
      while (existing.has(value)) {
        value = base + "_" + tries;
        tries++;
      }
      this.widgets[0].value = value;
      this.refreshTitle();
      return value !== original;
    }

    // Push type + rename out to this Set's getters, refresh combos + readout.
    update() {
      if (!this.graph) return;
      const type = firstWiredInput(this)?.type ?? "*";
      const name = this.widgets[0].value;
      findGettersByName(this.graph, name).forEach((e) => e.node.setType?.(type));
      const prev = this.properties.previousName;
      // Cross-rename getters from the OLD name to the new one when THIS Set was
      // just renamed - but ONLY getters whose old name is now ORPHANED (no other
      // Set still owns it). findGettersByName matches by NAME ONLY, so without
      // this guard a stale previousName that happens to equal ANOTHER live Set's
      // name would steal and overwrite that Set's getters -> the reported
      // "Get nodes lose their values" bug.
      if (name && prev && prev !== name) {
        findGettersByName(this.graph, prev).forEach((e) => {
          if (!findSetterByName(e.node.graph || this.graph, prev)) e.node.setName?.(name);
        });
      }
      // Single source of truth: sync previousName at the END of EVERY update()
      // path. The input-disconnect and output-event paths used to reach update()
      // WITHOUT resetting previousName, letting it drift stale and mis-fire the
      // cross-rename above on later connection churn (every generation).
      if (name) this.properties.previousName = name;
      refreshAllGetCombos(this.graph);
      refreshValue(this);
      app.canvas?.setDirty(true, true);
    }

    findGetterEntries(graph) {
      return findGettersByName(graph, this.widgets[0].value);
    }

    onAdded() {
      ensureValueWidget(this);
      this._justAdded = true;
      if (LiteGraph.vueNodesMode && this.graph && !app.configuringGraph) {
        refreshAllGetCombos(this.graph);
      }
    }

    onRemoved() {
      if (!LiteGraph.vueNodesMode) return;
      const g = this.graph;
      if (!g) return;
      // onRemoved fires before _nodes is spliced - defer so getters no longer
      // see this Set when their combos re-read.
      setTimeout(() => refreshAllGetCombos(g), 0);
    }

    onConfigure() {
      // Migration: a Set saved before the passthrough output existed has none -
      // add it so older workflows gain the output (flags the workflow modified
      // once; re-saving settles it).
      if (this.outputs?.length === 0) {
        this.addOutput("*", "*");
        const t = this.inputs?.[0]?.type ?? "*";
        this.outputs[0].type = t;
        this.outputs[0].name = t;
      }
      // Heal the old phantom-"value" duplicate input: keep ONE input (the wired
      // one, else slot 0) and drop the rest. The Python def no longer declares a
      // 'value' input, so ComfyUI won't re-add it; this cleans up nodes saved while
      // it did. Only runs when there is more than one input, so a clean node is
      // never touched (no dirty-on-load). Removed slots are unwired (the wired one
      // is kept), so no link breaks.
      if (this.inputs && this.inputs.length > 1) {
        let keep = this.inputs.findIndex((i) => i && i.link != null);
        if (keep < 0) keep = 0;
        for (let i = this.inputs.length - 1; i >= 0; i--) {
          if (i !== keep) this.removeInput(i);
        }
        this.setAdoptedType(this.inputs[0]?.type ?? "*");
      }
      // Only run paste de-duplication when actually pasting, not on load.
      if (this._justAdded && this.graph && !app.configuringGraph) {
        const oldName = this.widgets[0].value;
        this.validateName(this.graph, true);
        const newName = this.widgets[0].value;
        if (newName !== oldName) {
          // A Get pasted in the same cycle reads this to stay paired.
          pasteRenameMap.set(oldName, newName);
          setTimeout(() => pasteRenameMap.delete(oldName), 0);
        }
        if (this.inputs[0]?.link == null) {
          this.setAdoptedType("*");
        }
      }
      this._justAdded = false;
      this.refreshTitle();
      refreshValue(this);
    }

    clone() {
      const cloned = super.clone();
      if (cloned.inputs?.[0]) {
        cloned.inputs[0].type = "*";
        cloned.inputs[0].name = "*";
      }
      if (cloned.outputs?.[0]) {
        cloned.outputs[0].type = "*";
        cloned.outputs[0].name = "*";
      }
      cloned.properties.previousName = "";
      return cloned;
    }

    getExtraMenuOptions(_, options) {
      const entries = this.findGetterEntries(this.graph);
      const sameGraph = entries.filter((e) => e.graph === this.graph).map((e) => e.node);
      const crossGraph = entries.filter((e) => e.graph !== this.graph);

      options.unshift({
        content: `Select all its Gets (${entries.length})`,
        disabled: entries.length === 0,
        callback: () => {
          const canvas = app.canvas;
          if (sameGraph.length && canvas?.selectNodes) {
            canvas.selectNodes(sameGraph);
          } else if (sameGraph.length && canvas?.selectNode) {
            canvas.deselectAllNodes?.();
            for (const n of sameGraph) canvas.selectNode(n, true);
          }
          canvas?.setDirty(true, true);
        },
      });

      // Cross-subgraph getters can't be multi-selected from here - offer to jump.
      if (crossGraph.length) {
        options.unshift({
          content: "Jump to Get in subgraph",
          has_submenu: true,
          submenu: {
            options: crossGraph.map((e) => {
              const sgNode = findSubgraphNodeFor(this.graph, e.node);
              return {
                content: `${e.node.title} (${sgNode?.title || sgNode?.type || "subgraph"})`,
                callback: () => {
                  const canvas = app.canvas;
                  if (sgNode && canvas?.openSubgraph) {
                    canvas.openSubgraph(sgNode.subgraph, sgNode);
                    setTimeout(() => {
                      canvas.centerOnNode?.(e.node);
                      canvas.selectNode?.(e.node, false);
                      canvas.setDirty(true, true);
                    }, 0);
                  }
                },
              };
            }),
          },
        });
      }

      options.unshift({
        content: "Add paired Get Pixaroma",
        callback: () => {
          const getNode = LiteGraph.createNode(GET_TYPE);
          if (!getNode) return;
          getNode.pos = [this.pos[0] + this.size[0] + 30, this.pos[1]];
          this.graph.add(getNode);
          if (getNode.widgets?.[0]) getNode.widgets[0].value = this.widgets[0].value;
          getNode.onRename?.();
          app.canvas?.selectNode?.(getNode, false);
          app.canvas?.setDirty(true, true);
        },
      });
    }
  }

  LiteGraph.registerNodeType(SET_TYPE, PixaromaSetNode);
}
