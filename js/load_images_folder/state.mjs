// Load Images from Folder Pixaroma — shared state helpers.
// Imported by both index.js and ui.mjs (no circular import on index.js).

export const COMFY_CLASS = "PixaromaLoadImagesFolder";
export const STATE_PROP = "loadImagesFolderState";
export const HIDDEN_INPUT_NAME = "LoadImagesFolderState";

// Resize keys MUST match nodes/node_load_images_folder.py::DEFAULT_STATE and
// nodes/node_load_image.py::DEFAULT_STATE (shared _resize_frame engine).
export const DEFAULT_STATE = {
  version: 1,
  folder: "",
  recursive: false,
  sort: "name", // "name" | "date"
  sort_dir: "asc", // "asc" | "desc"
  selected: [], // file paths relative to folder, in display order
  // ── resize keys ──
  mode: "off",
  max_mp: 1.0,
  longest_side: 1024,
  scale_factor: 1.0,
  fit_w: 1024, fit_h: 1024,
  cover_w: 1024, cover_h: 1024,
  ratio_preset: "1:1",
  ratio_w: 1, ratio_h: 1,
  ratio_action: "crop",
  pad_color: "#808080",
  pad_top: 0, pad_bottom: 0, pad_left: 0, pad_right: 0,
  crop_anchor: "center", crop_scale: true,
  snap: 0,
  resample: "auto",
  allow_upscale: true,
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

// Sort a [{file, name, size, mtime}] list by the current sort + direction.
export function sortFiles(files, sort, dir) {
  const arr = [...(files || [])];
  arr.sort((a, b) => {
    let c;
    if (sort === "date") c = (a.mtime || 0) - (b.mtime || 0);
    else
      c = String(a.file).localeCompare(String(b.file), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    return dir === "desc" ? -c : c;
  });
  return arr;
}
