import { app } from "/scripts/app.js";
import { createPixaromaColorPicker } from "../shared/color_picker.mjs";

// ── Pixaroma node + group colors: right-click menu + presets + favorites ─
// NODES — right-click any node:
//   • 👑 Pixaroma Node Colors → opens the embedded palette (SV+hue picker with
//     a Title/Body toggle, dark hex bars, favourites strip, hue-folder presets).
//   • 👑 Copy Node Colors / 👑 Paste Node Colors (session clipboard, pair).
//   • 👑 Reset Node Colors clears the override.
// GROUPS — right-click a group → TOP-LEVEL canvas menu (like nodes, NOT
// buried under "Edit Group"): 👑 Pixaroma Group Colors (the same palette with
//   one picker + Transparency / Interior-fill sliders + the hand-picked
//   GROUP_COLORS) + 👑 Copy Group Color + 👑 Paste Group Color + 👑 Reset Group
//   Color. Single-color picker — a group has ONE fill color, not
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
// NOTE (2026-06-23): HUE_FOLDERS is no longer shown in the palette — the node
// presets now derive from GROUP_COLORS (see NODE_PAIRS below). This curated
// data is kept for reference / possible reuse; safe to delete if never revived.
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
    // 15 = one clean row in the palette popup (was 16, the 16th wrapped).
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
  // Exactly 45 colors = 3 even rows of 15 in the palette popup (no stray 4th row).
];

// Node color PRESETS derive from the 45 GROUP_COLORS so the node + group
// palettes share ONE hue set (user choice, 2026-06-23). Each renders as a node:
// the colorful group hue is the TITLE bar over a dark, faintly hue-tinted BODY
// (kept dark so node widgets stay readable). darkBodyFor mixes a 15% wash of the
// hue into the #242424 neutral. (The legacy hand-picked HUE_FOLDERS pairs above
// are no longer shown in the palette — kept for reference / possible reuse.)
function darkBodyFor(hex) {
  const c = hexToRgb(hex) || { r: 36, g: 36, b: 36 };
  const mix = (ch) => Math.round(0.85 * 0x24 + 0.15 * ch);
  const to2 = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return "#" + to2(mix(c.r)) + to2(mix(c.g)) + to2(mix(c.b));
}
const NODE_PAIRS = GROUP_COLORS.map((c) => ({ label: c.label, title: c.color, body: darkBodyFor(c.color) }));

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
    // Pin a Set/Get "Get" so its Set-mirror stops reverting this manual color
    // (colors ONLY the selected node, not its Set or sibling Gets). No-op otherwise.
    try { window.PixaromaSetGet?.markManualColor?.(n, true); } catch (_e) {}
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
    // Un-pin a Set/Get "Get" so it resumes mirroring its Set's color. No-op otherwise.
    try { window.PixaromaSetGet?.markManualColor?.(n, false); } catch (_e) {}
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

// All currently-selected groups (selectedItems is a Set mixing nodes + groups; a
// group duck-types via recomputeInsideNodes). Used so the "\" shortcut can color
// nodes AND groups together when both are selected.
function getSelectedGroups() {
  const items = app.canvas?.selectedItems;
  const groups = [];
  if (items && typeof items.forEach === "function") {
    items.forEach((it) => { if (it && typeof it.recomputeInsideNodes === "function") groups.push(it); });
  }
  return groups;
}

function resetGroupColor(groups) {
  for (const g of groups) delete g.color; // reverts to LiteGraph default
  app.graph?.setDirtyCanvas(true, true);
}

function captureGroupColor(group) {
  return group?.color || GROUP_DEFAULT_COLOR;
}

// ── Palette popup CSS (one injected stylesheet). The palette embeds the
// shared Pixaroma color picker (SV + hue) directly, with its own dark hex
// bar(s), a 2-wide favourites strip, and a small preset grid — all live-apply,
// so there is no preview box and no separate "Pick custom" modal.

