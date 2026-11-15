// Seamless Preview Pixaroma - the help shown by the orange ? in the selection toolbar
// and in the Help browser. Written for someone making patterns, not for someone
// reading the code. Plain English, no em dashes.

export const SEAMLESS_PREVIEW_HELP = {
  title: "Seamless Preview Pixaroma",
  tagline: "See a pattern repeat, and let it check the edges for you.",
  sections: [
    {
      heading: "What it is for",
      body:
        "A seamless pattern only works if its right edge continues into its left edge and its bottom "
        + "edge into its top edge. Looking at one picture does not tell you that. This node shows the "
        + "picture repeated, checks the edges and tells you if they join.\n\n"
        + "Put it after VAE Decode. It works with any picture, so you can also check a pattern you made "
        + "somewhere else.",
    },
    {
      heading: "The views",
      body: "Pick the view in the view dropdown. The face changes at once; the tiled output follows on the next Run.",
      defs: [
        ["Tile", "The picture on its own."],
        ["2x2 and 3x3", "The picture repeated. A seam shows up as a straight line or a cut through a motif."],
        ["Offset", "The picture moved by half a tile, so the four corners meet in the middle. This is where a "
          + "seam shows first: look at the middle cross."],
        ["Half-drop", "Every other column moved down by half a tile. Fabric printers such as Spoonflower offer "
          + "this repeat; it hides a grid feel."],
        ["Half-brick", "Every other row moved right by half a tile, like bricks in a wall."],
      ],
    },
    {
      heading: "The edge check",
      body:
        "The two chips check each direction: the arrow left and right for the left and right edges, the "
        + "arrow up and down for the top and bottom edges. Point at a chip for the numbers.",
      defs: [
        ["PASS", "The edge looks like any other line in the picture. It repeats with no visible seam."],
        ["WARN", "The edge is the strongest line in the picture, but only a little. Look at it in Offset; "
          + "with pictures that have hard lines (planks, tiles, pixel art) this can happen by chance."],
        ["FAIL", "A real seam: the edge stands out from every other line. Most pictures made without Seamless "
          + "Tile Pixaroma get this."],
        ["N/A", "Not checked: the picture is smaller than 64 px that way, or its pixels are broken (a black "
          + "picture from a failed run)."],
      ],
    },
    {
      heading: "Lines",
      body:
        "The Lines switch draws a thin line where each tile starts, so you can see the repeat. Turn it off "
        + "to judge the seam by eye: a line on top would hide it.",
    },
    {
      heading: "Outputs",
      defs: [
        ["image", "The same picture, unchanged. Connect it to a save node."],
        ["tiled", "The picture repeated the way the view shows it, as one bigger picture: 2x2 is twice as "
          + "wide and tall. Handy for a mock-up or a thumbnail."],
      ],
    },
    {
      heading: "A batch",
      body:
        "With several pictures in, the arrows next to the chips step through them. The face shows and "
        + "checks the first 16; the tiled output has all of them.",
    },
  ],
  footer: "Pairs with Seamless Tile Pixaroma, which makes the picture seamless in the first place.",
};
