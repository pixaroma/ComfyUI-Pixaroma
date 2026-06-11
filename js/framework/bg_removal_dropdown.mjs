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

  // rembg group. Labels include the actual rembg model name in parens so
  // the user can tell what "Fast" vs "Best" actually mean. Entries stay
  // SELECTABLE even when not installed - the helpRow below explains what
  // to do, instead of a silent disabled click that gives no feedback.
  // Friendly names for the underlying rembg model ids (server returns the
  // raw ids; we surface the human-friendly bit in the dropdown label).
  const REMBG_MODEL_NAMES = {
    "u2net": "u2net",
    "isnet-general-use": "isnet",
    "birefnet-general": "BiRefNet via rembg",
  };
  if (rembgModels.length) {
    const grpRembg = document.createElement("optgroup");
    grpRembg.label = rembgOk ? "rembg" : "rembg (not installed)";
    for (const m of rembgModels) {
      const opt = document.createElement("option");
      opt.value = m.id;
      // Prefix every entry with "rembg" so the user sees which library is
      // running. "rembg Fast (u2net)" reads better than just "Fast".
      let label;
      if (m.id === "auto") {
        label = `rembg Auto (tries best installed)`;
      } else {
        const modelName = REMBG_MODEL_NAMES[m.id] || m.id;
        label = `rembg ${m.label} (${modelName})`;
        const parts = [];
        if (m.sizeMB) parts.push(`${m.sizeMB} MB`);
        if (!rembgOk) parts.push("rembg not installed");
        else if (m.downloaded) parts.push("✓ downloaded");
        else if (m.available) parts.push("will download");
        else parts.push(`needs rembg ${m.minRembg}+`);
        if (parts.length) label += ` - ${parts.join(", ")}`;
      }
      opt.textContent = label;
      // Greyed style for any rembg entry the user can't actually run yet
      // (rembg missing OR specific model needs newer rembg version).
      const usable = rembgOk && m.available;
      if (!usable) opt.style.color = "#888";
      // NOTE: deliberately NOT setting opt.disabled. The user needs to be
      // able to click and see the help text in the row below.
      grpRembg.appendChild(opt);
    }
    select.appendChild(grpRembg);
  }

  // Initial selection: caller's value if it exists in the options, else
  // computed default.
  const allOptionValues = Array.from(select.querySelectorAll("option")).map((o) => o.value);
  const initial = allOptionValues.includes(value) ? value : pickDefaultModel(info);
  select.value = initial;

  // Inline help row - shows EITHER:
  //   - For an un-installed BiRefNet variant: HuggingFace download link
  //   - For a rembg entry when rembg is missing: pip install instructions
  //   - For a rembg entry that needs a newer rembg version: upgrade hint
  //   - For a rembg entry whose model isn't downloaded yet: size + first-use note
  //   - Hidden otherwise
  const helpRow = document.createElement("div");
  helpRow.style.cssText =
    "font-size:10px;color:#888;line-height:1.4;display:none;";

  const rembgById = (id) => rembgModels.find((x) => x.id === id);
  // One canonical doc page covering BOTH BiRefNet downloads and rembg
  // install steps, so the user lands somewhere maintained instead of
  // bouncing to whichever upstream repo we happened to link.
  const HELP_DOCS_URL = "https://gitlab.com/pixaroma/comfyui-pixaroma#2-optional-ai-background-removal";

  function refreshHelpRow() {
    const id = select.value;
    const v = variants.find((x) => x.id === id);
    const m = rembgById(id);

    // BiRefNet variant, not installed -> show download link + Read more.
    if (v && !v.installed) {
      helpRow.style.display = "";
      helpRow.innerHTML =
        `<a href="${v.downloadUrl}" target="_blank" rel="noopener" ` +
        `style="color:#f66744;text-decoration:underline;cursor:pointer;">Download ${v.filename}</a>` +
        ` and place in <code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">${info.birefnet?.modelDir || "ComfyUI/models/background_removal"}</code>. ` +
        `<a href="${HELP_DOCS_URL}" target="_blank" rel="noopener" ` +
        `style="color:#f66744;text-decoration:underline;cursor:pointer;">Read more</a>`;
      return;
    }

    // rembg entry, rembg missing entirely -> pip install help + Read more.
    if (m && !rembgOk) {
      helpRow.style.display = "";
      helpRow.innerHTML =
        `<span style="color:#e57">rembg not installed.</span> ` +
        `Open <code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">ComfyUI/python_embeded</code> in File Explorer, ` +
        `type <code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">cmd</code> in the address bar, then run ` +
        `<code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">python.exe -m pip install rembg</code>. ` +
        `Restart ComfyUI. ` +
        `<a href="${HELP_DOCS_URL}" target="_blank" rel="noopener" ` +
        `style="color:#f66744;text-decoration:underline;cursor:pointer;">Read more</a>`;
      return;
    }

    // rembg entry, rembg installed but THIS specific model needs newer rembg.
    if (m && rembgOk && !m.available) {
      helpRow.style.display = "";
      helpRow.innerHTML =
        `<span style="color:#e57">Needs rembg ${m.minRembg}+ (you have ${info.rembgVersion || "unknown"}).</span> ` +
        `Update with <code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">python.exe -m pip install --upgrade rembg</code> ` +
        `in ComfyUI/python_embeded, then restart. ` +
        `<a href="${HELP_DOCS_URL}" target="_blank" rel="noopener" ` +
        `style="color:#f66744;text-decoration:underline;cursor:pointer;">Read more</a>`;
      return;
    }

    // rembg entry, model file not downloaded yet -> first-use note.
    if (m && rembgOk && m.available && !m.downloaded && m.id !== "auto") {
      helpRow.style.display = "";
      helpRow.innerHTML =
        `First use downloads ~${m.sizeMB} MB to ` +
        `<code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">${info.modelDir || "ComfyUI/models/rembg"}</code>.`;
      return;
    }

    // Everything fine - hide the help row.
    helpRow.style.display = "none";
    helpRow.innerHTML = "";
  }

  select.addEventListener("change", () => {
    refreshHelpRow();
    if (typeof onChange === "function") onChange(select.value);
  });

  refreshHelpRow();

  wrap.appendChild(select);
  wrap.appendChild(helpRow);
  container.appendChild(wrap);

  return {
    select,
    refreshLabel(id) {
      if (id !== undefined) select.value = id;
      refreshHelpRow();
    },
  };
}
