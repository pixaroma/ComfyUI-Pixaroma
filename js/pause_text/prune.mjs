// Pause Text Pixaroma - prompt-prune helpers (pure, ComfyUI-free).
//
// Adapted from Pause Image's tested prune.mjs (same gate machinery), with two
// differences: the gated input is "text" (STRING), not "image", and the CONTINUE
// branch carries the user's EDITED text into the hidden PauseState so Python can
// output it once the input wire is pruned away.
//
// These operate on a ComfyUI API prompt object `out` (id -> {class_type, inputs})
// exactly as produced by app.graphToPrompt().output, so they unit-test in Node
// (<scratchpad>/test_pause_text_prune.mjs) without importing /scripts/app.js.

// A ComfyUI prompt input link is EXACTLY [originNodeId, originSlot].
export function isLink(v) {
  return Array.isArray(v) && v.length === 2
    && (typeof v[0] === "string" || typeof v[0] === "number")
    && typeof v[1] === "number";
}

// Build origin -> Set(consumerIds) from the prompt.
export function buildConsumers(output) {
  const consumers = new Map();
  for (const id in output) {
    const inputs = output[id]?.inputs;
    if (!inputs) continue;
    for (const k in inputs) {
      if (!isLink(inputs[k])) continue;
      const origin = String(inputs[k][0]);
      if (!consumers.has(origin)) consumers.set(origin, new Set());
      consumers.get(origin).add(String(id));
    }
  }
  return consumers;
}

// Forward BFS from startId; the set of all nodes reachable downstream (excl. start).
export function collectDownstream(consumers, startId) {
  const seen = new Set();
  const stack = [String(startId)];
  while (stack.length) {
    const cur = stack.pop();
    const next = consumers.get(cur);
    if (!next) continue;
    for (const c of next) {
      if (!seen.has(c)) { seen.add(c); stack.push(c); }
    }
  }
  return seen;
}

// Grow `keep` to include every ancestor of every node already in it.
export function addAncestors(output, keep) {
  const stack = [...keep];
  while (stack.length) {
    const cur = stack.pop();
    const inputs = output[cur]?.inputs;
    if (!inputs) continue;
    for (const k in inputs) {
      if (!isLink(inputs[k])) continue;
      const origin = String(inputs[k][0]);
      if (output[origin] && !keep.has(origin)) {
        keep.add(origin);
        stack.push(origin);
      }
    }
  }
}

// Apply one gate's effective mode to the prompt `out`.
//   opts = { inputKey = "text", editedText = "" }
// `isOutput(classType)` returns true iff a class_type is an OUTPUT_NODE. On
// Continue only the OTHER output nodes are deleted; every non-output node is left
// as a harmless orphan (never validated, never run) so downstream Save nodes keep
// full generation metadata - identical rationale to Pause Image.
export function applyGateMode(out, id, entry, mode, isOutput, HIDDEN_INPUT = "PauseState", opts = {}) {
  const inputKey = opts.inputKey || "text";
  const editedText = typeof opts.editedText === "string" ? opts.editedText : "";
  entry.inputs = entry.inputs || {};

  if (mode === "pause") {
    // Stop the run at the gate: delete everything downstream so the gate (an
    // OUTPUT_NODE) is this branch's endpoint. Parallel branches are untouched.
    const consumers = buildConsumers(out);
    const downstream = collectDownstream(consumers, id);
    for (const d of downstream) delete out[d];
    // Keep the box text alongside the mode so an UNWIRED pause keeps the box.
    entry.inputs[HIDDEN_INPUT] = JSON.stringify({ mode: "pause", text: editedText });
  } else if (mode === "continue") {
    // Skip the upstream ENTIRELY and run only the rest from the edited text.
    const gateSrc = isLink(entry.inputs[inputKey])
      ? [String(entry.inputs[inputKey][0]), Number(entry.inputs[inputKey][1])]
      : null;

    delete entry.inputs[inputKey];
    entry.inputs[HIDDEN_INPUT] = JSON.stringify({ mode: "continue", text: editedText });

    const consumers = buildConsumers(out);
    const downstream = collectDownstream(consumers, id);

    // Diamond reroute: a node AFTER the gate that ALSO reads the gate's exact
    // original text source would pull the whole upstream back alive. Since the
    // gate now emits that same (edited) text, reroute those exact-match links to
    // the gate's own output (slot 0) so nothing after the gate reaches before it.
    if (gateSrc) {
      for (const dId of downstream) {
        const dInputs = out[dId]?.inputs;
        if (!dInputs) continue;
        for (const k in dInputs) {
          const v = dInputs[k];
          if (isLink(v) && String(v[0]) === gateSrc[0] && Number(v[1]) === gateSrc[1]) {
            dInputs[k] = [String(id), 0];
          }
        }
      }
    }

    const keep = new Set(downstream);
    keep.add(String(id));
    addAncestors(out, keep);

    // Which OUTPUT nodes to delete: ONLY the ones that would re-pull the gate's
    // skipped UPSTREAM (the model chain that fed the gate via gateSrc) back alive.
    // An UNRELATED output branch (its own source, no path through the gate's
    // upstream) must keep running - Continue/Keep should skip the model, not the
    // whole rest of the graph. (Old bug: this deleted EVERY output not in `keep`,
    // silently killing unrelated branches - and, for a gate with nothing wired
    // downstream, every output in the file.)
    // upstream = gateSrc's node + all its ancestors (the chain we're skipping).
    const upstream = new Set();
    if (gateSrc) { upstream.add(gateSrc[0]); addAncestors(out, upstream); }
    // pullsUpstream = everything forward-reachable from `upstream` (its consumers);
    // executing any of these would run the skipped model. Rebuild consumers AFTER
    // the diamond reroute so rerouted downstream nodes no longer count as consumers.
    const postConsumers = buildConsumers(out);
    const pullsUpstream = new Set();
    const stack = [...upstream];
    while (stack.length) {
      const next = postConsumers.get(String(stack.pop()));
      if (!next) continue;
      for (const c of next) if (!pullsUpstream.has(c)) { pullsUpstream.add(c); stack.push(c); }
    }
    const canDetect = typeof isOutput === "function";
    for (const nid of Object.keys(out)) {
      const s = String(nid);
      if (keep.has(s)) continue;
      if (!pullsUpstream.has(s)) continue;   // unrelated to the gate's upstream -> keep + run it
      if (!canDetect || isOutput(out[nid] && out[nid].class_type)) delete out[nid];
    }
  } else {
    // Pass: no prune, whole workflow runs. Carry the box text for the unwired case.
    entry.inputs[HIDDEN_INPUT] = JSON.stringify({ mode: "pass", text: editedText });
  }
}
