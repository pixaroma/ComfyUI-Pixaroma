/**
 * Resolution Pixaroma's "Normal | Big" switch (2026-11-11, resolution.md #8): which
 * list the ratio chips show. Normal = the classic sizes (up to about 4 MP), Big =
 * about 4 to 17 MP on the 32 px grid, topped by MiniMax H3 Image's own 16 MP sizes.
 *
 * It sits on the level of the `width` output dot (output 0), in the empty space
 * LEFT of the labels, one row above the batch stepper, so the locked node size does
 * not change and no widget is added. The choice lives in the node's own hidden
 * state (`big: true`, absent = Normal), so old workflows and fresh nodes are
 * unchanged.
 *
 * Placement is the batch stepper's (js/shared/latent_batch.mjs, longest-side.md #1):
 * - CLASSIC: the band lives in the widget root and is lifted onto the slot row with
 *   `placeSlotBand`.
 * - NODES 2.0: Vue clips anything above the widget top, so the band is PARKED in
 *   the output-slot block and aligned to the real slot element.
 * A light 350 ms check re-parks / re-mounts it (Vue replaces the node element, a
 * renderer flip moves the root) and keeps the lit half in step after Ctrl+Z. Every
 * write here is the band's own DOM; only a click writes the state (through opts.pick).
 */
import { isVueNodes } from "../shared/nodes2.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { placeSlotBand, BAND_H } from "../shared/slot_band.mjs";
import { accentOf } from "../shared/node_settings.mjs";

let _css = false;
function injectCSS() {
  if (_css) return;
  _css = true;
  const s = document.createElement("style");
  s.id = "pix-res-scale-css";
  s.textContent = `
.pix-res-scale { position:absolute; height:${BAND_H}px; display:flex; align-items:center;
  pointer-events:none; z-index:2; font-size:11px; white-space:nowrap; }
.pix-res-scale > * { pointer-events:auto; }
/* One bordered group (pixaroma-ui: idle #1d1d1d / #444 / #aaa) holding two borderless cells:
   hover = a white tint, the chosen one = accent fill + white text. 20 px high like the batch
   buttons below it; each cell is wider than 24 px (WCAG 2.5.8). */
.pix-res-scale-grp { display:flex; height:20px; box-sizing:border-box; border:1px solid #444; border-radius:4px;
  background:#1d1d1d; overflow:hidden; }
.pix-res-scale-btn { flex:none; height:100%; box-sizing:border-box; margin:0; padding:0 8px; border:0; border-radius:0;
  background:transparent; color:#aaa; font-family:inherit; font-size:11px; font-weight:600; line-height:1;
  display:flex; align-items:center; justify-content:center; cursor:pointer; user-select:none; min-width:28px; }
.pix-res-scale-btn + .pix-res-scale-btn { border-left:1px solid #444; }
.pix-res-scale-btn:hover { background:rgba(255,255,255,0.08); color:#ddd; }
.pix-res-scale-btn.active, .pix-res-scale-btn.active:hover { background:var(--pix-acc,#f66744); color:#fff; }
.pix-res-scale-btn:focus-visible { outline:2px solid var(--pix-acc,#f66744); outline-offset:-2px; }
.pix-res-scale.parked { left:8px; }
`;
  document.head.appendChild(s);
}

function vueSlotBlock(el) {
  return el?.querySelector(".lg-slot--output")?.parentElement?.parentElement || null;
}

/**
 * Put the switch on `node`.
 *   opts.outputIndex  which output dot it sits beside (0 = width)
 *   opts.getRoot()    the node's widget root (Classic home of the band)
 *   opts.read()       true when the Big list is chosen
 *   opts.pick(big)    choose a list: writes the state, re-renders, returns true when anything changed
 * Returns { mount, refresh, uninstall }. Call mount() after anything that empties the root.
 */
