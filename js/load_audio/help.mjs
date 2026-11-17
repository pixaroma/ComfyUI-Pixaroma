// Load Audio Pixaroma - the help page.
// Written for someone making videos, not for someone reading the code.

export const LOAD_AUDIO_HELP = {
  title: "Load Audio Pixaroma",
  tagline: "Pick a sound file, see its shape, and take just the part you want.",
  sections: [
    {
      heading: "What it does",
      body:
        "Loads a sound file and passes on the piece of it you choose.\n\n"
        + "The node draws the whole file as a waveform, so the loud parts and the quiet parts are "
        + "visible at a glance. Drag across it and an orange window follows your cursor: that "
        + "window is what comes out. No counting seconds in your head, and no cutting the file up "
        + "in another program first.",
    },
    {
      heading: "Getting a file in",
      bullets: [
        "Click the file name to choose anything already sitting in ComfyUI's input folder.",
        "Click Upload to copy a new file in from anywhere on your computer.",
        "The list is re-read every time you open it, so a file you just dropped into the folder "
          + "is there straight away.",
      ],
    },
    {
      heading: "How long a piece it takes",
      defs: [
        ["Wired up", "Connect the seconds output of Duration Pixaroma to the duration dot and the "
          + "window is exactly as long as the video you are about to make. Picture and sound then "
          + "come from the same number, so they cannot drift apart."],
        ["Not wired", "The node takes everything from your start point to the end of the file, or "
          + "a fixed length, whichever you picked in the settings."],
      ],
    },
    {
      heading: "If your window runs off the end",
      body:
        "Say the file has three seconds left but you asked for five. The node either fills the "
        + "last two seconds with silence or loops back to the start of your selection, whichever "
        + "you chose in the settings, and the line at the bottom of the node tells you it happened "
        + "rather than leaving you to notice later.",
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["The file name", "Opens the list of sound files. Right-click it for the settings."],
        ["Upload", "Copies a file from your computer into ComfyUI's input folder."],
        ["The waveform", "Drag anywhere on it to move your window."],
        ["Start at", "The same thing as dragging, typed exactly. The arrows step half a second."],
        ["The triangle", "Plays your selection so you can hear it before you spend a render. If "
          + "the browser refuses its normal player, the node plays it another way on its own. If "
          + "that fails too, the line beside the triangle says why, and holding the mouse over it "
          + "shows the browser's own words."],
      ],
    },
    {
      heading: "What comes out",
      defs: [
        ["audio", "The piece you selected. Wire it into a save node, into H3 Audio Sync Pixaroma, "
          + "or anywhere else that takes sound."],
      ],
    },
  ],
  footer: "Works with any model. Nothing in it is specific to one.",
};
