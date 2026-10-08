// Save Text Pixaroma - shared state.
//
// THE MODEL, in one sentence: what you see in the node IS what is in the file.
// There is no second copy, so there is nothing to drift. Every write sends the
// WHOLE buffer, which is why a run and a manual Save take the same code path.
//
// Three separate node.properties keys rather than one blob, on purpose:
//   saveTextState   the SETTINGS (folder, name, options). Changes only when the
//                   user changes something.
//   saveTextBuffer  the collected text itself. Changes on every run.
//   saveTextDirty   has the buffer been edited since it was last written?
// Keeping the buffer out of the settings blob keeps a saved workflow readable
// and means a future settings injection (there is none today - see the header
// of nodes/node_save_text.py for why) could never accidentally carry the whole
// collection into the prompt.

export const COMFY_CLASS = "PixaromaSaveText";
export const STATE_PROP = "saveTextState";
export const BUFFER_PROP = "saveTextBuffer";
export const DIRTY_PROP = "saveTextDirty";

export const DEFAULT_STATE = {
  version: 1,
  folder: "", // empty = ComfyUI's output folder
  pattern: "prompts_%counter%",
  counterDigits: 3,
  // Write the file after every run. ON by default: a manual-only save is a save
  // you forget, and forgetting is the exact thing this node exists to stop.
  autoSave: true,
  separator: "blank",
  newest: "bottom", // where a new entry is added: "bottom" | "top"
  skipDupes: "last", // "off" | "last" | "any"
  timestamp: "off", // "off" | "date" | "time" | "datetime"
  // Start a new file once the collection gets this big, so one workflow cannot
  // grow an unbounded buffer inside its own JSON. 0 = never.
  maxEntries: 500,
  // The file this collection is currently writing to, resolved once when the
  // collection starts. Empty means "claim a new name on the next write", which
  // is exactly the state Clear leaves behind - that is what makes Clear safe.
  currentFile: "",
  folded: false, // JS-only: body collapsed to the box + buttons
  // ALSO write every entry to its own .txt, named by the wired `name` input
  // (a picture's name from Load Images from Folder gives 01_Cat.txt beside
  // 01_Cat.jpg: training captions). Off by default, and the list file above is
  // untouched by it - turn Save after every run off to write ONLY the files.
  eachFile: false,
};

// Separator ids MUST match nodes/_save_text_helpers.py::SEPARATORS. A blank line
// is the default because it is EXACTLY Prompt Pack Pixaroma's paragraph format,
// so a saved .txt drops straight back into the pack.
// Prompt Pack Pixaroma reads ALL THREE - js/prompt_pack/core.mjs::MODES has one
// pill per id here, with the same label - so whichever you pick, the saved .txt
// drops straight into it.
//
// A "Comma" separator was offered on the day this node shipped and REMOVED the
// next (2026-08-18), before anyone could be relying on it. This node exists to
// carry PROMPTS and an ordinary prompt is full of commas, so splitting on one
// shreds a single prompt into fragments: countEntries lies, the duplicate guard
// stops matching and the rollover fires early (#7 below). It was broken for the
// node's own subject matter, which is worse than not offering it. A workflow
// still holding "comma" is healed by readState.
export const SEPARATORS = {
  blank: "\n\n",
  newline: "\n",
  rule: "\n---\n",
};
export const SEPARATOR_LABELS = [
  ["blank", "Blank line"],
  ["newline", "New line"],
  ["rule", "--- line"],
];

