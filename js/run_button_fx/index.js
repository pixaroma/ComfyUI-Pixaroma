import { app } from "/scripts/app.js";

const FX_OPTIONS = [
  "None",
  "Pixaroma Orange",
  "Flash",
  "Ignition",
  "Thor",
  "Sparkle",
  "Rocket",
  "Shockwave",
];

const FX_CLASSES = ["pix-rb-orange", "pix-rb-rocket-shake"];

let currentFx = "None";
let currentButton = null;
let cleanupCurrent = () => {};
let observer = null;
let pendingCheck = false;

function injectCSS() {
  if (document.querySelector("#pix-rb-fx-css")) return;
  const style = document.createElement("style");
  style.id = "pix-rb-fx-css";
  style.textContent = `
    button.pix-rb-orange {
      background: #f66744 !important;
      background-image: none !important;
      color: #ffffff !important;
      border-color: #f66744 !important;
      box-shadow: none !important;
    }
    button.pix-rb-orange:hover {
      background: #f66744 !important;
      background-image: none !important;
      filter: brightness(1.08);
      box-shadow: none !important;
    }

    .pix-rb-fx-flame {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      background: radial-gradient(ellipse at 80% 50%,
        rgba(255, 245, 120, 0.85) 0%,
        rgba(255, 180, 40, 0.7) 18%,
        rgba(255, 100, 30, 0.45) 42%,
        rgba(220, 40, 30, 0.18) 70%,
        rgba(220, 40, 30, 0) 92%);
      filter: blur(5px);
      transform-origin: right center;
      animation: pix-rb-flame-anim 650ms ease-out forwards;
    }
    @keyframes pix-rb-flame-anim {
      0%   { transform: scaleX(0.3); opacity: 0; }
      20%  { transform: scaleX(1); opacity: 1; }
      100% { transform: scaleX(1.7); opacity: 0; }
    }

    .pix-rb-fx-sparkle {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #ffeb3b;
      box-shadow: 0 0 6px #ffeb3b, 0 0 3px #ffffff;
      animation: pix-rb-sparkle-anim 1.6s ease-out forwards;
    }
    @keyframes pix-rb-sparkle-anim {
      0%   { transform: translateY(0) scale(1); opacity: 1; }
      100% { transform: translateY(-32px) scale(0); opacity: 0; }
    }

    .pix-rb-fx-sparkleburst {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #ffeb3b;
      box-shadow: 0 0 8px #ffeb3b, 0 0 4px #ffffff;
      animation: pix-rb-sparkleburst-anim 900ms ease-out forwards;
    }
    @keyframes pix-rb-sparkleburst-anim {
      0%   { transform: translate(0, 0) scale(1); opacity: 1; }
      100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
    }

    .pix-rb-fx-bolts {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      overflow: visible;
    }
    .pix-rb-fx-bolts polyline {
      fill: none;
      stroke: var(--bolt-color, #ffffff);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      filter: drop-shadow(0 0 3px var(--bolt-glow-1, #aaccff))
              drop-shadow(0 0 8px var(--bolt-glow-2, #4488ff));
      opacity: 0;
      animation: pix-rb-bolt-anim 380ms ease-out forwards;
    }
    .pix-rb-fx-bolts.is-thor {
      --bolt-color: #ffffff;
      --bolt-glow-1: #aaccff;
      --bolt-glow-2: #4488ff;
    }
    .pix-rb-fx-bolts.is-flash {
      --bolt-color: #fff6c8;
      --bolt-glow-1: #ffb633;
      --bolt-glow-2: #f66744;
    }
    @keyframes pix-rb-bolt-anim {
      0%   { opacity: 0; stroke-width: 4; }
      8%   { opacity: 1; stroke-width: 3; }
      35%  { opacity: 1; stroke-width: 2; }
      100% { opacity: 0; stroke-width: 1; }
    }

    button.pix-rb-rocket-shake {
      animation: pix-rb-rocket-shake-anim 420ms ease-in-out;
    }
    @keyframes pix-rb-rocket-shake-anim {
      0%, 100% { transform: translate(0, 0); }
      15%      { transform: translate(-1px, 1px); }
      30%      { transform: translate(2px, -1px); }
      45%      { transform: translate(-2px, 0); }
      60%      { transform: translate(2px, 1px); }
      75%      { transform: translate(-1px, -1px); }
      90%      { transform: translate(1px, 0); }
    }

    .pix-rb-fx-exhaust {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      background: radial-gradient(ellipse at 50% 20%,
        rgba(255, 245, 120, 0.85) 0%,
        rgba(255, 180, 40, 0.7) 18%,
        rgba(255, 100, 30, 0.45) 42%,
        rgba(220, 40, 30, 0.18) 70%,
        rgba(220, 40, 30, 0) 92%);
      filter: blur(5px);
      transform-origin: top center;
      animation: pix-rb-exhaust-anim 700ms ease-out forwards;
    }
    @keyframes pix-rb-exhaust-anim {
      0%   { transform: scaleY(0.3); opacity: 0; }
      20%  { transform: scaleY(1); opacity: 1; }
      100% { transform: scaleY(1.7); opacity: 0; }
    }

    .pix-rb-fx-ring {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      border: 3px solid #f66744;
      border-radius: 12px;
      box-shadow: 0 0 14px rgba(246, 103, 68, 0.55),
                  inset 0 0 8px rgba(246, 103, 68, 0.35);
      box-sizing: border-box;
      animation: pix-rb-ring-anim 750ms ease-out forwards;
    }
    @keyframes pix-rb-ring-anim {
      0%   { transform: scale(0.9); opacity: 0.95; border-width: 4px; }
      100% { transform: scale(2.4); opacity: 0; border-width: 1px; }
    }

  `;
  document.head.appendChild(style);
}