function injectCSS() {
  if (document.getElementById("pix-nc-css")) return;
  const s = document.createElement("style");
  s.id = "pix-nc-css";
  s.textContent = `
.pix-nc-modal {
  background: #1f1f1f;
  color: #e0e0e0;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  font: 13px system-ui, sans-serif;
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
/* ── Palette popup shell (free-floating, draggable; both renderers) ── */
.pix-nc-pal {
  width: 470px;          /* embedded-picker layout: comfortable square picker + a small 15-wide preset grid */
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
.pix-nc-pal-scroll { overflow-y: auto; overflow-x: hidden; padding-right: 4px; }

/* ── Redesigned palette: embedded picker + favourites strip + dark/orange
   hex bars + small full-width preset grid (replaces the preview box +
   separate "Pick custom" modal). ── */
.pix-nc-pal-scroll { flex: 1 1 auto; min-height: 0; }
.pix-nc-prow { display: flex; gap: 12px; align-items: flex-start; margin: 0 0 2px; }
.pix-nc-pickerwrap { flex: 1 1 auto; min-width: 0; display: flex; }
.pix-nc-pickerwrap .pix-cp { width: 100%; gap: 0; }
/* FIXED-height SV plane — NOT aspect-ratio, NOT flex-stretch. The shared
   picker's renderSV writes canvas.height = clientHeight on every paint, so ANY
   layout-derived height (flex stretch, OR aspect-ratio inside a flex row) feeds
   back and the plane grows on every drag (the More-colors modal is immune only
   because it's a fixed-WIDTH block, not a flex item). A fixed CSS px height makes
   clientHeight constant => canvas.height constant => no feedback. Hue matches it.
   min-width:0 lets the SV shrink so the 16px hue strip fits beside it (a canvas's
   intrinsic width otherwise acts as a min-content floor and pushes the hue out). */
.pix-nc-pickerwrap .pix-cp-sv { height: 300px; min-width: 0; border-radius: 6px; border-color: #45454c; }
.pix-nc-pickerwrap .pix-cp-hue { width: 16px; height: 300px; border-radius: 6px; border-color: #45454c; }
.pix-nc-pickerwrap .pix-cp-hexrow { display: none; }
/* 66px keeps the 8-row favourites column ~300px tall to match the SV height,
   so the picker and favourites bottoms line up. */
.pix-nc-favcol { flex: 0 0 66px; display: flex; flex-direction: column; }
.pix-nc-favlbl { font: 11px system-ui, sans-serif; letter-spacing: 0.06em; color: #8a8a90; margin: 0 0 6px; }
.pix-nc-favgrid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; align-content: start; }
.pix-nc-sw {
  width: 100%; aspect-ratio: 1; border-radius: 5px;
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25);
  cursor: pointer; transition: border-color 0.1s;
}
.pix-nc-sw:hover { border-color: #f66744; }
.pix-nc-fav-empty {
  width: 100%; aspect-ratio: 1; border-radius: 5px;
  border: 1px dashed rgba(255,255,255,0.2);
}
.pix-nc-addfav {
  width: 100%; aspect-ratio: 1; border-radius: 5px;
  border: 1px dashed #f66744; color: #f66744;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; line-height: 1; cursor: pointer; transition: background 0.1s;
}
.pix-nc-addfav:hover { background: rgba(246,103,68,0.14); }
.pix-nc-hexwrap { display: flex; gap: 8px; margin: 10px 0 0; }
.pix-nc-hexbar {
  flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 8px;
  background: #161616; border: 1px solid #3a3a40; border-radius: 6px; padding: 6px 9px;
}
.pix-nc-chip { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); flex: 0 0 auto; }
.pix-nc-hxk { font: 11px system-ui, sans-serif; color: #8a8a90; flex: 0 0 auto; }
.pix-nc-hxv {
  flex: 1 1 auto; min-width: 0; background: transparent; border: none; outline: none;
  color: #f66744; font: 12.5px "Consolas", monospace; letter-spacing: 0.03em; padding: 0;
}
.pix-nc-seg {
  display: flex; background: #1d1d1d; border: 1px solid #3a3a40;
  border-radius: 7px; padding: 3px; gap: 3px; margin: 0 0 11px;
}
.pix-nc-seg button {
  flex: 1; text-align: center; font: 12px system-ui, sans-serif;
  padding: 5px 0; border-radius: 5px; color: #bdbdc2;
  background: transparent; border: none; cursor: pointer; transition: background 0.1s, color 0.1s;
}
.pix-nc-seg button.on { background: #f66744; color: #fff; }
.pix-nc-presetlbl {
  font: 11px system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase;
  color: #888; margin: 13px 0 6px;
}
.pix-nc-presetgrid { display: grid; grid-template-columns: repeat(15, 1fr); gap: 4px; }
.pix-nc-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px; }
.pix-nc-hint { font: 11px system-ui, sans-serif; color: #8a8a90; }
.pix-nc-hint b { color: #f66744; font-weight: 400; }
  `;
  document.head.appendChild(s);
}

