// Reference Images Pixaroma - the written help (the toolbar ? and the Help browser).
// Plain words for artists, no em dashes (house rule).

export const REFERENCE_IMAGES_HELP = {
  title: "Reference Images Pixaroma",
  tagline: "Up to 12 reference pictures on one node, each with a role, and a prompt that names every picture the way your model expects. For Qwen Image 2.1, FLUX 3 Image Klein, MiniMax H3, Flux 2 Klein and other models that take several pictures.",
  sections: [
    {
      heading: "How to use it",
      bullets: [
        "Drop pictures on the node, click `Add`, or select the node and paste one with Ctrl+V.",
        "Under each picture, pick what it is for: `Character`, `Outfit`, `Pose`, `Style`, `Background` and more. The small box under it can name it, like `the woman in red`.",
        "Write what to make in `Your prompt`. Write `@1` for picture 1, `@2` for picture 2 (or click a picture's number to add it), like `Put @1 in the outfit from @2 on a sunny beach`.",
        "Wire `prompt` into the prompt of your model's text encode, and the outputs `1`, `2`... on the right edge (picture 1, picture 2) into its picture inputs, in the same order. One output can feed several nodes.",
        "Run. `Prompt sent` shows the exact text the model gets.",
      ],
    },
    {
      heading: "Why the tags matter",
      body: "Every model names its reference pictures its own way, and a prompt that says it the wrong way leaves the model guessing which picture is which. This node writes them for you:",
      defs: [
        ["Qwen Image 2.1", "`<image1>`, `<image2>`..."],
        ["FLUX 3 Image Klein", "`<ref_image_0>`, `<ref_image_1>`... It counts from 0, so picture 1 is `<ref_image_0>`."],
        ["MiniMax H3", "`<Picture 1>`, `<Picture 2>`..."],
        ["Plain words", "`image 1`, `image 2`, for Flux 2 Klein and most other models."],
        ["Custom", "Your own pattern, set in the gear. `{n}` is the number from 1, `{i}` from 0."],
      ],
    },
    {
      heading: "Model: Auto",
      body: "Auto follows the `prompt` wire to see where it goes: into Text Encode Qwen Image 2.1 it writes Qwen's tags, into a FLUX 3 reference node FLUX 3's, into a MiniMax H3 node H3's, and plain words otherwise. The button shows what it found. When the prompt goes through other nodes first (Prompt, Find and Replace, Text Join...), Auto still follows it. Pick the model yourself when it can't tell.",
    },
    {
      heading: "The picture list",
      body: "Before your own words the node adds one sentence that says what each picture is for, like `Use the character from <image1>, the outfit from <image2> and the background from <image3>.` It follows the roles and names you set. In the gear you can move it after your words, turn it off, or change the words used for each role.",
    },
    {
      heading: "The buttons on a picture",
      defs: [
        ["The number", "Click it to write `@1` (or `@2`...) where the cursor is in your prompt."],
        ["Click the picture", "Use another picture in its place. Dropping a picture on it does the same."],
        ["◀ ▶", "Move it left or right. Its number changes, and so does which output it comes out of. The `@` numbers in your prompt move with it (a prompt that comes over the `text` wire keeps its numbers: check them)."],
        ["×", "Remove it. Its output goes with it, and the wires and the `@` numbers of the pictures after it stay with their pictures. Its own `@` number in your prompt becomes its words (like `the outfit`). A prompt that comes over the `text` wire keeps its numbers: check them."],
      ],
    },
    {
      heading: "What comes out",
      defs: [
        ["prompt", "Your words with every `@1`, `@2` turned into the model's tag, plus the picture list."],
        ["1, 2, 3...", "The pictures, one output each (image_1, image_2... in menus), in the order shown. A new dot appears on the right edge for every picture you add, up to 12."],
      ],
    },
    {
      heading: "Settings (the gear)",
      defs: [
        ["The picture list", "Before your prompt, after it, or off."],
        ["Transparent parts", "The colour put behind a picture with a see-through background: white, grey or black."],
        ["Picture size", "Keep them as they are, or make big ones smaller (up to 1 or 2 megapixels). Smaller is faster."],
        ["Round the size to", "Trims a few pixels off the edges so the size divides by 16, 32 or 64. Auto trims to 32 for Qwen Image 2.1, whose text encode would otherwise stretch each picture a little."],
        ["The words for each role", "How each role is said in the picture list."],
        ["Button colour", "The accent colour of this node."],
      ],
    },
    {
      heading: "Tips",
      bullets: [
        "Give each picture one job. A picture of a person in a dress used for the outfit can bring the person along too: say it in your words (`only the dress from @2`).",
        "With Qwen Image 2.1 and FLUX 3, the result takes the shape of picture 1. Put the picture whose shape you want first, or set the size with an Empty Latent.",
        "Want your prompt from another node? Wire it into `text`. The box on the node then shows it is wired, and `@1`, `@2` in the wired text still become the tags.",
        "The pictures are saved in ComfyUI's input folder. A workflow shared with someone else needs the pictures too.",
        "Drag the node wider for bigger pictures (up to 4 a row), or taller for a bigger `Your prompt` box. It never gets small enough to hide a picture.",
        "Only need pictures, no prompt? Leave `prompt` unwired and use the outputs alone, for example one picture per first and last frame of a video.",
      ],
    },
  ],
};
