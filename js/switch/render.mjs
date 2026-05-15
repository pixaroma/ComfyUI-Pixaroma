// Pure paint helpers for Switch Pixaroma rows.
// All coordinates are node-body-local (0,0 = top-left of the body area,
// same origin that onDrawForeground receives).
//
// LiteGraph draws input slot dots at body-local Y:
//   dotY(i) = TOP_PAD + i * ROW_H + ROW_H/2    (i = 0-based slot index)
// where TOP_PAD = 4 and ROW_H = 20 match LiteGraph's default
//   NODE_SLOT_HEIGHT = 20 with the 4px body-top padding.
// So dotY(0) = 14, dotY(1) = 34, dotY(2) = 54 ...
// Our row paintings use the same formula so labels/toggles sit on the
// same horizontal band as the slot dot.

import { app } from "/scripts/app.js";

export const BRAND = "#f66744";
export const ROW_H = 20;          // matches LiteGraph NODE_SLOT_HEIGHT
export const TOP_PAD = 4;         // matches LiteGraph body top-padding

const TOGGLE_W = 28;
const TOGGLE_H = 14;
const TOGGLE_R = 7;   // pill corner radius
const KNOB_R = 4;     // inner knob radius
const PAD_RIGHT = 70; // right-edge margin before toggle - wide enough to clear
                      // LG's output column on row 1 (output label + dot ~70 px)
const DOT_GUTTER = 28; // left space reserved for the input dot AND
                        // clearance past LiteGraph's slot-drag hit zone
                        // (clicks within ~20-25 px of the dot are intercepted
                        // by LG before reaching node.onMouseDown).

const TOGGLE_RIGHT_PAD = PAD_RIGHT; // reserved for future use; not exported

// Row Y center in node-body-local coordinates (0-based slot index).
export function rowCenterY(slotIdx0) {
  return TOP_PAD + slotIdx0 * ROW_H + ROW_H / 2;
}

// The rect of the toggle pill for a given slot (body-local coords).
// slotIdx0 = 0-based.
export function toggleRect(nodeWidth, slotIdx0) {
  const cy = rowCenterY(slotIdx0);
  return {
    x: nodeWidth - PAD_RIGHT - TOGGLE_W,
    y: cy - TOGGLE_H / 2,
    w: TOGGLE_W,
    h: TOGGLE_H,
  };
}

function inside(pos, r) {
  return (
    pos[0] >= r.x && pos[0] <= r.x + r.w &&
    pos[1] >= r.y && pos[1] <= r.y + r.h
  );
}

// Exported for hit-testing in index.js.
export function hitToggle(pos, nodeWidth, slotIdx0) {
  return inside(pos, toggleRect(nodeWidth, slotIdx0));
}

// The rect of the label area for a given slot (body-local coords).
// slotIdx0 = 0-based. The label area spans from the dot gutter to the
// left edge of the toggle pill.
export function labelRect(nodeWidth, slotIdx0) {
  const cy = rowCenterY(slotIdx0);
  const left = DOT_GUTTER + 4;
  const right = nodeWidth - PAD_RIGHT - TOGGLE_W - 6;
  return {
    x: left,
    y: cy - ROW_H / 2,
    w: Math.max(0, right - left),
    h: ROW_H,
  };
}

// Hit-test the label area for slot slotIdx0 (0-based).
export function hitLabel(pos, nodeWidth, slotIdx0) {
  return inside(pos, labelRect(nodeWidth, slotIdx0));
}

// Convert the label area for slot slotIdx1 (1-based) from node-body-local
// coordinates to viewport pixel coordinates. Used by editor.mjs to position
// the DOM <input> overlay at the correct screen location.
// Mirrors the Note Pixaroma pencil-position math.
export function labelScreenRect(node, slotIdx1) {
  const slotIdx0 = slotIdx1 - 1;
  const r = labelRect(node.size?.[0] || 260, slotIdx0);

  // Use the full row rect for the overlay so it visually matches the
  // canvas-painted label row.
  const nodeX = r.x;
  const nodeY = r.y;
  const nodeW = r.w;
  const nodeH = r.h;

  const ds = app.canvas?.ds;
  const scale = ds?.scale || 1;
  const offsetX = ds?.offset?.[0] || 0;
  const offsetY = ds?.offset?.[1] || 0;
  const canvasEl = app.canvas?.canvas;
  const canvasRect = canvasEl ? canvasEl.getBoundingClientRect() : { left: 0, top: 0 };
  // LiteGraph node.pos is the body top-left (title bar sits above it).
  const baseLeft = canvasRect.left + offsetX * scale;
  const baseTop = canvasRect.top + offsetY * scale;
  return {
    x: baseLeft + (node.pos[0] + nodeX) * scale,
    y: baseTop + (node.pos[1] + nodeY) * scale,
    w: nodeW * scale,
    h: nodeH * scale,
  };
}