function findRunButton() {
  const byTestId = document.querySelector('button[data-testid="queue-button"]');
  if (byTestId) return byTestId;
  const buttons = document.querySelectorAll("button");
  for (const btn of buttons) {
    const text = (btn.textContent || "").trim();
    if (text === "Run") return btn;
  }
  return null;
}

function spawnFlamePuff(button, opts) {
  const r = button.getBoundingClientRect();
  const w = 70 + Math.random() * 35;
  const h = r.height * (0.7 + Math.random() * 0.5);
  const yOffset = (Math.random() - 0.5) * r.height * 0.35;
  const el = document.createElement("div");
  el.className = "pix-rb-fx-flame";
  el.style.left = (r.left - w + 4) + "px";
  el.style.top = (r.top + (r.height - h) / 2 + yOffset) + "px";
  el.style.width = w + "px";
  el.style.height = h + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function spawnFlame(button) {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => spawnFlamePuff(button), i * 55);
  }
}

function spawnExhaustPuff(button) {
  const r = button.getBoundingClientRect();
  const w = r.width * (0.45 + Math.random() * 0.3);
  const h = 45 + Math.random() * 25;
  const xOffset = (Math.random() - 0.5) * r.width * 0.22;
  const el = document.createElement("div");
  el.className = "pix-rb-fx-exhaust";
  el.style.left = (r.left + (r.width - w) / 2 + xOffset) + "px";
  el.style.top = (r.bottom - 4) + "px";
  el.style.width = w + "px";
  el.style.height = h + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 750);
}

function spawnExhaust(button) {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => spawnExhaustPuff(button), i * 55);
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

function perimeterPoint(d, bw, bh, pad) {
  if (d < bw) {
    return { x: pad + d, y: pad, nx: 0, ny: -1 };
  }
  if (d < bw + bh) {
    return { x: pad + bw, y: pad + (d - bw), nx: 1, ny: 0 };
  }
  if (d < 2 * bw + bh) {
    return { x: pad + bw - (d - bw - bh), y: pad + bh, nx: 0, ny: 1 };
  }
  return { x: pad, y: pad + bh - (d - 2 * bw - bh), nx: -1, ny: 0 };
}

