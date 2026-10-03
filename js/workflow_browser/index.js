// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows                                            ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// A floating panel for finding and organising workflows, opened from the button
// beside the Help ? in the top toolbar.
//
// There is deliberately NO node. A node would be saved into the workflow file,
// so sharing a workflow would spread a stray node to everyone who opened it,
// and it could not help somebody staring at an empty canvas. This belongs to
// the app, exactly like Help.

import { app } from "../../../scripts/app.js";
import { createWorkflowWindow, el, copyText, markRendering } from "./window.mjs";
import { injectWorkflowCSS } from "./css.mjs";
import {
  renderFolders, orderedFolders, siblingsOf, beginFolderRename,
} from "./folders.mjs";
import { openContextMenu, closeContextMenu, setMenuFocusHome } from "./menu.mjs";
import { renderGrid, beginRename, setRenameLostNotifier, dropRename } from "./grid.mjs";
import { renderTidy } from "./tidy.mjs";
import { CARD_MIME } from "./drag.mjs";
import { renderDetail } from "./detail.mjs";
import { searchEntries } from "./search.mjs";
import { installOutputCoverCapture, hasHandCover } from "./cover.mjs";
import { globalAccent, BRAND } from "../shared/index.mjs";
import { versionParts, versionLine } from "../shared/version.mjs";
import * as A from "./api.mjs";

const CMD_ID = "Pixaroma.OpenWorkflowBrowser";
const VIEW_SETTING = "Pixaroma.Workflows.View";
const SORT_SETTING = "Pixaroma.Workflows.Sort";
const DENSITY_SETTING = "Pixaroma.Workflows.Density";

/**
 * How big everything in the panel is drawn.
 *
 * One multiplier feeds --pixwb-k, which every size in css.mjs is expressed
 * against, so text, cards, covers and the folder column all move together -
 * the panel gets roomier rather than just wordier.
 *
 * "m" is the default because the panel shipped noticeably smaller than
 * ComfyUI's own sidebar and people said so; "s" is exactly what it used to be,
 * for anyone who wants the density back.
 *
 * The variable is set on the ROOT element, not the window, because the
 * right-click menu and the toast are fixed-position children of <body> and
 * would not inherit it from the panel.
 */
const DENSITY = {
  s: { k: 1, label: "Small - the most workflows on screen at once" },
  m: { k: 1.15, label: "Medium - the default" },
  l: { k: 1.32, label: "Large - biggest text and biggest pictures" },
};

function applyDensity(which) {
  const k = DENSITY[which]?.k ?? DENSITY.m.k;
  try { document.documentElement.style.setProperty("--pixwb-k", String(k)); } catch { /* nothing to do */ }
}

// No "size": a workflow is a small json either way, so the biggest file tells
// you nothing worth ordering by. Node count answers the question people
// actually meant by it.
const SORT_LABELS = { recent: "Recent", name: "Name", nodes: "Nodes" };

const S = {
  win: null,
  btn: null,
  loading: false,
  entries: [],
  rawFolders: [],
  folders: [],
  sortBtn: null,
  collections: [],
  issues: {},
  tidyRels: new Set(),
  meta: { notes: {}, covers: {}, folderColors: {}, folderExpanded: [] },
  favourites: new Set(),
  openPaths: [],
  byRel: new Map(),
  sel: { kind: "all" },
  selected: new Set(),
  kbdRel: null,
  query: "",
  view: "grid",
  sort: "recent",
  density: "m",
  visible: [],
  accent: BRAND,
};

// ── data ─────────────────────────────────────────────────────────────────────

let loadSeq = 0;

async function loadData() {
  // Every load carries a ticket. Two loads overlap easily - opening the panel
  // fires one, and any action fires another through guard() - and whichever
  // RESOLVES last used to win, not whichever started last. A slow first load
  // landing after a rename would put the old name back on screen and make the
  // rename look like it had failed.
  const ticket = ++loadSeq;
  S.loading = true;
  try {
    // Favourites are not in memory until ComfyUI is asked to read them, and
    // reading the list before that reports none - see ensureFavouritesLoaded.
    const [idx, meta] = await Promise.all([A.fetchIndex(), A.fetchMeta(), A.ensureFavouritesLoaded()]);
    if (ticket !== loadSeq) return;          // a newer load already answered
    S.entries = idx.entries || [];
    S.rawFolders = idx.folders || [];
    S.collections = idx.collections || [];
    S.issues = idx.issues || {};
    S.meta = meta.meta || { notes: {}, covers: {}, folderColors: {} };
    // The server lists folders alphabetically; the user's chosen order lives in
    // the sidecar and is applied here, once, rather than on every render.
    S.folders = orderedFolders(S.rawFolders, S.meta.folderOrder);

    // Which nodes are actually missing has to be worked out HERE, not on the
    // server. Python's node list holds only Python-backed nodes, so checking
    // against it flagged 108 of 143 workflows as broken - every one containing
    // a Note, a MarkdownNote, a Primitive or any of rgthree's nodes, all of
    // which are registered by the FRONTEND and are perfectly fine. The
    // browser's registry has both kinds, so it is the only honest answer to
    // "will this workflow open on this machine".
    const registry = window.LiteGraph?.registered_node_types || null;
    const missingNodes = [];
    S.byRel = new Map();
    for (const e of S.entries) {
      e._note = S.meta.notes?.[e.rel] || "";
      e._missing = registry
        ? (e.class_types || []).filter((t) => !(t in registry))
        : [];
      if (e._missing.length) missingNodes.push({ rel: e.rel, name: e.name, missing: e._missing });
      S.byRel.set(e.rel, e);
    }
    S.issues.missing_nodes = missingNodes;
    S.tidyRels = collectTidyRels(S.issues);

    // The SELECTION has to survive the reload, and "survive" includes pointing
    // at something that still exists. A selected folder can vanish without the
    // panel doing it - deleted in Explorer, renamed on another PC, cleaned up by
    // a script - and the stale selection then filtered every workflow out: the
    // panel sat on "Nothing in here yet." with no sidebar row lit and no hint
    // why. Found by doing exactly that. Fall back to All workflows, which is
    // never wrong, merely general.
    if (S.sel.kind === "folder" && S.sel.value !== "" && !S.folders.includes(S.sel.value)) {
      S.sel = { kind: "all" };
    } else if (S.sel.kind === "collection" && !S.collections.some((c) => c.id === S.sel.value)) {
      S.sel = { kind: "all" };
    } else if (S.sel.kind === "tidy" && !S.tidyRels.size) {
      // The last problem was just fixed: the shortcut row disappears, so a
      // selection of it must not strand the view on an empty screen.
      S.sel = { kind: "all" };
    }
  } catch (err) {
    if (ticket !== loadSeq) return;
    S.entries = [];
    S.win?.toast("Could not read the workflows folder: " + err.message);
  } finally {
    if (ticket === loadSeq) S.loading = false;
  }
  refreshLive();
}

/** Every workflow that needs attention, as one set of paths.
 *
 *  The badge and the view MUST come from this same set. Counting issue GROUPS
 *  instead said "18" beside a view holding 35 cards, because 16 duplicate
 *  groups are 33 files. A count that does not match what the click shows is
 *  worse than no count. */
function collectTidyRels(issues) {
  const rels = new Set();
  for (const u of issues.unsaved_names || []) rels.add(u.rel);
  for (const g of issues.duplicates || []) for (const d of g) rels.add(d.rel);
  for (const m of issues.missing_nodes || []) rels.add(m.rel);
  return rels;
}

/** The bits that change without the disk changing: which workflows are open
 *  right now, and which are starred. Re-read on every render, never cached
 *  across a workflow switch (the panel stays open across them). */
function refreshLive() {
  try {
    S.favourites = A.favourites();
    S.openPaths = A.openPaths();
  } catch {
    S.favourites = new Set();
    S.openPaths = [];
  }
}

// ── what the middle column shows ─────────────────────────────────────────────

