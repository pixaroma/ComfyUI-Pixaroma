// Save Text Pixaroma - node wiring.
//
// The browser owns the collected buffer and does the file writing; Python is a
// pass-through that just reports each run's text (the header of
// nodes/node_save_text.py explains why, and it is load-bearing).
//
// Because there is no hidden state input there is deliberately NO
// app.graphToPrompt hook here - nothing of ours needs to reach Python.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import {
  applyAdaptiveCanvasOnly,
  isVueNodes,
  installResizeFloor,
  installCanvasZoomPassthrough,
  installNativeTextMenu,
  notifyGraphChanged,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeSettings, installNodeAccent } from "../shared/node_settings.mjs";
import { pixConfirm } from "../shared/confirm_dialog.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import {
  COMFY_CLASS,
  DEFAULT_STATE,
  readState,
  writeState,
  readBuffer,
  writeBuffer,
  isDirty,
  countEntries,
  splitEntries,
  appendEntry,
  shouldCollect,
  separatorStr,
  queueOnNode,
  SEPARATOR_LABELS,
  resolveDateTokens,
  expandNativeTokens,
  sanitizePrefixMirror,
} from "./state.mjs";
import { injectCSS, buildRoot } from "./ui.mjs";
import { openSettingsPanel, closeSettingsPanelFor, setPanelPreview } from "./settings.mjs";

// Width. MEASURED rather than computed, because the buttons are wider than
// their 86px minimum once their labels are in: Copy all 95, Save .txt 97, Clear
// 86, Folder 87, gear 30, plus four 5px gaps = 415 of content. The widget root
// is the node width minus 20, and .pix-stx-inner takes another 20 of padding,
// so ONE line needs a node of 455. 474 is the same width as Save Image
// Pixaroma, which gives a little headroom for a wider system font and makes the
// two read as a pair.
//
// MIN_W stays well below that on purpose: flex-wrap sends the row to two lines
// when squeezed and the resize floor grows the node to fit, so a narrow node is
// untidy but never broken. Only the DEFAULT needs to avoid wrapping.
const MIN_W = 380;
const MIN_H = 165;
const DEFAULT_W = 474;
const DEFAULT_H = 320;
const BOX_MIN = 54;
// Below this the root is not really laid out (an inactive workflow tab keeps
// its nodes in the DOM at display:none), so every offsetHeight reads 0 and a
// measurement taken there would be a lie.
const MEASURABLE_MIN_W = 40;

// ── node body FLOOR (fill model) ────────────────────────────────────────────
// The text box absorbs all free height, so: NO custom computeSize and NO
// getMaxHeight. The box is counted at its MINIMUM rather than its grown height,
// or the node could never be dragged smaller once it had collected anything.
function measureFloor(ui) {
  const inner = ui?.inner;
  const root = ui?.root;
  if (!inner || !root || !root.isConnected || root.clientWidth < MEASURABLE_MIN_W) {
    return ui?._pixStxFloorCache || MIN_H;
  }
  let h = 0;
  let n = 0;
  for (const ch of inner.children) {
    let oh = ch.offsetHeight;
    if (oh <= 0) continue;
    if (ch === ui.box) oh = BOX_MIN;
    h += oh;
    n++;
  }
  if (n === 0) return ui._pixStxFloorCache || MIN_H;
  h += 14; // inner vertical padding (8 + 6)
  h += (n - 1) * 6; // flex gaps
  // Coarse-rounded to a 4px grid, or font and sub-pixel jitter creeps
  // node.size bigger on every workflow switch (grow-to-content is grow-only).
  const out = Math.round(Math.max(MIN_H, Math.min(h, 900)) / 4) * 4;
  ui._pixStxFloorCache = out;
  return out;
}

function floorOf(ui) {
  try {
    return measureFloor(ui);
  } catch {
    return MIN_H;
  }
}

function uiOf(node) {
  return node?._pixStxUI || null;
}

// Two Save Text nodes must never write to the SAME file, or each would
// overwrite the other's collection with its own - the node's whole promise is
// that the file matches what you see.
//
// Two independent nodes are already safe: each claims its own name through the
// route's O_EXCL loop, so the same default pattern gives 001 and 002. The hole
// is COPYING a node: clone/paste duplicates node.properties, so the copy
// inherits currentFile and starts writing over the original's file. MEASURED:
// cloning a node holding prompts_003.txt produced a second node also claiming
// prompts_003.txt.
//
// So the newcomer gives up the name and claims a fresh one on its next write.
// It keeps its buffer (a copy of a collection is a reasonable starting point);
// the footer just says "not saved yet" until it is written.
//
// This is safe on the LOAD path (Vue Compat #18) because it only writes when it
// finds a genuine collision. Two nodes in a cleanly saved workflow hold
// different names, so the loop is a no-op and nothing is written - verified by
// a serialize/reload diff with five of these nodes on the canvas.
//
// It deliberately does NOT call notifyGraphChanged(): a workflow saved with a
// collision (cloned under an older build) is repaired on every open, and the
// repair is idempotent, so there is nothing that must be captured. Flagging a
// workflow modified during a load is the very thing Vue Compat #18 forbids.
function dedupeCurrentFile(node) {
  const st = readState(node);
  if (!st.currentFile) return;
  const graph = node.graph || app.graph;
  const nodes = graph?._nodes || graph?.nodes || [];
  for (const other of nodes) {
    if (other === node || other.comfyClass !== COMFY_CLASS) continue;
    const o = readState(other);
    if (o.currentFile === st.currentFile && (o.folder || "") === (st.folder || "")) {
      st.currentFile = "";
      writeState(node, st);
      // Invalidate any save already in flight, or its response would hand this
      // node straight back the filename it has just given up.
      node._pixStxGen = (node._pixStxGen || 0) + 1;
      node._pixStxCntKey = null;
      node._pixStxNextName = null;
      return;
    }
  }
}