function spawnBolts(button, variant) {
  const r = button.getBoundingClientRect();
  const pad = 70;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.classList.add("pix-rb-fx-bolts", "is-" + variant);
  svg.style.left = (r.left - pad) + "px";
  svg.style.top = (r.top - pad) + "px";
  const W = r.width + pad * 2;
  const H = r.height + pad * 2;
  svg.style.width = W + "px";
  svg.style.height = H + "px";
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);

  const bw = r.width;
  const bh = r.height;
  const perim = 2 * (bw + bh);

  const boltCount = 7 + Math.floor(Math.random() * 3);
  const slot = perim / boltCount;
  for (let i = 0; i < boltCount; i++) {
    const d = (i + 0.5) * slot + (Math.random() - 0.5) * slot * 0.8;
    const start = perimeterPoint(d, bw, bh, pad);
    const baseAngle = Math.atan2(start.ny, start.nx);
    const angle = baseAngle + (Math.random() - 0.5) * 1.0;
    const length = 26 + Math.random() * 28;
    const ex = start.x + Math.cos(angle) * length;
    const ey = start.y + Math.sin(angle) * length;
    const main = jaggedBoltPoints(start.x, start.y, ex, ey, 5, 6);
    const poly = document.createElementNS(svgNS, "polyline");
    poly.setAttribute("points", pointsToAttr(main));
    poly.style.animationDelay = (i * 18) + "ms";
    svg.appendChild(poly);

    if (Math.random() > 0.5) {
      const split = Math.floor(main.length * (0.35 + Math.random() * 0.35));
      const bx = main[split][0];
      const by = main[split][1];
      const bAngle = angle + (Math.random() - 0.5) * 1.4;
      const bLen = 11 + Math.random() * 14;
      const branch = jaggedBoltPoints(
        bx, by,
        bx + Math.cos(bAngle) * bLen,
        by + Math.sin(bAngle) * bLen,
        3, 5,
      );
      const bPoly = document.createElementNS(svgNS, "polyline");
      bPoly.setAttribute("points", pointsToAttr(branch));
      bPoly.style.animationDelay = (i * 18 + 30) + "ms";
      bPoly.style.strokeWidth = "1.3";
      svg.appendChild(bPoly);
    }

    const endForkCount = 1 + Math.floor(Math.random() * 3);
    for (let j = 0; j < endForkCount; j++) {
      const fAngle = angle + (Math.random() - 0.5) * 1.6;
      const fLen = 5 + Math.random() * 9;
      const fEnd = jaggedBoltPoints(
        ex, ey,
        ex + Math.cos(fAngle) * fLen,
        ey + Math.sin(fAngle) * fLen,
        3, 3,
      );
      const fPoly = document.createElementNS(svgNS, "polyline");
      fPoly.setAttribute("points", pointsToAttr(fEnd));
      fPoly.style.animationDelay = (i * 18 + 18) + "ms";
      fPoly.style.strokeWidth = "1.1";
      svg.appendChild(fPoly);
    }
  }

  document.body.appendChild(svg);
  setTimeout(() => svg.remove(), 550);
}

function spawnSparkle(button) {
  const r = button.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "pix-rb-fx-sparkle";
  el.style.left = (r.left + Math.random() * r.width) + "px";
  el.style.top = (r.top + r.height * 0.65 + Math.random() * 6) + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

function spawnSparkleBurst(button) {
  const r = button.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const count = 16;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
    const dist = 40 + Math.random() * 25;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const el = document.createElement("div");
    el.className = "pix-rb-fx-sparkleburst";
    el.style.left = cx + "px";
    el.style.top = cy + "px";
    el.style.setProperty("--dx", dx + "px");
    el.style.setProperty("--dy", dy + "px");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
}

function attachIgnition(button) {
  const handler = () => spawnFlame(button);
  button.addEventListener("click", handler);
  return () => button.removeEventListener("click", handler);
}

function attachBolts(button, variant) {
  const handler = () => spawnBolts(button, variant);
  button.addEventListener("click", handler);
  return () => button.removeEventListener("click", handler);
}

function spawnShockwave(button) {
  const r = button.getBoundingClientRect();
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      const el = document.createElement("div");
      el.className = "pix-rb-fx-ring";
      el.style.left = r.left + "px";
      el.style.top = r.top + "px";
      el.style.width = r.width + "px";
      el.style.height = r.height + "px";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 800);
    }, i * 130);
  }
}

