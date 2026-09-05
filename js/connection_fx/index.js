import { app } from "/scripts/app.js";
import { slotAccepts } from "../shared/slot_types.mjs";

const SETTING_ID = "Pixaroma.Connection.FX";
const PROXIMITY_RADIUS = 110;

let enabled = false;
let cssInjected = false;
let drawHookInstalled = false;
let origDrawFront = null;
let lastLinkIds = null;
let loadHookInstalled = false;
let suppressDiff = false;
let suppressTimer = null;

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
    .pix-conn-fx-magnets {
      position: fixed; left: 0; top: 0; width: 0; height: 0;
      pointer-events: none; z-index: 99998;
    }
    .pix-conn-fx-magnet {
      position: fixed;
      pointer-events: none;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: radial-gradient(circle,
        rgba(255,205,160,0.95) 0%,
        rgba(246,103,68,0.85) 30%,
        rgba(246,103,68,0.30) 55%,
        rgba(246,103,68,0) 75%);
    }
    .pix-conn-fx-particle {
      position: fixed;
      pointer-events: none;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 180, 95, 0.95);
      box-shadow: 0 0 4px 1px rgba(255, 170, 80, 0.65);
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
  // slotAccepts, not "a === b": a ComfyUI multi-type input arrives as the
  // comma-joined "FLOAT,INT,BOOLEAN" (core's Math Expression), so an equality
  // test left the magnets dark on exactly the slots the drag COULD land on.
  // It keeps the "" / "*" wildcard behaviour this used to have (Vue Compat #22).
  return slotAccepts(a, b);
}

function isVueNodes() {
  return !!(window.LiteGraph && window.LiteGraph.vueNodesMode);
}

// ── Nodes 2.0 slot positions ─────────────────────────────────────────────
// In the Vue renderer the node body is DOM, so node.getConnectionPos() drifts
// ~10px from where the slot dot actually renders. We read the dot's DOM rect
// instead. Verified slot-dot key format: "<nodeId>-<in|out>-<slotIndex>"
// (e.g. "3-in-0", "2-out-5"); the dot itself is [data-testid="slot-dot"].
function vueSlotKey(node, slotIndex, isInput) {
  return node.id + (isInput ? "-in-" : "-out-") + slotIndex;
}

function findVueSlotDot(node, slotIndex, isInput) {
  if (!node || node.id == null) return null;
  const keyed = document.querySelector(
    '[data-slot-key="' + vueSlotKey(node, slotIndex, isInput) + '"]'
  );
  if (keyed) return keyed.querySelector('[data-testid="slot-dot"]') || keyed;
  // Fallback: ordered query inside the node frame.
  const frame = document.querySelector('[data-node-id="' + node.id + '"]');
  if (!frame) return null;
  const rows = frame.querySelectorAll(
    isInput ? ".lg-slot--input" : ".lg-slot--output"
  );
  const row = rows[slotIndex];
  if (!row) return null;
  return row.querySelector('[data-testid="slot-dot"]') || row;
}