export function installScaleSwitch(node, opts) {
  injectCSS();
  const band = document.createElement("div");
  band.className = "pix-res-scale";
  const grp = document.createElement("div");
  grp.className = "pix-res-scale-grp";
  grp.setAttribute("role", "group");
  grp.setAttribute("aria-label", "Size list");
  const mk = (label, big, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pix-res-scale-btn";
    b.dataset.big = big ? "1" : "0";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", label + " sizes");
    return b;
  };
  const normal = mk("Normal", false, "The usual sizes for each ratio, up to about 4 MP (SDXL, Flux, video and social sizes)");
  const big = mk("Big", true, "Big sizes for each ratio, from about 4 to 17 MP (2K, 4K and MiniMax H3 Image's 16 MP sizes)");
  grp.append(normal, big);
  band.append(grp);

  const show = () => {
    // The node's own colour, set on the band itself: in Nodes 2.0 it is parked OUTSIDE
    // the root and would not inherit it (longest-side.md #28).
    const acc = accentOf(node);
    if (band.style.getPropertyValue("--pix-acc") !== acc) band.style.setProperty("--pix-acc", acc);
    const isBig = !!opts.read();
    normal.classList.toggle("active", !isBig);
    big.classList.toggle("active", isBig);
    normal.setAttribute("aria-pressed", String(!isBig));
    big.setAttribute("aria-pressed", String(isBig));
  };

  // The buttons must not start a node drag or a canvas pan.
  for (const el of [normal, big]) {
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      // In Classic the band lives in the root, which pick() re-renders (innerHTML wipe): a
      // keyboard user's focus fell to the page. mount() puts the band back; put the focus back too.
      const hadFocus = document.activeElement === el;
      if (opts.pick(el.dataset.big === "1")) notifyGraphChanged();
      show();
      if (hadFocus && document.activeElement !== el && el.isConnected) el.focus({ preventScroll: true });
    });
  }

  const place = () => {
    try {
      if (isVueNodes()) {
        const root = opts.getRoot();
        const el = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
        // data-node-id is not page-unique (subgraph ids restart at 1): prove it is ours.
        if (!el || !root || !el.contains(root)) return;
        const block = vueSlotBlock(el);
        if (!block) return;
        if (band.parentElement !== block) {
          if (getComputedStyle(block).position === "static") block.style.position = "relative";
          block.appendChild(band);
        }
        band.classList.add("parked");
        const slot = block.querySelectorAll('[class*="lg-slot--output"]')[opts.outputIndex];
        if (slot) {
          const scale = (block.getBoundingClientRect().height / (block.offsetHeight || 1)) || 1;
          const sr = slot.getBoundingClientRect();
          const br = block.getBoundingClientRect();
          band.style.top = Math.round((sr.top + sr.height / 2 - br.top) / scale - BAND_H / 2) + "px";
          // Line up with the node's own controls: the root's left edge plus its content inset.
          const rr = root.getBoundingClientRect();
          band.style.left = Math.round((rr.left - br.left) / scale + 8) + "px";
        }
        band.style.right = "auto";
      } else {
        const root = opts.getRoot();
        if (!root) return;
        band.classList.remove("parked");
        if (band.parentElement !== root) {
          if (getComputedStyle(root).position === "static") root.style.position = "relative";
          root.insertBefore(band, root.firstChild);
        }
        // An off-screen / hidden widget reads as zeros: keep the last good place (latent_batch.mjs).
        if (!root.getClientRects().length) return;
        placeSlotBand(node, band, { side: "left", slot: "output", index: opts.outputIndex });
      }
    } catch { /* leave it where it is; the next check tries again */ }
  };

  let timer = null;
  const tick = () => {
    if (!node.graph) { uninstall(); return; }
    place();
    show();
  };
  const mount = () => { place(); show(); };
  function uninstall() {
    if (timer) clearInterval(timer);
    timer = null;
    try { band.remove(); } catch {}
  }
  timer = setInterval(tick, 350);
  queueMicrotask(mount);
  requestAnimationFrame(mount);
  return { band, mount, refresh: show, uninstall };
}
