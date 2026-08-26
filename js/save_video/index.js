// Save Video Pixaroma - node wiring.
//
// Save Image Pixaroma's face married to Save Mp4's player. State lives on
// node.properties.saveVideoState and is injected into the hidden SaveVideoState
// input at graphToPrompt time (Vue Compat #9).
//
// Save Mp4 is untouched and stays the quick one; this is the full one.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import {
  applyAdaptiveCanvasOnly,
  isVueNodes,
  installResizeFloor,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeSettings, installNodeAccent } from "../shared/node_settings.mjs";
import { applyFilenameTokenRefs } from "../shared/filename_tokens.mjs";
import {
  COMFY_CLASS,
  HIDDEN_INPUT_NAME,
  STATE_PROP,
  LAST_RUN_PROP,
  DEFAULT_STATE,
  FORMATS,
  formatDef,
  visibleFormats,
  formatDuration,
  readState,
  writeState,
  normalizePath,
  resolveDateTokens,
  expandNativeTokens,
  cleanInputName,
  sanitizePrefixMirror,
} from "./state.mjs";
import { injectCSS, buildRoot, el } from "./ui.mjs";
import { buildPlayer, applyVideoEntry, showClipMissing, refreshBar, getLive, buildVideoUrl } from "./player.mjs";
import { openSettingsPanel, closeSettingsPanelFor } from "./settings.mjs";

// User-measured: 474 wide keeps the button row (3 actions + 2 pill groups) on
// one line, matching Save Image so the pair looks like a pair.
const MIN_W = 474;
const DEFAULT_W = 474;
const DEFAULT_H = 700;
const PLAYER_MIN = 150;

// ── node body FLOOR (fill model: the player grows with the node) ─────────────
// NO custom computeSize and no getMaxHeight, so the player absorbs all free
// height in both renderers and the node can still shrink. The player is counted
// at its MINIMUM rather than its grown height (Load Image's count-at-min trick),
// or the node could never be dragged smaller once a video loaded.
//
// TWO states LIE and must not be measured at all, both inherited from Save
// Image, which measured them and paid for it:
//  - root not laid out or unmounted -> every offsetHeight reads 0. That happens
//    before the widget is first attached, and in an inactive workflow tab (whose
//    nodes stay in the DOM at display:none). NOTE: this node sets
//    hideOnZoom:false, so a zoom-out is NOT one of those cases any more - do not
//    read this comment as a reason the guard is unnecessary.
//  - root with NO REAL WIDTH -> the button row wraps and the sum explodes. This
//    is the only mechanism found that can reach ~1800, and it is exactly what
//    was measured here before this guard existed: a round trip through
//    loadGraphData brought a saved 474x700 node back as 474x2030.
// In those states reuse the last good reading rather than inventing one.
//
// FLOOR_CAP makes an inflated value unreachable for EVERY consumer (getMinHeight,
// computeLayoutSize, the resize-floor pin) without having to know which fitter
// misfired. Safe by construction: the clamp can only LOWER the floor, and the
// floor reaches node.size only through grow-only paths, so it can never grow a
// node or rewrite a clean saved size.
//
// ⚠️ The width guard is deliberately a SMALL ABSOLUTE number, not something
// derived from MIN_W. MEASURED: in Nodes 2.0 the DOM-widget root is NARROWER
// than the node (a 474-wide node gives a 353-wide root, because the Vue body has
// its own chrome), so a `clientWidth < MIN_W - 40` test was true FOREVER there -
// measureFloor never measured, always returned the 320 cache, and the flex:1
// player collapsed to a 0x0 video with the control bar still showing. The cap
// below is what actually stops the runaway; this guard only has to reject a root
// that is not laid out at all.
const FLOOR_CAP = DEFAULT_H;
const MEASURABLE_MIN_W = 120;
function measureFloor(ui) {
  const inner = ui?.inner;
  if (!inner) return 320;
  const root = ui.root;
  if (!root || !root.isConnected || root.clientWidth < MEASURABLE_MIN_W) {
    return ui._pixSvFloorCache || 320;
  }
  let h = 0;
  let n = 0;
  for (const ch of inner.children) {
    let oh = ch.offsetHeight;
    if (oh <= 0) continue;
    if (ch === ui.savedSec) {
      // count the PLAYER at its minimum, not its grown height
      oh = oh - (ui.stage ? ui.stage.offsetHeight : 0) + PLAYER_MIN;
    }
    h += oh;
    n++;
  }
  if (n === 0) return ui._pixSvFloorCache || 320; // pre-attach placeholder
  h += 16; // inner vertical padding (8 + 8)
  h += (n - 1) * 10; // flex gaps
  const out = Math.min(Math.max(200, h), FLOOR_CAP);
  ui._pixSvFloorCache = out;
  return out;
}

const floorOf = (ui) => Math.round(measureFloor(ui) / 4) * 4;