export function separatorStr(id) {
  // Type-check the LOOKUP, do not just test it for truthiness. A plain-object
  // index walks the prototype chain, and every Object.prototype member is
  // truthy, so `SEPARATORS[id] || blank` handed back a FUNCTION for ids like
  // "constructor", "toString" or "__proto__". appendEntry then joined entries
  // with a stringified function and wrote that into the user's .txt - MEASURED:
  // "a" + "b" came out as `afunction Object() { [native code] }b`. It also made
  // splitEntries collapse the whole buffer to one entry, silently disabling the
  // duplicate guard.
  //
  // Only reachable from a hand-edited or third-party workflow JSON, but a
  // workflow is a shared artefact. This also restores parity with the Python
  // side, which was already safe via isinstance(str) + .get(default).
  const s = SEPARATORS[id];
  return typeof s === "string" ? s : SEPARATORS.blank;
}

// Mirror of _save_text_helpers.count_entries. Blank pieces are dropped so a
// trailing separator, or a run of empty lines the user left behind, never
// inflates the number shown on the node.
export function countEntries(text, sepId) {
  if (typeof text !== "string" || !text.trim()) return 0;
  return text.split(separatorStr(sepId)).filter((p) => p.trim()).length;
}

// The entries, as an array. Used for the duplicate check and for the rollover.
export function splitEntries(text, sepId) {
  if (typeof text !== "string" || !text.trim()) return [];
  return text.split(separatorStr(sepId)).filter((p) => p.trim());
}

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try {
      return healState({ ...DEFAULT_STATE, ...JSON.parse(v) });
    } catch {
      /* fall through to defaults */
    }
  }
  return { ...DEFAULT_STATE };
}

// Normalise a separator this build no longer has back to the default, so a
// workflow saved with the removed "comma" (or a hand-edited id) shows a chip
// as selected instead of none, and the settings panel agrees with what the
// node will actually do. separatorStr already falls back on its own, so this
// is about the UI telling the truth, not about safety.
//
// READ-ONLY on purpose: it returns a corrected COPY and never writes
// node.properties, so merely opening an old workflow cannot flag it modified
// (Vue Compat #18). The corrected value persists the next time the user
// changes something, which is the right moment for it.
function healState(st) {
  if (typeof SEPARATORS[st.separator] !== "string") st.separator = DEFAULT_STATE.separator;
  return st;
}

export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

export function readBuffer(node) {
  const v = node.properties?.[BUFFER_PROP];
  return typeof v === "string" ? v : "";
}

export function writeBuffer(node, text, dirty) {
  if (!node.properties) node.properties = {};
  node.properties[BUFFER_PROP] = typeof text === "string" ? text : "";
  if (dirty !== undefined) node.properties[DIRTY_PROP] = !!dirty;
}

export function isDirty(node) {
  return !!node.properties?.[DIRTY_PROP];
}

// Add one entry to the buffer, honouring the separator, the newest-first
// setting and the timestamp prefix. Pure: it returns the new text and does not
// touch the node, so the harness can pin it.
export function appendEntry(buffer, entry, st) {
  const body = (st.timestamp && st.timestamp !== "off")
    ? timestampLine(st.timestamp) + "\n" + entry
    : entry;
  const cur = typeof buffer === "string" ? buffer.trim() : "";
  if (!cur) return body;
  const sep = separatorStr(st.separator);
  return st.newest === "top" ? body + sep + cur : cur + sep + body;
}

// Mirror of _save_text_helpers.timestamp_line.
export function timestampLine(fmtId, when) {
  const d = when || new Date();
  const p = (v) => String(v).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (fmtId === "date") return `# ${date}`;
  if (fmtId === "datetime") return `# ${date} ${hm}`;
  if (fmtId === "time") return `# ${hm}:${p(d.getSeconds())}`;
  return "";
}