function computeVisible() {
  let list = S.entries;
  const sel = S.sel;

  if (sel.kind === "fav") {
    list = list.filter((e) => S.favourites.has(e.rel));
  } else if (sel.kind === "recent") {
    list = [...list].sort((a, b) => (b.modified || 0) - (a.modified || 0)).slice(0, 20);
  } else if (sel.kind === "folder") {
    // A folder shows what is IN it, including its sub-folders: picking a parent
    // and seeing nothing because the work sits one level down is a papercut.
    list = list.filter((e) => sel.value === ""
      ? !e.folder
      : e.folder === sel.value || e.folder.startsWith(sel.value + "/"));
  } else if (sel.kind === "collection") {
    const c = S.collections.find((x) => x.id === sel.value);
    const set = new Set(c?.items || []);
    list = list.filter((e) => set.has(e.rel));
  } else if (sel.kind === "tidy") {
    list = list.filter((e) => S.tidyRels.has(e.rel));
  }

  list = searchEntries(list, S.query);

  // A search is already ranked by how well it matches; re-sorting it by date
  // would throw that away.
  if (!S.query && S.sel.kind !== "recent") {
    const by = {
      recent: (a, b) => (b.modified || 0) - (a.modified || 0),
      name: (a, b) => a.name.localeCompare(b.name),
      nodes: (a, b) => (b.node_count || 0) - (a.node_count || 0),
    }[S.sort];
    if (by) list = [...list].sort(by);
  }
  S.visible = list;
}

// ── render ───────────────────────────────────────────────────────────────────

function render() {
  if (!S.win?.isOpen()) return;
  S.accent = globalAccent() || BRAND;
  refreshLive();
  computeVisible();

  // Wrapped so an open rename box can tell "the panel is redrawing" from "the
  // user clicked away" - blur alone cannot, see markRendering in window.mjs.
  markRendering(() => {
    renderFolders(S.win.side, S, {
      onPick: onPickFolder,
      onDropOn: onDropOnFolder,
      onRenameFolder: startFolderRename,
      onFolderMenu: showFolderMenu,
      onReorderFolder: reorderFolderByDrop,
      onToggleFolder: setFolderExpanded,
    });
    // "Needs tidying" gets its own screen rather than the card grid: three
    // different problems all wearing the same card told you which workflows
    // were affected but never which problem each had, or what to do about it.
    if (S.sel.kind === "tidy") renderTidy(S.win.main, S, HANDLERS);
    else renderGrid(S.win.main, S, HANDLERS);
    if (S.win.isDetailVisible()) renderDetail(S.win.detail, S, HANDLERS);
  });

  refreshSortButton();

  const total = S.entries.length;
  S.win.setCount(S.visible.length === total
    ? `${total} workflows`
    : `${S.visible.length} of ${total}`);

}

/** Search results are ranked by relevance and Recent is ordered by date, so in
 *  both the sort control genuinely does nothing and is disabled rather than
 *  left looking live. */
function sortDisabledReason() {
  if (S.query) return "Search results are ordered by how well they match, so sorting is off.";
  if (S.sel.kind === "recent") return "Recent is already ordered by when you last changed a workflow.";
  return "";
}

function refreshSortButton() {
  const b = S.sortBtn;
  if (!b) return;
  const why = sortDisabledReason();
  b.disabled = !!why;
  b.title = why || "Change the order";
}

// ── small dialogs, in the panel's own style ──────────────────────────────────

// The dialog that is up right now, so closing the panel can dismiss it. Without
// this a confirmation outlived its panel: close the panel mid-"Delete this?" and
// the same dialog was sitting there on the next open, still wired to the entry
// from before - and pressing OK deleted a file the user had already backed out
// of deleting.
let openAsk = null;

export function closeAsk() {
  const cancel = openAsk;
  openAsk = null;
  if (cancel) { try { cancel(); } catch { /* already gone */ } }
}

// The panel's own shortcut (Alt+W, the keybinding registered at the bottom of
// this file). A dialog stops every key from reaching the page, so it swallowed
// this one too and the shortcut did nothing while a question was up. Close the
// panel here instead, the same as its title-bar close button: onClose answers
// the dialog "no" (closeAsk). Matches on e.key, the way core reads a keybinding.
function closePanelOnToggleKey(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key || "").toLowerCase() !== "w") return false;
  e.preventDefault();
  S.win?.close?.();
  return true;
}

function ask({ title, message, value, okLabel = "OK", danger }) {
  // ONE dialog at a time. A second one used to stack on top of the first, and
  // closeAsk only knew the newest, so closing the panel left the older one
  // hidden inside it - back on the next open, still wired to its action.
  // The earlier one is answered "no", as Cancel would.
  closeAsk();
  return new Promise((resolve) => {
    const back = el("div", "pixwb-ask");
    back.tabIndex = -1;
    // Covers the toolbar and footer as well as the columns, everything below
    // the title bar. It used to cover only the columns, so the toolbar stayed
    // live behind the dialog and "Save open workflow here" opened a second
    // one. The title bar stays usable: moving the window is harmless, and its
    // close button already dismisses the dialog (closeAsk in onClose).
    back.style.cssText = `position:absolute;left:0;right:0;bottom:0;top:${S.win.title.offsetHeight}px;`
      + "background:rgba(0,0,0,.55);z-index:8;display:flex;align-items:center;justify-content:center;";
    const box = el("div");
    // Wider when the message LISTS things (a delete naming the files it will
    // remove). 330px wraps a folder path into three lines and the list becomes
    // unreadable exactly when reading it matters most.
    const listy = (message || "").includes("\n");
    box.style.cssText = "background:#1d1c1b;border:1px solid #3d3936;border-radius:8px;"
      + `padding:14px 16px;width:min(${listy ? 460 : 330}px,90%);`
      + "box-shadow:0 12px 30px rgba(0,0,0,.6);";
    box.append(el("div", "pixwb-detname", title));
    if (message) {
      const m = el("div", "pixwb-detpath", message);
      // The message is written with real line breaks when it names files, and
      // HTML would otherwise run them all together into one paragraph.
      m.style.whiteSpace = "pre-wrap";
      if (listy) { m.style.maxHeight = "38vh"; m.style.overflowY = "auto"; }
      box.append(m);
    }

    // EVERY key is stopped while this is up, not only the ones typed into a
    // field. The overlay blocks the mouse but keyboard events still bubbled to
    // the panel's own handler, so F2 opened a rename box behind the dialog and
    // Enter could fire "open workflow" at the very file being deleted. The two
    // delete dialogs have no input at all, so they were entirely unprotected.
    back.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (closePanelOnToggleKey(e)) return;
      if (e.key === "Escape") { e.preventDefault(); done(null); }
      else if (e.key === "Enter" && !input) {
        e.preventDefault();
        // Enter CONFIRMS only when the confirm button is visibly focused; from
        // anywhere else it is a safe cancel. Two wrong versions preceded this
        // one, each backwards in its own way: the first always confirmed (so
        // Tab-to-Cancel then Enter deleted files), and the fix to THAT
        // special-cased Cancel but still confirmed from every other focus -
        // including the BACKDROP, which really does take focus: the 40ms
        // fallback below puts it there when the buttons could not, and a click
        // on the title or the scrolling file list lands there too, because a
        // click on a non-focusable child walks up to the nearest focusable
        // ancestor. In those states nothing shows a focus ring, and a no-undo
        // dialog answering "yes" to an Enter aimed at nothing is the wrong
        // default in the only direction that cannot be taken back. The normal
        // flow is untouched: opening the dialog focuses OK, so a straight
        // Enter still confirms.
        done(document.activeElement === ok ? true : null);
      }
      else if (e.key === "Tab") {
        // TRAPPED, not just stopped. stopPropagation only keeps the event from
        // other listeners - it does nothing about Tab's native behaviour, which
        // is to walk on to the next focusable element in the document. The
        // backdrop is the LAST child of the body, so Tab landed on the footer's
        // buttons and Shift+Tab on the detail pane's own Rename and Delete, all
        // still live behind a dialog asking about a different workflow. The
        // context menu already traps Tab for exactly this reason.
        e.preventDefault();
        const stops = [input, ok, no].filter(Boolean);
        const at = stops.indexOf(document.activeElement);
        const next = (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
        stops[at < 0 ? 0 : next].focus();
      }
    });

    let input = null;
    if (value !== undefined) {
      input = el("input", "pixwb-note");
      input.style.minHeight = "0";
      input.value = value;
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (closePanelOnToggleKey(e)) return;
        if (e.key === "Enter") done(input.value.trim());
        if (e.key === "Escape") done(null);
      });
      box.append(input);
    }

    const acts = el("div", "pixwb-acts");
    const ok = el("button", "pixwb-tbtn " + (danger ? "pixwb-danger" : "pixwb-primary"), okLabel);
    const no = el("button", "pixwb-tbtn", "Cancel");
    ok.type = no.type = "button";
    ok.title = danger ? "This cannot be undone" : "Enter also does this";
    no.title = "Escape also does this";
    if (input) input.title = "Enter to confirm, Escape to cancel";
    acts.append(ok, no);
    box.append(acts);
    back.append(box);
    S.win.el.append(back);
    setTimeout(() => (input || ok).focus(), 20);
    // ...and if neither can take focus, the backdrop still can, so Escape works.
    setTimeout(() => { if (!back.contains(document.activeElement)) back.focus(); }, 40);

    let settled = false;
    function done(v) {
      if (settled) return;
      settled = true;
      if (openAsk === cancel) openAsk = null;
      back.remove();
      resolve(v);
      // Focus went with the dialog. Put it back in the panel, or the arrow keys
      // stop working after every confirm - the same document.body trap the
      // context menu hits.
      S.win?.focusSearch?.();
    }
    // Registered so closing the panel can dismiss this. Resolves null, exactly
    // as Cancel does, so whatever is awaiting it takes the "no" branch instead
    // of hanging forever on a promise nothing will ever settle.
    const cancel = () => done(null);
    openAsk = cancel;
    ok.addEventListener("click", () => done(input ? input.value.trim() : true));
    no.addEventListener("click", () => done(null));
    // LEFT button only: a right-click outside the box used to cancel it too.
    back.addEventListener("mousedown", (e) => { if (e.target === back && e.button === 0) done(null); });
  });
}