// ── the live "Will save as" line ─────────────────────────────────────────────
function fpsOf(node) {
  const w = node.widgets?.find((x) => x.name === "fps");
  const v = parseFloat(w?.value);
  return isFinite(v) && v > 0 ? Math.max(1, Math.round(v)) : 24;
}

// The wired `name` input, resolved best-effort for the DISPLAY only - Python
// recomputes everything at save time, so a stale preview can never misname a
// file. `node.graph || app.graph` because app.graph holds only TOP-LEVEL nodes
// and this node may live inside a subgraph.
function resolveWiredName(node) {
  try {
    const slot = node.inputs?.find((i) => i.name === "name");
    if (!slot || slot.link == null) return "";
    const graph = node.graph || app.graph;
    let link = graph?.links?.[slot.link];
    if (!link && typeof graph?.links?.get === "function") link = graph.links.get(slot.link);
    if (!link) return "";
    const src = graph.getNodeById?.(link.origin_id);
    if (!src) return "";
    const w = src.widgets?.find((x) => typeof x.value === "string" && x.value);
    return cleanInputName(w?.value || "");
  } catch {
    return "";
  }
}

function cntKey(folder, name, digits) {
  // \x00 as a JS ESCAPE, never a raw control byte: a raw NUL makes ripgrep treat
  // the whole file as binary, so every future grep silently skips it - and the
  // Read tool still shows clean text, which hides it (save-image pattern #13h).
  return [folder || "", name || "", String(digits)].join("\x00");
}

function scheduleCounterFetch(node, folderRaw, nameWithExt, digits) {
  const key = cntKey(folderRaw, nameWithExt, digits);
  if (node._pixSvCntKey === key) return; // already fetched or in flight
  node._pixSvCntKey = key;
  clearTimeout(node._pixSvCntTimer);
  node._pixSvCntTimer = setTimeout(async () => {
    try {
      // Save Image's route, reused unchanged: it is generic over
      // folder/name/digits, so a second identical route would be pure
      // duplication. It mirrors the save-time folder-counter order too.
      const r = await fetch(
        pixApiUrl(
          "/pixaroma/api/save_image/next_counter?folder=" + encodeURIComponent(folderRaw) +
          "&name=" + encodeURIComponent(nameWithExt) +
          "&digits=" + encodeURIComponent(digits)
        )
      );
      const j = await r.json();
      if (node._pixSvCntKey !== key || !node._pixSvUI) return; // superseded
      node._pixSvCounterNum = (j && j.counter) || 1;
      node._pixSvCntResolved = (j && j.resolved) || "";
      node._pixSvCntResolvedFor = key;
      node._pixSvCntDenied = !!(j && j.denied);
      updatePreview(node);
    } catch {}
  }, 350);
}

