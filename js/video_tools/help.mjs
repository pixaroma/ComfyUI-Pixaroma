// Video Tools Pixaroma - the written help (the toolbar ? and the Help browser).
// Plain words for artists, no em dashes (house rule).

export const VIDEO_TOOLS_HELP = {
  title: "Video Tools Pixaroma",
  tagline: "Join, trim, reverse, loop and fade video clips from any video model, with their sound, in one node. Crossfades, a dip to black, colour matching where clips meet, ping-pong and seamless loops.",
  sections: [
    {
      heading: "How to use it",
      bullets: [
        "Wire the frames of a clip into `video_1` (from Load Video Pixaroma's `video_frames`, or a video model's VAE Decode), and its sound into `audio_1` if it has one.",
        "More clips go into `video_2` and `video_3`. They play one after the other, in that order.",
        "Wire `fps` from Load Video, or set the frame rate your model makes.",
        "Set what to do on the node, then wire `video_frames`, `audio` and `fps` into Save Video Pixaroma and Run.",
        "After a Run the node shows each clip, a timeline of the result and a still of it. `Play` plays a small moving preview right on the node.",
      ],
    },
    {
      heading: "Each clip",
      defs: [
        ["Cut start", "Frames to drop at the start of the clip. A clip made from the last frame of another one often starts on that same frame, which then shows twice at the join: cut 1."],
        ["Cut end", "Frames to drop at the end."],
        ["⟲ Back", "Plays the clip backwards. Its sound plays backwards too."],
      ],
    },
    {
      heading: "Join",
      defs: [
        ["Cut", "One clip right after the other."],
        ["Crossfade", "The end of one clip melts into the start of the next over `Length` frames. The two overlap, so the video gets that many frames shorter. The sound crossfades too."],
        ["Through black", "Fades to black at the end of one clip and back up at the start of the next. Nothing overlaps."],
        ["Match colors", "Shifts each clip's colour and brightness so it matches the end of the clip before it. A clip continued from another one often comes out a little darker or warmer, and this hides the jump. How far it goes is set in the gear."],
      ],
    },
    {
      heading: "Loop",
      defs: [
        ["Repeat", "Plays the whole thing again from the start, `Times` times."],
        ["Ping-pong", "Forward, then backwards, then forward again (a boomerang). The turn-around frames are not shown twice."],
        ["Seamless", "Blends the last `Blend` frames into the first ones, so the video loops with no jump when a player repeats it. It gets that many frames shorter."],
      ],
    },
    {
      heading: "Fade",
      body: "`In` fades up from black over that many frames at the very start, `Out` fades down to black at the very end. The sound fades with the picture.",
    },
    {
      heading: "The timeline",
      body: "Each clip has its own colour (the numbers on the left use the same colours). A crossfade shows as one colour melting into the next, a dip to black as a dark shade, a loop as the same blocks repeated, and fades as dark ends. It follows your settings as you change them, and it knows how long each clip is after one Run.",
    },
    {
      heading: "Settings (the gear)",
      defs: [
        ["Clips of another size", "Every clip takes the size of the first one. Fill crops the edges, Fit adds black bars, Stretch pulls it to size."],
        ["Match colors: strength", "From 0 to 100. 100 matches fully."],
        ["Preview on the node", "Moving keeps a small moving preview after each Run. Off skips it."],
        ["Button colour", "The accent colour of this node."],
      ],
    },
    {
      heading: "Tips",
      bullets: [
        "The sound always stays in step with the picture: every cut, join, loop and fade is done on the sound at the same moments.",
        "Clips should share one frame rate. A clip made at another rate plays faster or slower here.",
        "Long clips use a lot of memory: the finished video is made in one piece. Join long videos in a video editor.",
        "More than three clips? Wire this node's `video_frames` and `audio` into `video_1` and `audio_1` of a second Video Tools.",
      ],
    },
  ],
};