// Should this incoming text be collected at all?
//
// The SECOND belt. The first is the execution_cached gate in index.js, which
// drops the replayed result of a node ComfyUI did not actually re-run. (Note
// that the cache alone is NOT enough - a cached node still has its ui payload
// replayed to the browser; see the comment on _cachedThisRun.) This covers what
// that cannot: a workflow reload clears ComfyUI's cache, so the first run
// afterwards genuinely executes and would otherwise re-add the prompt that is
// already the last entry.
export function shouldCollect(buffer, entry, st) {
  if (typeof entry !== "string" || !entry.trim()) return false;
  const mode = st.skipDupes || "last";
  if (mode === "off") return true;
  const entries = splitEntries(buffer, st.separator);
  if (!entries.length) return true;

  // appendEntry stores the timestamp INSIDE the entry, so a STORED entry reads
  // "# 2026-08-17\nHello" while the incoming text is still bare "Hello".
  // Comparing them raw could never match, which made "Skip repeats" silently
  // dead for anyone with timestamps on - exactly the reopen-a-workflow case the
  // help advertises. MEASURED before this fix: shouldCollect returned true for
  // an entry identical to the last one.
  //
  // The normalisation is ASYMMETRIC on purpose: strip only from the STORED
  // side, because the incoming text never carries a timestamp. That keeps a
  // prompt whose OWN first line starts with "#" comparing correctly - stored is
  // "# 2026-08-17\n# my note\nbody", one line comes off, and it matches the
  // incoming "# my note\nbody". Stripping both sides would have made two
  // prompts differing only in a leading "#" line look identical.
  const stamped = !!st.timestamp && st.timestamp !== "off";
  const stored = (s) => {
    const t = String(s).trim();
    return stamped ? t.replace(/^#[^\n]*\n/, "").trim() : t;
  };
  const target = String(entry).trim();
  if (mode === "any") return !entries.some((e) => stored(e) === target);
  return stored(entries[st.newest === "top" ? 0 : entries.length - 1]) !== target;
}

// Run `fn` only once every earlier call for this node has settled, so two of
// them can never be in flight at the same time. The chain lives on the node
// under `key` (a runtime field, never serialized).
//
// WHY THIS EXISTS - two races, both measured, both from `saveToFile` reading
// state before its `await` (the #4 trap in the pattern file, for the fourth
// time in that one function):
//
//  1. DOUBLE CLAIM. The request carries `claim: !st.currentFile`, decided
//     BEFORE the fetch. Two saves starting within one round-trip both still
//     see currentFile === "" and both claim a fresh name, so one collection
//     lands in several files. MEASURED: 4 runs back to back produced
//     racebefore_001.txt (3 entries) AND racebefore_002.txt (4 entries).
//  2. OUT-OF-ORDER WRITES. Even once a name exists, two overlapping saves can
//     land in either order, leaving the FILE holding an older buffer than the
//     node shows. That one breaks the node's headline promise - what you see
//     on the node IS what is in the file - so it matters more than the litter.
//
// Serialising fixes both at once, and is the smallest thing that does: a lock
// on the claim alone would leave (2) untouched.
//
// It deliberately does NOT coalesce queued calls. Every save writes the WHOLE
// buffer, so a redundant one is harmless, whereas dropping one would have to
// decide what its caller's boolean result means - and the rollover DEPENDS on
// that result to know whether it may wipe the collection.
//
// Errors are contained TWICE, and either half alone would do it: the two-arm
// `then` runs fn even when the previous call rejected, and the stored chain
// always resolves so the next call never sees a rejection at all. Keeping both
// is deliberate belt-and-braces in a function whose whole job is not to lose
// the user's text. (Consequence for mutation testing: removing ONE of them is
// an equivalent mutant and survives - the script mutates them together.)
// The caller still sees its own rejection either way.
const NOOP = () => {};

export function queueOnNode(node, key, fn) {
  const prev = node[key] || Promise.resolve();
  // Both arms call fn with NO arguments - `prev.then(fn, fn)` would hand it the
  // previous call's value or error, which is not this call's business.
  const mine = prev.then(() => fn(), () => fn());
  node[key] = mine.then(NOOP, NOOP);
  return mine;
}

export {
  resolveDateTokens,
  expandNativeTokens,
  normalizePath,
  sanitizePrefixMirror,
} from "../shared/filename_mirror.mjs";
