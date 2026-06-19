// ╔═══════════════════════════════════════════════════════════════╗
// ║  Set / Get Pixaroma - wireless "named variable" node pair     ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Pixaroma's own wireless "named variable" node pair, in a PRIVATE namespace:
// classes PixaromaSetNode / PixaromaGetNode with their own registry
// (js/set_get/scope.mjs) that only ever scans Pixaroma Set/Get. It coexists with
// any other pack's Set/Get-style nodes in one workflow with zero interference.
//
// Both are pure-frontend VIRTUAL nodes (isVirtualNode = true): no Python, never
// in the prompt. Resolution at submission goes straight through to the real
// source via getInputLink (same-graph) + resolveVirtualOutput (subgraph). Works
// in both Classic and Nodes 2.0, and inside subgraphs (native path verified on
// frontend 1.45.15).

import { app } from "/scripts/app.js";
import { registerPixaromaSetNode } from "./set_node.mjs";
import { registerPixaromaGetNode } from "./get_node.mjs";
import { startValuePoll } from "./value_preview.mjs";
import { SETTING_ID, recolorAllGets } from "./colors.mjs";
import "./help.mjs"; // registers help for both nodes (convention #16)

app.registerExtension({
  name: "Pixaroma.SetGet",
  settings: [
    {
      id: SETTING_ID,
      name: "Get matches its Set's colour",
      type: "boolean",
      defaultValue: true,
      tooltip:
        "A Get node takes the colour you gave its Set, so matching pairs are easy to spot. Turn off to leave Gets on their own colour.",
      category: ["👑 Pixaroma", "Set & Get"],
      onChange: () => recolorAllGets(),
    },
  ],
  registerCustomNodes() {
    registerPixaromaSetNode();
    registerPixaromaGetNode();
  },
  setup() {
    startValuePoll();
  },
});