// One querySelectorAll per frame (only while a wire is being dragged), keyed by
// each dot's data-slot-key, value = viewport-pixel center of the dot.
function buildVueSlotMap() {
  const map = new Map();
  const keyed = document.querySelectorAll("[data-slot-key]");
  for (const el of keyed) {
    const key = el.getAttribute("data-slot-key");
    if (!key) continue;
    const dot = el.querySelector('[data-testid="slot-dot"]') || el;
    const r = dot.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    map.set(key, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
  return map;
}

// Viewport-pixel center of a slot dot, renderer-aware. Used for the sparkle
// burst (a fixed-position DOM overlay).
function slotViewportPos(node, slotIndex, isInput) {
  if (isVueNodes()) {
    const el = findVueSlotDot(node, slotIndex, isInput);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  let pos;
  try {
    pos = node.getConnectionPos(isInput, slotIndex);
  } catch (e) {
    return null;
  }
  if (!pos) return null;
  const c = app.canvas;
  const ds = c?.ds;
  const canvasEl = c?.canvas;
  if (!ds || !canvasEl) return null;
  const rect = canvasEl.getBoundingClientRect();
  return {
    x: rect.left + (pos[0] + ds.offset[0]) * ds.scale,
    y: rect.top + (pos[1] + ds.offset[1]) * ds.scale,
  };
}

function drawApproachIndicators(canvas) {
  // Nodes 2.0 uses the DOM magnet overlay (renderVueMagnets) instead: the
  // front-canvas ctx space doesn't match the Vue DOM slot positions, and the
  // canvas doesn't redraw continuously during a wire drag.
  if (!enabled || isVueNodes()) return;
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

  // Target of a new connection is always an input slot.
  const vp = slotViewportPos(node, slotIndex, true);
  if (!vp) return;
  const cx = vp.x;
  const cy = vp.y;

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

// ── Nodes 2.0 magnet overlay ────────────────────────────────────────────
// In Nodes 2.0 the approach indicators are DOM overlays anchored to each
// compatible slot dot (same idea as the sparkles), driven by our own rAF loop
// instead of the front canvas — which neither positions correctly against the
// Vue DOM slots nor redraws continuously during a wire drag.
let magnetRafId = null;
let magnetContainer = null;
const magnetPool = [];
const particlePool = [];
let pointerIsDown = false;
let lastPointerX = 0;
let lastPointerY = 0;

function ensureMagnetContainer() {
  if (magnetContainer && magnetContainer.isConnected) return magnetContainer;
  magnetContainer = document.createElement("div");
  magnetContainer.className = "pix-conn-fx-magnets";
  document.body.appendChild(magnetContainer);
  return magnetContainer;
}

function clearMagnets() {
  for (const el of magnetPool) el.style.display = "none";
  for (const el of particlePool) el.style.display = "none";
}

function renderVueMagnets() {
  const info = getConnectingInfo();
  const graph = app.graph;
  const c = app.canvas;
  if (!info || !graph || !graph._nodes || !c) { clearMagnets(); return; }
  const ds = c.ds;
  if (!ds) { clearMagnets(); return; }
  // Use the LIVE pointer position (viewport px). graph_mouse can go stale
  // during a Nodes 2.0 wire drag because the pointer events are handled by
  // the Vue slot layer, not the LiteGraph canvas.
  const curVX = lastPointerX;
  const curVY = lastPointerY;
  const scale = ds.scale || 1;
  const radiusPx = PROXIMITY_RADIUS * scale;
  const t = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 5);

  const FLOW_HZ = 1.3;
  const PARTICLE_COUNT = 6;
  const map = buildVueSlotMap();
  ensureMagnetContainer();
  let used = 0;
  let pUsed = 0;
  for (const node of graph._nodes) {
    if (node === info.sourceNode) continue;
    const slots = info.lookingForInputs ? node.inputs : node.outputs;
    if (!slots) continue;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!typesCompatible(info.sourceType, slot.type)) continue;
      const vp = map.get(vueSlotKey(node, i, info.lookingForInputs));
      if (!vp) continue;
      const dx = vp.x - curVX;
      const dy = vp.y - curVY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= radiusPx) continue;
      const proximity = 1 - dist / radiusPx;
      const alpha = proximity * (0.55 + pulse * 0.45);
      const size = 16 + proximity * 18 + pulse * 8;
      let el = magnetPool[used];
      if (!el) {
        el = document.createElement("div");
        el.className = "pix-conn-fx-magnet";
        ensureMagnetContainer().appendChild(el);
        magnetPool.push(el);
      }
      el.style.display = "block";
      el.style.left = vp.x + "px";
      el.style.top = vp.y + "px";
      el.style.width = size + "px";
      el.style.height = size + "px";
      el.style.opacity = alpha.toFixed(3);
      used++;

      // Particles streaming back-and-forth between the wire end and the slot.
      const partD = (1.8 + proximity * 0.8) * 2;
      for (let p = 0; p < PARTICLE_COUNT; p++) {
        const isReverse = p % 2 === 1;
        const phaseOff = p / PARTICLE_COUNT;
        let progress = (t * FLOW_HZ + phaseOff) % 1.0;
        if (isReverse) progress = 1 - progress;
        const px = curVX + (vp.x - curVX) * progress;
        const py = curVY + (vp.y - curVY) * progress;
        const fade = Math.sin(progress * Math.PI);
        const pAlpha = proximity * fade * 0.9;
        let pel = particlePool[pUsed];
        if (!pel) {
          pel = document.createElement("div");
          pel.className = "pix-conn-fx-particle";
          ensureMagnetContainer().appendChild(pel);
          particlePool.push(pel);
        }
        pel.style.display = "block";
        pel.style.left = px + "px";
        pel.style.top = py + "px";
        pel.style.width = partD + "px";
        pel.style.height = partD + "px";
        pel.style.opacity = pAlpha.toFixed(3);
        pUsed++;
      }
    }
  }
  for (let k = used; k < magnetPool.length; k++) magnetPool[k].style.display = "none";
  for (let k = pUsed; k < particlePool.length; k++) particlePool[k].style.display = "none";
}

