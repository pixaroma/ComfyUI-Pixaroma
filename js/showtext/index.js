import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

const MIN_W = 200;
const MIN_H = 120;
const DEFAULT_W = 280;
const DEFAULT_H = 200;
const PLACEHOLDER = "text...";

app.registerExtension({
  name: "Pixaroma.ShowText",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaShowText") return;

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origOnNodeCreated?.apply(this, arguments);

      const wrap = document.createElement("div");
      wrap.style.cssText = `
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
