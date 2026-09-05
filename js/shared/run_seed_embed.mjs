import { api } from "/scripts/api.js";

// ─────────────────────────────────────────────────────────────────────────
// Bake each run's ACTUAL seed into the workflow that gets embedded in the
// output image, so dragging that image back into ComfyUI reproduces it.
//
// THE BUG THIS FIXES (discussion #70, two independent reports). Our seed
// nodes roll their run seed at graphToPrompt time and keep it in a RUNTIME
// field, never in node.properties - deliberately, so a Run can never dirty a
// saved workflow (Vue Compat #18). But that also means the workflow embedded
// in the PNG carries the STALE stored seed in Random mode, so dragging the
// image back and pressing Run produces a DIFFERENT picture. Measured live:
// image made with 410912171262840, embedded workflow said 3275558525027720.
//
// WHY THE HOOK IS HERE AND NOT IN graphToPrompt. `api.queuePrompt(n, data)`
// does `extra_data.extra_pnginfo.workflow = data.workflow` (verified in the
// frontend bundle), so this object IS what lands in the PNG - and this path
// runs ONLY for a real Run. graphToPrompt is ALSO called by "Export"
// (`exportWorkflow` awaits it and writes `i.workflow` to the file), so
// patching there would bake a locked seed into every exported workflow.
// Ctrl+S does not use graphToPrompt at all, so a saved workflow is untouched
// either way.
//
// SAFE BY CONSTRUCTION: `data.workflow` is a serialized COPY (probed: its
// node entries carry their own `properties` object, not the live node's), so
// this can never write serialized state on the live graph and can never flag
// a clean workflow "modified" - the same guarantee js/workflow_compat relies
// on. Everything is try/caught: a failure here must never block a Run.
// ─────────────────────────────────────────────────────────────────────────

const _patchers = [];
let _installed = false;

// Read a node.properties entry that may be stored either as a JSON STRING
// (how our nodes serialize) or as a plain object, WITHOUT changing which.
export function readNodeProp(node, key) {
  const raw = node?.properties?.[key];
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return { value: JSON.parse(raw), wasString: true }; } catch { return null; }
  }
  if (typeof raw === "object") return { value: raw, wasString: false };
  return null;
}

// Write it back in the SAME encoding it arrived in, so the workflow keeps the
// exact shape ComfyUI produced.
export function writeNodeProp(node, key, value, wasString) {
  node.properties = node.properties || {};
  node.properties[key] = wasString ? JSON.stringify(value) : value;
}

/**
 * Register a function that may rewrite the workflow copy about to be queued.
 * Called as fn(workflow, output) once per Run, before the request is sent.
 */
export function registerRunWorkflowPatcher(fn) {
  if (typeof fn !== "function") return;
  _patchers.push(fn);
  install();
}

function install() {
  if (_installed) return;
  if (!api || typeof api.queuePrompt !== "function") return;
  _installed = true;

  const _orig_fn = api.queuePrompt;
  const orig = (...a) => _orig_fn.apply(api, a);
  api.queuePrompt = function (number, data, ...rest) {
    try {
      const wf = data?.workflow;
      const out = data?.output;
      if (wf && out && Array.isArray(wf.nodes)) {
        for (const fn of _patchers) {
          try {
            fn(wf, out);
          } catch (e) {
            console.warn("[Pixaroma] run-state patcher failed (harmless):", e);
          }
        }
      }
    } catch (e) {
      console.warn("[Pixaroma] run-state embed failed (harmless):", e);
    }
    return orig(number, data, ...rest);
  };
}
