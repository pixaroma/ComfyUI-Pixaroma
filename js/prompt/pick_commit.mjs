// Spend a held pick when a queue is genuinely ACCEPTED.
//
// A `#list` / `*category` pick is made during app.graphToPrompt, which is NOT a queue:
// ComfyUI calls it for Workflow > Export and for workflow sharing, several Pixaroma
// Save buttons call it directly, and it also runs for a queue that then fails
// validation. None of those should move an "In order" list on, so cursors.mjs HOLDS
// each pick and this wrap is what spends it (prompt.md #31 / #39 / #40).
//
// WHY IT IS ITS OWN FILE, and not in a node's index.js as it used to be:
//   - TWO nodes roll picks now (Prompt Pixaroma and AI Prompt Pixaroma). Leaving the
//     wrap inside one node's index.js made the other silently depend on that file
//     having loaded, and that is not hypothetical - a stray backtick in a CSS template
//     literal once made the whole of js/prompt/index.js refuse to load (prompt.md #49)
//     with no console error. A node in that state would still roll picks and never
//     commit them, so every sequence would quietly stop advancing.
//   - It stays OUT of cursors.mjs so that module needs nothing but /scripts/app.js.
//     That is what lets the harnesses drive the real engine against one stub; adding
//     an /scripts/api.js import there broke both of them immediately.
//
// Import it for side effect from anything that rolls picks. Idempotent, so importing
// it from several places costs nothing.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { commitPicks } from "./cursors.mjs";

// The flag keeps the name the old in-index.js wrap used, so a stale cached copy of
// that file cannot install a second wrap and commit every build twice.
if (!app._pixPromptQueuePatched && api && typeof api.queuePrompt === "function") {
  app._pixPromptQueuePatched = true;
  const _origQueuePrompt_fn = api.queuePrompt;
  const _origQueuePrompt = (...a) => _origQueuePrompt_fn.apply(api, a);
  api.queuePrompt = async function (...args) {
    const res = await _origQueuePrompt(...args);   // throws on a rejected queue -> pick kept
    try {
      // Hand the commit the exact prompt object that was POSTed, so it spends THAT
      // build's picks. Searching the args rather than assuming a position keeps this
      // working if the signature ever moves. `output` is the object the graphToPrompt
      // hooks stamped via beginPickBuild.
      let queued = null;
      for (const a of args) {
        if (a && typeof a === "object" && a.output && typeof a.output === "object") { queued = a.output; break; }
      }
      commitPicks(queued);
    } catch (err) { console.error("Pixaroma.Prompt: commitPicks failed", err); }
    return res;
  };
}