// ── Color palette popup (both renderers) ────────────────────────────────
// One free-floating, draggable panel opened by the "Pixaroma Node/Group
// Colors" menu entry (and the "\" shortcut). It embeds the shared Pixaroma
// color picker (SV + hue) directly, with a dark hex bar (orange code), a
// 2-wide favourites strip (the orange + tile saves the current color/pair),
// and a small preset grid below — everything applies live. Node colors edit a
// title+body pair via a Title/Body toggle; group colors edit one color and add
// per-group Transparency + Interior-fill sliders.
function isVueNodes() {
  return !!(window.LiteGraph && window.LiteGraph.vueNodesMode);
}

function makeTwoToneSwatch(titleHex, bodyHex) {
  const el = document.createElement("div");
  el.className = "pix-nc-sw";
  el.style.background =
    `linear-gradient(to bottom, ${titleHex} 0%, ${titleHex} 40%, ${bodyHex} 40%, ${bodyHex} 100%)`;
  return el;
}

function makeSingleSwatch(hex) {
  const el = document.createElement("div");
  el.className = "pix-nc-sw";
  el.style.background = hex;
  return el;
}

// Dark hex bar with a live color chip + orange code (typeable). Used by the
// embedded palettes — group shows one, node shows two (Title / Body). getVal()
// seeds the field; onCommit(hex) fires on a valid 6-digit hex. Returns a
// `set(hex)` to refresh the chip + value when the color changes elsewhere
// (SV drag, swatch click, toggle).
function buildHexBar(label, getVal, onCommit) {
  const el = document.createElement("div");
  el.className = "pix-nc-hexbar";
  const chip = document.createElement("span");
  chip.className = "pix-nc-chip";
  el.appendChild(chip);
  if (label) {
    const k = document.createElement("span");
    k.className = "pix-nc-hxk";
    k.textContent = label;
    el.appendChild(k);
  }
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "pix-nc-hxv";
  inp.spellcheck = false;
  inp.setAttribute("aria-label", (label || "color") + " hex");
  el.appendChild(inp);
  // Keep the palette's drag / outside-close from hijacking the field.
  inp.addEventListener("mousedown", (e) => e.stopPropagation());
  inp.addEventListener("pointerdown", (e) => e.stopPropagation());
  inp.addEventListener("input", () => {
    let v = inp.value.trim();
    if (!v.startsWith("#")) v = "#" + v;
    if (/^#[0-9a-f]{6}$/i.test(v)) { chip.style.background = v; onCommit(v); }
  });
  const set = (v) => { inp.value = v || ""; chip.style.background = v || "transparent"; };
  set(getVal());
  return { el, set };
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

  // Cleanups registered by the caller (e.g. picker.destroy() to release the
  // shared picker's window mousemove/mouseup listeners) run once on close.
  const cleanups = [];
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDocDown, true);
    window.removeEventListener("keydown", onKey, true);
    for (const fn of cleanups) { try { fn(); } catch (_e) {} }
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

  return {
    modal, close,
    place: (rect) => placeBeside(modal, rect),
    onClose: (fn) => { if (typeof fn === "function") cleanups.push(fn); },
  };
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

function palToolBtn(text, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pix-nc-btn";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function openNodeColorsPalette(targets, node, groups = []) {
  const gsuffix = groups.length ? ` + ${groups.length} group${groups.length > 1 ? "s" : ""}` : "";
  const suffix = (targets.length > 1 ? ` (${targets.length} nodes)` : "") + gsuffix;
  const { modal, place, onClose } = makePalShell(`Pixaroma Node Colors${suffix}`);

  const applied = captureColors(node);
  let titleHex = applied.title, bodyHex = applied.body;
  let target = "title"; // which color the single picker edits

  // Apply the current title+body to all target nodes; co-selected groups get
  // the more-saturated of the two as their single color (one pick → both).
  const applyNow = () => {
    applyColors(targets, titleHex, bodyHex);
    if (groups.length) applyGroupColor(groups, pickGroupColor({ title: titleHex, body: bodyHex }));
  };

  // ── Title / Body toggle: which color the one picker edits ──
  const seg = document.createElement("div");
  seg.className = "pix-nc-seg";
  const titleBtn = document.createElement("button"); titleBtn.type = "button"; titleBtn.textContent = "Title";
  const bodyBtn  = document.createElement("button"); bodyBtn.type  = "button"; bodyBtn.textContent  = "Body";
  seg.appendChild(titleBtn); seg.appendChild(bodyBtn);
  modal.appendChild(seg);
  const syncSeg = () => { titleBtn.classList.toggle("on", target === "title"); bodyBtn.classList.toggle("on", target === "body"); };

  // ── Picker + favourites row ──
  const prow = document.createElement("div"); prow.className = "pix-nc-prow";
  const pickerWrap = document.createElement("div"); pickerWrap.className = "pix-nc-pickerwrap";
  const picker = createPixaromaColorPicker({
    initialColor: titleHex, swatches: [], hideReset: true,
    onChange: (c) => {
      if (c == null) return;
      if (target === "title") titleHex = c; else bodyHex = c;
      applyNow();
      refreshHex();
    },
  });
  pickerWrap.appendChild(picker.element);
  prow.appendChild(pickerWrap);
  onClose(() => picker.destroy());

  const favCol = document.createElement("div"); favCol.className = "pix-nc-favcol";
  const favLbl = document.createElement("div"); favLbl.className = "pix-nc-favlbl"; favLbl.textContent = "FAVS";
  favCol.appendChild(favLbl);
  const favGrid = document.createElement("div"); favGrid.className = "pix-nc-favgrid";
  favCol.appendChild(favGrid);
  prow.appendChild(favCol);
  modal.appendChild(prow);

  // Apply a stored / preset pair, then sync the picker + hex bars to it.
  const applyPair = (t, b) => {
    titleHex = t; bodyHex = b;
    applyNow();
    picker.setColor(target === "title" ? titleHex : bodyHex);
    refreshHex();
  };
  function renderFavorites() {
    favGrid.innerHTML = "";
    const add = document.createElement("div");
    add.className = "pix-nc-addfav"; add.textContent = "+";
    add.title = "Save the current colors to favourites";
    add.addEventListener("click", () => {
      const favs = getFavorites();
      let idx = favs.findIndex((f) => !f);
      if (idx < 0) idx = FAVORITE_SLOTS - 1; // all full → overwrite the last
      saveFavoriteSlot(idx, titleHex, bodyHex);
      renderFavorites();
    });
    favGrid.appendChild(add);
    const favs = getFavorites();
    for (let i = 0; i < FAVORITE_SLOTS; i++) {
      const f = favs[i];
      if (f) {
        const sw = makeTwoToneSwatch(f.title, f.body);
        sw.title = `Favourite ${i + 1} — click to apply, right-click to remove`;
        sw.addEventListener("click", () => applyPair(f.title, f.body));
        sw.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const a = getFavorites().slice(); a[i] = null; setFavorites(a); renderFavorites();
        });
        favGrid.appendChild(sw);
      } else {
        const empty = document.createElement("div");
        empty.className = "pix-nc-fav-empty"; empty.title = `Favourite ${i + 1} (empty)`;
        favGrid.appendChild(empty);
      }
    }
  }
  renderFavorites();

  // ── Hex bars (Title / Body): dark field, orange code, live chip ──
  const hexWrap = document.createElement("div"); hexWrap.className = "pix-nc-hexwrap";
  const titleBar = buildHexBar("Title", () => titleHex, (v) => { titleHex = v; applyNow(); if (target === "title") picker.setColor(v); });
  const bodyBar  = buildHexBar("Body",  () => bodyHex,  (v) => { bodyHex  = v; applyNow(); if (target === "body")  picker.setColor(v); });
  hexWrap.appendChild(titleBar.el); hexWrap.appendChild(bodyBar.el);
  modal.appendChild(hexWrap);
  function refreshHex() { titleBar.set(titleHex); bodyBar.set(bodyHex); }

  // Toggle wiring. setColor does NOT fire onChange, so toggling re-applies nothing.
  titleBtn.addEventListener("click", () => { target = "title"; syncSeg(); picker.setColor(titleHex); });
  bodyBtn.addEventListener("click",  () => { target = "body";  syncSeg(); picker.setColor(bodyHex); });
  syncSeg();

  // ── Preset node colors (one compact grid, derived from the group palette) ──
  const scroll = document.createElement("div");
  scroll.className = "pix-nc-pal-scroll";
  modal.appendChild(scroll);
  const plbl = document.createElement("div"); plbl.className = "pix-nc-presetlbl"; plbl.textContent = "Node colors";
  scroll.appendChild(plbl);
  const grid = document.createElement("div"); grid.className = "pix-nc-presetgrid";
  for (const p of NODE_PAIRS) {
    const sw = makeTwoToneSwatch(p.title, p.body);
    sw.title = p.label;
    sw.addEventListener("click", () => applyPair(p.title, p.body));
    grid.appendChild(sw);
  }
  scroll.appendChild(grid);

  // ── Footer: save hint + Reset ──
  const foot = document.createElement("div"); foot.className = "pix-nc-foot";
  const hint = document.createElement("span"); hint.className = "pix-nc-hint";
  hint.innerHTML = "<b>+</b> save current · click = apply";
  foot.appendChild(hint);
  foot.appendChild(palToolBtn("Reset colors", () => {
    resetColors(targets);
    if (groups.length) resetGroupColor(groups);
    const c = captureColors(node);
    titleHex = c.title; bodyHex = c.body;
    picker.setColor(target === "title" ? titleHex : bodyHex);
    refreshHex();
  }));
  modal.appendChild(foot);

  place(getNodeScreenRect(node));
}