const confirmAsk = (title, message, okLabel = "Delete") =>
  ask({ title, message, okLabel, danger: true });

// ── actions ──────────────────────────────────────────────────────────────────

/** Move a workflow's note and chosen cover to its new path.
 *
 *  Renaming or moving used to leave both behind under the OLD key: the note
 *  silently vanished, and the cover became an orphan pointing at a picture
 *  nothing referenced. The new key is written FIRST and the old cleared second,
 *  in that order, because clearing a cover deletes its picture unless another
 *  key already points at it. */
async function carryMeta(oldRel, newRel) {
  // Nothing to carry, and carrying it would DESTROY it. The patch below writes
  // `{ [newRel]: value, [oldRel]: null }`, and when the two keys are the same
  // string that object literal has one key defined twice - the later null wins,
  // so the note is cleared and the cover's picture deleted. Reachable whenever
  // a "rename" resolves back to the original name.
  if (oldRel === newRel) return;
  const note = S.meta?.notes?.[oldRel];
  const cover = S.meta?.covers?.[oldRel];
  if (!note && !cover) return;
  const patch = {};
  if (note) patch.notes = { [newRel]: note, [oldRel]: null };
  if (cover) patch.covers = { [newRel]: cover, [oldRel]: null };
  try { await A.saveMeta(patch); } catch { /* the rename itself already worked */ }
}

/** Drop a path from the selection, or point it at where the file went.
 *  A path that no longer exists must not stay selected: the next bulk action
 *  would try to act on it, fail on the first item, and abandon the rest. */
function forgetRel(rel, replacement) {
  if (S.selected.delete(rel) && replacement) S.selected.add(replacement);
  if (S.kbdRel === rel) S.kbdRel = replacement || null;
}

/** One place, so every field cleans a name the same way.
 *
 *  Also strips leading and trailing dots, which the character class alone left
 *  through: a folder called "..." or ".." is legal to type, confusing on disk,
 *  and on Windows a name ending in a dot cannot be opened afterwards. */
const MAX_NAME = 120;

