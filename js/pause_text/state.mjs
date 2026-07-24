// State + persistence helpers for Pause Text Pixaroma.
// State lives on node.properties so it survives workflow save AND Vue tab
// switches (LiteGraph serializes node.properties natively).

export const STATE_PROP = "pauseTextState";

// Persisted shape:
//   gate:     "pause" (default) | "pass"
//   text:     the current box content (output on Continue; injected as the
//             frontend box into PauseState for the unwired / continue cases)
//   original: the model's last text (for Revert + the "edited" indicator)
// text/original ARE serialized on purpose: reopening a workflow keeps your edit
// (the design). They only change on a genuine user action (typing, Revert) or a
// RUN (executed event) - never on the pure load/restore path - so opening a
// saved workflow never falsely flags it "modified" (Vue Compat #18).
export function getState(node) {
  node.properties = node.properties || {};
  let s = node.properties[STATE_PROP];
  if (!s || typeof s !== "object") {
    s = { gate: "pause", text: "", original: "" };
    node.properties[STATE_PROP] = s;
  }
  if (s.gate !== "pause" && s.gate !== "pass") s.gate = "pause";
  if (typeof s.text !== "string") s.text = "";
  if (typeof s.original !== "string") s.original = "";
  return s;
}

export function setGate(node, gate) {
  const s = getState(node);
  s.gate = gate === "pass" ? "pass" : "pause";
}

// Update the current box text (a keystroke). Marks the workflow modified, which
// is correct - the user changed something.
export function setText(node, text) {
  const s = getState(node);
  s.text = typeof text === "string" ? text : "";
}

// A fresh model capture from a run: replace the box AND the revert baseline.
export function setModelText(node, text) {
  const s = getState(node);
  const t = typeof text === "string" ? text : "";
  s.text = t;
  s.original = t;
}

// Put the model's original text back (Revert).
export function revertText(node) {
  const s = getState(node);
  s.text = s.original;
}

// True when the box differs from the model's last text.
export function isEdited(node) {
  const s = getState(node);
  return s.text !== s.original;
}
