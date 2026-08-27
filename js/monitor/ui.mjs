// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Monitor Pixaroma - the Nodes 2.0 face (a DOM widget) and all the CSS    ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// The classic renderer paints its face on the node canvas instead (paint.mjs);
// this file is only reached under Nodes 2.0. Both draw the same blocks from
// core.mjs, and every size below is a calc() off --pm-s so the two agree at any
// scale.
//
// The frame-hiding block is the Label / Run Timer stack, copied deliberately
// rather than reinvented: each of those rules fixed a specific strip of grey
// node showing around a title-less body, and the comments say which.

import { ACC } from "../shared/node_settings.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import { M, barRows, scalarItems, visibleButtons, barColor, deviceLabel, pickDevice, labelUnitWidth } from "./core.mjs";

let _cssDone = false;

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const px = (n) => `calc(${n}px * var(--pm-s,1))`;

export function injectCSS() {
  if (_cssDone || document.getElementById("pix-mon-css")) {
    _cssDone = true;
    return;
  }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-mon-css";
  s.textContent = [
    // ── the face ──────────────────────────────────────────────────────────
    ".pix-mon-root{width:100%;height:100%;box-sizing:border-box;user-select:none;-webkit-user-select:none;}",
    `.pix-mon-screen{width:100%;height:100%;box-sizing:border-box;background:#0c0c0e;border:1px solid #1d1d20;border-radius:${px(8)};padding:${px(M.padY)} ${px(M.padX)};display:flex;flex-direction:column;gap:${px(M.gap)};font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;color:#e0e0e0;overflow:hidden;}`,

    // the small card line at the top
    `.pix-mon-title{display:flex;align-items:center;gap:${px(5)};height:${px(M.titleH)};font-size:${px(M.titleFont)};letter-spacing:.06em;color:#6b6b72;text-transform:uppercase;white-space:nowrap;overflow:hidden;flex:none;}`,
    `.pix-mon-title .dot{width:${px(5)};height:${px(5)};border-radius:50%;background:#3ec371;flex:none;}`,
    ".pix-mon-title.is-run .dot{background:" + ACC + ";}",
    ".pix-mon-title.is-off .dot{background:#5a5a60;}",
    ".pix-mon-title .name{overflow:hidden;text-overflow:ellipsis;}",

    // one bar row
    // WHAT GIVES WAY WHEN THE ROW IS TOO NARROW, in order: the bar (flex-basis
    // 0, so it takes only what is spare), then the label (shrinkable), and the
    // NUMBER never - it is the reading, and a bar with no number beside it is
    // decoration. Same priority as the classic painter's, so the two faces
    // degrade the same way.
    `.pix-mon-row{display:flex;align-items:center;gap:${px(7)};height:${px(M.rowH)};font-size:${px(M.font)};flex:none;overflow:hidden;}`,
    // text-overflow so a long label ("COMFY R") trims with an ellipsis like the
    // canvas painter's fit() does, instead of a mid-glyph hard clip
    `.pix-mon-row .lb{width:calc(var(--pm-lw,${M.labelW}) * var(--pm-s,1) * 1px);flex:0 1 auto;min-width:0;color:#8a8a8a;letter-spacing:.03em;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}`,
    `.pix-mon-row .trk{flex:1 1 0;min-width:0;height:${px(M.barH)};border-radius:${px(M.barR)};background:rgba(255,255,255,.055);position:relative;overflow:hidden;}`,
    `.pix-mon-row .fl{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:${px(M.barR)};background:${ACC};transition:width .18s linear;}`,
    // the peak mark: a pale hold line, the audio-meter idea. It is the reason
    // this node exists rather than any other monitor - nobody is watching the
    // number at the exact second it spikes.
    `.pix-mon-row .pk{position:absolute;top:-1px;bottom:-1px;width:${px(2)};background:#ffd9cd;box-shadow:0 0 ${px(5)} ${ACC};display:none;}`,
    `.pix-mon-row .vl{width:${px(M.valueW)};flex:0 0 auto;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}`,
    ".pix-mon-row .vl small{color:#6b6b72;font-size:.86em;}",

    // the temp / power / peak line
    `.pix-mon-strip{display:flex;gap:${px(9)};height:${px(M.stripH)};align-items:center;font-size:${px(M.stripFont)};color:#8a8a8a;flex:none;overflow:hidden;white-space:nowrap;}`,
    ".pix-mon-strip b{color:#e0e0e0;font-weight:400;font-variant-numeric:tabular-nums;}",
    ".pix-mon-strip b.hot{color:#e8a33d;}",

    // the one-line strip layout
    `.pix-mon-strip1{display:flex;align-items:center;gap:${px(7)};font-size:${px(M.font)};color:#8a8a8a;flex:1;min-height:0;overflow:hidden;white-space:nowrap;}`,
    ".pix-mon-strip1 b{color:#e0e0e0;font-weight:400;font-variant-numeric:tabular-nums;}",
    ".pix-mon-strip1 .sep{color:#3a3a3a;}",
    `.pix-mon-strip1 .mini{width:${px(30)};height:${px(5)};border-radius:${px(2)};background:rgba(255,255,255,.06);position:relative;overflow:hidden;flex:none;}`,
    `.pix-mon-strip1 .mini i{position:absolute;left:0;top:0;bottom:0;width:0;background:${ACC};border-radius:${px(2)};}`,

    // buttons
    `.pix-mon-acts{display:flex;gap:${px(5)};flex-wrap:wrap;flex:none;}`,
    `.pix-mon-btn{flex:1 1 auto;min-width:0;font:inherit;font-size:${px(M.btnFont)};line-height:1;padding:${px(5)} ${px(7)};border-radius:${px(4)};text-align:center;cursor:pointer;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.13);color:rgba(255,255,255,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;}`,
    `.pix-mon-btn:hover{background:${ACC};border-color:${ACC};color:#fff;}`,
    ".pix-mon-btn.is-flashing,.pix-mon-btn.is-flashing:hover{background:#3ec371;border-color:#3ec371;color:#fff;}",
    // The gear: the BUNDLED SVG as a CSS mask, exactly like Dropdown and LoRA
    // Loader, never the ⚙ emoji (house rule #28) - an emoji is drawn by the
    // operating system, so it is a different shape per platform and sits on its
    // own baseline. Square and non-growing, so the two text buttons take the rest
    // of the row.
    `.pix-mon-btn.is-icon{flex:0 0 auto;width:${px(M.btnH)};padding:0;display:flex;align-items:center;justify-content:center;}`,
    `.pix-mon-btn.is-icon::before{content:"";display:block;width:${px(14)};height:${px(14)};background:rgba(255,255,255,.72);`
      + `-webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;`
      + `mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;}`,
    ".pix-mon-btn.is-icon:hover::before{background:#fff;}",
    ".pix-mon-btn:disabled{opacity:.45;cursor:default;}",
    ".pix-mon-btn:disabled:hover{background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.13);color:rgba(255,255,255,.72);}",

    // an empty face still says something rather than showing a black hole
    `.pix-mon-empty{font-size:${px(M.font)};color:#6b6b72;text-align:center;padding:${px(4)} 0;}`,

    // ── NODES 2.0 title-less float (the Label / Run Timer stack) ───────────
    // .lg-node exists only in Nodes 2.0, so every rule below is a no-op in the
    // classic renderer. The HEADER and its reserved height are removed by
    // title_mode NO_TITLE on the node TYPE (set in index.js), not from here.
    ".lg-node:has(.pix-mon-root){background:transparent!important;border:none!important;box-shadow:none!important;}",
    // the min-height floor is node.size[1] + 30 regardless of title_mode, which
    // reserved a grey gap under the face
    ".lg-node:has(.pix-mon-root),.lg-node:has(.pix-mon-root) > div,.lg-node:has(.pix-mon-root) > div > div{min-width:0!important;min-height:0!important;}",
    ".lg-node:has(.pix-mon-root) .lg-node-header{display:none!important;}",
    // without this the widget hugs its content and the node body shows as grey
    // to the RIGHT of the face (a different grey defect from the gap above)
    ".lg-node:has(.pix-mon-root) .lg-node-widgets{grid-template-columns:minmax(0,1fr)!important;padding:0!important;row-gap:0!important;gap:0!important;}",
    ".lg-node:has(.pix-mon-root) .lg-node-widget{gap:0!important;width:100%!important;padding:0!important;}",
    // the 12px output-dot gutter, which on a node whose body IS the face is 12px
    // of bare node sticking out on the right
    ".lg-node:has(.pix-mon-root) .lg-node-widget > *:first-child{display:none!important;}",
    ".lg-node:has(.pix-mon-root) .lg-node-content{padding:0!important;}",
    ".lg-node:has(.pix-mon-root) [class*=\"component-node-background\"]{padding:0!important;gap:0!important;background:transparent!important;}",
    // ⚠️ The footer row is matched by its OWN class, never with a nested
    // descendant ":has(.bg-node-component-surface)". That form has to be
    // re-evaluated against every div in the document on every class change, and
    // ComfyUI changes node classes constantly while you pan/zoom/hover/select.
    // MEASURED in Nodes 2.0 on a 56-node graph over 40 class-churn frames:
    // 0.33 ms/frame with our CSS off, 7.56 as shipped, 1.01 after this change -
    // this one selector was ~90% of the cost. See label/render.mjs for the full
    // note; Label and Run Timer carry the identical rule and the identical fix.
    ".lg-node:has(.pix-mon-root) [class*=\"component-node-background\"] > div.text-muted-foreground,.lg-node:has(.pix-mon-root) .bg-node-component-surface{display:none!important;}",
    ".lg-node:has(.pix-mon-root) > div.absolute.border:not([data-testid]){display:none!important;}",
    ".lg-node:has(.pix-mon-root) [data-testid=\"node-state-outline-overlay\"],.lg-node:has(.pix-mon-root) > div.absolute.outline-none{inset:-2px!important;}",
    // Click-through so dragging and right-clicking reach the canvas and the node
    // behaves like a node ... EXCEPT the buttons, which are the one thing on this
    // face you are meant to press. The button rule has one more class than the
    // blanket rule, so it wins even though both are !important.
    ".lg-node:has(.pix-mon-root) .lg-node-widgets,.lg-node:has(.pix-mon-root) .lg-node-widgets *{pointer-events:none!important;}",
    ".lg-node:has(.pix-mon-root) .pix-mon-btn{pointer-events:auto!important;}",

    // ── the settings panel ────────────────────────────────────────────────
    // Plain px, NOT scaled: a settings panel is a workbench beside the canvas,
    // not part of the node, so it deliberately does not follow the canvas zoom
    // (node UI convention #27). Palette matches the Pixaroma colour picker it
    // hosts (#1a1a1a / #444).
    ".pix-mon-panel{position:fixed;z-index:10010;width:310px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;}",
    ".pix-mon-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-mon-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-mon-px:hover{color:#fff;}",
    ".pix-mon-pbody{max-height:74vh;overflow-y:auto;padding:4px 0;}",
    ".pix-mon-sect{padding:10px 12px;border-bottom:1px solid #2c2c2c;}",
    ".pix-mon-sect:last-child{border-bottom:0;}",
    ".pix-mon-plab{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:" + ACC + ";font-weight:700;margin-bottom:7px;}",
    ".pix-mon-psub{font-size:11px;line-height:1.4;color:#8a8a8a;margin:-3px 0 8px;}",
    ".pix-mon-bgrid{display:flex;flex-wrap:wrap;gap:4px;}",
    ".pix-mon-bchip{font:inherit;font-size:10.5px;padding:4px 9px;border-radius:4px;border:1px solid #444;background:#1d1d1d;color:#aaa;cursor:pointer;}",
    ".pix-mon-bchip:hover{border-color:" + ACC + ";color:#ddd;}",
    ".pix-mon-bchip.on{background:" + ACC + ";border-color:" + ACC + ";color:#fff;}",
    ".pix-mon-bchip:disabled{opacity:.4;cursor:default;}",
    ".pix-mon-bchip:disabled:hover{border-color:#444;color:#aaa;}",
    ".pix-mon-prow{display:flex;align-items:center;gap:10px;margin-top:8px;}",
    ".pix-mon-prow:first-child{margin-top:0;}",
    ".pix-mon-ptxt{flex:1;min-width:0;}",
    ".pix-mon-ptxt .t{font-size:12.5px;color:#cfcfcf;}",
    ".pix-mon-ptxt .s{font-size:11px;line-height:1.35;color:#8a8a8a;margin-top:2px;}",
    ".pix-mon-sw{width:32px;height:17px;border-radius:9px;background:#3a3a3a;position:relative;cursor:pointer;flex:none;transition:background .15s;}",
    ".pix-mon-sw i{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#bbb;transition:left .15s,background .15s;}",
    ".pix-mon-sw.on{background:" + ACC + ";}",
    ".pix-mon-sw.on i{left:17px;background:#fff;}",
    ".pix-mon-qsl{-webkit-appearance:none;appearance:none;flex:1;min-width:0;height:4px;border-radius:2px;outline:none;cursor:pointer;background:linear-gradient(to right," + ACC + " var(--fill,50%),#3a3a3a var(--fill,50%));}",
    ".pix-mon-qsl::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:" + ACC + ";border:2px solid #1a1a1a;cursor:pointer;}",
    ".pix-mon-qsl::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:" + ACC + ";border:2px solid #1a1a1a;cursor:pointer;}",
    ".pix-mon-qsl::-moz-range-track{height:4px;border-radius:2px;background:transparent;}",
    ".pix-mon-qval{font-size:12px;color:#bbb;width:62px;text-align:right;flex:none;font-variant-numeric:tabular-nums;}",
    // The SHARED accent section (createAccentSection) has no padding of its own:
    // it expects the panel BODY to pad it, the way Save Video's 12px body does.
    // This panel pads per-section instead, so without this rule the colour
    // block sat flush against the panel edges (user-reported with a
    // screenshot). Scoped to our panel so no other consumer moves.
    ".pix-mon-panel .pix-nset-sec{padding:10px 12px 12px;}",

  ].join("\n");
  (document.head || document.documentElement).appendChild(s);
}