// ── the face ────────────────────────────────────────────────────────────────

// DOM ONLY. Called from the load path, so it must never write node.properties,
// node.size, slots or widget values (Vue Compat #18) - an untouched workflow
// that flags itself "modified" just by being opened is the bug this prevents.
function syncFace(node) {
  const ui = uiOf(node);
  if (!ui) return;
  const st = readState(node);
  const buf = readBuffer(node);
  if (ui.box.value !== buf) ui.box.value = buf;

  const n = countEntries(buf, st.separator);
  ui.count.textContent = n === 1 ? "1 entry" : `${n} entries`;

  const dirty = isDirty(node);
  ui.file.classList.remove("saved", "dirty", "bad");
  if (st.currentFile && dirty) {
    ui.file.textContent = `${st.currentFile} · not saved yet`;
    ui.file.classList.add("dirty");
    ui.file.title = "The box has changed since it was last written. Press Save .txt.";
  } else if (st.currentFile) {
    ui.file.textContent = `${st.currentFile} ✓ saved`;
    ui.file.classList.add("saved");
    ui.file.title = "The file matches what you see here.";
  } else if (n > 0) {
    ui.file.textContent = "not saved yet";
    ui.file.classList.add("dirty");
    ui.file.title = "Nothing has been written to a file yet. Press Save .txt.";
  } else {
    ui.file.textContent = node._pixStxNextName ? `next: ${node._pixStxNextName}` : "";
    ui.file.title = "The file a new collection will start.";
  }

  // Save is pointless with an empty box that has never had a file.
  ui.saveBtn.disabled = !buf.trim() && !st.currentFile;
  ui.copyBtn.disabled = !buf.trim();
  ui.clearBtn.disabled = !buf.trim();
}

function flash(ui, btn, label) {
  // Cache the REAL label once per button. Reading btn.textContent on every call
  // captured the FLASHED text on a second click inside the 700ms window, so a
  // double click on Copy all left the button reading "Copied" for good - until
  // a workflow reload or a renderer flip rebuilt the DOM.
  if (btn._pixStxLabel == null) btn._pixStxLabel = btn.textContent;
  btn.textContent = label;
  btn.classList.add("is-flashing");
  clearTimeout(btn._pixStxFlash);
  btn._pixStxFlash = setTimeout(() => {
    btn.classList.remove("is-flashing");
    btn.textContent = btn._pixStxLabel;
  }, 700);
}

// The footer is ONE line, and denied_message() is a five-line console string
// (what to click, where the config file lives, which folders always work). Put
// a readable sentence on the face and keep the full text in the tooltip, or the
// footer shows a truncated fragment ending mid-word. Anything already short
// passes through untouched.
function shorten(msg) {
  const s = String(msg || "").trim();
  if (/not approved/i.test(s)) return "Folder not approved - open settings and use Browse.";
  const first = s.split("\n")[0].trim();
  return first.length > 90 ? first.slice(0, 87) + "..." : first;
}

function say(node, msg, kind, fullTitle, ms) {
  const ui = uiOf(node);
  if (!ui) return;
  clearTimeout(node._pixStxSayTimer);
  ui.file.classList.remove("saved", "dirty", "bad");
  if (kind) ui.file.classList.add(kind);
  ui.file.textContent = msg;
  ui.file.title = fullTitle || msg;
  node._pixStxSayTimer = setTimeout(() => syncFace(node), ms || 3200);
}

// Warn when a collected prompt CONTAINS the separator, because it is then
// stored as several entries: the count is wrong, the repeat guard compares
// against only the tail of it, and pasting the .txt into Prompt Pack splits it
// too. The user cannot know in advance that their model emits blank lines, so
// the node has to say so the moment it happens.
//
// Detection MUST be here, at collect time, while the raw incoming text is still
// separate. Once it is in the buffer the information is gone - "a\n\nb" could
// equally be one paragraph prompt or two prompts.
//
// Runtime-only (`_pixStxSplitWarnFor`), never node.properties: it describes what
// just happened rather than saved state, so it cannot dirty a workflow or touch
// the load path. Warned once per separator SETTING - repeating it on every run
// would be noise, and changing the setting re-arms it so a still-wrong choice
// gets flagged again.
function warnIfEntryContainsSeparator(node, text) {
  const st = readState(node);
  const sep = separatorStr(st.separator);
  if (!sep || !String(text).includes(sep)) return;
  if (node._pixStxSplitWarnFor === st.separator) return;
  node._pixStxSplitWarnFor = st.separator;
  const label = (SEPARATOR_LABELS.find((p) => p[0] === st.separator) || [, st.separator])[1];
  const alt = st.separator === "rule" ? "another separator" : "--- line";
  say(
    node,
    "That prompt contains the separator, so it counts as more than one.",
    "bad",
    `Your prompt has a "${label}" inside it, and that is what marks the end of ` +
      `one entry - so it is stored, counted and re-loaded as several prompts, ` +
      `and Skip repeats stops working for it.\n\n` +
      `Fix: open the settings gear and set Separator to ${alt}.\n\n` +
      `Nothing has been lost - the text is all there, it is only split.`,
    9000,
  );
}

