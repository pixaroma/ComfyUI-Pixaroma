import { app } from "/scripts/app.js";
import { createPixaromaColorPicker } from "../shared/color_picker.mjs";

// ── Pixaroma node + group colors: right-click menu + presets + favorites ─
// NODES — right-click any node:
//   • 👑 Pixaroma Node Colors → favorites + Save to slot + Pick custom +
//     Neutrals / Plain hues / Pixa hues subfolders (title+body picker).
//   • 👑 Copy Node Colors / 👑 Paste Node Colors (session clipboard, pair).
//   • 👑 Reset Node Colors clears the override.
// GROUPS — right-click a group → TOP-LEVEL canvas menu (like nodes, NOT
// buried under "Edit Group"): 👑 Pixaroma Group Colors (favorites + Save +
//   Pick custom + the hand-picked GROUP_COLORS listed directly) + 👑 Copy
//   Group Color + 👑 Paste Group Color + 👑 Reset Group Color. Single-color
//   picker — a group has ONE fill color, not
//   title+body. Added by wrapping getCanvasMenuOptions and gating on a group
//   under the cursor (this.graph_mouse + graph.getGroupOnPos), since
//   getCanvasMenuOptions receives no event/position argument.
//
// Node colors → node.color / node.bgcolor; group color → group.color. Both
// serialize into the workflow JSON (groups[] array) and travel to recipients
// without this plugin installed. The group fill's ~25% transparency is
// LiteGraph's own rendering and is left untouched.
//
// CROSS-TYPE: the clipboard + the 4 favorite slots are SHARED between nodes
// and groups. A node carries two colors and a group one, so pickGroupColor()
// maps a pair → the more saturated of the two when applying to a group.
//
// Multi-select aware: when 2+ nodes (or groups) are selected AND the
// right-clicked one is among them, the action applies to all, and the label
// shows "(N nodes)" / "(N groups)".

