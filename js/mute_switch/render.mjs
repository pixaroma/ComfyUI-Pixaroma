// Pure paint + hit-test for Mute Switch Pixaroma.
//
// The node body has TWO regions stacked vertically:
//   Y in [0, MODE_BAR_H) ........... mode bar (two pills at top)
//   Y in [MODE_BAR_H + TOP_PAD, ...] row area (one row per input slot)
//
// LiteGraph draws input dots starting at body-local Y = TOP_PAD + i*ROW_H
// + ROW_H/2 by default, so we override slot.pos in core.mjs::normalizeSlots
// to push the dots below the mode bar (Vue Compat #16: slot.pos IS read by
// calculateInputSlotPosFromSlot in this LG fork).

import { app } from "/scripts/app.js";

export const BRAND = "#f66744";
export const MODE_BAR_H = 28;        // height of the two-pills row at top
export const ROW_H = 20;             // matches LG NODE_SLOT_HEIGHT
export const TOP_PAD = 4;            // gap between mode bar and first row
export const SIDE_PAD = 8;
export const OUTPUT_X_INSET = 10;    // pulls phantom output dot 10 px inside

// Mode bar layout
const MODE_PILL_W = 92;
const MODE_PILL_H = 18;

// Row layout
const ROW_PILL_W = 28;
const ROW_PILL_H = 14;
const ROW_PILL_R = 7;
const ROW_KNOB_R = 4;
// Right-side margin. Wide enough to leave room for BOTH the phantom "out"
// output dot (10 px inside) AND its "out" caption (~20 px wide painted to
// the dot's left) without either overlapping the row pills. At MIN_W=260
// this still leaves ~144 px of label width on each row.
const ROW_PILL_RIGHT_PAD = 52;
const DOT_GUTTER = 28;

// ── Mode bar rects (body-local) ──────────────────────────────────────────

export function selectModePillRect(nodeWidth) {
  return {
    x: SIDE_PAD,
    y: (MODE_BAR_H - MODE_PILL_H) / 2,
    w: MODE_PILL_W,
    h: MODE_PILL_H,
  };
}

export function mutePillRect(nodeWidth) {
  return {
    x: nodeWidth - SIDE_PAD - MODE_PILL_W,
    y: (MODE_BAR_H - MODE_PILL_H) / 2,
    w: MODE_PILL_W,
    h: MODE_PILL_H,
  };
}

// ── Row rects (body-local) ───────────────────────────────────────────────

export function rowCenterY(slotIdx0) {
  return MODE_BAR_H + TOP_PAD + slotIdx0 * ROW_H + ROW_H / 2;
}

export function rowPillRect(nodeWidth, slotIdx0) {
  const cy = rowCenterY(slotIdx0);
  return {
    x: nodeWidth - ROW_PILL_RIGHT_PAD - ROW_PILL_W,
    y: cy - ROW_PILL_H / 2,
    w: ROW_PILL_W,
    h: ROW_PILL_H,
  };
}

export function labelRect(nodeWidth, slotIdx0) {
  const cy = rowCenterY(slotIdx0);
  const left = DOT_GUTTER + 4;
  const right = nodeWidth - ROW_PILL_RIGHT_PAD - ROW_PILL_W - 6;
  return {
    x: left,
    y: cy - ROW_H / 2,
    w: Math.max(0, right - left),
    h: ROW_H,
  };
}

function inside(pos, r) {
  return (
    pos[0] >= r.x && pos[0] <= r.x + r.w &&
    pos[1] >= r.y && pos[1] <= r.y + r.h
  );
}

export function hitSelectModePill(pos, nodeWidth) {
  return inside(pos, selectModePillRect(nodeWidth));
}
export function hitMutePill(pos, nodeWidth) {
  return inside(pos, mutePillRect(nodeWidth));
}
export function hitRowPill(pos, nodeWidth, slotIdx0) {
  return inside(pos, rowPillRect(nodeWidth, slotIdx0));
}
export function hitLabel(pos, nodeWidth, slotIdx0) {
  return inside(pos, labelRect(nodeWidth, slotIdx0));
}

