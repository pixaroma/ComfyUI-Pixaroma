// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay defaults + reset helper                        ║
// ║  Lives in its own module so both index.js (extension entry)  ║
// ║  and core.mjs (editor) can import without circular deps.     ║
// ╚═══════════════════════════════════════════════════════════════╝

/** Default state when adding a fresh node OR migrating from older versions.
 *  Position x/y are deliberately small so the text fits in ANY canvas size out
 *  of the box. The _autoCenterPending flag tells the editor (and the
 *  graphToPrompt hook) to center the text on the canvas the first time it
 *  opens / runs with an upstream image available. The flag is cleared
 *  after centering so subsequent runs respect the saved position. */
export const DEFAULT_STATE = {
  version: 3,
  text: "Your text here",
  font: "Roboto",
  weight: 400,
  italic: false,
  align: "center",
  fontSize: 64,
  lineHeight: 1.2,
  letterSpacing: 0,
  x: 20,
  y: 20,
  rotation: 0,
  opacity: 1.0,
  color: "#FFFFFF",
  bgColor: null,
  _autoCenterPending: true,
};

/** Restore the layer object to factory defaults IN PLACE. Both the body
 *  panel and the editor sidebar panel hold a reference to the same state
 *  object on node.properties.textOverlayState, so mutating keys (instead
 *  of reassigning the variable) keeps both in sync without extra plumbing. */
export function resetStateInPlace(layer) {
  for (const k of Object.keys(layer)) delete layer[k];
  Object.assign(layer, DEFAULT_STATE);
}