// ── Theme system (May 2026 v3 — hue folders) ───────────────────────────
// The right-click "Pixaroma Node Colors" submenu lists ONE FOLDER PER HUE
// (Red … Pink). Each folder holds that hue's title+body shades, ordered
// dark → light (Deepest / Moody / Deep / Jewel / Mid / Rich / Bold / Vivid
// / Bright), then the muted variants (Muted Deep / Slate / Muted / Muted
// Light), then the specials (Two-tone = colored title with an analogous-
// hue body; Accent / Accent Dark = colored title on a neutral gray body).
//
// These 127 combos are the user's hand-curated finals (chosen May 2026 from
// a 140-swatch exploration sheet). title -> node.color, body -> node.bgcolor;
// both serialize into the workflow JSON and travel to recipients without
// this plugin. Each shade: { label, title, body }. To add/remove a shade,
// edit the relevant hue's `presets` array.
const HUE_FOLDERS = [
  { label: "Dark", presets: [
    { label: "Default", title: "#1d1d1d", body: "#2a2a2a" },
    { label: "Onyx", title: "#060606", body: "#141414" },
    { label: "Charcoal", title: "#262220", body: "#36312f" },
    { label: "Red", title: "#231011", body: "#351d1d" },
    { label: "Amber", title: "#231a10", body: "#352a1d" },
    { label: "Green", title: "#102316", body: "#1d3525" },
    { label: "Teal", title: "#102223", body: "#1d3435" },
    { label: "Blue", title: "#101923", body: "#1d2835" },
    { label: "Purple", title: "#1b1023", body: "#2b1d35" },
  ] },
  { label: "Red", presets: [
    { label: "Deepest", title: "#2f0a0b", body: "#521416" },
    { label: "Deep", title: "#360c0d", body: "#62181b" },
    { label: "Jewel", title: "#3c0b0d", body: "#6d181b" },
    { label: "Mid", title: "#491214", body: "#7f2427" },
    { label: "Rich", title: "#511517", body: "#972b2e" },
    { label: "Bold", title: "#5f1b1d", body: "#9f3236" },
    { label: "Vivid", title: "#611a1c", body: "#ad3438" },
    { label: "Bright", title: "#732629", body: "#da494e" },
    { label: "Muted Deep", title: "#331e1f", body: "#543637" },
    { label: "Slate", title: "#392324", body: "#5f3f40" },
    { label: "Muted", title: "#492728", body: "#744446" },
    { label: "Muted Light", title: "#582d2e", body: "#955053" },
    { label: "Accent", title: "#a9282c", body: "#242424" },
    { label: "Accent Dark", title: "#ab2b2f", body: "#1f1f1f" },
  ] },
  { label: "Orange", presets: [
    { label: "Deepest", title: "#2f180a", body: "#522d14" },
    { label: "Deep", title: "#361d0c", body: "#623618" },
    { label: "Jewel", title: "#3c1f0b", body: "#6d3a18" },
    { label: "Mid", title: "#492812", body: "#7f4824" },
    { label: "Rich", title: "#512d15", body: "#97562b" },
    { label: "Bold", title: "#5f361b", body: "#9f5e32" },
    { label: "Vivid", title: "#61361a", body: "#ad6434" },
    { label: "Bright", title: "#734526", body: "#da8349" },
    { label: "Muted Deep", title: "#33271e", body: "#544236" },
    { label: "Slate", title: "#392c23", body: "#5f4c3f" },
    { label: "Muted", title: "#493527", body: "#745744" },
    { label: "Muted Light", title: "#583e2d", body: "#956c50" },
    { label: "Accent", title: "#a95c28", body: "#242424" },
    { label: "Accent Dark", title: "#ab5e2b", body: "#1f1f1f" },
  ] },
  { label: "Gold", presets: [
    { label: "Deepest", title: "#2f250a", body: "#524114" },
    { label: "Deep", title: "#362b0c", body: "#624e18" },
    { label: "Jewel", title: "#3c2f0b", body: "#6d5618" },
    { label: "Mid", title: "#493b12", body: "#7f6724" },
    { label: "Rich", title: "#514115", body: "#977a2b" },
    { label: "Bold", title: "#5f4d1b", body: "#9f8232" },
    { label: "Vivid", title: "#614e1a", body: "#ad8c34" },
    { label: "Bright", title: "#735e26", body: "#dab349" },
    { label: "Muted Deep", title: "#332e1e", body: "#544c36" },
    { label: "Muted", title: "#494027", body: "#746744" },
    { label: "Muted Light", title: "#584c2d", body: "#958350" },
  ] },
  { label: "Green", presets: [
    { label: "Deepest", title: "#0a2f13", body: "#145224" },
    { label: "Moody", title: "#093514", body: "#125423" },
    { label: "Deep", title: "#0c3617", body: "#18622b" },
    { label: "Jewel", title: "#0b3c18", body: "#186d2d" },
    { label: "Mid", title: "#124920", body: "#247f3b" },
    { label: "Rich", title: "#155124", body: "#2b9746" },
    { label: "Bold", title: "#1b5f2c", body: "#329f4d" },
    { label: "Vivid", title: "#1a612b", body: "#34ad52" },
    { label: "Bright", title: "#267339", body: "#49da6d" },
    { label: "Muted Deep", title: "#1e3323", body: "#36543d" },
    { label: "Slate", title: "#233928", body: "#3f5f47" },
    { label: "Muted", title: "#274930", body: "#447450" },
    { label: "Muted Light", title: "#2d5838", body: "#509562" },
  ] },
  { label: "Teal", presets: [
    { label: "Deepest", title: "#0a2f27", body: "#145245" },
    { label: "Moody", title: "#09352c", body: "#125447" },
    { label: "Deep", title: "#0c362e", body: "#186253" },
    { label: "Jewel", title: "#0b3c32", body: "#186d5c" },
    { label: "Mid", title: "#12493e", body: "#247f6d" },
    { label: "Rich", title: "#155145", body: "#2b9781" },
    { label: "Bold", title: "#1b5f52", body: "#329f89" },
    { label: "Vivid", title: "#1a6152", body: "#34ad95" },
    { label: "Bright", title: "#267363", body: "#49dabd" },
    { label: "Muted Deep", title: "#1e332f", body: "#36544e" },
    { label: "Slate", title: "#233935", body: "#3f5f59" },
    { label: "Muted", title: "#274942", body: "#44746a" },
    { label: "Muted Light", title: "#2d584f", body: "#509587" },
    { label: "Two-tone", title: "#18594c", body: "#2f9d57" },
  ] },
  { label: "Cyan", presets: [
    { label: "Deepest", title: "#0a282f", body: "#144752" },
    { label: "Moody", title: "#092d35", body: "#124954" },
    { label: "Deep", title: "#0c2f36", body: "#185662" },
    { label: "Jewel", title: "#0b343c", body: "#185f6d" },
    { label: "Mid", title: "#124049", body: "#24707f" },
    { label: "Rich", title: "#154751", body: "#2b8597" },
    { label: "Bold", title: "#1b545f", body: "#328d9f" },
    { label: "Vivid", title: "#1a5561", body: "#3499ad" },
    { label: "Bright", title: "#266673", body: "#49c2da" },
    { label: "Muted Deep", title: "#1e3033", body: "#364f54" },
    { label: "Slate", title: "#233539", body: "#3f5a5f" },
    { label: "Muted", title: "#274349", body: "#446c74" },
    { label: "Muted Light", title: "#2d5058", body: "#508a95" },
    { label: "Two-tone", title: "#184e59", body: "#2f9d80" },
  ] },
  { label: "Blue", presets: [
    { label: "Deepest", title: "#0a1b2f", body: "#143152" },
    { label: "Moody", title: "#091d35", body: "#123154" },
    { label: "Deep", title: "#0c2036", body: "#183b62" },
    { label: "Jewel", title: "#0b223c", body: "#183f6d" },
    { label: "Mid", title: "#122c49", body: "#244f7f" },
    { label: "Rich", title: "#153151", body: "#2b5d97" },
    { label: "Bold", title: "#1b3b5f", body: "#32659f" },
    { label: "Vivid", title: "#1a3b61", body: "#346cad" },
    { label: "Bright", title: "#264a73", body: "#498dda" },
    { label: "Muted Deep", title: "#1e2833", body: "#364454" },
    { label: "Slate", title: "#232d39", body: "#3f4e5f" },
    { label: "Muted", title: "#273749", body: "#445a74" },
    { label: "Muted Light", title: "#2d4158", body: "#507095" },
    { label: "Two-tone", title: "#183659", body: "#2f929d" },
    { label: "Accent", title: "#2864a9", body: "#242424" },
  ] },
  { label: "Indigo", presets: [
    { label: "Bold", title: "#221b5f", body: "#3d329f" },
    { label: "Vivid", title: "#211a61", body: "#4034ad" },
    { label: "Bright", title: "#2e2673", body: "#5749da" },
    { label: "Muted Deep", title: "#201e33", body: "#393654" },
    { label: "Slate", title: "#252339", body: "#423f5f" },
    { label: "Muted", title: "#2b2749", body: "#494474" },
    { label: "Muted Light", title: "#312d58", body: "#575095" },
    { label: "Two-tone", title: "#1e1859", body: "#6a2f9d" },
    { label: "Accent Dark", title: "#382bab", body: "#1f1f1f" },
  ] },
  { label: "Purple", presets: [
    { label: "Mid", title: "#371249", body: "#61247f" },
    { label: "Rich", title: "#3d1551", body: "#732b97" },
    { label: "Bold", title: "#491b5f", body: "#7b329f" },
    { label: "Vivid", title: "#491a61", body: "#8434ad" },
    { label: "Bright", title: "#592673", body: "#a949da" },
    { label: "Muted Deep", title: "#2c1e33", body: "#4a3654" },
    { label: "Slate", title: "#322339", body: "#543f5f" },
    { label: "Muted", title: "#3e2749", body: "#644474" },
    { label: "Muted Light", title: "#492d58", body: "#7e5095" },
    { label: "Two-tone", title: "#431859", body: "#9d2f92" },
  ] },
  { label: "Pink", presets: [
    { label: "Deepest", title: "#2f0a21", body: "#52143b" },
    { label: "Deep", title: "#360c27", body: "#621847" },
    { label: "Mid", title: "#491235", body: "#7f245e" },
    { label: "Rich", title: "#51153b", body: "#972b6f" },
    { label: "Bold", title: "#5f1b46", body: "#9f3277" },
    { label: "Vivid", title: "#611a47", body: "#ad3480" },
    { label: "Bright", title: "#732657", body: "#da49a5" },
    { label: "Slate", title: "#392331", body: "#5f3f53" },
    { label: "Muted", title: "#49273d", body: "#744462" },
    { label: "Muted Light", title: "#582d48", body: "#95507c" },
    { label: "Two-tone", title: "#591841", body: "#9d2f45" },
    { label: "Accent", title: "#a9287a", body: "#242424" },
    { label: "Accent Dark", title: "#ab2b7c", body: "#1f1f1f" },
  ] },
];

