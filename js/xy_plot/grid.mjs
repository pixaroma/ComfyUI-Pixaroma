// XY Plot Pixaroma - in-node grid preview (an <img> showing Python's latest
// assembled grid PNG) + the Save Disk / Save Output / Copy / Open button row.
//
// Python owns all grid rendering, so this is just display + save plumbing.
// An <img> is resolution-independent, so it stays crisp at any zoom in both
// renderers (the Nodes 2.0 canvas-blur rule doesn't apply to <img>).

import { app } from "/scripts/app.js";
import { readState } from "./core.mjs";

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

function toast(summary, detail, severity = "info") {
  const tm = app.extensionManager?.toast;
  if (tm && typeof tm.add === "function") {
    try { tm.add({ severity, summary, detail, life: 3500 }); return; } catch (_e) {}
  }
  try {
    const b = el("div", null, `${summary}: ${detail}`);
    b.style.cssText = "position:fixed;top:60px;right:20px;background:#1d1d1d;color:#fff;font:13px sans-serif;padding:10px 14px;border-radius:6px;border:2px solid #f66744;z-index:99999;";
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 3500);
  } catch (_e) {}
}

function prefixOf(node) {
  const w = node.widgets?.find((x) => x && x.name === "filename_prefix");
  const v = (w && typeof w.value === "string") ? w.value.trim() : "";
  return v || "xy_plot";
}

async function fetchGridBlob(node) {
  const last = node._pixXyLastGrid;
  if (!last || !last.url) return null;
  try {
    const resp = await fetch(last.url, { cache: "no-store" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    // Force image/png so ClipboardItem (strict) accepts it.
    return blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
  } catch (_e) { return null; }
}

async function doCopy(node) {
  const blob = await fetchGridBlob(node);
  if (!blob) { toast("XY Plot", "No grid to copy yet.", "warn"); return; }
  if (!navigator.clipboard || !window.ClipboardItem) {
    toast("XY Plot", "Clipboard image copy isn't supported in this browser.", "warn"); return;
  }
  try {
    await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
    toast("XY Plot", "Grid copied to clipboard.");
  } catch (_e) { toast("XY Plot", "Copy failed.", "error"); }
}

function doOpen(node) {
  const last = node._pixXyLastGrid;
  if (!last || !last.url) { toast("XY Plot", "No grid to open yet.", "warn"); return; }
  // Use an <a target="_blank"> click rather than window.open(...,"noopener"):
  // Chrome returns null from window.open when "noopener" is set even on
  // success, which made the old code falsely report "popup blocked".
  const a = el("a");
  a.href = last.url;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function doSaveDisk(node) {
  const blob = await fetchGridBlob(node);
  if (!blob) { toast("XY Plot", "No grid to save yet.", "warn"); return; }
  const name = prefixOf(node).split("/").pop() + "_grid.png";
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
      });
      const ws = await handle.createWritable();
      await ws.write(blob); await ws.close();
      toast("XY Plot", "Grid saved to disk.");
    } else {
      const url = URL.createObjectURL(blob);
      const a = el("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
    }
  } catch (e) {
    if (e && e.name === "AbortError") return; // user cancelled
    toast("XY Plot", "Save to disk failed.", "error");
  }
}

async function doSaveOutput(node) {
  const last = node._pixXyLastGrid;
  if (!last || !last.filename) { toast("XY Plot", "No grid to save yet.", "warn"); return; }
  const state = readState(node);
  let prompt = null, workflow = null;
  try {
    const gp = await app.graphToPrompt();
    prompt = gp?.output || null;
    workflow = gp?.workflow || null;
  } catch (_e) {}
  try {
    const resp = await fetch("/pixaroma/api/xy_plot/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grid_filename: last.filename,
        session_id: last.sessionId || null,
        filename_prefix: prefixOf(node),
        save_cells: state.saveCells === true,
        prompt, workflow,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) { toast("XY Plot", data.error || "Save to output failed.", "error"); return; }
    const extra = data.saved_cells ? ` (+${data.saved_cells} cells)` : "";
    toast("XY Plot", `Saved to output/${data.subfolder ? data.subfolder + "/" : ""}${data.filename}${extra}`);
  } catch (_e) {
    toast("XY Plot", "Save to output failed.", "error");
  }
}

// Build the preview + button row into `mount` (the .pix-xy-gridmount element).
// Returns an API object cached on the node by index.js.
export function buildGridPreview(node, mount) {
  mount.innerHTML = "";
  const box = el("div", "pix-xy-gridbox");
  const hint = el("div", "pix-xy-gridhint", "The labeled grid appears here after you hit Run.");
  const img = el("img", "pix-xy-gridimg");
  img.style.display = "none";
  // Once the grid bitmap actually loads, fit the node to it (grow OR shrink)
  // so a smaller plot tightens the node back up. Repaint either way.
  img.addEventListener("load", () => {
    try { node._pixXyFit?.(); } catch (_e) {}
    try { node.setDirtyCanvas?.(true, true); } catch (_e) {}
  });
  box.appendChild(hint);
  box.appendChild(img);
  mount.appendChild(box);

  const bar = el("div", "pix-xy-savebar");
  const mk = (label, fn) => { const b = el("div", "pix-xy-sb", label); b.addEventListener("click", () => fn(node)); return b; };
  const bSave = mk("Save Disk", doSaveDisk);
  const bOut = mk("Save Output", doSaveOutput);
  const bCopy = mk("Copy", doCopy);
  const bOpen = mk("Open", doOpen);
  bar.appendChild(bSave); bar.appendChild(bOut); bar.appendChild(bCopy); bar.appendChild(bOpen);
  mount.appendChild(bar);

  const setEnabled = (on) => {
    [bSave, bOut, bCopy, bOpen].forEach((b) => b.classList.toggle("disabled", !on));
  };
  setEnabled(false);

  return {
    setGrid(url) {
      img.src = url;
      img.style.display = "block";
      hint.style.display = "none";
      setEnabled(true);
    },
    clear() {
      img.removeAttribute("src");
      img.style.display = "none";
      hint.style.display = "";
      setEnabled(false);
    },
  };
}