// ── the live "next new file" line ───────────────────────────────────────────
// Reuses Save Image's next_counter route: its `name` is a free-form template,
// so it scans .txt files just as happily as .png. Display only - the route
// recomputes everything at write time, so a stale preview can never misname a
// file.
function previewName(node) {
  const st = readState(node);
  let p = expandNativeTokens(resolveDateTokens(st.pattern || DEFAULT_STATE.pattern));
  p = sanitizePrefixMirror(p) || "prompts_%counter%";
  return p.endsWith(".txt") ? p : p + ".txt";
}

function updatePreview(node) {
  const ui = uiOf(node);
  if (!ui) return;
  const st = readState(node);
  const name = previewName(node);
  // The four-character ESCAPE, never a raw NUL byte: a raw one makes
  // ripgrep treat the whole file as binary, so every future grep and code
  // review silently skips it while the Read tool still shows clean text.
  // Save Image's cntKey regressed on exactly this (save-image #13h). A
  // space will not do - it can occur inside a folder path, so it is a
  // weaker delimiter.
  const key = [st.folder, name, st.counterDigits].join("\x00");
  if (key === node._pixStxCntKey) return;
  node._pixStxCntKey = key;
  clearTimeout(node._pixStxCntTimer);
  node._pixStxCntTimer = setTimeout(async () => {
    const url =
      pixApiUrl("/pixaroma/api/save_image/next_counter") +
      `?folder=${encodeURIComponent(st.folder || "")}` +
      `&name=${encodeURIComponent(name)}` +
      `&digits=${encodeURIComponent(st.counterDigits || 3)}`;
    let j = null;
    try {
      j = await (await fetch(url)).json();
    } catch {
      /* offline / route missing: leave the preview showing the raw template */
    }
    // RE-QUERY after the await: the node can be deleted while a fetch is in
    // flight, and writing into a detached face is how a leak starts.
    //
    // The KEY check is the other half, and Save Video already had it while this
    // did not: editing the folder or the pattern starts a second lookup, and
    // whichever resolves last wins, so an out-of-order response can leave the
    // node showing a filename for settings the user has already changed. That
    // name is not decoration - it feeds the footer, the settings panel and the
    // Clear dialog's "starts a new file (...)" line.
    if (!uiOf(node) || node._pixStxCntKey !== key) return; // superseded
    if (j?.denied) {
      node._pixStxNextName = null;
      setPanelPreview(node, j.message || "That folder is not approved yet.", true);
      say(node, shorten(j.message), "bad", j.message);
      return;
    }
    node._pixStxNextName = j?.resolved || name;
    setPanelPreview(node, node._pixStxNextName, false);
    if (!readState(node).currentFile) syncFace(node);
  }, 350);
}

// ── writing the file ────────────────────────────────────────────────────────
// ALWAYS the whole buffer, never an append, so a run and a manual Save take the
// identical path. `claim` is what decides between continuing the current file
// and starting a new one, and it is simply "do we already have a file name".
//
// ONE SAVE PER NODE AT A TIME. Every caller goes through this wrapper, so a
// second save waits for the first to have written its filename back. Two
// measured races made that necessary, both from `claim` and `currentFile`
// being read BEFORE the await (pattern #4, for the fourth time in this one
// function):
//
//   * 4 runs back to back claimed TWO files - racebefore_001.txt with three
//     entries and racebefore_002.txt with four - because the early saves all
//     still saw currentFile === "". One collection, several files.
//   * two overlapping writes to the SAME name can land in either order, which
//     would leave the file holding an older buffer than the node shows. That
//     one breaks the node's headline promise, so it mattered more than litter.
//
// Reproduce either by firing `app.queuePrompt(0,1)` several times without
// awaiting a gap; a normal image workflow is far too slow to hit it, which is
// why four review rounds did not.
function saveToFile(node, opts = {}) {
  return queueOnNode(node, "_pixStxSaveChain", () => saveToFileNow(node, opts));
}