// Curated swatch sets for the Pick custom modal. The default
// PIXAROMA_PALETTE has a wide range including bright pastels that read
// poorly as node chrome (LiteGraph paints title text in dim gray #999,
// which only contrasts on darker fills). These two palettes constrain
// the user to colors that actually look good as title / body fills.
//
// 3 rows of 12, same shape as the default palette:
//   Row 1: pure dark neutrals (gray ramp)
//   Row 2: warm hues (red / brown / amber / olive)
//   Row 3: cool hues (green / teal / blue / plum)
//
// Title palette sits at ~6-22% lightness so dim gray text reads.
// Body palette is the same hues shifted ~5-8 points lighter so the
// title-then-body Pixaroma convention is preserved (title slightly
// darker than body).

const TITLE_SWATCHES = [
  // Neutrals
  "#000000", "#0a0a0a", "#141414", "#1a1a1a", "#1d1d1d", "#242424",
  "#2a2a2a", "#2f2f2f", "#353535", "#3a3a3a", "#404040", "#4a4a4a",
  // Warm dark hues
  "#2a141b", "#3a141a", "#3a1d14", "#2e1f1f", "#2a1f12", "#3a2814",
  "#2a2614", "#1f2814", "#2a2a14", "#3a3514", "#3a3220", "#3a1d28",
  // Cool dark hues
  "#13261c", "#1f3327", "#102b2f", "#0d2a3a", "#1a2332", "#181f3a",
  "#1f1a3a", "#2a1a2e", "#3a1d3a", "#2e1f2e", "#3a1f2a", "#14143a",
];

const BODY_SWATCHES = [
  // Neutrals (slightly lighter than title row)
  "#141414", "#1a1a1a", "#1d1d1d", "#242424", "#2a2a2a", "#2f2f2f",
  "#353535", "#3a3a3a", "#404040", "#454545", "#4a4a4a", "#505050",
  // Warm hues (lighter than title row)
  "#3d1d28", "#4a1f24", "#4a281d", "#3d2e2e", "#3d2e1a", "#4d3a20",
  "#3d3520", "#2d3520", "#3d3d1d", "#4a4220", "#4d4230", "#4d281a",
  // Cool hues (lighter than title row)
  "#1d3a2d", "#284a3a", "#1a3f44", "#1a3a4d", "#25334a", "#232d55",
  "#2d2a5c", "#3d2842", "#4d2a4d", "#3d2a3d", "#4d2a3a", "#1f1f4d",
];

// ── Group colors. A group has a SINGLE fill color (no title/body split),
// and LiteGraph draws it at ~25% opacity (hardcoded in its renderer — not
// adjustable per group). We write the chosen hex straight to group.color,
// which serializes into the workflow's top-level groups[] array and reloads
// like node.color does. Presets reuse the same identity colors as the node
// themes: neutrals from the standalone bodies, hues from each HUE.main.
const GROUP_DEFAULT_COLOR = "#3f789e"; // LiteGraph's default (pale_blue)
// Hand-picked group colors (user selection, May 2026), ordered by hue then
// light → dark. Applied directly to group.color; the label is the menu name.
const GROUP_COLORS = [
  { label: "Light Red",    color: "#d57b7b" },
  { label: "Soft Red",     color: "#d35050" },
  { label: "Mid Red",      color: "#cf2a2a" },
  { label: "Light Orange", color: "#d5a57b" },
  { label: "Soft Orange",  color: "#d38d50" },
  { label: "Mid Orange",   color: "#cf772a" },
  { label: "Mid Gold",     color: "#cfa62a" },
  { label: "Light Lime",   color: "#c3d57b" },
  { label: "Soft Lime",    color: "#b9d350" },
  { label: "Mid Lime",     color: "#aecf2a" },
  { label: "Light Green",  color: "#8ad57b" },
  { label: "Soft Green",   color: "#65d350" },
  { label: "Rich Green",   color: "#38b21f" },
  { label: "Soft Teal",    color: "#50d3a3" },
  { label: "Mid Teal",     color: "#2acf93" },
  { label: "Deep Teal",    color: "#189164" },
  { label: "Soft Cyan",    color: "#50c2d3" },
  { label: "Rich Cyan",    color: "#1f9eb2" },
  { label: "Light Blue",   color: "#7ba1d5" },
  { label: "Soft Blue",    color: "#5086d3" },
  { label: "Mid Blue",     color: "#2a6fcf" },
  { label: "Light Violet", color: "#9c7bd5" },
  { label: "Soft Violet",  color: "#8050d3" },
  { label: "Light Pink",   color: "#d57bba" },
  { label: "Soft Pink",    color: "#d350ac" },
  { label: "Mid Pink",     color: "#cf2a9e" },
];
const GROUP_SWATCHES = GROUP_COLORS.map((c) => c.color);

