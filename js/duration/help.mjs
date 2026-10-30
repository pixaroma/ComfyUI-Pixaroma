// Duration Pixaroma - the help shown by the orange ? in the selection toolbar
// and in the full Help browser. Written for someone making videos, not for
// someone reading the code.

export const DURATION_HELP = {
  title: "Duration Pixaroma",
  tagline: "Pick a length in seconds. Get the frame count your model actually wants.",
  sections: [
    {
      heading: "What it is for",
      body:
        "Video models do not think in seconds, they think in frames. Worse, most of them will "
        + "not accept just any number of frames: they want it to land on a particular pattern. "
        + "MiniMax H3 wants every 17th frame plus 5, so 124 frames is fine but 120 is not. Wan "
        + "and Hunyuan want every 4th frame plus 1.\n\n"
        + "That normally means wiring up two nodes: one holding the number of seconds, and one "
        + "doing maths on it. This node is both of them, and it shows you the answer before you "
        + "run anything.",
    },
    {
      heading: "Using it",
      bullets: [
        "Click a length on the node, or drag the slider, depending on how you set it up.",
        "The orange line underneath tells you what will be sent: `5 s -> 124 frames`.",
        "Wire `frames` into the length or frame count input of your video node.",
        "Open the gear on the node to change anything.",
      ],
    },
    {
      heading: "Choosing which lengths are allowed",
      body:
        "This is the part worth setting up once per workflow. Under How you pick, choose "
        + "Buttons and type the lengths you want, such as 3, 5, 10, and the node gives you one "
        + "button each. Choose Slider instead and set a smallest and largest length, and you can "
        + "drag anywhere between them. Type it lets you enter any number inside the same range, "
        + "which the box shows on its right (1 to 10 s at first). A number outside it snaps back "
        + "to the nearest end and the line below says why: raise MAX in the gear for longer videos.\n\n"
        + "Buttons suit a workflow where you always use the same two or three lengths. A slider "
        + "suits one where you want to fine tune. Two Duration nodes on the same canvas can be "
        + "set up completely differently.",
    },
    {
      heading: "Telling it about your model",
      body:
        "Under Convert to frames, pick your model and the node fills in the numbers. Picking a "
        + "model COPIES its settings onto this node, so changing it later never disturbs another "
        + "workflow.\n\n"
        + "If your model is not listed, set the three numbers yourself. FPS is the frame rate. "
        + "STEP is the multiple the frame count has to land on. PLUS is what gets added on top. "
        + "Setting STEP to 1 turns rounding off completely, so you just get seconds times frame "
        + "rate.",
      defs: [
        ["MiniMax H3", "24 fps, every 17 frames plus 5"],
        ["Wan 2.x", "16 fps, every 4 frames plus 1"],
        ["Hunyuan", "24 fps, every 4 frames plus 1"],
        ["LTX", "24 fps, every 8 frames plus 1"],
        ["Plain frames", "no rounding at all"],
      ],
    },
    {
      heading: "Your own formula",
      body:
        "Pick Custom formula if none of that fits, and write the maths yourself. `a` is the "
        + "length in seconds, and you can use `fps` too. It understands the same functions as "
        + "ComfyUI's own Math Expression node, so you can paste one straight across.\n\n"
        + "Only one of these is ever active. Choosing a model switches the formula off, and "
        + "choosing Custom formula switches the model off. If your formula has a mistake in it "
        + "the node says so and falls back to the numbers, rather than failing the whole run.",
    },
    {
      heading: "Why the length changes slightly",
      body:
        "Rounding to your model's pattern almost always moves the length a little. Ask for 5 "
        + "seconds at 24 frames per second and you get 124 frames, which is really 5.17 seconds. "
        + "The node shows you both so it is never a surprise.\n\n"
        + "That is also why there are two outputs. `frames` is what your video node needs. "
        + "`seconds` is the true length, so anything that has to line up with the picture, like "
        + "audio, stays in step instead of drifting.",
    },
    {
      heading: "What comes out",
      defs: [
        ["frames", "A whole number, already adjusted to your model's pattern."],
        ["seconds", "The real length of the video, which is frames divided by frame rate."],
      ],
    },
  ],
};
