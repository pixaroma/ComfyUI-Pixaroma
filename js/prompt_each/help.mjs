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
        "Put one prompt in each row and press Run once. The workflow runs "
        + "again for every prompt, one after another, and all the pictures "
        + "collect in the same Preview node.\n\n"
        + "It runs them one at a time, so it uses no more memory than making a "
        + "single picture. A long list is safe on a small graphics card.",
    },
    {
      heading: "Switching a prompt off",
      body:
        "Click a row's ON button and it turns off: the prompt stays where it is "
        + "but is skipped, so you can try the list without one of them and put it "
        + "back later without retyping. The counter above always shows how many "
        + "will actually run.\n\n"
        + "Copy keeps the switches: a switched-off prompt is copied out as a line "
        + "starting with `#`, so pasting that list back in brings the same rows "
        + "back switched off.\n\n"
        + "A row is controlled only by its own button, so you can safely start a "
        + "prompt with a `#` and number your list. It is only text that arrives "
        + "in a block, from Paste or from the `text` input, where a line "
        + "starting with `#` is treated as switched off.",
    },
    {
      heading: "How to wire it",
      bullets: [
        "Drag `prompt` into CLIP Text Encode, where you would normally put your text.",
        "That is the only wire it needs. Everything after it runs once per prompt on its own.",
        "`index` into Save Image keeps the files numbered in the order you typed them.",
        "The `text` input on the left adds EXTRA prompts from another node, one per line, run after the rows. Wire Prompt Pixaroma into it and your whole tag library works here.",
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
        + "`a [red|blue] [car|van]` is four prompts. The counter at the top "
        + "always shows how many you will actually get, so you can see one row "
        + "turn into six before you press Run.\n\n"
        + "Curly braces are the opposite and still pick one at random, so "
        + "`{morning|evening}` stays one prompt. You can use both on the same "
        + "line. Write \\[ if you want a bracket kept as ordinary text.",
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["Add row", "Adds an empty prompt at the end and puts the cursor in it."],
        ["Clear all", "Empties the text in every row, keeping the rows and their switches."],
        ["Reset", "Back to one empty row."],
        ["Copy", "Up beside the counter: copies every prompt to the clipboard, one per line."],
        ["Paste", "Beside it: replaces every row with the clipboard, one prompt per line. This is how a hundred prompts get in from a spreadsheet in one go."],
        ["Copy and Paste with long prompts", "If any of your prompts runs over several lines, switch `Cut pasted and wired text on` to Blank line first. On New line the clipboard treats every line as its own prompt, so copying and pasting back would break a long prompt into several rows."],
        ["The gear", "Opens the settings, described below."],
      ],
    },
    {
      heading: "Settings, behind the gear",
      defs: [
        ["Cut pasted and wired text on", "ONLY affects text that arrives in one block: the Paste button and the text input. Your rows are already separate prompts, so this never changes them. New line makes every line a prompt; Blank line lets a prompt run over several lines and starts the next after an empty line."],
        ["Wired prompts go", "Before or after your rows. They are always added, never instead, so this is just the order the pictures come out in."],
        ["Expand [a|b]", "Turn the brackets off if you want them treated as ordinary text."],
        ["Trim spaces", "Drops spaces at the start and end of every prompt."],
        ["Skip empty lines", "An empty line is ignored instead of running with no prompt."],
        ["Stop after", "The most prompts one Run may queue, so a typo cannot start hundreds of renders. Brackets multiply fast: three groups of four options on ONE row is already 64. It counts prompts, not rows."],
      ],
    },
    {
      heading: "Using your tag library with it",
      body:
        "This node has no tag list of its own, on purpose. Wire Prompt Pixaroma "
        + "into the `text` input and your whole @tag library works here: the "
        + "tags are filled in first, then the result is split into prompts.\n\n"
        + "Anything on that input is ADDED after your rows, so what is on the "
        + "node is always part of what runs. To use only the wired prompts, "
        + "press Reset.\n\n"
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