// ── Favorites: 4 fixed slots, persisted as ONE compact JSON value in
// ComfyUI's settings store (unregistered key → no Settings-panel clutter;
// managed entirely through the right-click menu). Each slot is either
// null (empty) or { title, body }.
const FAVORITES_ID = "Pixaroma.NodeColors.Favorites";
const FAVORITE_SLOTS = 4;
// Legacy single-favorite settings (no longer shown in the panel). Read
// once for migration into slot 1 if a user had customized them.
const LEGACY_FAV_TITLE_ID = "Pixaroma.NodeColors.FavoriteTitle";
const LEGACY_FAV_BODY_ID  = "Pixaroma.NodeColors.FavoriteBody";
const LEGACY_DEFAULT_TITLE = "#1d1d1d";
const LEGACY_DEFAULT_BODY  = "#2a2a2a";

function emptyFavorites() {
  return new Array(FAVORITE_SLOTS).fill(null);
}

function normalizeFavorites(arr) {
  const out = emptyFavorites();
  if (Array.isArray(arr)) {
    for (let i = 0; i < FAVORITE_SLOTS; i++) {
      const e = arr[i];
      if (e && typeof e.title === "string" && typeof e.body === "string") {
        out[i] = { title: e.title, body: e.body };
      }
    }
  }
  return out;
}

// In-memory authoritative cache, write-through to the settings store.
// Reading from the cache instead of re-parsing the setting on every call
// keeps rapid saves consistent (no race against the async setter's flush)
// and makes the migrated / initial state impossible to lose mid-session.
let _favoritesCache = null;

function persistFavorites(favs) {
  const s = app.ui?.settings;
  if (!s) return;
  const json = JSON.stringify(favs);
  try {
    if (typeof s.setSettingValueAsync === "function") s.setSettingValueAsync(FAVORITES_ID, json);
    else if (typeof s.setSettingValue === "function") s.setSettingValue(FAVORITES_ID, json);
  } catch (e) { /* non-fatal: colors are already applied to the nodes */ }
}

function loadFavoritesFromStore() {
  const s = app.ui?.settings;
  const raw = s?.getSettingValue?.(FAVORITES_ID);
  if (raw) {
    try {
      return normalizeFavorites(typeof raw === "string" ? JSON.parse(raw) : raw);
    } catch (e) { /* corrupted → fall through to migration / empty */ }
  }
  // Nothing valid stored yet → migrate a non-default legacy favorite into
  // slot 1, otherwise start empty.
  const favs = emptyFavorites();
  const lt = s?.getSettingValue?.(LEGACY_FAV_TITLE_ID);
  const lb = s?.getSettingValue?.(LEGACY_FAV_BODY_ID);
  if (lt && lb && !(lt === LEGACY_DEFAULT_TITLE && lb === LEGACY_DEFAULT_BODY)) {
    favs[0] = { title: lt, body: lb };
    persistFavorites(favs); // lock the migration in so it can't be lost
  }
  return favs;
}

function getFavorites() {
  if (!_favoritesCache) _favoritesCache = loadFavoritesFromStore();
  return _favoritesCache;
}

function setFavorites(favs) {
  _favoritesCache = normalizeFavorites(favs);
  persistFavorites(_favoritesCache);
}

function saveFavoriteSlot(index, title, body) {
  if (index < 0 || index >= FAVORITE_SLOTS) return;
  const favs = getFavorites().slice();
  favs[index] = { title, body };
  setFavorites(favs);
}

// ── Session clipboard for Copy / Paste colors (cleared on page reload).
let colorClipboard = null; // { title, body } or null

// Effective colors of a node: explicit override → per-class default →
// LiteGraph default. So Copy / Save work even on a node still using the
// theme defaults.
function captureColors(node) {
  const dt = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_DEFAULT_COLOR) || "#1d1d1d";
  const db = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_DEFAULT_BGCOLOR) || "#2a2a2a";
  const title = node?.color   || node?.constructor?.color   || dt;
  const body  = node?.bgcolor || node?.constructor?.bgcolor || db;
  return { title, body };
}

function getTargetNodes(currentNode) {
  const sel = app.canvas?.selected_nodes;
  if (sel) {
    const nodes = Object.values(sel);
    if (nodes.length > 1 && nodes.includes(currentNode)) return nodes;
  }
  return [currentNode];
}

function applyColors(nodes, titleHex, bodyHex) {
  for (const n of nodes) {
    n.color   = titleHex;
    n.bgcolor = bodyHex;
  }
  app.graph?.setDirtyCanvas(true, true);
}

function resetColors(nodes) {
  for (const n of nodes) {
    delete n.color;
    delete n.bgcolor;
  }
  app.graph?.setDirtyCanvas(true, true);
}

// ── Group color helpers ─────────────────────────────────────────────────
// A node carries two colors; a group carries one. When moving color between
// the two (cross-type Copy/Paste, applying a Favorite to a group) we pick the
// MORE saturated of a node's title/body as the group's single identity color,
// so Plain (saturated body), Pixa (saturated title) and neutral themes all
// map to the color a human would call "that node's color".
function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colorfulness(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max === 0 ? 0 : (max - min) / max; // HSV saturation
}