function cleanName(raw) {
  return String(raw || "")
    .replace(/[\\/:*?"<>|]/g, "")
    // Control characters. Pasting from a terminal or a PDF brings these along
    // invisibly, and \s only covers tab/newline/formfeed - the rest went
    // straight to disk in a filename nothing can then open.
    //
    // Written as \x ESCAPES, never as the literal bytes. The literal version is
    // identical on screen, invisible in a diff and invisible in review, and a
    // real control byte in a regex has already cost this project a full
    // debugging session once.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim()
    // Well under the ~255 byte limit every filesystem has, with room for the
    // folder path and the .json. Truncating HERE means the user sees the name
    // they will actually get, rather than a write failing deep in the server.
    .slice(0, MAX_NAME)
    .trim();
}

// CON, NUL, COM1 and the rest name a DEVICE on Windows rather than a file, at
// any extension, so "NUL" and "NUL.json" both fail. The server refuses them too
// (it is the authority), but the check is here as well so the answer is instant
// and worded for the person typing rather than relayed from a failed write.
const WIN_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** Why this name will not do, in words, or null when it is fine. Separate from
 *  cleanName so each reason gets its own sentence: "cannot be used" for a name
 *  that sanitised down to nothing is no help when the real problem is that the
 *  user typed CON. */
function nameProblem(clean) {
  if (!clean) return "That name cannot be used.";
  if (WIN_RESERVED.has(clean.split(".")[0].trim().toUpperCase())) {
    return `"${clean}" is a name Windows keeps for itself. Pick another one.`;
  }
  return null;
}

const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const joinRel = (folder, file) => (folder ? `${folder}/${file}` : file);

async function guard(fn, okMessage) {
  let failure = null;
  try {
    await fn();
  } catch (err) {
    failure = err;
  }
  // Reload EITHER WAY. A batch that fails half way through has already changed
  // the disk, and leaving the old list on screen invites the user to run it
  // again believing nothing happened.
  try {
    await loadData();
    render();
  } catch { /* the toast below is the more useful message */ }
  // Only speak when there is something to say. Toasting unconditionally showed
  // an empty box after every favourite toggle and every folder reorder, and on
  // Open it fired AFTER the handler's own "Opened <name>" and replaced it with
  // nothing - so the commonest action in the panel confirmed itself blankly.
  if (failure) S.win?.toast(failure.message || String(failure));
  else if (okMessage) S.win?.toast(okMessage);
}

const HANDLERS = {
  onSelect(entry, e) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      S.selected.has(entry.rel) ? S.selected.delete(entry.rel) : S.selected.add(entry.rel);
    } else {
      S.selected = new Set([entry.rel]);
    }
    S.kbdRel = entry.rel;
    render();
  },

  onOpen(entry) {
    guard(async () => {
      await A.openWorkflow(entry.rel);
      S.win.toast(`Opened ${entry.name}`);
    });
  },

  onStar(entry) {
    guard(() => A.toggleFavourite(entry.rel));
  },

  async onCopyText(text, okMessage) {
    const ok = await copyText(text);
    S.win.toast(ok ? okMessage : "Could not reach the clipboard.");
  },

  onRename(entry) {
    // beginRename edits the card in place, so it needs that card on screen. It
    // is not, if the workflow is selected but filtered out by a search, or if
    // the rename came from the detail pane in list view. Fall back to a dialog
    // rather than being a click that does nothing.
    const onScreen = S.win.main.querySelector(`[data-rel="${CSS.escape(entry.rel)}"]`);
    if (!onScreen) {
      ask({ title: "Rename", message: entry.rel, value: entry.name, okLabel: "Rename" })
        .then((v) => { if (v) commitRename(entry, v); });
      return;
    }
    // The same shape as commitRename, and the no-op check sits OUTSIDE guard()
    // for the same reason it does there: inside, a bare return is
    // indistinguishable from a successful rename, so retyping the same name
    // (or adding a character cleanName strips) toasted "Renamed" and paid for
    // a full reload when nothing had happened at all.
    beginRename(S.win.main, entry.rel, entry.name, (newName) => {
      const clean = cleanName(newName);
      const bad = nameProblem(clean);
      if (bad) { S.win.toast(bad); return; }
      const target = joinRel(dirOf(entry.rel), clean + ".json");
      if (target === entry.rel) return;            // see commitRename
      guard(async () => {
        await A.renameOrMove(entry.rel, target);
        await carryMeta(entry.rel, target);
        // Follow the file. Leaving the old path selected leaves a ghost that a
        // later bulk action tries to act on and fails.
        forgetRel(entry.rel, target);
      }, "Renamed");
    });
  },

  onDuplicate(entry) {
    guard(async () => {
      const target = joinRel(dirOf(entry.rel), entry.name + " copy.json");
      await A.duplicate(entry.rel, target);
      // The copy gets the note and the cover too. It is a copy - it should look
      // and read like the thing it was copied from. Deliberately NOT carryMeta:
      // that MOVES them, clearing the original's, which is exactly wrong here.
      // Two keys pointing at one cover file is fine; the server only deletes a
      // picture once nothing references it.
      const note = S.meta?.notes?.[entry.rel];
      const cover = S.meta?.covers?.[entry.rel];
      const patch = {};
      if (note) patch.notes = { [target]: note };
      if (cover) patch.covers = { [target]: cover };
      if (Object.keys(patch).length) {
        try { await A.saveMeta(patch); } catch { /* the copy itself worked */ }
      }
    }, "Copied");
  },

  async onDelete(entry) {
    // Deleting the workflow you are MID-EDIT on costs the unsaved work as well
    // as the file, and the generic wording did not say so.
    const dirty = A.isModified(entry.rel);
    const yes = await confirmAsk(
      `Delete "${entry.name}"?`,
      dirty
        ? "This one is OPEN with unsaved changes. Deleting it loses those changes too, and there is no undo."
        : "There is no undo yet, so this really does remove the file.");
    if (!yes) return;
    guard(async () => {
      await A.remove(entry.rel);
      forgetRel(entry.rel);
    }, "Deleted");
  },

  async onDeleteMany(rels, wording) {
    const dirty = rels.filter((r) => A.isModified(r));
    const warn = dirty.length
      ? `${dirty.length} of them are open with unsaved changes, which go too. There is no undo.`
      : "There is no undo yet, so this really does remove the files.";
    // A caller can NAME the files. The tidy screen's "Keep this one" deletes
    // workflows the user never picked one by one, so a bare count is not enough
    // to agree to.
    const yes = await confirmAsk(
      wording?.title || `Delete ${rels.length} workflows?`,
      wording?.message ? `${wording.message}\n\n${warn}` : warn);
    if (!yes) return;
    // Keep going past a failure and report at the end. Stopping on the first
    // one left the rest silently undone while the earlier deletes had already
    // happened, which reads as "nothing worked".
    guard(async () => {
      const failed = [];
      for (const rel of rels) {
        try { await A.remove(rel); forgetRel(rel); }
        catch { failed.push(rel.split("/").pop()); }
      }
      if (failed.length) throw new Error(`Could not delete ${failed.length}: ${failed.join(", ")}`);
    }, `Deleted ${rels.length}`);
  },

  onReveal(entry) {
    // The folder really does open, but on Windows it lands BEHIND the browser
    // and only blinks in the taskbar - which reads as "reveal does nothing".
    // Bringing it to the front is not an option: the PowerShell needed for that
    // is flagged as malicious by antivirus (see the Save Image reveal route).
    guard(() => A.reveal(entry.rel), "Opened the folder - look in your taskbar");
  },

  onNote(rel, text) {
    // The in-memory copy is updated FIRST, before the round trip. Anything that
    // snapshots S.meta - the folder rename carrying a whole subtree of notes,
    // carryMeta on a single file - must see the text as the user last typed it,
    // not as the server last confirmed it; updating only on success left a gap
    // in which a rename carried the PREVIOUS text and stranded the newest under
    // a dead key. The save can still fail, and the toast still says so - but an
    // optimistic memory with an honest error beats a stale memory with none.
    S.meta.notes = S.meta.notes || {};
    if (text) S.meta.notes[rel] = text; else delete S.meta.notes[rel];
    const e = S.byRel.get(rel);
    if (e) e._note = text || "";
    A.saveMeta({ notes: { [rel]: text || null } })
      .then((res) => {
        // The RESULT, not just "it did not throw". The route answers 200 with
        // {ok:false} when the sidecar could not be written, so a note the user
        // watched themselves type could quietly fail to reach the disk and only
        // be noticed as missing much later.
        if (!res || res.ok === false) throw new Error("not saved");
      })
      .catch(() => S.win.toast("Could not save that note."));
  },

  onSetCover(entry) {
    const picker = el("input");
    picker.type = "file";
    // The formats the server will actually accept, not "image/*". Offering
    // everything and then refusing SVG at the last step is a worse experience
    // than not offering it: the file dialog says yes and the panel says no.
    picker.accept = "image/jpeg,image/png,image/gif,image/bmp,image/webp,image/avif,image/heic";
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      if (!file) return;
      // Shrunk before it is sent: a card is 132px wide, and the full photo would
      // be stored and re-served at whatever size the camera happened to use.
      const dataUrl = await shrinkToDataURL(file, 360).catch(() => null);
      if (!dataUrl) { S.win.toast("That file is not a picture."); return; }
      guard(async () => {
        const res = await A.setCover(entry.rel, dataUrl);
        if (!res?.ok) throw new Error(res?.message || "Could not save that cover.");
      }, "Cover set");
    });
    picker.click();
  },

  onClearCover(entry) {
    guard(() => A.clearCover(entry.rel), "Cover removed");
  },

  onContext(entry, e) {
    // Right-clicking OUTSIDE the current selection acts on that card alone;
    // right-clicking INSIDE it keeps the selection, so a menu opened on one of
    // several chosen workflows still acts on all of them.
    if (!S.selected.has(entry.rel)) S.selected = new Set([entry.rel]);
    S.kbdRel = entry.rel;
    render();
    showCardMenu(entry, e.clientX, e.clientY);
  },

  onDragStart(entry, e) {
    // Dragging an unselected card drags THAT card, not the old selection.
    if (!S.selected.has(entry.rel)) S.selected = new Set([entry.rel]);
    e.dataTransfer.effectAllowed = "move";
    // The custom type is what the drop guard recognises. A card drag used to
    // carry text/plain ALONE, so there was nothing to tell it apart from
    // somebody dragging ordinary text - which meant the guard could not cancel
    // it without also breaking real text drops into the note box.
    e.dataTransfer.setData(CARD_MIME, entry.rel);
    // Kept deliberately; drag.mjs explains why it is guarded rather than removed.
    e.dataTransfer.setData("text/plain", entry.rel);
  },
};

/** Covers are stored in a small JSON sidecar, so a 12 MP png would bloat it and
 *  slow every open. Scaled down first, which is all a 132px card needs. */
function shrinkToDataURL(file, maxW) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
      c.height = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a picture.")); };
    img.src = url;
  });
}

// ── the card menu ────────────────────────────────────────────────────────────

/** Everything the detail pane offers, on the card itself - because the detail
 *  pane is hidden on a narrow window and absent in list view, and right-click
 *  is where people look for rename anyway. */
function showCardMenu(entry, x, y) {
  const many = [...S.selected];
  const multi = many.length > 1 && S.selected.has(entry.rel);
  const fav = S.favourites.has(entry.rel);

  if (multi) {
    openContextMenu(x, y, [
      { label: `${many.length} workflows selected`, disabled: true },
      null,
      { label: "Move to folder…", fn: () => promptMoveTo(many) },
      null,
      { label: `Delete ${many.length}…`, danger: true, fn: () => HANDLERS.onDeleteMany(many) },
    ]);
    return;
  }

  openContextMenu(x, y, [
    { label: "Open", fn: () => HANDLERS.onOpen(entry) },
    { label: fav ? "Remove from favourites" : "Add to favourites", fn: () => HANDLERS.onStar(entry) },
    null,
    { label: "Rename", fn: () => HANDLERS.onRename(entry) },
    { label: "Duplicate", fn: () => HANDLERS.onDuplicate(entry) },
    { label: "Move to folder…", fn: () => promptMoveTo([entry.rel]) },
    { label: hasHandCover(entry, S.meta) ? "Replace cover…" : "Set cover…",
      fn: () => HANDLERS.onSetCover(entry) },
    { label: "Remove cover", fn: () => HANDLERS.onClearCover(entry),
      disabled: !hasHandCover(entry, S.meta) },
    null,
    { label: "Reveal in explorer", fn: () => guard(() => A.reveal(entry.rel), "Opened the folder - look in your taskbar") },
    null,
    { label: "Delete…", danger: true, fn: () => HANDLERS.onDelete(entry) },
  ]);
}

/** Move without dragging. Dragging is faster once you know it exists, but it is
 *  not discoverable and it is awkward when the target folder is scrolled away. */
function promptMoveTo(rels) {
  const folders = ["", ...S.folders];
  openContextMenuFolderList(folders, (target) => moveWorkflowsTo(rels, target));
}

function openContextMenuFolderList(folders, pick) {
  const r = S.win.el.getBoundingClientRect();
  openContextMenu(r.left + 60, r.top + 90, [
    { label: "Move to which folder?", disabled: true },
    null,
    ...folders.map((f) => ({
      label: f === "" ? "(no folder)" : f,
      fn: () => pick(f),
    })),
  ]);
}