// Mirrors js/switch/render.mjs::labelScreenRect for the inline DOM editor.
export function labelScreenRect(node, slotIdx1) {
  const slotIdx0 = slotIdx1 - 1;
  const r = labelRect(node.size?.[0] || 280, slotIdx0);
  const ds = app.canvas?.ds;
  const scale = ds?.scale || 1;
  const offsetX = ds?.offset?.[0] || 0;
  const offsetY = ds?.offset?.[1] || 0;
  const canvasEl = app.canvas?.canvas;
  const canvasRect = canvasEl ? canvasEl.getBoundingClientRect() : { left: 0, top: 0 };
  const baseLeft = canvasRect.left + offsetX * scale;
  const baseTop = canvasRect.top + offsetY * scale;
  return {
    x: baseLeft + (node.pos[0] + r.x) * scale,
    y: baseTop + (node.pos[1] + r.y) * scale,
    w: r.w * scale,
    h: r.h * scale,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTwoSegmentPill(ctx, rect, leftLabel, rightLabel, leftActive) {
  const halfW = rect.w / 2;
  ctx.save();

  // Background (unfilled rounded rect with subtle border).
  roundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Active segment fill (BRAND orange), clipped to the pill shape.
  ctx.save();
  roundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  ctx.clip();
  ctx.fillStyle = BRAND;
  if (leftActive) {
    ctx.fillRect(rect.x, rect.y, halfW, rect.h);
  } else {
    ctx.fillRect(rect.x + halfW, rect.y, halfW, rect.h);
  }
  ctx.restore();

  // Text.
  ctx.font = "11px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = leftActive ? "#fff" : "rgba(255,255,255,0.65)";
  ctx.fillText(leftLabel, rect.x + halfW / 2, rect.y + rect.h / 2);
  ctx.fillStyle = leftActive ? "rgba(255,255,255,0.65)" : "#fff";
  ctx.fillText(rightLabel, rect.x + halfW + halfW / 2, rect.y + rect.h / 2);
  ctx.restore();
}

function drawRowPill(ctx, rect, on) {
  ctx.save();
  ctx.fillStyle = on ? BRAND : "rgba(255,255,255,0.06)";
  ctx.strokeStyle = on ? BRAND : "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  roundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, ROW_PILL_R);
  ctx.fill();
  ctx.stroke();

  // Knob.
  ctx.beginPath();
  ctx.fillStyle = on ? "#fff" : "#ccc";
  const knobX = on ? (rect.x + rect.w - ROW_PILL_R) : (rect.x + ROW_PILL_R);
  const knobY = rect.y + rect.h / 2;
  ctx.arc(knobX, knobY, ROW_KNOB_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Per-row truncation cache (Map keyed on slot ref). Invalidated when the
// display string, max width, or font changes - so a fresh truncate runs
// only when something actually moved, not every paint frame.
const _labelCache = new WeakMap();

function fitLabel(ctx, slot, display, maxW, font) {
  const cached = _labelCache.get(slot);
  if (cached
    && cached.display === display
    && cached.maxW === maxW
    && cached.font === font) {
    return cached.painted;
  }
  let painted = display;
  if (ctx.measureText(painted).width > maxW) {
    // Binary search for the cut point instead of char-by-char slicing -
    // O(log n) measureText calls instead of O(n).
    let lo = 1, hi = painted.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (ctx.measureText(painted.slice(0, mid) + "...").width <= maxW) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    painted = painted.slice(0, lo) + "...";
  }
  _labelCache.set(slot, { display, maxW, font, painted });
  return painted;
}

function drawRowLabel(ctx, nodeWidth, slotIdx0, slot, text, isTrailing, upstreamType) {
  const cy = rowCenterY(slotIdx0);
  const lx = DOT_GUTTER + 4;
  const maxW = nodeWidth - ROW_PILL_RIGHT_PAD - ROW_PILL_W - 8 - lx;

  ctx.save();
  if (isTrailing) ctx.globalAlpha = 0.45;

  const hasUserText = text && text.length > 0;
  const usefulType = upstreamType && upstreamType !== "*" ? upstreamType : null;
  let display, color;
  if (hasUserText) {
    display = text;
    color = "#d8d8d8";
  } else if (isTrailing) {
    display = "(empty)";
    color = "#aaa";
  } else if (usefulType) {
    display = usefulType;
    color = "#d8d8d8";
  } else {
    display = "Label...";
    color = "#5a5a5a";
  }

  const font = "12px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const painted = slot ? fitLabel(ctx, slot, display, maxW, font) : display;
  ctx.fillText(painted, lx, cy);
  ctx.restore();
}

// Vue Compat #3: graph.links may be a Map.
// Cached on the slot itself - invalidated when the slot's link id changes
// (we check link id equality), so connect/disconnect/wire-replace all
// produce a fresh lookup naturally without a separate invalidation hook.
// Exported so the Nodes 2.0 DOM list (vue_list.mjs) can show the same
// wire-type placeholder the legacy canvas paints.
export function getUpstreamType(node, slotIdx1) {
  const slot = node.inputs?.[slotIdx1 - 1];
  const linkId = slot?.link;
  if (linkId == null) return null;
  // Hit the cache if the link id hasn't changed since last lookup.
  if (slot._pixMsTypeCache && slot._pixMsTypeCache.linkId === linkId) {
    return slot._pixMsTypeCache.type;
  }
  let link = node.graph?.links?.[linkId];
  if (!link && typeof node.graph?.links?.get === "function") {
    link = node.graph.links.get(linkId);
  }
  if (!link) return null;
  const upstream = node.graph?.getNodeById?.(link.origin_id);
  const type = upstream?.outputs?.[link.origin_slot]?.type || null;
  slot._pixMsTypeCache = { linkId, type };
  return type;
}

// ── Canvas tooltip helper (Pixaroma UI Convention #8) ────────────────────
// Single floating <div> appended to document.body. Hover state tracked on
// the calling node so transitions fire showTooltip/hideTooltip exactly once.

let _tipEl = null;
let _tipMoveHandler = null;
let _tipOwnerNode = null;

function ensureTipEl() {
  if (_tipEl) return _tipEl;
  _tipEl = document.createElement("div");
  // Match the OS-native tooltip style used by Switch Source's DOM controls
  // (which use the browser title attribute). White background, dark text,
  // sharp corners, thin gray border - so canvas-painted controls and DOM
  // controls feel the same.
  _tipEl.style.cssText = [
    "position: fixed",
    "z-index: 99999",
    "pointer-events: none",
    "background: #ffffff",
    "color: #000000",
    "font: 12px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
    "padding: 3px 7px",
    "border-radius: 0",
    "border: 1px solid #767676",
    "max-width: 280px",
    "line-height: 1.3",
    "box-shadow: 0 2px 4px rgba(0,0,0,0.15)",
    "display: none",
  ].join("; ");
  document.body.appendChild(_tipEl);
  return _tipEl;
}

function showTooltip(text, ownerNode) {
  const el = ensureTipEl();
  el.textContent = text;
  el.style.display = "block";
  _tipOwnerNode = ownerNode;

  if (!_tipMoveHandler) {
    _tipMoveHandler = (e) => {
      // Hide if cursor leaves the LG canvas entirely (Prompt Pack Pattern #8).
      if (e.target !== app.canvas?.canvas) {
        hideTooltip();
        return;
      }
      el.style.left = (e.clientX + 12) + "px";
      el.style.top = (e.clientY + 16) + "px";
    };
    window.addEventListener("mousemove", _tipMoveHandler);
  }
}

export function hideTooltip() {
  if (_tipEl) _tipEl.style.display = "none";
  if (_tipMoveHandler) {
    window.removeEventListener("mousemove", _tipMoveHandler);
    _tipMoveHandler = null;
  }
  if (_tipOwnerNode) {
    _tipOwnerNode._pixMsHover = null;
    _tipOwnerNode = null;
  }
}

// Per-frame hover detection inside drawMuteSwitch.
function detectHover(node) {
  const gm = app.canvas?.graph_mouse;
  if (!gm) return null;
  const mx = gm[0] - node.pos[0];
  const my = gm[1] - node.pos[1];
  const w = node.size[0];

  if (hitSelectModePill([mx, my], w)) return "selectMode";
  if (hitMutePill([mx, my], w)) return "muteMode";

  const inputs = node.inputs || [];
  for (let i = 0; i < inputs.length; i++) {
    if (hitRowPill([mx, my], w, i)) return `rowPill:${i}`;
  }
  return null;
}

function updateHoverTooltip(node) {
  const newHover = detectHover(node);
  const prevHover = node._pixMsHover || null;
  if (newHover === prevHover) return;
  node._pixMsHover = newHover;

  if (newHover === "selectMode") {
    const cur = node.properties?.muteSwitchState?.selectMode || "multi";
    showTooltip(
      cur === "single"
        ? "Click to allow multiple scenes at once"
        : "Click to allow only one scene at a time",
      node,
    );
  } else if (newHover === "muteMode") {
    const cur = node.properties?.muteSwitchState?.muteMode || "mute";
    showTooltip(
      cur === "mute"
        ? "Mute: scene does not run at all. Click for Bypass."
        : "Bypass: each node passes its input through unchanged. Click for Mute.",
      node,
    );
  } else if (newHover && newHover.startsWith("rowPill:")) {
    const i = parseInt(newHover.split(":")[1], 10);
    const row = node.properties?.muteSwitchState?.rows?.[i];
    const slot = node.inputs?.[i];
    if (slot && slot.link != null && row) {
      showTooltip(
        row.enabled ? "Click to skip this scene" : "Click to enable this scene",
        node,
      );
    } else {
      hideTooltip();
    }
  } else {
    hideTooltip();
  }
}

// ── Main paint ───────────────────────────────────────────────────────────

export function drawMuteSwitch(node, ctx) {
  updateHoverTooltip(node);

  const w = node.size[0];

  // Keep the phantom "out" output dot pinned just below the mode bar and
  // 10 px inside the right edge (mirrors the input-dot inset on the left).
  // Re-applied per paint so it stays correct on resize (Vue Compat #13:
  // onResize is unreliable).
  if (node.outputs?.[0]) {
    const ox = w - OUTPUT_X_INSET;
    const oy = MODE_BAR_H + TOP_PAD + ROW_H / 2;
    if (node.outputs[0].pos?.[0] !== ox || node.outputs[0].pos?.[1] !== oy) {
      node.outputs[0].pos = [ox, oy];
    }
  }
  const state = node.properties?.muteSwitchState;
  const selectMode = state?.selectMode || "multi";
  const muteMode = state?.muteMode || "mute";
  const rows = state?.rows || [];
  const inputs = node.inputs || [];

  // Mode bar background (subtle separator).
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(0, 0, w, MODE_BAR_H);
  ctx.restore();

  // Left pill: Single | Multi
  drawTwoSegmentPill(
    ctx,
    selectModePillRect(w),
    "Single",
    "Multi",
    selectMode === "single",
  );

  // Right pill: Mute | Bypass
  drawTwoSegmentPill(
    ctx,
    mutePillRect(w),
    "Mute",
    "Bypass",
    muteMode === "mute",
  );

  // Rows.
  let wiredRows = 0;
  for (let i = 0; i < inputs.length; i++) {
    const slotIdx1 = i + 1;
    const slot = inputs[i];
    const connected = slot != null && slot.link != null;
    if (connected) wiredRows++;
    const isTrailing = !connected && slotIdx1 === inputs.length;
    const row = rows[i];
    const on = connected && row && row.enabled;

    const labelTxt = (row && row.label) || "";
    const upType = connected ? getUpstreamType(node, slotIdx1) : null;
    drawRowLabel(ctx, w, i, slot, labelTxt, isTrailing, upType);
    drawRowPill(ctx, rowPillRect(w, i), on);
  }

  // Empty-state hint: when no row is wired yet, paint a faint line under
  // the trailing "(empty)" row explaining what to do. Helps first-time
  // discovery (a fresh node lands with just one greyed empty row and the
  // pills, with no obvious next step).
  if (wiredRows === 0 && inputs.length === 1) {
    const hintY = rowCenterY(0) + ROW_H * 0.75;
    ctx.save();
    ctx.fillStyle = "#5a5a5a";
    ctx.font = "10px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("Wire any node into the row above", DOT_GUTTER + 4, hintY);
    ctx.restore();
  }

  // Small "out" caption next to the phantom output dot so chaining is
  // discoverable. The output dot itself has its label suppressed (zero-
  // width space) so the user wouldn't otherwise know it's a chain hook.
  if (node.outputs?.[0]) {
    const oy = MODE_BAR_H + TOP_PAD + ROW_H / 2;
    ctx.save();
    ctx.fillStyle = "#888";
    ctx.font = "9px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillText("out", w - OUTPUT_X_INSET - 8, oy);
    ctx.restore();
  }
}