function pickGroupColor(pair) {
  if (!pair) return GROUP_DEFAULT_COLOR;
  const t = pair.title, b = pair.body;
  if (!t) return b || GROUP_DEFAULT_COLOR;
  if (!b) return t;
  return colorfulness(t) > colorfulness(b) ? t : b;
}

// Multi-select aware: selectedItems is a Set holding nodes AND groups; keep
// only the groups when 2+ are selected and the right-clicked one is among
// them, else act on just the right-clicked group.
function getTargetGroups(currentGroup) {
  const items = app.canvas?.selectedItems;
  if (items && typeof items.forEach === "function" && currentGroup) {
    const groups = [];
    items.forEach((it) => { if (it instanceof currentGroup.constructor) groups.push(it); });
    if (groups.length > 1 && groups.includes(currentGroup)) return groups;
  }
  return [currentGroup];
}

function applyGroupColor(groups, hex) {
  for (const g of groups) {
    g.color = hex;
    if (typeof g.setDirtyCanvas === "function") g.setDirtyCanvas(false, true);
  }
  app.graph?.setDirtyCanvas(true, true);
}

function resetGroupColor(groups) {
  for (const g of groups) delete g.color; // reverts to LiteGraph default
  app.graph?.setDirtyCanvas(true, true);
}

function captureGroupColor(group) {
  return group?.color || GROUP_DEFAULT_COLOR;
}

// ── Custom-colors modal: side-by-side title + body pickers with a live
// node preview. Built from scratch (not openPixaromaColorPickerModal)
// because we want both pickers visible at once and a preview that
// updates as the user drags either SV plane.

function injectCSS() {
  if (document.getElementById("pix-nc-css")) return;
  const s = document.createElement("style");
  s.id = "pix-nc-css";
  s.textContent = `
.pix-nc-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 10000;
  display: flex; align-items: center; justify-content: center;
}
.pix-nc-modal {
  background: #1f1f1f;
  color: #e0e0e0;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  padding: 18px 22px 16px;
  min-width: 680px;
  max-width: 90vw;
  font: 13px system-ui, sans-serif;
}
/* Force the embedded color pickers to a proper roomy size with a
   Photoshop-style square SV plane (the picker module only sets this
   when the picker sits inside .pix-cp-modal-box, which is a sibling
   modal, so we replicate the override for our own modal class). */
.pix-nc-modal .pix-cp {
  width: 280px;
}
.pix-nc-modal .pix-cp-sv {
  aspect-ratio: 1;
  height: auto;
}
.pix-nc-modal-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 14px;
  text-align: center;
  color: #e0e0e0;
}
.pix-nc-preview-wrap {
  display: flex; justify-content: center;
  padding: 4px 0 18px;
}
.pix-nc-preview-node {
  width: 220px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 4px 14px rgba(0,0,0,0.5);
  overflow: hidden;
  transition: background 0.08s linear;
}
/* Preview matches LiteGraph's UNSELECTED node rendering: title text in
   dim gray (#999, the NODE_TITLE_COLOR default), regular weight, no
   bright-white overlay. When the user selects the actual node in the
   workflow the text flips white, but the saved workflow JSON only
   carries the base color, so the unselected look is what most viewers
   see most of the time. */
.pix-nc-preview-titlebar {
  padding: 6px 10px;
  font: 12px Tahoma, system-ui, sans-serif;
  font-weight: 400;
  color: #999;
  transition: background 0.08s linear;
}
.pix-nc-preview-body {
  padding: 8px 10px 10px;
  transition: background 0.08s linear;
}
.pix-nc-preview-row {
  font: 11px Tahoma, system-ui, sans-serif;
  color: rgba(255,255,255,0.5);
  padding: 2px 0;
  display: flex; align-items: center; gap: 6px;
}
.pix-nc-preview-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #f66744;
  display: inline-block;
  flex-shrink: 0;
}
.pix-nc-pickers {
  display: flex; gap: 20px;
  justify-content: center;
  margin-bottom: 12px;
}
.pix-nc-picker-col {
  display: flex; flex-direction: column;
  align-items: center;
}
.pix-nc-picker-label {
  font: 11px system-ui, sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #999;
  margin: 0 0 8px;
  align-self: stretch;
  text-align: center;
}
.pix-nc-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 8px;
}
.pix-nc-btn {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.88);
  padding: 7px 18px;
  border-radius: 4px;
  font: 12px system-ui, sans-serif;
  cursor: pointer;
  min-width: 84px;
  transition: background 0.1s, border-color 0.1s;
}
.pix-nc-btn:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.3);
}
.pix-nc-btn.primary {
  background: #f66744;
  border-color: #f66744;
  color: #fff;
}
.pix-nc-btn.primary:hover {
  background: #e85a3a;
  border-color: #e85a3a;
}
/* Single-color (group) variant of the modal: one picker column, narrower. */
.pix-nc-modal-single {
  min-width: 360px;
}
/* Group preview shows the fill at the same ~25% opacity LiteGraph uses, so
   the user sees how faint the color will actually look on the canvas. */
.pix-nc-grouppreview {
  width: 240px;
  height: 96px;
  border: 2px solid #3f789e;
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.5);
  background-color: rgba(63,120,158,0.25);
  transition: border-color 0.08s linear, background-color 0.08s linear;
}
.pix-nc-grouppreview-title {
  padding: 6px 10px;
  font: 12px Tahoma, system-ui, sans-serif;
  color: rgba(255,255,255,0.7);
}
  `;
  document.head.appendChild(s);
}

