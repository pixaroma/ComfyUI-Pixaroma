import { app } from "/scripts/app.js";

const SETTING_ID = "Pixaroma.Connection.FX";
const PROXIMITY_RADIUS = 110;

let enabled = false;
let cssInjected = false;
let drawHookInstalled = false;
let connectHookInstalled = false;
let origDrawFront = null;
let origConnect = null;

function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.id = "pix-conn-fx-css";
  style.textContent = `
    .pix-conn-fx-sparkle {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #ffd866;
      box-shadow: 0 0 6px #f66744, 0 0 3px #ffffff;
      animation: pix-conn-fx-sparkle-anim 850ms ease-out forwards;
    }
    @keyframes pix-conn-fx-sparkle-anim {
      0%   { transform: translate(0, 0) scale(1); opacity: 1; }
      100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

function getConnectingInfo() {
  const c = app.canvas;
  if (!c) return null;
  if (c.connecting_links && c.connecting_links.length > 0) {
    const link = c.connecting_links[0];
    return {
      sourceNode: link.node,
      sourceType: link.output?.type || link.input?.type || link.type,
      lookingForInputs: !!link.output,
    };
  }
  if (c.connecting_node) {
    return {
      sourceNode: c.connecting_node,
      sourceType: c.connecting_output?.type || c.connecting_input?.type,
      lookingForInputs: !!c.connecting_output,
    };
  }
  return null;
}

function typesCompatible(a, b) {
  if (!a || !b) return true;
  if (a === "*" || b === "*") return true;
  return a === b;
}

function drawApproachIndicators(canvas) {
  if (!enabled) return;
  const info = getConnectingInfo();
  if (!info) return;
  const graph = app.graph;
  if (!graph || !graph._nodes) return;
  const cursor = canvas.graph_mouse;
  if (!cursor) return;
  const ctx = canvas.ctx;
  if (!ctx) return;
  const ds = canvas.ds;
  if (!ds) return;

  const scale = ds.scale || 1;
  const offset = ds.offset || [0, 0];
  const toScreenX = (gx) => (gx + offset[0]) * scale;
  const toScreenY = (gy) => (gy + offset[1]) * scale;

  const t = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 5);

  ctx.save();
  for (const node of graph._nodes) {
    if (node === info.sourceNode) continue;
    const slots = info.lookingForInputs ? node.inputs : node.outputs;
    if (!slots) continue;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!typesCompatible(info.sourceType, slot.type)) continue;

      let pos;
      try {
        pos = node.getConnectionPos(info.lookingForInputs, i);
      } catch (e) {
        continue;
      }
      if (!pos) continue;

      const dx = pos[0] - cursor[0];
      const dy = pos[1] - cursor[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= PROXIMITY_RADIUS) continue;

      const proximity = 1 - dist / PROXIMITY_RADIUS;
      const alpha = proximity * (0.55 + pulse * 0.45);
      const sx = toScreenX(pos[0]);
      const sy = toScreenY(pos[1]);
      const haloR = 9 + proximity * 5 + pulse * 3;
      const dotR = 3.5 + proximity * 1.2;

      ctx.beginPath();
      ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(246, 103, 68, ${alpha * 0.25})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(246, 103, 68, ${alpha})`;
      ctx.fill();
    }
  }
  ctx.restore();

  if (typeof canvas.setDirty === "function") {
    canvas.setDirty(true, true);
  }
}

function spawnConnectionSparkles(node, slotIndex) {
  const c = app.canvas;
  if (!c) return;

  let pos;
  try {
    pos = node.getConnectionPos(true, slotIndex);
  } catch (e) {
    return;
  }
  if (!pos) return;

  const ds = c.ds;
  const canvasEl = c.canvas;
  if (!ds || !canvasEl) return;

  const rect = canvasEl.getBoundingClientRect();
  const cx = rect.left + (pos[0] + ds.offset[0]) * ds.scale;
  const cy = rect.top + (pos[1] + ds.offset[1]) * ds.scale;

  const count = 10;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
    const dist = 16 + Math.random() * 14;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const el = document.createElement("div");
    el.className = "pix-conn-fx-sparkle";
    el.style.left = cx + "px";
    el.style.top = cy + "px";
    el.style.setProperty("--dx", dx + "px");
    el.style.setProperty("--dy", dy + "px");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
}

function installDrawHook() {
  if (drawHookInstalled) return;
  const LGC = window.LGraphCanvas;
  if (!LGC || !LGC.prototype) return;
  origDrawFront = LGC.prototype.drawFrontCanvas;
  LGC.prototype.drawFrontCanvas = function () {
    const r = origDrawFront ? origDrawFront.apply(this, arguments) : undefined;
    try {
      drawApproachIndicators(this);
    } catch (e) {
      /* swallow */
    }
    return r;
  };
  drawHookInstalled = true;
}

function installConnectHook() {
  if (connectHookInstalled) return;
  const LGN = window.LGraphNode;
  if (!LGN || !LGN.prototype || !LGN.prototype.connect) return;
  origConnect = LGN.prototype.connect;
  LGN.prototype.connect = function (slot, target_node, target_slot) {
    const result = origConnect.apply(this, arguments);
    try {
      if (
        enabled &&
        result &&
        target_node &&
        typeof target_slot === "number"
      ) {
        spawnConnectionSparkles(target_node, target_slot);
      }
    } catch (e) {
      /* swallow */
    }
    return result;
  };
  connectHookInstalled = true;
}

function onSettingChange(v) {
  enabled = !!v;
  if (enabled) {
    injectCSS();
    installDrawHook();
    installConnectHook();
  }
}

app.registerExtension({
  name: "Pixaroma.ConnectionFX",
  settings: [
    {
      id: SETTING_ID,
      name: "Connection FX",
      type: "boolean",
      defaultValue: false,
      tooltip:
        "Show energy indicators near compatible input slots while dragging a wire, and sparkles when the connection lands.",
      category: ["👑 Pixaroma", "Connections"],
      onChange: onSettingChange,
    },
  ],
  async setup() {
    const v = app.ui.settings.getSettingValue(SETTING_ID);
    onSettingChange(v);
  },
});
