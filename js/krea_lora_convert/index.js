// Krea LoRA Converter Pixaroma - convert a fal.ai Krea 2 LoRA into a
// ComfyUI-compatible file. The node keeps three native widgets (the LoRA
// picker, an editable output name, and an Overwrite toggle) and adds a DOM
// widget with a Convert button + a live detection readout.
//
// Flow:
//   pick a LoRA  -> GET  /pixaroma/api/krea_lora/inspect  -> readout + autofill name
//   Convert      -> POST /pixaroma/api/krea_lora/convert   -> result + refresh combos
//   Run          -> node's ui payload (pixaroma_krea_convert) -> same readout
//
// Built with the Nodes 2.0 recipe (unique DOM-widget type + applyAdaptiveCanvasOnly)
// so it renders in BOTH renderers.

import { app } from "/scripts/app.js";
import {
  BRAND,
  applyAdaptiveCanvasOnly,
  isVueNodes,
  installCanvasZoomPassthrough,
  registerNodeHelp,
} from "../shared/index.mjs";

const NODE = "KreaLoraConvertPixaroma";
const MIN_W = 300;
const DEFAULT_W = 340;
// Fixed DOM-widget height: button + gap + the fixed-size readout box + padding.
// A constant means the node never needs re-measuring or re-fitting (so it can't
// overflow or clip), and it is byte-identical every load (dirty-on-load safe).
const WIDGET_H = 140;  // 8 pad + 30 button + 8 gap + 80 readout + 8 pad, plus a little headroom

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pix-klc-wrap {
      width: 100%; box-sizing: border-box;
      display: flex; flex-direction: column; gap: 8px;
      padding: 8px; margin: 0;
      font: 12px 'Segoe UI', -apple-system, sans-serif;
    }
    .pix-klc-btn {
      box-sizing: border-box; width: 100%; min-height: 30px;
      border-radius: 6px; cursor: pointer; user-select: none;
      font: 600 13px 'Segoe UI', -apple-system, sans-serif;
      color: #fff; background: ${BRAND}; border: 1px solid ${BRAND};
      transition: filter 0.12s, opacity 0.12s;
    }
    .pix-klc-btn:hover { filter: brightness(1.08); }
    .pix-klc-btn:disabled { opacity: 0.55; cursor: default; filter: none; }
    .pix-klc-status {
      height: 80px; box-sizing: border-box; overflow-y: auto;
      padding: 7px 9px; border-radius: 6px; line-height: 1.4;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10);
      color: rgba(255,255,255,0.72); word-break: break-word; white-space: pre-wrap;
    }
    .pix-klc-status.is-ok {
      background: rgba(62,195,113,0.14); border-color: #3ec371; color: #d6f5e2;
    }
    .pix-klc-status.is-warn {
      background: rgba(255,179,71,0.14); border-color: #ffb347; color: #ffe6c2;
    }
    .pix-klc-status.is-err {
      background: rgba(246,103,68,0.15); border-color: ${BRAND}; color: #ffd9cc;
    }
  `;
  document.head.appendChild(style);
}

function setStatus(node, state, text) {
  const el = node._klcStatusEl;
  if (!el) return;
  el.textContent = text;
  el.classList.remove("is-ok", "is-warn", "is-err");
  if (state === "ok") el.classList.add("is-ok");
  else if (state === "warn") el.classList.add("is-warn");
  else if (state === "err") el.classList.add("is-err");
  el.scrollTop = 0;  // show the start of a long (scrollable) message
}

function setConvertEnabled(node, on) {
  node._klcCanConvert = !!on;
  if (node._klcBtn) node._klcBtn.disabled = !on;
}

function effectiveOutputName(node, suggested) {
  let v = (node._klcOutputWidget?.value || "").trim();
  if (!v) return suggested || "";
  if (!/\.safetensors$/i.test(v)) v += ".safetensors";
  return v;
}

// Render the readout from a cached inspect result (called on pick AND when the
// output-name field changes, so the "Saves as" line stays accurate).
function renderInspect(node, info) {
  const s = node._klcStatusEl;
  if (!s) return;
  if (!info || info.ok === false) {
    setStatus(node,"err", info?.message || "Could not read the file.");
    setConvertEnabled(node, false);
    return;
  }
  if (info.verdict === "already_loadable") {
    setStatus(node,"neutral", "Already ComfyUI-compatible (not the fal format). Nothing to convert - it should load in ComfyUI directly.");
    setConvertEnabled(node, false);
    return;
  }
  if (info.verdict !== "convert") {
    setStatus(node,"neutral", "This does not look like a fal Krea 2 LoRA.");
    setConvertEnabled(node, false);
    return;
  }
  const mappable = info.mappable_count || 0;
  const total = info.total_tensors || 0;
  const unmap = info.unmappable_count || 0;
  const rank = info.rank ? `, rank ${info.rank}` : "";
  const out = effectiveOutputName(node, info.suggested_output);
  if (unmap > 0) {
    setStatus(node,"warn",
      `⚠ Krea 2 LoRA: ${mappable} of ${total} layers recognized (${unmap} unknown will be skipped)${rank}.\nSaves as: ${out}`);
  } else {
    setStatus(node,"ok", `✓ fal Krea 2 LoRA: ${mappable} layers${rank}.\nSaves as: ${out}`);
  }
  setConvertEnabled(node, true);
}

// Fill the output-name field with the suggested name, unless the user typed
// their own (we only replace an empty field or a value we set ourselves).
function maybeAutofillOutput(node, info) {
  const w = node._klcOutputWidget;
  if (!w || !info?.suggested_output) return;
  const cur = (w.value || "").trim();
  if (cur === "" || cur === node._klcLastSuggested) {
    w.value = info.suggested_output;
    node.setDirtyCanvas?.(true, true);
  }
  node._klcLastSuggested = info.suggested_output;
}

async function doInspect(node) {
  const lora = node._klcLoraWidget?.value;
  if (!lora) return;
  try {
    const r = await fetch(`/pixaroma/api/krea_lora/inspect?lora_name=${encodeURIComponent(lora)}`);
    const info = await r.json();
    node._klcLastInfo = info;
    maybeAutofillOutput(node, info);
    renderInspect(node, info);
  } catch (e) {
    console.warn("[Krea LoRA Converter] inspect failed:", e);
    setStatus(node,"err", "Could not reach the server.");
  }
}

function renderResult(node, res) {
  const s = node._klcStatusEl;
  if (!res || res.ok === false) {
    setStatus(node,"err", res?.message || "Conversion failed.");
    return;
  }
  const skipped = res.skipped_count || 0;
  if (skipped > 0) {
    setStatus(node,"warn",
      `⚠ Saved ${res.output_name}.\n${res.converted} of ${res.total} layers converted; ${skipped} were not recognized and were skipped.`);
  } else {
    setStatus(node,"ok", `✓ Saved ${res.output_name}.\n${res.converted} of ${res.total} layers converted.`);
  }
}

async function doConvert(node) {
  const lora = node._klcLoraWidget?.value;
  const out = node._klcOutputWidget?.value || "";
  const overwrite = !!node._klcOverwriteWidget?.value;
  const btn = node._klcBtn;
  if (!btn || btn.disabled) return;
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Converting…";
  try {
    const r = await fetch("/pixaroma/api/krea_lora/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lora_name: lora, output_name: out, overwrite }),
    });
    const res = await r.json();
    renderResult(node, res);
    if (res.ok) {
      // Make the new file show up in every LoRA dropdown (and this node's picker).
      try { await app.refreshComboInNodes?.(); } catch (e) { /* non-fatal */ }
    }
  } catch (e) {
    console.warn("[Krea LoRA Converter] convert failed:", e);
    setStatus(node,"err", "Convert failed: could not reach the server.");
  } finally {
    btn.textContent = prev;
    btn.disabled = !node._klcCanConvert;  // stay grey if the file isn't convertible
  }
}

app.registerExtension({
  name: "Pixaroma.KreaLoraConvert",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origCreated?.apply(this, arguments);
      injectCSS();
      const node = this;

      node._klcLoraWidget = node.widgets?.find((w) => w.name === "lora_name");
      node._klcOutputWidget = node.widgets?.find((w) => w.name === "output_name");
      node._klcOverwriteWidget = node.widgets?.find((w) => w.name === "overwrite");

      const wrap = document.createElement("div");
      wrap.className = "pix-klc-wrap";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pix-klc-btn";
      btn.textContent = "Convert";
      btn.title = "Convert the selected fal Krea 2 LoRA and save a ComfyUI-compatible copy in your loras folder.";
      btn.disabled = true;  // enabled once detection confirms a convertible fal LoRA
      btn.addEventListener("click", (e) => { e.stopPropagation(); doConvert(node); });
      const status = document.createElement("div");
      status.className = "pix-klc-status";
      status.textContent = "Pick a LoRA to check it.";
      wrap.append(btn, status);
      node._klcBtn = btn;
      node._klcStatusEl = status;

      // Re-inspect when the user picks a different LoRA.
      if (node._klcLoraWidget) {
        const orig = node._klcLoraWidget.callback;
        node._klcLoraWidget.callback = function (...a) {
          const r = orig?.apply(this, a);
          doInspect(node);
          return r;
        };
      }
      // Keep the "Saves as" line accurate when the output name is edited.
      if (node._klcOutputWidget) {
        const orig = node._klcOutputWidget.callback;
        node._klcOutputWidget.callback = function (...a) {
          const r = orig?.apply(this, a);
          if (node._klcLastInfo) renderInspect(node, node._klcLastInfo);
          return r;
        };
      }

      installCanvasZoomPassthrough(wrap);
      const widget = node.addDOMWidget("pixaroma_krea_convert", "pixaroma_krea_convert", wrap, {
        getValue: () => null,
        setValue: () => {},
        getMinHeight: () => WIDGET_H,  // fixed - the readout box scrolls if a message is long
        serialize: false,
      });
      applyAdaptiveCanvasOnly(widget);

      if (!node.size || node.size[0] < MIN_W) node.size[0] = DEFAULT_W;

      // configure() (saved value restore) runs AFTER onNodeCreated, so defer the
      // first inspect a tick so the picker holds the restored file (Vue Compat #8).
      queueMicrotask(() => doInspect(node));
    };

    // Run path: the node's ui payload feeds the same readout.
    const origExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      origExecuted?.apply(this, arguments);
      const out = output?.pixaroma_krea_convert;
      if (Array.isArray(out) && out.length) renderResult(this, out[0]);
    };

    // Re-inspect when a saved workflow restores this node.
    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      origConfigure?.apply(this, arguments);
      queueMicrotask(() => doInspect(this));
    };

    // Min-width self-heal (legacy only; Nodes 2.0 sizes via the layout store).
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      origDraw?.call(this, ctx);
      if (this.flags?.collapsed || isVueNodes()) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
    };
  },
});

registerNodeHelp(NODE, {
  title: "Krea LoRA Converter",
  tagline: "Make a fal.ai Krea 2 LoRA work in ComfyUI.",
  sections: [
    {
      heading: "What it does",
      body:
        "LoRAs you train on fal.ai for the Krea 2 model use layer names ComfyUI does not recognize, so they will not load. This node renames those layers to the names ComfyUI expects and saves a new copy in your loras folder.\n\n" +
        "Nothing about the training changes. The weights are copied across exactly, so the result is identical, just loadable. The new file is a normal ComfyUI LoRA: load it with any LoRA loader, in any workflow, alongside the Krea 2 model.",
    },
    {
      heading: "How to use",
      bullets: [
        "Pick your fal Krea 2 LoRA from the dropdown.",
        "Read the line below the button. It confirms it is a Krea 2 LoRA and shows the name it will save.",
        "Click Convert. The new file appears in your loras folder and in every LoRA dropdown.",
        "Type a different Output name first if you like, or turn on Overwrite to replace an existing file.",
      ],
    },
    {
      heading: "Good to know",
      bullets: [
        "It only reads your file and writes a new one. It never changes or deletes the original.",
        "It never downloads anything.",
        "If a layer is not recognized it tells you, instead of quietly dropping it.",
        "You can also just press Run to convert, but the Convert button is quicker.",
      ],
    },
  ],
  footer: "Independent tool. Not affiliated with or endorsed by Krea or fal.ai.",
});
