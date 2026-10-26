// A wire that starts at a subgraph's own INPUT node: how ComfyUI shows a widget
// on the OUTSIDE of a subgraph (the eye in the side panel, "Promote Widget" on a
// widget's right-click menu, and the automatic promotion when a selection is
// turned into a subgraph). Nodes that refuse every incoming wire (Text, Load
// Image, Info...) let this one through, or promoting their widget fails with no
// way around it (Discord 2026-10-25, Text Pixaroma's "text").
//
// Core (frontend 1.55.18, SubgraphInput.connect): onConnectInput(inputIndex,
// type, subgraphInput, subgraphInputNode, -1). A normal wire comes from
// LGraphNode.connect with the source node and an output index >= 0. The
// subgraph input node's id is SUBGRAPH_INPUT_ID = -10 (litegraph constants.ts;
// node ids are strings since 1.53, so compare as a number).
const SUBGRAPH_INPUT_ID = -10;

export function isSubgraphInputWire(outputNode, outputIndex) {
  return outputIndex === -1 && outputNode != null && Number(outputNode.id) === SUBGRAPH_INPUT_ID;
}

// True when this input is fed by the subgraph's input node, i.e. the widget is
// shown on the subgraph's outside and its value comes from there.
export function isFedBySubgraphInput(node, input) {
  if (!input || input.link == null) return false;
  const links = node?.graph?.links;
  const link = links?.get ? links.get(input.link) : links?.[input.link];
  return link != null && Number(link.origin_id) === SUBGRAPH_INPUT_ID;
}