// ── building and updating the face ──────────────────────────────────────────
// The DOM is rebuilt only when the SHAPE changes (which rows are on screen);
// otherwise a sample just writes widths and text. That keeps the hover state and
// the CSS width transition alive between samples instead of restarting them.

function shapeSig(st, rows, scal, btns, hasTitle) {
  return [
    st.layout,
    hasTitle ? "t" : "",
    rows.map((r) => r.key).join(","),
    scal.map((s) => s.key).join(","),
    btns.map((b) => b.key).join(","),
  ].join("|");
}

export function renderFace(node, st, sample, peak, onButton) {
  const root = node._pmRoot;
  if (!root) return;
  const screen = node._pmScreen;
  const rows = st.layout === "strip" ? [] : barRows(node, st, sample);
  const scal = scalarItems(st, sample, peak);
  const btns = visibleButtons(st);
  const dev = pickDevice(st, sample);
  const hasTitle = st.layout !== "strip" && !!st.showTitle;
  const sig = shapeSig(st, rows, scal, btns, hasTitle);

  if (node._pmSig !== sig) {
    node._pmSig = sig;
    node._pmEls = buildFace(screen, st, rows, scal, btns, hasTitle, onButton);
    // the label column fits the longest enabled label (a DOM style write only,
    // so safe on any path; shape changes are the only time it can change)
    root.style.setProperty("--pm-lw", String(labelUnitWidth(rows)));
  }
  writeFace(node, st, sample, peak, rows, scal, dev);
}

