// The wired `name` input of Save Image / Save Video Pixaroma, resolved for the
// live "Will save as" line. DISPLAY ONLY: Python recomputes the name at save
// time and never sees anything from here.
//
// ONE copy for both nodes (2026-09-29). Save Video had its own version that took
// the FIRST text widget of any name on the source node - on Concatenate Text
// that is its first box, so the line showed `clips_001.mp4` for a file really
// named `clips_-take_001.mp4` - and returned "" when it could not tell, so the
// name silently vanished (`001.mp4`). Save Image printed the literal word
// `name`, which read as a real filename (Discord 2026-09-28).
import { app } from "../../../scripts/app.js";
import { cleanInputName } from "./filename_mirror.mjs";

// Stands in for a wired name that is only known once the workflow runs (a
// Concatenate Text, a Text Join, Load Images from Folder's per-image filename).
// Letters only, so it passes through the date, token and sanitizer-mirror steps
// untouched; setPreviewPath draws it as a marked placeholder.
export const WIRED_UNKNOWN = "PIXWIREDNAMEUNKNOWN";
const WIRED_LABEL = "‹wired name›";
export const WIRED_TIP =
  "The part in ‹ › comes from the node wired into name. That node makes its " +
  "text while the workflow runs, so it cannot be shown here - the file still " +
  "gets the real text.";

// "" when nothing is wired, the cleaned text when the browser can know it, and
// WIRED_UNKNOWN when only a run can. `keepFolders` mirrors the node's own rule
// for slashes in the wired text (Save Video always flattens them).
export function resolveWiredName(node, keepFolders = false) {
  try {
    const inp = node.inputs && node.inputs.find((i) => i && i.name === "name");
    if (!inp || inp.link == null) return "";
    // node.graph first: app.graph holds only TOP-LEVEL nodes and the node may
    // live inside a subgraph
    const graph = node.graph || app.graph;
    let link = graph.links?.[inp.link];
    if (!link && typeof graph.links?.get === "function") link = graph.links.get(inp.link);
    if (!link) return WIRED_UNKNOWN;
    const origin = graph.getNodeById ? graph.getNodeById(link.origin_id) : null;
    if (!origin) return WIRED_UNKNOWN;
    if (origin.comfyClass === "PixaromaLoadImage") {
      const w = origin.widgets?.find((x) => x && x.name === "image");
      let v = typeof w?.value === "string" ? w.value : "";
      v = v.replace(/\s*\[(input|output|temp)\]\s*$/i, "");
      v = v.split("/").pop().split("\\").pop();
      return cleanInputName(v, keepFolders) || WIRED_UNKNOWN;
    }
    // a plain text-ish widget on the origin (Text Pixaroma etc.) - best effort
    const tw = origin.widgets?.find(
      (x) => x && typeof x.value === "string" && x.value &&
        (x.name === "text" || x.name === "value" || x.name === "string")
    );
    if (tw) return cleanInputName(String(tw.value).slice(0, 60), keepFolders) || WIRED_UNKNOWN;
    return WIRED_UNKNOWN; // wired, value only known at run time
  } catch {
    return WIRED_UNKNOWN;
  }
}

// %run_time% (how long the run took until the save, 2026-11-09) is only known
// once the workflow runs, so the line draws it as a marked ‹run time› the same
// way. Unlike the wired name it is NOT swapped for a sentinel before the
// counter fetch: the token itself goes to the next_counter route, whose scan
// reads it as "any run time" (_save_helpers._next_counter), so the number shown
// is the one a Run really writes. It survives the date, %Node.widget% and
// sanitizer-mirror steps unchanged (letters, `_` and `%` only). Only AFTER that
// does the caller mark it, with markRunTime, in the NAME part only: the folder
// box is not tokenized (a % there is an environment variable), so a %run_time%
// typed in it stays literal on disk and must stay literal on the line.
export const RUN_TIME_TOKEN = "%run_time%";
const RUN_TIME_PENDING = "PIXRUNTIMEPENDING";
const RUN_TIME_LABEL = "‹run time›";
export const RUN_TIME_TIP =
  "‹run time› is how long the run has taken when this node saves, for example " +
  "42s or 1m05s. It is only known once the workflow runs - the file gets the " +
  "real time.";
const PLACEHOLDER_RE = new RegExp(WIRED_UNKNOWN + "|" + RUN_TIME_PENDING, "g");

export function markRunTime(name) {
  return String(name).split(RUN_TIME_TOKEN).join(RUN_TIME_PENDING);
}

// Write the preview path into `el`, drawing any WIRED_UNKNOWN or marked run
// time as a placeholder with the node's own class. DOM text nodes only, never
// innerHTML: the path carries user-typed text. Returns whether a placeholder
// was drawn; previewTip(text) gives the tooltip that explains it.
export function setPreviewPath(el, text, className) {
  const str = String(text);
  if (!str.includes(WIRED_UNKNOWN) && !str.includes(RUN_TIME_PENDING)) {
    el.textContent = text;
    return false;
  }
  el.textContent = "";
  let last = 0;
  for (const m of str.matchAll(PLACEHOLDER_RE)) {
    if (m.index > last) el.appendChild(document.createTextNode(str.slice(last, m.index)));
    const tag = document.createElement("span");
    tag.className = className;
    tag.textContent = m[0] === WIRED_UNKNOWN ? WIRED_LABEL : RUN_TIME_LABEL;
    el.appendChild(tag);
    last = m.index + m[0].length;
  }
  if (last < str.length) el.appendChild(document.createTextNode(str.slice(last)));
  return true;
}

// The tooltip for the placeholders setPreviewPath draws in `text` ("" if none).
export function previewTip(text) {
  const str = String(text);
  const tips = [];
  if (str.includes(WIRED_UNKNOWN)) tips.push(WIRED_TIP);
  if (str.includes(RUN_TIME_PENDING)) tips.push(RUN_TIME_TIP);
  return tips.join("\n\n");
}
