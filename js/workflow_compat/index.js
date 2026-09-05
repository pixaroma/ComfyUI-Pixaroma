import { app } from "/scripts/app.js";

// ── Pixaroma workflow-compat: keep the pack-metadata properties schema-legal ──
//
// WHY THIS FILE EXISTS (issue: "no workflow data available", GitHub discussion #72)
//
// ComfyUI-Manager stamps the pack it installed a node from into that node's
// `properties`, and ComfyUI's frontend VALIDATES those three fields against its
// workflow schema (`workflowSchema.ts`):
//     cnr_id  -> zCnrId    : 1..100 chars, ASCII letters/digits/._- only
//     aux_id  -> zAuxId    : MUST look like "github-user/repo-name"
//     ver     -> zVersion  : semver, or a 4..40 char git hash, or "unknown"
// One bad value on ONE node makes the WHOLE workflow fail validation.
//
// Pixaroma's home repo is GitLab, and Manager's `normalize_to_github_id()`
// returns None for any non-GitHub remote, then falls back to
// `os.path.basename(repo_url)` -> "ComfyUI-Pixaroma.git" (no slash), which is
// NOT a legal `aux_id`. Manager stamps `aux_id` whenever `cnr_id` is empty
// (`comfyui-manager/js/workflow-metadata.js`: `if (cnr_id) ... else aux_id`),
// and `cnr_id` is empty for a plain `git clone` with no `.git/.cnr-id` file.
// So a clone-from-GitLab install puts an illegal `aux_id` on every Pixaroma
// node. Verified live: `/api/customnode/installed` reports
// `aux_id: "ComfyUI-Pixaroma.git"` for this pack, and it is the ONLY pack out
// of 28 installed here that is malformed (everyone else is on GitHub).
//
// WHAT BREAKS, and why it looks so odd: the two load paths disagree.
//   - Queue/history/outputs "Open as workflow in new tab" HARD-fails:
//     `extractWorkflow()` (fetchJobs.ts) runs `validateComfyWorkflow` on
//     `extra_data.extra_pnginfo.workflow` and returns undefined if it fails,
//     and the caller then reports the literal string
//     "No workflow data available".
//   - Dragging the same image onto the canvas WORKS: `loadGraphData` (app.ts)
//     does `graphData = validatedGraphData ?? graphData`, i.e. it deliberately
//     falls back to the unvalidated graph.
// Hence the user report "opening from history says there is no workflow data,
// but dragging the image in works fine".
//
// THE FIX: normalize those three fields on OUR nodes only, in the workflow
// object `app.graphToPrompt()` returns. That object is what ComfyUI puts into
// `extra_data.extra_pnginfo.workflow` (the thing the failing path validates)
// and into the PNG `workflow` chunk, so fixing it there fixes both.
//
// SAFE BY CONSTRUCTION:
//   - `graphToPrompt`'s node entries carry their OWN `properties` object, not a
//     reference to the live node's (probed: mutating the copy leaves
//     `node.properties` untouched). So this can never write serialized state on
//     the live graph and can never flag a clean workflow "modified"
//     (Vue Compat #18).
//   - We only ever touch a value that is ALREADY invalid, so a correctly
//     installed user's workflow comes out byte-identical.
//   - "pixaroma/ComfyUI-Pixaroma" is exactly what Manager itself derives for a
//     GitHub clone, and exactly what it matches against
//     (`nodepack.repository.split("/").slice(-2).join("/")` over our
//     pyproject `Repository = https://github.com/pixaroma/ComfyUI-Pixaroma`),
//     so the rewrite makes pack resolution MORE correct, not less.
//   - Everything is wrapped in try/catch: a failure here must never block a Run.

const GOOD_AUX = "pixaroma/ComfyUI-Pixaroma";