function buildFace(screen, st, rows, scal, btns, hasTitle, onButton) {
  screen.textContent = "";
  const els = { rows: {}, scal: {}, strip1: null, title: null, dot: null, name: null };

  if (hasTitle) {
    const t = el("div", "pix-mon-title");
    els.dot = el("span", "dot");
    els.name = el("span", "name");
    t.appendChild(els.dot);
    t.appendChild(els.name);
    els.title = t;
    screen.appendChild(t);
  }

  if (st.layout === "strip") {
    els.strip1 = el("div", "pix-mon-strip1");
    screen.appendChild(els.strip1);
  } else {
    for (const r of rows) {
      const row = el("div", "pix-mon-row");
      row.title = r.hint || "";
      const lb = el("span", "lb", r.label);
      const trk = el("span", "trk");
      const fl = el("i", "fl");
      const pk = el("i", "pk");
      trk.appendChild(fl);
      trk.appendChild(pk);
      const vl = el("span", "vl");
      const main = el("b");
      const tail = el("small");
      vl.appendChild(main);
      vl.appendChild(tail);
      row.appendChild(lb);
      row.appendChild(trk);
      row.appendChild(vl);
      screen.appendChild(row);
      els.rows[r.key] = { row, fl, pk, main, tail };
    }
    if (!rows.length) {
      screen.appendChild(el("div", "pix-mon-empty", "Nothing to show yet"));
    }
    if (scal.length) {
      const strip = el("div", "pix-mon-strip");
      for (const s of scal) {
        const seg = el("span");
        seg.title = s.hint || "";
        seg.appendChild(document.createTextNode(s.label + " "));
        const b = el("b");
        seg.appendChild(b);
        strip.appendChild(seg);
        els.scal[s.key] = b;
      }
      screen.appendChild(strip);
    }
  }

  if (btns.length) {
    const acts = el("div", "pix-mon-acts");
    for (const b of btns) {
      // an icon button carries NO text: the glyph comes from the CSS mask, and a
      // label under it would just be the same thing said twice
      const btn = el("button", "pix-mon-btn" + (b.icon ? " is-icon" : ""), b.icon ? "" : b.label);
      btn.type = "button";
      btn.title = b.hint || b.label || "";
      if (b.icon) btn.setAttribute("aria-label", b.label);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onButton?.(b.key, btn);
      });
      acts.appendChild(btn);
    }
    screen.appendChild(acts);
  }
  return els;
}

