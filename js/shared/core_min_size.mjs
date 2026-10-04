// Classic: the height core itself wants for a node, so a fresh drop can start there.
//
// Core's loadGraphData grows EVERY node to max(size, computeSize()) on every open,
// tab load and Ctrl+Z, right before the change tracker's snapshot. computeSize counts
// 4px under each widget, 8px under the last one and 6px more, which a node sized to
// its content does not (a DOM widget body came out 12px short: Paint 300 vs 312).
// A saved workflow takes that grow on open, before the snapshot, so it never reads
// "modified". A FRESH drop does not: its first Ctrl+Z grows it, the next click
// records the grow as a new step, and that wipes the redo history (the undo jam
// the all-nodes live suite found on 12 node types in Classic, 2026-10-04, VC#28).
// Starting a fresh node at
// core's height makes the drop look exactly like the same node after a reopen.
//
// Nodes 2.0 is left alone: its frame owns the size there (cap computeSize at
// node.size instead, run-timer.md #15). Never on the load path (VC#18): configure()
// restores the saved size after onNodeCreated anyway.

import { isGraphLoading } from "./graph_loading.mjs";
import { isVueNodes } from "./nodes2.mjs";

// The height core's computeSize() asks for, or 0 when there is nothing to match
// (Nodes 2.0, a workflow loading, no computeSize).
export function coreMinHeight(node) {
  if (isVueNodes() || isGraphLoading() || typeof node?.computeSize !== "function") return 0;
  const cs = node.computeSize();
  return Array.isArray(cs) && Number.isFinite(cs[1]) ? cs[1] : 0;
}

// Fresh drop: raise node.size[1] to core's height. Call it once every widget the
// node starts with exists (computeSize sums them).
export function growToCoreMinHeight(node) {
  if (!node?.size) return;
  const h = coreMinHeight(node);
  if (h > node.size[1]) node.size[1] = h;
}
