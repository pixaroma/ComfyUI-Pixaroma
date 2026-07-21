// LoRA Loader Pixaroma - thin fetch wrappers over the server routes in
// server_routes.py. The list is cached for the session; info is cached per LoRA so
// re-opening the info panel is instant. The Civitai call is never cached here (it
// caches server-side as a sidecar file, so a second call is instant and offline).

let _listCache = null;
let _listPromise = null;
const _infoCache = new Map();
const _infoPromise = new Map();

export async function listLoras(force = false) {
  if (!force && _listCache) return _listCache;
  if (!force && _listPromise) return _listPromise;
  _listPromise = (async () => {
    let result = [];
    try {
      const r = await fetch("/pixaroma/api/lora/list");
      const j = await r.json();
      _listCache = Array.isArray(j.loras) ? j.loras : [];
      result = _listCache;
    } catch {
      // Do NOT cache a transient failure - an empty [] is truthy and would stick
      // for the whole session ("No LoRAs" forever). Leave the cache null so the
      // next call retries; just return an empty list for this one.
      _listCache = null;
    }
    _listPromise = null;
    return _listCache || result;
  })();
  return _listPromise;
}

export async function loraInfo(name, force = false) {
  if (!name) return { ok: false, message: "No LoRA selected." };
  if (!force && _infoCache.has(name)) return _infoCache.get(name);
  // Dedupe concurrent non-forced fetches for the same name (two nodes, same LoRA)
  // so they share one response instead of racing to overwrite the cache.
  if (!force && _infoPromise.has(name)) return _infoPromise.get(name);
  const p = (async () => {
    try {
      const r = await fetch("/pixaroma/api/lora/info?name=" + encodeURIComponent(name));
      const j = await r.json();
      _infoCache.set(name, j);
      return j;
    } catch (e) {
      return { ok: false, message: "Could not reach the server." }; // not cached -> retry next time
    } finally {
      _infoPromise.delete(name);
    }
  })();
  if (!force) _infoPromise.set(name, p);
  return p;
}

// Drop a cached info entry (after a Civitai fetch rewrote the sidecar).
export function invalidateInfo(name) {
  _infoCache.delete(name);
}

export function thumbUrl(name) {
  return "/pixaroma/api/lora/thumb?name=" + encodeURIComponent(name);
}

export async function civitaiLookup(name) {
  try {
    const r = await fetch("/pixaroma/api/lora/civitai?name=" + encodeURIComponent(name));
    return await r.json();
  } catch {
    return { ok: false, reason: "offline", message: "Could not reach Civitai." };
  }
}