function openGroupColorsPalette(targets, group) {
  const suffix = targets.length > 1 ? ` (${targets.length} groups)` : "";
  const { modal, place, onClose } = makePalShell(`Pixaroma Group Colors${suffix}`);

  let hex = captureGroupColor(group);
  const applyNow = () => applyGroupColor(targets, hex);

  // ── Per-group display sliders (Transparency + Interior fill), shown only
  // when Group Pixaroma styling is on. Stored on group.flags (serialize),
  // read by Group Pixaroma's renderer. Native groups ignore the flags. ──
  const groupsStylingOn = app.ui?.settings?.getSettingValue?.("Pixaroma.Groups.Enabled");
  if (groupsStylingOn !== false) {
    const sliderRow = (labelText, title, min, max, step, initVal, fmt, onVal) => {
      const lbl = document.createElement("div");
      lbl.className = "pix-nc-presetlbl"; lbl.style.marginTop = "0"; lbl.textContent = labelText;
      modal.appendChild(lbl);
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;padding:0 0 8px;";
      const s = document.createElement("input");
      s.type = "range"; s.min = String(min); s.max = String(max); s.step = String(step);
      s.title = title;
      s.style.cssText = "flex:1 1 auto;accent-color:#f66744;cursor:pointer;";
      s.value = String(initVal);
      const v = document.createElement("span");
      v.style.cssText = "min-width:40px;text-align:right;font-size:12px;color:#bbb;";
      v.textContent = fmt(initVal);
      s.addEventListener("input", () => {
        const n = Number(s.value);
        v.textContent = fmt(n);
        for (const g of targets) {
          g.flags = g.flags || {};
          onVal(g, n);
          if (typeof g.setDirtyCanvas === "function") g.setDirtyCanvas(false, true);
        }
        app.graph?.setDirtyCanvas(true, true);
      });
      row.appendChild(s); row.appendChild(v);
      modal.appendChild(row);
    };
    const initA = Math.round(Math.max(0.2, Math.min(1, Number.isFinite(group.flags?.pixGroupAlpha) ? group.flags.pixGroupAlpha : 1)) * 100);
    sliderRow("Transparency", "Dim the whole group color so the title stays readable (100% = full color).",
      20, 100, 5, initA, (n) => n + "%", (g, n) => { g.flags.pixGroupAlpha = Math.max(0.2, Math.min(1, n / 100)); });
    const globalInt = Number(app.ui?.settings?.getSettingValue?.("Pixaroma.Groups.InteriorStrength"));
    const baseInt = Number.isFinite(group.flags?.pixInteriorStrength)
      ? group.flags.pixInteriorStrength * 100
      : (Number.isFinite(globalInt) ? globalInt : 12);
    sliderRow("Interior fill", "How strongly the group body is tinted (per-group; the Settings value is the default).",
      0, 40, 1, Math.round(Math.max(0, Math.min(40, baseInt))), (n) => String(n), (g, n) => { g.flags.pixInteriorStrength = Math.max(0, Math.min(40, n)) / 100; });
  }

  // ── Picker + favourites row ──
  const prow = document.createElement("div"); prow.className = "pix-nc-prow";
  const pickerWrap = document.createElement("div"); pickerWrap.className = "pix-nc-pickerwrap";
  const picker = createPixaromaColorPicker({
    initialColor: hex, swatches: [], hideReset: true,
    onChange: (c) => { if (c == null) return; hex = c; applyNow(); refreshHex(); },
  });
  pickerWrap.appendChild(picker.element);
  prow.appendChild(pickerWrap);
  onClose(() => picker.destroy());

  const favCol = document.createElement("div"); favCol.className = "pix-nc-favcol";
  const favLbl = document.createElement("div"); favLbl.className = "pix-nc-favlbl"; favLbl.textContent = "FAVS";
  favCol.appendChild(favLbl);
  const favGrid = document.createElement("div"); favGrid.className = "pix-nc-favgrid";
  favCol.appendChild(favGrid);
  prow.appendChild(favCol);
  modal.appendChild(prow);

  const applyFav = (c) => { hex = c; applyNow(); picker.setColor(c); refreshHex(); };
  function renderFavorites() {
    favGrid.innerHTML = "";
    const add = document.createElement("div");
    add.className = "pix-nc-addfav"; add.textContent = "+";
    add.title = "Save the current color to favourites";
    add.addEventListener("click", () => {
      const favs = getGroupFavorites();
      let idx = favs.findIndex((f) => !f);
      if (idx < 0) idx = FAVORITE_SLOTS - 1;
      saveGroupFavoriteSlot(idx, hex);
      renderFavorites();
    });
    favGrid.appendChild(add);
    const favs = getGroupFavorites();
    for (let i = 0; i < FAVORITE_SLOTS; i++) {
      const f = favs[i];
      if (f) {
        const c = pickGroupColor(f);
        const sw = makeSingleSwatch(c);
        sw.title = `Favourite ${i + 1} — click to apply, right-click to remove`;
        sw.addEventListener("click", () => applyFav(c));
        sw.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const a = getGroupFavorites().slice(); a[i] = null; setGroupFavorites(a); renderFavorites();
        });
        favGrid.appendChild(sw);
      } else {
        const empty = document.createElement("div");
        empty.className = "pix-nc-fav-empty"; empty.title = `Favourite ${i + 1} (empty)`;
        favGrid.appendChild(empty);
      }
    }
  }
  renderFavorites();

  // ── Hex bar (single): dark field, orange code, live chip ──
  const hexWrap = document.createElement("div"); hexWrap.className = "pix-nc-hexwrap";
  const bar = buildHexBar(null, () => hex, (v) => { hex = v; applyNow(); picker.setColor(v); });
  hexWrap.appendChild(bar.el);
  modal.appendChild(hexWrap);
  function refreshHex() { bar.set(hex); }

  // ── Preset group colors (scrollable, small 15-wide) ──
  const scroll = document.createElement("div");
  scroll.className = "pix-nc-pal-scroll";
  modal.appendChild(scroll);
  const plbl = document.createElement("div"); plbl.className = "pix-nc-presetlbl"; plbl.textContent = "Group colors";
  scroll.appendChild(plbl);
  const grid = document.createElement("div"); grid.className = "pix-nc-presetgrid";
  for (const c of GROUP_COLORS) {
    const sw = makeSingleSwatch(c.color);
    sw.title = c.label;
    sw.addEventListener("click", () => applyFav(c.color));
    grid.appendChild(sw);
  }
  scroll.appendChild(grid);

  // ── Footer: save hint + Reset ──
  const foot = document.createElement("div"); foot.className = "pix-nc-foot";
  const hint = document.createElement("span"); hint.className = "pix-nc-hint";
  hint.innerHTML = "<b>+</b> save current · click = apply";
  foot.appendChild(hint);
  foot.appendChild(palToolBtn("Reset color", () => {
    resetGroupColor(targets);
    hex = captureGroupColor(group);
    picker.setColor(hex);
    refreshHex();
  }));
  modal.appendChild(foot);

  place(getGroupScreenRect(group));
}