function buildPreviewNode(initialTitle, initialBody) {
  const el = document.createElement("div");
  el.className = "pix-nc-preview-node";

  const titleBar = document.createElement("div");
  titleBar.className = "pix-nc-preview-titlebar";
  titleBar.textContent = "Example Node";
  titleBar.style.background = initialTitle;
  el.appendChild(titleBar);

  const body = document.createElement("div");
  body.className = "pix-nc-preview-body";
  body.style.background = initialBody;
  el.appendChild(body);

  function row(label) {
    const r = document.createElement("div");
    r.className = "pix-nc-preview-row";
    const dot = document.createElement("span");
    dot.className = "pix-nc-preview-dot";
    r.appendChild(dot);
    const t = document.createElement("span");
    t.textContent = label;
    r.appendChild(t);
    return r;
  }
  body.appendChild(row("input"));
  body.appendChild(row("another input"));
  body.appendChild(row("widget"));

  return {
    el,
    setTitle: (c) => { titleBar.style.background = c; },
    setBody:  (c) => { body.style.background = c; },
  };
}

function openCustomColorsModal(opts) {
  injectCSS();
  const { initialTitle, initialBody, onApply, onCancel = () => {} } = opts;
  let titleHex = initialTitle;
  let bodyHex  = initialBody;

  const backdrop = document.createElement("div");
  backdrop.className = "pix-nc-backdrop";

  const modal = document.createElement("div");
  modal.className = "pix-nc-modal";

  const titleEl = document.createElement("div");
  titleEl.className = "pix-nc-modal-title";
  titleEl.textContent = "Pick custom colors";
  modal.appendChild(titleEl);

  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-nc-preview-wrap";
  const preview = buildPreviewNode(titleHex, bodyHex);
  previewWrap.appendChild(preview.el);
  modal.appendChild(previewWrap);

  const pickers = document.createElement("div");
  pickers.className = "pix-nc-pickers";

  // Title bar picker column
  const titleCol = document.createElement("div");
  titleCol.className = "pix-nc-picker-col";
  const titleLabel = document.createElement("div");
  titleLabel.className = "pix-nc-picker-label";
  titleLabel.textContent = "Title bar color";
  titleCol.appendChild(titleLabel);
  const titlePicker = createPixaromaColorPicker({
    initialColor: titleHex,
    swatches: TITLE_SWATCHES,
    hideReset: true,
    onChange: (c) => { titleHex = c; preview.setTitle(c); },
  });
  titleCol.appendChild(titlePicker.element);
  pickers.appendChild(titleCol);

  // Body picker column
  const bodyCol = document.createElement("div");
  bodyCol.className = "pix-nc-picker-col";
  const bodyLabel = document.createElement("div");
  bodyLabel.className = "pix-nc-picker-label";
  bodyLabel.textContent = "Body color";
  bodyCol.appendChild(bodyLabel);
  const bodyPicker = createPixaromaColorPicker({
    initialColor: bodyHex,
    swatches: BODY_SWATCHES,
    hideReset: true,
    onChange: (c) => { bodyHex = c; preview.setBody(c); },
  });
  bodyCol.appendChild(bodyPicker.element);
  pickers.appendChild(bodyCol);

  modal.appendChild(pickers);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "pix-nc-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pix-nc-btn";
  cancelBtn.textContent = "Cancel";
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "pix-nc-btn primary";
  applyBtn.textContent = "Apply";
  actions.appendChild(cancelBtn);
  actions.appendChild(applyBtn);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  function close() {
    window.removeEventListener("keydown", onKey, true);
    titlePicker.destroy();
    bodyPicker.destroy();
    if (backdrop.parentNode) backdrop.remove();
  }

  applyBtn.addEventListener("click", () => { onApply(titleHex, bodyHex); close(); });
  cancelBtn.addEventListener("click", () => { onCancel(); close(); });

  // Click-outside-to-cancel, but ONLY if both mousedown AND click happened
  // on the backdrop. A drag that starts in the SV plane and releases off
  // the modal would otherwise cancel and discard the user's pick.
  let mouseDownOnBackdrop = false;
  backdrop.addEventListener("mousedown", (e) => {
    mouseDownOnBackdrop = (e.target === backdrop);
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && mouseDownOnBackdrop) { onCancel(); close(); }
    mouseDownOnBackdrop = false;
  });

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopImmediatePropagation();
      e.preventDefault();
      onCancel();
      close();
    } else if (e.key === "Enter") {
      e.stopImmediatePropagation();
      e.preventDefault();
      onApply(titleHex, bodyHex);
      close();
    }
  }
  window.addEventListener("keydown", onKey, true);
}

function pickCustom(nodes) {
  const seed = colorClipboard
    || getFavorites().find((f) => f)
    || { title: "#1d1d1d", body: "#2a2a2a" };
  openCustomColorsModal({
    initialTitle: seed.title,
    initialBody:  seed.body,
    onApply: (titleHex, bodyHex) => {
      applyColors(nodes, titleHex, bodyHex);
      colorClipboard = { title: titleHex, body: bodyHex };
    },
  });
}

// ── Single-color modal for groups (one picker + a preview that mimics the
// ~25% group transparency so the faint look isn't a surprise).
function buildGroupPreview(initial) {
  const el = document.createElement("div");
  el.className = "pix-nc-grouppreview";
  const title = document.createElement("div");
  title.className = "pix-nc-grouppreview-title";
  title.textContent = "Group";
  el.appendChild(title);
  function setColor(c) {
    const rgb = hexToRgb(c) || { r: 63, g: 120, b: 158 };
    el.style.borderColor = c;
    el.style.backgroundColor = `rgba(${rgb.r},${rgb.g},${rgb.b},0.25)`;
  }
  setColor(initial);
  return { el, setColor };
}

