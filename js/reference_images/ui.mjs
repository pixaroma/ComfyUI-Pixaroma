// Reference Images Pixaroma - the node face.
//
// ONE DOM widget in both renderers (the fill recipe of nodes2-preview-fill.md,
// Layout Boxes' shape): the root fills its row, all layout lives on an inner
// absolute layer. The picture grid is exactly its rows (up to 4 a row, square
// pictures as wide as the node allows) and "Your prompt" takes the height that
// is left; layout.mjs holds the same sum for the node's size. Everything has a
// height the pictures' count and the width decide, so a picture that loads
// late, a warning or a run's result can never grow the body (convention #43).
// getMinHeight is a CONSTANT (#39 E).

import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNativeTextMenu } from "../shared/native_text_menu.mjs";
import { installNodeAccent } from "../shared/node_settings.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { followSpellcheck } from "../shared/spellcheck.mjs";
import { passComfyShortcut } from "../shared/text_shortcuts.mjs";
import {
  MAX_CARDS, MODEL_LABELS, ROLES, buildPrompt, defaultNoun, defaultPhrase, missingTags, readState, roleLabel, tag,
} from "./core.mjs";
import { injectCSS } from "./css.mjs";
import { addFiles, isPicture, moveCard, removeCard, setCardField, setOption, thumbUrl } from "./actions.mjs";
import { closeMenu, openMenu } from "./popup.mjs";
import { FIXED_H, FLOOR, addMode, columnsFor, gridHeight, growToFloor } from "./layout.mjs";

export const WIDGET_NAME = "reference_images_ui";
export const WIDGET_TYPE = "pixaroma_reference_images";   // unique: a registered Vue type would swallow the DOM
export const MIN_W = 340;

const el = (tag_, cls, text) => {
  const e = document.createElement(tag_);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const MODEL_HINTS = {
  auto: "Follows the prompt wire to the model",
  qwen21: "Tags like <image1>",
  flux3: "Tags like <ref_image_0>, counting from 0",
  h3: "Tags like <Picture 1>",
  plain: "image 1, image 2 (Flux 2 Klein and others)",
  custom: "Your own pattern, set in the gear",
};

/** The model the face shows tags for: the pick, or for Auto what the wire
 *  leads to (index.js works it out and keeps it on node._pixRfiLive). */
export function shownModel(node) {
  const st = readState(node);
  if (st.model !== "auto") return st.model;
  const run = node._pixRfiRun;
  if (run?.model && run.liveAt === node._pixRfiLive) return run.model;
  return node._pixRfiLive || "plain";
}

function textWired(node) {
  const inp = node.inputs?.find((i) => i && i.name === "text");
  return !!(inp && inp.link != null);
}

function pickFiles(multiple, onFiles) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = multiple;
  input.style.display = "none";
  input.addEventListener("change", () => {
    const files = [...(input.files || [])];
    input.remove();
    if (files.length) onFiles(files);
  });
  document.body.appendChild(input);
  input.click();
}

