// Reference Images Pixaroma - the floating settings panel.
//
// Copied from js/save_video/settings.mjs (node-settings-accent.md: copy a
// panel, never write one): opens BESIDE the node and follows it (convention
// #29), outside-close on POINTERDOWN, the gear and the colour picker exempt,
// Escape closes, the drag handle ignores the close button.
//
// Every option here is saved IN THE NODE (node.properties.refImages), so a
// shared workflow sends the same prompt on every PC.

import { createAccentSection } from "../shared/node_settings.mjs";
import { followNode, getNodeScreenRect, makeDraggable, placeBeside } from "../shared/node_panel.mjs";
import { DEFAULT_CUSTOM, ROLES, defaultPhrase, readState } from "./core.mjs";
import { injectCSS } from "./css.mjs";
import { setOption } from "./actions.mjs";

let _panel = null;
let _panelNode = null;
let _stopFollow = null;
let _userMoved = false;
let _cpHandle = null;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop, .pix-rfi-gear")) return;
  closeSettingsPanel();
}

function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeSettingsPanel();
  }
}

export function closeSettingsPanel() {
  _stopFollow?.();
  _stopFollow = null;
  try { _cpHandle?.close?.(); } catch {}
  _cpHandle = null;
  try { _panel?.remove(); } catch {}
  _panel = null;
  _panelNode = null;
  _userMoved = false;   // reset on CLOSE, never on open
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeSettingsPanelFor(node) {
  if (_panelNode === node) closeSettingsPanel();
}

export const isPanelOpenFor = (node) => _panelNode === node && !!_panel;

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-rfi-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-rfi-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

function chips(node, wrap, key, options) {
  const row = el("div", "pix-rfi-bgrid");
  const sync = () => {
    const cur = readState(node)[key];
    for (const b of row.children) b.classList.toggle("on", b.dataset.key === cur);
  };
  for (const [k, label] of options) {
    const b = el("button", "pix-rfi-bchip", label);
    b.type = "button";
    b.dataset.key = k;
    b.onclick = () => { setOption(node, key, k); sync(); };
    row.appendChild(b);
  }
  sync();
  wrap.appendChild(row);
}

export function openSettingsPanel(node) {
  if (isPanelOpenFor(node)) {      // the gear toggles
    closeSettingsPanel();
    return null;
  }
  closeSettingsPanel();
  injectCSS();
  const panel = el("div", "pix-rfi-panel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-rfi-phead");
  head.appendChild(el("span", null, "Reference Images settings"));
  const x = el("button", "pix-rfi-px", "✕");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  x.onclick = closeSettingsPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, { onUserMove: () => { _userMoved = true; }, ignoreSelector: ".pix-rfi-px" });

  const body = el("div", "pix-rfi-pbody");

  chips(node, section(body, "The picture list",
    "The sentence that says what each picture is for, like: Use the character from <image1> and the outfit "
    + "from <image2>. It goes before or after your prompt, or is left out."),
  "list", [["before", "Before"], ["after", "After"], ["off", "Off"]]);

  chips(node, section(body, "Transparent parts",
    "A picture with a see-through background gets this colour behind it. Plain backgrounds mix in best."),
  "fill", [["white", "White"], ["grey", "Grey"], ["black", "Black"]]);

  chips(node, section(body, "Picture size",
    "Big pictures make the model slower. Pictures are only made smaller here, never bigger."),
  "size", [["keep", "As they are"], ["1mp", "Up to 1 MP"], ["2mp", "Up to 2 MP"]]);

  chips(node, section(body, "Round the size to",
    "Trims a few pixels off the edges so the width and height divide evenly, never a stretch. Auto uses 32 "
    + "for Qwen Image 2.1, whose text encode would otherwise stretch each picture a little."),
  "multiple", [["auto", "Auto"], ["off", "Off"], ["16", "16"], ["32", "32"], ["64", "64"]]);

  const cWrap = section(body, "Custom tag",
    "For the model choice Custom. {n} is the picture number from 1, {i} from 0.");
  const cIn = el("input", "pix-rfi-pin");
  cIn.type = "text";
  cIn.spellcheck = false;
  cIn.placeholder = DEFAULT_CUSTOM;
  cIn.value = readState(node).custom;
  cIn.setAttribute("aria-label", "Custom tag pattern");
  cIn.oninput = () => setOption(node, "custom", cIn.value, { quiet: true });
  cIn.onchange = () => setOption(node, "custom", cIn.value);
  cWrap.appendChild(cIn);

  const pWrap = section(body, "The words for each role",
    "How each role is said in the picture list. {name} is the name you gave the picture (or the role's own "
    + "words), {ref} is the model's tag. Leave a box empty for the default.");
  const inputs = [];
  for (const [k, label] of ROLES) {
    const row = el("div", "pix-rfi-prole");
    const lab = el("label", null, label);
    const inp = el("input", "pix-rfi-pin");
    inp.type = "text";
    inp.spellcheck = false;
    inp.placeholder = defaultPhrase(k);
    inp.value = readState(node).phrases[k] || "";
    inp.setAttribute("aria-label", `Words for ${label}`);
    const save = (quiet) => {
      const ph = { ...readState(node).phrases };
      if (inp.value.trim()) ph[k] = inp.value;
      else delete ph[k];
      setOption(node, "phrases", ph, { quiet });
    };
    inp.oninput = () => save(true);
    inp.onchange = () => save(false);
    row.append(lab, inp);
    pWrap.appendChild(row);
    inputs.push(inp);
  }
  const reset = el("button", "pix-rfi-reset", "Reset all to default");
  reset.type = "button";
  reset.onclick = () => {
    for (const i of inputs) i.value = "";
    setOption(node, "phrases", {});
  };
  pWrap.appendChild(reset);

  body.appendChild(createAccentSection(node, {
    onPickerOpen: (h) => { _cpHandle = h; },
  }));

  panel.appendChild(body);
  document.body.appendChild(panel);
  placeBeside(panel, getNodeScreenRect(node));
  _stopFollow = followNode(panel, node, {
    isCurrent: () => _panel === panel,
    isUserMoved: () => _userMoved,
  });
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  return panel;
}
