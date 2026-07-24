// Pause Image Pixaroma - prompt-prune helpers (pure, ComfyUI-free).
//
// These operate on a ComfyUI API prompt object `out` (id -> {class_type, inputs})
// exactly as produced by app.graphToPrompt().output. They are split out of
// index.js so they can be unit-tested in Node (D:\Claude Tests\_pause_prune_test.mjs)
// without importing /scripts/app.js. index.js wires them into the graphToPrompt
// hook and supplies the `isOutput(classType)` predicate from the live node defs.

// A ComfyUI prompt input link is EXACTLY [originNodeId, originSlot] - origin a
// string/number, slot a number. Anything else (a scalar widget value, or a
// list-valued widget that happens to be an array) is NOT a link. Matching the
// exact shape avoids phantom edges from array-valued widgets.
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

// Forward BFS from startId; returns the set of all nodes reachable downstream
// (does NOT include startId).
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

// Grow `keep` to include every ancestor of every node already in it (walk the
// input link arrays [originId, originSlot] backward to closure). Continue uses
// this so a kept downstream node also keeps its OWN side dependencies (e.g. an
// upscaler's separate model / vae loaders), which are NOT downstream of the
// gate but are needed to run the downstream branch.
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

// Apply one gate's effective mode to the prompt `out`. Extracted so the hook
// can process CONTINUE gates before PAUSE/PASS ones (see the sort in index.js).
//
// `isOutput(classType)` returns true iff a class_type is an OUTPUT_NODE (Save /
// Preview / another gate). On Continue only the output nodes that would re-pull
// the gate's skipped UPSTREAM back alive are deleted; every other node is left
// in the submitted prompt as a harmless orphan so downstream Save nodes still
// embed the full generation metadata (seed / model / sampler) in the "prompt"
// PNG chunk, and UNRELATED output branches keep running. When `isOutput` is
// unavailable the prune still scopes deletion to the gate's upstream consumers
// (safe: no metadata on those, but the expensive upstream is never re-run, and
// unrelated branches survive).
export function applyGateMode(out, id, entry, mode, isOutput, HIDDEN_INPUT = "PauseState") {
  entry.inputs = entry.inputs || {};
  if (mode === "pause") {
    // Stop the run at the gate: delete every node downstream of it so the gate
    // (an OUTPUT_NODE) becomes the run's endpoint for this branch. Intermediate
    // non-output nodes (e.g. an upscaler) then have no consumer and ComfyUI
    // auto-skips them. Parallel branches with their own outputs are untouched.
    const consumers = buildConsumers(out);
    const downstream = collectDownstream(consumers, id);
    for (const d of downstream) delete out[d];
    entry.inputs[HIDDEN_INPUT] = JSON.stringify({ mode: "pause" });
  } else if (mode === "continue") {
    // Skip the upstream ENTIRELY and run only the rest from the snapshot.
    // Detaching the gate's own image link is not enough on its own: any OTHER
    // node that consumed the gate's upstream (e.g. a Save Image wired directly
    // off VAE Decode, in parallel with the gate) is still an output and would
    // pull the whole model -> sampler -> decode chain again. So keep ONLY the
    // gate, its downstream branch, and that branch's own side dependencies
    // (e.g. the upscaler's model / vae loaders) as the EXECUTION set, and
    // DELETE only the other OUTPUT nodes (Save / Preview / gates) that would
    // otherwise re-execute. The gate reloads the snapshot.

    // Capture the gate's own image SOURCE (origin node + slot) before detaching
    // it - needed for the diamond reroute below.
    const gateSrc = isLink(entry.inputs.image)
      ? [String(entry.inputs.image[0]), Number(entry.inputs.image[1])]
      : null;

    delete entry.inputs.image;
    entry.inputs[HIDDEN_INPUT] = JSON.stringify({ mode: "continue" });

    const consumers = buildConsumers(out);
    const downstream = collectDownstream(consumers, id);  // strings

    // Diamond reroute: a node AFTER the gate (e.g. an Image Compare's "before"
    // input) might also read the gate's EXACT original-image source (the
    // pre-gate image, e.g. VAE Decode). Left alone, that one link pulls the
    // whole upstream back alive on Continue. Since the gate's snapshot IS that
    // same image, reroute those downstream links to the gate's own output so
    // nothing after the gate reaches back before it - the upstream then drops
    // out of `keep` and is skipped. Only an EXACT (origin, slot) match is
    // rerouted, so a different pre-gate image is never silently swapped.
    if (gateSrc) {
      for (const dId of downstream) {
        const dInputs = out[dId]?.inputs;
        if (!dInputs) continue;
        for (const k in dInputs) {
          const v = dInputs[k];
          if (isLink(v) && String(v[0]) === gateSrc[0] && Number(v[1]) === gateSrc[1]) {
            dInputs[k] = [String(id), 0];  // read the gate's snapshot output
          }
        }
      }
    }

    const keep = new Set(downstream);
    keep.add(String(id));    // the gate itself
    addAncestors(out, keep); // + downstream's remaining side deps

    // Delete only the OUTPUT nodes that would re-pull the gate's skipped UPSTREAM
    // (the model -> sampler -> VAE Decode chain that fed the gate) back alive -
    // the parallel Save / Preview off the pre-gate image, and any chained gate on
    // the same upstream. An UNRELATED output branch (its own source, no path
    // through the gate's upstream) must keep running: Continue skips the MODEL,
    // not the whole rest of the graph. (Old bug: this deleted EVERY output not in
    // `keep`, silently killing unrelated Save/Preview branches - and, for a gate
    // with nothing wired downstream, every output in the file.)
    //
    // Everything non-output on the gate's upstream is left in the submitted
    // prompt as an ORPHAN: with the gate's link gone and the re-pulling outputs
    // deleted, nothing consumes it, so ComfyUI never runs it (the expensive
    // upstream is still skipped) - but it stays in the "prompt" PNG chunk, so
    // downstream Save nodes embed the full generation metadata (seed / model /
    // sampler). Fixing the "Continue loses metadata" report.
    //
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
    // Fallback: if output detection is unavailable, delete every UPSTREAM-pulling
    // node not in keep (still scoped, so unrelated branches survive) - no metadata
    // on those, but the upstream is never re-run.
    const canDetect = typeof isOutput === "function";
    for (const nid of Object.keys(out)) {
      const s = String(nid);
      if (keep.has(s)) continue;
      if (!pullsUpstream.has(s)) continue;   // unrelated to the gate's upstream -> keep + run it
      if (!canDetect || isOutput(out[nid] && out[nid].class_type)) delete out[nid];
    }
  } else {
    // Pass: no prune, whole workflow runs.
    entry.inputs[HIDDEN_INPUT] = JSON.stringify({ mode: "pass" });
  }
}
