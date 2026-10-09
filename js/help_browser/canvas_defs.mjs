// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - the canvas features                  ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Six Pixaroma features that add NO node at all: they patch the canvas itself.
// Because there is no node to select, the selection-toolbar Help button can
// never reach them, so until now they had nowhere to be documented. This
// browser is the only place they can live, which is a large part of why it
// exists.
//
// Same help-def schema as every node, so the article renderer treats them
// identically. They get no generated control reference, and cannot be dragged
// onto the canvas, because there is no node definition behind them - both are
// gated on `entry.kind === "node"`.

// The address comes from actions.mjs, never typed here: one changed in two
// places and not the third sends half the readers nowhere (pattern #16).
import { LINKS } from "./actions.mjs";
import { pixAsset } from "../shared/api_url.mjs";

export const CANVAS_FEATURES = [
  {
    key: "canvas:align",
    title: "Align",
    tagline: "Nodes snap to line up with each other as you drag, with a guide showing what they lined up with.",
    keywords: "snap guides tidy arrange distribute straight neat messy line up hide button toolbar remove",
    sections: [
      {
        heading: "What it does",
        body: "Drag any node and it snaps to line up with the nodes around it. A thin coloured guide shows what it caught on, so a graph stays tidy without you nudging anything into place by hand. Groups count too, and it works while resizing as well as moving.",
      },
      {
        heading: "Handy to know",
        bullets: [
          "Hold Shift while dragging to ignore snapping for that one move.",
          "The toolbar button turns it on and off, and lights up when it is on.",
          "If you would rather not have that button, you can hide it in Settings under Pixaroma. Snapping is unaffected, and its on/off switch stays in Settings.",
          "How close an edge has to be before it snaps is in Settings, under the Pixaroma section.",
          "A pinned Pixaroma Group is left alone.",
        ],
      },
    ],
    footer: "Alt is not a bypass key here: ComfyUI already uses it to duplicate a node mid-drag.",
  },

  {
    key: "canvas:colors",
    title: "Node Colors",
    tagline: "Right-click any node or group to recolour it, with favourites and copy and paste.",
    keywords: "colour color recolour palette theme paint node group background",
    sections: [
      {
        heading: "What it does",
        body: "Right-click a node or a group and pick a colour from the Pixaroma palette. Colours are grouped by hue, so finding a particular green is quick.\n\nSelect several nodes first and the colour lands on all of them at once.",
      },
      {
        heading: "Favourites",
        body: "Save the pairs you use most and they sit at the top of the menu, so a workflow you colour the same way every time takes a couple of clicks rather than a hunt.",
      },
      {
        heading: "Copy and paste a colour",
        body: "Copy the colour from one node and paste it onto another, which is the fastest way to make a group of nodes match something you already got right.",
      },
    ],
    footer: "Node titles stay readable on any colour you pick, because Adaptive node titles chooses white or dark text for you.",
  },

  {
    key: "canvas:group",
    title: "Pixaroma Group",
    tagline: "A group container with Run, Mute, Bypass and Fold buttons built into its header.",
    keywords: "container box fold collapse organise organize tidy group run mute bypass",
    sections: [
      {
        heading: "What it does",
        body: "A box you draw around part of your workflow, with buttons in its header. Run just that section, mute it, bypass it, or fold the whole thing down to a single bar to get it out of the way.",
      },
      {
        heading: "Working with them",
        bullets: [
          "Drag the header to move the group and everything inside it.",
          "Drag any of the four corners to resize.",
          "Groups can sit inside other groups.",
          "Pin a group to lock it in place so a stray drag cannot move it.",
          "Align snapping works on groups too.",
        ],
      },
    ],
    footer: "This is a Pixaroma container, not ComfyUI's own group. That is what lets it carry buttons in the header.",
  },

  {
    key: "canvas:connfx",
    title: "Connection FX",
    tagline: "Compatible slots pull at your wire while you drag it, and sparkle when it connects.",
    keywords: "wire link drag sparkle magnet connect slot snap dot",
    sections: [
      {
        heading: "What it does",
        body: "While you are dragging a wire, every slot nearby that would actually accept it starts to glow, so you can see where the wire is allowed to go before you let go. When the connection lands, a small burst of sparks confirms it.",
      },
      {
        heading: "Handy to know",
        bullets: [
          "It is off by default. Turn it on in Settings, under the Pixaroma section.",
          "It costs nothing while it is off.",
          "Only slots of a matching type light up, so it doubles as a check that a wire will be accepted.",
        ],
      },
    ],
    footer: "Useful when you are learning which outputs fit which inputs, and pretty enough to leave on afterwards.",
  },

  {
    key: "canvas:titles",
    title: "Adaptive node titles",
    tagline: "Title text picks white or dark by itself so it stays readable on any colour.",
    keywords: "readable contrast title text white dark colour color legible advanced inputs footer tab grey gray",
    sections: [
      {
        heading: "What it does",
        body: "When you colour a node, the title text works out whether white or dark reads better against that colour and switches automatically. A pale yellow node gets dark text, a deep blue one gets white.",
      },
      {
        heading: "Nodes 2.0",
        body: "The tab under a coloured node (Show advanced inputs, or Enter on a subgraph) is painted in the node colour too, so its text follows the same rule. An uncoloured node keeps ComfyUI's own grey there.",
      },
      {
        heading: "Handy to know",
        body: "It is on by default. Turn it off in Settings and titles go back to ComfyUI's usual grey, which can be hard to read on a light node colour.",
      },
    ],
    footer: "This is why you can recolour freely without ever ending up with a title you cannot read.",
  },

  {
    key: "canvas:runfx",
    title: "Run button effects",
    tagline: "A choice of visual effects on ComfyUI's Run button.",
    keywords: "queue button animation fun effect run sparkle rocket flash",
    sections: [
      {
        heading: "What it does",
        body: "Adds an effect to the Run button: a Pixaroma orange tint, a flash, sparkles, a rocket, and a few more. Purely decorative, and it never gets in the way of actually queueing a run.",
      },
      {
        heading: "Handy to know",
        body: "Pick one in Settings, under the Pixaroma section. The default is None, which costs nothing at all.",
      },
    ],
    footer: "Entirely optional. Pick whichever makes pressing Run more enjoyable, or leave it off.",
  },
{
    key: "canvas:workflows",
    title: "Workflows panel",
    icon: pixAsset("icons/ui/workflow.svg"),
    tagline: "A panel for finding, opening and organising the workflow files on your own computer, with a picture of each one.",
    keywords: "workflow browser panel organise organize folder subfolder sub-folder rename move delete duplicate cover thumbnail picture favourite favorite star search find open manage tidy tidying duplicates copies junk clean up sort list grid missing nodes red boxes unsaved keyboard shortcut arrow keys pixaroma workflows website site download example text too small tiny bigger larger size zoom font readable collapse expand fold unfold hide show arrow twisty tree nested new folder inside",
    sections: [
      {
        heading: "What it does",
        body: "Opens from the button shown beside the heading above, in the top toolbar next to the Help question mark. Alt+W does the same, and so does right-clicking empty canvas.\n\nIf you would rather keep the toolbar clear, you can hide that button in Settings under Pixaroma. Alt+W and the right-click entry still open the panel, so nothing is lost.\n\nIt reads the same folder ComfyUI already keeps your workflows in, so everything you have is there the first time you open it. Nothing is imported and nothing is moved.",
      },
      {
        heading: "Finding one",
        bullets: [
          "The cursor starts in the search box, so you can just type.",
          "Search looks INSIDE the files as well as at their names: type a model or LoRA filename, a phrase from a prompt, or your own note, and it finds the workflows that use it.",
          "Arrow keys move the selection: left and right by one card, up and down by a whole row. Enter opens the highlighted one.",
          "Double click a card to open it. A small coloured dot in the corner of a card means it is open right now.",
        ],
      },
      {
        heading: "The pictures on the cards",
        body: "Every workflow gets one straight away: a small map of the graph itself, drawn from where the nodes sit and what colour you gave them. Once a workflow has been run, its own last output picture becomes the cover instead. A workflow that makes a video rather than a picture keeps the drawn map, because there is no image to show.\n\nYou can also choose any picture yourself with Set cover. A cover you chose by hand is never replaced by a later run: it stays until you use Remove cover, which puts the workflow back to its own last output or the drawn map.\n\nCovers you choose by hand are saved as ordinary jpg files in a pixaroma_covers folder inside ComfyUI's user folder, next to your workflows. You can open, back up or delete them like any other file, and a cover you delete simply goes back to the drawn map.",
      },
      {
        heading: "The buttons along the top",
        defs: [
          ["Grid / List", "Picture cards, or a dense sortable list once you have hundreds."],
          ["A A A", "How big everything in the panel is drawn: text, cards, covers and the folder list together. The small A is how the panel first shipped, the middle one is the normal size, and the large one is for a big screen or tired eyes. It is remembered."],
          ["Sort", "Recent, Name, or number of Nodes. It greys out in Recent and while searching, because those two already have an order of their own."],
          ["Open folder", "Opens the selected folder on your computer. On Windows it opens BEHIND the browser, so look in your taskbar for it."],
          ["Save open workflow here", "Saves whatever is on the canvas into the folder you have selected, so new work stops landing loose in the root. A workflow you have never saved becomes that file, so the tab you are working in follows it. One that is already saved somewhere gets a copy in the folder and the tab stays on the original."],
        ],
      },
      {
        heading: "Organising",
        bullets: [
          "Rename a workflow with F2, or right click it and choose Rename. Enter saves, Escape cancels.",
          "Rename a FOLDER by double clicking its name, or from its right-click menu.",
          "Drag a card onto a folder to move it. Select several first with Ctrl+click to move them together.",
          "Drag a folder up or down to reorder it. A line shows where it will land. Folders can be reordered within their level, not dragged inside each other.",
          "A folder with folders inside it has a small arrow. Click the arrow to show or hide what is in it, and the panel remembers. They start closed, so a lot of folders no longer fills the whole column. Whichever folder you are looking at is always shown, whether or not you opened its parent yourself.",
          "To make a folder INSIDE another one, right click the outer folder and choose New folder inside. The plain + New folder at the bottom of the list always makes one at the top level.",
          "Right click a workflow for everything at once: Open, favourite, Rename, Duplicate, Move to folder, Set or Remove cover, Reveal, Delete.",
          "Right click a folder for New folder inside, Rename, Move up, Move down, Reveal and Delete. A folder is only deleted once it is EMPTY: move or delete what is in it first, sub-folders included. That refusal is the safety net, because there is no undo.",
        ],
      },
      {
        heading: "Favourites, Recent and the collections",
        body: "The star adds a workflow to Favourites, on a picture card and on a list row alike. These are ComfyUI's own bookmarks, so the same stars show in ComfyUI's built-in Workflows sidebar.\n\nUnder your real folders there are collections that fill themselves, worked out by reading each file: what it makes (Text to Image, Video, Upscale, Inpaint) and which model family it uses. Your folders are untouched, and a workflow filed in the wrong place still turns up in the right collection.",
      },
      {
        heading: "Needs tidying",
        body: "A shortcut on the left that opens a review screen, grouped by what is actually wrong. Nothing is ever changed for you: every row is a suggestion with its own fix next to it, and anything that deletes still asks first.",
        defs: [
          ["Still called \"Unsaved Workflow\"", "Files saved before you named them. Rename edits the name right there in the row: type over it and press Enter."],
          ["The same workflow saved more than once", "Sets of files with the same nodes and the same models under different names. \"Keep this one\" deletes the others in its set, and tells you which before it does."],
          ["Needs nodes you do not have", "These open with red boxes where the missing nodes should be. Copy list puts the missing node names on your clipboard, ready to search for in ComfyUI Manager."],
        ],
      },
      {
        heading: "What it tells you before you open one",
        body: "Select a workflow and the panel on the right shows when it changed, how many nodes it has, whether any of its nodes are missing on this machine, and every model and LoRA file it needs, with a Copy button for the whole list. There is also a note field in your own words, which search can find.",
      },
      {
        heading: "Keyboard",
        defs: [
          ["Alt+W", "Open or close the panel"],
          ["type", "Search, from the moment it opens"],
          ["arrow keys", "Move the selection"],
          ["Enter", "Open the highlighted workflow"],
          ["F2", "Rename it"],
          ["Escape", "Clear the search, then close the panel"],
        ],
      },
      {
        heading: "Worth knowing",
        bullets: [
          "Deleting a workflow cannot be undone yet, so it always asks first. If the one you are deleting is open with unsaved changes, it says so.",
          "The panel stays open while you work, and while you switch between workflows.",
          "Your notes, chosen covers and folder order are kept beside your workflows, not inside them, so sharing a workflow never carries them along.",
        ],
      },
      {
        heading: "Looking for workflows to download?",
        body: "This panel organises the workflows already on your computer. If you came here wanting NEW ones, the Pixaroma website has ready-made workflows to download, and anything you save from there lands in the same folder this panel reads.",
        links: [["Pixaroma workflows website", LINKS.SITE_URL]],
      },
    ],
    footer: "There is deliberately no Workflows node. A node would be saved into the workflow file and would follow it to anyone you shared it with.",
  },
];