function moveWorkflowsTo(rels, folderPath) {
  // Per item, like the bulk delete. Stopping on the first failure moved some
  // and abandoned the rest, then reported one plain error - so the user was
  // told nothing worked while several had in fact already moved.
  guard(async () => {
    let moved = 0;
    const failed = [];
    for (const rel of rels) {
      const file = rel.slice(rel.lastIndexOf("/") + 1);
      const target = joinRel(folderPath, file);
      if (target === rel) continue;
      try {
        await A.renameOrMove(rel, target);
        await carryMeta(rel, target);
        forgetRel(rel, target);
        moved++;
      } catch (err) {
        failed.push(`${file} (${err.message || "failed"})`);
      }
    }
    // The selection is NOT cleared here. forgetRel above has already pointed
    // each moved path at where the file went, and wiping it threw that away -
    // so the items you just moved came back deselected, and so did the ones
    // that failed and are still sitting at their original, perfectly valid
    // paths.
    if (failed.length) {
      throw new Error(moved
        ? `Moved ${moved}, but could not move ${failed.length}: ${failed.join("; ")}`
        : `Could not move: ${failed.join("; ")}`);
    }
    if (!moved) throw new Error("Already in that folder.");
  }, `Moved to ${folderPath || "the workflows folder"}`);
}

// ── folder actions ───────────────────────────────────────────────────────────

const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** The rename itself, shared by the in-place edit and the dialog fallback. */
function commitRename(entry, newName) {
  const clean = cleanName(newName);
  const bad = nameProblem(clean);
  if (bad) { S.win.toast(bad); return; }
  const target = joinRel(dirOf(entry.rel), clean + ".json");
  // Nothing actually changed. The rename box only compares the RAW text, so
  // typing a character cleanName strips (a "?" say) counts as an edit there and
  // arrives here identical - and a same-path rename is not harmless: it asks
  // the server to move a file onto itself and makes carryMeta collapse the
  // note and the cover into a single null.
  if (target === entry.rel) return;
  guard(async () => {
    await A.renameOrMove(entry.rel, target);
    await carryMeta(entry.rel, target);
    forgetRel(entry.rel, target);
  }, "Renamed");
}

function startFolderRename(path, row) {
  beginFolderRename(row, path, (newName) => {
    // cleanName, NOT a second inline regex. The copy that used to live here
    // skipped the leading and trailing dot strip, so a folder could be renamed
    // to "..." or to a name ending in a dot - which Windows then cannot open.
    const clean = cleanName(newName);
    const bad = nameProblem(clean);
    if (bad) { S.win.toast(bad); return; }
    const target = parentOf(path) ? `${parentOf(path)}/${clean}` : clean;
    guard(async () => {
      // DESCENDANTS too. Matching only the exact path meant renaming a parent
      // left every child still recorded under the old prefix: their order and
      // colours reverted, and if a child was the folder being viewed the grid
      // silently went empty with nothing selected in the sidebar.
      const reparent = (p) => (p === path || p.startsWith(path + "/")
        ? target + p.slice(path.length) : p);

      // THREE steps, in an order chosen so that NO failure can cost a picture.
      //
      // The old shape (rename, then move every record in one patch) had a
      // losing branch that no message could fix: if the rename succeeded and
      // the record write failed, the covers still named the OLD paths - and
      // guard() reloads either way, so the very next read pruned each of those
      // covers as "workflow not where it says" and DELETED the pictures, before
      // the error toast was even on screen. The advice it gave ("rename it
      // back") was already false by the time the user could read it.
      //
      // So: 1) COPY the notes and covers to the new keys, old keys untouched.
      //        Fails -> abort with nothing changed at all.
      //     2) Rename the folder on disk.
      //        Fails -> best-effort removal of the copies; even unremoved they
      //        are only records pointing at paths that never appeared, and the
      //        heal prune drops such a record WITHOUT deleting its picture when
      //        another key still references it - which the old key does.
      //     3) Clear the old keys and carry the order and colours.
      //        Fails -> the old records are stale, but every picture is
      //        referenced by its NEW key, so the prune only drops the records.
      //        The user loses the folder's colour and position, and is told
      //        exactly that - not their covers.
      const newNotes = {};
      const newCovers = {};
      const oldNotes = {};
      const oldCovers = {};
      for (const [k, v] of Object.entries(S.meta.notes || {})) {
        const moved = reparent(k);
        if (moved !== k) { newNotes[moved] = v; oldNotes[k] = null; }
      }
      for (const [k, v] of Object.entries(S.meta.covers || {})) {
        const moved = reparent(k);
        if (moved !== k) { newCovers[moved] = v; oldCovers[k] = null; }
      }

      const preAdd = {};
      if (Object.keys(newNotes).length) preAdd.notes = newNotes;
      if (Object.keys(newCovers).length) preAdd.covers = newCovers;
      if (Object.keys(preAdd).length) {
        const resA = await A.saveMeta(preAdd);
        if (!resA || resA.ok === false) {
          throw new Error("Could not save the folder's records, so nothing was renamed.");
        }
      }

      // Take the copies back out when the rename does not happen. Best-effort:
      // if the undo itself fails, the heal prune drops stray COVER records
      // harmlessly on the next read; a stray NOTE record just lingers invisibly
      // (notes are deliberately never pruned - see the pattern file).
      const undoCopies = async () => {
        if (!Object.keys(preAdd).length) return;
        const undo = {};
        if (preAdd.notes) undo.notes = Object.fromEntries(Object.keys(newNotes).map((k) => [k, null]));
        if (preAdd.covers) undo.covers = Object.fromEntries(Object.keys(newCovers).map((k) => [k, null]));
        try { await A.saveMeta(undo); } catch { /* the prune heals the covers */ }
      };

      // In a try, because folderAction THROWS on a network drop, a 500 or a
      // non-JSON body - and a throw jumped straight past the `!res.ok` branch
      // that held the undo, leaving the copies in place for a rename that never
      // happened. Both failure shapes now clean up the same way.
      let res;
      try {
        res = await A.folderAction({ action: "rename", path, newPath: target });
      } catch (err) {
        await undoCopies();
        throw err;
      }
      if (!res.ok) {
        await undoCopies();
        throw new Error(res.message || "Could not rename that folder.");
      }

      // The VIEW follows the DISK, which has now definitely changed - so this
      // happens before the final write, whatever that write does. Done after it,
      // a failure left the sidebar pointing at a folder name that no longer
      // exists and the grid showed nothing at all.
      if (S.sel.kind === "folder" && typeof S.sel.value === "string") {
        const moved = reparent(S.sel.value);
        if (moved !== S.sel.value) S.sel = { kind: "folder", value: moved };
      }
      // Every workflow inside moved too, so a selected one has a new path. Left
      // alone it became a stale rel that no card could ever match again.
      S.selected = new Set([...S.selected].map(reparent));
      if (S.kbdRel) S.kbdRel = reparent(S.kbdRel);

      // Carry the folder's place in the order and its colour across, or a
      // rename would quietly send it back to alphabetical and change its dot.
      const patch = {};
      const order = (S.meta.folderOrder || []).map(reparent);
      if (order.length) patch.folderOrder = order;
      // Open/closed is keyed by folder path too, so without this the renamed
      // folder and everything under it snapped shut - and the branch the user
      // was looking at closed underneath them mid-rename.
      const expanded = (S.meta.folderExpanded || []).map(reparent);
      if (expanded.length) patch.folderExpanded = expanded;
      const colours = {};
      for (const [k, v] of Object.entries(S.meta.folderColors || {})) {
        const moved = reparent(k);
        if (moved !== k) { colours[k] = null; colours[moved] = v; }
      }
      if (Object.keys(colours).length) patch.folderColors = colours;
      if (Object.keys(oldNotes).length) patch.notes = oldNotes;
      if (Object.keys(oldCovers).length) patch.covers = oldCovers;

      if (Object.keys(patch).length) {
        // Checked, not assumed: the route answers 200 with ok:false when the
        // sidecar could not be written. commitSiblingOrder below has always
        // checked its result; this call site once did not, and the cost was
        // deleted cover pictures.
        const res2 = await A.saveMeta(patch);
        if (!res2 || res2.ok === false) {
          throw new Error("The folder was renamed and its notes and covers are safe, "
            + "but its colour and place in the list could not be saved.");
        }
      }
    }, "Folder renamed");
  });
}

