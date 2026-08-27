// Prompt Each Pixaroma - help content for the toolbar ? and the Help browser.
//
// Node-local rather than in help_defs.mjs, because the three-ways explanation is
// long and belongs beside the code it describes. Registered from index.js.
// Written for someone making pictures, not someone reading the source: what it
// does, how to use it, and what actually comes out. No em dashes (house rule).

export const PROMPT_EACH_HELP = {
  title: "Prompt Each Pixaroma",
  tagline: "Many prompts, one Run, one image each.",
  sections: [
    {
      heading: "What it does",
      body:
        "Type your prompts one per line and press Run once. The workflow runs "
        + "again for every prompt, one after another, and all the pictures "
        + "collect in the same Preview node.\n\n"
        + "It runs them one at a time, so it uses no more memory than making a "
        + "single picture. A long list is safe on a small graphics card.",
    },
    {
      heading: "How to wire it",
      bullets: [
        "Drag `prompt` into CLIP Text Encode, where you would normally put your text.",
        "That is the only wire it needs. Everything after it runs once per prompt on its own.",
        "`index` into Save Image keeps the files numbered in the order you typed them.",
        "Nothing to type? Wire any text node into `text` on the left instead.",
      ],
    },
    {
      heading: "How it differs from the other prompt nodes",
      defs: [
        ["Prompt Each", "One Run, one queue entry, one picture per prompt. Everything lands in one Preview."],
        ["Prompt Multi, Queue Text", "One Run, but the queue panel fills with a separate entry per prompt, so you can cancel them one by one."],
        ["Prompt Multi, List Prompts", "Hands the whole list to Prompt From List nodes, and you pick each one by number."],
        ["Prompt Stack and Prompt Pack", "Join pieces of text together into ONE prompt. Those make one picture, not many."],
      ],
    },
    {
      heading: "Square brackets make more prompts",
      body:
        "Put choices in square brackets and you get all of them:\n\n"
        + "`a [red|blue] car`  gives two prompts, a red one and a blue one.\n\n"
        + "Several groups on one line give every combination, so "
        + "`a [red|blue] [car|van]` is four prompts. The counter in the corner "
        + "of the box always shows how many you will actually get, so you can "
        + "see one line turn into six before you press Run.\n\n"
        + "Curly braces are the opposite and still pick one at random, so "
        + "`{morning|evening}` stays one prompt. You can use both on the same "
        + "line. Write \\[ if you want a bracket kept as ordinary text.",
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["Copy all", "Copies everything in the box to the clipboard."],
        ["Replace", "Pastes over everything in the box. This is how you get a hundred prompts in from a spreadsheet in one go."],
        ["Clear", "Empties the box."],
        ["The gear", "Opens the settings, described below."],
      ],
    },
    {
      heading: "Settings, behind the gear",
      defs: [
        ["Split prompts on", "New line means every line is a prompt. Blank line lets one prompt run over several lines and starts the next after an empty line."],
        ["When text is wired in", "Replace uses only what arrives on the wire. Add puts it after whatever is typed on the node."],
        ["Expand [a|b]", "Turn the brackets off if you want them treated as ordinary text."],
        ["Trim spaces", "Drops spaces at the start and end of every prompt."],
        ["Skip empty lines", "An empty line is ignored instead of running with no prompt."],
        ["Stop after", "The most prompts one Run may queue. Brackets multiply fast: three groups of four options on one line is already 64."],
      ],
    },
    {
      heading: "Using your tag library with it",
      body:
        "This node has no tag list of its own, on purpose. Wire Prompt Pixaroma "
        + "into the `text` input and your whole @tag library works here: the "
        + "tags are filled in first, then the result is split into prompts.\n\n"
        + "The same trick adds a shared ending to every prompt. Send `prompt` "
        + "into Text Join Two Pixaroma with your style words in the second box, "
        + "and because this node sends a list, the join happens once per prompt.",
    },
    {
      heading: "What comes out",
      defs: [
        ["prompt", "Each prompt in turn. This is the one you wire to CLIP Text Encode."],
        ["index", "Which prompt this run is, counting from 1."],
        ["total", "How many prompts this Run will produce."],
      ],
    },
  ],
  footer:
    "Nothing to run stops the workflow with a message rather than doing nothing "
    + "quietly, so an empty box can never look like a picture that failed to save.",
};