export function buildFace(node, { onGear }) {
  injectCSS();
  const root = el("div", "pix-rfi-root");
  const inner = el("div", "pix-rfi-inner");
  root.appendChild(inner);

  // ── top bar: the model, the count, the gear ──
  const bar = el("div", "pix-rfi-bar");
  const modelBtn = el("button", "pix-rfi-model");
  modelBtn.type = "button";
  modelBtn.title = "Which model reads the prompt. Each one names the pictures its own way.";
  const mk = el("span", "k", "Model");
  const mv = el("b", null, "");
  const ma = el("span", "v", "▼");
  modelBtn.append(mk, mv, ma);
  modelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const st = readState(node);
    const items = Object.keys(MODEL_LABELS).map((k) => ({
      key: k,
      label: k === "auto" ? `Auto (now ${MODEL_LABELS[node._pixRfiLive || "plain"]})` : MODEL_LABELS[k],
      hint: MODEL_HINTS[k],
    }));
    openMenu(node, modelBtn, items, st.model, (k) => setOption(node, "model", k));
  });
  const count = el("span", "pix-rfi-count", "");
  const gear = el("button", "pix-rfi-btn pix-rfi-gear");
  gear.type = "button";
  gear.title = "Settings";
  gear.setAttribute("aria-label", "Reference Images settings");
  gear.addEventListener("click", (e) => { e.stopPropagation(); onGear(); });
  bar.append(modelBtn, el("span", "pix-rfi-grow"), count, gear);

  // ── the pictures ──
  const grid = el("div", "pix-rfi-grid");

  // ── your prompt ──
  const pHead = el("div", "pix-rfi-head");
  pHead.append(el("span", "t", "Your prompt"), el("span", "h", "@1 = picture 1, @2 = picture 2"));
  const textBox = el("textarea", "pix-rfi-text");
  textBox.placeholder = "What to make, for example: Put @1 in the outfit from @2, sitting on a sunny beach.";
  textBox.setAttribute("aria-label", "Your prompt");
  followSpellcheck(textBox);
  textBox.addEventListener("keydown", (e) => { passComfyShortcut(e, textBox, { blur: true }); });
  textBox.addEventListener("input", () => setOption(node, "text", textBox.value, { quiet: true }));
  const warn = el("div", "pix-rfi-warn", "");

  // ── what is sent ──
  const sHead = el("div", "pix-rfi-head");
  const sTitle = el("span", "t", "Prompt sent");
  const sHint = el("span", "h", "");
  const copy = el("button", "pix-rfi-copy", "Copy");
  copy.type = "button";
  copy.title = "Copy the prompt this node sends";
  copy.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = node._pixRfiSent || "";
    if (!t) return;
    navigator.clipboard?.writeText(t).then(() => {
      copy.style.minWidth = copy.offsetWidth + "px";
      copy.textContent = "Copied";
      copy.classList.add("is-flashing");
      setTimeout(() => { copy.textContent = "Copy"; copy.classList.remove("is-flashing"); }, 700);
    }).catch(() => {});
  });
  sHead.append(sTitle, sHint, el("span", "pix-rfi-grow"), copy);
  const sent = el("div", "pix-rfi-sent", "");
  // A read-only text box for screen readers (axe: aria-label needs a role).
  sent.setAttribute("role", "textbox");
  sent.setAttribute("aria-readonly", "true");
  sent.setAttribute("aria-multiline", "true");
  sent.tabIndex = 0;
  sent.setAttribute("aria-label", "The prompt this node sends");

  inner.append(bar, grid, pHead, textBox, warn, sHead, sent);

  // Drop pictures anywhere on the face; onto a picture = replace that one.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  root.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    grid.classList.add("drop");
  });
  root.addEventListener("dragleave", (e) => {
    if (!root.contains(e.relatedTarget)) grid.classList.remove("drop");
  });
  root.addEventListener("drop", (e) => {
    grid.classList.remove("drop");
    if (!hasFiles(e)) return;
    // Only pictures are ours: a workflow .json or a video dropped here goes on
    // to ComfyUI's own drop handling (it opens the workflow).
    if (![...(e.dataTransfer?.files || [])].some(isPicture)) return;
    e.preventDefault();
    e.stopPropagation();   // or ComfyUI ALSO makes a Load Image node of it
    const thumb = e.target?.closest?.(".pix-rfi-thumb");
    const idx = thumb ? parseInt(thumb.dataset.index, 10) : -1;
    addFiles(node, e.dataTransfer.files, Number.isInteger(idx) ? idx : -1);
  });

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => FLOOR,
  });
  // BOTH flags: options.serialize keeps it out of the PROMPT, widget.serialize
  // keeps it out of the saved workflow's widgets_values.
  widget.serialize = false;
  widget.computeLayoutSize = () => ({ minHeight: FLOOR, minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);
  installCanvasZoomPassthrough(root);
  installNativeTextMenu(root);
  installNodeAccent(node, root);
  // Nodes 2.0's corner drag measures the node collapsed, ignoring getMinHeight:
  // pin the content's height on the root while a resize handle is held (drag
  // only, never a load). A wider node has taller pictures, so on release the
  // node grows to fit the width it ended at.
  const contentH = () => Math.ceil(FIXED_H + gridHeight(grid.clientWidth, readState(node).cards.length));
  const floorOff = installResizeFloor(root, contentH, () => growToFloor(node));
  const widthOff = installWidthFloor(root);

  // The column count follows the grid's width (4 a row at most, never a
  // picture under 84 px). A count change moves the Add button between the
  // last row and its own strip, so the cards are rebuilt. DOM only.
  let ro = null;
  try {
    ro = new ResizeObserver(() => {
      const f = node._pixRfiFace;
      if (!f || !grid.clientWidth) return;
      if (columnsFor(grid.clientWidth) !== f.cols) renderFace(node, true);
    });
    ro.observe(grid);
  } catch {}

  node._pixRfiFace = { floorOff, widthOff, ro, root, inner, grid, modelBtn, mv, count, textBox, warn, sHint, sent, widget,
    sig: "", cols: 0 };
  return widget;
}