function updatePreview(node) {
  const ui = node._pixSvUI;
  if (!ui) return;
  const st = readState(node);
  let s = String(st.pattern || DEFAULT_STATE.pattern);
  // function replacement so a wired name containing "$" patterns ($&, $$) is
  // inserted literally (JS string replacements interpret those)
  const wired = resolveWiredName(node);
  s = s.replace(/%input%/g, () => wired);
  s = resolveDateTokens(s);
  s = expandNativeTokens(s);
  s = applyFilenameTokenRefs(s); // %Seed Pixaroma.seed% and friends
  // fps is a live widget, so it can always resolve. frames and duration need
  // the batch size, which is only known after a run - before that they stay
  // visibly literal, exactly as %width% and %height% already do.
  s = s.replace(/%fps%/g, String(fpsOf(node)));
  const last = node._pixSvLastDims;
  if (last) {
    s = s
      .replace(/%width%/g, String(last.w))
      .replace(/%height%/g, String(last.h))
      .replace(/%frames%/g, String(last.frames))
      .replace(/%duration%/g, formatDuration(last.frames, fpsOf(node)));
  }
  // NO %batch_num% here: that token is a Save Image thing (one file per frame).
  // A video is ONE file, and node_save_video.py never resolves it - expanding it
  // in the preview only would promise a name the node will not write.
  // Shared mirror of the Python sanitizer, with this node's own fallback.
  s = sanitizePrefixMirror(s);
  if (!s) s = "Video_%counter%";

  const ext = formatDef(st.format).ext;
  const digits = Math.max(1, Math.min(8, parseInt(st.counterDigits, 10) || 3));
  scheduleCounterFetch(node, st.folder || "", s + ext, digits);
  let rel;
  if (node._pixSvCntResolved && node._pixSvCntResolvedFor === cntKey(st.folder || "", s + ext, digits)) {
    rel = node._pixSvCntResolved; // server-resolved (folder %counter% too)
  } else {
    const padded = String(node._pixSvCounterNum || 1).padStart(digits, "0");
    rel = s.replace(/%counter%/g, padded) + ext;
  }
  const folder = st.folder ? normalizePath(st.folder) : "";
  const display =
    (folder ? folder.replace(/\//g, "\\") : "…\\ComfyUI\\output") +
    "\\" +
    rel.split("/").filter(Boolean).join("\\");

  if (node._pixSvCntDenied && node._pixSvCntResolvedFor === cntKey(st.folder || "", s + ext, digits)) {
    ui.prevPath.textContent = "This folder is not approved - click Browse and pick it once";
    ui.prevPath.style.color = "#f66744";
    ui.prevPath.title =
      "Pixaroma only writes to ComfyUI's own folders and to folders you picked with " +
      "the Browse button. Pick this one once and it stays approved.";
  } else {
    ui.prevPath.textContent = display;
    ui.prevPath.style.color = "";
    ui.prevPath.title = display;
  }
}

// ── face sync ────────────────────────────────────────────────────────────────
function applyButtonVisibility(node) {
  const ui = node._pixSvUI;
  if (!ui) return;
  const st = readState(node);
  ui.btnOpen.style.display = st.showOpen === false ? "none" : "";
  ui.btnDownload.style.display = st.showDownload === false ? "none" : "";
  ui.btnFolder.style.display = st.showFolder === false ? "none" : "";
  const vis = visibleFormats(st);
  const active = formatDef(st.format);
  // Correct the STATE before painting, or hiding the active format leaves its
  // button on the face, unlit, until something else re-runs syncFace. The write
  // is the one thing in this DOM-only function that touches serialized state, so
  // it is gated on isGraphLoading (Vue Compat #18) - a workflow that arrives
  // with a hidden active format keeps it.
  if (!vis.some((v) => v.id === active.id) && !isGraphLoading()) {
    st.format = vis[0].id;
    writeState(node, st);
  }
  const activeId = formatDef(readState(node).format).id;
  let shown = 0;
  for (const f of FORMATS) {
    // the ACTIVE format's pill is always shown even when switched off, or
    // nothing on the face would say what you are saving as
    const on = st[f.key] !== false || f.id === activeId;
    ui.fmtBtns[f.id].style.display = on ? "" : "none";
    if (on) shown++;
  }
  // a one-option choice is not a choice - hide the whole group, the format is
  // still visible in the "Will save as" extension. Counts what is ACTUALLY on
  // screen, not the setting, or a forced-visible pill sits in a hidden group.
  ui.segFmt.style.display = shown > 1 ? "" : "none";
}

function syncFace(node) {
  const ui = node._pixSvUI;
  if (!ui) return;
  const st = readState(node);
  if (document.activeElement !== ui.folderInput) ui.folderInput.value = st.folder || "";
  if (document.activeElement !== ui.patternInput) ui.patternInput.value = st.pattern || "";
  const activeId = formatDef(st.format).id;
  for (const f of FORMATS) ui.fmtBtns[f.id].classList.toggle("on", f.id === activeId);
  ui.modeSave.classList.toggle("on", st.saveOnRun !== false);
  ui.modePreview.classList.toggle("on", st.saveOnRun === false);
  applyButtonVisibility(node);
  updateInfoLine(node);
}

function updateInfoLine(node) {
  const ui = node._pixSvUI;
  if (!ui) return;
  if (node._pixSvFlash) return;
  const s = node._pixSvSummary;
  ui.infoLine.textContent = s || "";
  ui.infoLine.title = node._pixSvFolderShown || "";
}

function flashStatus(node, text, ms = 2200) {
  const ui = node._pixSvUI;
  if (!ui) return;
  node._pixSvFlash = true;
  ui.infoLine.textContent = text;
  clearTimeout(node._pixSvFlashTimer);
  node._pixSvFlashTimer = setTimeout(() => {
    node._pixSvFlash = false;
    updateInfoLine(node);
  }, ms);
}

// ── fold ─────────────────────────────────────────────────────────────────────
// The height of the block that folding hides, measured from the LAYOUT (offsetTop
// is layout px, so this is zoom-immune in both renderers).
function settingsBlockH(ui) {
  if (!ui?.savedSec?.isConnected) return 0;
  const top = ui.topbar.offsetTop + ui.topbar.offsetHeight;
  return Math.max(0, ui.savedSec.offsetTop - top);
}

function setFoldDisplay(node, folded) {
  const ui = node._pixSvUI;
  const st = readState(node);
  const hideBar = folded && st.hideBarWhenFolded;
  ui.secFolder.style.display = folded ? "none" : "";
  ui.secName.style.display = folded ? "none" : "";
  ui.secBtns.style.display = hideBar ? "none" : "";
}

// DIRTY-ON-LOAD DISCIPLINE: with allowResize false this sets DOM display and the
// icon ONLY - it NEVER calls setSize or writeState. The resize happens only on a
// genuine user action, and even then is gated on isGraphLoading (Vue Compat #18).
function applyFold(node, allowResize) {
  const ui = node._pixSvUI;
  // `if (!ui)`, NOT `!ui.inner.isConnected`. On the LOAD path this runs from a
  // microtask while the DOM widget is not mounted yet, so an isConnected guard
  // made the fold restore a silent no-op with no retry: a node saved FOLDED came
  // back UNFOLDED at its folded height, so `overflow:hidden` clipped the player
  // and the info line, and the first click of the fold triangle then did nothing
  // (state and display already disagreed). REPRODUCED: 457px of content in a
  // 360px box. Setting style.display on a detached element is fine - it persists
  // when the element mounts.
  if (!ui) return;
  const st = readState(node);
  const folded = !!st.folded;
  const wasHidden = ui.secFolder.style.display === "none";
  const wasBarHidden = ui.secBtns.style.display === "none";
  const willBarHide = folded && !!st.hideBarWhenFolded;
  // Measure BEFORE the display flip, and only when we may actually resize - on
  // the load path the widget is unmounted and the measurement is meaningless.
  const before = allowResize ? settingsBlockH(ui) : 0;
  setFoldDisplay(node, folded);
  ui.foldBtn.classList.toggle("folded", folded);
  ui.foldBtn.title = folded ? "Open the node back up" : "Fold the node down to just the video";
  // Count the TOOLBAR flip too, or toggling "hide the toolbar when folded" on an
  // already-folded node re-shows the button row without giving it any height,
  // and the bottom of the player is clipped.
  const changing = wasHidden !== folded || wasBarHidden !== willBarHide;
  if (allowResize && changing && !isGraphLoading()) {
    const after = settingsBlockH(ui);
    const delta = before - after;
    if (delta && node.setSize) {
      node.setSize([node.size[0], Math.max(120, node.size[1] - delta)]);
    }
    node.setDirtyCanvas?.(true, true);
  }
}

// ── run results ──────────────────────────────────────────────────────────────
// Which entry in a node's ui payload is our clip? Prefer our own key, then fall
// back to the standard `images` list, which carries the SAME entry when the save
// landed inside ComfyUI's folders. The fallback is what makes the player survive
// a HOST that relays only the ui keys it recognises and drops custom ones - there
// the file saves fine and the player just stays black, because the browser is
// never told the filename (save-mp4 pattern #9). Do NOT simplify this to one key.
function pickEntry(output) {
  const own = output?.pixaroma_save_video;
  if (own?.length) return own[0];
  const imgs = output?.images;
  if (!imgs?.length) return null;
  return imgs.find((e) => /^video\//.test(e?.format || "") || /\.mp4$/i.test(e?.filename || "")) || null;
}

// Rebuild the runtime fields the face reads from a run's status. Split out of
// commitEntry because restoreLastRun needs the SAME work after a rebuild:
// node._xxx fields are torn down by a workflow-tab switch while
// node.properties survives, so without this the video came back and its caption
// did not. Worse than cosmetic - `_pixSvLastDims` is also what resolves
// %frames%, %duration%, %width% and %height% in the live filename line, so
// losing it made those tokens go back to being spelled out on a node that had
// definitely run. Found by measuring the face after a rebuild, 2026-08-10.
//
// READ-ONLY with respect to serialized state, so it is safe on the load path.
function applyStatus(node, st) {
  if (!st) return;
  node._pixSvLastDims = { w: st.w, h: st.h, frames: st.frames };
  node._pixSvFolderShown = st.folder || "";
  const bits = [`${st.w}x${st.h}`, `${st.frames} frames`, `${st.duration}s`];
  if (st.depth) bits.push(st.depth);
  bits.push(st.saved_to_disk ? "saved" : "preview only, not written to your folder");
  node._pixSvSummary = bits.join(" · ");
  if (st.note) node._pixSvSummary += ` · ${st.note}`;
}

function commitEntry(node, entry) {
  if (!node || !entry?.filename) return;
  node.properties = node.properties || {};
  const st = entry._pixaroma_status;
  node.properties[LAST_RUN_PROP] = {
    filename: entry.filename,
    subfolder: entry.subfolder || "",
    type: entry.type || "output",
    token: entry.token || "",
    // persisted so the caption and the resolved tokens survive a tab switch,
    // exactly as Save Image keeps its status inside pixSiLastRun
    status: st || null,
  };
  if (st) {
    applyStatus(node, st);
    node._pixSvCntKey = null; // let the counter advance after a run
    updateInfoLine(node);
    updatePreview(node);
  }
  applyVideoEntry(node, entry);
}

// Restore after a Vue rebuild (workflow-tab switch). The clip is persisted on
// node.properties because a runtime node._xxx field is torn down by the switch.
// On a fresh add the <video> is not mounted yet when onNodeCreated/onConfigure
// run, so retry on animation frames until it exists.
function restoreLastRun(node, tries = 0) {
  if (tries === 0) {
    if (node._pixSvRestoring) return; // serialise the two kicks
    node._pixSvRestoring = true;
  }
  if (getLive(node)) {
    node._pixSvRestoring = false;
    const entry = node.properties?.[LAST_RUN_PROP];
    if (entry?.filename) {
      // the caption and the resolved %frames% / %duration% / %width% / %height%
      // come back with the clip, not just the picture
      applyStatus(node, entry.status);
      updateInfoLine(node);
      updatePreview(node);
      applyVideoEntry(node, entry);
    } else refreshBar(node);
    return;
  }
  if (tries > 60) {
    node._pixSvRestoring = false;
    return;
  }
  requestAnimationFrame(() => restoreLastRun(node, tries + 1));
}

// ── wiring ───────────────────────────────────────────────────────────────────
const CHIPS = [
  ["+ Input name", "%input%"],
  ["+ Date", null], // uses the dateStyle setting
  ["+ Time", "%date:hh-mm-ss%"],
  ["+ Counter", "%counter%"],
  ["+ Seed", null], // resolved to a %Node.widget% reference below
  ["+ Width", "%width%"],
  ["+ Height", "%height%"],
  ["+ Fps", "%fps%"],
  ["+ Duration", "%duration%"],
  ["+ Frames", "%frames%"],
];

function insertToken(node, token) {
  const ui = node._pixSvUI;
  const inp = ui.patternInput;
  const st = readState(node);
  const start = inp.selectionStart ?? inp.value.length;
  const end = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, start) + token + inp.value.slice(end);
  const caret = start + token.length;
  inp.setSelectionRange(caret, caret);
  st.pattern = inp.value;
  writeState(node, st);
  updatePreview(node);
  inp.focus();
}

function wireEvents(node, ui) {
  ui.folderInput.addEventListener("input", () => {
    const st = readState(node);
    st.folder = ui.folderInput.value;
    writeState(node, st);
    updatePreview(node);
  });
  ui.patternInput.addEventListener("input", () => {
    const st = readState(node);
    st.pattern = ui.patternInput.value;
    writeState(node, st);
    updatePreview(node);
  });

  // chips
  for (const [label, token] of CHIPS) {
    const chip = el("button", "pix-sv-chip", label);
    chip.type = "button";
    chip.onclick = () => {
      const st = readState(node);
      if (label === "+ Date") insertToken(node, `%date:${st.dateStyle || "yyyy-MM-dd"}%`);
      else if (label === "+ Seed") insertToken(node, "%Seed Pixaroma.seed%");
      else insertToken(node, token);
    };
    ui.chipsWrap.appendChild(chip);
  }
  // the two folder chips PREPEND, at the FRONT, rather than at the caret
  for (const [label, mk, title] of [
    ["+ Date folder", (st) => `%date:${st.dateStyle || "yyyy-MM-dd"}%/`,
      "Put every video in a folder named after today's date"],
    ["+ Input folder", () => "%input%/",
      "Put every video in a folder named after the wired name input"],
  ]) {
    const chip = el("button", "pix-sv-chip", label);
    chip.type = "button";
    chip.title = title;
    chip.onclick = () => {
      const st = readState(node);
      const seg = mk(st);
      if (!st.pattern.startsWith(seg)) {
        st.pattern = seg + st.pattern;
        writeState(node, st);
        ui.patternInput.value = st.pattern;
        updatePreview(node);
      }
    };
    ui.chipsWrap.appendChild(chip);
  }
  const clearChip = el("button", "pix-sv-chip", "✕ Clear");
  clearChip.type = "button";
  clearChip.title = "Empty the filename box";
  clearChip.onclick = () => {
    const st = readState(node);
    st.pattern = "";
    writeState(node, st);
    ui.patternInput.value = "";
    updatePreview(node);
  };
  ui.chipsWrap.appendChild(clearChip);
  const resetChip = el("button", "pix-sv-chip", "↺ Reset");
  resetChip.type = "button";
  resetChip.title = "Back to the default filename";
  resetChip.onclick = () => {
    const st = readState(node);
    st.pattern = DEFAULT_STATE.pattern;
    writeState(node, st);
    ui.patternInput.value = st.pattern;
    updatePreview(node);
  };
  ui.chipsWrap.appendChild(resetChip);

  // format + mode pills
  for (const f of FORMATS) {
    ui.fmtBtns[f.id].onclick = () => {
      const st = readState(node);
      st.format = f.id;
      writeState(node, st);
      syncFace(node);
      updatePreview(node);
    };
  }
  ui.modeSave.onclick = () => {
    const st = readState(node);
    st.saveOnRun = true;
    writeState(node, st);
    syncFace(node);
  };
  ui.modePreview.onclick = () => {
    const st = readState(node);
    st.saveOnRun = false;
    writeState(node, st);
    syncFace(node);
  };

  // fold + gear
  ui.foldBtn.onclick = () => {
    const st = readState(node);
    st.folded = !st.folded;
    writeState(node, st);
    applyFold(node, true);
  };
  ui.gearBtn.onclick = (e) => {
    e.stopPropagation();
    openSaveVideoPanel(node);
  };
  ui.gearBtn.addEventListener("pointerdown", (e) => e.stopPropagation());

  // Browse: the Load Images from Folder native-dialog route, which is generic -
  // it just pops the OS picker and hands back a path.
  ui.browseBtn.addEventListener("click", async () => {
    ui.browseLbl.textContent = "…";
    let res;
    try {
      const r = await fetch(
        pixApiUrl(`/pixaroma/api/load_images_folder/pick_native?path=${encodeURIComponent(readState(node).folder || "")}`)
      );
      res = await r.json();
    } catch (e) {
      res = { ok: false, message: String(e) };
    }
    ui.browseLbl.textContent = "Browse";
    if (res?.ok && res.path) {
      const st = readState(node);
      st.folder = normalizePath(res.path);
      writeState(node, st);
      ui.folderInput.value = st.folder;
      node._pixSvCntKey = null;
      updatePreview(node);
    } else if (!res?.cancelled) {
      flashStatus(node, "Folder dialog unavailable - paste the path instead", 3200);
    }
  });

  // Both buttons refuse a clip the player has already reported as unreachable.
  // Without this they contradicted the message sitting right above them: Open
  // put a raw 404 page in a new tab and Download produced an empty file, on a
  // node that had just said "cannot reach that video any more".
  const clipOrWarn = () => {
    const entry = node.properties?.[LAST_RUN_PROP];
    if (!entry?.filename) {
      flashStatus(node, "Run the workflow first");
      return null;
    }
    if (node._pixSvFailed) {
      flashStatus(node, "That video is not reachable any more - run again to make a new one", 3200);
      return null;
    }
    return entry;
  };

  ui.btnOpen.addEventListener("click", () => {
    const entry = clipOrWarn();
    if (!entry) return;
    window.open(buildVideoUrl(entry), "_blank");
  });

  ui.btnDownload.addEventListener("click", () => {
    const entry = clipOrWarn();
    if (!entry) return;
    const a = document.createElement("a");
    a.href = buildVideoUrl(entry);
    a.download = entry.filename.split("/").pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  ui.btnFolder.addEventListener("click", async () => {
    try {
      const r = await fetch(pixApiUrl("/pixaroma/api/save_image/open_folder"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: readState(node).folder || "" }),
      });
      const j = await r.json();
      if (!j?.ok) flashStatus(node, j?.message || "Could not open the folder", 3200);
    } catch {
      flashStatus(node, "Could not open the folder", 3200);
    }
  });
}

// ── state injection ──────────────────────────────────────────────────────────
// Walk the LIVE graph, descending into subgraphs. The serialized
// `result.workflow.nodes` holds only TOP-LEVEL nodes - a node inside a subgraph
// lives under workflow.definitions.subgraphs[] and its prompt key is
// "<containerId>:<innerId>". Reading the flat list therefore injected NOTHING
// for a node in a subgraph, so Python fell back to DEFAULT_STATE: the video
// went to output/ instead of the user's folder, in 8-bit instead of HQ, and -
// worst - saveOnRun defaults to true, so it was WRITTEN TO DISK even with
// Preview mode showing on the face. Same shape as Save Image's collectNodes.
function collectNodes(graph, out) {
  if (!graph) return;
  const nodes = graph._nodes || graph.nodes || [];
  for (const n of nodes) {
    if (n?.comfyClass === COMFY_CLASS) out.push(n);
    const inner = n?.subgraph || n?.graph || n?._graph;
    if (inner && inner !== graph) collectNodes(inner, out);
  }
}

function matchNode(nodes, promptId) {
  let n = nodes.find((x) => String(x.id) === String(promptId));
  if (n) return n;
  const tail = String(promptId).split(":").pop();
  return nodes.find((x) => String(x.id) === tail) || null;
}

function injectState(result) {
  const out = result?.output;
  if (!out) return;
  const svNodes = [];
  collectNodes(app.graph?.rootGraph || app.graph, svNodes);
  if (!svNodes.length) return;
  for (const id of Object.keys(out)) {
    if (out[id]?.class_type !== COMFY_CLASS) continue;
    const n = matchNode(svNodes, id);
    if (!n) continue;
    out[id].inputs = out[id].inputs || {};
    let raw = n.properties?.[STATE_PROP];
    if (typeof raw !== "string" || !raw) raw = JSON.stringify(DEFAULT_STATE);
    // Resolve %NodeName.widget% references (e.g. %Seed Pixaroma.seed%) HERE, at
    // submit time, so the value baked in is the one this run uses.
    try {
      const st = JSON.parse(raw);
      if (typeof st.pattern === "string") {
        st.pattern = applyFilenameTokenRefs(st.pattern);
        raw = JSON.stringify(st);
      }
    } catch {}
    out[id].inputs[HIDDEN_INPUT_NAME] = raw;
  }
}

function installGraphToPromptHook() {
  if (app._pixSvGraphPatched) return;
  app._pixSvGraphPatched = true;
  const orig = app.graphToPrompt.bind(app);
  app.graphToPrompt = async function (...args) {
    const result = await orig(...args);
    try {
      injectState(result);
    } catch (e) {
      console.warn("[SaveVideo] graphToPrompt inject failed", e);
    }
    return result;
  };
}

// BOTH result-delivery paths (save-mp4 pattern #9): the global socket event AND
// ComfyUI's standard per-node hook. A host whose frontend hands results to nodes
// itself, instead of re-broadcasting the raw socket event, only reaches
// onExecuted. commitEntry is idempotent, so a host that fires both just
// re-applies the same clip.
function installExecutedListener() {
  if (app._pixSvExecPatched) return;
  app._pixSvExecPatched = true;
  api.addEventListener("executed", ({ detail }) => {
    const id = detail?.node;
    if (id == null) return;
    const graph = app.graph;
    const node = graph?.getNodeById?.(id) ?? graph?.getNodeById?.(parseInt(id, 10));
    // The gate that makes the `images` fallback safe: without it, a clip
    // reported by ANYONE else's node could match.
    if (!node || node.comfyClass !== COMFY_CLASS) return;
    const entry = pickEntry(detail?.output);
    if (entry) commitEntry(node, entry);
  });
}

function openSaveVideoPanel(node) {
  openSettingsPanel(node, () => {
    syncFace(node);
    updatePreview(node);
    applyFold(node, true);
  });
}

// ── extension ────────────────────────────────────────────────────────────────
app.registerExtension({
  name: "Pixaroma.SaveVideo",

  setup() {
    installGraphToPromptHook();
    installExecutedListener();
  },

  getNodeMenuItems(node) {
    if (!node || node.comfyClass !== COMFY_CLASS) return [];
    return [
      null,
      { content: "⚙ Save Video settings", callback: () => openSaveVideoPanel(node) },
      {
        content: "↺ Reset node size",
        callback: () => {
          const st = readState(node);
          if (st.folded) {
            st.folded = false;
            writeState(node, st);
            applyFold(node, false);
          }
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
    if (nodeType._pixSvPatched) return;
    nodeType._pixSvPatched = true;

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
        if (!this._pixSvUI) return;
        syncFace(this);
        updatePreview(this);
        restoreLastRun(this);
        applyFold(this, false); // display only; never resizes on load
      });
      return r;
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = origDraw?.apply(this, arguments);
      // The isGraphLoading gate is NOT optional (convention #7): node.size is
      // serialized and a draw hook runs on the very FIRST frame of a load,
      // earlier than any other clamp - so an ungated clamp is the one place that
      // can rewrite node.size on a clean open and flag an untouched workflow
      // modified. Nodes 2.0 has no live width clamp, so a node genuinely can be
      // saved narrower than MIN_W.
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return r;
    };

    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const r = origResize?.apply(this, arguments);
      // Gated the same way: onResize is NOT only a user drag - it also fires
      // from fit-to-content, the right-click Resize menu, node creation and
      // workflow restore.
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return r;
    };

    // The live "Will save as" line reads the WIRED name, so it has to refresh
    // when that wire changes - otherwise a pattern using %input% keeps showing
    // the old name until something else happens to redraw it. Runtime-only
    // (updatePreview writes no serialized state), so it is safe against the
    // configure replay that fires this for every slot on load.
    const origConnChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index, connected, link, ioSlot) {
      const r = origConnChange?.apply(this, arguments);
      if (ioSlot?.name === "name" || this.inputs?.[index]?.name === "name") {
        queueMicrotask(() => {
          if (this._pixSvUI) updatePreview(this);
        });
      }
      return r;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        closeSettingsPanelFor(this);
        this._pixSvFloorOff?.();
        this._pixSvEndDrag?.(); // release any window listeners the scrub added
        clearTimeout(this._pixSvCntTimer);
        clearTimeout(this._pixSvFlashTimer);
        // so the `!node._pixSvUI` bails elsewhere can actually fire for a
        // removed node instead of writing into a detached DOM tree
        this._pixSvUI = null;
      } catch {}
      return origRemoved?.apply(this, arguments);
    };
  },
});