async function saveToFileNow(node, { quiet } = {}) {
  const ui = uiOf(node);
  if (!ui) return false;
  const st = readState(node);
  const buf = readBuffer(node);
  if (!buf.trim() && !st.currentFile) return false; // nothing worth a file yet
  // Which "collection" this write belongs to. Clear (and the copied-node
  // dedupe) bump it, so a save that was already in flight when the user cleared
  // knows not to write its result back - see the check after the await.
  const gen = node._pixStxGen || 0;

  let j = null;
  try {
    const r = await fetch(pixApiUrl("/pixaroma/api/save_text/write"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: st.folder || "",
        name: st.currentFile || previewName(node),
        content: buf,
        claim: !st.currentFile,
        digits: st.counterDigits || 3,
        separator: st.separator,
      }),
    });
    j = await r.json();
  } catch (e) {
    if (uiOf(node)) say(node, "Could not reach the server to save.", "bad");
    return false;
  }
  if (!uiOf(node)) return false; // deleted mid-flight

  if (!j?.ok) {
    say(node, shorten(j?.message) || "Could not save.", "bad", j?.message);
    return false;
  }
  // The collection this save belonged to is GONE - the user pressed Clear (or a
  // copied node gave up the name) while the request was in flight. Writing
  // j.file back would re-adopt the very file Clear promised to keep, and the
  // next run or Save would then overwrite it. That is the node's headline
  // promise broken, so bail without touching state; the file we just wrote is
  // complete and correct, it simply is not this node's file any more.
  if ((node._pixStxGen || 0) !== gen) return false;
  // Re-read rather than reusing `st`: the user can change a setting while the
  // request is in flight, and writing the stale object back would revert it.
  const s2 = readState(node);
  s2.currentFile = j.file;
  writeState(node, s2);
  // Clear the dirty flag ONLY if the buffer is still what we actually sent.
  // `buf` was snapshotted before the fetch; if the user typed while it was in
  // flight, the file does NOT contain what the node now holds, and marking it
  // clean would put a green "saved" under text that was never written - a
  // direct breach of this node's one promise. Re-reading the buffer (rather
  // than writing `buf` back) is still right: it preserves that in-flight edit.
  const nowBuf = readBuffer(node);
  writeBuffer(node, nowBuf, nowBuf !== buf);
  node._pixStxSavedPath = j.path || "";
  // The counter has moved on, so drop the cached key AND re-resolve. Clearing
  // the key alone was not enough: nothing re-ran the lookup after a manual
  // Save, so the cached "next file" stayed at the name this save had just
  // taken - and the Clear dialog then offered the same file as both the one
  // being kept and the new one being started. Found by reading the dialog.
  node._pixStxCntKey = null;
  node._pixStxNextName = null;
  syncFace(node);
  updatePreview(node);
  if (!quiet) {
    ui.file.title = j.path || "";
  }
  return true;
}

// Node ids ComfyUI reported as CACHED for the run currently in flight.
//
// A CACHED node does NOT re-execute, but ComfyUI still replays its stored ui
// payload to the browser (execution.py's _send_cached_ui sends an identical
// "executed" event - this is the same mechanism that makes Preview Image
// re-show its picture on an unchanged re-queue). MEASURED here: two queues of
// an unchanged graph produced two `executed` events and, with Skip repeats set
// to "Keep all", the same prompt was collected twice and written to the file.
//
// So a cached run must not collect. By definition it produced nothing new -
// and this also covers the more confusing case where the user changes something
// ELSEWHERE in the graph, re-queues, and Save Text's own input is unchanged.
//
// The event order is MEASURED and reliable: execution_start, then
// execution_cached carrying the id list, then executed. Cleared on
// execution_start so a stale set can never suppress a later genuine run - the
// failure mode of over-suppression is a LOST entry, which is far worse than the
// duplicate it prevents. A host that never sends execution_cached simply leaves
// the set empty and behaves exactly as before.
const _cachedThisRun = new Set();

function installCacheTracker() {
  if (app._pixStxCachePatched) return;
  app._pixStxCachePatched = true;
  api.addEventListener("execution_start", () => _cachedThisRun.clear());
  api.addEventListener("execution_cached", ({ detail }) => {
    for (const id of detail?.nodes || []) _cachedThisRun.add(String(id));
  });
}

// ── collecting one run ──────────────────────────────────────────────────────
// ONE entry. The guards that belong to the DELIVERY of a result (a cached
// replay, and the same result arriving down both paths) are deliberately NOT
// here - they live in acceptDelivery() and are applied once per delivery, not
// once per entry. Keeping them here silently limited the node to one entry per
// run, which is what broke the folder-batch case (see acceptDelivery).
async function collectRun(node, text) {
  const ui = uiOf(node);
  if (!ui) return;

  const st = readState(node);
  if (!shouldCollect(readBuffer(node), text, st)) return;

  // Roll over BEFORE appending, so the new entry starts the new file rather
  // than being written into both. The full file has already been saved by the
  // run that filled it.
  let buf = readBuffer(node);
  const max = st.maxEntries || 0;
  if (max > 0 && countEntries(buf, st.separator) >= max) {
    // Rescue the full collection to disk BEFORE emptying it, and only roll over
    // if that actually succeeded. Two bugs lived here:
    //   * the old guard was `st.currentFile && isDirty(node)`, so a collection
    //     that had NEVER been written (autoSave off, Save never pressed) skipped
    //     the rescue entirely and was then wiped. saveToFile handles that case
    //     perfectly well - it claims a file when currentFile is empty.
    //   * the return value was ignored, so a failed save (folder no longer
    //     approved, disk full, server down) fell straight through to the wipe.
    // If the rescue fails we deliberately do NOT roll over: the buffer keeps
    // growing past max, which is untidy but keeps the user's text. The footer
    // is already showing why the save failed.
    let rescued = true;
    if (isDirty(node) || !st.currentFile) {
      rescued = await saveToFile(node, { quiet: true });
      if (!uiOf(node)) return;
    }
    if (rescued) {
      const s2 = readState(node);
      s2.currentFile = "";
      writeState(node, s2);
      // The rescue above is already awaited, so this only invalidates OTHER
      // saves still in flight - which must not re-adopt the file we just
      // closed off.
      node._pixStxGen = (node._pixStxGen || 0) + 1;
      buf = "";
      node._pixStxCntKey = null;
    } else {
      // The rescue did not happen, so re-read instead of appending to `buf` -
      // which was snapshotted BEFORE an await that may have lasted seconds.
      // With the generation counter this stopped being cosmetic: pressing Clear
      // during the rescue makes saveToFile return false, and writing the stale
      // snapshot back would RESURRECT everything the user had just cleared.
      // Also covers the plain failed-save case, where it silently reverted
      // anything typed meanwhile.
      buf = readBuffer(node);
    }
  }

  writeBuffer(node, appendEntry(buf, text, readState(node)), true);
  syncFace(node);
  // A run legitimately changes the workflow, so record it (convention #31) -
  // otherwise the collection can be lost without ComfyUI ever offering to save.
  notifyGraphChanged();

  if (readState(node).autoSave) await saveToFile(node, { quiet: true });
  updatePreview(node);
  // LAST, so the warning is what stays on the footer rather than being
  // overwritten by the save's own "✓ saved" a moment later.
  if (uiOf(node)) warnIfEntryContainsSeparator(node, text);
}

