// The folder a save node writes to when its folder box is EMPTY = ComfyUI's
// output folder. "Will save as" showed a fixed "…\ComfyUI\output" for it, but
// ComfyUI started with --output-directory X (or --base-directory B) writes to
// X (or B\output) instead: a bug hunter's Save Image said ComfyUI\output while
// the files went to E:\SDXL\Output (2026-11-16, save-image.md #33).
//
// The browser learns the flags from core's own /system_stats, whose "argv" is
// the server's sys.argv: no route of ours, no path sent from the server. The
// label is DISPLAY only; Python still decides the real folder at save time.
// Used by Save Image Pixaroma and Save Video Pixaroma.

export const DEFAULT_OUTPUT_LABEL = "…\\ComfyUI\\output";

// argparse rules (comfy/cli_args.py: ArgumentParser() = allow_abbrev, then
// parse_args): "--flag value" or "--flag=value"; a unique abbreviation counts
// (the first 4 letters, dashes included, are the shortest: --output-directory
// sits beside --oneapi... and --offline, --base-directory beside --bf16-...); the LAST one
// wins; --output-directory overrides --base-directory. Returns the display
// label, or null when neither flag is there (= the default folder).
export function outputLabelFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  let out = null;
  let base = null;
  for (let i = 1; i < argv.length; i++) {
    const a = String(argv[i]);
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    const key = eq >= 0 ? a.slice(0, eq) : a;
    const isOut = key.length >= 4 && "--output-directory".startsWith(key);
    const isBase = key.length >= 4 && "--base-directory".startsWith(key);
    if (!isOut && !isBase) continue;
    const val = eq >= 0 ? a.slice(eq + 1) : i + 1 < argv.length ? String(argv[i + 1]) : "";
    if (!val || val.startsWith("--")) continue;
    if (isOut) out = val;
    else base = val;
  }
  const show = (p) => p.replace(/\//g, "\\").replace(/\\+$/, "") || "\\";
  if (out) return show(out);
  if (base) return show(base) + "\\output";
  return null;
}

let label = DEFAULT_OUTPUT_LABEL;
let started = false;
const waiters = [];

function start() {
  if (started) return;
  started = true;
  (async () => {
    try {
      // core module, static relative path at this file's depth (hosted-urls.md #11)
      const { api } = await import("../../../scripts/api.js");
      const r = await api.fetchApi("/system_stats");
      if (!r.ok) return;
      const j = await r.json();
      const found = outputLabelFromArgv(j?.system?.argv);
      if (!found || found === label) return;
      label = found;
      for (const fn of waiters) {
        try { fn(); } catch (e) { console.warn("[Pixaroma] output folder refresh", e); }
      }
    } catch (e) {
      // no answer = keep the default label; the save itself is not affected
    }
  })();
}

// What "Will save as" shows for an empty folder box. The first call starts the
// one-time read; until it answers (or when the flags are absent) the default.
export function outputFolderLabel() {
  start();
  return label;
}

// Run fn when the label changes from the default (once, after the read), so a
// node can redraw a preview it drew before the answer came.
export function onOutputFolderLabel(fn) {
  waiters.push(fn);
  start();
}
