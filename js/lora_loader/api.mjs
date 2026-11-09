// LoRA Loader Pixaroma - thin fetch wrappers over the server routes in
// server_routes.py. The list is cached for the session; info is cached per LoRA so
// re-opening the info panel is instant. The Civitai call is never cached here (it
// caches server-side as a sidecar file, so a second call is instant and offline).

import { pixApiUrl } from "../shared/api_url.mjs";

let _listCache = null;
let _listPromise = null;
const _infoCache = new Map();
const _infoPromise = new Map();

export async function listLoras(force = false) {
  if (!force && _listCache) return _listCache;
  if (!force && _listPromise) return _listPromise;
  const p = (async () => {
    try {
      // no-store: the route sends no cache headers, and a heuristically-cached
      // copy of this list is exactly the "renamed file never appears" bug.
      const r = await fetch(pixApiUrl("/pixaroma/api/lora/list"), { cache: "no-store" });
      const j = await r.json();
      // j.error = the SERVER's folder scan failed (not an empty folder). Treat it
      // like a network failure: keep whatever list we had. Trusting it as a real
      // [] made hasLora() brand every row "missing" - a workflow-wide false alarm.
      if (!j.error && Array.isArray(j.loras)) _listCache = j.loras;
    } catch {
      // Transient failure: KEEP the previous list (stale beats empty - nulling it
      // here used to wipe a perfectly good cache now that every dropdown open
      // force-refetches). A never-fetched cache stays null so hasLora() stays
      // "unknown" and no false missing-marks appear.
    }
    // Only clear the in-flight slot if it is still OURS - a forced call may have
    // replaced it while we were in the air (keeps the dedupe honest).
    if (_listPromise === p) _listPromise = null;
    return _listCache || [];
  })();
  _listPromise = p;
  return p;
}

// Bumped by invalidateInfo. A reply that was already in flight when its LoRA
// changed must NOT be cached: it describes the world before the change, and the
// cache outlives the panel, so it would keep serving that answer all session.
// Measured: set a picture while the first info load was still outstanding and the
// panel reverted to "no picture" when the old reply landed, with the stale copy
// cached behind it - so reopening still showed it gone and it could not be removed.
const _infoGen = new Map();
const genOf = (name) => _infoGen.get(name) || 0;

export async function loraInfo(name, force = false) {
  if (!name) return { ok: false, message: "No LoRA selected." };
  if (!force && _infoCache.has(name)) return _infoCache.get(name);
  // Dedupe concurrent non-forced fetches for the same name (two nodes, same LoRA)
  // so they share one response instead of racing to overwrite the cache.
  if (!force && _infoPromise.has(name)) return _infoPromise.get(name);
  const gen = genOf(name);
  // Declared BEFORE the initializer that closes over it. The `finally` below
  // reads `p`, so with `const p = (async () => {...})()` a synchronous throw
  // inside the try (an unpaired surrogate reaching encodeURIComponent, say)
  // would hit the temporal dead zone, the finally would throw a ReferenceError
  // instead of clearing the slot, and every later call for that LoRA would be
  // handed the same rejected promise forever. `undefined` here is harmless: the
  // ownership test then only matches a genuinely empty slot, where delete is a
  // no-op.
  let p;
  p = (async () => {
    try {
      const r = await fetch(pixApiUrl("/pixaroma/api/lora/info?name=" + encodeURIComponent(name)),
                            { cache: "no-store" });
      const j = await r.json();
      // Cache SUCCESS only, and only when nothing invalidated this LoRA while the
      // request was out. A server-reported failure ({ok:false}) used to be
      // cached like a hit, so a LoRA that was briefly unresolvable (still copying,
      // a path the server could not verify) showed its error for the rest of the
      // session even after the cause was gone - plain panel opens are non-forced,
      // so only F5 cleared it.
      if (j && j.ok && genOf(name) === gen) _infoCache.set(name, j);
      // The caller needs to know its answer is out of date, or it will paint it.
      if (genOf(name) !== gen && j && typeof j === "object") j.stale = true;
      return j;
    } catch (e) {
      return { ok: false, message: "Could not reach the server." }; // not cached -> retry next time
    } finally {
      // Only clear the slot we own: a FORCED call settling must not drop a
      // concurrent non-forced call's dedupe entry.
      if (_infoPromise.get(name) === p) _infoPromise.delete(name);
    }
  })();
  if (!force) _infoPromise.set(name, p);
  return p;
}

// Drop a cached info entry (after a Civitai fetch or a preview change rewrote what
// it describes). Bumping the generation is what stops an ALREADY-IN-FLIGHT reply
// from repopulating the cache with the pre-change answer a moment later.
export function invalidateInfo(name) {
  _infoCache.delete(name);
  _infoGen.set(name, genOf(name) + 1);
}

// Refresh-time invalidators (wired to ComfyUI's R via js/shared/refresh.mjs).
// The list cache goes stale the moment a file is renamed/added on disk; the
// server is always fresh (folder_paths re-validates on directory mtime), so
// dropping OUR copy is all a refresh needs.
export function invalidateList() {
  _listCache = null;
}
export function invalidateAllInfo() {
  _infoCache.clear();
  // Bump EVERY known generation too, not just the cache. Clearing alone left the
  // R-key refresh beatable: a reply already in flight came back with its
  // generation unchanged, so it repopulated the cache with the pre-refresh answer
  // - exactly the hole the counter was added to close, reached through the other
  // invalidator. Safe to do now that every consumer asks again once on a stale
  // answer; before that retry existed this would have left a blank panel.
  for (const k of [..._infoGen.keys()]) _infoGen.set(k, _infoGen.get(k) + 1);
  // A name that has never been invalidated has no entry, and an in-flight fetch
  // for it captured gen 0 - so give it one, or that reply would still slip through.
  for (const k of [..._infoPromise.keys()]) if (!_infoGen.has(k)) _infoGen.set(k, 1);
}