// Mirrors of the frontend's own patterns (workflowSchema.ts).
const AUX_SHAPE = /^[^/]+\/[^/]+$/;
// The frontend validates aux_id in TWO stages, not one: the shape regex above,
// THEN a refine that the user half matches githubUsernamePattern (max 39 chars,
// no leading/trailing '-', no '--') and the repo half matches the same rule as
// cnr_id. Mirroring only the shape let a slash-bearing but still-illegal value
// (e.g. "--x/repo") pass our repair, so the workflow stayed broken and the user
// still got "No workflow data available". Checking both stages is strictly safer:
// a legitimate fork like "someone/ComfyUI-Pixaroma-fork" passes both and is left
// alone, and only values the frontend ITSELF rejects get replaced.
const GITHUB_USER = /^(?!-)(?!.*--)[a-zA-Z0-9-]+(?<!-)$/;
const GIT_HASH = /^[0-9a-f]{4,40}$/i;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+([\da-z-]+(?:\.[\da-z-]+)*))?$/;
const CNR_SHAPE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

// Filled from beforeRegisterNodeDef, so a new node joins automatically.
const OUR_TYPES = new Set();

function isOurs(entry) {
  if (OUR_TYPES.has(entry?.type)) return true;
  // Fallback for a workflow opened WITHOUT the pack installed (the node is a
  // missing-node placeholder, but its properties still carry the bad value and
  // still invalidate the whole workflow).
  const aux = entry?.properties?.aux_id;
  return typeof aux === "string" && /pixaroma/i.test(aux);
}

function validVer(v) {
  if (typeof v !== "string") return false;
  if (v === "unknown") return true;
  const s = v.replace(/^v/, "");
  return SEMVER.test(s) || GIT_HASH.test(s);
}

function validCnr(v) {
  return (
    typeof v === "string" &&
    v.length >= 1 &&
    v.length <= 100 &&
    CNR_SHAPE.test(v) &&
    !/^[_\-.]|[_\-.]$/.test(v)
  );
}

function validAux(v) {
  if (typeof v !== "string" || !AUX_SHAPE.test(v)) return false;
  const cut = v.indexOf("/");
  const user = v.slice(0, cut);
  const repo = v.slice(cut + 1);
  return user.length >= 1 && user.length <= 39 && GITHUB_USER.test(user) && validCnr(repo);
}

/** Repair illegal pack metadata on Pixaroma nodes. Returns how many it fixed. */
function normalizePackMetadata(workflow) {
  let fixed = 0;
  const nodes = workflow?.nodes;
  if (!Array.isArray(nodes)) return fixed;
  for (const entry of nodes) {
    const p = entry?.properties;
    if (!p || typeof p !== "object") continue;
    if (!isOurs(entry)) continue;

    if ("aux_id" in p && !validAux(p.aux_id)) {
      p.aux_id = GOOD_AUX;
      fixed++;
    }
    // An empty cnr_id fails z.string().min(1). Manager never stamps one, but an
    // older saved workflow can carry it; drop it rather than invent a value.
    if ("cnr_id" in p && !validCnr(p.cnr_id)) {
      delete p.cnr_id;
      fixed++;
    }
    // "unknown" is the schema's own escape hatch for an unresolvable version.
    if ("ver" in p && !validVer(p.ver)) {
      p.ver = "unknown";
      fixed++;
    }
  }
  return fixed;
}

app.registerExtension({
  name: "Pixaroma.WorkflowCompat",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    const cat = nodeData?.category;
    if (typeof cat === "string" && cat.startsWith("👑 Pixaroma")) {
      const name = nodeData?.name || nodeType?.comfyClass;
      if (name) OUR_TYPES.add(name);
    }
  },

  async setup() {
    if (app._pixWorkflowCompatWrapped) return;
    app._pixWorkflowCompatWrapped = true;

    const _orig_fn = app.graphToPrompt;
    const orig = (...a) => _orig_fn.apply(app, a);
    let warned = false;
    app.graphToPrompt = async function (...args) {
      const result = await orig(...args);
      try {
        const n = normalizePackMetadata(result?.workflow);
        if (n && !warned) {
          warned = true;
          console.log(
            "[Pixaroma] Repaired illegal node-pack metadata on " + n +
              " field(s) so the workflow passes ComfyUI's schema. This happens " +
              "when the pack was installed by cloning the GitLab repo; see " +
              "js/workflow_compat/index.js."
          );
        }
      } catch (e) {
        console.warn("[Pixaroma] workflow-compat normalize failed (harmless):", e);
      }
      return result;
    };
  },
});