function writeFace(node, st, sample, peak, rows, scal, dev) {
  const els = node._pmEls;
  if (!els) return;
  const acc = getComputedStyle(node._pmRoot).getPropertyValue("--pix-acc").trim() || "#f66744";

  if (els.title) {
    els.name.textContent = deviceLabel(dev) || (sample ? "System" : "Connecting");
    els.title.classList.toggle("is-run", !!node._pmRunning);
    els.title.classList.toggle("is-off", !sample);
  }

  if (st.layout === "strip") {
    writeStrip1(els.strip1, st, sample, peak, node, acc);
    return;
  }

  for (const r of rows) {
    const e = els.rows[r.key];
    if (!e) continue;
    e.fl.style.width = (r.pct == null ? 0 : r.pct) + "%";
    e.fl.style.background = barColor(r.pct, acc, st.warn);
    e.main.textContent = r.main ?? "";
    e.tail.textContent = r.tail ?? "";
    const showPeak = r.key === "vram" && st.show.peak && peak && peak.pct > 0 && r.pct != null;
    e.pk.style.display = showPeak ? "block" : "none";
    if (showPeak) e.pk.style.left = Math.min(99.4, peak.pct) + "%";
  }
  for (const s of scal) {
    const b = els.scal[s.key];
    if (!b) continue;
    b.textContent = s.text;
    b.classList.toggle("hot", !!s.hot);
  }
}