// Is this name in the last fetched list? null = list not fetched yet (unknown),
// so callers can avoid false "missing" marks before the first load.
export function hasLora(name) {
  if (!_listCache) return null;
  // A row saved on another system says flux/a where Windows lists flux\a, or h3\a
  // where Linux and Mac list h3/a, and the node loads both (find_lora_file in
  // _lora_helpers.py), so a plain match showed a working row in red as "skipped".
  // The row's own spelling is checked first, like the node does.
  const s = String(name);
  return _listCache.includes(s) || _listCache.includes(s.replace(/\//g, "\\"))
    || _listCache.includes(s.replace(/\\/g, "/"));
}

// The last fetched list, or null when nothing has been fetched yet. A SYNC read for
// callers that cannot await - XY Plot's picker enumeration runs inside a synchronous
// render. null means "unknown", never "no LoRAs"; callers should kick listLoras() to
// warm it (setupNode already does on every LoRA Loader node, so it is warm in
// practice long before a picker opens).
export function cachedLoras() {
  return _listCache;
}

// `bust` (a timestamp or counter) forces past the browser's image cache - the
// thumb route sends max-age=3600 and the URL otherwise never changes, so a
// preview replaced by a Civitai fetch kept showing the OLD image up to an hour.
export function thumbUrl(name, bust) {
  return pixApiUrl("/pixaroma/api/lora/thumb?name=" + encodeURIComponent(name) +
    (bust ? "&t=" + bust : ""));
}

export async function civitaiLookup(name) {
  try {
    const r = await fetch(pixApiUrl("/pixaroma/api/lora/civitai?name=" + encodeURIComponent(name)));
    return await r.json();
  } catch {
    return { ok: false, reason: "offline", message: "Could not reach Civitai." };
  }
}

// ── the Civitai account (the optional API key + the two lookup preferences) ──
//
// The KEY IS NEVER SENT TO THE PAGE. These two calls only ever carry
// {configured, hint, host, adultThumbs}; the key itself lives in a file the
// server reads. Deliberately NOT cached: it is read when the settings panel
// opens, which is rare, and a cached "not configured" after the user just set one
// would look like the save had failed.

export async function getCivitaiAccount() {
  try {
    const r = await fetch(pixApiUrl("/pixaroma/api/civitai/account"), { cache: "no-store" });
    return await r.json();
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

/** Patch any of {key, host, adultThumbs}. Omit a field to leave it alone; pass
 *  key:"" to remove the key. Answers with the stored state, so the panel repaints
 *  from what the server kept rather than from what it hoped it sent. */
export async function setCivitaiAccount(patch) {
  try {
    const r = await fetch(pixApiUrl("/pixaroma/api/civitai/account"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch || {}),
    });
    return await r.json();
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

// Delete the saved Civitai sidecar (<base>.civitai.info) next to the LoRA, so its
// info reverts to the file's own words. Caller should invalidateInfo(name) after.
// Persist the user's own trigger words FOR THIS LORA FILE (one store in ComfyUI's
// user dir, keyed by LoRA name). They used to live only on the row, so switching
// the row's LoRA and back lost them and another node never saw them.
// Sending an EMPTY array removes the LoRA's entry.
export async function saveCustomTriggers(name, words) {
  try {
    const r = await fetch(pixApiUrl("/pixaroma/api/lora/custom_triggers"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, words }),
    });
    const j = await r.json();
    // The panel reads custom words out of the cached info, so a stale cache would
    // undo the save on the next open.
    if (j?.ok) invalidateInfo(name);
    return j;
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

export async function deleteCivitai(name) {
  try {
    const r = await fetch(pixApiUrl("/pixaroma/api/lora/civitai_delete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return await r.json();
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

// ── the user's own preview picture ───────────────────────────────────────────
//
// Stored in ComfyUI's user dir, keyed by LoRA name, and it WINS over both the
// picture beside the .safetensors and a live Civitai thumbnail. Both calls
// invalidate the cached info, which carries `custom_preview` / `preview_v` - a
// stale one would leave the panel offering to remove a picture that has gone, or
// showing the previous picture from the browser's hour-long image cache.

/** Save a picture as this LoRA's preview. `dataUrl` is a downscaled jpeg the
 *  panel encodes; the server still checks the size and the magic bytes. */
export async function saveLoraPreview(name, dataUrl) {
  try {
    const r = await fetch(pixApiUrl("/pixaroma/api/lora/preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, dataUrl }),
    });
    const j = await r.json();
    if (j?.ok) invalidateInfo(name);
    return j;
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

/** Remove it, so the automatic picture comes back. */
export async function deleteLoraPreview(name) {
  try {
    const r = await fetch(pixApiUrl("/pixaroma/api/lora/preview_delete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await r.json();
    if (j?.ok) invalidateInfo(name);
    return j;
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}
