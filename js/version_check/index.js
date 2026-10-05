// Version Check Pixaroma — an on-canvas panel showing the versions that
// matter for bug reports: ComfyUI (backend), ComfyUI frontend, the active
// node interface (Nodes 2.0 / Legacy), and the installed Pixaroma version.
// A Copy button copies all four lines as text.
//
// Sources (all verified 2026-05):
//   ComfyUI  -> GET /system_stats  -> system.comfyui_version
//   Frontend -> window.__COMFYUI_FRONTEND_VERSION__
//   Node UI  -> LiteGraph.vueNodesMode (live; polled)
//   Pixaroma -> GET /pixaroma/api/version
//
// Built with the Nodes 2.0 recipe (CLAUDE.md "ComfyUI Nodes 2.0 Migration"):
// a DOM widget with a UNIQUE type name + applyAdaptiveCanvasOnly, so the panel
// renders correctly in BOTH renderers.

import { app } from "../../../scripts/app.js";
import { BRAND, applyAdaptiveCanvasOnly,
  installCanvasZoomPassthrough, installNodeAccent, registerNodeAccent,
} from "../shared/index.mjs";
import { pixApiUrl } from "../shared/api_url.mjs";
import { growToCoreMinHeight, capComputeSizeInNodes2 } from "../shared/core_min_size.mjs";
// Namespace import (NOT a named import) so a STALE cached shared module that
// predates PIXAROMA_JS_VERSION yields `undefined` instead of a hard module link
// error — `undefined` IS the stale-cache signal we want to surface, not crash on.
import * as PixShared from "../shared/index.mjs";
const PIXAROMA_JS_VERSION = PixShared?.PIXAROMA_JS_VERSION ?? null;

