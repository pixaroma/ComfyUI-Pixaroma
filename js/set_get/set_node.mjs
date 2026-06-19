// ╔═══════════════════════════════════════════════════════════════╗
// ║  Set Pixaroma - virtual "named variable" sink                 ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Minimal virtual node: ONE input (adopts whatever type is wired) + an editable
// name. No output (wireless by design - read it back with Get Pixaroma). Purely
// frontend (isVirtualNode), so it never reaches the backend; Get nodes resolve
// straight through to the real upstream source at submission.

import { app } from "/scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import {
  SET_TYPE,
  GET_TYPE,
  getGraphAncestors,
  collectNodesOfType,
  findGettersByName,
  findSubgraphNodeFor,
  refreshAllGetCombos,
  pasteRenameMap,
} from "./scope.mjs";
import { ensureValueWidget, refreshValue } from "./value_preview.mjs";

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
      // comfyClass lets the Help (?) selection-toolbar button find our help
      // (convention #16) - virtual nodes have no Python class, so we set it.
      this.comfyClass = SET_TYPE;

      this.properties = this.properties || {};
      if (this.properties.previousName == null) this.properties.previousName = "";

      // Brand dark defaults (beforeRegisterNodeDef in js/brand/index.js only
      // fires for Python-backed nodes, so a virtual node sets them itself).
      // Guarded so workflow-restore + right-click → Colors still win.
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
      this.refreshTitle();
    }

    refreshTitle() {
      const v = this.widgets?.[0]?.value;
      this.title = v ? `Set: ${v}` : "Set Pixaroma";
    }

    onConnectionsChange(slotType, slot, isConnect, link_info) {
      // Skip during load AND the link-restore window that fires after
      // configure() (Vue Compat #19) so we never rewrite saved state.
      if (app.configuringGraph || isGraphLoading()) return;

      // Disconnect → revert to the wildcard type.
      if (slotType === LiteGraph.INPUT && !isConnect) {
        if (this.inputs[slot]) {
          this.inputs[slot].type = "*";
          this.inputs[slot].name = "*";
        }
        this.update();
        refreshValue(this);
        return;
      }

      // Connect → adopt the upstream type.
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
          this.inputs[0].type = type;
          this.inputs[0].name = type;
          this.validateName(this.graph);
          this.properties.previousName = this.widgets[0].value;
        }
      }

      this.update();
      refreshValue(this);
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
      const type = this.inputs?.[0]?.type ?? "*";
      const name = this.widgets[0].value;
      findGettersByName(this.graph, name).forEach((e) => e.node.setType?.(type));
      const prev = this.properties.previousName;
      if (name && prev && prev !== name) {
        findGettersByName(this.graph, prev).forEach((e) => e.node.setName?.(name));
      }
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
          this.inputs[0].type = "*";
          this.inputs[0].name = "*";
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
