// Layout Boxes Pixaroma - the written help (the toolbar ? and the Help browser).
// Plain words for artists, no em dashes (house rule).

export const LAYOUT_BOXES_HELP = {
  title: "Layout Boxes Pixaroma",
  tagline: "Draw where things go in your picture, write what goes in each box, and FLUX.3 or MOSS-Image places them there. Works in the Classic and the Nodes 2.0 look.",
  sections: [
    {
      heading: "How to use it",
      bullets: [
        "Set `width` and `height` to your picture size, or wire them from Sizes Pixaroma, so the canvas has the same shape as your latent.",
        "Drag on the canvas to draw a box. The cursor jumps to its row: write what goes there, like `a shiny red apple with a green leaf`.",
        "FLUX.3: in your prompt, write `<obj_1>` for box 1, `<obj_2>` for box 2, and so on, like `a still life with <obj_1> on the left and <obj_2> in the middle`. Wire `elements` into FLUX.3 Layout Prompt (`element`), with your prompt in its `prompt`, and its output into the text encode. Run.",
        "MOSS-Image: write no tags. Your prompt just describes the whole picture, and MOSS-Image Layout Prompt adds the boxes to it. Wire `elements` into its `element`, with your prompt in its `prompt`, the same width and height as your latent into its `width` and `height`, and its output into the text encode. Run.",
      ],
    },
    {
      heading: "Drawing the boxes",
      defs: [
        ["Draw", "Drag on an empty part of the canvas."],
        ["Move", "Drag a box. It stays inside the canvas."],
        ["Resize", "Click a box to select it, then drag one of the eight white squares."],
        ["Order", "The numbers follow the order you drew the boxes in. Draw the background parts first and the things in front last. In the big view, the arrows on a row move a box up or down the list, which changes its number."],
      ],
    },
    {
      heading: "Object or Text",
      body: "Every box starts as an object (`Obj`). Click `Obj` to make it a `Text` box when it should hold exact words, like a shop sign, a book title or a poster headline. A text box gets a second field for the exact words, and its description says how they look (the lettering, the colour). The model is asked to write the words exactly as typed, so keep them short.",
    },
    {
      heading: "The canvas shape",
      body: "The chip in the corner shows the size the canvas is drawn at. It follows `width` and `height`, or the size wired into them (Sizes Pixaroma and Resolution Pixaroma are read before you run). With a picture wired into `background`, the canvas takes the picture's shape instead.\n\nBoxes are kept as parts of the canvas, not pixels, so changing the size keeps every box in its place. A yellow chip means a wired size can't be read before Run; the boxes are still right, the canvas just shows the node's own numbers until you run once.",
    },
    {
      heading: "What comes out",
      defs: [
        ["elements", "Your boxes as prompt elements, the same form as ComfyUI's Create Bounding Boxes node. Wire it into FLUX.3 Layout Prompt or MOSS-Image Layout Prompt. Build JSON Prompt (Ideogram) reads it too."],
        ["preview", "A picture of your boxes with their numbers, over the background when one is wired."],
      ],
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["Undo and Redo", "Step back and forward through your boxes. Ctrl+Z on the canvas also undoes a box, like any change."],
        ["Clear", "Removes every box. Undo brings them back."],
        ["Expand", "Opens a big view for careful drawing. It edits the same boxes, so there is nothing to save: Done, Esc or a click outside closes it. There, Delete removes the selected box."],
        ["Gear", "Settings: the button color."],
        ["× on a row", "Deletes that one box. Hover a row to see which box it is."],
      ],
    },
    {
      heading: "Tips",
      bullets: [
        "Give each box one rich sentence: what it is, its colour and material. The prompt describes the whole scene; with FLUX.3 it also names each box by its tag.",
        "Boxes may overlap. A later box (a higher number) is meant to be in front.",
        "Leave a little room around each box: a box drawn tight on the edge of the canvas can crop the thing it holds.",
        "MOSS-Image Layout Prompt's `character_boxes` uses the numbers shown here: `1, 3` marks box 1 and box 3 as characters instead of objects.",
        "Replacing Create Bounding Boxes in an existing workflow? Wire this node's `elements` where its `elements` went. The result is the same for the same boxes. Create Bounding Boxes can also give a box a colour palette; here, write the colours in the description.",
      ],
    },
  ],
};
