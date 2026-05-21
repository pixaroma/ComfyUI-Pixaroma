import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

// Text Pixaroma: multi-line text field with a STRING output. The native
// ComfyUI multiline widget is HIDDEN; we render our own DOM widget so the
// interior styling (font, padding, focus border) matches Prompt Pack
// Pixaroma exactly. Bottom row holds three action buttons (Copy all /
// Replace / Clear) styled identically to Prompt Pack's button trio.
//
// Value sync: the hidden native widget still owns the value for workflow
// serialisation (so saved workflows just work). The DOM textarea mirrors
// to it on every keystroke and on configure() restore.

// Default = minimum, so fresh-on-canvas drops are compact and the user
// grows the node only when they need more typing room. Matches the
// approach used by Show Text Pixaroma. Values verified by sizer overlay.
const DEFAULT_W = 290;
const DEFAULT_H = 158;
const MIN_W = 290;
const MIN_H = 158;
const WIDGET_MIN_H = 120;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pix-text-root {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      color: #e0e0e0;
      font: 12px sans-serif;
    }
    .pix-text-tawrap {
      position: relative;
      flex: 1 1 auto;
      min-height: 60px;
      display: flex;
    }
    .pix-text-ta {
      flex: 1 1 auto;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: #1d1d1d;
      color: #e0e0e0;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 6px 8px;
      font: 12px monospace;
      resize: none;
      outline: none;
    }
    .pix-text-ta:focus { border-color: ${BRAND}; }
    .pix-text-bottombar {
      display: flex;
      align-items: center;
      flex: 0 0 auto;
      gap: 4px;
      padding: 0 2px;
      /* Stop text selection bleeding from the textarea into the button
         labels when the user drag-selects to the edge of the field. */
      user-select: none;
    }
    .pix-text-actbtn {
      /* box-sizing border-box so min-width is total including padding */
      box-sizing: border-box;
      min-width: 86px;
      user-select: none;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      color: rgba(255, 255, 255, 0.85);
      cursor: pointer;
      font: 11px sans-serif;
      padding: 4px 12px;
      transition: background 0.1s, color 0.1s, border-color 0.1s;
    }
    .pix-text-actbtn:hover {
      background: ${BRAND};
      border-color: ${BRAND};
      color: #fff;
    }
    .pix-text-actbtn[disabled] {
      color: rgba(255, 255, 255, 0.3);
      cursor: default;
      background: rgba(255, 255, 255, 0.02);
      border-color: rgba(255, 255, 255, 0.08);
    }
    .pix-text-actbtn[disabled]:hover {
      background: rgba(255, 255, 255, 0.02);
      border-color: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.3);
    }
    /* Success flash - green overrides hover orange via higher specificity */
    .pix-text-actbtn.is-flashing,
    .pix-text-actbtn.is-flashing:hover {
      background: #3ec371;
      border-color: #3ec371;
      color: #fff;
    }
    /* Wired-input lock: when another node is wired into the text input,
       the workflow uses the wire value instead of whatever is typed here.
       Gray + italic + not-allowed cursor signals that typing is ignored. */
    .pix-text-ta.pix-text-locked {
      color: #888;
      font-style: italic;
      cursor: not-allowed;
      background: #161616;
    }
    .pix-text-lockhint {
      color: ${BRAND};
      font: 10px sans-serif;
      font-style: italic;
      padding: 0 2px;
      margin: 0;
      flex: 0 0 auto;
      user-select: none;
    }
  `;
  document.head.appendChild(style);
}

function toast(severity, msg) {
  const t = app?.extensionManager?.toast;
  if (t?.add) t.add({ severity, summary: "Text Pixaroma", detail: msg, life: 2000 });
  else console.warn("[Pixaroma.Text]", msg);
}

function flashBtnText(btn, label) {
  const orig = btn.textContent;
  btn.textContent = label;
  btn.classList.add("is-flashing");
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove("is-flashing");
  }, 700);
}

// Hide the native multi-line text widget added by ComfyUI from the
// `multiline: True` INPUT_TYPES. Standard hide recipe (see Load Image
// Pixaroma Pattern #1): set hidden, zero computeSize, hide any DOM
// element. Returns the widget so we can keep mirroring values into it
// for workflow serialisation.
function hideNativeTextWidget(node) {
  let textWidget = null;
  for (const w of (node.widgets || [])) {
    if (!w) continue;
    if (w.name === "text") textWidget = w;
    w.hidden = true;
    w.computeSize = () => [0, -4];
    if (!w.options) w.options = {};
    w.options.canvasOnly = true;
    if (w.element) w.element.style.display = "none";
    if (w.inputEl) w.inputEl.style.display = "none";
  }
  // Vue may DOM-render a widget AFTER nodeCreated, so re-hide on the next
  // animation frame as a belt-and-braces.
  requestAnimationFrame(() => {
    for (const w of (node.widgets || [])) {
      if (!w || w.name === "pix_text_ui") continue;
      if (w.element) w.element.style.display = "none";
      if (w.inputEl) w.inputEl.style.display = "none";
    }
  });
  return textWidget;
}

function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-text-root";

  const tawrap = document.createElement("div");
  tawrap.className = "pix-text-tawrap";

  const ta = document.createElement("textarea");
  ta.className = "pix-text-ta";
  ta.placeholder = "text";
  ta.title = "Type your text or prompt here. Press Ctrl+Enter to run the workflow.";
  ta.spellcheck = false;
  tawrap.appendChild(ta);

  const bottombar = document.createElement("div");
  bottombar.className = "pix-text-bottombar";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "pix-text-actbtn";
  copyBtn.textContent = "Copy all";
  copyBtn.title = "Copy the entire textarea content to the clipboard";

  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.className = "pix-text-actbtn";
  replaceBtn.textContent = "Replace";
  replaceBtn.title = "Replace the textarea with text from the clipboard (image / empty clipboard shows a toast and leaves the text alone)";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "pix-text-actbtn";
  clearBtn.textContent = "Clear";
  clearBtn.title = "Empty the textarea instantly (no confirm)";

  bottombar.append(copyBtn, replaceBtn, clearBtn);

  // Hint shown when the text input is wired (hidden by default).
  const lockHint = document.createElement("div");
  lockHint.className = "pix-text-lockhint";
  lockHint.textContent = "Wired from upstream; typing here is ignored";
  lockHint.style.display = "none";

  root.append(tawrap, lockHint, bottombar);
  root._pixText = { ta, copyBtn, replaceBtn, clearBtn, lockHint };
  return root;
}

function isTextInputWired(node) {
  const inputs = node.inputs;
  if (!Array.isArray(inputs)) return false;
  for (const inp of inputs) {
    if (inp && inp.name === "text" && inp.link != null) return true;
  }
  return false;
}

function refreshTextLock(node) {
  const root = node._pixTextRoot;
  if (!root || !root._pixText) return;
  const { ta, lockHint, copyBtn, replaceBtn, clearBtn } = root._pixText;
  const wired = isTextInputWired(node);
  if (wired) {
    ta.readOnly = true;
    ta.classList.add("pix-text-locked");
    lockHint.style.display = "block";
    // Disable destructive buttons; Copy all stays useful (the user might
    // still want to copy whatever they typed before wiring).
    replaceBtn.disabled = true;
    clearBtn.disabled = true;
  } else {
    ta.readOnly = false;
    ta.classList.remove("pix-text-locked");
    lockHint.style.display = "none";
    replaceBtn.disabled = false;
    updateClearEnabled(root);
  }
}

function syncToNative(node, root) {
  const els = root._pixText;
  if (!els || !node._pixTextNative) return;
  node._pixTextNative.value = els.ta.value;
}

function wireEvents(node, root) {
  const els = root._pixText;
  if (!els) return;

  // Typing → mirror to the hidden native widget so workflow submission
  // sees the new value. Also stop propagation so ComfyUI's keyboard
  // shortcuts (Q for queue, Delete, etc) don't fire while typing.
  els.ta.addEventListener("input", () => {
    syncToNative(node, root);
    updateClearEnabled(root);
  });
  els.ta.addEventListener("keydown", (e) => {
    // Let Ctrl/Cmd+Enter bubble up to ComfyUI's "run workflow" shortcut
    // (issue #41) - this node is used for prompts, so running straight
    // from the keyboard matters. Everything else is stopped so single-key
    // shortcuts (Q queue, Delete, etc) don't fire while typing.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return;
    e.stopPropagation();
  });
  els.ta.addEventListener("mousedown", (e) => { e.stopPropagation(); });

  els.copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const txt = els.ta.value || "";
    if (!txt) { toast("info", "Nothing to copy"); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard not available");
      await navigator.clipboard.writeText(txt);
      flashBtnText(els.copyBtn, "Copied");
    } catch (err) {
      console.warn("[Pixaroma.Text] copy failed", err);
      toast("warn", "Could not copy to clipboard");
    }
  });

  els.replaceBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      if (!navigator.clipboard?.readText) throw new Error("Clipboard read not available");
      const txt = await navigator.clipboard.readText();
      // Empty result covers "clipboard empty" AND "clipboard has only
      // an image/file" on Chrome; either way, bail with a toast instead
      // of wiping existing text.
      if (!txt) { toast("info", "Nothing to paste"); return; }
      els.ta.value = txt;
      syncToNative(node, root);
      updateClearEnabled(root);
      flashBtnText(els.replaceBtn, "Pasted");
    } catch (err) {
      console.warn("[Pixaroma.Text] paste failed", err);
      toast("warn", "Could not paste from clipboard");
    }
  });

  els.clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (els.clearBtn.disabled) return;
    els.ta.value = "";
    syncToNative(node, root);
    updateClearEnabled(root);
  });

  for (const b of [els.copyBtn, els.replaceBtn, els.clearBtn]) {
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    b.addEventListener("mousedown", (ev) => ev.stopPropagation());
  }
}

function updateClearEnabled(root) {
  const els = root._pixText;
  if (!els) return;
  els.clearBtn.disabled = !(els.ta.value && els.ta.value.length > 0);
}

function setupNode(node) {
  injectCSS();
  const nativeWidget = hideNativeTextWidget(node);
  node._pixTextNative = nativeWidget;

  const root = buildRoot();
  node._pixTextRoot = root;

  // Seed the DOM textarea from whatever value the native widget has.
  // Saved workflows: configure() ran before nodeCreated in some
  // ComfyUI builds and after in others, so we ALSO refresh in
  // onConfigure below.
  if (nativeWidget?.value) root._pixText.ta.value = nativeWidget.value;
  updateClearEnabled(root);

  node.addDOMWidget("pix_text_ui", "custom", root, {
    canvasOnly: true, // Vue Compat #15 - hide from Parameters tab
    getValue: () => null,
    setValue: () => {},
    getMinHeight: () => WIDGET_MIN_H,
    margin: 4,
    serialize: false,
  });

  wireEvents(node, root);

  // Apply default size with a MIN guard rather than unconditional set.
  // Vue Compat #8 says configure() runs AFTER nodeCreated, but some Vue
  // build paths have it the other way - in that case configure() has
  // already restored the saved size and an unconditional reset would
  // clobber it. The `< MIN` guard means: fresh LiteGraph defaults (which
  // are below our MIN) get bumped up to DEFAULT; saved-workflow sizes
  // that already meet MIN are left alone.
  if (node.size[0] < MIN_W) node.size[0] = DEFAULT_W;
  if (node.size[1] < MIN_H) node.size[1] = DEFAULT_H;
  // Initial lock-state check deferred until node.inputs is populated by
  // configure() (Vue Compat #8 - configure runs after nodeCreated).
  queueMicrotask(() => refreshTextLock(node));
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "Pixaroma.Text",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaText") return;

    // Refresh the DOM textarea from the native widget AFTER configure()
    // restores the saved value (handles both workflow load + duplicate).
    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure?.apply(this, arguments);
      queueMicrotask(() => {
        const root = this._pixTextRoot;
        const native = this._pixTextNative;
        if (root && native && root._pixText) {
          if (root._pixText.ta.value !== (native.value || "")) {
            root._pixText.ta.value = native.value || "";
          }
          updateClearEnabled(root);
        }
        refreshTextLock(this);
      });
      return r;
    };

    // When the text input is wired/unwired, gray the textarea + show
    // the "wired from upstream" hint so it's obvious the typed text
    // is overridden at runtime. Same pattern Text Overlay uses.
    const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = origOnConnectionsChange?.apply(this, arguments);
      queueMicrotask(() => refreshTextLock(this));
      return r;
    };

    // Clamp manual resize so the bottom button row never overflows past
    // the node frame. Mutate BOTH the parameter AND this.size defensively
    // (some LiteGraph forks treat the param as the new size).
    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size[0] < MIN_W) size[0] = MIN_W;
      if (size[1] < MIN_H) size[1] = MIN_H;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    // Self-heal min size on every paint (Preview Image Pattern #11).
    // Catches resize paths that bypass onResize - Vue Compat #13 notes
    // some DOM-widget resizes never fire onResize, and Align Pixaroma
    // (Align Pattern #6) writes node.size directly via cursor delta.
    // Without this safety net the buttons can spill past the node frame
    // after grow-then-shrink.
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixTextRoot = null;
      this._pixTextNative = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };

    // Block new wires onto Text Pixaroma entirely. Text Pixaroma is for
    // TYPING text directly; Show Text Pixaroma is the right node for
    // receiving text from another node. The wire-lock UX above stays
    // as a fallback so legacy workflows that already have a wire saved
    // into Text Pixaroma keep working (and visibly flag the wired
    // state) - we just don't let users create NEW wires.
    nodeType.prototype.onConnectInput = function () {
      toast("warn", "Text Pixaroma is for typing. Use Show Text Pixaroma to receive text from another node.");
      return false;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaText") return;
    setupNode(node);
  },
});
