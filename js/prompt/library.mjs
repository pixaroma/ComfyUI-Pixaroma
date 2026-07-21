// Prompt Pixaroma - the tag library store.
//
// The library is { version, categories:[name...], tags:[{name, cat, text}...] },
// shared across every Prompt Pixaroma node on this machine. It is persisted as
// ONE JSON blob in an UNREGISTERED ComfyUI setting ("Pixaroma.Prompt.Library"),
// which:
//   * lives in ComfyUI's user settings, OUTSIDE our plugin folder, so it survives
//     updating / reinstalling the Pixaroma plugin (the user's #1 ask);
//   * is private to the user - it is NEVER written into a workflow, so a shared
//     workflow keeps the author's prompts to themselves;
//   * persists even though it is not declared in any extension's settings[]
//     (Vue Compat #20: comfy.settings.json is a plain JSON merge, no allow-list).
//     Same mechanism Seed history + Node Colors favorites use.
//
// tags are kept newest-first (new ones are unshifted on). categories are ordered
// and may be empty; "Uncategorized" is the implicit bucket for a tag with no cat.

import { app } from "/scripts/app.js";

const LIBRARY_SETTING = "Pixaroma.Prompt.Library";
export const NAME_RE = /[^a-zA-Z0-9_\-]/g;
export const UNCATEGORIZED = "Uncategorized";

// Seeded ONCE, the first time this browser opens a Prompt node (setting never
// written). Gives a new user a working template; every seed is editable/deletable.
const SEED = {
  version: 1,
  categories: ["Styles", "Lighting", "Camera"],
  tags: [
    { name: "oilpainting", cat: "Styles", text: "oil painting, thick impasto brush strokes, dramatic Rembrandt lighting, rich canvas texture, fine-art masterpiece" },
    { name: "watercolor", cat: "Styles", text: "loose watercolor wash, soft bleeding edges, paper texture, gentle pigment" },
    { name: "cyberpunk", cat: "Styles", text: "cyberpunk city, neon signs, rain-slick streets, volumetric fog, blade-runner mood" },
    { name: "goldenhour", cat: "Lighting", text: "golden hour, warm low sun, long soft shadows, cinematic rim light" },
    { name: "portrait", cat: "Camera", text: "head and shoulders portrait, shallow depth of field, 85mm lens, soft studio light" },
  ],
};

let _data = null;
let _persistTimer = null;
const _subs = new Set();

function settingsApi() {
  const s = app.ui?.settings;
  return s && typeof s.getSettingValue === "function" ? s : null;
}

function cleanName(n) {
  return String(n == null ? "" : n).trim().replace(NAME_RE, "");
}

// Coerce any parsed blob into the canonical shape, deduping tag names.
function normalize(raw) {
  const out = { version: 1, categories: [], tags: [] };
  const src = raw && typeof raw === "object" ? raw : {};
  const cats = Array.isArray(src.categories) ? src.categories : [];
  const seenCat = new Set();
  for (const c of cats) {
    const name = String(c || "").trim();
    // Reserved bucket is case-INSENSITIVE: a user-typed "uncategorized" must not
    // survive as a separate category that then merges with the synthetic bucket.
    if (!name || name.toLowerCase() === UNCATEGORIZED.toLowerCase()) continue;
    const key = name.toLowerCase();
    if (seenCat.has(key)) continue;
    seenCat.add(key);
    out.categories.push(name);
  }
  const tags = Array.isArray(src.tags) ? src.tags : [];
  const seenTag = new Set();
  for (const t of tags) {
    if (!t) continue;
    const name = cleanName(t.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenTag.has(key)) continue;
    seenTag.add(key);
    let cat = String(t.cat || "").trim();
    if (cat.toLowerCase() === UNCATEGORIZED.toLowerCase()) cat = "";
    out.tags.push({ name, cat, text: typeof t.text === "string" ? t.text : "" });
  }
  // Reconcile every tag's category to the canonical (case-matching) entry in the
  // list; a category a tag references but the list forgot is added - so the editor
  // sidebar (exact match) and the node's category list never disagree, and a
  // case-variant ("styles" vs "Styles") can't orphan a tag.
  const catByKey = new Map(out.categories.map((c) => [c.toLowerCase(), c]));
  for (const t of out.tags) {
    if (!t.cat) continue;
    const canon = catByKey.get(t.cat.toLowerCase());
    if (canon) t.cat = canon;
    else { out.categories.push(t.cat); catByKey.set(t.cat.toLowerCase(), t.cat); }
  }
  return out;
}

function persist(data) {
  const s = app.ui?.settings;
  if (!s) return;
  const json = JSON.stringify(data);
  try {
    if (typeof s.setSettingValueAsync === "function") s.setSettingValueAsync(LIBRARY_SETTING, json);
    else if (typeof s.setSettingValue === "function") s.setSettingValue(LIBRARY_SETTING, json);
  } catch { /* non-fatal: still applied in-memory this session */ }
}

