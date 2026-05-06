// ============================================================
// Pixaroma Image Crop — Shared alignment constants
// ============================================================
// Used by both the on-node panel (panel.mjs) and the in-editor sidebar
// (core.mjs). h/v null means "Free, X/Y editable directly".
// ============================================================

export const ALIGNMENTS = [
  { id: "free", label: "Free",         h: null,     v: null     },
  { id: "tl",   label: "Top Left",     h: "left",   v: "top"    },
  { id: "tc",   label: "Top",          h: "center", v: "top"    },
  { id: "tr",   label: "Top Right",    h: "right",  v: "top"    },
  { id: "ml",   label: "Left",         h: "left",   v: "center" },
  { id: "mc",   label: "Center crop",  h: "center", v: "center" },
  { id: "mr",   label: "Right",        h: "right",  v: "center" },
  { id: "bl",   label: "Bottom Left",  h: "left",   v: "bottom" },
  { id: "bc",   label: "Bottom",       h: "center", v: "bottom" },
  { id: "br",   label: "Bottom Right", h: "right",  v: "bottom" },
];

export function getAlignment(id) {
  return ALIGNMENTS.find((a) => a.id === id) || ALIGNMENTS[0];
}

// Compute X/Y for a given alignment, crop size, and image dims.
// Returns null when alignment is "free" or dims are missing — caller falls
// back to whatever's in cropJson (or the editor's current X/Y).
export function computeAlignedXY(alignId, w, h, dims) {
  const a = getAlignment(alignId);
  if (!a.h || !dims) return null;
  let x = 0, y = 0;
  if (a.h === "left")   x = 0;
  else if (a.h === "center") x = Math.round((dims.w - w) / 2);
  else if (a.h === "right")  x = dims.w - w;
  if (a.v === "top")    y = 0;
  else if (a.v === "center") y = Math.round((dims.h - h) / 2);
  else if (a.v === "bottom") y = dims.h - h;
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

// Default alignment when cropJson has no `crop_align` saved.
// Fresh nodes (empty cropJson) default to "mc" (Center crop). Existing
// workflows that saved a custom crop without an align field stay on "free"
// so their previously-positioned X/Y is preserved.
export function defaultAlignForMeta(meta) {
  return meta && meta.crop_w ? "free" : "mc";
}