function openGroupColorModal(opts) {
  injectCSS();
  const { initial, onApply, onCancel = () => {} } = opts;
  let hex = initial;

  const backdrop = document.createElement("div");
  backdrop.className = "pix-nc-backdrop";

  const modal = document.createElement("div");
  modal.className = "pix-nc-modal pix-nc-modal-single";

  const titleEl = document.createElement("div");
  titleEl.className = "pix-nc-modal-title";
  titleEl.textContent = "Pick group color";
  modal.appendChild(titleEl);

  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-nc-preview-wrap";
  const preview = buildGroupPreview(hex);
  previewWrap.appendChild(preview.el);
  modal.appendChild(previewWrap);

  const pickers = document.createElement("div");
  pickers.className = "pix-nc-pickers";
  const col = document.createElement("div");
  col.className = "pix-nc-picker-col";
  const label = document.createElement("div");
  label.className = "pix-nc-picker-label";
  label.textContent = "Group color";
  col.appendChild(label);
  const picker = createPixaromaColorPicker({
    initialColor: hex,
    swatches: GROUP_SWATCHES,
    hideReset: true,
    onChange: (c) => { hex = c; preview.setColor(c); },
  });
  col.appendChild(picker.element);
  pickers.appendChild(col);
  modal.appendChild(pickers);

  const actions = document.createElement("div");
  actions.className = "pix-nc-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pix-nc-btn";
  cancelBtn.textContent = "Cancel";
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "pix-nc-btn primary";
  applyBtn.textContent = "Apply";
  actions.appendChild(cancelBtn);
  actions.appendChild(applyBtn);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  function close() {
    window.removeEventListener("keydown", onKey, true);
    picker.destroy();
    if (backdrop.parentNode) backdrop.remove();
  }

  applyBtn.addEventListener("click", () => { onApply(hex); close(); });
  cancelBtn.addEventListener("click", () => { onCancel(); close(); });

  let mouseDownOnBackdrop = false;
  backdrop.addEventListener("mousedown", (e) => { mouseDownOnBackdrop = (e.target === backdrop); });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && mouseDownOnBackdrop) { onCancel(); close(); }
    mouseDownOnBackdrop = false;
  });

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopImmediatePropagation(); e.preventDefault(); onCancel(); close();
    } else if (e.key === "Enter") {
      e.stopImmediatePropagation(); e.preventDefault(); onApply(hex); close();
    }
  }
  window.addEventListener("keydown", onKey, true);
}

function pickCustomGroup(groups) {
  const fav = getFavorites().find((f) => f);
  const seed = colorClipboard
    ? pickGroupColor(colorClipboard)
    : (fav ? pickGroupColor(fav) : GROUP_DEFAULT_COLOR);
  openGroupColorModal({
    initial: seed,
    onApply: (hex) => {
      applyGroupColor(groups, hex);
      colorClipboard = { title: hex, body: hex };
    },
  });
}

// Inline swatch HTML for a menu entry: a small "node-shaped" chip that
// shows the title color on top (50%) and the body color on bottom (50%).
// Mimics what an actual ComfyUI node looks like at a glance.
function swatchHTML(titleHex, bodyHex) {
  return `<span style="display:inline-block; width:32px; height:14px; border:1px solid rgba(255,255,255,0.18); border-radius:3px; vertical-align:middle; margin-right:10px; background: linear-gradient(to bottom, ${titleHex} 0%, ${titleHex} 50%, ${bodyHex} 50%, ${bodyHex} 100%);"></span>`;
}

// Solid single-color chip for group menu entries.
function swatchHTMLSingle(hex) {
  return `<span style="display:inline-block; width:32px; height:14px; border:1px solid rgba(255,255,255,0.18); border-radius:3px; vertical-align:middle; margin-right:10px; background:${hex};"></span>`;
}

// Sub-submenu listing the 4 favorite slots; picking one writes the
// right-clicked node's colors into that slot.
function buildSaveSubmenu(node) {
  const favs = getFavorites();
  return favs.map((f, i) => ({
    content: f
      ? `${swatchHTML(f.title, f.body)}Favorite ${i + 1}`
      : `Favorite ${i + 1} (empty)`,
    callback: () => {
      const c = captureColors(node);
      saveFavoriteSlot(i, c.title, c.body);
    },
  }));
}

// A hue folder rendered as its own sub-submenu — lists that hue's shades.
function buildPresetGroupSubmenu(targets, presets) {
  return presets.map((p) => ({
    content: `${swatchHTML(p.title, p.body)}${p.label}`,
    callback: () => applyColors(targets, p.title, p.body),
  }));
}

function buildSubmenuOptions(targets, node) {
  const items = [];

  // Personal / quick items on top — fastest to reach.
  // Favorites (only the filled slots are applyable here).
  const favs = getFavorites();
  const filled = favs.map((f, i) => ({ f, i })).filter((x) => x.f);
  for (const { f, i } of filled) {
    items.push({
      content: `${swatchHTML(f.title, f.body)}Favorite ${i + 1}`,
      callback: () => applyColors(targets, f.title, f.body),
    });
  }
  if (filled.length) items.push(null); // separator: favorites -> save/custom

  items.push({
    content: "Save these colors to",
    has_submenu: true,
    callback: function (value, opts, e, menu) {
      new LiteGraph.ContextMenu(
        buildSaveSubmenu(node),
        { event: e, parentMenu: menu, node: node }
      );
    },
  });
  items.push({
    content: "Pick custom...",
    callback: () => pickCustom(targets),
  });

  items.push(null); // separator: personal -> hue folders

  // One folder per hue; each opens that hue's shades (dark -> light).
  for (const g of HUE_FOLDERS) {
    items.push({
      content: g.label,
      has_submenu: true,
      callback: function (value, opts, e, menu) {
        new LiteGraph.ContextMenu(
          buildPresetGroupSubmenu(targets, g.presets),
          { event: e, parentMenu: menu, node: node }
        );
      },
    });
  }

  return items;
}