// The live library { categories, tags }. Same cached instance between reads; go
// through setLibrary / commitLibrary to mutate so subscribers + storage stay synced.
export function getLibrary() {
  if (_data) return _data;
  const s = settingsApi();
  if (!s) return normalize(SEED); // settings not ready yet: don't cache the seed
  const raw = s.getSettingValue(LIBRARY_SETTING);
  if (raw == null) {
    _data = normalize(SEED);
    persist(_data); // lock the seed in so it's immediately editable
    return _data;
  }
  try {
    _data = normalize(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    _data = normalize({});
  }
  return _data;
}

export function getTags() { return getLibrary().tags; }

// Ordered category names PLUS any category a tag references but the list forgot,
// so the UI never hides a tag. "Uncategorized" is appended only when something uses it.
export function getCategories() {
  const data = getLibrary();
  const out = [...data.categories];
  const have = new Set(out.map((c) => c.toLowerCase()));
  let hasUncat = false;
  for (const t of data.tags) {
    if (!t.cat) { hasUncat = true; continue; }
    if (!have.has(t.cat.toLowerCase())) { have.add(t.cat.toLowerCase()); out.push(t.cat); }
  }
  if (hasUncat && !have.has(UNCATEGORIZED.toLowerCase())) out.push(UNCATEGORIZED);
  return out;
}

export function findTag(name) {
  const k = String(name).toLowerCase();
  for (const t of getTags()) if (t.name.toLowerCase() === k) return t;
  return null;
}

// A name not already used by another tag (case-insensitive). Appends -2, -3, ...
export function uniqueTagName(base, ignore) {
  let n = cleanName(base) || "tag";
  const taken = (x) => {
    const k = x.toLowerCase();
    for (const t of getTags()) { if (t === ignore) continue; if (t.name.toLowerCase() === k) return true; }
    return false;
  };
  if (!taken(n)) return n;
  const stem = n; let i = 2;
  while (taken(stem + "-" + i)) i++;
  return stem + "-" + i;
}

function fanout() {
  for (const fn of _subs) { try { fn(_data); } catch { /* one bad listener can't break the rest */ } }
}

// Replace the whole library and persist immediately (add / delete / import / rename).
export function setLibrary(data) {
  _data = normalize(data);
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  persist(_data);
  fanout();
  return _data;
}

// Live edit: update cache + notify subscribers now (nodes re-highlight/preview as
// you type), DEBOUNCE the settings write so we don't hammer comfy.settings.json.
export function commitLibrary(data) {
  _data = normalize(data);
  fanout();
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => { persist(_data); _persistTimer = null; }, 350);
  return _data;
}

// Flush any pending debounced write now (call on blur / editor close).
export function flushLibrary() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  if (_data) persist(_data);
}

export function subscribe(fn) { _subs.add(fn); return () => _subs.delete(fn); }

export function exportLibraryJSON() {
  return JSON.stringify(getLibrary(), null, 2);
}

// Parse an imported blob into a normalized library WITHOUT applying it. Returns
// { data, conflicts:[name...] } so the caller can ask the user how to merge.
export function parseImport(jsonStr) {
  let raw;
  try { raw = JSON.parse(jsonStr); } catch { return { error: "That file is not valid JSON." }; }
  // Accept the full shape, a bare tags array, or { tags:[...] } / { library:[...] }.
  if (Array.isArray(raw)) raw = { tags: raw };
  else if (raw && !Array.isArray(raw.tags)) {
    raw = { categories: raw.categories, tags: raw.tags || raw.library || raw.snippets || raw.prompts };
  }
  const data = normalize(raw);
  if (!data.tags.length) return { error: "No tags found in that file." };
  const have = new Set(getTags().map((t) => t.name.toLowerCase()));
  const conflicts = data.tags.filter((t) => have.has(t.name.toLowerCase())).map((t) => t.name);
  return { data, conflicts };
}

// Apply a parsed import. mode: "both" (rename incoming clashes, keep everything),
// "replace" (overwrite my text on a clash), "skip" (only add non-clashing).
// Imported tags land on TOP (newest-first), categories are merged in.
export function applyImport(parsed, mode) {
  const cur = getLibrary();
  const tags = cur.tags.map((t) => ({ ...t }));
  const byKey = new Map(tags.map((t) => [t.name.toLowerCase(), t]));
  // Unique against the WORKING set (live + already-added), not just the live
  // library - else a "keep both" rename could collide with another incoming tag
  // (e.g. importing both `portrait` and `portrait-2`) and normalize would drop one.
  const uniqueIn = (base) => {
    let n = base, i = 2;
    while (byKey.has(n.toLowerCase())) { n = base + "-" + i; i++; }
    return n;
  };
  const toAdd = [];
  for (const inc of parsed.data.tags) {
    const key = inc.name.toLowerCase();
    if (!byKey.has(key)) {
      const t = { ...inc };
      toAdd.push(t); byKey.set(key, t);
    } else if (mode === "replace") {
      byKey.get(key).text = inc.text;
    } else if (mode === "both") {
      const nn = uniqueIn(inc.name);
      const t = { ...inc, name: nn };
      toAdd.push(t); byKey.set(nn.toLowerCase(), t);
    }
    // "skip": do nothing
  }
  const next = {
    version: 1,
    categories: [...cur.categories],
    tags: toAdd.concat(tags), // newest (imported) on top
  };
  const catHave = new Set(next.categories.map((c) => c.toLowerCase()));
  for (const c of parsed.data.categories) {
    if (c && !catHave.has(c.toLowerCase())) { catHave.add(c.toLowerCase()); next.categories.push(c); }
  }
  setLibrary(next);
  return { added: toAdd.length };
}