// ── Custom Pixaroma group (js/pixgroup) styling ─────────────────────────────
// A Pixaroma group has a title + body (like a node), PLUS per-group opacity and
// font size that native ComfyUI groups can't do. So this is the node palette
// (Title/Body picker + favourites + presets) with three extra sliders. We mutate
// the group object's fields (titleColor/bodyColor/titleAlpha/bodyAlpha/fontSize —
// the contract with pixgroup) and repaint; pixgroup owns the drawing + saving.
function pixGroupScreenRect(g) {
  const c = app.canvas, el = c?.canvas, ds = c?.ds;
  if (!el || !ds || !g) return null;
  const r = el.getBoundingClientRect();
  const s = ds.scale || 1, o = ds.offset || [0, 0];
  const left = r.left + (g.x + o[0]) * s, top = r.top + (g.y + o[1]) * s;
  return { left, top, width: g.w * s, height: g.h * s, right: left + g.w * s, bottom: top + g.h * s };
}
function pixRepaint() { try { app.canvas?.setDirty(true, true); } catch (_e) {} try { app.graph?.change?.(); } catch (_e) {} }

function openPixGroupPalette(g) {
  if (!g) return;
  const { modal, place, onClose } = makePalShell("Pixaroma Group");
  let titleHex = g.titleColor || g.color || GROUP_DEFAULT_COLOR;
  let bodyHex  = g.bodyColor  || g.color || GROUP_DEFAULT_COLOR;
  let target = "title";
  const applyNow = () => { g.titleColor = titleHex; g.bodyColor = bodyHex; pixRepaint(); };

  const seg = document.createElement("div"); seg.className = "pix-nc-seg";
  const titleBtn = document.createElement("button"); titleBtn.type = "button"; titleBtn.textContent = "Title";
  const bodyBtn  = document.createElement("button"); bodyBtn.type  = "button"; bodyBtn.textContent  = "Body";
  seg.appendChild(titleBtn); seg.appendChild(bodyBtn); modal.appendChild(seg);
  const syncSeg = () => { titleBtn.classList.toggle("on", target === "title"); bodyBtn.classList.toggle("on", target === "body"); };

  const prow = document.createElement("div"); prow.className = "pix-nc-prow";
  const pickerWrap = document.createElement("div"); pickerWrap.className = "pix-nc-pickerwrap";
  const picker = createPixaromaColorPicker({
    initialColor: titleHex, swatches: [], hideReset: true,
    onChange: (c) => { if (c == null) return; if (target === "title") titleHex = c; else bodyHex = c; applyNow(); refreshHex(); },
  });
  pickerWrap.appendChild(picker.element); prow.appendChild(pickerWrap);
  onClose(() => picker.destroy());

  const favCol = document.createElement("div"); favCol.className = "pix-nc-favcol";
  const favLbl = document.createElement("div"); favLbl.className = "pix-nc-favlbl"; favLbl.textContent = "FAVS";
  favCol.appendChild(favLbl);
  const favGrid = document.createElement("div"); favGrid.className = "pix-nc-favgrid";
  favCol.appendChild(favGrid); prow.appendChild(favCol); modal.appendChild(prow);

  const applyPair = (t, b) => { titleHex = t; bodyHex = b; applyNow(); picker.setColor(target === "title" ? titleHex : bodyHex); refreshHex(); };
  function renderFavorites() {
    favGrid.innerHTML = "";
    const add = document.createElement("div"); add.className = "pix-nc-addfav"; add.textContent = "+";
    add.title = "Save the current colors to favourites";
    add.addEventListener("click", () => {
      const favs = getFavorites(); let idx = favs.findIndex((f) => !f);
      if (idx < 0) idx = FAVORITE_SLOTS - 1;
      saveFavoriteSlot(idx, titleHex, bodyHex); renderFavorites();
    });
    favGrid.appendChild(add);
    const favs = getFavorites();
    for (let i = 0; i < FAVORITE_SLOTS; i++) {
      const f = favs[i];
      if (f) {
        const sw = makeTwoToneSwatch(f.title, f.body);
        sw.title = `Favourite ${i + 1} — click to apply, right-click to remove`;
        sw.addEventListener("click", () => applyPair(f.title, f.body));
        sw.addEventListener("contextmenu", (e) => { e.preventDefault(); const a = getFavorites().slice(); a[i] = null; setFavorites(a); renderFavorites(); });
        favGrid.appendChild(sw);
      } else {
        const empty = document.createElement("div"); empty.className = "pix-nc-fav-empty"; empty.title = `Favourite ${i + 1} (empty)`;
        favGrid.appendChild(empty);
      }
    }
  }
  renderFavorites();

  const hexWrap = document.createElement("div"); hexWrap.className = "pix-nc-hexwrap";
  const titleBar = buildHexBar("Title", () => titleHex, (v) => { titleHex = v; applyNow(); if (target === "title") picker.setColor(v); });
  const bodyBar  = buildHexBar("Body",  () => bodyHex,  (v) => { bodyHex  = v; applyNow(); if (target === "body")  picker.setColor(v); });
  hexWrap.appendChild(titleBar.el); hexWrap.appendChild(bodyBar.el); modal.appendChild(hexWrap);
  function refreshHex() { titleBar.set(titleHex); bodyBar.set(bodyHex); }

  titleBtn.addEventListener("click", () => { target = "title"; syncSeg(); picker.setColor(titleHex); });
  bodyBtn.addEventListener("click",  () => { target = "body";  syncSeg(); picker.setColor(bodyHex); });
  syncSeg();

  // ── extra sliders ComfyUI groups can't do: Title/Body opacity + Font size ──
  const sliderInputs = [];
  const sliderRow = (labelText, min, max, step, get, set, fmt) => {
    const lbl = document.createElement("div"); lbl.className = "pix-nc-presetlbl"; lbl.style.marginTop = "11px"; lbl.textContent = labelText;
    modal.appendChild(lbl);
    const row = document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:10px;padding:0;";
    const s = document.createElement("input"); s.type = "range"; s.min = String(min); s.max = String(max); s.step = String(step); s.value = String(get());
    s.style.cssText = "flex:1 1 auto;accent-color:#f66744;cursor:pointer;";
    const v = document.createElement("span"); v.style.cssText = "min-width:40px;text-align:right;font-size:12px;color:#bbb;"; v.textContent = fmt(get());
    s.addEventListener("input", () => { const n = Number(s.value); set(n); v.textContent = fmt(n); pixRepaint(); });
    row.appendChild(s); row.appendChild(v); modal.appendChild(row);
    sliderInputs.push({ s, v, get, fmt });
  };
  sliderRow("Title opacity", 0.2, 1, 0.05, () => (Number.isFinite(g.titleAlpha) ? g.titleAlpha : 0.92), (n) => { g.titleAlpha = n; }, (n) => Math.round(n * 100) + "%");
  sliderRow("Body opacity", 0, 0.6, 0.02, () => (Number.isFinite(g.bodyAlpha) ? g.bodyAlpha : 0.12), (n) => { g.bodyAlpha = n; }, (n) => Math.round(n * 100) + "%");
  sliderRow("Font size", 10, 32, 1, () => (Number.isFinite(g.fontSize) ? g.fontSize : 14), (n) => { g.fontSize = n; }, (n) => String(n));
  const refreshSliders = () => { for (const si of sliderInputs) { si.s.value = String(si.get()); si.v.textContent = si.fmt(si.get()); } };

  const scroll = document.createElement("div"); scroll.className = "pix-nc-pal-scroll"; modal.appendChild(scroll);
  const plbl = document.createElement("div"); plbl.className = "pix-nc-presetlbl"; plbl.textContent = "Colors";
  scroll.appendChild(plbl);
  const grid = document.createElement("div"); grid.className = "pix-nc-presetgrid";
  for (const p of NODE_PAIRS) {
    const sw = makeTwoToneSwatch(p.title, p.body); sw.title = p.label;
    sw.addEventListener("click", () => applyPair(p.title, p.body));
    grid.appendChild(sw);
  }
  scroll.appendChild(grid);

  const foot = document.createElement("div"); foot.className = "pix-nc-foot";
  const hint = document.createElement("span"); hint.className = "pix-nc-hint";
  hint.innerHTML = "<b>+</b> save current · click = apply";
  foot.appendChild(hint);
  foot.appendChild(palToolBtn("Reset", () => {
    g.titleColor = GROUP_DEFAULT_COLOR; g.bodyColor = GROUP_DEFAULT_COLOR;
    g.titleAlpha = 0.92; g.bodyAlpha = 0.12; g.fontSize = 14;
    titleHex = GROUP_DEFAULT_COLOR; bodyHex = GROUP_DEFAULT_COLOR;
    picker.setColor(target === "title" ? titleHex : bodyHex);
    refreshHex(); refreshSliders(); pixRepaint();
  }));
  modal.appendChild(foot);

  place(pixGroupScreenRect(g));
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
      const groups = getSelectedGroups();
      if (nodes.length) {
        e.preventDefault(); e.stopPropagation();
        // Mixed selection → color the selected groups alongside the nodes (one pick).
        openNodeColorsPalette(getTargetNodes(nodes[0]), nodes[0], groups);
        return;
      }
      // A selected custom Pixaroma group (its own selection, owned by js/pixgroup).
      const pix = window.PixaromaPixGroup?.getSelected?.();
      if (pix) {
        e.preventDefault(); e.stopPropagation();
        openPixGroupPalette(pix);
        return;
      }
      if (groups.length) {
        e.preventDefault(); e.stopPropagation();
        openGroupColorsPalette(groups, groups[0]);
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
      // The custom Pixaroma group (js/pixgroup) opens its styling through this
      // same color tool — node-style title/body picker + opacity + font sliders.
      window.PixaromaNodeColors = { openPixGroup: openPixGroupPalette };
    } catch (_e) {}
  },
});
