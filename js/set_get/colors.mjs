// ╔═══════════════════════════════════════════════════════════════╗
// ║  Set / Get Pixaroma - Get mirrors its Set's colour            ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// You colour a Set however you like (right-click -> Colors). A Get that reads
// that Set then takes the SAME colour, so a matching pair is easy to spot, and
// the Get follows along if you recolour the Set later. The Get's dropdown also
// tags each name with that Set's colour. Turn the setting off to leave Gets on
// their own colour.

import { app } from "/scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { GET_TYPE, allLiveGraphs, findSetterByName } from "./scope.mjs";

export const SETTING_ID = "Pixaroma.SetGet.ColorMatch";
export const BRAND_TITLE = "#1d1d1d";
export const BRAND_BODY = "#2a2a2a";

export function isColorMatchOn() {
  const v = app.ui?.settings?.getSettingValue?.(SETTING_ID);
  return v == null ? true : !!v;
}

// The colour a Get should show = the colour of the Set it reads (whatever the
// user picked for that Set), or brand-dark when there is no Set in scope.
export function setColorFor(getNode) {
  const node = findSetterByName(getNode.graph, getNode.widgets?.[0]?.value)?.node;
  return {
    color: node?.color ?? BRAND_TITLE,
    bgcolor: node?.bgcolor ?? BRAND_BODY,
  };
}

// Make a Get mirror its Set's colour. Skipped during a load (the saved colour
// is restored by configure) and when the setting is off, and it only writes on
// a real change so it never spams redraws or dirties a workflow.
export function inheritSetColor(getNode) {
  if (!getNode || !isColorMatchOn()) return;
  try {
    if (isGraphLoading()) return;
  } catch {
    /* ignore */
  }
  const { color, bgcolor } = setColorFor(getNode);
  if (getNode.color !== color || getNode.bgcolor !== bgcolor) {
    getNode.color = color;
    getNode.bgcolor = bgcolor;
    getNode.setDirtyCanvas?.(true, true);
  }
}

// Re-mirror every Get in the workflow (called when the setting is toggled).
export function recolorAllGets() {
  const graph = app.canvas?.graph || app.graph;
  for (const g of allLiveGraphs(graph)) {
    for (const n of g._nodes || []) {
      if (n.type === GET_TYPE) inheritSetColor(n);
    }
  }
  app.canvas?.setDirty(true, true);
}

// Exposed for the color picker (js/node_colors). A Get mirrors its Set's colour
// every frame (inheritSetColor in onDrawForeground), so colouring a Get directly
// just flashes and reverts. Colour the SET instead: it sticks AND the whole
// variable (Set + all its Gets) takes the colour, which matches the ColorMatch
// idea. Returns the node the picker should actually colour (the in-scope Set for a
// Get when ColorMatch is on; otherwise the node unchanged, incl. ColorMatch off or
// an orphan Get with no Set).
export function colorTargetFor(node) {
  try {
    if (node && node.type === GET_TYPE && isColorMatchOn()) {
      const setter = findSetterByName(node.graph, node.widgets?.[0]?.value)?.node;
      if (setter) return setter;
    }
  } catch { /* ignore */ }
  return node;
}
try {
  window.PixaromaSetGet = window.PixaromaSetGet || {};
  window.PixaromaSetGet.colorTargetFor = colorTargetFor;
} catch { /* ignore */ }