// ── Group menu builders (single color) ──────────────────────────────────
// Save the group's current color into one of the 4 SHARED favorite slots,
// stored as a flat title==body pair so the slot is still usable from the
// node menu.
function buildGroupSaveSubmenu(group) {
  const favs = getFavorites();
  return favs.map((f, i) => ({
    content: f
      ? `${swatchHTML(f.title, f.body)}Favorite ${i + 1}`
      : `Favorite ${i + 1} (empty)`,
    callback: () => {
      const c = captureGroupColor(group);
      saveFavoriteSlot(i, c, c);
    },
  }));
}

// The "👑 Pixaroma Group Colors" submenu for a group: filled Favorites on top,
// then Save / Pick custom, then the hand-picked group colors listed
// DIRECTLY (no Neutrals/Hues subfolders). Copy / Paste / Reset are
// top-level siblings (see setup()).
function buildGroupColorsSubmenu(targets, group) {
  const items = [];

  // Favorites (filled only) — applies each favorite's identity color.
  const filled = getFavorites().map((f, i) => ({ f, i })).filter((x) => x.f);
  for (const { f, i } of filled) {
    items.push({
      content: `${swatchHTML(f.title, f.body)}Favorite ${i + 1}`,
      callback: () => applyGroupColor(targets, pickGroupColor(f)),
    });
  }
  if (filled.length) items.push(null); // separator: favorites -> save/custom

  items.push({
    content: "Save this color to",
    has_submenu: true,
    callback: function (value, opts, e, menu) {
      new LiteGraph.ContextMenu(
        buildGroupSaveSubmenu(group),
        { event: e, parentMenu: menu }
      );
    },
  });
  items.push({
    content: "Pick custom...",
    callback: () => pickCustomGroup(targets),
  });
  items.push(null); // separator: save/custom -> colors

  // Hand-picked group colors, listed directly.
  for (const c of GROUP_COLORS) {
    items.push({
      content: `${swatchHTMLSingle(c.color)}${c.label}`,
      callback: () => applyGroupColor(targets, c.color),
    });
  }
  return items;
}

app.registerExtension({
  name: "Pixaroma.NodeColors",

  async setup() {
    // ── Node right-click menu ──────────────────────────────────────────
    if (typeof LGraphCanvas !== "undefined" && LGraphCanvas?.prototype?.getNodeMenuOptions) {
      const origGetNodeMenuOptions = LGraphCanvas.prototype.getNodeMenuOptions;
      LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
        const options = origGetNodeMenuOptions.apply(this, arguments);
        const targets = getTargetNodes(node);
        const count   = targets.length;
        const suffix  = count > 1 ? ` (${count} nodes)` : "";
        options.push(
          null,
          {
            content: `👑 Pixaroma Node Colors${suffix}`,
            has_submenu: true,
            callback: function (value, opts, e, menu) {
              new LiteGraph.ContextMenu(
                buildSubmenuOptions(targets, node),
                { event: e, parentMenu: menu, node: node }
              );
            },
          },
          {
            content: `👑 Copy Node Colors`,
            callback: () => { colorClipboard = captureColors(node); },
          }
        );
        // Paste only appears once colors have been copied this session.
        if (colorClipboard) {
          options.push({
            content: `👑 Paste Node Colors${suffix}`,
            callback: () => applyColors(targets, colorClipboard.title, colorClipboard.body),
          });
        }
        options.push({
          content: `👑 Reset Node Colors${suffix}`,
          callback: () => resetColors(targets),
        });
        return options;
      };
    }

    // ── Group colors at the TOP LEVEL of the canvas right-click menu ────
    // (like the node entries — NOT buried under "Edit Group"). The canvas
    // menu is built by getCanvasMenuOptions; processContextMenu appends
    // "Edit Group" right after when a group is under the cursor, so our
    // entries sit just above it. getCanvasMenuOptions receives no event, so
    // we read the right-click position from this.graph_mouse (graph space)
    // and gate on a group being under it — node right-clicks go through
    // getNodeMenuOptions instead, so there's no double-add. Groups have one
    // fill color; the clipboard + favorites are SHARED with nodes
    // (cross-type) via pickGroupColor.
    if (typeof LGraphCanvas !== "undefined" && LGraphCanvas?.prototype?.getCanvasMenuOptions) {
      const origGetCanvasMenuOptions = LGraphCanvas.prototype.getCanvasMenuOptions;
      LGraphCanvas.prototype.getCanvasMenuOptions = function () {
        const options = origGetCanvasMenuOptions.apply(this, arguments) || [];
        const graph = this.graph || app.graph;
        const gm = this.graph_mouse || app.canvas?.graph_mouse;
        let group = null;
        if (graph && typeof graph.getGroupOnPos === "function" && gm) {
          group = graph.getGroupOnPos(gm[0], gm[1]) || null;
        }
        if (!group) return options; // empty canvas → leave the menu alone

        const targets = getTargetGroups(group);
        const suffix = targets.length > 1 ? ` (${targets.length} groups)` : "";
        options.push(null);
        options.push({
          content: `👑 Pixaroma Group Colors${suffix}`,
          has_submenu: true,
          callback: function (value, opts, e, menu) {
            new LiteGraph.ContextMenu(
              buildGroupColorsSubmenu(targets, group),
              { event: e, parentMenu: menu }
            );
          },
        });
        options.push({
          content: `👑 Copy Group Color`,
          callback: () => {
            const c = captureGroupColor(group);
            colorClipboard = { title: c, body: c };
          },
        });
        if (colorClipboard) {
          options.push({
            content: `👑 Paste Group Color${suffix}`,
            callback: () => applyGroupColor(targets, pickGroupColor(colorClipboard)),
          });
        }
        options.push({
          content: `👑 Reset Group Color${suffix}`,
          callback: () => resetGroupColor(targets),
        });
        return options;
      };
    }
  },
});
