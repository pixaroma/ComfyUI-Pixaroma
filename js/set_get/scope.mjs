// ╔═══════════════════════════════════════════════════════════════╗
// ║  Set / Get Pixaroma - cross-graph scope helpers               ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// PRIVATE NAMESPACE: every helper here scans ONLY PixaromaSetNode /
// PixaromaGetNode. It never touches any other pack's Set/Get-style nodes, so
// they coexist in one workflow with zero interference.
//
// Subgraph scoping (the model the user picked):
//   - A Set is visible to its own graph AND every nested child subgraph
//     (propagates DOWN).
//   - A Get searches its own graph FIRST, then parent, grandparent, ... root
//     (looks UP).
//   - Duplicate names are allowed in unrelated (sibling) subgraphs.
//
// The traversal is verified against the native resolveVirtualOutput path in
// frontend 1.45.15, so subgraph flattening at submission "just works".

export const SET_TYPE = "PixaromaSetNode";
export const GET_TYPE = "PixaromaGetNode";

// Paste coordination: when a pasted Set's name is de-duplicated (foo -> foo_0),
// it records old->new here so the Set+Get pasted together stay paired. Both
// nodes' onConfigure run synchronously within the same paste cycle, before the
// setTimeout(0) clears the entry.
export const pasteRenameMap = new Map();

// Compat: graph.links/_links may be a Map or a plain object depending on the
// litegraph version. `== null` intentionally catches both null and undefined.
export function getLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  if (typeof graph.getLink === "function") return graph.getLink(linkId);
  const store = graph._links ?? graph.links;
  if (store instanceof Map) return store.get(linkId) ?? null;
  return store?.[linkId] ?? null;
}

// The Set node has ONE meaningful value input, but older workflows can carry a
// stale DUPLICATE input slot (a phantom "value" input ComfyUI used to re-add from
// the Python def). Resolve the FIRST input that actually has a wire, so the value
// transmits no matter which slot it ended up on; fall back to slot 0.
export function firstWiredInput(node) {
  const ins = node?.inputs;
  if (!ins || !ins.length) return null;
  for (const inp of ins) { if (inp && inp.link != null) return inp; }
  return ins[0] || null;
}

export function findRootGraph(graph) {
  if (!graph) return null;
  return graph.rootGraph || graph;
}

// Which SubgraphNode in parentGraph wraps the graph that holds innerNode.
export function findSubgraphNodeFor(parentGraph, innerNode) {
  if (!parentGraph?._nodes || !innerNode?.graph) return null;
  for (const n of parentGraph._nodes) {
    if (n.subgraph && n.subgraph === innerNode.graph) return n;
  }
  return null;
}

// Every live graph in the workflow: root + every nested subgraph instance, at
// any depth. Enumerated by walking real SubgraphNode.subgraph references (the
// same source getGraphDescendants uses), so it does NOT depend on the internal
// semantics of root._subgraphs - robust for deeply nested subgraphs.
export function allLiveGraphs(graph) {
  const root = findRootGraph(graph);
  if (!root) return [];
  return [root, ...getGraphDescendants(root)];
}

// The graph that directly contains a SubgraphNode wrapping `inner`, or null.
function findParentGraph(inner, root) {
  for (const g of allLiveGraphs(root)) {
    if (g === inner) continue;
    for (const n of g._nodes || []) {
      if (n.subgraph === inner) return g;
    }
  }
  return null;
}

// Walk from a graph up to root: [graph, parent, grandparent, ..., root].
// Walks UP by repeatedly finding the parent among the live graphs, so it
// handles arbitrary nesting depth (not just one level).
export function getGraphAncestors(graph) {
  if (!graph) return [];
  const root = findRootGraph(graph);
  if (!root || graph === root) return [root];

  const chain = [graph];
  const visited = new Set([graph]);
  let current = graph;
  while (current !== root) {
    const parent = findParentGraph(current, root);
    if (!parent || visited.has(parent)) break;
    visited.add(parent);
    chain.push(parent);
    current = parent;
  }
  if (!chain.includes(root)) chain.push(root);
  return chain;
}

// All descendant subgraphs of a graph (children, grandchildren, ...).
export function getGraphDescendants(graph, _visited) {
  if (!graph?._nodes) return [];
  const visited = _visited || new Set();
  if (visited.has(graph)) return [];
  visited.add(graph);
  const out = [];
  for (const n of graph._nodes) {
    if (n.subgraph && !visited.has(n.subgraph)) {
      out.push(n.subgraph);
      out.push(...getGraphDescendants(n.subgraph, visited));
    }
  }
  return out;
}

export function collectNodesOfType(graphs, type) {
  const out = [];
  for (const g of graphs) {
    if (!g?._nodes) continue;
    for (const node of g._nodes) {
      if (node.type === type) out.push({ node, graph: g });
    }
  }
  return out;
}

// Every node of `type` across root + all nested subgraphs. Used for global ops.
export function findAllNodesOfType(graph, type) {
  return collectNodesOfType(allLiveGraphs(graph), type);
}

// Scoped setter lookup: own graph first, then ancestors (look UP).
export function findSetterByName(graph, name) {
  if (!name) return null;
  for (const g of getGraphAncestors(graph)) {
    if (!g?._nodes) continue;
    for (const node of g._nodes) {
      if (node.type === SET_TYPE && node.widgets?.[0]?.value === name) {
        return { node, graph: g };
      }
    }
  }
  return null;
}

// Scoped getter lookup: own graph + descendants (propagate DOWN).
export function findGettersByName(graph, name) {
  if (!name) return [];
  const graphs = [graph, ...getGraphDescendants(graph)];
  return collectNodesOfType(graphs, GET_TYPE)
    .filter((e) => e.node.widgets?.[0]?.value === name);
}

// Visible Set names for a Get's dropdown: own graph + ancestors (what's in
// scope), de-duplicated, sorted. No type filtering (the user picks freely).
export function getVisibleSetNames(graph) {
  const seen = new Set();
  for (const e of collectNodesOfType(getGraphAncestors(graph), SET_TYPE)) {
    const name = e.node.widgets?.[0]?.value;
    if (name) seen.add(name);
  }
  return [...seen].sort();
}

// Force every Get node (root + all subgraphs) to re-read its combo values.
// Needed in Nodes 2.0 (Vue) where the combo options are cached until the
// widget.options reference changes.
//
// Re-splicing every Get's combo widget forces a Vue re-extraction; doing it on
// every reconnect / generation is pure churn (and the window that amplifies the
// value-loss race). So skip when the set of visible Set names is UNCHANGED -
// only a Set add / remove / rename can change what a dropdown should list.
let _lastComboSig = null;
export function refreshAllGetCombos(graph) {
  const graphs = allLiveGraphs(graph);
  const names = new Set();
  for (const g of graphs) {
    for (const node of g._nodes || []) {
      if (node.type === SET_TYPE) {
        const v = node.widgets?.[0]?.value;
        if (v) names.add(v);
      }
    }
  }
  const sig = [...names].sort().join(String.fromCharCode(1));
  if (sig === _lastComboSig) return;
  _lastComboSig = sig;
  for (const g of graphs) {
    for (const node of g._nodes || []) {
      if (node.type === GET_TYPE) node._refreshComboOptions?.();
    }
  }
}
