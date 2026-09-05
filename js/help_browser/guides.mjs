// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - the written guides                   ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Four short pages that are not about any single node. They use the same
// help-def schema as every node (see js/shared/help.mjs), so the article
// renderer does not need to know the difference.
//
// There is deliberately NO "install the nodes" page: nobody can read in-app
// help before installing, so an install guide here would be talking to an empty
// room. Installing lives on the Pixaroma website. What people actually need
// in-app is UPDATING, which is the first page below.
//
// All of this text ships with the plugin, so it works with no internet and
// behind a company proxy - the same offline-first rule as the rest of Pixaroma.
//
// Addresses come from LINKS so there is ONE place to change them: the same
// three appear in the window footer, and a Discord invite that had been updated
// in one place and not the other would send half the readers nowhere.

import { LINKS } from "./actions.mjs";

export const GUIDES = [
  {
    key: "guide:update",
    icon: "⬆️",
    title: "Update the nodes",
    tagline: "Three ways to get the newest version, in the order to try them.",
    keywords: "update upgrade newer version manager easy install git pull latest",
    sections: [
      {
        heading: "The easy ways",
        defs: [
          ["ComfyUI Manager", "Open the Manager, find Pixaroma in the installed list, press Update, then restart ComfyUI."],
          ["ComfyUI Easy-Install", "Run the updater that came with it. It fetches the newest version for you."],
        ],
      },
      {
        heading: "When neither works",
        body: "Open a terminal in the plugin folder and pull the newest version by hand:",
        bullets: [
          "Go to `ComfyUI/custom_nodes/ComfyUI-Pixaroma`",
          "Run `git pull`",
          "Restart ComfyUI",
        ],
      },
      {
        heading: "Did it actually take?",
        body: "Worth ten seconds, because an update can finish with a tick and still leave you on the old version. Compare the version in the footer of this window against the newest one on the Pixaroma site. If the number went up, the update worked.",
      },
      {
        heading: "The number did not go up",
        body: "Then the update did not land, and clearing the browser cache will not help. The usual cause is that Manager installs from the Comfy Registry, which can sit behind the repository. Switch Pixaroma to nightly in Manager, which installs straight from the repository, or use Easy-Install or `git pull` instead.",
      },
      {
        heading: "The number went up, but nothing looks different",
        body: "That is the browser holding on to the old files rather than the update failing. The fix takes about five seconds and is on the Buttons or nodes missing? page.",
      },
      {
        heading: "Which version am I on?",
        body: "The footer of this window shows it on every page, and clicking it copies the full details. The Version Check Pixaroma node shows it too. Either is worth putting in any question you ask, because it is the first thing anyone will need to know.",
      },
    ],
    footer: "Installing for the very first time is covered on the Pixaroma website. This page is for people who already have the nodes, which is everyone who can read it.",
  },

  {
    key: "guide:fonts",
    icon: "🔤",
    title: "Add your own fonts",
    tagline: "Drop a font file into one folder and it appears in the font list.",
    keywords: "font fonts ttf otf typeface family typography custom own install add where folder missing google fonts download handwriting bold italic",
    sections: [
      {
        heading: "Where fonts go",
        body: "Pixaroma reads your fonts from ComfyUI's own models folder, so they sit with the rest of your files rather than inside the plugin (an update can never wipe them):",
        bullets: [
          "Put your `.ttf` or `.otf` files in `ComfyUI/models/fonts`",
          "Open a font list on any node and click the `↻` button next to the filter box",
          "Your font is now in the list, under `Custom`",
        ],
      },
      {
        heading: "No restart needed",
        body: "The `↻` button rescans the folder while ComfyUI keeps running, so you can add a font and use it straight away. The folder is created for you the first time ComfyUI starts with Pixaroma installed, so if it looks empty you are in the right place.",
      },
      {
        heading: "Which nodes use them",
        defs: [
          ["Text Overlay Pixaroma", "The font list on the node panel and in the fullscreen editor."],
          ["Text Watermark Pixaroma", "The same font list on the node panel."],
          ["Image Composer Pixaroma", "Text layers inside the compositor."],
        ],
      },
      {
        heading: "Add the whole family, not just one file",
        body: "Pixaroma reads the weight and the slant out of each file and groups the whole family under one name, so copy in every file you have (Regular, Bold, Light, Italic, and so on). That is what makes the `B` and `I` buttons use the real thing.\n\nWith only one file it still works, but the two buttons behave differently: italic gets faked by slanting the letters, while bold falls back to the nearest weight you actually have, so it can look no different from normal.",
      },
      {
        heading: "Keeping fonts somewhere else",
        body: "If your models live on another drive, point ComfyUI's `extra_model_paths.yaml` at your folder with a `fonts:` entry, exactly like `checkpoints:` or `loras:`. Pixaroma reads every folder ComfyUI registers, so fonts there are picked up too.",
      },
      {
        heading: "What is supported",
        body: "`.ttf` and `.otf` files. Font collections (`.ttc`) and web font formats (`.woff`, `.woff2`) are not read. A variable font works, but it renders at its normal setting rather than exposing its sliders.",
      },
    ],
    footer: "Pixaroma also ships a set of fonts built in, so the list is never empty. Your own fonts sit alongside them and are never touched by an update.",
  },

  {
    key: "guide:workflow",
    icon: "▶️",
    title: "Run a downloaded workflow",
    tagline: "Two ways to open a workflow file you downloaded.",
    keywords: "json episode download open load workflow file drag",
    sections: [
      {
        heading: "The quick way",
        body: "Drag the workflow file straight onto the ComfyUI canvas. It opens immediately. Nothing to copy, nothing to restart.",
      },
      {
        heading: "The tidy way",
        body: "Put the file where ComfyUI keeps your workflows, so it shows up in the workflows list every time:",
        bullets: [
          "Copy the `.json` file into `ComfyUI/user/default/workflows/`",
          "Refresh the browser page",
          "Open it from the workflows list in the sidebar",
        ],
      },
      {
        heading: "Missing nodes when it opens?",
        body: "A workflow can use nodes you do not have yet. ComfyUI will name them, and the Manager can install the missing ones for you. If the missing node is a Pixaroma one, you are simply on an older version: see Update the nodes.",
      },
    ],
    footer: "A workflow made on someone else's machine may point at models you do not have. The download links are usually in a note on the canvas.",
  },

  {
    key: "guide:cache",
    icon: "🧹",
    title: "Buttons or nodes missing?",
    tagline: "Almost always the browser cache. Here is the five second fix.",
    keywords: "cache refresh blank broken missing stale empty buttons gone disappeared not showing hide hidden toolbar align workflows help bring back restore",
    sections: [
      {
        heading: "Is it only the Align, Workflows or Help button?",
        body: "If everything else is fine and one of those three toolbar buttons is the only thing gone, it is probably switched off rather than broken. Open Settings, find the Pixaroma section, and look for the three \"Show the ... button in the top toolbar\" boxes. Tick the one you want back.\n\nWorth knowing either way: hiding a button never turns the feature off. Alt+W still opens Workflows and Alt+H still opens Help, and both are also on the right-click menu on empty canvas.",
      },
      {
        heading: "Try this first",
        body: "Hold Ctrl and Shift and press R. On a Mac, hold Command and Shift and press R. That forces the browser to fetch the newest files instead of reusing what it saved earlier.",
      },
      {
        heading: "If it is still wrong",
        bullets: [
          "Press F12 to open the developer tools",
          "Go to the Network tab",
          "Tick Disable cache",
          "Leave the tools open and reload the page",
        ],
      },
      {
        heading: "Why this happens",
        body: "Browsers keep a copy of files so pages load faster. After an update, the browser can keep serving yesterday's copy, so new buttons never appear and a node can look half broken. The plugin now stamps its files so this should fix itself, but a very old saved copy may need one last manual refresh.",
      },
      {
        heading: "Still not right?",
        body: "Add a Version Check Pixaroma node. If it warns that the browser is running older files than the plugin, the cache is still the problem. If the versions match, it is something else, so ask in #pixaroma-nodes on Discord and say which node.",
        links: [["💬 Ask in #pixaroma-nodes", LINKS.DISCORD_URL, "pixhb-discord"]],
      },
    ],
    footer: "This one fix solves most reports that start with \"it looks broken\", so it is always worth trying before anything else.",
  },

  {
    key: "guide:help",
    icon: "💬",
    title: "Need help?",
    tagline: "Where to ask, and what to include so you get an answer quickly.",
    keywords: "support discord youtube question ask tutorial video community channel invite link",
    sections: [
      {
        heading: "On Discord, pick the right channel",
        body: "Both are on the same server, and asking in the right one gets you a faster answer from people who know that part.",
        defs: [
          ["#pixaroma-nodes", "Anything about these nodes: something looks broken, a node is not doing what you expected, or you are not sure which node to use."],
          ["#comfyui", "Anything about ComfyUI itself: models, installing, updates, and errors that are not coming from a Pixaroma node."],
        ],
        links: [["💬 Open Discord", LINKS.DISCORD_URL, "pixhb-discord"]],
      },
      {
        heading: "Or watch it instead",
        body: "The tutorial episodes are often the better answer to a \"how do I\" question, because you can watch it being done rather than read it.",
        links: [["▶️ YouTube tutorials", LINKS.YOUTUBE_URL, "pixhb-yt"]],
      },
      {
        heading: "What to include",
        bullets: [
          "Which node, what happened, and what you expected instead",
          "Your version, shown in the footer of this window. Clicking it copies the full details",
          "A screenshot of the node if it looks wrong",
        ],
      },
      {
        heading: "Before you ask",
        body: "If buttons are missing or a node looks half drawn, try the cache fix first. It solves most of these, and it takes five seconds.",
      },
    ],
    footer: "The Copy as text button on any page puts that page's explanation on your clipboard, version line included, ready to paste with your question.",
  },
];
