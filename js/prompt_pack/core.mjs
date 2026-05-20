// Prompt Pack Pixaroma - state + parsing module.
//
// State lives on node.properties.promptPackState.
// Shape: {
//   version: 1,
//   mode: "paragraph" | "line",
//   text: "...",          // raw textarea content
//   activePrompt: ""      // transient, set per queue iteration
// }
//
// LiteGraph serializes node.properties natively into workflow JSON, so save
// and reload are automatic. The graphToPrompt hook in index.js packs
// activePrompt into the hidden PromptPackState input at workflow-submit time.
// The queuePrompt patch in index.js mutates activePrompt right before each
// per-prompt enqueue.
//
// activePrompt is transient. The saved value on disk is whatever the last
// loop iteration left behind and is not relied on at workflow load - the
// next Run overwrites it before any prompt is captured.

export const STATE_PROP = "promptPackState";
export const MODE_PARAGRAPH = "paragraph";
export const MODE_LINE = "line";

// Paragraph mode: split on one or more blank lines. A "blank line" is any
// sequence of \n + optional whitespace + \n. This matches the common
// "long prompt per paragraph" use case.
const PARA_SPLIT_RE = /\n\s*\n+/;

export function defaultState() {
  return {
    version: 1,
    mode: MODE_PARAGRAPH,
    text: "",
    activePrompt: "",
  };
}

export function readState(node) {
  const s = node.properties?.[STATE_PROP];
  if (!s || typeof s !== "object") return defaultState();
  // Defensive normalisation against hand-edited workflow JSON.
  if (s.mode !== MODE_PARAGRAPH && s.mode !== MODE_LINE) s.mode = MODE_PARAGRAPH;
  if (typeof s.text !== "string") s.text = "";
  if (typeof s.activePrompt !== "string") s.activePrompt = "";
  s.version = 1;
  return s;
}

export function writeState(node, state) {
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = state;
}

export function setMode(node, mode) {
  if (mode !== MODE_PARAGRAPH && mode !== MODE_LINE) return;
  const state = readState(node);
  state.mode = mode;
  writeState(node, state);
}

export function setText(node, text) {
  const state = readState(node);
  state.text = String(text || "");
  writeState(node, state);
}

// Parse a text block into individual prompts.
//
// Paragraph mode: split on one or more blank lines.
// Line mode: split on every newline.
// Both modes: .trim() each piece and drop empties so the count reflects
// what will actually queue.
export function parsePrompts(text, mode) {
  if (typeof text !== "string" || !text) return [];
  const splitter = (mode === MODE_LINE) ? "\n" : PARA_SPLIT_RE;
  return text
    .split(splitter)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// Convenience: count of parsed prompts from current node state.
export function countPrompts(node) {
  const state = readState(node);
  return parsePrompts(state.text, state.mode).length;
}

// restoreFromProperties: ensures node.properties.promptPackState exists with
// defaults and applies readState normalization.
export function restoreFromProperties(node) {
  writeState(node, readState(node));
}

// A node only "drives the queue" if it is actually part of the workflow
// being run. A Prompt Pack node that is muted/bypassed OR not wired to
// anything must NOT intercept the Run - otherwise an empty leftover node
// sitting on the canvas blocks every unrelated workflow with the "Paste at
// least one prompt to run" toast (GitHub issue #39).
//
// mode 2 = muted (LiteGraph NEVER), mode 4 = bypass (ComfyUI). Anything
// else (0 / undefined) counts as active.
function isPackNodeActive(node) {
  return node.mode !== 2 && node.mode !== 4;
}

// Connected = at least one output slot has a live link. Prompt Pack's only
// output is `text`; if it isn't wired, the node feeds nothing and should be
// ignored by the queue loop.
function isPackNodeConnected(node) {
  const outs = node.outputs || [];
  for (const o of outs) {
    if (o && Array.isArray(o.links) && o.links.length > 0) return true;
  }
  return false;
}

function isPackNodeDriving(node) {
  if (!node) return false;
  const isClass = node.comfyClass === "PixaromaPromptPack" || node.type === "PixaromaPromptPack";
  return isClass && isPackNodeActive(node) && isPackNodeConnected(node);
}

// Find the first PixaromaPromptPack node that actually drives the queue
// (active + connected), top-level pass first, then subgraph recursion. Used
// by the queuePrompt patch in index.js. Returns null when no participating
// node exists, so the patch falls through to a normal single run.
export function findFirstPromptPackNode(app) {
  const graph = app.graph;
  if (!graph) return null;
  const top = graph._nodes || graph.nodes || [];
  for (const n of top) {
    if (isPackNodeDriving(n)) return n;
  }
  function walk(nodes) {
    for (const n of nodes || []) {
      if (isPackNodeDriving(n)) return n;
      const sub = n?.subgraph?._nodes || n?.subgraph?.nodes;
      if (sub) {
        const hit = walk(sub);
        if (hit) return hit;
      }
    }
    return null;
  }
  return walk(top);
}
