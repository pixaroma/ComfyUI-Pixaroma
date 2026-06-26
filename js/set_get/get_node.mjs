// ╔═══════════════════════════════════════════════════════════════╗
// ║  Get Pixaroma - virtual "named variable" source              ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Minimal virtual node: a dropdown that picks which Set Pixaroma to read (by
// name, scoped to this graph + ancestors) + ONE output that matches the chosen
// Set's type. Purely frontend (isVirtualNode); at submission it resolves
// straight through to the Set's real upstream source:
//   - getInputLink(slot)        → same-graph (classic prompt path)
//   - resolveVirtualOutput(slot) → cross-graph / subgraph (native 1.45.15 path)
// Both are implemented so it works on every prompt-build path and inside
// subgraphs without any monkey-patch.

import { app } from "/scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import {
  SET_TYPE,
  GET_TYPE,
  getLink,
  firstWiredInput,
  findSetterByName,
  findRootGraph,
  getVisibleSetNames,
  pasteRenameMap,
} from "./scope.mjs";
import { ensureValueWidget, refreshValue, paintReadout } from "./value_preview.mjs";
import { inheritSetColor } from "./colors.mjs";

const BRAND_TITLE = "#1d1d1d";
const BRAND_BODY = "#2a2a2a";
const CATEGORY = "👑 Pixaroma/🔀 Logic & Flow";

