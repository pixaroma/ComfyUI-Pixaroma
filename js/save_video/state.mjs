// Save Video Pixaroma - shared state helpers.
// Imported by index.js / ui.mjs / player.mjs / settings.mjs (no circular import
// on index.js).

export const COMFY_CLASS = "PixaromaSaveVideo";
export const STATE_PROP = "saveVideoState";
export const HIDDEN_INPUT_NAME = "SaveVideoState";
export const LAST_RUN_PROP = "pixSvLastRun";

// Keys MUST match nodes/node_save_video.py::DEFAULT_STATE.
export const DEFAULT_STATE = {
  version: 1,
  folder: "",
  pattern: "Video_%date:yyyy-MM-dd%_%counter%",
  format: "mp4",
  quality: 75,
  bitDepth: 10,
  trimToAudio: false,
  // ms of fade-in on the sound; 0 = off. MIRRORS nodes/node_save_video.py
  // DEFAULT_STATE - the two must stay in lockstep.
  audioFadeMs: 0,
  embedWorkflow: true,
  // also write a stand-in graph Civitai's video reader understands into the
  // `prompt` tag (civitai-meta.md #17); MIRRORS nodes/node_save_video.py
  civitaiMeta: false,
  saveOnRun: true,
  dateStyle: "yyyy-MM-dd", // what the + Date chip inserts (regional order)
  counterDigits: 3, // %counter% zero-padding (001 = 3)
  folded: false, // JS-only: node body collapsed to the toolbar + player
  hideBarWhenFolded: false, // JS-only: also tuck the toolbar away when folded
  // Which optional buttons the face shows. Absent = true (an older saved
  // workflow keeps every button), and at least one FORMAT is always shown.
  // Download rather than Copy: a video cannot go on the clipboard, and the
  // useful action is getting the file out (which matters most in Preview mode,
  // where the only copy lives in ComfyUI's temp folder).
  showOpen: true,
  showDownload: true,
  showFolder: true,
  showMp4: true,
  showMp4Hq: true,
};

// The two formats, in face order. Single source of truth for the buttons and
// the quality mapping; MUST stay in step with FORMATS in node_save_video.py.
//
// Bit depth rides along with the FORMAT rather than being its own switch,
// because "10-bit" on its own is a promise that cannot be kept: whether a file
// plays depends on the CODEC, not the bit count. 10-bit H.264 (High 10) has no
// hardware decoder anywhere, so it is deliberately not offered.
export const FORMATS = [
  {
    id: "mp4",
    label: "MP4",
    ext: ".mp4",
    key: "showMp4",
    tenBit: false,
    crfBest: 14,
    crfWorst: 32,
    title: "H.264 at 8-bit. Plays on everything, everywhere. The safe choice.",
  },
  {
    id: "mp4hq",
    label: "MP4 HQ",
    ext: ".mp4",
    key: "showMp4Hq",
    tenBit: true,
    crfBest: 16,
    crfWorst: 34,
    title:
      "H.265 at 10-bit. Gradients like skies and fades stay smooth instead of " +
      "banding, and the file is roughly half the size, but it needs a reasonably " +
      "recent player.",
  },
];

export function formatDef(id) {
  const key = String(id ?? "").toLowerCase();
  return FORMATS.find((f) => f.id === key) || FORMATS[0];
}

// Which formats the user left switched on, never empty: hiding the last one
// would leave the node with no way to change format at all.
export function visibleFormats(st) {
  const on = FORMATS.filter((f) => st[f.key] !== false);
  return on.length ? on : [FORMATS[0]];
}

// JS mirror of node_save_video.py::quality_to_crf. Shown in the settings panel
// so the number is not a mystery, and it must agree with the Python or the
// panel would advertise a CRF the encoder never uses.
//
// floor(x + 0.5), NOT Math.round of a pre-rounded value and NOT Python's
// round(): Python's round() is banker's rounding, so the two languages disagree
// at every .5 unless both use this exact form (the Longest Side parity trap).
export function qualityToCrf(quality, fmtId) {
  const f = formatDef(fmtId);
  let q = parseInt(quality, 10);
  if (!isFinite(q)) q = 75;
  q = Math.max(1, Math.min(100, q));
  const span = f.crfWorst - f.crfBest;
  return Math.floor(f.crfBest + ((100 - q) / 99) * span + 0.5);
}

// A WORD for the quality number, because "75" next to the word "Quality" reads
// as a percentage and is not one - the person this node was built for read it as
// "losing 25%". It is a position on a dial that maps to CRF, and no mp4 is ever
// uncompressed. The bands line up with the CRF ranges people actually name:
//   Maximum   q90-100  -> crf 14-16   bigger files, no visible gain for most work
//   High      q65-89   -> crf 17-20   contains the default 75 -> crf 19
//   Medium    q35-64   -> crf 21-26
//   Small file q1-34   -> crf 27-32
export function qualityLabel(q) {
  const v = Math.max(1, Math.min(100, parseInt(q, 10) || 75));
  if (v >= 90) return "Maximum";
  if (v >= 65) return "High";
  if (v >= 35) return "Medium";
  return "Small file";
}

// JS mirror of node_save_video.py::format_duration. Whole seconds print plain,
// anything else gets one decimal with a HYPHEN, because a dot in the middle of
// a filename reads like a file extension.
export function formatDuration(nFrames, fps) {
  const f = Number(fps);
  const n = Number(nFrames);
  if (!isFinite(f) || f <= 0 || !isFinite(n)) return "0";
  const secs = n / f;
  const rounded = Math.floor(secs * 10 + 0.5) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return rounded.toFixed(1).replace(".", "-");
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

// The filename mirrors are SHARED (js/shared/filename_mirror.mjs) - one copy for
// Save Image and Save Video, because that mirror took three review rounds to
// agree with the Python and a second copy would drift.
export {
  resolveDateTokens,
  expandNativeTokens,
  cleanInputName,
  normalizePath,
  sanitizePrefixMirror,
} from "../shared/filename_mirror.mjs";
