// Reference Images Pixaroma - every change to the cards goes through here.
//
// Each change writes the saved state, keeps the output dots in step with the
// pictures, tells ComfyUI's change tracker (an upload ends long after the
// click, which the pack-wide change net never sees: convention #31) and
// repaints the face. Undo is ComfyUI's own Ctrl+Z: it restores the whole node
// (properties AND outputs), and onConfigure redraws the face from it.

import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { pixApiUrl } from "../shared/api_url.mjs";
import { MAX_CARDS, readState, writeState } from "./core.mjs";
import { fitAfterCards, sizeBefore } from "./layout.mjs";

const OUT_NAME = (k) => `image_${k}`;

export function refresh(node) {
  try { node._pixRfiRefresh?.(); } catch (e) { console.warn("[Reference Images] repaint failed", e); }
}

function commit(node, st, before = sizeBefore(node)) {
  writeState(node, st);
  syncOutputs(node);
  fitAfterCards(node, before);
  notifyGraphChanged();
  refresh(node);
}

/** The dot's label: the picture's number, like its badge (the user asked for
 *  "1", "2" on the edge). Runtime only: index.js strips it from the saved file,
 *  so a reopened node matches, and a label the user typed is left alone. */
export function isOurLabel(o, i) {
  return o.label == null || o.label === "" || o.label === String(i);
}

// One output per picture after `prompt`, named exactly like Python's
// RETURN_NAMES so ComfyUI's node-def reconciliation never re-adds a phantom.
// At least image_1 stays, so an empty node still shows where pictures come out.
// Diff-gated: re-writing an identical value can count as a change (Vue Compat
// #18). On the load path it only trims what core re-added (onConfigure).
export function syncOutputs(node) {
  if (!node) return;
  if (!node.outputs) node.outputs = [];
  const want = 1 + Math.max(1, Math.min(MAX_CARDS, readState(node).cards.length));
  while (node.outputs.length > want) node.removeOutput(node.outputs.length - 1);
  // localized_name too: a reload fills it in from the def, and an output added
  // without it would differ from the reopened one (an undo jam, measured).
  while (node.outputs.length < want) {
    const nm = OUT_NAME(node.outputs.length);
    node.addOutput(nm, "IMAGE", { localized_name: nm });
  }
  // After a removal the later outputs move down one and take the lower name.
  for (let i = 1; i < node.outputs.length; i++) {
    const o = node.outputs[i];
    if (!o) continue;
    if (o.name !== OUT_NAME(i)) o.name = OUT_NAME(i);
    if (o.localized_name !== OUT_NAME(i)) o.localized_name = OUT_NAME(i);
    if (isOurLabel(o, i) && o.label !== String(i)) o.label = String(i);
  }
  // The dots no longer push the face down (layout.mjs lifts the face beside
  // them), so a new output needs no room; the pictures' own height is
  // fitAfterCards' job.
  node.setDirtyCanvas?.(true, true);
}

export function addCards(node, uploaded) {
  const st = readState(node);
  const room = MAX_CARDS - st.cards.length;
  if (room <= 0 || !uploaded.length) return 0;
  for (const u of uploaded.slice(0, room)) {
    st.cards.push({ file: u.file, sub: u.sub || "", role: guessRole(st.cards.length), name: "" });
  }
  commit(node, st);
  return Math.min(room, uploaded.length);
}

// A first guess the user changes with one click: picture 1 is usually the
// person or thing the result is about, the next ones what to take from them.
function guessRole(index) {
  return ["character", "outfit", "background", "style"][index] || "object";
}

export function replaceCard(node, index, u) {
  const st = readState(node);
  if (!st.cards[index] || !u) return;
  st.cards[index].file = u.file;
  st.cards[index].sub = u.sub || "";
  commit(node, st);
}

/** Remove picture `index`. Its output goes WITH it (and its wire), so the
 *  wires on later pictures follow their picture (the Sliders rule). */
