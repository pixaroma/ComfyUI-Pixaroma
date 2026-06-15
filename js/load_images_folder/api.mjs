// Load Images from Folder Pixaroma — backend fetch helpers.

// List image files in a folder. Returns {ok, folder, files:[{file,name,size,mtime}], message?}.
export async function listFolder(folder, recursive) {
  try {
    const url =
      `/pixaroma/api/load_images_folder/list?path=${encodeURIComponent(folder)}` +
      `&recursive=${recursive ? 1 : 0}`;
    const r = await fetch(url);
    return await r.json();
  } catch (e) {
    return { ok: false, message: String(e), files: [] };
  }
}

// Thumbnail URL for one image (served by the backend, scaled to <=192px).
// mtime is folded in as a cache key so an edited file refreshes.
export function thumbURL(folder, rel, mtime) {
  return (
    `/pixaroma/api/load_images_folder/thumb?path=${encodeURIComponent(folder)}` +
    `&file=${encodeURIComponent(rel)}&mt=${Math.floor(mtime || 0)}`
  );
}

// Browse the server filesystem for the in-app folder picker (fallback).
// Returns {ok, path, parent, dirs:[{name, path, images}], message?}.
export async function browseFolder(path) {
  try {
    const url = `/pixaroma/api/load_images_folder/browse?path=${encodeURIComponent(path || "")}`;
    const r = await fetch(url);
    return await r.json();
  } catch (e) {
    return { ok: false, message: String(e), dirs: [] };
  }
}

// Pop the native OS folder dialog on the ComfyUI host. Returns {ok:true, path},
// {ok:false, cancelled} (user closed it), or {ok:false, unavailable} (non-Windows
// / remote) so the caller can fall back to the in-app browser.
export async function pickNativeFolder(startPath) {
  try {
    const url = `/pixaroma/api/load_images_folder/pick_native?path=${encodeURIComponent(startPath || "")}`;
    const r = await fetch(url);
    return await r.json();
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
