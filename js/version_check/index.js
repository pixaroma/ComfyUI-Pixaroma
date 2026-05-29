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

import { app } from "/scripts/app.js";
import { BRAND, applyAdaptiveCanvasOnly } from "../shared/index.mjs";

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
    .pix-vc-copy {
      box-sizing: border-box; width: 100%; min-height: 28px;
      border-radius: 6px; cursor: pointer; user-select: none;
      font: 600 12px 'Segoe UI', -apple-system, sans-serif;
      color: rgba(255,255,255,0.75);
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14);
      transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
    .pix-vc-copy:hover { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
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

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origCreated?.apply(this, arguments);
      injectCSS();

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

      wrap.append(rows, copyBtn);

      // --- Node UI row: live, color-coded ---
      let lastV2 = null;
      const refreshNodeUI = () => {
        const v2 = !!window.LiteGraph?.vueNodesMode;
        if (v2 === lastV2) return;
        lastV2 = v2;
        rNodes.value.textContent = v2 ? "Nodes 2.0" : "Legacy";
        rNodes.value.classList.toggle("is-v2", v2);
        rNodes.value.classList.toggle("is-legacy", !v2);
      };
      refreshNodeUI();
      this._pixVcTimer = setInterval(refreshNodeUI, 600);

      // --- Frontend (synchronous global) ---
      rFront.value.textContent = window.__COMFYUI_FRONTEND_VERSION__ || "unknown";

      // --- ComfyUI backend version ---
      fetch("/system_stats")
        .then((r) => r.json())
        .then((s) => {
          rComfy.value.textContent = s?.system?.comfyui_version || "unknown";
        })
        .catch(() => {
          rComfy.value.textContent = "unknown";
        });

      // --- Pixaroma plugin version ---
      fetch("/pixaroma/api/version")
        .then((r) => r.json())
        .then((j) => {
          rPix.value.textContent = j?.version || "unknown";
        })
        .catch(() => {
          rPix.value.textContent = "unknown";
        });

      // --- Copy button ---
      copyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const text =
          `ComfyUI:  ${rComfy.value.textContent}\n` +
          `Frontend: ${rFront.value.textContent}\n` +
          `Node UI:  ${rNodes.value.textContent}\n` +
          `Pixaroma: ${rPix.value.textContent}`;
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

      const widget = this.addDOMWidget(
        "pixaroma_version_check",
        // UNIQUE type so Nodes 2.0 keeps OUR element (no native-widget hijack).
        "pixaroma_version_check",
        wrap,
        {
          getValue: () => null,
          setValue: () => {},
          getMinHeight: () => MIN_H - 16,
          serialize: false,
        }
      );
      // Out of the legacy Parameters tab, visible in the Nodes 2.0 body.
      applyAdaptiveCanvasOnly(widget);

      this.size[0] = DEFAULT_W;
      this.size[1] = DEFAULT_H;
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