/** Write a new order for one group of siblings.
 *
 *  Every OTHER folder's recorded position is kept as it was and only this group
 *  is rewritten, so re-ordering one branch cannot shuffle an unrelated one. */
function commitSiblingOrder(sibs, reordered) {
  const others = (S.meta.folderOrder || []).filter((p) => !sibs.includes(p));
  const folderOrder = [...others, ...reordered];
  guard(async () => {
    const res = await A.saveMeta({ folderOrder });
    // The sidecar route ignores keys it does not know, and that silently
    // swallowed the order once already. If it did not come back, say so rather
    // than leaving the folder sitting where it was with no explanation.
    if (!res?.meta?.folderOrder || !res.meta.folderOrder.length) {
      throw new Error("Folder order could not be saved. Restart ComfyUI - this part needs the newer server files.");
    }
    S.meta.folderOrder = folderOrder;
  });
}

/* Open/closed writes are chained rather than fired in parallel. Each one sends
 * the WHOLE list (list sections replace, they do not merge), so two in flight
 * at once can land out of order and leave the folder in the state of the
 * earlier click. Chaining costs nothing at this rate and removes the race. */
let expandWrites = Promise.resolve();

/**
 * Open or close one folder and remember it.
 *
 * Deliberately NOT routed through guard(): guard refetches the whole index and
 * toasts on success, and a twisty is navigation, not an edit. The column
 * repaints immediately from local state and the write follows behind it, so
 * the arrow feels instant even on a slow disk.
 */
function setFolderExpanded(path, open) {
  const current = new Set(S.meta.folderExpanded || []);
  if (open === current.has(path)) return expandWrites;

  const before = [...current];
  if (open) current.add(path); else current.delete(path);
  const next = [...current];
  S.meta.folderExpanded = next;

  // Closing the branch you are LOOKING at would otherwise fight itself: the
  // selected folder's ancestors are force-opened at render time so the
  // selection is always reachable, so the row would snap straight back open.
  // Closing it means "show me this folder instead", so the selection comes up
  // to the folder that was closed.
  if (!open && S.sel.kind === "folder" && typeof S.sel.value === "string"
      && S.sel.value.startsWith(path + "/")) {
    S.sel = { kind: "folder", value: path };
    S.selected = new Set();
    S.kbdRel = null;
  }
  render();

  expandWrites = expandWrites.then(async () => {
    try {
      const res = await A.saveMeta({ folderExpanded: next });
      // The RESULT, not merely the absence of a throw (#23). The route answers
      // 200 with {ok:false} when the sidecar could not be WRITTEN, and it fills
      // in the patched section before attempting the write - so it echoes the
      // list back either way and a shape test alone passes on a failed save.
      // That is the same hole that once cost deleted cover pictures on the
      // folder-rename path.
      if (!res || res.ok === false) {
        throw new Error("Your folder choice could not be saved. Something else may have the "
          + "workflows folder open, or it is read-only.");
      }
      // Only THEN the shape. The sidecar ignores sections it does not know
      // about, which is exactly how folderOrder was silently swallowed when IT
      // was new. Test the SHAPE, not the length: an up-to-date server always
      // answers with an array, and an empty one is a perfectly ordinary answer
      // (everything closed), while an older server leaves the key out.
      // Kept as a SEPARATE message from the one above - this one means an
      // out-of-date server, and telling someone to restart when their disk is
      // read-only sends them through a reboot that cannot help (#27).
      if (!Array.isArray(res?.meta?.folderExpanded)) {
        throw new Error("Restart ComfyUI - remembering open folders needs the newer server files.");
      }
    } catch (err) {
      S.meta.folderExpanded = before;
      render();
      S.win?.toast(err?.message || "Could not remember that folder.");
    }
  });
  return expandWrites;
}

/** Move a folder one place among its OWN siblings. */
function moveFolder(path, delta) {
  const sibs = siblingsOf(path, S.folders, S.meta.folderOrder);
  const at = sibs.indexOf(path);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= sibs.length) return;
  const reordered = sibs.slice();
  reordered.splice(to, 0, reordered.splice(at, 1)[0]);
  commitSiblingOrder(sibs, reordered);
}

/** Drop one folder above or below another. Re-ordering only, never a move on
 *  disk: dragging a folder INTO another would rewrite every path underneath it,
 *  which is a different and much more destructive operation than it looks. */
function reorderFolderByDrop(moved, target, above) {
  const parent = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  if (parent(moved) !== parent(target)) {
    S.win.toast("Folders can be re-ordered within the same level, not moved into each other.");
    return;
  }
  const sibs = siblingsOf(moved, S.folders, S.meta.folderOrder);
  const from = sibs.indexOf(moved);
  if (from < 0) return;
  const without = sibs.filter((p) => p !== moved);
  const at = without.indexOf(target);
  if (at < 0) return;
  const insert = above ? at : at + 1;
  without.splice(insert, 0, moved);
  if (without.join("|") === sibs.join("|")) return;   // nothing actually moved
  commitSiblingOrder(sibs, without);
}

function showFolderMenu(path, ev) {
  const sibs = siblingsOf(path, S.folders, S.meta.folderOrder);
  const at = sibs.indexOf(path);
  const rowEl = ev.currentTarget;
  openContextMenu(ev.clientX, ev.clientY, [
    { label: "New folder inside", fn: () => createFolder(path) },
    { label: "Rename", fn: () => startFolderRename(path, rowEl) },
    { label: "Move up", fn: () => moveFolder(path, -1), disabled: at <= 0 },
    { label: "Move down", fn: () => moveFolder(path, 1), disabled: at < 0 || at >= sibs.length - 1 },
    null,
    { label: "Reveal in explorer", fn: () => guard(() => A.reveal(path), "Opened the folder - look in your taskbar") },
    null,
    {
      // Marked as the destructive one. The menu has supported `danger` all
      // along and this entry never set it, so the only irreversible thing in
      // the list looked exactly like "Move up".
      label: "Delete folder",
      danger: true,
      fn: () => guard(async () => {
        const res = await A.folderAction({ action: "delete", path });
        // The server refuses a folder that still holds anything - that refusal
        // IS the safety net, since there is no undo.
        if (!res.ok) throw new Error(res.message || "Could not delete that folder.");
        if (S.sel.kind === "folder" && S.sel.value === path) S.sel = { kind: "all" };
        // Drop its open/closed record too, or a folder later recreated with the
        // same name would come back open for no reason anyone could explain.
        const kept = (S.meta.folderExpanded || [])
          .filter((p) => p !== path && !p.startsWith(path + "/"));
        if (kept.length !== (S.meta.folderExpanded || []).length) {
          S.meta.folderExpanded = kept;
          try { await A.saveMeta({ folderExpanded: kept }); } catch { /* cosmetic only */ }
        }
      }, "Folder deleted"),
    },
  ]);
}

/**
 * Make a folder, optionally inside another one.
 *
 * `parent` is "" for a top-level folder. The server's create already calls
 * os.makedirs and validates every segment, so a nested path needs nothing on
 * that side - only a way to ask for one.
 */
function createFolder(parent) {
  ask({
    title: parent ? "New folder inside" : "New folder",
    message: parent ? `It is created inside ${parent}.` : "It is created inside the workflows folder.",
    value: "",
    okLabel: "Create",
  }).then((nameRaw) => {
    if (!nameRaw) return;
    const clean = cleanName(nameRaw);
    const bad = nameProblem(clean);
    if (bad) { S.win.toast(bad); return; }
    const path = parent ? `${parent}/${clean}` : clean;
    guard(async () => {
      const res = await A.folderAction({ action: "create", path });
      if (!res.ok) throw new Error(res.message || "Could not create that folder.");
      // Open the parent, or the folder that was just asked for lands inside a
      // closed branch and reads as though nothing happened. Written through the
      // same saver as the twisty so the choice sticks.
      if (parent) await setFolderExpanded(parent, true);
    }, "Folder created");
  });
}

function onPickFolder(pick) {
  if (pick.kind === "newfolder") {
    createFolder("");
    return;
  }
  S.sel = pick;
  S.selected = new Set();
  S.kbdRel = null;
  render();
}

/** Cards dropped on a folder row. Same work as the menu's "Move to folder",
 *  so it goes through the same function rather than a second copy. */