export function registerPixaromaGetNode() {
  const LGraphNode = LiteGraph.LGraphNode;

  class PixaromaGetNode extends LGraphNode {
    static title = "Get Pixaroma";
    static category = CATEGORY;

    constructor(title) {
      super(title);
      this.isVirtualNode = true;
      this.serialize_widgets = true;
      this.comfyClass = GET_TYPE; // for the Help (?) toolbar button (convention #16)
      this.currentSetter = null;

      this.properties = this.properties || {};
      if (!this.color) this.color = BRAND_TITLE;
      if (!this.bgcolor) this.bgcolor = BRAND_BODY;

      // Live combo: values are the in-scope Set names, read fresh each render.
      const comboOptions = {};
      Object.defineProperty(comboOptions, "values", {
        get: () => (this.graph ? getVisibleSetNames(this.graph) : []),
        enumerable: true,
        configurable: true,
      });

      const widget = this.addWidget(
        "combo",
        "name",
        "",
        () => {
          if (!app.configuringGraph) this.onRename();
        },
        comboOptions
      );

      // Legacy-only: the bundled ComboWidget mis-handles a live-getter values
      // list (empty-array edge case), so drive a ContextMenu ourselves. Vue
      // mode renders the combo natively and is left untouched.
      const origOnClick = widget.onClick?.bind(widget);
      widget.onClick = (params) => {
        if (LiteGraph.vueNodesMode) return origOnClick?.(params);
        const { e, canvas, node } = params;
        const x = e.canvasX - node.pos[0];
        const width = widget.width || node.size[0];
        if (x < 40) return widget.decrementValue?.({ e, node, canvas });
        if (x > width - 40) return widget.incrementValue?.({ e, node, canvas });
        const values = comboOptions.values;
        if (!values.length) return;
        const menu = new LiteGraph.ContextMenu(values, {
          scale: Math.max(1, canvas.ds.scale),
          event: e,
          className: "dark",
          callback: (v) => widget.setValue?.(v, { e, node, canvas }),
        });
        // Colour each entry's left edge by that Set's own colour.
        const entries = menu.root?.querySelectorAll(".litemenu-entry");
        values.forEach((nm, i) => {
          const el = entries?.[i];
          if (!el) return;
          const setter = findSetterByName(this.graph, nm);
          el.style.borderLeft = `4px solid ${setter?.node?.bgcolor || "#888"}`;
          el.style.paddingLeft = "8px";
        });
      };

      // Nodes 2.0: swap the options reference (live getter preserved) and
      // re-splice the widget so Vue re-extracts the values.
      this._refreshComboOptions = () => {
        const w = this.widgets?.[0];
        if (!w) return;
        const fresh = {};
        Object.defineProperty(
          fresh,
          "values",
          Object.getOwnPropertyDescriptor(comboOptions, "values")
        );
        w.options = fresh;
        const idx = this.widgets.indexOf(w);
        if (idx >= 0) {
          this.widgets.splice(idx, 1);
          this.widgets.splice(idx, 0, w);
        }
      };

      this.addOutput("*", "*");
    }

    onDrawForeground(ctx) {
      super.onDrawForeground?.(ctx);
      paintReadout(this, ctx);
    }

    onConnectionsChange() {
      // Skip during load + the post-configure link-restore (Vue Compat #19).
      if (app.configuringGraph || isGraphLoading()) return;
      this.validateLinks();
    }

    setName(name) {
      this.widgets[0].value = name;
      this.onRename();
    }

    setType(type) {
      this.outputs[0].type = type;
      this.outputs[0].name = type;
      this.validateLinks();
    }

    onRename() {
      const setter = this.findSetter(this.graph);
      const name = this.widgets[0].value;
      if (setter) {
        this.setType(firstWiredInput(setter)?.type ?? "*");
        this.title = `Get: ${name}`;
      } else {
        this.setType("*");
        this.title = name ? `Get: ${name}` : "Get Pixaroma";
      }
      inheritSetColor(this); // take the chosen Set's colour
      refreshValue(this);
      app.canvas?.setDirty(true, true);
    }

    // Drop any output links whose target type is now incompatible.
    validateLinks() {
      const out = this.outputs?.[0];
      if (!this.graph || !out || out.type === "*" || !out.links) return;
      for (const linkId of [...out.links]) {
        const link = getLink(this.graph, linkId);
        if (!link) continue;
        const target = this.graph.getNodeById(link.target_id);
        const tType = target?.inputs?.[link.target_slot]?.type;
        if (tType && tType !== "*" && !String(tType).split(",").includes(out.type)) {
          this.graph.removeLink(linkId);
        }
      }
    }

    findSetter(graph) {
      const r = findSetterByName(graph, this.widgets[0].value);
      return r ? r.node : undefined;
    }

    // Classic prompt path: same-graph resolution. Returns the link feeding the
    // matching Set's input, so the prompt builder reads straight through.
    getInputLink(slot) {
      const name = this.widgets[0].value;
      if (!name) return null;
      const setter = this.graph?._nodes?.find(
        (n) => n.type === SET_TYPE && n.widgets?.[0]?.value === name
      );
      if (!setter) return null;
      // Read the Set's first WIRED input, not a fixed slot, so a stale duplicate
      // input slot on the Set can't make the Get resolve to nothing.
      const slotInfo = firstWiredInput(setter);
      if (!slotInfo || slotInfo.link == null) return null;
      return getLink(this.graph, slotInfo.link);
    }

    // Subgraph-aware path (native in 1.45.15). Returns the REAL source
    // {node, slot} for a cross-graph Set; returns undefined for same-graph so
    // the classic getInputLink path above handles it.
    resolveVirtualOutput(slot) {
      const result = findSetterByName(this.graph, this.widgets[0].value);
      if (!result) return undefined;
      if (result.graph === this.graph) return undefined;
      const { node: setter, graph: setterGraph } = result;
      const slotInfo = firstWiredInput(setter);
      if (!slotInfo || slotInfo.link == null) return undefined;
      const link = getLink(setterGraph, slotInfo.link);
      if (!link) return undefined;
      const src = setterGraph.getNodeById(link.origin_id);
      if (!src) return undefined;
      return { node: src, slot: link.origin_slot };
    }

    onAdded() {
      ensureValueWidget(this);
      this._justAdded = true;
    }

    onConfigure() {
      if (this._justAdded && !app.configuringGraph && this.widgets[0].value) {
        // If our paired Set was de-duplicated during this same paste, follow it.
        const renamed = pasteRenameMap.get(this.widgets[0].value);
        if (renamed) this.widgets[0].value = renamed;
        // Restore type/title from the setter after a paste (skip if removed).
        setTimeout(() => {
          if (this.graph) this.onRename();
        }, 0);
      }
      this._justAdded = false;
      refreshValue(this);
    }

    clone() {
      const cloned = super.clone();
      if (cloned.outputs?.[0]) {
        cloned.outputs[0].type = "*";
        cloned.outputs[0].name = "*";
      }
      return cloned;
    }

    goToSetter() {
      const setter = this.currentSetter;
      if (!setter) return;
      const canvas = app.canvas;
      const setterGraph = setter.graph;
      if (setterGraph && setterGraph !== this.graph && canvas?.setGraph) {
        canvas.setGraph(setterGraph);
        setTimeout(() => {
          canvas.centerOnNode?.(setter);
          canvas.selectNode?.(setter, false);
          canvas.setDirty(true, true);
        }, 0);
      } else {
        canvas?.centerOnNode?.(setter);
        canvas?.selectNode?.(setter, false);
        canvas?.setDirty(true, true);
      }
    }

    getExtraMenuOptions(_, options) {
      this.currentSetter = this.findSetter(this.graph);
      if (!this.currentSetter) return;
      const sameGraph = this.currentSetter.graph === this.graph;
      const isRoot = this.currentSetter.graph === findRootGraph(this.graph);
      options.unshift({
        content: sameGraph
          ? "Jump to its Set Pixaroma"
          : `Jump to its Set (in ${isRoot ? "parent graph" : "subgraph"})`,
        callback: () => this.goToSetter(),
      });
    }
  }

  LiteGraph.registerNodeType(GET_TYPE, PixaromaGetNode);
}
