import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

const MIN_W = 200;
const MIN_H = 120;
const DEFAULT_W = 280;
const DEFAULT_H = 200;
const PLACEHOLDER = "text...";

// One-shot CSS injection. The hover-reveal needs a CSS selector
// (.pix-st-wrap:hover .pix-st-copy), so we can't do it with inline styles.
let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pix-st-copy {
      position: absolute;
      bottom: 8px;
      right: 14px;
      font: 11px 'Segoe UI', -apple-system, sans-serif;
      padding: 2px 8px;
      background: rgba(20, 20, 20, 0.92);
      color: ${BRAND};
      border: 1px solid ${BRAND};
      border-radius: 3px;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.12s, background 0.12s, color 0.12s;
      z-index: 2;
      user-select: none;
    }
    .pix-st-wrap:hover .pix-st-copy {
      opacity: 0.9;
      pointer-events: auto;
    }
    .pix-st-copy:hover {
      opacity: 1 !important;
      background: ${BRAND};
      color: #fff;
    }
    .pix-st-copy.copied {
      opacity: 1 !important;
      background: #2e7d32;
      border-color: #2e7d32;
      color: #fff;
    }
  `;
  document.head.appendChild(style);
}

app.registerExtension({
  name: "Pixaroma.ShowText",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaShowText") return;

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origOnNodeCreated?.apply(this, arguments);
      injectCSS();

      const wrap = document.createElement("div");
      wrap.className = "pix-st-wrap";
      wrap.style.cssText = `
        position: relative;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        display: flex;
      `;

      const ta = document.createElement("textarea");
      ta.readOnly = true;
      ta.placeholder = PLACEHOLDER;
      ta.spellcheck = false;
      ta.style.cssText = `
        flex: 1;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        background: #111;
        color: #c8c8c8;
        border: 1.5px solid ${BRAND};
        border-radius: 4px;
        padding: 8px;
        margin: 0;
        font-family: monospace;
        font-size: 13px;
        line-height: 1.3;
        resize: none;
        outline: none;
        white-space: pre-wrap;
        overflow: auto;
      `;
      wrap.appendChild(ta);

      const copyBtn = document.createElement("button");
      copyBtn.className = "pix-st-copy";
      copyBtn.type = "button";
      copyBtn.textContent = "Copy";
      copyBtn.title = "Copy text to clipboard";
      copyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const text = ta.value || "";
        if (!text) return;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            ta.select();
            document.execCommand("copy");
          }
          copyBtn.textContent = "Copied";
          copyBtn.classList.add("copied");
          clearTimeout(copyBtn._resetTimer);
          copyBtn._resetTimer = setTimeout(() => {
            copyBtn.textContent = "Copy";
            copyBtn.classList.remove("copied");
          }, 1200);
        } catch (err) {
          console.error("[PixaromaShowText] copy failed", err);
        }
      });
      wrap.appendChild(copyBtn);

      this._pixTextEl = ta;

      const widget = this.addDOMWidget("text", "customtext", wrap, {
        canvasOnly: true,  // hide from Parameters tab (Vue Compat #15)
        getValue: () => ta.value,
        setValue: (v) => {
          ta.value = v == null ? "" : String(v);
        },
        serialize: true,
        getMinHeight: () => MIN_H,
      });
      this._pixTextWidget = widget;

      if (!this.size || this.size[0] < MIN_W || this.size[1] < MIN_H) {
        this.size = [DEFAULT_W, DEFAULT_H];
      }
    };

    nodeType.prototype.onExecuted = function (output) {
      const text = (output?.text || []).join("\n");
      if (this._pixTextEl) this._pixTextEl.value = text;
      if (this._pixTextWidget) this._pixTextWidget.value = text;
    };

    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      origOnResize?.call(this, size);
      this.size[0] = Math.max(this.size[0], MIN_W);
      this.size[1] = Math.max(this.size[1], MIN_H);
    };
  },
});
