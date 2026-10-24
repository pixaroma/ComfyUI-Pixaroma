// Reference Images Pixaroma - the saved state, the model tags and the prompt.
//
// PURE (no imports), so the parity harness can load it in plain node:
// D:\Claude Tests\_ref_images\parity.py runs these functions and the Python
// ones in nodes/_ref_images_helpers.py on the same cases; the prompt must match
// byte for byte. This copy only feeds the live "Prompt sent" box; the run
// builds the real prompt in Python. Change one, change the other.
//
// The cards live on node.properties.refImages (an OBJECT) and reach Python
// through the hidden RefImagesState input, injected by the graphToPrompt hook
// in index.js.

export const CLASS = "PixaromaReferenceImages";
export const HIDDEN_INPUT = "RefImagesState";
export const PROP = "refImages";

export const MAX_CARDS = 8;
const MAX_NAME = 120;
const MAX_TEXT = 20000;
const MAX_PHRASE = 200;
const MAX_CUSTOM = 60;

export const MODELS = ["auto", "qwen21", "flux3", "h3", "plain", "custom"];
export const MODEL_LABELS = {
  auto: "Auto",
  qwen21: "Qwen Image 2.1",
  flux3: "FLUX 3 Image Klein",
  h3: "MiniMax H3",
  plain: "Plain words",
  custom: "Custom",
};
export const DEFAULT_CUSTOM = "<image{n}>";

// [key, label on the node, the words used when the card has no name, the phrase]
export const ROLES = [
  ["character", "Character", "the character", "{name} from {ref}"],
  ["person", "Person", "the person", "{name} from {ref}"],
  ["face", "Face", "the face", "{name} from {ref}"],
  ["outfit", "Outfit", "the outfit", "{name} from {ref}"],
  ["pose", "Pose", "the pose", "{name} from {ref}"],
  ["object", "Object", "the object", "{name} from {ref}"],
  ["product", "Product", "the product", "{name} from {ref}"],
  ["background", "Background", "the background", "{name} from {ref}"],
  ["style", "Style", "the art style", "{name} of {ref}"],
  ["lighting", "Lighting", "the lighting", "{name} from {ref}"],
  ["colors", "Colors", "the colors", "{name} of {ref}"],
  ["other", "Other", "", "{name} from {ref}"],
];
export const ROLE_KEYS = ROLES.map((r) => r[0]);
const ROLE_NOUN = Object.fromEntries(ROLES.map((r) => [r[0], r[2]]));
const ROLE_PHRASE = Object.fromEntries(ROLES.map((r) => [r[0], r[3]]));
export const roleLabel = (k) => (ROLES.find((r) => r[0] === k) || ROLES[ROLES.length - 1])[1];
export const defaultPhrase = (k) => ROLE_PHRASE[k] || ROLE_PHRASE.other;
export const defaultNoun = (k) => ROLE_NOUN[k] ?? "";

export const LIST_POSITIONS = ["before", "after", "off"];
export const FILLS = ["white", "grey", "black"];
export const SIZES = ["keep", "1mp", "2mp"];
export const MULTIPLES = ["auto", "off", "16", "32", "64"];

// Same table as _ref_images_helpers._CLASS_MODEL.
const CLASS_MODEL = {
  TextEncodeQwenImage21: "qwen21",
  ReferenceMultiLatent: "flux3",
  Flux3LayoutPrompt: "flux3",
  ReferenceLatent: "plain",
  TextEncodeQwenImageEdit: "plain",
  TextEncodeQwenImageEditPlus: "plain",
};
const DETECT_DEPTH = 6;

export function classModel(cls) {
  if (typeof cls !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(CLASS_MODEL, cls)) return CLASS_MODEL[cls];
  if (cls.startsWith("MiniMaxH3")) return "h3";
  return null;
}

const pick = (v, allowed, dflt) => (typeof v === "string" && allowed.includes(v) ? v : dflt);
// Code points, like a Python slice (a UTF-16 slice could cut an emoji in half).
const text = (v, cap) => (typeof v === "string" ? Array.from(v).slice(0, cap).join("") : "");
// The ONE whitespace set Python's _strip uses.
const strip = (s) => String(s).replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");

