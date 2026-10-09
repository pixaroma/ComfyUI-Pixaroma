// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - the things a page can DO             ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Add a node to the canvas, drag a card out onto the graph, copy the page, and
// copy a version line.
//
// "Add to canvas" is the one that changes what the help is FOR: you can read
// about a node and put it down without leaving the page. Everything else here
// is convenience.
//
// Adding a node is the ONLY place the browser touches the graph, and it is
// always an explicit user action, so the resulting "workflow changed" state is
// correct. Nothing else in the browser writes anything that gets serialized.

import { app } from "../../../scripts/app.js";
import { el } from "./window.mjs";
import { versionLine } from "../shared/version.mjs";

const DISCORD_URL = "https://discord.com/invite/gggpkVgBf3";
const YOUTUBE_URL = "https://www.youtube.com/@pixaroma";
const SITE_URL = "https://workflows.pixaroma.com/";
// the newest version + what is new, read live from GitLab by that page (a link only:
// the pack itself never asks the internet for a version)
const LATEST_URL = "https://workflows.pixaroma.com/latest/";

// A node's title is free text restored verbatim from a workflow file, so it is
// UNTRUSTED: a downloaded workflow can name a node `<img onerror=...>`. Toast
// takes HTML on purpose (for <b>), so anything interpolated into it must be
// escaped here first.
export const escText = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// ── toast ────────────────────────────────────────────────────
let toastTimer = null;
export function toast(win, html) {
  let t = win.querySelector(".pixhb-toast");
  // Lives inside the BODY, not the window, so it is positioned above the footer
  // bar by structure rather than by a magic offset that goes stale the moment
  // the footer wraps to two rows. Falls back to the window on an older frame.
  if (!t) {
    t = el("div", "pixhb-toast");
    (win.querySelector(".pixhb-body") || win).appendChild(t);
  }
  t.innerHTML = html;
  requestAnimationFrame(() => t.classList.add("pixhb-on"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("pixhb-on"), 2800);
}

export function flash(btn, word) {
  // Re-entrancy guard. Double-clicking within the flash window used to capture
  // "Added" as the label to restore, leaving the button permanently wrong.
  if (btn._pixFlashing) return;
  btn._pixFlashing = true;
  const old = btn.textContent;
  btn.textContent = word;
  btn.style.background = "#3ec371";
  btn.style.borderColor = "#3ec371";
  btn.style.color = "#fff";
  setTimeout(() => {
    btn.textContent = old;
    btn.style.background = btn.style.borderColor = btn.style.color = "";
    btn._pixFlashing = false;
  }, 850);
}

// ── placing nodes ────────────────────────────────────────────
// Graph coordinates for the middle of what the user is currently looking at,
// so a new node never lands somewhere off screen.
function centreOfView() {
  try {
    const c = app.canvas;
    const ds = c?.ds;
    const rect = c?.canvas?.getBoundingClientRect?.();
    if (ds && rect) {
      const scale = ds.scale || 1;
      return [
        (-ds.offset[0]) + (rect.width / 2) / scale - 90,
        (-ds.offset[1]) + (rect.height / 2) / scale - 40,
      ];
    }
  } catch { /* fall through to the origin */ }
  return [80, 80];
}

// Graph coordinates for a screen point, so a dropped card lands where it was let go.
export function graphPointFromClient(clientX, clientY) {
  try {
    const c = app.canvas;
    const rect = c?.canvas?.getBoundingClientRect?.();
    const ds = c?.ds;
    if (rect && ds) {
      const scale = ds.scale || 1;
      return [
        (clientX - rect.left) / scale - ds.offset[0] - 90,
        (clientY - rect.top) / scale - ds.offset[1] - 20,
      ];
    }
  } catch { /* fall through */ }
  return centreOfView();
}

export function createNodeAt(comfyClass, pos) {
  const LG = window.LiteGraph;
  if (!LG?.createNode || !app.graph) return null;
  const node = LG.createNode(comfyClass);
  if (!node) return null;
  node.pos = pos || centreOfView();
  app.graph.add(node);
  try {
    app.canvas?.selectNode?.(node);
  } catch { /* selection is a nicety, not a requirement */ }
  app.graph.setDirtyCanvas(true, true);
  return node;
}

// The auto-wiring helpers that used to live here (selectedNode, autoWire,
// couldWire) went with the "Add wired" button. Adding a node connected to the
// selection sounds helpful and mostly is not: the browser has to guess which
// slot you meant, and a guess that lands on the wrong one is worse than no wire
// at all. Dragging a card onto the canvas and wiring it yourself is one extra
// second and always right.

// ── clipboard ────────────────────────────────────────────────
// document.execCommand is kept as a fallback because navigator.clipboard is
// unavailable over plain http, which is exactly how people reach a ComfyUI on
// another machine on their LAN.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the old way */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// versionShort / versionLine moved to js/shared/version.mjs when the Workflows
// panel wanted the same footer chip - nothing about them is help-specific.
// Re-exported here so every existing importer is untouched.
export { versionShort, versionLine } from "../shared/version.mjs";

// Plain text of a help def, ready to paste into a Discord question.
export function helpAsText(entry) {
  const h = entry.help || {};
  const lines = [h.title || entry.title];
  if (h.tagline) lines.push(h.tagline);
  for (const s of (Array.isArray(h.sections) ? h.sections : []).filter((x) => x && typeof x === "object")) {
    // String() on both, matching content.mjs. A non-string heading would make
    // .toUpperCase throw, and because this runs in an async click handler the
    // throw is invisible: Copy as text would just quietly do nothing. A
    // non-string body would paste as "[object Object]".
    lines.push("", String(s.heading || "").toUpperCase());
    if (s.body) lines.push(String(s.body));
    // Array.isArray on every one of these, matching content.mjs and search.mjs.
    // `for (const x of (s.bullets || []))` throws on a non-array, and because
    // this runs inside an async click handler the throw is SILENT: no flash, no
    // toast, the Copy as text button simply does nothing.
    const arr = (v) => (Array.isArray(v) ? v : []);
    for (const b of arr(s.bullets)) lines.push("- " + b);
    for (const d of arr(s.defs)) {
      const [t, v] = Array.isArray(d) ? d : [d, ""];
      lines.push(`- ${t}: ${v}`);
    }
    // A pasted copy of the page has to carry the addresses, or someone reading
    // it outside the window has a button they cannot press. Skips a malformed
    // entry the same way the renderer does, so the two never disagree.
    for (const l of arr(s.links)) {
      if (!Array.isArray(l) || !l[1]) continue;
      lines.push(`- ${l[0]}: ${l[1]}`);
    }
  }
  if (h.footer) lines.push("", h.footer);
  lines.push("", versionLine());
  return lines.join("\n");
}

export function openExternal(url) {
  try { window.open(url, "_blank", "noopener,noreferrer"); } catch { /* popup blocked */ }
}
export const LINKS = { DISCORD_URL, YOUTUBE_URL, SITE_URL, LATEST_URL };
