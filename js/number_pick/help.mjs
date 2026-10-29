// Number Pick Pixaroma - help. Written for someone who makes pictures, not code.

export const NUMBER_PICK_HELP = {
  title: "Number Pick Pixaroma",
  tagline: "One number, picked from a row of buttons you chose yourself.",
  sections: [
    {
      heading: "What it does",
      body:
        "Holds a single number and sends it wherever you wire it. Instead of typing 20 into a "
        + "steps box, then 30, then back to 20, you put the numbers you actually use on the node "
        + "once and click the one you want.\n\n"
        + "The buttons are yours and they are per node, so one of these can offer 1, 2, 4, 8 for "
        + "a batch size while another offers 10, 20, 30, 40 for steps, on the same canvas. Rename "
        + "the node (double-click its title) and it becomes a labelled control for whatever it "
        + "drives.",
    },
    {
      heading: "Whole numbers or decimals, decided by the wire",
      body:
        "There is one output, not two, and it fits whatever you plug it into. Wire it to steps "
        + "or a batch size and it sends a whole number. Wire it to a frame rate, cfg, denoise or "
        + "a strength and it sends a decimal. Unplug it and it goes back to fitting either, so "
        + "the same node can be moved around without getting stuck as one kind.\n\n"
        + "Before it is wired to anything it decides by the number itself: 4 goes out whole, 4.5 "
        + "goes out as a decimal. It does the same when it goes through Set and Get Pixaroma or "
        + "a Reroute, so a Get can feed steps and megapixels alike.\n\n"
        + "It can also drive several inputs at once. If those want different kinds, it sends each "
        + "number in the form that is safe for both.\n\n"
        + "You cannot wire it somewhere that makes no sense, such as a model or an image input: "
        + "ComfyUI will not make the connection in the first place.",
    },
    {
      heading: "If a button is not exactly the number you want",
      body:
        "Open the settings from the gear and type it in. The field takes any numbers separated by "
        + "commas, spaces or new lines, so you can paste a list in. They are sorted for you and "
        + "duplicates are dropped.\n\n"
        + "Up to 12 buttons fit. They share the width of the node, so a long list gives small "
        + "buttons: drag the node wider, or keep the list to the handful you really switch "
        + "between, which is what the node is for.",
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["A number", "Click it to send that number. The one that is lit is the one it will send."],
        ["The gear", "Opens the settings, where you choose which numbers are on the buttons and the node's colour. Right-clicking the node does the same."],
      ],
    },
    {
      heading: "How it compares to the others",
      defs: [
        ["Number Pixaroma", "A box you type any number into, and it can do maths. Use that when the number is different every time; use this one when you keep going back to the same few."],
        ["Control Panel Pixaroma", "Several sliders and switches in one node, each copying the input it is wired to. Use that to drive a whole sampler from one place; use this for one number you switch between set values."],
        ["Duration Pixaroma", "The same row of buttons, but for a video length in seconds, and it works out the frame count your model will accept. Use that one for anything time-based."],
      ],
    },
  ],
};