// ── events ──────────────────────────────────────────────────────────────────
function wireEvents(node, ui) {
  ui.gear.onclick = (e) => {
    e.stopPropagation();
    openSaveTextPanel(node);
  };
  // or the gear starts a node drag instead of opening the panel
  ui.gear.addEventListener("pointerdown", (e) => e.stopPropagation());

  ui.box.addEventListener("input", () => {
    writeBuffer(node, ui.box.value, true);
    const st = readState(node);
    const n = countEntries(ui.box.value, st.separator);
    ui.count.textContent = n === 1 ? "1 entry" : `${n} entries`;
    ui.saveBtn.disabled = !ui.box.value.trim() && !st.currentFile;
    ui.copyBtn.disabled = !ui.box.value.trim();
    ui.clearBtn.disabled = !ui.box.value.trim();
    if (!ui.file.classList.contains("dirty")) syncFace(node);
  });

  ui.copyBtn.onclick = async () => {
    const v = readBuffer(node);
    if (!v.trim()) {
      say(node, "Nothing to copy.", "bad");
      return;
    }
    let ok = false;
    try {
      await navigator.clipboard.writeText(v);
      ok = true;
    } catch {
      // http on a LAN address has no clipboard API; the old command still works
      try {
        ui.box.select();
        ok = document.execCommand("copy");
        ui.box.setSelectionRange(0, 0);
      } catch {
        ok = false;
      }
    }
    if (ok) flash(ui, ui.copyBtn, "Copied");
    else say(node, "Could not copy.", "bad");
  };

  ui.saveBtn.onclick = async () => {
    ui.saveBtn.disabled = true;
    const ok = await saveToFile(node);
    if (!uiOf(node)) return;
    if (ok) {
      flash(ui, ui.saveBtn, "Saved");
      syncFace(node);
    } else {
      // Do NOT syncFace here. saveToFile has just put the reason on the footer
      // (an unapproved folder, a read-only disk), and syncFace would overwrite
      // it in the same tick with the previous "saved" line - so a refused save
      // read as a successful one. MEASURED: pointing the folder at
      // C:/Windows/System32 and pressing Save left the footer green and saying
      // saved, while nothing had been written. say() reverts on its own timer.
      ui.saveBtn.disabled = false;
    }
  };

  ui.clearBtn.onclick = async () => {
    const st = readState(node);
    const buf = readBuffer(node);
    const n = countEntries(buf, st.separator);
    if (!n) return;
    // Say WHAT is being counted, and end on what actually happens. The first
    // wording was "All 2 are already saved in prompts_001.txt", which drops the
    // noun and reads as a riddle - reported straight off a screenshot.
    const things = n === 1 ? "1 entry" : `${n} entries`;
    // Belt against a momentarily stale preview: never name the file being kept
    // as the file being started, even if the lookup has not come back yet.
    const nx = node._pixStxNextName;
    const nextFile = nx && nx !== st.currentFile ? ` (${nx})` : "";
    let message;
    if (st.currentFile && !isDirty(node)) {
      message =
        `Your ${things} are already saved in ${st.currentFile}, and that file is kept. ` +
        `The node empties and starts a new file${nextFile}. Nothing is lost.`;
    } else if (st.currentFile) {
      message =
        `${st.currentFile} still holds what was saved earlier and is kept. But you have ` +
        `edited the list since, and those edits have never been written - clearing loses them. ` +
        `Press Keep, then Save .txt, if you want them.`;
    } else {
      message =
        `Your ${things} have never been written to a file, so clearing loses them. ` +
        `Press Keep, then Save .txt, if you want them.`;
    }
    const yes = await pixConfirm({
      title: "Clear the list?",
      message,
      okText: "Clear",
      cancelText: "Keep",
      danger: !st.currentFile || isDirty(node),
    });
    if (!yes || !uiOf(node)) return;
    const s2 = readState(node);
    s2.currentFile = "";
    writeState(node, s2);
    writeBuffer(node, "", false);
    // THE important one. A run can land while the confirm dialog is open, and
    // its autoSave POST would resolve after this and write j.file back - so the
    // node would silently re-adopt the file Clear had just promised to keep,
    // and the next save would overwrite it.
    node._pixStxGen = (node._pixStxGen || 0) + 1;
    node._pixStxCntKey = null;
    node._pixStxLastApplied = null;
    syncFace(node);
    notifyGraphChanged();
    updatePreview(node);
  };

  ui.folderBtn.onclick = async () => {
    const st = readState(node);
    try {
      const r = await fetch(pixApiUrl("/pixaroma/api/save_image/open_folder"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: st.folder || "" }),
      });
      const j = await r.json();
      if (!uiOf(node)) return;
      if (!j?.ok) say(node, shorten(j?.message) || "Could not open the folder.", "bad", j?.message);
      else say(node, "Opened - it may be behind the browser.", null);
    } catch {
      if (uiOf(node)) say(node, "Could not open the folder.", "bad");
    }
  };
}

