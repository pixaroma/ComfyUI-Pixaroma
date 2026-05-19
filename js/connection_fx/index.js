import { app } from "/scripts/app.js";

const SETTING_ID = "Pixaroma.Connection.FX";
const PROXIMITY_RADIUS = 110;

let enabled = false;
let cssInjected = false;
let drawHookInstalled = false;
let origDrawFront = null;
let lastLinkIds = null;

function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.id = "pix-conn-fx-css";
  style.textContent = `
    .pix-conn-fx-bolts {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      overflow: visible;
    }
    .pix-conn-fx-bolts polyline {
      fill: none;
      stroke: #fff6c8;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      filter: drop-shadow(0 0 2px #ffb633)
              drop-shadow(0 0 5px #f66744);
      opacity: 0;
      animation: pix-conn-fx-bolt-anim 380ms ease-out forwards;
    }
    @keyframes pix-conn-fx-bolt-anim {
      0%   { opacity: 0; stroke-width: 3; }
      10%  { opacity: 1; stroke-width: 2; }
      35%  { opacity: 1; stroke-width: 1.5; }
      100% { opacity: 0; stroke-width: 0.5; }
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
      const cursorSx = toScreenX(cursor[0]);
      const cursorSy = toScreenY(cursor[1]);
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

      const FLOW_HZ = 1.3;
      const PARTICLE_COUNT = 6;
      const partR = 1.8 + proximity * 0.8;
      for (let p = 0; p < PARTICLE_COUNT; p++) {
        const isReverse = p % 2 === 1;
        const phaseOff = p / PARTICLE_COUNT;
        let progress = (t * FLOW_HZ + phaseOff) % 1.0;
        if (isReverse) progress = 1 - progress;
        const px = cursorSx + (sx - cursorSx) * progress;
        const py = cursorSy + (sy - cursorSy) * progress;
        const fade = Math.sin(progress * Math.PI);
        const pAlpha = proximity * fade * 0.9;
        ctx.beginPath();
        ctx.arc(px, py, partR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 170, 80, ${pAlpha})`;
        ctx.fill();
      }
    }
  }
  ctx.restore();

  if (typeof canvas.setDirty === "function") {
    canvas.setDirty(true, true);
  }
}

function jaggedBoltPoints(x1, y1, x2, y2, segments, jitter) {
  const points = [[x1, y1]];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;
    const off = (Math.random() - 0.5) * jitter * 2;
    points.push([cx + perpX * off, cy + perpY * off]);
  }
  points.push([x2, y2]);
  return points;
}

function pointsToAttr(pts) {
  return pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
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

  const pad = 60;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.classList.add("pix-conn-fx-bolts");
  svg.style.left = (cx - pad) + "px";
  svg.style.top = (cy - pad) + "px";
  svg.style.width = (pad * 2) + "px";
  svg.style.height = (pad * 2) + "px";
  svg.setAttribute("viewBox", "0 0 " + (pad * 2) + " " + (pad * 2));

  const lcx = pad;
  const lcy = pad;
  const boltCount = 5 + Math.floor(Math.random() * 2);
  for (let i = 0; i < boltCount; i++) {
    const angle = (Math.PI * 2 * i) / boltCount + (Math.random() - 0.5) * 0.6;
    const length = 20 + Math.random() * 16;
    const ex = lcx + Math.cos(angle) * length;
    const ey = lcy + Math.sin(angle) * length;
    const main = jaggedBoltPoints(lcx, lcy, ex, ey, 5, 4);
    const poly = document.createElementNS(svgNS, "polyline");
    poly.setAttribute("points", pointsToAttr(main));
    poly.style.animationDelay = (i * 18) + "ms";
    svg.appendChild(poly);

    if (Math.random() > 0.5) {
      const fAngle = angle + (Math.random() - 0.5) * 1.4;
      const fLen = 6 + Math.random() * 7;
      const fork = jaggedBoltPoints(
        ex, ey,
        ex + Math.cos(fAngle) * fLen,
        ey + Math.sin(fAngle) * fLen,
        2, 2,
      );
      const fPoly = document.createElementNS(svgNS, "polyline");
      fPoly.setAttribute("points", pointsToAttr(fork));
      fPoly.style.animationDelay = (i * 18 + 20) + "ms";
      fPoly.style.strokeWidth = "1";
      svg.appendChild(fPoly);
    }
  }

  document.body.appendChild(svg);
  setTimeout(() => svg.remove(), 500);
}

function collectLinkIds() {
  const graph = app.graph;
  if (!graph || !graph.links) return null;
  const links = graph.links;
  const ids = new Set();
  if (Array.isArray(links)) {
    for (const link of links) {
      if (link && link.id != null) ids.add(link.id);
    }
  } else if (typeof links.forEach === "function") {
    links.forEach((link) => {
      if (link && link.id != null) ids.add(link.id);
    });
  } else {
    for (const k in links) {
      const link = links[k];
      if (link && link.id != null) ids.add(link.id);
    }
  }
  return ids;
}

function findLinkById(id) {
  const graph = app.graph;
  if (!graph || !graph.links) return null;
  const links = graph.links;
  if (Array.isArray(links)) {
    return links.find((l) => l && l.id === id) || null;
  }
  if (typeof links.get === "function") {
    return links.get(id) || null;
  }
  return links[id] || null;
}

function detectNewConnections() {
  if (!enabled) return;
  const current = collectLinkIds();
  if (!current) return;
  if (lastLinkIds !== null) {
    for (const id of current) {
      if (!lastLinkIds.has(id)) {
        const link = findLinkById(id);
        if (link) {
          const targetNode = app.graph.getNodeById(link.target_id);
          if (targetNode && typeof link.target_slot === "number") {
            spawnConnectionSparkles(targetNode, link.target_slot);
          }
        }
      }
    }
  }
  lastLinkIds = current;
}

function installDrawHook() {
  if (drawHookInstalled) return;
  const LGC = window.LGraphCanvas;
  if (!LGC || !LGC.prototype) return;
  origDrawFront = LGC.prototype.drawFrontCanvas;
  LGC.prototype.drawFrontCanvas = function () {
    const r = origDrawFront ? origDrawFront.apply(this, arguments) : undefined;
    try {
      detectNewConnections();
      drawApproachIndicators(this);
    } catch (e) {
      /* swallow */
    }
    return r;
  };
  drawHookInstalled = true;
}

function onSettingChange(v) {
  enabled = !!v;
  if (enabled) {
    injectCSS();
    installDrawHook();
    lastLinkIds = collectLinkIds();
  } else {
    lastLinkIds = null;
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
