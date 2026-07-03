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
  quality: 90,
  embedWorkflow: true,
  saveOnRun: true,
};

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

// Normalize a folder path: backslash -> forward slash, trim, drop a trailing
// slash (but keep a bare drive root as "X:/"). Same helper as Load Images
// from Folder so native-dialog returns compare cleanly against typed paths.
export function normalizePath(p) {
  if (!p) return "";
  let s = String(p).trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:$/.test(s)) s += "/"; // "D:" -> "D:/"
  return s;
}

// JS mirror of nodes/_save_helpers.py::_expand_date_tokens — ComfyUI-native
// %date:FMT% codes, case-sensitive, zero-padded to the token length, with
// H/HH kept as an hour alias and unknown runs (e.g. a lone 'yyy') literal.
export function resolveDateTokens(s) {
  if (typeof s !== "string" || !s.includes("%date:")) return s;
  const d = new Date();
  const pad = (v, len) => String(v).padStart(len, "0");
  return s.replace(/%date:([^%]+)%/g, (_m, f) =>
    f.replace(/dd?|MM?|hh?|HH?|mm?|ss?|yyy?y?/g, (t) => {
      if (t === "yyyy") return pad(d.getFullYear(), 4);
      if (t === "yy") return String(d.getFullYear()).slice(-2);
      if (t === "yyy") return t; // literal, like native ComfyUI
      const c = t[0];
      if (c === "M") return pad(d.getMonth() + 1, t.length);
      if (c === "d") return pad(d.getDate(), t.length);
      if (c === "h" || c === "H") return pad(d.getHours(), t.length);
      if (c === "m") return pad(d.getMinutes(), t.length);
      if (c === "s") return pad(d.getSeconds(), t.length);
      return t;
    })
  );
}

// Mirror of the Python cleanup for a wired `name` value: strip a known media
// extension ("cat.png" -> "cat") and neutralize path separators.
export function cleanInputName(v) {
  if (v == null) return "";
  return String(v)
    .trim()
    .replace(/\.(png|jpe?g|webp|gif|bmp|tiff?|avif|mp4|mov|webm|mkv|m4v)$/i, "")
    .replace(/[\\/]/g, "_");
}