function setupNode(node) {
  injectCSS();
  // ui.images is emitted so the Assets panel refreshes, but an mp4 is not an
  // image - stop ComfyUI painting its own preview panel underneath ours.
  //
  // BOTH halves are needed, and this node shipped with only the second one.
  // hideOutputImages is the OFFICIAL flag and the only thing that reaches the
  // NODES 2.0 panel: that panel is fed by ComfyUI's internal node-preview state,
  // NOT by node.imgs, so the defineProperty lock below covers Classic alone
  // (the Prompt Reader pattern says the same). The .image-preview CSS rule in
  // ui.mjs was carrying Nodes 2.0 on its own and does not, on frontend 1.49.6.
  //
  // MEASURED with it missing: the native panel renders as a SIBLING of our
  // widget column inside the node content flex, so it takes ~390px away from a
  // column that is asking for all of it - node 940, content 912, widget column
  // 416 - which squeezed our body until overflow:hidden clipped the player and
  // the button row. It appeared ONLY after a run (nothing emits ui.images
  // before one) and vanished on reload (the clip is restored from
  // pixSvLastRun, not from a ui payload), which is exactly the "fine on reload,
  // broken after a run" shape that was reported. Save Mp4, Save Image, Preview
  // Image and Compare have always set it.
  node.hideOutputImages = true;
  try {
    Object.defineProperty(node, "imgs", {
      configurable: true,
      get() { return []; },
      set() {},
    });
  } catch {}

  const ui = buildRoot();
  node._pixSvUI = ui;
  node._pixSvRoot = ui.root;
  const player = buildPlayer(node);
  ui.stage.appendChild(player.media);
  ui.stage.appendChild(player.bar);
  Object.assign(node._pixSvUI, ui); // keep the face refs alongside the player's

  installCanvasZoomPassthrough(ui.root);
  installNodeAccent(node, ui.root);

  // The DOM widget is added AFTER the native `fps` widget, and must stay that
  // way: save and load index widgets_values DIFFERENTLY, and a serialize:false
  // widget placed BEFORE a native one leaves a hole on save that the sequential
  // load walks straight past, shifting every value (Vue Compat #23).
  const widget = node.addDOMWidget("pixaroma_save_video", "pixaroma_save_video", ui.root, {
    getValue: () => null,
    setValue: () => {},
    // FLOOR only: no getMaxHeight and no custom computeSize, so the player
    // absorbs all free height in both renderers. Coarse-rounded so font and
    // sub-pixel jitter cannot creep node.size bigger on every load.
    getMinHeight: () => floorOf(ui),
    serialize: false,
    // Every other media widget in the pack sets this (Save Mp4, Load Video,
    // Load Video Frame, Compare, Preview), and so does core's own VIDEO widget.
    // With the default true, once the canvas drops below the low-quality zoom
    // threshold the widget paints a grey placeholder rectangle instead of the
    // player, so this node alone would go blank-grey at low zoom while every
    // sibling player keeps showing its picture.
    hideOnZoom: false,
  });
  applyAdaptiveCanvasOnly(widget);
  node._pixSvWidget = widget;
  // UNCONDITIONAL, never behind isVueNodes(): the renderer can be switched under
  // a live node, and a one-time check in onNodeCreated does not survive that. A
  // node built in Classic would otherwise keep the DOMWidget PROTOTYPE's version,
  // which reports minWidth 0 instead of our 1 (Save Text pattern #11, and the
  // same rule Save Text and Save Mp4 already follow).
  //
  // MEASURED on frontend 1.49.6 before removing the gate: the difference is inert
  // here. computeSize() returned an identical [210, h] for minWidth 0, 1 and the
  // prototype's own answer, a live Classic -> Nodes 2.0 flip kept every width
  // (474/518 stored AND rendered), and node.serialize() round-tripped exactly. So
  // this is consistency with the documented recipe, NOT a fix for an observed
  // break - do not re-add the gate on the grounds that nothing visibly changed.
  widget.computeLayoutSize = () => ({ minHeight: floorOf(ui), minWidth: 1 });

  wireEvents(node, ui);
  try {
    node._pixSvFloorOff = installResizeFloor(ui.root, () => measureFloor(ui));
  } catch {}

  // Default size on a FRESH drop only; configure() restores saved sizes.
  const fresh = !isGraphLoading();
  if (!node.size) node.size = [DEFAULT_W, DEFAULT_H];
  if (fresh) {
    node.size[0] = DEFAULT_W;
    if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
  }
  const snapFresh = () => {
    if (!node._pixSvUI) return;
    if (Math.abs(node.size[0] - DEFAULT_W) > 1 || Math.abs(node.size[1] - DEFAULT_H) > 1) {
      if (node.setSize) node.setSize([DEFAULT_W, DEFAULT_H]);
      else {
        node.size[0] = DEFAULT_W;
        node.size[1] = DEFAULT_H;
      }
      node.setDirtyCanvas?.(true, true);
    }
  };

  // deferred so configure()'s restored state lands first (Vue Compat #8)
  queueMicrotask(() => {
    syncFace(node);
    updatePreview(node);
    restoreLastRun(node);
    applyFold(node, false);
    if (fresh) {
      snapFresh();
      requestAnimationFrame(snapFresh);
    }
  });

  // ComfyUI's standard per-node result hook - the other half of pattern #9.
  const origExec = node.onExecuted;
  node.onExecuted = function (output) {
    const r = origExec?.apply(this, arguments);
    const entry = pickEntry(output);
    if (entry) commitEntry(this, entry);
    return r;
  };
}

// The toolbar gear + the central right-click entry (convention #19). ownMenuItem
// because this node adds its own richer entry above.
registerNodeSettings(COMFY_CLASS, {
  title: "Save Video",
  open: (node) => openSaveVideoPanel(node),
  ownMenuItem: true,
});
