// Shared AI Remove Background dropdown for Image Composer + Paint
// Pixaroma. Both editors render an identical model picker:
//   - BiRefNet Standard / HR / Matting (top, default-selected)
//   - separator
//   - rembg auto / Fast / Balanced / Best (below, existing behaviour)
//
// Un-installed BiRefNet variants render with reduced opacity and an
// inline "Download" link that opens the HuggingFace page in a new tab.
// The variants are still selectable; trying to run on a missing variant
// produces a clear error from the server route.

import { api } from "/scripts/api.js";

const BIREFNET_PRIORITY = ["birefnet", "birefnet-hr", "birefnet-matting"];

export async function fetchBgRemovalInfo() {
  try {
    const res = await api.fetchApi("/pixaroma/remove_bg_info", { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return { rembgInstalled: false, models: [], birefnet: { variants: [] } };
  }
}

// Choose the default model id given the info payload.
// Priority: any installed BiRefNet variant (in order standard, HR, matting),
// then rembg's "auto" (the existing default).
export function pickDefaultModel(info) {
  const variants = info?.birefnet?.variants || [];
  for (const id of BIREFNET_PRIORITY) {
    const v = variants.find((x) => x.id === id);
    if (v && v.installed) return id;
  }
  return "auto";
}

// Build the dropdown markup and wire it up.
//
// opts:
//   container   - HTMLElement, the row/cell that will hold the <select>
//   info        - the /remove_bg_info response (must have .birefnet)
//   value       - currently selected id (caller restores from layer / panel)
//   onChange    - (newId) => void
//
// Returns { select, refreshLabel(id) } so the caller can read .value or
// programmatically set selection and re-render the inline download link.
export function buildBgRemovalDropdown({ container, info, value, onChange }) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;width:100%;";

  const select = document.createElement("select");
  select.style.cssText =
    "width:100%;padding:4px 6px;background:#1c1c1c;color:#ddd;" +
    "border:1px solid #333;border-radius:4px;font-size:11px;";

  const rembgModels = Array.isArray(info?.models) ? info.models : [];
  const variants = info?.birefnet?.variants || [];
  const rembgOk = !!info?.rembgInstalled;

  // BiRefNet group (always rendered, even if empty - shows the user what's
  // available to download).
  const grpBiRef = document.createElement("optgroup");
  grpBiRef.label = "Pixaroma BiRefNet";
  for (const v of variants) {
    const opt = document.createElement("option");
    opt.value = v.id;
    const tail = v.installed
      ? `✓ installed`
      : `not installed - click Download below`;
    opt.textContent = `${v.label} - ${v.sizeMB} MB - ${tail}`;
    if (!v.installed) opt.style.color = "#888";
    opt.title = `${v.bestFor}\nResolution: ${v.resolution}x${v.resolution}\nVRAM: ${v.vram}`;
    grpBiRef.appendChild(opt);
  }
  if (variants.length) select.appendChild(grpBiRef);

  // rembg group
  if (rembgModels.length) {
    const grpRembg = document.createElement("optgroup");
    grpRembg.label = rembgOk ? "rembg" : "rembg (not installed)";
    for (const m of rembgModels) {
      const opt = document.createElement("option");
      opt.value = m.id;
      let label = m.label;
      if (m.id !== "auto") {
        const parts = [];
        if (m.sizeMB) parts.push(`${m.sizeMB} MB`);
        if (m.downloaded) parts.push("✓ downloaded");
        else if (m.available) parts.push("will download");
        if (parts.length) label += ` - ${parts.join(", ")}`;
      }
      opt.textContent = label;
      opt.disabled = !m.available;
      if (!m.available) opt.title = `Needs rembg ${m.minRembg}+ (you have ${info.rembgVersion || "unknown"})`;
      grpRembg.appendChild(opt);
    }
    select.appendChild(grpRembg);
  }

  // Initial selection: caller's value if it exists in the options, else
  // computed default.
  const allOptionValues = Array.from(select.querySelectorAll("option")).map((o) => o.value);
  const initial = allOptionValues.includes(value) ? value : pickDefaultModel(info);
  select.value = initial;

  // Inline download row - shows the HuggingFace link for the currently
  // selected BiRefNet variant if it's NOT installed. Hidden otherwise.
  const dlRow = document.createElement("div");
  dlRow.style.cssText =
    "font-size:10px;color:#888;line-height:1.4;display:none;";

  function refreshDownloadRow() {
    const v = variants.find((x) => x.id === select.value);
    if (v && !v.installed) {
      dlRow.style.display = "";
      dlRow.innerHTML =
        `<a href="${v.downloadUrl}" target="_blank" rel="noopener" ` +
        `style="color:#f66744;text-decoration:underline;cursor:pointer;">Download ${v.filename}</a>` +
        ` and place in <code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">${info.birefnet?.modelDir || "ComfyUI/models/background_removal"}</code>`;
    } else {
      dlRow.style.display = "none";
      dlRow.innerHTML = "";
    }
  }

  select.addEventListener("change", () => {
    refreshDownloadRow();
    if (typeof onChange === "function") onChange(select.value);
  });

  refreshDownloadRow();

  wrap.appendChild(select);
  wrap.appendChild(dlRow);
  container.appendChild(wrap);

  return {
    select,
    refreshLabel(id) {
      if (id !== undefined) select.value = id;
      refreshDownloadRow();
    },
  };
}
