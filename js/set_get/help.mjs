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
        "Set Pixaroma is a wireless wire. Connect anything into it (an image, a model, a number, a prompt) and give it a name. A Get Pixaroma node anywhere in the workflow can then read that same value by picking the name, with no cable running across the canvas.\n\nIt also has a passthrough output: wire it straight to a node sitting nearby, and use Get nodes for the ones far away - same value either way.\n\nIt lives only in the editor. At run time the value flows straight from the original source, exactly as if you had wired it directly, so it never slows anything down or changes the result.",
    },
    {
      heading: "How to use it",
      bullets: [
        "Drag a connection into the input. The node takes on that wire's type and colour.",
        "Type a name in the field (for example length, base_model, positive).",
        "Wire the output to a nearby node directly, or add Get Pixaroma nodes for far-apart ones.",
        "Keep the node collapsed (click the dot in its title bar) to keep the canvas tidy.",
      ],
    },
    {
      heading: "Colours",
      body:
        "Colour a Set however you like (right-click -> Colors). Any Get that reads it takes the same colour, so matching pairs are easy to spot, and the Gets follow along when you recolour the Set later. Turn off 'Get matches its Set's colour' in Settings (under Pixaroma) to leave Gets on their own colour.",
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
      heading: "Subgraphs (important)",
      body:
        "Think of subgraphs as nested boxes. A Set reaches INWARD, never outward: it can be read inside its own graph and any subgraph nested deeper inside it, but never by the graph outside it.\n\nSo a Set in the MAIN graph can be read by Gets everywhere, including inside your subgraphs. A Set placed INSIDE a subgraph stays private to that subgraph, so a Get outside cannot see it.\n\nTip: put a Set in the main graph for any value you want to reach everywhere. Because each Set stays in its own box, two separate subgraphs can reuse the same name for different things without clashing.",
    },
    {
      heading: "The little value line",
      body:
        "When the node is expanded and the value is a plain number, text, or true/false, a small grey readout shows it (for example = 81). Images, models, and latents show no preview, just the name.\n\nIt is a quick helper that peeks at the source field, so a plain Number or Text node reads exactly. If the value is calculated by another node (a math node, a sampler), it is only known once you run, so the line stays blank. It is display only, never saved, and never changes the value that actually flows.",
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
        "Click the dropdown and choose which Set to read (it lists the Sets it can reach from here).",
        "Wire the output into any matching input.",
        "Add as many Get nodes as you like for the same name to fan one value out.",
      ],
    },
    {
      heading: "Colours",
      body:
        "A Get takes the colour of the Set it reads, so a matching pair is easy to spot, and each name in the dropdown is tagged with that Set's colour. Colour the Set (right-click -> Colors) and the Get follows. Turn off 'Get matches its Set's colour' in Settings (under Pixaroma) to leave Gets alone.",
    },
    {
      heading: "Right-click menu",
      defs: [
        ["Jump to its Set Pixaroma", "Selects and centres the Set this Get is reading, even across subgraphs."],
      ],
    },
    {
      heading: "Subgraphs (important)",
      body:
        "A Get reads OUTWARD. It looks for its Set in its own subgraph first, then the graph just outside it, and so on out to the main graph. So a Get inside a subgraph can read a Set in the main graph (or any graph that contains it), but it cannot reach a Set buried inside a different subgraph.\n\nShort version: a Set reaches inward, a Get reads outward. Keep shared Sets in the main graph and any Get can read them. If the dropdown does not list a name you made, that Set is in a box this Get cannot see into.",
    },
    {
      heading: "The little value line",
      body:
        "When expanded, a plain number, text, or true/false shows as a small grey readout (for example = 81), mirroring the chosen Set. A value calculated by another node is only known once you run, so the line stays blank until then. Display only, never saved, never changes the value that flows.",
    },
  ],
  footer: "If the dropdown is empty, add a Set Pixaroma node first and give it a name.",
});
