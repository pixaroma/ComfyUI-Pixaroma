import { app } from "/scripts/app.js";

// Shared "is a workflow currently loading?" guard.
//
// WHY THIS EXISTS: LiteGraph restores saved wires at the GRAPH level AFTER each
// node's onConfigure has returned (and cleared any per-node "configuring"
// flag). So a node that mutates SERIALIZED state inside onConnectionsChange -
// activeIndex, node.size, slots, node.properties - has its just-restored saved
// state overwritten by that connection replay, UNLESS it suppresses the replay.
// A per-node onConfigure flag is NOT enough: it is already cleared by the time
// the graph-level replay fires. This bit Switch (issue #40), Image Resize, and
// Crop - the active selection / wire / persisted source reset on every reload,
// tab switch, and Ctrl+Z undo.
//
// THE FIX: wrap app.loadGraphData (the single funnel for workflow open, tab
// switch, and Ctrl+Z undo) exactly once, holding a flag true for the whole load
// plus a 300ms trailing window for the link restore that settles a tick later.
// Any load-sensitive onConnectionsChange mutation should be gated on
// `!isGraphLoading()` (in addition to whatever per-node flag it already uses).
//
// Usage:
//   import { isGraphLoading } from "../shared/graph_loading.mjs";
//   nodeType.prototype.onConnectionsChange = function (type, idx, connected) {
//     if (type === LiteGraph.INPUT && !isGraphLoading()) { ...mutate state... }
//   };
let _loading = false;

if (app && app.loadGraphData && !app._pixGraphLoadWrapped) {
  app._pixGraphLoadWrapped = true;
  const _origLoadGraphData = app.loadGraphData.bind(app);
  app.loadGraphData = function (...args) {
    _loading = true;
    let r;
    try {
      r = _origLoadGraphData(...args);
    } finally {
      // loadGraphData may be sync or async; clear after it settles + a short
      // trailing window so the graph-level link restore is fully covered.
      Promise.resolve(r).finally(() => setTimeout(() => { _loading = false; }, 300));
    }
    return r;
  };
}

export function isGraphLoading() {
  return _loading;
}