function openSaveTextPanel(node) {
  openSettingsPanel(node, () => {
    if (!uiOf(node)) return;
    // Re-arm the split warning if the separator changed, so a choice that is
    // still wrong for these prompts gets flagged again on the next run rather
    // than staying silent because we warned once under the old setting.
    if (node._pixStxSplitWarnFor && node._pixStxSplitWarnFor !== readState(node).separator) {
      node._pixStxSplitWarnFor = null;
    }
    syncFace(node);
    updatePreview(node);
  });
  // Show the name we already resolved straight away, THEN refresh. Without the
  // first line the panel opened reading "..." forever, because updatePreview
  // early-returns when the folder/name/digits key has not changed - which it
  // has not, since the node resolved it before the panel ever existed. Found by
  // opening the panel and reading it, which is the only way this shows up.
  setPanelPreview(node, node._pixStxNextName || "", false);
  node._pixStxCntKey = null;
  updatePreview(node);
}

// ── setup ───────────────────────────────────────────────────────────────────
function setupNode(node) {
  injectCSS();
  const ui = buildRoot();
  node._pixStxUI = ui;

  installCanvasZoomPassthrough(ui.root);
  // The box is prose, and without this a right-click in it opens the NODE menu
  // instead of the browser's, so there is no way to paste with the mouse
  // (convention #33).
  installNativeTextMenu(ui.root);
  installNodeAccent(node, ui.root);

  const widget = node.addDOMWidget("pixaroma_save_text", "pixaroma_save_text", ui.root, {
    getValue: () => null,
    setValue: () => {},
    // FLOOR only: no getMaxHeight and no custom computeSize, so the text box
    // absorbs all free height in both renderers and the node can still shrink.
    getMinHeight: () => floorOf(ui),
    serialize: false,
  });
  applyAdaptiveCanvasOnly(widget);
  node._pixStxWidget = widget;
  // Set UNCONDITIONALLY, not behind `if (isVueNodes())`. The renderer can be
  // switched under a live node, and a one-time check in onNodeCreated does not
  // survive that: a node built in Classic and then switched to Nodes 2.0 kept
  // the DOMWidget prototype's version, which reports minWidth 0 - and minWidth
  // must be 1 for the saved node WIDTH to round-trip (Compare gotcha 2).
  // MEASURED before this fix: computeLayoutSize() returned minWidth 0 after a
  // flip. Defining it always is also correct in Classic, which reads
  // getMinHeight instead, and its presence is what makes the row an 'auto'
  // grower so the text box can fill the body.
  widget.computeLayoutSize = () => ({ minHeight: floorOf(ui), minWidth: 1 });

  wireEvents(node, ui);
  try {
    node._pixStxFloorOff = installResizeFloor(ui.root, () => measureFloor(ui));
  } catch {}

  // Default size on a FRESH drop only; configure() restores saved sizes. Written
  // SYNCHRONOUSLY, never from a microtask - configure() runs after
  // onNodeCreated, so a deferred write would clobber every restored size
  // (convention #9).
  const fresh = !isGraphLoading();
  if (!node.size) node.size = [DEFAULT_W, DEFAULT_H];
  if (fresh) {
    node.size[0] = DEFAULT_W;
    if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
  }

  // deferred so configure()'s restored state lands first (Vue Compat #8)
  queueMicrotask(() => {
    if (!uiOf(node)) return;
    syncFace(node);
    updatePreview(node);
  });
}

// ── result delivery ─────────────────────────────────────────────────────────
// EVERY text in the payload, not just the first.
//
// ⚠️ One run can carry MANY results. When an upstream node emits a list
// (Load Images from Folder is OUTPUT_IS_LIST), ComfyUI runs this node once per
// item and MERGES the ui outputs into a SINGLE `executed` event whose array
// holds them all. MEASURED 2026-09-11 with three images through
// `Load Images from Folder -> AI Prompt -> Save Text`, the server sent:
//   {"pixaroma_save_text":[{"text":"abstract"},{"text":"Architecture"},{"text":"BallerinaBunny"}]}
// and this function used to return `rows[0].text`, so the node collected
// "abstract" and dropped the other two. Reported as "one description instead of
// one per image" - nothing was wrong upstream, the results were all here.
function pickTexts(output) {
  const rows = output?.pixaroma_save_text;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => r?.text).filter((t) => typeof t === "string");
}