function writeStrip1(box, st, sample, peak, node, acc) {
  if (!box) return;
  const rows = barRows(node, st, sample);
  const scal = scalarItems(st, sample, peak);
  box.textContent = "";
  const parts = [];
  for (const r of rows) {
    const seg = el("span");
    seg.title = r.hint || "";
    seg.appendChild(document.createTextNode(r.label + " "));
    if (r.pct != null) {
      const mini = el("span", "mini");
      const i = el("i");
      i.style.width = r.pct + "%";
      i.style.background = barColor(r.pct, acc, st.warn);
      mini.appendChild(i);
      seg.appendChild(mini);
      seg.appendChild(document.createTextNode(" "));
    }
    const b = el("b", null, (r.main ?? "") + (r.key === "gpu" || r.key === "cpu" ? "%" : ""));
    seg.appendChild(b);
    parts.push(seg);
  }
  for (const s of scal) {
    const seg = el("span");
    seg.title = s.hint || "";
    seg.appendChild(el("b", null, s.text));
    parts.push(seg);
  }
  if (!parts.length) {
    box.appendChild(el("span", null, sample ? "Nothing to show" : "Connecting"));
    return;
  }
  parts.forEach((p, i) => {
    if (i) box.appendChild(el("span", "sep", "·"));
    box.appendChild(p);
  });
}

/** Green flash + a temporary label, the pack's standard action feedback. */
export function flashButton(btn, label) {
  if (!btn) return;
  if (btn._pmOrig == null) {
    // Cache ONCE: capturing per call means a second click inside the window
    // captures "Done" as the original and the button keeps it forever. The pack
    // has fixed that same bug three times (node-settings-accent.md).
    btn._pmOrig = btn.textContent;
    btn.style.minWidth = Math.ceil(btn.getBoundingClientRect().width) + "px";
  }
  clearTimeout(btn._pmFlashT);
  btn.classList.add("is-flashing");
  if (label) btn.textContent = label;
  btn._pmFlashT = setTimeout(() => {
    btn.classList.remove("is-flashing");
    btn.textContent = btn._pmOrig;
  }, 900);
}