// Draw a single toggle pill at the correct body-local Y for slotIdx0.
function drawToggle(ctx, nodeWidth, slotIdx0, on, disabled) {
  const r = toggleRect(nodeWidth, slotIdx0);
  ctx.save();
  if (disabled) ctx.globalAlpha = 0.35;

  // Pill background
  ctx.beginPath();
  ctx.fillStyle = on ? BRAND : "#3a3a3a";
  ctx.strokeStyle = on ? BRAND : "#555";
  ctx.lineWidth = 1;
  const rad = TOGGLE_R;
  const t = r.y, b = r.y + r.h, l = r.x, ri = r.x + r.w;
  ctx.moveTo(l + rad, t);
  ctx.arcTo(ri, t, ri, b, rad);
  ctx.arcTo(ri, b, l, b, rad);
  ctx.arcTo(l, b, l, t, rad);
  ctx.arcTo(l, t, ri, t, rad);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Knob
  ctx.beginPath();
  ctx.fillStyle = on ? "#fff" : "#ccc";
  const knobX = on ? (ri - TOGGLE_R) : (l + TOGGLE_R);
  const knobY = r.y + r.h / 2;
  ctx.arc(knobX, knobY, KNOB_R, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Draw the label text for a row. slotIdx0 = 0-based.
function drawLabel(ctx, nodeWidth, slotIdx0, text, dim) {
  const cy = rowCenterY(slotIdx0);
  const lx = DOT_GUTTER + 4;
  const r = labelRect(nodeWidth, slotIdx0);
  const maxW = nodeWidth - PAD_RIGHT - TOGGLE_W - 8 - lx;

  ctx.save();

  // Connected-row affordance: paint a subtle rounded-rect outline so the
  // label area looks like a clickable input field. Dimmed (empty trailing)
  // rows skip this so they don't suggest a typeable affordance where
  // there's no slot to label yet.
  if (!dim) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    const radius = 3;
    const x = r.x;
    const y = r.y + 2;
    const w = r.w;
    const h = r.h - 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
    else ctx.rect(x, y, w, h);
    ctx.stroke();
  }

  if (dim) ctx.globalAlpha = 0.45;
  // Empty-but-connected rows show "Label..." in placeholder grey;
  // user-set text shows in the normal text color.
  const hasUserText = text && text.length > 0;
  let display, color;
  if (hasUserText) {
    display = text;
    color = "#d8d8d8";
  } else if (dim) {
    display = "(empty)";
    color = "#666";
  } else {
    display = "Label...";
    color = "#5a5a5a"; // dimmer than canvas grey - "placeholder" feel
  }

  ctx.fillStyle = color;
  ctx.font = "12px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  let painted = display;
  if (ctx.measureText(painted).width > maxW) {
    while (painted.length > 1 && ctx.measureText(painted + "...").width > maxW) {
      painted = painted.slice(0, -1);
    }
    painted += "...";
  }
  ctx.fillText(painted, lx, cy);
  ctx.restore();
}

// Paint all rows for the node. Called from onDrawForeground.
// node.inputs must exist; node.properties.switchState holds activeIndex.
export function drawSwitchRows(node, ctx) {
  const inputs = node.inputs;
  if (!inputs || inputs.length === 0) return;
  const w = node.size[0];
  const state = node.properties?.switchState;
  const activeIndex = state?.activeIndex ?? 0; // 1-based; 0 = none
  const labels = state?.labels ?? {};

  for (let i = 0; i < inputs.length; i++) {
    const slotIdx1 = i + 1; // 1-based
    const slot = inputs[i];
    const connected = slot != null && slot.link != null;
    const isTrailing = !connected && slotIdx1 === inputs.length;
    const on = connected && activeIndex === slotIdx1;

    const labelTxt = labels[slotIdx1] || "";
    drawLabel(ctx, w, i, labelTxt, isTrailing);
    drawToggle(ctx, w, i, on, isTrailing);
  }
}