// The guards that belong to a DELIVERY rather than to an entry. Applied ONCE
// per event, keyed on the whole batch, so a run carrying several results is
// judged as one delivery and every entry in it is then collected.
//
// Both fail OPEN, because the cost of suppressing a genuine run (lost entries)
// is far worse than the duplicate it prevents.
function acceptDelivery(node, texts) {
  //  * `readBuffer(...).trim()` - with nothing collected there is nothing to
  //    duplicate, so take the replay. Without this the gate REGRESSED "Clear,
  //    then Run": this node has no graphToPrompt hook by design, so clearing
  //    the box never reaches the prompt, the node stays cached, and the replay
  //    was the only thing that would have refilled it. MEASURED - Run collected
  //    nothing at all, with no message. Cannot double-collect: the first replay
  //    makes the buffer non-empty, so a second queue is suppressed normally.
  //
  //  * the root-graph test - `cached_nodes` carries EXECUTION ids, which are
  //    composite ("5:12") for a node inside a subgraph, while `node.id` is the
  //    bare local id. So a subgraph node with local id N could be silenced by an
  //    unrelated CACHED root node that happens to have id N, and subgraph local
  //    ids start at 1 just like root ids. Bare prompt ids only ever name
  //    root-graph nodes, so restricting the gate to those is precise; a build
  //    with no rootGraph degrades to the previous behaviour.
  const rootGraph = app.rootGraph || app.graph;
  const isRootNode = !node.graph || node.graph === rootGraph;
  if (isRootNode && readBuffer(node).trim() && _cachedThisRun.has(String(node.id))) return false;

  // The two delivery paths (socket `executed` and the per-node onExecuted hook)
  // both fire on standard ComfyUI, and unlike a preview an APPEND is not
  // idempotent. Order between them is not guaranteed, so the guard is
  // symmetric: an identical BATCH inside a 2s window is treated as the same run.
  //
  // Keyed on the whole batch with a NUL join, not on one text: keying per entry
  // made a batch containing two identical prompts drop the second, and a
  // separator that cannot appear in a prompt keeps ["a","b"] distinct from
  // ["a\u0000b"]. Cost is unchanged from before: two deliberately identical runs
  // queued back to back with "Keep all" collapse to one.
  const key = texts.join("\u0000");
  const now = Date.now();
  const prev = node._pixStxLastApplied;
  if (prev && prev.text === key && now - prev.at < 2000) return false;
  node._pixStxLastApplied = { text: key, at: now };
  return true;
}

// Collect a whole delivery, one entry at a time and STRICTLY SEQUENTIALLY.
// collectRun awaits a save, and every value it reads before that await is stale
// after it (pattern file #4, four separate bugs) - so overlapping calls would
// reintroduce exactly those races. Re-check the node between entries: a save
// takes real time and the node can be deleted or the workflow switched.
async function collectDelivery(node, texts) {
  for (const t of texts) {
    if (!uiOf(node)) return;
    await collectRun(node, t);
  }
}

function installExecutedListener() {
  if (app._pixStxExecPatched) return;
  app._pixStxExecPatched = true;
  api.addEventListener("executed", ({ detail }) => {
    const id = detail?.node;
    if (id == null) return;
    const graph = app.graph;
    const node = graph?.getNodeById?.(id) ?? graph?.getNodeById?.(parseInt(id, 10));
    if (!node || node.comfyClass !== COMFY_CLASS) return;
    const texts = pickTexts(detail?.output);
    if (!texts.length) return;
    if (!acceptDelivery(node, texts)) return;
    collectDelivery(node, texts);
  });
}

registerNodeSettings(COMFY_CLASS, {
  title: "Save Text",
  open: (node) => openSaveTextPanel(node),
  ownMenuItem: true,
});

