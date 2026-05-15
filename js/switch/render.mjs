// Custom canvas widget that paints one row (label background + label
// text + toggle pill). One widget per input slot.
//
// State is read from node.properties.switchState every paint - the
// widget itself is stateless beyond the slot index it represents.
// canvasOnly: true (Pattern #15) keeps it out of the Parameters tab.

const BRAND = "#f66744";
const ROW_H = 28;
const TOGGLE_W = 32;
const TOGGLE_H = 18;
const TOGGLE_R = 9;     // pill radius
const KNOB_R = 6;       // inner knob radius
const PAD_X = 8;        // body horizontal padding inside the row
const DOT_GUTTER = 14;  // left-edge space reserved for the input dot

export const ROW_HEIGHT = ROW_H;

function getState(node) {
  return node.properties?.switchState;
}

function isActive(node, slotIdx) {
  return getState(node)?.activeIndex === slotIdx;
}

function isEmptyTrailing(node, slotIdx) {
  // Empty trailing row = the slot has no link AND it's the last one.
  const slot = node.inputs?.[slotIdx - 1];
  const isLast = slotIdx === (node.inputs?.length || 0);
  return isLast && (!slot || slot.link == null);
}

function labelText(node, slotIdx) {
  return getState(node)?.labels?.[slotIdx] || "";
}

// Compute the rect of the toggle for hit-testing. Coordinates are
// local to the widget (i.e. relative to the row's top-left).
export function toggleRect(widgetWidth) {
  const x = widgetWidth - PAD_X - TOGGLE_W;
  const y = (ROW_H - TOGGLE_H) / 2;
  return { x, y, w: TOGGLE_W, h: TOGGLE_H };
}

// Compute the rect of the label area (between the dot gutter on the
// left and the toggle on the right).
export function labelRect(widgetWidth) {
  const x = DOT_GUTTER + 4;
  const right = widgetWidth - PAD_X - TOGGLE_W - 6;
  return { x, y: 4, w: Math.max(0, right - x), h: ROW_H - 8 };
}

function drawToggle(ctx, widgetWidth, on, disabled) {
  const r = toggleRect(widgetWidth);
  ctx.save();
  if (disabled) ctx.globalAlpha = 0.35;

  // pill background
  ctx.beginPath();
  ctx.fillStyle = on ? BRAND : "#3a3a3a";
  ctx.strokeStyle = on ? BRAND : "#555";
  ctx.lineWidth = 1;
  const rad = TOGGLE_R;
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // knob
  ctx.beginPath();
  ctx.fillStyle = on ? "#fff" : "#ccc";
  const knobX = on ? (r.x + r.w - TOGGLE_R) : (r.x + TOGGLE_R);
  const knobY = r.y + r.h / 2;
  ctx.arc(knobX, knobY, KNOB_R, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawLabel(ctx, widgetWidth, text, dim) {
  const r = labelRect(widgetWidth);
  ctx.save();
  if (dim) ctx.globalAlpha = 0.5;
  ctx.fillStyle = text ? "#d8d8d8" : "#666";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";
  // Ellipsis-clip if too long.
  const display = text || (dim ? "(empty)" : "");
  const maxW = r.w;
  let painted = display;
  if (ctx.measureText(painted).width > maxW) {
    while (painted.length > 1 && ctx.measureText(painted + "...").width > maxW) {
      painted = painted.slice(0, -1);
    }
    painted = painted + "...";
  }
  ctx.fillText(painted, r.x, r.y + r.h / 2);
  ctx.restore();
}

function addRowWidget(node, slotIdx) {
  const name = `pix_switch_row_${slotIdx}`;
  // Remove any previous widget with the same name (rebuild path).
  if (node.widgets) {
    const idx = node.widgets.findIndex((w) => w.name === name);
    if (idx !== -1) node.widgets.splice(idx, 1);
  }
  const widget = {
    name,
    type: "switch_row",
    value: null,
    serialize: false,
    options: { canvasOnly: true },
    _slotIdx: slotIdx,
    computeSize(width) {
      return [width, ROW_H];
    },
    draw(ctx, owner, widgetWidth, y, h) {
      const idx = this._slotIdx;
      const empty = isEmptyTrailing(owner, idx);
      const on = isActive(owner, idx);
      drawLabel(ctx, widgetWidth, labelText(owner, idx), empty);
      drawToggle(ctx, widgetWidth, on, empty);
    },
    // mouse() will be wired in Tasks 7 + 10.
    mouse() { return false; },
  };
  node.addCustomWidget(widget);
  return widget;
}

// Rebuild all row widgets so widget count matches input slot count.
export function attachRowWidgets(node) {
  const slots = node.inputs?.length || 0;
  // Remove any stale row widgets first.
  if (node.widgets) {
    for (let i = node.widgets.length - 1; i >= 0; i--) {
      if ((node.widgets[i].name || "").startsWith("pix_switch_row_")) {
        node.widgets.splice(i, 1);
      }
    }
  }
  for (let i = 1; i <= slots; i++) {
    addRowWidget(node, i);
  }
}
