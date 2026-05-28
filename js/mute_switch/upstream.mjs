// Pure-function graph helpers for Mute Switch Pixaroma.
// No browser globals - safe to import under both ComfyUI and Node.
//
// v2: "mute only the directly connected node, cascade through Mute Switch
// targets". No BFS up the whole chain - we rely on ComfyUI's lazy executor
// to skip the upstream chain naturally (a node with no consumer doesn't run).
// The only walk that DOES happen is through inner Mute Switches (chaining).

// graphLinks may be a plain object keyed by id, OR a Map (Vue Compat #3).
function getLink(graphLinks, linkId) {
  if (!graphLinks || linkId == null) return null;
  if (typeof graphLinks.get === "function") return graphLinks.get(linkId);
  return graphLinks[linkId] || null;
}

// Returns the upstream node wired into `slot`, or null when disconnected.
export function getUpstreamNode(slot, nodesById, graphLinks) {
  if (!slot) return null;
  const linkId = slot.link;
  if (linkId == null) return null;
  const link = getLink(graphLinks, linkId);
  if (!link) return null;
  return nodesById[link.origin_id] || null;
}

// Compute the set of node IDs that `switchNode` wants muted.
// For each OFF row, cascade-mute the directly-wired upstream node:
//   - regular node:  add it to the set, stop.
//   - Mute Switch:   add it AND every node wired into ITS inputs (recursive).
//
// Cycle protection via visited set. `isMuteSwitch(node)` is the predicate.
export function cascadeMuteSet(switchNode, nodesById, graphLinks, isMuteSwitch) {
  const out = new Set();
  if (!switchNode) return out;
  const state = switchNode.properties?.muteSwitchState;
  if (!state || !Array.isArray(state.rows)) return out;

  const visited = new Set();
  // Don't ever cascade-mute the calling switch itself - we'd be muting
  // the source of truth.
  visited.add(switchNode.id);

  function cascade(target) {
    // target.id == null guards against pre-LG-assignment construction races
    // and against null-id collisions in the visited Set.
    if (!target || target.id == null) return;
    if (visited.has(target.id)) return;
    visited.add(target.id);
    out.add(target.id);

    if (isMuteSwitch(target)) {
      // Recurse into target's wired inputs.
      for (const slot of target.inputs || []) {
        const upstream = getUpstreamNode(slot, nodesById, graphLinks);
        if (upstream) cascade(upstream);
      }
    }
  }

  for (let i = 0; i < state.rows.length; i++) {
    if (state.rows[i].enabled) continue;
    const slot = switchNode.inputs?.[i];
    const upstream = getUpstreamNode(slot, nodesById, graphLinks);
    if (upstream) cascade(upstream);
  }

  return out;
}

// Union of every Mute Switch's wantMuted set in the graph. Returns
// Map<nodeId(string), targetMode> where targetMode is 2 (mute) or 4 (bypass).
// On collisions, the later switch's mode wins; functionally either works.
export function resolveAllMutes(switches, nodesById, graphLinks, isMuteSwitch) {
  const wantMuted = new Map();
  for (const sw of switches) {
    const state = sw.properties?.muteSwitchState;
    if (!state) continue;
    const targetMode = state.muteMode === "bypass" ? 4 : 2;
    const set = cascadeMuteSet(sw, nodesById, graphLinks, isMuteSwitch);
    for (const id of set) {
      wantMuted.set(String(id), targetMode);
    }
  }
  return wantMuted;
}