export function removeCard(node, index) {
  const st = readState(node);
  if (!st.cards[index]) return;
  const before = sizeBefore(node);
  const slot = index + 1;
  if (st.cards.length > 1 && node.outputs && slot < node.outputs.length) {
    node.removeOutput(slot);
    // The later outputs moved down one WITH their labels ("2" now sits on
    // output 1): renumber our own labels, or syncOutputs takes "2" for a
    // user's rename and keeps it, and it is saved (review 2026-10-25, reproduced).
    for (let k = slot; k < node.outputs.length; k++) {
      const o = node.outputs[k];
      if (o && o.label === String(k + 1)) o.label = String(k);
    }
  }
  st.cards.splice(index, 1);
  commit(node, st, before);
}

/** Swap two pictures. Wires stay on their NUMBER, so tag N and output N always
 *  mean the same picture. */
export function moveCard(node, index, dir) {
  const st = readState(node);
  const j = index + dir;
  if (!st.cards[index] || !st.cards[j]) return;
  [st.cards[index], st.cards[j]] = [st.cards[j], st.cards[index]];
  commit(node, st);
}

export function setCardField(node, index, key, value, { quiet = false } = {}) {
  const st = readState(node);
  if (!st.cards[index] || (key !== "role" && key !== "name")) return;
  st.cards[index][key] = String(value ?? "");
  writeState(node, st);
  if (!quiet) notifyGraphChanged();
  refresh(node);
}

/** Any top-level option (model, list, fill, size, multiple, custom, text, phrases). */
export function setOption(node, key, value, { quiet = false } = {}) {
  const st = readState(node);
  st[key] = value;
  writeState(node, st);
  if (!quiet) notifyGraphChanged();
  refresh(node);
}

// ── uploads: ComfyUI's own /upload/image, into the input folder ─────────────
export async function uploadFile(file) {
  const form = new FormData();
  const name = file.name && file.name !== "image.png" ? file.name : `pasted_${Date.now()}.png`;
  form.append("image", file, name);
  const resp = await fetch(pixApiUrl("/upload/image"), { method: "POST", body: form });
  if (!resp.ok) throw new Error(`upload failed (${resp.status})`);
  const json = await resp.json();
  if (!json?.name) throw new Error("upload answered without a file name");
  return { file: json.name, sub: json.subfolder || "" };
}

export const isPicture = (f) => !!f && String(f.type || "").startsWith("image/");

/** Upload pictures and add them (or, with `replaceIndex`, swap one). */
export async function addFiles(node, files, replaceIndex = -1) {
  const pics = [...(files || [])].filter(isPicture);
  if (!pics.length) return;
  const st = readState(node);
  const room = replaceIndex >= 0 ? 1 : MAX_CARDS - st.cards.length;
  if (room <= 0) {
    flashNote(node, `This node holds ${MAX_CARDS} pictures.`);
    return;
  }
  node._pixRfiBusy = (node._pixRfiBusy || 0) + 1;
  refresh(node);
  try {
    const done = [];
    for (const f of pics.slice(0, room)) done.push(await uploadFile(f));
    if (!node.graph) return;    // the node was deleted while we uploaded
    if (replaceIndex >= 0) replaceCard(node, replaceIndex, done[0]);
    else addCards(node, done);
    if (pics.length > room) flashNote(node, `Added ${room}: this node holds ${MAX_CARDS} pictures.`);
  } catch (e) {
    console.error("[Reference Images] upload failed", e);
    flashNote(node, "Could not add the picture. Is ComfyUI still running?");
  } finally {
    node._pixRfiBusy = Math.max(0, (node._pixRfiBusy || 1) - 1);
    refresh(node);
  }
}

function flashNote(node, msg) {
  node._pixRfiNote = msg;
  refresh(node);
  clearTimeout(node._pixRfiNoteT);
  node._pixRfiNoteT = setTimeout(() => { node._pixRfiNote = ""; refresh(node); }, 4000);
}

/** The /view address of a card's picture (a ROUTE wrapped once, hosted-urls.md). */
export function thumbUrl(card) {
  const q = `filename=${encodeURIComponent(card.file)}&type=input&subfolder=${encodeURIComponent(card.sub || "")}`;
  return pixApiUrl(`/view?${q}`);
}
