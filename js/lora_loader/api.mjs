// LoRA Loader Pixaroma - thin fetch wrappers over the server routes in
// server_routes.py. The list is cached for the session; info is cached per LoRA so
// re-opening the info panel is instant. The Civitai call is never cached here (it
// caches server-side as a sidecar file, so a second call is instant and offline).

let _listCache = null;
let _listPromise = null;
const _infoCache = new Map();

export async function listLoras(force = false) {
  if (!force && _listCache) return _listCache;
  if (!force && _listPromise) return _listPromise;
  _listPromise = (async () => {
    try {
      const r = await fetch("/pixaroma/api/lora/list");
      const j = await r.json();
      _listCache = Array.isArray(j.loras) ? j.loras : [];
    } catch {
      _listCache = [];
    }
    _listPromise = null;
    return _listCache;
  })();
  return _listPromise;
}

export async function loraInfo(name, force = false) {
  if (!name) return { ok: false, message: "No LoRA selected." };
  if (!force && _infoCache.has(name)) return _infoCache.get(name);
  try {
    const r = await fetch("/pixaroma/api/lora/info?name=" + encodeURIComponent(name));
    const j = await r.json();
    _infoCache.set(name, j);
    return j;
  } catch (e) {
    return { ok: false, message: "Could not reach the server." };
  }
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