/** A healed copy of a raw state object. Never throws. Mirrors parse_state. */
export function parseState(raw) {
  if (typeof raw === "string") {
    try { raw = raw.trim() ? JSON.parse(raw) : {}; } catch { raw = {}; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const cards = [];
  for (const c of Array.isArray(raw.cards) ? raw.cards : []) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    cards.push({
      file: text(c.file, 260),
      sub: text(c.sub, 260),
      role: pick(c.role, ROLE_KEYS, "other"),
      name: text(c.name, MAX_NAME),
    });
    if (cards.length >= MAX_CARDS) break;
  }
  const phrases = {};
  if (raw.phrases && typeof raw.phrases === "object" && !Array.isArray(raw.phrases)) {
    for (const k of ROLE_KEYS) {
      const v = raw.phrases[k];
      if (typeof v === "string" && strip(v)) phrases[k] = text(v, MAX_PHRASE);
    }
  }
  return {
    model: pick(raw.model, MODELS, "auto"),
    custom: text(raw.custom, MAX_CUSTOM),
    cards,
    text: text(raw.text, MAX_TEXT),
    list: pick(raw.list, LIST_POSITIONS, "before"),
    fill: pick(raw.fill, FILLS, "white"),
    size: pick(raw.size, SIZES, "keep"),
    multiple: pick(raw.multiple, MULTIPLES, "auto"),
    phrases,
  };
}

/** The node's state (a healed COPY; never writes, so safe on the load path). */
export function readState(node) {
  return parseState(node?.properties?.[PROP]);
}

/** The ONLY writer. User actions only, never the load path. */
export function writeState(node, next) {
  if (!node) return;
  const st = parseState(next);
  node.properties = node.properties || {};
  node.properties[PROP] = { v: 1, ...st };
}

/** Exactly what Python receives. */
export function injectedState(node) {
  return { v: 1, ...readState(node) };
}

export function tag(model, n, custom = "") {
  if (model === "qwen21") return `<image${n}>`;
  if (model === "flux3") return `<ref_image_${n - 1}>`;
  if (model === "h3") return `<Picture ${n}>`;
  if (model === "custom") {
    const pat = strip(custom) || DEFAULT_CUSTOM;
    return pat.split("{n}").join(String(n)).split("{i}").join(String(n - 1));
  }
  return `image ${n}`;
}

export function phraseFor(card, ref, phrases = {}) {
  const role = ROLE_KEYS.includes(card?.role) ? card.role : "other";
  const template = phrases?.[role] || ROLE_PHRASE[role];
  const name = strip(card?.name || "") || ROLE_NOUN[role];
  if (template.includes("{name}") && !name) return ref;
  return strip(template.split("{name}").join(name).split("{ref}").join(ref));
}

function join(parts) {
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

export function listSentence(st, model) {
  if (!st.cards.length) return "";
  const parts = st.cards
    .map((c, i) => phraseFor(c, tag(model, i + 1, st.custom), st.phrases))
    .filter((p) => p);
  if (!parts.length) return "";
  return "Use " + join(parts) + ".";
}

// @1 .. @8 in the user's text; the same pattern as Python's _AT (ASCII only).
const AT = /(?<![A-Za-z0-9_@])@([0-9]{1,2})(?![0-9])/g;

export function convertTags(s, model, count, custom = "") {
  return String(s || "").replace(AT, (m, d) => {
    const n = parseInt(d, 10);
    return n >= 1 && n <= count ? tag(model, n, custom) : m;
  });
}

export function missingTags(s, count) {
  const out = [];
  for (const m of String(s || "").matchAll(AT)) {
    const n = parseInt(m[1], 10);
    if (!(n >= 1 && n <= count) && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The prompt the node sends. `wired` = a wired text (replaces the box), or null. */
export function buildPrompt(st, model, wired = null) {
  const own = wired == null ? st.text : String(wired);
  const body = strip(convertTags(own, model, st.cards.length, st.custom));
  const lst = st.list !== "off" ? listSentence(st, model) : "";
  const parts = st.list === "after" ? [body, lst] : [lst, body];
  return parts.filter((p) => p).join(" ");
}

/** Mirror of detect_model, on an API-prompt-shaped graph:
 *  { id: { class_type, inputs: { name: [srcId, slot] | value } } }. */
export function detectModel(prompt, nodeId) {
  if (!prompt || typeof prompt !== "object" || nodeId == null) return "plain";
  const me = String(nodeId);
  const nodes = {};
  for (const k of Object.keys(prompt)) nodes[String(k)] = prompt[k];
  const first = [];
  const anySlot = {};
  for (const nid of Object.keys(nodes).sort()) {
    const entry = nodes[nid];
    if (!entry || typeof entry !== "object") continue;
    const inputs = entry.inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
    for (const v of Object.values(inputs)) {
      if (!Array.isArray(v) || v.length !== 2) continue;
      const src = String(v[0]);
      const slot = v[1];
      if (!anySlot[src]) anySlot[src] = [];
      if (!anySlot[src].includes(nid)) anySlot[src].push(nid);
      if (src === me && slot === 0 && !first.includes(nid)) first.push(nid);
    }
  }
  const seen = new Set([me]);
  let level = first;
  for (let d = 0; d < DETECT_DEPTH; d++) {
    const next = [];
    for (const nid of level) {
      if (seen.has(nid)) continue;
      seen.add(nid);
      const entry = nodes[nid];
      const hit = classModel(entry && typeof entry === "object" ? entry.class_type : null);
      if (hit) return hit;
      next.push(...(anySlot[nid] || []));
    }
    if (!next.length) break;
    level = next;
  }
  return "plain";
}

export function effectiveMultiple(st, model) {
  if (st.multiple === "auto") return model === "qwen21" ? 32 : 1;
  if (st.multiple === "off") return 1;
  return parseInt(st.multiple, 10);
}
