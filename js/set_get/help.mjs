// Help content for Set / Get Pixaroma, shown by the orange ? button in the node
// selection toolbar (convention #16). Registered against the virtual nodes'
// comfyClass (set in each node's constructor) so the toolbar finds it.

import { registerNodeHelp } from "../shared/index.mjs";

registerNodeHelp("PixaromaSetNode", {
  title: "Set Pixaroma",
  tagline: "Store any wire under a name, then read it back anywhere with Get Pixaroma.",
  sections: [
    {
      heading: "What it does",
      body:
        "Set Pixaroma is a wireless wire. Connect anything into it (an image, a model, a number, a prompt) and give it a name. A Get Pixaroma node anywhere in the workflow can then read that same value by picking the name, with no cable running across the canvas.\n\nIt lives only in the editor. At run time the value flows straight from the original source to wherever the Get node feeds, exactly as if you had wired them directly, so it never slows anything down or changes the result.",
    },
    {
      heading: "How to use it",
      bullets: [
        "Drag a connection into the input. The node takes on that wire's type and colour.",
        "Type a name in the field (for example length, base_model, positive).",
        "Add a Get Pixaroma node and choose the same name to read the value back.",
        "Keep the node collapsed (click the dot in its title bar) to keep the canvas tidy.",
      ],
    },
    {
      heading: "Right-click menu",
      defs: [
        ["Select all its Gets", "Highlights every Get node in this graph that reads this name."],
        ["Add paired Get Pixaroma", "Drops a Get already set to this name next to the node."],
        ["Jump to Get in subgraph", "For Gets that live inside a subgraph, opens that subgraph at the Get."],
      ],
    },
    {
      heading: "Subgraphs",
      body:
        "A Set is visible to its own graph and to every subgraph nested inside it. So a Set in the main graph can be read by Gets inside your subgraphs. The same name can be reused in two unrelated subgraphs without clashing.",
    },
    {
      heading: "The little value line",
      body:
        "When the node is expanded and the stored value is a simple number, text, or true/false, a small grey readout shows it (for example = 81). Images, models, and latents show no preview, just the name. It is only a display helper and is never saved into the workflow.",
    },
  ],
  footer: "Tip: keep Set/Get nodes collapsed. They are meant to disappear into the background.",
});

registerNodeHelp("PixaromaGetNode", {
  title: "Get Pixaroma",
  tagline: "Read a value that a Set Pixaroma node stored under a name, with no cable.",
  sections: [
    {
      heading: "What it does",
      body:
        "Get Pixaroma is the other half of the wireless wire. Pick the name of a Set Pixaroma node from its dropdown and the output carries that Set's value, matching its type and colour. Wire the output wherever you need it.\n\nLike Set, it exists only in the editor. At run time the connection resolves straight to the original source, so there is no extra cost and the result is identical to a direct cable.",
    },
    {
      heading: "How to use it",
      bullets: [
        "Click the dropdown and choose which Set to read (it lists the names in scope).",
        "Wire the output into any matching input.",
        "Add as many Get nodes as you like for the same name to fan one value out.",
      ],
    },
    {
      heading: "Right-click menu",
      defs: [
        ["Jump to its Set Pixaroma", "Selects and centres the Set this Get is reading, even across subgraphs."],
      ],
    },
    {
      heading: "Subgraphs",
      body:
        "A Get looks for its Set in its own graph first, then the parent, then further out toward the main graph. So a Get inside a subgraph can read a Set defined in the graph that contains it.",
    },
    {
      heading: "The little value line",
      body:
        "When expanded, a simple number, text, or true/false value shows as a small grey readout (for example = 81). It mirrors whatever the chosen Set is holding. It is display only and is never saved.",
    },
  ],
  footer: "If the dropdown is empty, add a Set Pixaroma node first and give it a name.",
});
