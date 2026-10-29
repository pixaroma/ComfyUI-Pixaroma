// Number Pick Pixaroma - taking the type from whatever it is wired to.
//
// The user's question when this node was designed: "if we connect to one input
// that has float will work? like for example i have 24fps... or we need two
// output for int and float?". One output, and it fits the wire.
//
// THE SLOT TYPE IS ALWAYS "INT,FLOAT" AND IS NEVER NARROWED. LiteGraph reads a
// comma-joined type as a LIST of accepted names (Vue Compat #22, the same
// mechanism behind core's multi-type inputs and Dropdown's "STRING,COMBO"), and
// that one decision buys three things at once. MEASURED live, not assumed:
//   isValidConnection("INT,FLOAT", "INT")               -> true
//   isValidConnection("INT,FLOAT", "FLOAT")             -> true
//   isValidConnection("INT,FLOAT", "FLOAT,INT,BOOLEAN") -> true   (core's multi)
//   isValidConnection("INT,FLOAT", "MODEL" / "IMAGE" / "STRING") -> FALSE
// So: it reaches every numeric input, LiteGraph refuses a nonsensical wire for
// us with no disconnect logic and no toast, and one node can drive a whole
// number AND a decimal at the same time.
//
// ⚠ Do NOT "improve" this by narrowing the slot to the adopted type. MEASURED:
// isValidConnection("INT", "FLOAT") is FALSE, so a node that had adopted `int`
// could never be wired to a decimal input again without being unplugged first -
// which is exactly the "stuck as one type" bug sliders.md #13 was written about.
//
// What IS adopted is only `out`, the type Python emits the number as. Nothing
// about the canvas depends on it, so a wrong guess can never sever a wire.

import { narrowSlotType, slotTypeList } from "../shared/slot_types.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { OUT_AUTO, OUT_INT, OUT_FLOAT, readState, writeState } from "./core.mjs";

export const SLOT_TYPE = "INT,FLOAT";

const OWN_TYPES = slotTypeList(SLOT_TYPE).sort().join(",");

/**
 * True for an input that took OUR type: a pass-through such as Set Pixaroma
 * copies "INT,FLOAT" from this node onto its input. Behind it a Get may feed a
 * whole number AND a decimal, so it counts as wanting both kinds, never one.
 * Read through narrowSlotType it was a FLOAT vote, and a Set fed by this node
 * made it send 4.0 into a whole-number input further on (EmptyLatentImage
 * batch_size crashed in a real Run, Discord 2026-10-29). Not a no-vote either:
 * then a direct wire beside the Set wins alone (1.5 sent as 2 to a Get-fed
 * megapixels). A core input typed exactly "FLOAT,INT" matches too, harmlessly.
 */
function mirrorsOurType(type) {
  return slotTypeList(type).sort().join(",") === OWN_TYPES;
}

/** Resolve a link id to its link object; graph.links can be a Map (Vue #3). */
function linkOf(graph, id) {
  if (id == null) return null;
  let link = graph?.links?.[id];
  if (!link && typeof graph?.links?.get === "function") link = graph.links.get(id);
  return link || null;
}

function nodeById(graph, id) {
  return graph?.getNodeById?.(id) || null;
}

/**
 * What every wired target wants, as ONE answer.
 *
 * Unanimously whole numbers -> int. Unanimously decimals -> float. Anything
 * else - nothing wired, a wildcard or pass-through target, or a mix of both
 * kinds - stays `auto`, which sends a whole number whole and a decimal as a
 * decimal. That is the safe answer for a mixed wiring: a Python int is accepted
 * everywhere a float is wanted, while a float landing in a whole-number input
 * is the case that actually breaks things.
 */
export function wantedOut(node) {
  const graph = node?.graph;
  const out = node?.outputs?.[0];
  if (!graph || !out || !Array.isArray(out.links) || !out.links.length) return OUT_AUTO;

  let sawInt = false;
  let sawFloat = false;
  for (const id of out.links) {
    const link = linkOf(graph, id);
    if (!link) continue;
    const target = nodeById(graph, link.target_id);
    const input = target?.inputs?.[link.target_slot];
    if (!input) continue;
    if (mirrorsOurType(input.type)) { sawInt = sawFloat = true; continue; }
    // Vue Compat #22: NEVER compare a slot type with ===. A V3 multi-type input
    // arrives as the comma-joined "FLOAT,INT,BOOLEAN", and narrowSlotType is
    // what turns that into the one type a single control should adopt.
    const t = narrowSlotType(input.type);
    if (t === "INT") sawInt = true;
    else if (t === "FLOAT") sawFloat = true;
    // Anything else (a wildcard pass-through, a combo) votes for nothing.
  }
  if (sawInt && !sawFloat) return OUT_INT;
  if (sawFloat && !sawInt) return OUT_FLOAT;
  return OUT_AUTO;
}

/**
 * Re-read the wires and store the type, if it changed.
 *
 * `out` is SERIALIZED state, so this must never run on the load path: a write
 * while a workflow opens flags an untouched file "modified" (Vue Compat #18),
 * and the connection replay fires for every wired slot during configure AND
 * again at graph level afterwards (Vue Compat #17 + #19), which is why both
 * gates are here rather than just one.
 */
export function refreshOut(node) {
  if (!node || node._pixNpConfiguring || isGraphLoading()) return false;
  const st = readState(node);
  const want = wantedOut(node);
  if (st.out === want) return false; // idempotent: no write, no dirty
  writeState(node, { out: want });
  return true;
}

/**
 * Keep the output slot saying "INT,FLOAT".
 *
 * Idempotent on purpose - `output.type` is serialized, so writing it
 * unconditionally on every configure would be a load-path mutation. A node
 * saved before this existed carries "*" and is corrected once, on the first
 * user action rather than during the load itself.
 */
export function ensureSlotType(node, { allowWrite = true } = {}) {
  const out = node?.outputs?.[0];
  if (!out || out.type === SLOT_TYPE) return false;
  if (!allowWrite) return false;
  out.type = SLOT_TYPE;
  return true;
}
