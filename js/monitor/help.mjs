// Monitor Pixaroma - the help page, shown by the ? on the node toolbar and as
// its own page in the Pixaroma Help browser (node UI convention #16 / #16b).
// Written for someone making pictures, not someone reading the code.

export const HELP = {
  title: "Monitor Pixaroma",
  tagline: "A live readout of how hard your computer is working.",
  sections: [
    {
      heading: "What it does",
      body:
        "Drop it on the canvas and it shows what your machine is doing right now: how much video memory is in use on your graphics card, how much system memory is gone, how busy the card and the processor are, and how hot the card is running.\n\n" +
        "It does not need to be wired to anything, and it never runs as part of your workflow. It just sits there and watches.",
    },
    {
      heading: "The peak mark is the useful bit",
      body:
        "The pale line on the VRAM bar is the highest point reached during the last run. Nobody is looking at the number at the exact second it spikes, so without it you never really know how close you came.\n\n" +
        "It resets when you press Run, so it always means this run. If your peak sits at 21 of 24 GB, you know a slightly bigger model will not fit. If it sits at 12, you have room to raise the resolution or the batch.",
    },
    {
      heading: "Free VRAM",
      body:
        "Unloads the models ComfyUI is holding and clears its cached results, which is exactly what Free model and node cache does in ComfyUI's own menu. Use it before loading a big model, or when you want to play a game without closing ComfyUI.\n\n" +
        "The next run reloads what it needs, so it costs you the loading time once. Unload models is the gentler one: it drops the models but keeps the cached results, so parts of your graph that did not change are not recomputed. Turn either button on or off in the settings.",
    },
    {
      heading: "Making it bigger",
      body:
        "In the classic node interface, drag the bottom corner: everything scales together, so you can have a big readable panel on a second screen or a small one tucked in a corner. In the new node interface, set the size in the settings panel instead, since the node grows to fit its contents there.\n\n" +
        "Each monitor remembers its own size, saved with the workflow.",
    },
    {
      heading: "Choosing what it shows",
      body:
        "Right-click the node, or press the gear on the node toolbar, and switch any readout on or off. Turn most of them off and pick the Strip layout and you get a single thin line, which is the same node wearing less.",
      defs: [
        ["VRAM", "Video memory in use on the graphics card, out of its total. This is the whole card, so other programs using it are counted too. Memory ComfyUI has finished with but keeps parked for reuse counts as free here, because ComfyUI can use it again straight away. Tools like Crystools or Task Manager count it as used, so they often show a higher number. Free VRAM gives that memory back, and then the numbers come closer."],
        ["RAM", "System memory in use, out of what is installed."],
        ["GPU", "How busy the graphics card is. Needs an NVIDIA card."],
        ["CPU", "How busy the processor is."],
        ["COMFY", "The share of video memory ComfyUI itself is holding, which is mostly the models it has loaded. The gap between this and VRAM is everything else on your machine."],
        ["COMFY R", "System memory the ComfyUI program is using."],
        ["TEMP and PWR", "Temperature and power draw of the graphics card. Needs an NVIDIA card."],
        ["PEAK", "The highest video memory reached during the last run."],
      ],
    },
    {
      heading: "Colour only ever means one thing",
      body:
        "Everything on the node is your chosen colour until memory gets tight: a bar turns amber past 85% and red past 95%. So a coloured bar always means something worth noticing, never decoration. You can switch that off in the settings if you would rather it stayed calm.",
    },
    {
      heading: "If a readout shows a dash",
      body:
        "GPU load, temperature and power come from NVIDIA's own tool, so on an AMD card, on a Mac, or on a machine where that tool is not installed those three show a dash. Everything else still works. Switch them off in the settings and the node closes up around them.\n\n" +
        "A dash on every readout usually means the ComfyUI server is busy or was restarted; it fills back in on its own.",
    },
    {
      heading: "Good to know",
      bullets: [
        "One reading is shared by every Monitor on the canvas, so having two of them does not ask the server twice.",
        "It stops looking while you are on another browser tab, so it costs nothing in the background. You can turn that off.",
        "It samples three times faster while a workflow runs, so the peak mark catches the real high point.",
        "The readings are never saved into your workflow: only your settings are, so a monitor sitting on the canvas cannot keep marking the workflow as changed.",
      ],
    },
  ],
};