function cardEl(node, card, i, n, wired) {
  const c = el("div", "pix-rfi-card");
  const thumb = el("div", "pix-rfi-thumb");
  thumb.dataset.index = String(i);
  thumb.title = `Picture ${i + 1}: ${card.file}\nClick to use another picture, or drop one here.`;
  const img = el("img");
  img.alt = `Picture ${i + 1}`;
  img.draggable = false;
  img.decoding = "async";
  img.addEventListener("error", () => {
    img.remove();
    const miss = el("div", "miss", "Not in ComfyUI's input folder. Click to add it again.");
    thumb.appendChild(miss);
  });
  img.src = thumbUrl(card);
  thumb.appendChild(img);
  thumb.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    pickFiles(false, (files) => addFiles(node, files, i));
  });

  const badge = el("button", "pix-rfi-badge", String(i + 1));
  badge.type = "button";
  badge.title = wired ? `Picture ${i + 1}` : `Picture ${i + 1}: click to write @${i + 1} in your prompt`;
  badge.setAttribute("aria-label", `Picture ${i + 1}, write @${i + 1} in the prompt`);
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!wired) insertTag(node, i + 1);
  });
  const x = el("button", "pix-rfi-x", "×");
  x.type = "button";
  x.title = "Remove this picture";
  x.setAttribute("aria-label", `Remove picture ${i + 1}`);
  x.addEventListener("click", (e) => { e.stopPropagation(); removeCard(node, i); });
  const left = el("button", "pix-rfi-mv l", "◀");
  left.type = "button";
  left.title = "Move left (it becomes the picture before)";
  left.setAttribute("aria-label", `Move picture ${i + 1} left`);
  left.disabled = i === 0;
  left.addEventListener("click", (e) => { e.stopPropagation(); moveCard(node, i, -1); });
  const right = el("button", "pix-rfi-mv r", "▶");
  right.type = "button";
  right.title = "Move right (it becomes the picture after)";
  right.setAttribute("aria-label", `Move picture ${i + 1} right`);
  right.disabled = i === n - 1;
  right.addEventListener("click", (e) => { e.stopPropagation(); moveCard(node, i, 1); });
  thumb.append(badge, x, left, right);

  const role = el("button", "pix-rfi-role");
  role.type = "button";
  role.title = "What this picture is for";
  role.append(el("span", null, roleLabel(card.role)), el("i", null, "▼"));
  role.addEventListener("click", (e) => {
    e.stopPropagation();
    const st = readState(node);
    const ref = `picture ${i + 1}`;
    // One line per role (convention #14); the words it adds show on hover.
    const items = ROLES.map(([k, label]) => ({
      key: k,
      label,
      title: (st.phrases[k] || defaultPhrase(k)).split("{name}").join(defaultNoun(k) || "it").split("{ref}").join(ref),
    }));
    openMenu(node, role, items, card.role, (k) => setCardField(node, i, "role", k));
  });

  const name = el("input", "pix-rfi-name");
  name.type = "text";
  name.value = card.name || "";
  // The placeholder IS the words the prompt uses while the field is empty.
  name.placeholder = defaultNoun(card.role) || "what it is";
  name.title = "Optional: what this picture shows, in a few words (the woman in red, the leather jacket). "
    + "It takes the place of the role's own words in the prompt.";
  name.setAttribute("aria-label", `What picture ${i + 1} shows`);
  name.maxLength = 120;
  followSpellcheck(name);
  name.addEventListener("keydown", (e) => { passComfyShortcut(e, name, { blur: true }); });
  name.addEventListener("input", () => setCardField(node, i, "name", name.value, { quiet: true }));

  c.append(thumb, role, name);
  return c;
}

function insertTag(node, n) {
  const f = node._pixRfiFace;
  if (!f) return;
  const box = f.textBox;
  const t = `@${n}`;
  const v = box.value;
  const a = box.selectionStart ?? v.length;
  const b = box.selectionEnd ?? v.length;
  const pre = v.slice(0, a);
  const pad = pre && !/\s$/.test(pre) ? " " : "";
  box.value = pre + pad + t + v.slice(b);
  const caret = a + pad.length + t.length;
  box.focus();
  try { box.setSelectionRange(caret, caret); } catch {}
  setOption(node, "text", box.value);
}

// mode (layout.mjs addMode): "wide" = the empty node's drop zone, "tile" = a
// square in the last row's free place, "strip" = a slim row under a full row.
// While pictures upload it says so IN PLACE, so the face keeps its height.
function addTile(node, mode, busy) {
  const a = el("button", `pix-rfi-add ${mode}` + (busy ? " busy" : ""));
  a.type = "button";
  if (busy) {
    a.disabled = true;
    a.append(el("span", null, "Adding pictures..."));
    return a;
  }
  a.title = "Add pictures (or drop them on the node, or paste with Ctrl+V)";
  const label = mode === "wide" ? "Add reference pictures" : mode === "strip" ? "Add pictures" : "Add";
  const sub = mode === "wide" ? `Click, drop or paste. Up to ${MAX_CARDS}.` : mode === "strip" ? "or drop them here" : "or drop";
  a.append(el("span", "plus", "+"), el("span", null, label), el("span", "sub", sub));
  a.addEventListener("click", (e) => {
    e.stopPropagation();
    pickFiles(true, (files) => addFiles(node, files));
  });
  return a;
}

