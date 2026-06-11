// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Watermark defaults + reset helper                      ║
// ║  MUST stay in lockstep with the Python per-field fallbacks   ║
// ║  in nodes/node_text_watermark.py + _text_render_helpers.py   ║
// ║  (CLAUDE.md Pattern #3).                                      ║
// ╚═══════════════════════════════════════════════════════════════╝

/** Default state for a fresh node. Position is NOT stored as absolute x/y -
 *  the Python node derives x/y from `anchor` + `marginX/Y` + `sizeMode` per
 *  image at render time. Classic watermark out of the box: bottom-right,
 *  20px inset, white, fixed pixels. */
export const DEFAULT_STATE = {
  version: 1,
  text: "Your text here",
  font: "Roboto",
  weight: 400,
  italic: false,
  align: "center",
  direction: "horizontal",
  fontSize: 64,
  lineHeight: 1.2,
  letterSpacing: 0,
  rotation: 0,
  opacity: 1.0,
  color: "#FFFFFF",
  bgColor: null,
  anchor: "bottom-right",
  marginX: 20,
  marginY: 20,
  sizeMode: "px",
};

/** Restore the state object to factory defaults IN PLACE. The body panel holds
 *  a reference to the same object on node.properties.textWatermarkState, so we
 *  mutate keys instead of reassigning to keep that reference valid. */
export function resetStateInPlace(state) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, DEFAULT_STATE);
}