function magnetLoop() {
  if (!enabled || !isVueNodes()) { magnetRafId = null; clearMagnets(); return; }
  let dragging = false;
  try {
    dragging = !!getConnectingInfo();
    if (dragging) renderVueMagnets();
    else clearMagnets();
  } catch (e) {
    /* swallow so a bad frame doesn't kill the loop */
  }
  // Keep animating while the pointer is down or a wire is being dragged; the
  // rAF self-sustains independent of the (non-continuous) canvas redraw.
  if (pointerIsDown || dragging) {
    magnetRafId = requestAnimationFrame(magnetLoop);
  } else {
    magnetRafId = null;
    clearMagnets();
  }
}

function startMagnetLoop() {
  if (!enabled || !isVueNodes()) return;
  if (magnetRafId == null) magnetRafId = requestAnimationFrame(magnetLoop);
}

function onWinPointerDown(e) {
  pointerIsDown = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  startMagnetLoop();
}
function onWinPointerUp() { pointerIsDown = false; }
function onWinPointerMove(e) { lastPointerX = e.clientX; lastPointerY = e.clientY; }

function installPointerHooks() {
  window.addEventListener("pointerdown", onWinPointerDown, true);
  window.addEventListener("pointerup", onWinPointerUp, true);
  window.addEventListener("pointermove", onWinPointerMove, true);
}
function removePointerHooks() {
  window.removeEventListener("pointerdown", onWinPointerDown, true);
  window.removeEventListener("pointerup", onWinPointerUp, true);
  window.removeEventListener("pointermove", onWinPointerMove, true);
  pointerIsDown = false;
  if (magnetRafId != null) { cancelAnimationFrame(magnetRafId); magnetRafId = null; }
  clearMagnets();
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
  if (suppressDiff) {
    // A workflow is loading: ComfyUI bulk-restores every saved wire at once.
    // Keep the baseline in lockstep so none of them are mistaken for a new
    // user connection (which would spark them all on first load).
    lastLinkIds = current;
    return;
  }
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

function installLoadHook() {
  if (loadHookInstalled) return;
  if (typeof app.loadGraphData !== "function") return;
  const _origLoad_fn = app.loadGraphData;
  const origLoad = (...a) => _origLoad_fn.apply(app, a);
  app.loadGraphData = function () {
    // Every workflow-open / tab-restore / Ctrl+Z funnels through here, and
    // ComfyUI repopulates graph.links with all saved wires. Suppress the
    // new-connection diff for the duration plus a short trailing window
    // (link restoration can finish a tick after the promise resolves), then
    // re-baseline so the loaded wires are treated as pre-existing.
    suppressDiff = true;
    if (suppressTimer) {
      clearTimeout(suppressTimer);
      suppressTimer = null;
    }
    let ret;
    try {
      ret = origLoad.apply(app, arguments);
    } finally {
      Promise.resolve(ret)
        .catch(() => {})
        .finally(() => {
          if (suppressTimer) clearTimeout(suppressTimer);
          suppressTimer = setTimeout(() => {
            suppressTimer = null;
            suppressDiff = false;
            lastLinkIds = collectLinkIds();
          }, 200);
        });
    }
    return ret;
  };
  loadHookInstalled = true;
}

function onSettingChange(v) {
  enabled = !!v;
  if (enabled) {
    injectCSS();
    installDrawHook();
    installLoadHook();
    installPointerHooks();
    lastLinkIds = collectLinkIds();
  } else {
    lastLinkIds = null;
    removePointerHooks();
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