/** Rebuild the cards (structural) and re-sync everything else. Pure DOM: it
 *  never writes node.size, properties or slots, so it is safe on the load path. */
export function renderFace(node, structural = true) {
  const f = node._pixRfiFace;
  if (!f) return;
  const st = readState(node);
  const model = shownModel(node);
  const wired = textWired(node);
  const n = st.cards.length;

  // A rebuild only when the cards really changed: re-creating the <img>s on
  // every keystroke would flicker.
  // Not laid out yet (a load, a zoomed-out canvas): keep the last count.
  const cols = f.grid.clientWidth > 0 ? columnsFor(f.grid.clientWidth) : (f.cols || 4);
  const sig = JSON.stringify([st.cards.map((c) => [c.file, c.sub, c.role]), wired, node._pixRfiBusy || 0,
    st.phrases, cols]);
  if (structural || sig !== f.sig) {
    f.sig = sig;
    f.cols = cols;
    closeMenu();
    f.grid.textContent = "";
    f.grid.style.gridTemplateColumns = `repeat(${cols},minmax(0,1fr))`;
    st.cards.forEach((c, i) => f.grid.appendChild(cardEl(node, c, i, n, wired)));
    const mode = addMode(n, cols);
    if (mode) f.grid.appendChild(addTile(node, mode, !!node._pixRfiBusy));
  }

  f.mv.textContent = st.model === "auto" ? `Auto: ${MODEL_LABELS[model]}` : MODEL_LABELS[model];
  f.count.textContent = n ? `${n} of ${MAX_CARDS}` : "";

  f.textBox.disabled = wired;
  if (wired) {
    f.textBox.value = "";
    f.textBox.placeholder = "Your prompt comes from the text wire. @1, @2 in it still become the tags.";
  } else {
    f.textBox.placeholder = "What to make, for example: Put @1 in the outfit from @2, sitting on a sunny beach.";
    if (document.activeElement !== f.textBox && f.textBox.value !== st.text) f.textBox.value = st.text;
  }

  const miss = wired ? [] : missingTags(st.text, n);
  f.warn.textContent = node._pixRfiNote
    || (miss.length ? `${miss.map((m) => "@" + m).join(", ")}: no such picture, sent as typed.` : "");

  // The run's own prompt when the text came over a wire (the page cannot read
  // it before a Run); the live build otherwise.
  let out;
  if (wired) {
    const run = node._pixRfiRun;
    out = run?.prompt || buildPrompt(st, model, "(your prompt from the text wire)");
  } else {
    out = buildPrompt(st, model, null);
  }
  node._pixRfiSent = out;
  f.sent.textContent = out || "Add pictures and write your prompt: the text that goes to the model shows here.";
  f.sent.classList.toggle("empty", !out);
  f.sHint.textContent = n ? `${tag(model, 1, st.custom)} = picture 1` : "";
}

// Nodes 2.0 has no width floor for this body: its corner drag clamps at the node
// element's INLINE min-width, read on every move, so pin one only WHILE a resize
// handle of this node is held (Layout Boxes' installWidthFloor, sketch.md #11):
// it can never fight a saved size on a load. Found by CONTAINMENT at press time.
function installWidthFloor(root) {
  let pinned = null;
  const clear = () => {
    if (!pinned) return;
    try { pinned.style.removeProperty("min-width"); } catch {}
    pinned = null;
  };
  const onDown = (e) => {
    if (!isVueNodes() || !root.isConnected) return;
    if (e.target?.closest?.(".lg-node-widget")) return;
    let cur = "";
    try { cur = getComputedStyle(e.target).cursor || ""; } catch {}
    if (!cur.includes("resize")) return;
    const el = e.target.closest?.(".lg-node");
    if (!el || !el.contains(root)) return;
    try { el.style.setProperty("min-width", MIN_W + "px"); pinned = el; } catch {}
  };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointerup", clear, true);
  window.addEventListener("pointercancel", clear, true);
  return () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointerup", clear, true);
    window.removeEventListener("pointercancel", clear, true);
    clear();
  };
}

export function destroyFace(node) {
  closeMenu();
  try { node._pixRfiFace?.floorOff?.(); } catch {}
  try { node._pixRfiFace?.widthOff?.(); } catch {}
  try { node._pixRfiFace?.ro?.disconnect(); } catch {}
  node._pixRfiFace = null;
}
