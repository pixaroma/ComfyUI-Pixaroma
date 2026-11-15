// Save Image Pixaroma — shared state helpers.
// Imported by index.js / ui.mjs / settings.mjs (no circular import on index.js).

export const COMFY_CLASS = "PixaromaSaveImage";
export const STATE_PROP = "saveImageState";
export const HIDDEN_INPUT_NAME = "SaveImageState";

// Keys MUST match nodes/node_save_image.py::DEFAULT_STATE.
export const DEFAULT_STATE = {
  version: 1,
  folder: "",
  pattern: "image_%date:yyyy-MM-dd%_%counter%",
  format: "png",
  quality: 100,
  embedWorkflow: true,
  civitaiMeta: false, // also write A1111/Civitai generation settings
  saveOnRun: true,
  dateStyle: "yyyy-MM-dd", // what the + Date chip inserts (regional order)
  counterDigits: 3, // %counter% zero-padding (001 = 3)
  folded: false, // JS-only: node body collapsed to the toolbar + preview
  hideBarWhenFolded: false, // JS-only: also tuck the toolbar away when folded
  webpLossless: false, // WebP written lossless (the quality slider is ignored)
  print300: false, // PNG / JPG say 300 ppi (print); off = no ppi written (apps read 72)
  // Let a WIRED name keep its folders instead of flattening them to "_".
  // Off by default so an existing workflow's names never change shape.
  inputSubfolders: false,
  // Which optional buttons the face shows. Absent = true (an older saved
  // workflow keeps every button), and at least one FORMAT is always shown.
  showOpen: true,
  showCopy: true,
  showFolder: true,
  showPng: true,
  showJpg: true,
  showWebp: true,
};

// The three save formats, in face order. Single source of truth for the
// buttons, the extension, and which visibility key each one answers to.
export const FORMATS = [
  { id: "png", label: "PNG", ext: ".png", key: "showPng" },
  { id: "jpg", label: "JPG", ext: ".jpg", key: "showJpg" },
  { id: "webp", label: "WebP", ext: ".webp", key: "showWebp" },
];

export function formatDef(id) {
  // Match the Python's tolerance: node_save_image.py accepts "jpeg" as well as
  // "jpg". Without the alias a state blob holding "jpeg" fell through to
  // FORMATS[0], so the face lit the PNG pill and previewed a .png name while a
  // Run really wrote a .jpg - silent, and wrong in the direction that loses
  // transparency. Cheaper to accept the alias than to hunt for who wrote it.
  const key = String(id ?? "").toLowerCase();
  const norm = key === "jpeg" ? "jpg" : key;
  return FORMATS.find((f) => f.id === norm) || FORMATS[0];
}

// Which formats the user left switched on, never empty: hiding the last one
// would leave the node with no way to change format at all, so the face falls
// back to showing PNG.
export function visibleFormats(st) {
  const on = FORMATS.filter((f) => st[f.key] !== false);
  return on.length ? on : [FORMATS[0]];
}

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try {
      return { ...DEFAULT_STATE, ...JSON.parse(v) };
    } catch {
      /* fall through to defaults */
    }
  }
  return { ...DEFAULT_STATE };
}

export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

// The filename mirrors moved to js/shared/filename_mirror.mjs on 2026-08-10 so
// Save Video Pixaroma uses the SAME copy - this one took three review rounds to
// match the Python and a second copy would drift. Re-exported here so every
// existing importer of this module is unchanged.
export {
  resolveDateTokens,
  expandNativeTokens,
  cleanInputName,
  normalizePath,
  sanitizePrefixMirror,
} from "../shared/filename_mirror.mjs";
