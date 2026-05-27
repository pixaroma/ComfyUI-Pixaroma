// Shared guard for Pixaroma "queue-driver" nodes (Prompt Multi, Prompt Pack).
//
// Both nodes monkey-patch app.queuePrompt at module-load time to loop the Run
// once per prompt/row. Two failure modes this module guards against:
//
// 1. MULTIPLICATION. The patches are global (one per node TYPE, installed at
//    load) and they CHAIN: each wrapper's "original" is the next plugin's
//    wrapper. So with both a Prompt Multi node AND a Prompt Pack node present,
//    the outer wrapper loops N times and each iteration re-enters the inner
//    wrapper which loops M times -> N*M submissions (3 rows * 3 prompts = 9).
//    Fix: a shared re-entrancy lock. Whichever wrapper starts looping first
//    holds the lock; any nested Pixaroma queue wrapper sees the lock and falls
//    through to a single pass-through call instead of looping again.
//
// 2. INACTIVE SWITCH BRANCH. A Switch Pixaroma routes only ONE of its inputs
//    to its output per run, but a driver only checks "am I wired to anything?"
//    - so several drivers wired into one Switch all think they drive the run.
//    Fix: feedsOnlyInactiveSwitch() - a driver whose every output link lands
//    on a Switch input that is NOT the Switch's active input can't reach any
//    output this run, so it must sit the run out.

const SWITCH_CLASS = "PixaromaSwitch";
const SWITCH_STATE_PROP = "switchState";

// ---- Re-entrancy lock (shared across all importers; ESM module singleton) ----

let _looping = false;

// True while a Pixaroma queue-driver is mid-loop. A nested driver wrapper
// should pass straight through to its original instead of starting its own
// loop (otherwise the loops multiply).
export function isQueueLoopActive() {
  return _looping;
}

// Low-level lock control for callers that already own a try/finally around
// their submission loop (Prompt Pack tracks a batch counter there). ALWAYS
// pair beginQueueLoop() with endQueueLoop() in a finally.
export function beginQueueLoop() {
  _looping = true;
}
export function endQueueLoop() {
  _looping = false;
}

// Run `fn` (the per-row / per-prompt submission loop) while holding the lock.
// The finally guarantees the lock is released even if a submission throws, so
// a failed batch can never wedge the Run button into permanent pass-through.
export async function runQueueLoop(fn) {
  beginQueueLoop();
  try {
    return await fn();
  } finally {
    endQueueLoop();
  }
}

// ---- Switch-aware suppression -------------------------------------------------

function getLink(graph, linkId) {
  // graph.links can be a plain object OR a Map depending on ComfyUI version
  // (Vue Compat #3).
  let link = graph.links?.[linkId];
  if (!link && typeof graph.links?.get === "function") link = graph.links.get(linkId);
  return link || null;
}

function isInactiveSwitchTarget(targetNode, targetSlot) {
  if (!targetNode) return false;
  const isSwitch = targetNode.comfyClass === SWITCH_CLASS || targetNode.type === SWITCH_CLASS;
  if (!isSwitch) return false;
  const active = targetNode.properties?.[SWITCH_STATE_PROP]?.activeIndex;
  // If we can't read the active index, treat the link as live (don't suppress).
  // Better to over-run than to silently drop the user's prompt.
  if (typeof active !== "number") return false;
  // Switch input slots are input_1..N: slot index is 0-based, activeIndex is
  // 1-based, so the active slot is the one where (slot + 1) === activeIndex.
  return (targetSlot + 1) !== active;
}

// Returns true ONLY when the node has output links AND every one of them lands
// on an inactive input of a Switch Pixaroma. Such a node cannot reach any
// output this run, so it must not drive the queue. Returns false when the node
// has no links (the caller's connected-check handles that), or when any link
// reaches a non-Switch target or the Switch's active input, or when anything
// can't be resolved (fail open - never suppress on uncertainty).
export function feedsOnlyInactiveSwitch(node) {
  try {
    const graph = node?.graph;
    if (!graph) return false;
    const outs = node.outputs || [];
    let sawLink = false;
    for (const o of outs) {
      const links = (o && Array.isArray(o.links)) ? o.links : [];
      for (const linkId of links) {
        const link = getLink(graph, linkId);
        if (!link) return false; // unresolved link -> assume live
        sawLink = true;
        const target = graph.getNodeById?.(link.target_id);
        if (!isInactiveSwitchTarget(target, link.target_slot)) {
          return false; // at least one live destination
        }
      }
    }
    return sawLink; // had links and ALL were inactive-switch
  } catch (_e) {
    return false; // fail open
  }
}
