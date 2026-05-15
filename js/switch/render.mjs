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

export const BRAND = "#f66744";
export const ROW_H = 20;          // matches LiteGraph NODE_SLOT_HEIGHT
export const TOP_PAD = 4;         // matches LiteGraph body top-padding

const TOGGLE_W = 28;
const TOGGLE_H = 14;
const TOGGLE_R = 7;   // pill corner radius
const KNOB_R = 4;     // inner knob radius
const PAD_RIGHT = 70; // right-edge margin before toggle — wide enough to clear
                      // LG's output column on row 1 (output label + dot ~70 px)
const DOT_GUTTER = 14; // left space reserved for the input dot

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
  const maxW = nodeWidth - PAD_RIGHT - TOGGLE_W - 8 - lx;

  ctx.save();
  if (dim) ctx.globalAlpha = 0.45;
  ctx.fillStyle = text ? "#d8d8d8" : "#666";
  ctx.font = "11px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const display = text || (dim ? "(empty)" : "");
  if (!display) { ctx.restore(); return; }

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