const MIN_W = 240;
const MIN_H = 188;
const DEFAULT_W = 256;
const DEFAULT_H = 196;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pix-vc-wrap {
      width: 100%; height: 100%; box-sizing: border-box;
      display: flex; flex-direction: column; gap: 6px;
      padding: 8px; margin: 0;
      font: 12px 'Segoe UI', -apple-system, sans-serif;
    }
    .pix-vc-rows { display: flex; flex-direction: column; gap: 4px; }
    .pix-vc-row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 6px 9px; border-radius: 6px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10);
    }
    .pix-vc-label { color: rgba(255,255,255,0.62); font-weight: 500; }
    .pix-vc-value { color: #fff; font-weight: 700; font-variant-numeric: tabular-nums; }
    .pix-vc-value.is-v2 { color: #4cd07d; }
    .pix-vc-value.is-legacy { color: #6f9be0; }
    .pix-vc-value.is-warn { color: #ffb347; }
    .pix-vc-warn {
      display: none;
      padding: 7px 9px; border-radius: 6px; line-height: 1.35;
      background: color-mix(in srgb, var(--pix-acc,#f66744) 15%, transparent); border: 1px solid var(--pix-acc,#f66744);
      color: #ffd9cc;
    }
    .pix-vc-warn b { color: #fff; font-weight: 700; }
    /* Node UI value doubles as a one-click renderer switch. */
    .pix-vc-value.pix-vc-toggle {
      cursor: pointer; padding: 2px 9px; border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05);
      transition: background 0.12s, border-color 0.12s;
    }
    .pix-vc-value.pix-vc-toggle:hover {
      background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.34);
    }
    .pix-vc-btnrow { display: flex; gap: 6px; }
    .pix-vc-copy {
      box-sizing: border-box; flex: 1; min-width: 0; min-height: 28px;
      border-radius: 6px; cursor: pointer; user-select: none;
      font: 600 12px 'Segoe UI', -apple-system, sans-serif;
      color: rgba(255,255,255,0.75);
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14);
      transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
    .pix-vc-copy:hover { background: var(--pix-acc,#f66744); border-color: var(--pix-acc,#f66744); color: #fff; }
    .pix-vc-copy.is-flashing,
    .pix-vc-copy.is-flashing:hover { background: #3ec371; border-color: #3ec371; color: #fff; }
  `;
  document.head.appendChild(style);
}

function makeRow(label) {
  const row = document.createElement("div");
  row.className = "pix-vc-row";
  const l = document.createElement("span");
  l.className = "pix-vc-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "pix-vc-value";
  v.textContent = "…";
  row.appendChild(l);
  row.appendChild(v);
  return { row, value: v };
}

app.registerExtension({
  name: "Pixaroma.VersionCheck",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaVersionCheck") return;
    capComputeSizeInNodes2(nodeType); // Nodes 2.0 Ctrl+Z grow on frontend 1.53 (version-check.md)

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origCreated?.apply(this, arguments);
      injectCSS();
      const node = this;

      const wrap = document.createElement("div");
      wrap.className = "pix-vc-wrap";
      const rows = document.createElement("div");
      rows.className = "pix-vc-rows";
      const rComfy = makeRow("ComfyUI");
      const rFront = makeRow("Frontend");
      const rNodes = makeRow("Node UI");
      const rPix = makeRow("Pixaroma");
      rows.append(rComfy.row, rFront.row, rNodes.row, rPix.row);

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "pix-vc-copy";
      copyBtn.textContent = "Copy";
      copyBtn.title = "Copy all versions as text (for bug reports)";

      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.className = "pix-vc-copy";
      refreshBtn.textContent = "⟳ Refresh";
      refreshBtn.title =
        "Clear the app cache and reload the page (like Ctrl+Shift+R). " +
        "Note: browsers don't let a button force a full hard-reload — for a " +
        "guaranteed cache bypass use Ctrl+Shift+R.";
      refreshBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        refreshBtn.textContent = "⟳ …";
        try {
          // Clear Cache Storage (service-worker / PWA caches) — the only cache
          // JS can actually purge. The HTTP disk cache can't be cleared from a
          // page; location.reload() revalidates per cache headers.
          if (window.caches?.keys) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch (err) {
          console.warn("[PixaromaVersionCheck] cache clear failed:", err);
        }
        location.reload();
      });

      const btnRow = document.createElement("div");
      btnRow.className = "pix-vc-btnrow";
      btnRow.append(copyBtn, refreshBtn);

      // Hidden until a stale-cache mismatch is detected (see the Pixaroma fetch).
      const warn = document.createElement("div");
      warn.className = "pix-vc-warn";

      wrap.append(rows, warn, btnRow);

      // --- Node UI row: live, color-coded ---
      let lastV2 = null;
      const refreshNodeUI = () => {
        const v2 = !!window.LiteGraph?.vueNodesMode;
        if (v2 === lastV2) return;
        lastV2 = v2;
        rNodes.value.textContent = (v2 ? "Nodes 2.0" : "Legacy") + "  ⇄";
        rNodes.value.classList.toggle("is-v2", v2);
        rNodes.value.classList.toggle("is-legacy", !v2);
      };
      refreshNodeUI();
      this._pixVcTimer = setInterval(refreshNodeUI, 600);

      // Make the Node UI value a one-click renderer switch, so the user can
      // flip Nodes 2.0 <-> Legacy without trekking into Settings. The setting
      // Comfy.VueNodes.Enabled drives LiteGraph.vueNodesMode (verified in the
      // frontend's useVueFeatureFlags.ts); flipping it re-renders the canvas.
      rNodes.value.classList.add("pix-vc-toggle");
      rNodes.value.title = "Click to switch the node renderer (Nodes 2.0 ⇄ Legacy). The page reloads so existing nodes rebuild for the chosen renderer.";
      rNodes.value.addEventListener("click", async (e) => {
        e.stopPropagation();
        const cur = !!window.LiteGraph?.vueNodesMode;
        try {
          await app.ui.settings.setSettingValueAsync("Comfy.VueNodes.Enabled", !cur);
          // Reload so EVERY node rebuilds for the new renderer. Switching live
          // leaves already-created nodes built for the old renderer (each node
          // chooses canvas-vs-DOM widgets once, at creation), which misbehave
          // until a refresh. setSettingValueAsync has already persisted the
          // value to the backend (awaited above), so the reload picks it up.
          // If the open workflow has unsaved edits, ComfyUI's own beforeunload
          // guard will prompt before the reload - intended safety.
          refreshNodeUI();
          location.reload();
        } catch (err) {
          console.error("[PixaromaVersionCheck] renderer toggle failed:", err);
          setTimeout(refreshNodeUI, 50);
        }
      });

      // --- Frontend (synchronous global) ---
      rFront.value.textContent = window.__COMFYUI_FRONTEND_VERSION__ || "unknown";

      // --- ComfyUI backend version ---
      // Core's own route, so it needs the same prefixing as ours: on a hosted
      // ComfyUI the page origin is the platform's web app, not the API, and a
      // bare "/system_stats" answers 401 -> this row silently reads "unknown".
      // (Run Log asks for the very same route via api.fetchApi.)
      fetch(pixApiUrl("/system_stats"))
        .then((r) => r.json())
        .then((s) => {
          rComfy.value.textContent = s?.system?.comfyui_version || "unknown";
        })
        .catch(() => {
          rComfy.value.textContent = "unknown";
        });

      // --- Pixaroma plugin version (files) + stale-cache check ---
      // rPix shows the version of the files on disk (read from Python).
      // PIXAROMA_JS_VERSION is the version baked into the JS the browser actually
      // loaded. If they differ, the browser is running STALE cached code -> tell
      // the user to hard-refresh. (This node's own number comes from Python, so
      // without this check a stale browser still shows the new number and hides
      // the problem - the exact trap this catches.)
      fetch(pixApiUrl("/pixaroma/api/version"))
        .then((r) => r.json())
        .then((j) => {
          const pyVer = j?.version || "unknown";
          node._pixVcPyVersion = pyVer;
          rPix.value.textContent = pyVer;
          if (pyVer !== "unknown" && PIXAROMA_JS_VERSION !== pyVer) {
            rPix.value.textContent = pyVer + "  ⚠️";
            rPix.value.classList.add("is-warn");
            warn.style.display = "block";
            warn.innerHTML =
              `⚠️ <b>Browser cache outdated.</b> Running <b>` +
              `${PIXAROMA_JS_VERSION || "unknown"}</b>, files are <b>${pyVer}</b>. ` +
              `Press <b>Ctrl+Shift+R</b> to update.`;
            // Grow so the banner is fully visible. Legacy doesn't auto-grow on a
            // late getMinHeight change, so next frame (once the banner has laid
            // out and its real height - incl. text wrapping - is known) fit the
            // node to content via computeSize.
            requestAnimationFrame(() => {
              const min = node.computeSize?.();
              if (min && node.size[1] < min[1]) node.setSize?.([node.size[0], min[1]]);
              node.setDirtyCanvas?.(true, true);
            });
          }
        })
        .catch(() => {
          rPix.value.textContent = "unknown";
        });

      // --- Copy button ---
      copyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        // Compute the Node UI value cleanly (the displayed text carries a
        // trailing "⇄" switch glyph that must NOT end up in the copied text).
        const nodeUi = window.LiteGraph?.vueNodesMode ? "Nodes 2.0" : "Legacy";
        const pyVer = node._pixVcPyVersion || "unknown";
        const jsVer = PIXAROMA_JS_VERSION || "unknown";
        const stale = pyVer !== "unknown" && jsVer !== pyVer;
        const pixLine = stale
          ? `Pixaroma: ${pyVer} (browser ${jsVer})  ⚠️ CACHE OUTDATED - press Ctrl+Shift+R`
          : `Pixaroma: ${pyVer}`;
        const text =
          `ComfyUI:  ${rComfy.value.textContent}\n` +
          `Frontend: ${rFront.value.textContent}\n` +
          `Node UI:  ${nodeUi}\n` +
          pixLine;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
          }
          copyBtn.textContent = "Copied";
          copyBtn.classList.add("is-flashing");
          clearTimeout(copyBtn._t);
          copyBtn._t = setTimeout(() => {
            copyBtn.textContent = "Copy";
            copyBtn.classList.remove("is-flashing");
          }, 800);
        } catch (err) {
          console.error("[PixaromaVersionCheck] copy failed", err);
        }
      });

      installCanvasZoomPassthrough(wrap);
      installNodeAccent(this, wrap);   // the face follows this node's accent colour
      const widget = this.addDOMWidget(
        "pixaroma_version_check",
        // UNIQUE type so Nodes 2.0 keeps OUR element (no native-widget hijack).
        "pixaroma_version_check",
        wrap,
        {
          getValue: () => null,
          setValue: () => {},
          // Grow to fit the stale-cache banner when it shows - MEASURED, so it
          // handles the text wrapping to more lines on a narrow node. Nodes 2.0
          // sizes the body straight from this; legacy refits via computeSize.
          getMinHeight: () =>
            (MIN_H - 16) + (warn.style.display === "block" ? warn.offsetHeight + 6 : 0),
          serialize: false,
        }
      );
      // Out of the legacy Parameters tab, visible in the Nodes 2.0 body.
      applyAdaptiveCanvasOnly(widget);

      this.size[0] = DEFAULT_W;
      this.size[1] = DEFAULT_H;
      // Classic fresh drop: up to core's own height (210), or the first Ctrl+Z
      // grows the node 14px and jams undo (version-check.md, "UNDO JAM").
      growToCoreMinHeight(this);
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._pixVcTimer) {
        clearInterval(this._pixVcTimer);
        this._pixVcTimer = null;
      }
      origRemoved?.apply(this, arguments);
    };

    // Min-size self-heal (legacy renderer; harmless no-op in Nodes 2.0).
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      origDraw?.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };
  },
});

// The colour option: gives this node a right-click "Version Check settings" entry, the
// gear in the selection toolbar, and the shared colour panel behind both.
registerNodeAccent("PixaromaVersionCheck", { title: "Version Check" });