function onDropOnFolder(folderPath) {
  const rels = [...S.selected];
  if (rels.length) moveWorkflowsTo(rels, folderPath);
}

// ── toolbar row inside the window ────────────────────────────────────────────

function buildBar(bar) {
  bar.textContent = "";

  const search = el("div", "pixwb-search");
  const input = el("input");
  input.type = "text";
  input.placeholder = "Search names, models, prompts, notes...";
  input.title = "Searches inside the files too: a model or LoRA filename, a phrase from a prompt, or your own note";
  // buildBar CLEARS the toolbar and builds this input from scratch, and every
  // control in the bar that changes state calls buildBar to redraw itself -
  // Grid/List, Sort, and the size buttons. The value flow was one-way (the
  // listener writes S.query, nothing wrote it back), so each of those wiped the
  // box on screen while S.query kept filtering: the panel showed a subset of
  // the workflows with an empty search box, which reads as "this is everything".
  // Assigning .value does NOT fire the `input` event, so this cannot loop back
  // into render().
  input.value = S.query || "";
  // Caret at the END, not at 0. The window's mousedown handler hands focus back
  // here after any click that is not on a field (window.mjs), so the box is
  // focused again a tick after this runs - and a fresh input focused with text
  // already in it puts the caret at the start, so the next character typed
  // would land in front of the query instead of continuing it.
  try { input.selectionStart = input.selectionEnd = input.value.length; } catch { /* not selectable */ }
  input.addEventListener("input", () => {
    S.query = input.value;
    S.kbdRel = null;
    render();
  });
  search.append(input);
  bar.append(search);

  const seg = el("div", "pixwb-seg");
  for (const [id, label, tip] of [
    ["grid", "Grid", "Picture cards, for browsing by eye"],
    ["list", "List", "A dense list, easier once you have hundreds"],
  ]) {
    const b = el("button", S.view === id ? "on" : "", label);
    b.type = "button";
    b.title = tip;
    b.addEventListener("click", () => {
      S.view = id;
      try { app.ui.settings.setSettingValueAsync(VIEW_SETTING, id); } catch { /* view is cosmetic */ }
      buildBar(bar);
      render();
    });
    seg.append(b);
  }
  bar.append(seg);

  // Text and picture size. Same segmented idiom as Grid|List, so it reads as
  // part of the panel; each A is drawn at the size it selects.
  const sizes = el("div", "pixwb-seg pixwb-sizeseg");
  for (const id of ["s", "m", "l"]) {
    const b = el("button", S.density === id ? "on" : "", "A");
    b.type = "button";
    b.dataset.k = id;
    b.title = "Size of everything in this panel: " + DENSITY[id].label;
    b.addEventListener("click", () => {
      S.density = id;
      applyDensity(id);
      try { app.ui.settings.setSettingValueAsync(DENSITY_SETTING, id); } catch { /* cosmetic */ }
      buildBar(bar);
      render();
    });
    sizes.append(b);
  }
  bar.append(sizes);

  const sort = el("button", "pixwb-tbtn", "Sort: " + SORT_LABELS[S.sort]);
  sort.type = "button";
  // Two views impose their own order, so the control would do nothing. Say so
  // by disabling it, rather than letting it look live and silently ignore the
  // click - that reads as a broken button.
  const why = sortDisabledReason();
  if (why) { sort.disabled = true; sort.title = why; } else { sort.title = "Change the order"; }
  sort.addEventListener("click", () => {
    if (sort.disabled) return;
    const order = Object.keys(SORT_LABELS);
    S.sort = order[(order.indexOf(S.sort) + 1) % order.length];
    try { app.ui.settings.setSettingValueAsync(SORT_SETTING, S.sort); } catch { /* cosmetic */ }
    buildBar(bar);
    render();
  });
  bar.append(sort);
  // Kept so render() can refresh just this button. Rebuilding the whole bar on
  // every keystroke would throw away the search box's focus and caret.
  S.sortBtn = sort;

  // Opens whichever folder is selected, or the workflows folder itself.
  const openFolder = el("button", "pixwb-tbtn", "Open folder");
  openFolder.type = "button";
  openFolder.title = "Open this folder on your computer. It opens behind the browser, so look in your taskbar.";
  openFolder.addEventListener("click", () => {
    const path = S.sel.kind === "folder" ? S.sel.value : "";
    guard(() => A.reveal(path), "Opened the folder - look in your taskbar");
  });
  bar.append(openFolder);

  const saveHere = el("button", "pixwb-tbtn pixwb-primary", "Save open workflow here");
  saveHere.type = "button";
  saveHere.title = "Save whatever is on the canvas into the selected folder";
  saveHere.addEventListener("click", onSaveHere);
  bar.append(saveHere);
}

function onSaveHere() {
  const folder = S.sel.kind === "folder" ? S.sel.value : "";
  const current = A.activePath();
  const suggested = current ? current.slice(current.lastIndexOf("/") + 1).replace(/\.json$/i, "") : "My workflow";
  ask({
    title: "Save the open workflow",
    message: folder ? `Into ${folder}` : "Into the workflows folder",
    value: suggested,
    okLabel: "Save",
  }).then((nameRaw) => {
    if (!nameRaw) return;
    const clean = cleanName(nameRaw);
    const bad = nameProblem(clean);
    if (bad) { S.win.toast(bad); return; }
    guard(() => A.saveCurrentAs(joinRel(folder, clean + ".json")), "Saved");
  });
}

// ── keyboard ─────────────────────────────────────────────────────────────────

/** How many cards sit on one row right now. Read off the REAL grid rather than
 *  worked out from widths: the grid is auto-fill, so the answer changes with
 *  the window, the sidebar and the detail pane, and any arithmetic here would
 *  be a second copy of the CSS that could drift from it. */
function gridColumns() {
  const grid = S.win?.main?.querySelector(".pixwb-grid");
  if (!grid) return 1;
  const cols = getComputedStyle(grid).gridTemplateColumns;
  const n = cols ? cols.trim().split(/\s+/).filter(Boolean).length : 0;
  return Math.max(1, n);
}

function onPanelKeys(e) {
  // Rename boxes and the note field stopPropagation, so they never reach here
  // and typing in them is unaffected. The search box deliberately DOES let
  // arrows through, so you can type and then walk the results without moving
  // your hands.
  //
  // The tidy screen groups the SAME workflows into sections, so its visual
  // order is not S.visible's order and a workflow can appear twice. Walking
  // S.visible there moved the cursor in an order that matched nothing on
  // screen, so the order is read off the rendered rows instead - first
  // appearance only, so one workflow is one stop.
  let list = S.visible;
  if (S.sel.kind === "tidy") {
    const seenRel = new Set();
    list = [];
    for (const row of S.win.main.querySelectorAll(".pixwb-tdrow[data-rel]")) {
      const rel = row.dataset.rel;
      if (seenRel.has(rel)) continue;
      seenRel.add(rel);
      const entry = S.byRel.get(rel);
      if (entry) list.push(entry);
    }
  }
  if (!list.length) return;
  const idx = S.kbdRel ? list.findIndex((x) => x.rel === S.kbdRel) : -1;

  // In a GRID, up and down have to jump a whole ROW. Stepping one card at a
  // time made them behave exactly like left and right, which is why they read
  // as not working. In list view a row IS one item, so the step is 1.
  const ARROWS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: "up", ArrowDown: "down" };
  if (e.key in ARROWS) {
    // Left/Right belong to the CARET when there is text to move through -
    // hijacking them meant a typed query could not be edited without the mouse.
    // Up/Down are always navigation: a single-line input has no use for them.
    const el0 = e.target;
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    if (horizontal && el0 && el0.tagName === "INPUT" && (el0.value || "").length) {
      const at = el0.selectionStart ?? 0;
      const atEdge = e.key === "ArrowLeft" ? at === 0 : at >= el0.value.length;
      // Only take over once the caret has nowhere left to go.
      if (!atEdge || el0.selectionStart !== el0.selectionEnd) return;
    }
    e.preventDefault();
    // The tidy screen is a single column of rows, whatever Grid/List says.
    const cols = (S.view === "list" || S.sel.kind === "tidy") ? 1 : gridColumns();
    const raw = ARROWS[e.key];
    const step = raw === "up" ? -cols : raw === "down" ? cols : raw;
    let next = idx < 0 ? (step > 0 ? 0 : list.length - 1) : idx + step;
    // Clamping rather than wrapping: landing on the last card because you
    // pressed Up once too often is disorienting. Except a vertical move that
    // would fall off the end still goes to the final card, so the bottom row
    // is always reachable even when it is not full.
    if (next < 0) next = raw === "up" ? Math.max(0, idx % cols) : 0;
    if (next > list.length - 1) next = list.length - 1;
    S.kbdRel = list[next].rel;
    S.selected = new Set([S.kbdRel]);
    render();
    S.win.main.querySelector(".kbd")?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const target = idx >= 0 ? list[idx] : list[0];
    if (target) HANDLERS.onOpen(target);
    return;
  }
  if (e.key === "F2") {
    e.preventDefault();
    const target = idx >= 0 ? list[idx] : null;
    if (target) HANDLERS.onRename(target);
  }
}

