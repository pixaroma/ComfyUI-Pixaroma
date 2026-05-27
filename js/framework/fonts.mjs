// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Font Registry                                       ║
// ║  Lists bundled fonts, loads via FontFace API.                 ║
// ║  Used by Text Overlay node (and future Composer text layers). ║
// ║  Math doc: docs/text-overlay-render.md                        ║
// ╚═══════════════════════════════════════════════════════════════╝

const FONT_LIST_URL = "/pixaroma/api/fonts/list";
const FONT_BASE_URL = "/pixaroma/assets/fonts/";

let _catalog = null;
let _catalogPromise = null;
// Loaded file -> Promise<void> (one FontFace per file, registered for the full
// variable weight range; the canvas font string selects the active weight).
const _fileLoaders = new Map();

/** Fetch and cache the font catalog. Single-flight. */
export async function getFontCatalog() {
  if (_catalog) return _catalog;
  if (_catalogPromise) return _catalogPromise;
  _catalogPromise = (async () => {
    const resp = await fetch(FONT_LIST_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`fonts/list HTTP ${resp.status}`);
    _catalog = await resp.json();
    return _catalog;
  })();
  return _catalogPromise;
}

/** Clear the cached catalog and re-fetch, rescanning the drop-in folder. */
export async function refreshFontCatalog() {
  _catalog = null;
  // Assign the in-flight fetch to _catalogPromise so a concurrent
  // getFontCatalog() awaits THIS refresh instead of launching a second fetch.
  _catalogPromise = (async () => {
    const resp = await fetch(FONT_LIST_URL + "?refresh=1", { cache: "no-store" });
    if (!resp.ok) throw new Error(`fonts/list refresh HTTP ${resp.status}`);
    _catalog = await resp.json();
    return _catalog;
  })();
  return _catalogPromise;
}

/** Best-match font variant lookup. Falls back per math doc section 1. */
export function resolveFontVariant(catalog, fontId, weight, italic) {
  let font = catalog.find((f) => f.id === fontId);
  if (!font) {
    font = catalog.find((f) => f.id === "Inter");
    if (!font) throw new Error("Inter fallback font not in catalog");
  }
  // exact match
  let v = font.weights.find((w) => w.weight === weight && w.italic === !!italic);
  if (v) return makeVariant(font, v, false);
  // italic flip
  if (italic) {
    v = font.weights.find((w) => w.weight === weight && !w.italic);
    if (v) return makeVariant(font, v, true);
  }
  // closest weight
  const sameItalic = font.weights.filter((w) => w.italic === !!italic);
  const pool = sameItalic.length ? sameItalic : font.weights;
  v = pool.slice().sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
  return makeVariant(font, v, italic && !v.italic);
}

function makeVariant(font, w, synthesizedItalic) {
  return {
    fontId: font.id,
    weight: w.weight,
    italic: w.italic,
    file: w.file,
    wght: w.wght || null, // null = static font, no variable axis
    source: font.source || "builtin",
    synthesizedItalic,
  };
}

/** File URL for a variant. Custom fonts come from the drop-in serving route. */
export function urlForVariant(variant) {
  if (variant.source === "custom") {
    return `/pixaroma/api/fonts/file/${encodeURIComponent(variant.file)}`;
  }
  return FONT_BASE_URL + variant.file;
}

/** Load the underlying TTF file via FontFace API. Idempotent.
 *  For variable fonts, registers the full weight range so canvas can pick by weight. */
export async function ensureFontLoaded(variant) {
  const family = familyForVariant(variant);
  const fileKey = `${family}::${variant.file}`;
  if (_fileLoaders.has(fileKey)) return _fileLoaders.get(fileKey);
  const url = urlForVariant(variant);
  const descriptors = {
    style: variant.italic ? "italic" : "normal",
  };
  if (variant.wght) {
    // variable font: register full weight range
    descriptors.weight = "100 900";
  } else {
    // static font: single weight
    descriptors.weight = String(variant.weight);
  }
  const face = new FontFace(family, `url("${url}")`, descriptors);
  const p = (async () => {
    await face.load();
    document.fonts.add(face);
  })();
  _fileLoaders.set(fileKey, p);
  return p;
}

/** Family name used by FontFace + canvas. Italic gets a suffix so italic and
 *  non-italic of the same font don't collide when both register as "weight: 100 900". */
function familyForVariant(variant) {
  return `Pix-${variant.fontId}${variant.italic ? "-Italic" : ""}`;
}

/** Build the canvas-context `font` string for a variant + fontSize. */
export function canvasFontString(variant, fontSize) {
  const family = familyForVariant(variant);
  const style = variant.italic ? "italic " : "";
  return `${style}${variant.weight} ${fontSize}px "${family}"`;
}

/** Convenience: catalog + resolve + load in one call. */
export async function loadFontForLayer(fontId, weight, italic) {
  const catalog = await getFontCatalog();
  const variant = resolveFontVariant(catalog, fontId, weight, italic);
  await ensureFontLoaded(variant);
  return variant;
}