function attachShockwave(button) {
  const handler = () => spawnShockwave(button);
  button.addEventListener("click", handler);
  return () => button.removeEventListener("click", handler);
}


function attachSparkle(button) {
  const id = setInterval(() => {
    if (button.isConnected) spawnSparkle(button);
  }, 550);
  const clickHandler = () => spawnSparkleBurst(button);
  button.addEventListener("click", clickHandler);
  return () => {
    clearInterval(id);
    button.removeEventListener("click", clickHandler);
  };
}

function attachRocket(button) {
  const handler = () => {
    button.classList.remove("pix-rb-rocket-shake");
    void button.offsetWidth;
    button.classList.add("pix-rb-rocket-shake");
    setTimeout(() => button.classList.remove("pix-rb-rocket-shake"), 440);
    spawnExhaust(button);
  };
  button.addEventListener("click", handler);
  return () => {
    button.removeEventListener("click", handler);
    button.classList.remove("pix-rb-rocket-shake");
  };
}

function clearButtonStyling(button) {
  if (!button) return;
  for (const cls of FX_CLASSES) button.classList.remove(cls);
}

function applyFx(button, fx) {
  cleanupCurrent();
  cleanupCurrent = () => {};
  clearButtonStyling(button);

  switch (fx) {
    case "Pixaroma Orange":
      button.classList.add("pix-rb-orange");
      break;
    case "Ignition":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachIgnition(button);
      break;
    case "Sparkle":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachSparkle(button);
      break;
    case "Thor":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachBolts(button, "thor");
      break;
    case "Flash":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachBolts(button, "flash");
      break;
    case "Rocket":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachRocket(button);
      break;
    case "Shockwave":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachShockwave(button);
      break;
    default:
      break;
  }
}

function checkButton() {
  if (currentButton && document.body.contains(currentButton)) return;
  const btn = findRunButton();
  if (!btn) return;
  currentButton = btn;
  applyFx(btn, currentFx);
}

function scheduleCheck() {
  if (pendingCheck) return;
  pendingCheck = true;
  requestAnimationFrame(() => {
    pendingCheck = false;
    checkButton();
  });
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(scheduleCheck);
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  cleanupCurrent();
  cleanupCurrent = () => {};
  clearButtonStyling(currentButton);
  currentButton = null;
}

function onFxChange(v) {
  currentFx = v || "None";
  if (currentFx === "None") {
    stopObserver();
    return;
  }
  injectCSS();
  if (currentButton && document.body.contains(currentButton)) {
    applyFx(currentButton, currentFx);
  } else {
    currentButton = null;
  }
  startObserver();
  checkButton();
}

app.registerExtension({
  name: "Pixaroma.RunButtonFX",
  settings: [
    {
      id: "Pixaroma.RunButton.FX",
      name: "Run Button FX",
      type: "combo",
      defaultValue: "None",
      options: FX_OPTIONS,
      tooltip: "Visual effect for the Run button. Pure visuals - never blocks queueing.",
      category: ["👑 Pixaroma", "Run Button"],
      onChange: onFxChange,
    },
  ],
  async setup() {
    const v = app.ui.settings.getSettingValue("Pixaroma.RunButton.FX") || "None";
    currentFx = v;
    if (currentFx !== "None") {
      injectCSS();
      startObserver();
      checkButton();
    }
  },
});
