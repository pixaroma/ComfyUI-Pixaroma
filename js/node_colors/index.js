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
// CROSS-TYPE: the session clipboard is SHARED between nodes and groups (Copy
// on one type, Paste on the other). A node carries two colors and a group one,
// so pickGroupColor() maps a pair → the more saturated of the two when applying
// to a group. Favorites, by contrast, live in SEPARATE per-type stores (node
// favorites vs group favorites), so saving a group color never overwrites a
// saved node color, and vice versa.
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
    { label: "Pixaroma Orange", title: "#f66744", body: "#242424" },
    { label: "Onyx", title: "#060606", body: "#141414" },
    { label: "Charcoal", title: "#262220", body: "#36312f" },
    { label: "Red", title: "#231011", body: "#351d1d" },
    { label: "Orange", title: "#231510", body: "#352620" },
    { label: "Amber", title: "#231a10", body: "#352a1d" },
    { label: "Gold", title: "#232010", body: "#35301d" },
    { label: "Lime", title: "#1a2310", body: "#28351d" },
    { label: "Green", title: "#102316", body: "#1d3525" },
    { label: "Teal", title: "#102223", body: "#1d3435" },
    { label: "Cyan", title: "#102123", body: "#1d3235" },
    { label: "Blue", title: "#101923", body: "#1d2835" },
    { label: "Indigo", title: "#131023", body: "#211d35" },
    { label: "Purple", title: "#1b1023", body: "#2b1d35" },
    { label: "Pink", title: "#23101c", body: "#35202f" },
  ] },
  { label: "Red", presets: [
    { label: "Deepest", title: "#2f0a0b", body: "#521416" },
    { label: "Moody", title: "#330b0c", body: "#5a1719" },
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
    { label: "Moody", title: "#331b0b", body: "#5a3216" },
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
    { label: "Moody", title: "#332909", body: "#5a4816" },
    { label: "Deep", title: "#362b0c", body: "#624e18" },
    { label: "Jewel", title: "#3c2f0b", body: "#6d5618" },
    { label: "Mid", title: "#493b12", body: "#7f6724" },
    { label: "Rich", title: "#514115", body: "#977a2b" },
    { label: "Bold", title: "#5f4d1b", body: "#9f8232" },
    { label: "Vivid", title: "#614e1a", body: "#ad8c34" },
    { label: "Bright", title: "#735e26", body: "#dab349" },
    { label: "Muted Deep", title: "#332e1e", body: "#544c36" },
    { label: "Slate", title: "#393423", body: "#5f543f" },
    { label: "Muted", title: "#494027", body: "#746744" },
    { label: "Muted Light", title: "#584c2d", body: "#958350" },
    { label: "Two-tone", title: "#59491c", body: "#9d8a2f" },
    { label: "Accent", title: "#a9912a", body: "#242424" },
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
    { label: "Two-tone", title: "#1c5921", body: "#2f9d4f" },
    { label: "Accent", title: "#38a83f", body: "#242424" },
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
    { label: "Accent", title: "#1f9d8a", body: "#242424" },
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
    { label: "Accent", title: "#1f9eb2", body: "#242424" },
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
    { label: "Deepest", title: "#140e2f", body: "#281452" },
    { label: "Moody", title: "#130e35", body: "#261454" },
    { label: "Deep", title: "#16103a", body: "#2d1862" },
    { label: "Jewel", title: "#181140", body: "#33196d" },
    { label: "Mid", title: "#1d1649", body: "#3f257f" },
    { label: "Rich", title: "#211a55", body: "#472d97" },
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
    { label: "Deepest", title: "#29092f", body: "#4a1452" },
    { label: "Moody", title: "#2c0935", body: "#50145a" },
    { label: "Deep", title: "#310b3c", body: "#591868" },
    { label: "Jewel", title: "#360b42", body: "#651879" },
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
    { label: "Accent", title: "#8f28a9", body: "#242424" },
  ] },
  { label: "Pink", presets: [
    { label: "Deepest", title: "#2f0a21", body: "#52143b" },
    { label: "Moody", title: "#340b24", body: "#5a1542" },
    { label: "Deep", title: "#360c27", body: "#621847" },
    { label: "Jewel", title: "#3d0c2d", body: "#6d1852" },
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

// Swatch sets for the Pick-custom modal - a modern, vibrant palette. Node titles
// now auto-pick readable white/dark ink (js/node_titles), so the TITLE strip is
// no longer constrained to dark fills. Brand orange + a dark gray are pinned
// first in BOTH strips. 3 rows of 12 each so the grid stays clean (no orphan
// row):
//   Row 1: brand orange, dark gray, then a neutral ramp
//   Row 2: warm vivid (red -> lime)
//   Row 3: cool vivid (green -> pink)
// TITLE = saturated header colors. BODY = rich DARK surfaces in matching hues
// (kept dark so node widgets stay readable on top). The strips are picked
// independently, so any title can pair with any body.

const TITLE_SWATCHES = [
  // Neutrals: brand orange, dark gray, then a gray ramp
  "#f66744", "#4a4a4e", "#000000", "#161618", "#222226", "#2e2e33",
  "#3c3c43", "#4d4d55", "#646470", "#8a8a96", "#5b524b", "#4b4540",
  // Warm vivid
  "#ef4444", "#dc2626", "#f97316", "#ea580c", "#f59e0b", "#d97706",
  "#eab308", "#ca8a04", "#84cc16", "#65a30d", "#b45309", "#9f1239",
  // Cool vivid
  "#22c55e", "#16a34a", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#2563eb", "#6366f1", "#8b5cf6", "#a855f7", "#ec4899",
];

const BODY_SWATCHES = [
  // Neutrals: dark gray + a warm dark (pairs with the orange title), then darks
  "#4a4a4e", "#2e2018", "#000000", "#101012", "#19191c", "#222226",
  "#2c2c31", "#383840", "#1c1a17", "#222019", "#2a2620", "#1a1a1a",
  // Warm rich-dark (match the warm title hues)
  "#4a1f1f", "#3d1818", "#4a2a14", "#3d2010", "#4a3414", "#3d2a10",
  "#463f14", "#3a3210", "#3a4514", "#2e3a10", "#3a2410", "#3a1420",
  // Cool rich-dark (match the cool title hues)
  "#16401f", "#164028", "#164035", "#163d3a", "#163a40", "#16344a",
  "#1a2e50", "#16204a", "#26204a", "#321d4a", "#3d1d44", "#40182e",
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
  // Quick-access, pinned first: Pixaroma brand orange + a neutral dark gray.
  { label: "Pixaroma Orange", color: "#f66744" },
  { label: "Dark Gray",       color: "#4a4a4e" },
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
  // Row 2 fill + Row 3 of the hand-picked hues (2 quick-access colors are pinned
  // at the very top of the list; the swatch grid flex-wraps, so exact rows vary).
  { label: "Light Indigo", color: "#9b8ad5" },
  { label: "Soft Indigo",  color: "#6a5fd3" },
  { label: "Mid Indigo",   color: "#4a3fcf" },
  { label: "Light Aqua",   color: "#8ad5cf" },
  { label: "Rich Red",     color: "#b52833" },
  { label: "Rich Orange",  color: "#b5602a" },
  { label: "Rich Amber",   color: "#b5862a" },
  { label: "Rich Gold",    color: "#9e8a2a" },
  { label: "Rich Lime",    color: "#7a9e2a" },
  { label: "Rich Green",   color: "#2f9e3f" },
  { label: "Rich Emerald", color: "#1f9e6a" },
  { label: "Rich Teal",    color: "#1f9285" },
  { label: "Rich Cyan",    color: "#1f85a8" },
  { label: "Rich Sky",     color: "#2f7fc0" },
  { label: "Rich Blue",    color: "#2a55cf" },
  { label: "Rich Violet",  color: "#6a3fcf" },
  { label: "Rich Purple",  color: "#9e3fc0" },
  { label: "Rich Magenta", color: "#c03f9e" },
  { label: "Rich Rose",    color: "#c03f5f" },
];
const GROUP_SWATCHES = GROUP_COLORS.map((c) => c.color);

// ── Favorites: 15 fixed slots, persisted as ONE compact JSON value in
// ComfyUI's settings store (unregistered key → no Settings-panel clutter;
// managed entirely through the right-click menu). Each slot is either
// null (empty) or { title, body }. These are the NODE favorites; GROUP
// favorites use a SEPARATE store (see GROUP_FAVORITES_ID below) so saving a
// group color can never overwrite a saved node color.
const FAVORITES_ID = "Pixaroma.NodeColors.Favorites";
// Matches the widest hue row (15 swatches) so the favorites fill exactly one
// line at the top of the palette.
const FAVORITE_SLOTS = 15;
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

// ── Group favorites: a SEPARATE 15-slot store from the node favorites above,
// so saving a group color never overwrites a saved node color (and the reverse
// can't happen either). A group has ONE color; each slot is stored as a flat
// { title:hex, body:hex } pair so it reuses the same validation + swatch
// helpers. There's no legacy single-favorite to migrate here, so the loader is
// a plain read-or-empty.
const GROUP_FAVORITES_ID = "Pixaroma.GroupColors.Favorites";
let _groupFavoritesCache = null;

function persistGroupFavorites(favs) {
  const s = app.ui?.settings;
  if (!s) return;
  const json = JSON.stringify(favs);
  try {
    if (typeof s.setSettingValueAsync === "function") s.setSettingValueAsync(GROUP_FAVORITES_ID, json);
    else if (typeof s.setSettingValue === "function") s.setSettingValue(GROUP_FAVORITES_ID, json);
  } catch (e) { /* non-fatal: the color is already applied to the group */ }
}

function getGroupFavorites() {
  if (_groupFavoritesCache) return _groupFavoritesCache;
  const s = app.ui?.settings;
  const raw = s?.getSettingValue?.(GROUP_FAVORITES_ID);
  if (raw) {
    try {
      _groupFavoritesCache = normalizeFavorites(typeof raw === "string" ? JSON.parse(raw) : raw);
      return _groupFavoritesCache;
    } catch (e) { /* corrupted → start empty */ }
  }
  _groupFavoritesCache = emptyFavorites();
  return _groupFavoritesCache;
}

function setGroupFavorites(favs) {
  _groupFavoritesCache = normalizeFavorites(favs);
  persistGroupFavorites(_groupFavoritesCache);
}

function saveGroupFavoriteSlot(index, color) {
  if (index < 0 || index >= FAVORITE_SLOTS) return;
  const favs = getGroupFavorites().slice();
  favs[index] = { title: color, body: color };
  setGroupFavorites(favs);
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
    if (isVueNodes()) {
      // Nodes 2.0 instruments node.color/bgcolor as reactive accessor
      // properties. `delete` removes the accessor itself, so the Vue node
      // never re-renders AND every later color assignment becomes a plain
      // (non-reactive) property — colors silently stop updating until reload.
      // Assign undefined through the setter instead: it fires the reactive
      // update, reverts to the theme default, and keeps the property live.
      n.color = undefined;
      n.bgcolor = undefined;
    } else {
      delete n.color;
      delete n.bgcolor;
    }
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
/* ── Nodes 2.0 swatch-palette popup ── */
.pix-nc-pal {
  width: 760px;          /* fits the widest hue (15 swatches) on one line */
  max-width: 96vw;
  min-width: 0;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 16px;
}
.pix-nc-pal-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
}
.pix-nc-pal-title { font-size: 15px; font-weight: 600; color: #e0e0e0; }
.pix-nc-pal-close {
  background: transparent; border: none; color: #999;
  font-size: 15px; line-height: 1; cursor: pointer;
  padding: 3px 7px; border-radius: 4px;
}
.pix-nc-pal-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
.pix-nc-pal-previewwrap { display: flex; justify-content: center; padding: 0 0 14px; }
.pix-nc-pal-scroll { overflow-y: auto; overflow-x: hidden; padding-right: 4px; }
.pix-nc-pal-section { margin-bottom: 10px; }
.pix-nc-pal-grouplabel {
  font: 11px system-ui, sans-serif; letter-spacing: 0.06em;
  text-transform: uppercase; color: #888; margin: 0 0 5px;
}
.pix-nc-pal-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.pix-nc-pal-swatch {
  width: 40px; height: 30px; border-radius: 5px;
  border: 1px solid rgba(255,255,255,0.15);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25);
  cursor: pointer; transition: border-color 0.1s;
}
.pix-nc-pal-swatch:hover { border-color: #f66744; }
.pix-nc-pal-empty {
  display: flex; align-items: center; justify-content: center;
  color: #555; background: rgba(255,255,255,0.03);
  cursor: default; box-shadow: none;
}
.pix-nc-pal-empty:hover { border-color: rgba(255,255,255,0.15); }
.pix-nc-pal-fav { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 40px; }
.pix-nc-pal-favsave {
  width: 40px; box-sizing: border-box; text-align: center;
  font: 9px system-ui, sans-serif;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.14);
  color: rgba(255,255,255,0.7);
  border-radius: 3px; padding: 2px 0; cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.pix-nc-pal-favsave:hover { background: #f66744; border-color: #f66744; color: #fff; }
/* 684 = 15*40 + 14*6: match the swatch-grid width so the buttons line up
   under the swatches and never overflow past them. border-box keeps flex:1
   from overshooting once padding/border are added. */
.pix-nc-pal-tools { display: flex; gap: 8px; margin-bottom: 14px; width: 684px; max-width: 100%; }
.pix-nc-pal-tools .pix-nc-btn { min-width: 0; flex: 1; padding: 6px 12px; box-sizing: border-box; }
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
  // Match the actual title-text color of the current renderer: Nodes 2.0
  // draws node titles near-white; legacy draws them dim gray (the #999 CSS
  // default on .pix-nc-preview-titlebar).
  if (isVueNodes()) titleBar.style.color = "#e6e6e6";
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
  const { initialTitle, initialBody, anchorRect = null, onPreview = () => {}, onApply, onCancel = () => {} } = opts;
  let titleHex = initialTitle;
  let bodyHex  = initialBody;

  // Side-floating (transparent overlay) so the node stays visible beside the
  // picker and recolors live as you drag. The overlay still captures an
  // outside click for cancel.
  const backdrop = document.createElement("div");
  backdrop.className = "pix-nc-backdrop";
  backdrop.style.background = "transparent";
  backdrop.style.display = "block";

  const modal = document.createElement("div");
  modal.className = "pix-nc-modal";
  modal.style.position = "fixed";
  modal.style.left = "-9999px";
  modal.style.top = "0px";

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
    onChange: (c) => { titleHex = c; preview.setTitle(c); onPreview(titleHex, bodyHex); },
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
    onChange: (c) => { bodyHex = c; preview.setBody(c); onPreview(titleHex, bodyHex); },
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
  makeDraggable(modal, titleEl);
  placeBeside(modal, anchorRect);

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

function pickCustom(nodes, anchorNode) {
  // Seed the picker with the node's CURRENT colors so the user can nudge an
  // existing color instead of starting from an unrelated one. anchorNode is the
  // right-clicked / selected node (its color is "the" color when several are
  // selected); captureColors falls back through class / LiteGraph defaults.
  const seed = captureColors(anchorNode || nodes[0]);
  // Snapshot raw colors so Cancel can restore exactly what was there before.
  const originals = nodes.map((n) => ({ color: n.color, bgcolor: n.bgcolor }));
  openCustomColorsModal({
    initialTitle: seed.title,
    initialBody:  seed.body,
    anchorRect: getNodeScreenRect(anchorNode || nodes[0]),
    onPreview: (titleHex, bodyHex) => applyColors(nodes, titleHex, bodyHex),
    onApply: (titleHex, bodyHex) => {
      applyColors(nodes, titleHex, bodyHex);
      colorClipboard = { title: titleHex, body: bodyHex };
    },
    onCancel: () => {
      nodes.forEach((n, i) => { n.color = originals[i].color; n.bgcolor = originals[i].bgcolor; });
      app.graph?.setDirtyCanvas(true, true);
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
  const { initial, anchorRect = null, onPreview = () => {}, onApply, onCancel = () => {} } = opts;
  let hex = initial;

  const backdrop = document.createElement("div");
  backdrop.className = "pix-nc-backdrop";
  backdrop.style.background = "transparent";
  backdrop.style.display = "block";

  const modal = document.createElement("div");
  modal.className = "pix-nc-modal pix-nc-modal-single";
  modal.style.position = "fixed";
  modal.style.left = "-9999px";
  modal.style.top = "0px";

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
    onChange: (c) => { hex = c; preview.setColor(c); onPreview(c); },
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
  makeDraggable(modal, titleEl);
  placeBeside(modal, anchorRect);

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

function pickCustomGroup(groups, anchorGroup) {
  // Seed from the group's CURRENT color so you can nudge it, mirroring the node
  // Pick-custom (which seeds from captureColors). captureGroupColor falls back to
  // the default when the group has no color set.
  const seed = captureGroupColor(anchorGroup || groups[0]);
  const originals = groups.map((g) => g.color);
  openGroupColorModal({
    initial: seed,
    anchorRect: getGroupScreenRect(anchorGroup || groups[0]),
    onPreview: (hex) => applyGroupColor(groups, hex),
    onApply: (hex) => {
      applyGroupColor(groups, hex);
      colorClipboard = { title: hex, body: hex };
    },
    onCancel: () => {
      groups.forEach((g, i) => {
        g.color = originals[i];
        if (typeof g.setDirtyCanvas === "function") g.setDirtyCanvas(false, true);
      });
      app.graph?.setDirtyCanvas(true, true);
    },
  });
}

// ── Swatch-palette popup (both renderers) ───────────────────────────────
// The Vue (Nodes 2.0) right-click menu renders only ONE fly-out level and
// strips inline swatch HTML to plain text, so the legacy 3-level nested color
// menu can't work there. In Nodes 2.0 the "Pixaroma Node/Group Colors" entry
// is a single click that opens this popup instead: a live preview + a visual
// grid of real color swatches (favorites + hue folders), plus Pick custom and
// Reset. The classic-renderer nested menu is left untouched.
function isVueNodes() {
  return !!(window.LiteGraph && window.LiteGraph.vueNodesMode);
}

function makeTwoToneSwatch(titleHex, bodyHex) {
  const el = document.createElement("div");
  el.className = "pix-nc-pal-swatch";
  el.style.background =
    `linear-gradient(to bottom, ${titleHex} 0%, ${titleHex} 45%, ${bodyHex} 45%, ${bodyHex} 100%)`;
  return el;
}

function makeSingleSwatch(hex) {
  const el = document.createElement("div");
  el.className = "pix-nc-pal-swatch";
  el.style.background = hex;
  return el;
}

// Shared shell: a free-floating panel (NO dimming backdrop) so the canvas
// stays visible and the node recolors live as you pick. Opens beside the
// target node/group (via place()), is draggable by its header, and closes
// on ✕, Escape, or a pointerdown anywhere outside it.
function makePalShell(titleText) {
  injectCSS();
  const modal = document.createElement("div");
  modal.className = "pix-nc-modal pix-nc-pal";
  modal.style.position = "fixed";
  modal.style.zIndex = "10000";
  modal.style.left = "-9999px";
  modal.style.top = "0px";

  const header = document.createElement("div");
  header.className = "pix-nc-pal-header";
  const titleEl = document.createElement("div");
  titleEl.className = "pix-nc-pal-title";
  titleEl.textContent = titleText;
  const closeX = document.createElement("button");
  closeX.type = "button";
  closeX.className = "pix-nc-pal-close";
  closeX.textContent = "✕";
  closeX.title = "Close";
  header.appendChild(titleEl);
  header.appendChild(closeX);
  modal.appendChild(header);

  document.body.appendChild(modal);

  function close() {
    document.removeEventListener("pointerdown", onDocDown, true);
    window.removeEventListener("keydown", onKey, true);
    if (modal.parentNode) modal.remove();
  }
  closeX.addEventListener("click", close);
  function onDocDown(e) { if (!modal.contains(e.target)) close(); }
  function onKey(e) {
    if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); close(); }
  }
  // Defer the outside-pointerdown listener so the click that opened the
  // popup doesn't immediately close it (Load Image popup pattern).
  setTimeout(() => document.addEventListener("pointerdown", onDocDown, true), 0);
  window.addEventListener("keydown", onKey, true);

  makeDraggable(modal, header);

  return { modal, close, place: (rect) => placeBeside(modal, rect) };
}

// Drag the panel by its header so the user can move it off whatever it
// overlaps. Pointer capture keeps the drag smooth and stops the
// outside-pointerdown close from firing mid-drag.
function makeDraggable(modal, handle) {
  handle.style.cursor = "move";
  let sx = 0, sy = 0, sl = 0, st = 0, dragging = false;
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pix-nc-pal-close")) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const r = modal.getBoundingClientRect();
    sl = r.left; st = r.top;
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
    e.stopPropagation();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.stopPropagation();
    modal.style.left = (sl + e.clientX - sx) + "px";
    modal.style.top = (st + e.clientY - sy) + "px";
  });
  const end = (e) => {
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// Position the panel beside a screen rect (the node/group): to its right,
// flipping to the left or clamping into the viewport as needed. No rect →
// center it.
function placeBeside(modal, rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = modal.offsetWidth, mh = modal.offsetHeight;
  const gap = 12, pad = 8;
  if (!rect) {
    modal.style.left = Math.max(pad, (vw - mw) / 2) + "px";
    modal.style.top = Math.max(pad, (vh - mh) / 2) + "px";
    return;
  }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw; // flip to the left
  if (left < pad) left = Math.max(pad, vw - mw - pad);   // last resort: pin right
  let top = rect.top;
  if (top + mh > vh - pad) top = vh - mh - pad;
  if (top < pad) top = pad;
  modal.style.left = left + "px";
  modal.style.top = top + "px";
}

// Screen-pixel rect of a node (DOM in Nodes 2.0, geometry math in legacy).
function getNodeScreenRect(node) {
  if (isVueNodes() && node?.id != null) {
    const el = document.querySelector('[data-node-id="' + node.id + '"]');
    if (el) return el.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c?.ds, canvasEl = c?.canvas;
  if (!ds || !canvasEl || !node?.pos || !node?.size) return null;
  const cr = canvasEl.getBoundingClientRect();
  const titleH = (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 30;
  const scale = ds.scale || 1, off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * scale;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * scale;
  const width = node.size[0] * scale;
  const height = (node.size[1] + titleH) * scale;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

// Screen-pixel rect of a group (canvas-painted in both renderers → math).
function getGroupScreenRect(group) {
  const c = app.canvas;
  const ds = c?.ds, canvasEl = c?.canvas;
  if (!ds || !canvasEl) return null;
  const b = group?._bounding
    || (group?.pos && group?.size ? [group.pos[0], group.pos[1], group.size[0], group.size[1]] : null);
  if (!b) return null;
  const cr = canvasEl.getBoundingClientRect();
  const scale = ds.scale || 1, off = ds.offset || [0, 0];
  const left = cr.left + (b[0] + off[0]) * scale;
  const top = cr.top + (b[1] + off[1]) * scale;
  const width = b[2] * scale, height = b[3] * scale;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function palSection(label) {
  const sec = document.createElement("div");
  sec.className = "pix-nc-pal-section";
  if (label) {
    const l = document.createElement("div");
    l.className = "pix-nc-pal-grouplabel";
    l.textContent = label;
    sec.appendChild(l);
  }
  const grid = document.createElement("div");
  grid.className = "pix-nc-pal-grid";
  sec.appendChild(grid);
  return { sec, grid };
}

function palToolBtn(text, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pix-nc-btn";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function openNodeColorsPalette(targets, node) {
  const suffix = targets.length > 1 ? ` (${targets.length} nodes)` : "";
  const { modal, close, place } = makePalShell(`Pixaroma Node Colors${suffix}`);

  // Live preview node — updates on hover, persists the applied combo.
  let applied = captureColors(node);
  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-nc-pal-previewwrap";
  const preview = buildPreviewNode(applied.title, applied.body);
  previewWrap.appendChild(preview.el);
  modal.appendChild(previewWrap);
  const showApplied = () => { preview.setTitle(applied.title); preview.setBody(applied.body); };

  const scroll = document.createElement("div");
  scroll.className = "pix-nc-pal-scroll";
  scroll.addEventListener("mouseleave", showApplied);
  modal.appendChild(scroll);

  const applyPair = (t, b) => { applyColors(targets, t, b); applied = { title: t, body: b }; showApplied(); };

  // Favorites: click a filled swatch to apply; per-slot Save captures the
  // node's CURRENT colors (so apply-then-Save stores the chosen combo).
  const favSec = document.createElement("div");
  favSec.className = "pix-nc-pal-section";
  const favLbl = document.createElement("div");
  favLbl.className = "pix-nc-pal-grouplabel";
  favLbl.textContent = "Favorites";
  favSec.appendChild(favLbl);
  const favGrid = document.createElement("div");
  favGrid.className = "pix-nc-pal-grid";
  favSec.appendChild(favGrid);
  function renderFavorites() {
    favGrid.innerHTML = "";
    const favs = getFavorites();
    for (let i = 0; i < FAVORITE_SLOTS; i++) {
      const f = favs[i];
      const tile = document.createElement("div");
      tile.className = "pix-nc-pal-fav";
      let sw;
      if (f) {
        sw = makeTwoToneSwatch(f.title, f.body);
        sw.title = `Favorite ${i + 1} — apply`;
        sw.addEventListener("mouseenter", () => { preview.setTitle(f.title); preview.setBody(f.body); });
        sw.addEventListener("click", () => applyPair(f.title, f.body));
      } else {
        sw = document.createElement("div");
        sw.className = "pix-nc-pal-swatch pix-nc-pal-empty";
        sw.textContent = "—";
        sw.title = `Favorite ${i + 1} (empty)`;
      }
      tile.appendChild(sw);
      const save = document.createElement("button");
      save.type = "button";
      save.className = "pix-nc-pal-favsave";
      save.textContent = "Save";
      save.title = `Save the node's current colors to slot ${i + 1}`;
      save.addEventListener("click", (e) => {
        e.stopPropagation();
        const c = captureColors(node);
        saveFavoriteSlot(i, c.title, c.body);
        renderFavorites();
      });
      tile.appendChild(save);
      favGrid.appendChild(tile);
    }
  }
  renderFavorites();
  favGrid.addEventListener("mouseleave", showApplied);
  scroll.appendChild(favSec);

  // Tools: Pick custom… / Reset.
  const tools = document.createElement("div");
  tools.className = "pix-nc-pal-tools";
  tools.appendChild(palToolBtn("Pick custom…", () => { close(); pickCustom(targets, node); }));
  tools.appendChild(palToolBtn("Reset colors", () => {
    resetColors(targets);
    applied = captureColors(node);
    showApplied();
  }));
  scroll.appendChild(tools);

  // Hue folders (Dark + the 10 hues), exactly the legacy preset set.
  for (const g of HUE_FOLDERS) {
    const { sec, grid } = palSection(g.label);
    for (const p of g.presets) {
      const sw = makeTwoToneSwatch(p.title, p.body);
      sw.title = `${g.label} — ${p.label}`;
      sw.addEventListener("mouseenter", () => { preview.setTitle(p.title); preview.setBody(p.body); });
      sw.addEventListener("click", () => applyPair(p.title, p.body));
      grid.appendChild(sw);
    }
    grid.addEventListener("mouseleave", showApplied);
    scroll.appendChild(sec);
  }

  place(getNodeScreenRect(node));
}

function openGroupColorsPalette(targets, group) {
  const suffix = targets.length > 1 ? ` (${targets.length} groups)` : "";
  const { modal, close, place } = makePalShell(`Pixaroma Group Colors${suffix}`);

  let applied = captureGroupColor(group);
  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-nc-pal-previewwrap";
  const preview = buildGroupPreview(applied);
  previewWrap.appendChild(preview.el);
  modal.appendChild(previewWrap);
  const showApplied = () => preview.setColor(applied);

  const scroll = document.createElement("div");
  scroll.className = "pix-nc-pal-scroll";
  scroll.addEventListener("mouseleave", showApplied);
  modal.appendChild(scroll);

  const applyOne = (hex) => { applyGroupColor(targets, hex); applied = hex; showApplied(); };

  // Favorites mapped to a single color via pickGroupColor; Save stores the
  // group's current color as a flat title==body pair (shared with nodes).
  const favSec = document.createElement("div");
  favSec.className = "pix-nc-pal-section";
  const favLbl = document.createElement("div");
  favLbl.className = "pix-nc-pal-grouplabel";
  favLbl.textContent = "Favorites";
  favSec.appendChild(favLbl);
  const favGrid = document.createElement("div");
  favGrid.className = "pix-nc-pal-grid";
  favSec.appendChild(favGrid);
  function renderFavorites() {
    favGrid.innerHTML = "";
    const favs = getGroupFavorites();
    for (let i = 0; i < FAVORITE_SLOTS; i++) {
      const f = favs[i];
      const tile = document.createElement("div");
      tile.className = "pix-nc-pal-fav";
      let sw;
      if (f) {
        const hex = pickGroupColor(f);
        sw = makeSingleSwatch(hex);
        sw.title = `Favorite ${i + 1} — apply`;
        sw.addEventListener("mouseenter", () => preview.setColor(hex));
        sw.addEventListener("click", () => applyOne(hex));
      } else {
        sw = document.createElement("div");
        sw.className = "pix-nc-pal-swatch pix-nc-pal-empty";
        sw.textContent = "—";
        sw.title = `Favorite ${i + 1} (empty)`;
      }
      tile.appendChild(sw);
      const save = document.createElement("button");
      save.type = "button";
      save.className = "pix-nc-pal-favsave";
      save.textContent = "Save";
      save.title = `Save the group's current color to slot ${i + 1}`;
      save.addEventListener("click", (e) => {
        e.stopPropagation();
        const c = captureGroupColor(group);
        saveGroupFavoriteSlot(i, c);
        renderFavorites();
      });
      tile.appendChild(save);
      favGrid.appendChild(tile);
    }
  }
  renderFavorites();
  favGrid.addEventListener("mouseleave", showApplied);
  scroll.appendChild(favSec);

  const tools = document.createElement("div");
  tools.className = "pix-nc-pal-tools";
  tools.appendChild(palToolBtn("Pick custom…", () => { close(); pickCustomGroup(targets, group); }));
  tools.appendChild(palToolBtn("Reset color", () => {
    resetGroupColor(targets);
    applied = captureGroupColor(group);
    showApplied();
  }));
  scroll.appendChild(tools);

  const { sec, grid } = palSection("Group colors");
  for (const c of GROUP_COLORS) {
    const sw = makeSingleSwatch(c.color);
    sw.title = c.label;
    sw.addEventListener("mouseenter", () => preview.setColor(c.color));
    sw.addEventListener("click", () => applyOne(c.color));
    grid.appendChild(sw);
  }
  grid.addEventListener("mouseleave", showApplied);
  scroll.appendChild(sec);

  place(getGroupScreenRect(group));
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
        // Both renderers open the swatch-palette popup (the Vue menu can't
        // render the old nested submenu, and the popup is the unified UI).
        options.push(null, {
          content: `👑 Pixaroma Node Colors (\\)${suffix}`,
          callback: () => openNodeColorsPalette(targets, node),
        });
        options.push({
          content: `👑 Copy Node Colors`,
          callback: () => { colorClipboard = captureColors(node); },
        });
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
          content: `👑 Pixaroma Group Colors (\\)${suffix}`,
          callback: () => openGroupColorsPalette(targets, group),
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

    // ── Keyboard shortcut: press "\" to open the color palette for the current
    // selection — selected node(s) take priority, else a selected group. Ignored
    // while typing in a field, with a modifier held, or when a palette is already
    // open. Only acts (and swallows the key) when something is selected, so a bare
    // "\" otherwise passes through to ComfyUI.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "\\" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector(".pix-nc-pal")) return;   // a palette is already open
      const c = app.canvas;
      if (!c) return;
      const nodes = c.selected_nodes ? Object.values(c.selected_nodes) : [];
      if (nodes.length) {
        e.preventDefault(); e.stopPropagation();
        openNodeColorsPalette(getTargetNodes(nodes[0]), nodes[0]);
        return;
      }
      const items = c.selectedItems;   // a Set mixing nodes + groups (Node Colors pattern)
      if (items && typeof items.forEach === "function") {
        let group = null;
        items.forEach((it) => { if (!group && typeof it?.recomputeInsideNodes === "function") group = it; });
        if (group) {
          e.preventDefault(); e.stopPropagation();
          openGroupColorsPalette(getTargetGroups(group), group);
        }
      }
    }, true);

    // Expose the group color palette so other Pixaroma canvas features (Group
    // Pixaroma) can open the exact same picker without re-importing this module
    // (importing an extension entry risks a second evaluation / double menu
    // wiring). Read-only handles to two module-scope fns; safe to call anytime.
    try {
      window.PixaromaGroupColors = {
        open: openGroupColorsPalette,
        getTargets: getTargetGroups,
      };
    } catch (_e) {}
  },
});