function buildFooter(foot) {
  foot.textContent = "";
  const hint = (keys, what) => {
    const w = el("span");
    w.append(el("b", null, keys), document.createTextNode(" " + what));
    foot.append(w);
  };
  hint("type", "search");
  hint("← → ↑ ↓", "move");
  hint("Enter", "open");
  hint("F2", "rename");
  hint("double click", "open");
  hint("drag", "onto a folder to move");
  hint("Esc", "close");

  // Right-aligned, and on the panel rather than tucked away: "which version are
  // you on" is the first thing any support answer needs, and the Help window
  // already puts it here for the same reason. Click copies the full line.
  foot.append(el("div", "pixwb-footsp"));

  // Opens the FULL help browser at this panel's own page, rather than being a
  // second, smaller pile of explanation that would drift from it.
  const help = el("button", "pixwb-helpbtn", "?");
  help.type = "button";
  help.title = "How this panel works: the buttons, the shortcuts, where covers are kept";
  help.addEventListener("click", () => {
    try {
      window.PixaromaHelpBrowser?.open("canvas:workflows");
    } catch {
      S.win.toast("The help browser is not available.");
    }
  });
  foot.append(help);
  const ver = el("button", "pixwb-ver");
  ver.type = "button";
  const vp = versionParts();
  ver.append(el("span", "pixwb-vername", vp.name), document.createTextNode(" " + vp.number));
  ver.title = versionLine() + "  ·  click to copy";
  // Re-read as the pointer arrives, because the line names the RENDERER and the
  // renderer can be switched without reloading the page. Built once, the
  // tooltip went on saying "Classic nodes" after a switch to Nodes 2.0 - which
  // is exactly the detail someone is reading it to report.
  ver.addEventListener("pointerenter", () => {
    ver.title = versionLine() + "  ·  click to copy";
  });
  ver.addEventListener("click", async () => {
    const line = versionLine();
    // Falls back to the textarea trick for a plain-http LAN address, and if
    // even that fails the line itself is shown so it can be copied by hand.
    const ok = await copyText(line);
    S.win.toast(ok ? "Copied: " + line : line);
  });
  foot.append(ver);
}

// ── open / close ─────────────────────────────────────────────────────────────

function ensureWindow() {
  if (S.win) return S.win;
  S.win = createWorkflowWindow({
    onRender: (opts) => {
      if (opts?.resizeOnly) return;      // a resize must not refetch the folder
      if (opts?.repaintOnly) {            // every time the corner is dragged
        // The detail pane just became visible mid-drag: fill it from the data
        // already loaded. No refetch, no toolbar rebuild - the render alone.
        //
        // UNLESS a folder is being renamed right now. This render fires from a
        // pointermove, not from anything the user finished, and rebuilding the
        // folder column tears the rename box out with the typed name in it. A
        // workflow-card rename survives that (the grid restores its box); the
        // folder box has no such mechanism, so the render is skipped instead -
        // the detail pane fills on the next real render, the rename does not
        // silently vanish mid-drag.
        if (S.win.el.querySelector("input.pixwb-foldrename")) return;
        render();
        return;
      }
      buildBar(S.win.bar);
      buildFooter(S.win.foot);
      loadData().then(render);
    },
    onClose: () => {
      closeContextMenu();
      // Anything modal or half-finished has to go with the panel, or it comes
      // BACK on the next open still wired to the workflow it was about to act
      // on. Both of these were reachable: a rename box resurrected itself with
      // focus and could then commit a half-typed name, and a Delete confirmation
      // closed with the panel reappeared later, still able to delete the file
      // the user had walked away from.
      dropRename(false);        // false: closing is not a surprise, do not toast
      closeAsk();
      syncButton();
    },
  });
  // Panel-wide, not on the search input: the hint says the arrows move the
  // selection, so they have to work wherever the focus happens to be.
  S.win.el.addEventListener("keydown", onPanelKeys);
  // A closing context menu leaves focus on a button it just deleted, which is
  // document.body - and the handler above never fires again. Tell the menu
  // where to put focus back.
  setMenuFocusHome(() => S.win?.focusSearch());
  // A rename can be interrupted by the row itself going away - the search
  // narrowed, the folder changed, the file was removed elsewhere. Say so; the
  // alternative is the typing silently disappearing.
  setRenameLostNotifier((name) => {
    S.win?.toast(`Stopped renaming "${name}" - it is no longer on screen.`);
  });
  return S.win;
}

function toggle() {
  const win = ensureWindow();
  win.toggle();
  syncButton();
}

function syncButton() {
  if (!S.btn) return;
  S.btn.classList.toggle("pixwb-btn-open", !!S.win?.isOpen());
}

// ── the toolbar button ───────────────────────────────────────────────────────

function mountToolbarButton() {
  if (document.querySelector(".pixwb-btn")) return;
  // The button mounts at startup but the WINDOW is not built until it is first
  // opened, so injecting the stylesheet only from the window left the button
  // unstyled: 20x36, no background, and a 0x0 icon with no mask. Inject here
  // too. It is idempotent, and css.mjs owns its own constants precisely so it
  // does not matter which caller gets there first (help-browser pattern #2).
  injectWorkflowCSS();
  const settingsGroupEl = app.menu?.settingsGroup?.element;
  if (!settingsGroupEl) {
    // The menu is not up yet on a cold start. Retry a few times, then give up
    // silently rather than spinning forever on a build that never has one.
    if (mountToolbarButton._tries == null) mountToolbarButton._tries = 0;
    if (++mountToolbarButton._tries > 20) {
      console.warn("[Pixaroma.Workflows] toolbar mount: app.menu.settingsGroup never appeared");
      return;
    }
    setTimeout(mountToolbarButton, 250);
    return;
  }

  const group = document.createElement("div");
  // pixwb-group-btn is what js/toolbar_visibility hides when the user turns
  // this button off. It has to be on the GROUP, not the button: the group
  // carries the toolbar spacing, so hiding the button alone leaves its gap.
  group.className = "comfyui-button-group pixwb-group-btn";
  const btn = document.createElement("button");
  btn.className = "comfyui-button pixwb-btn";
  btn.title = "Pixaroma Workflows: find, organise and open your workflows (Alt+W)";
  btn.append(el("span", "pixwb-btn-icon"));
  btn.addEventListener("click", toggle);
  group.append(btn);
  settingsGroupEl.before(group);
  S.btn = btn;
  syncButton();
}

app.registerExtension({
  name: "Pixaroma.WorkflowBrowser",
  commands: [{
    id: CMD_ID,
    label: "Pixaroma Workflows",
    icon: "pixwb-cmd-icon",
    function: toggle,
  }],
  keybindings: [{ combo: { key: "w", alt: true }, commandId: CMD_ID }],

  // Right-click on empty canvas. The new context-menu API, never the deprecated
  // monkey-patch (Vue Compat #20).
  getCanvasMenuItems() {
    return [{ content: "👑 Pixaroma Workflows", callback: toggle }];
  },

  async setup() {
    try {
      S.view = app.ui.settings.getSettingValue(VIEW_SETTING) || "grid";
      const savedSort = app.ui.settings.getSettingValue(SORT_SETTING);
      S.sort = SORT_LABELS[savedSort] ? savedSort : "recent";
      const savedDensity = app.ui.settings.getSettingValue(DENSITY_SETTING);
      S.density = DENSITY[savedDensity] ? savedDensity : "m";
    } catch { /* unregistered settings, absent on a first run */ }
    // Outside the try: an unreadable setting must still leave the panel at a
    // sane size rather than at whatever --pixwb-k happened to be.
    applyDensity(S.density);
    mountToolbarButton();
    installOutputCoverCapture();
  },
});