app.registerExtension({
  name: "Pixaroma.SaveText",

  setup() {
    installCacheTracker();
    installExecutedListener();
  },

  getNodeMenuItems(node) {
    if (!node || node.comfyClass !== COMFY_CLASS) return [];
    return [
      null,
      { content: "⚙ Save Text settings", callback: () => openSaveTextPanel(node) },
      {
        content: "↺ Reset node size",
        callback: () => {
          node.setSize?.([DEFAULT_W, DEFAULT_H]);
          node.setDirtyCanvas?.(true, true);
        },
      },
    ];
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== COMFY_CLASS) return;
    // hot-reload guard: without it every re-register re-wraps the prototype
    // hooks and leaks an installResizeFloor listener each time
    if (nodeType._pixStxPatched) return;
    nodeType._pixStxPatched = true;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setupNode(this);
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure?.apply(this, arguments);
      queueMicrotask(() => {
        if (!uiOf(this)) return;
        // Runs here rather than in onNodeCreated because properties are only
        // restored by the time configure returns. LiteGraph's clone() also
        // routes through configure, which is what makes it catch a copied node.
        dedupeCurrentFile(this);
        syncFace(this); // DOM only - never writes serialized state
        updatePreview(this);
      });
      return r;
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = origDraw?.apply(this, arguments);
      // The isGraphLoading gate is NOT optional (convention #7): node.size is
      // serialized and a draw hook runs on the very FIRST frame of a load,
      // earlier than any other clamp, so an ungated clamp is the one place that
      // can rewrite node.size on a clean open and flag an untouched workflow
      // modified. Nodes 2.0 has no live width clamp, so a node genuinely can be
      // saved narrower than MIN_W.
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return r;
    };

    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const r = origResize?.apply(this, arguments);
      // Gated the same way: onResize is NOT only a user drag - it also fires
      // from fit-to-content, the right-click Resize menu, node creation and
      // workflow restore.
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return r;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        closeSettingsPanelFor(this);
        this._pixStxFloorOff?.();
        clearTimeout(this._pixStxCntTimer);
        clearTimeout(this._pixStxSayTimer);
        // so the `!uiOf(node)` bails elsewhere actually fire for a removed node
        // instead of writing into a detached DOM tree
        this._pixStxUI = null;
      } catch {}
      return origRemoved?.apply(this, arguments);
    };

    // The other half of the two delivery paths: a host whose frontend hands
    // results to nodes itself, instead of re-broadcasting the raw socket event,
    // only reaches onExecuted. acceptDelivery dedupes, so a host that fires both
    // still collects once.
    const origExec = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      const r = origExec?.apply(this, arguments);
      const texts = pickTexts(output);
      if (texts.length && acceptDelivery(this, texts)) collectDelivery(this, texts);
      return r;
    };
  },
});

registerNodeHelp(COMFY_CLASS, {
  title: "Save Text Pixaroma",
  tagline:
    "Collects the text from every run into one list you can edit, copy and keep as a .txt file.",
  sections: [
    {
      heading: "What it does",
      body:
        "Wire any text into it - a prompt, or whatever an LLM prompt generator hands back - and every run adds one entry to the list on the node, separated by a blank line. The list is mirrored to a .txt file, so the prompts you tried are still there tomorrow.\n\nThe text also passes straight out of the output unchanged, so the node can sit in the middle of a chain without altering anything, or off to the side collecting.",
    },
    {
      heading: "How saving works",
      body:
        "What you see on the node IS what is in the file. There is no second copy, so there is nothing to get out of step.\n\nAfter each run the file is rewritten and the line under the box turns green and says saved. Edit or delete something and it turns orange and says not saved yet, until you press Save .txt. That line is the whole story: if it is green, the file matches.",
    },
    {
      heading: "Clear never erases your file",
      body:
        "Clear empties the box and starts a NEW file. The one it already wrote is kept exactly as it is, so think of it as turning to a fresh page rather than deleting anything. The next file carries on the numbering: prompts_003.txt becomes prompts_004.txt.\n\nThe one case where Clear does lose something is when you have edited the box and not saved, or when nothing has been written yet. It tells you which of those it is before you confirm.",
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["Copy all", "Puts everything in the box on the clipboard."],
        ["Save .txt", "Writes the box to its file now. Use it after editing. With Save after every run on, you rarely need it."],
        ["Clear", "Empties the box and starts a new file. Asks first."],
        ["Folder", "Opens the save folder. The window can appear behind the browser."],
      ],
    },
    {
      heading: "Settings",
      body: "The gear on the node, or right-click it.",
      defs: [
        ["Folder", "Empty means ComfyUI's output folder. For anywhere else, click Browse and pick it once - that is what approves it."],
        ["File name", "Always saved as .txt. %counter% keeps the numbering going so a new collection never overwrites an old one."],
        ["Save after every run", "On by default. A save you have to remember is a save you forget."],
        ["Separator", "A blank line by default. Prompt Pack Pixaroma offers these same three under the same names, so a saved file drops straight into it - just pick the matching one there. Entries are split on whatever you pick, so if your prompts contain blank lines of their own, choose --- line instead or one prompt will be counted as several."],
        ["New entry goes", "At the top puts the newest prompt where you can read it without scrolling."],
        ["Skip repeats", "A second belt. The node already ignores a run where nothing changed, so this is for the case that slips past it: reopening a workflow, where the first run afterwards would otherwise re-add the prompt that is already last. Same as last is the default; Any repeat also catches a prompt you used earlier in the session."],
        ["Timestamp each entry", "Adds a # comment line above each one. Leave it off if you plan to paste the file back into Prompt Pack: the date is stored inside the entry, so it travels with the prompt, and with the New line separator it counts as a prompt of its own."],
        ["Start a new file after", "Stops one workflow growing an enormous collection inside its own file."],
      ],
    },
    {
      heading: "Good to know",
      bullets: [
        "Collecting happens while the workflow is open in a browser. A run started from the API passes the text through but writes no file.",
        "Run the same prompt twice and nothing is added the second time. ComfyUI does not re-run a node whose input has not changed, and the node ignores the replayed result, so there is nothing new to collect.",
        "Files are only ever written as .txt, wherever you point it.",
        "To run your collected prompts again: open the .txt, copy it, paste it into Prompt Pack Pixaroma with its Replace button, and press the button with the same name as the Separator you chose here. It queues one run per prompt.",
      ],
    },
  ],
});
