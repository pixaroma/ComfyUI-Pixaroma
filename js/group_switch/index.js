import { app } from "/scripts/app.js";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installResizeFloor, measureRootContent } from "../shared/resize_floor.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Group Switch Pixaroma — on/off switches for Pixaroma Groups           ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// A compact, frontend-only control node: it lists the Pixaroma Groups you
// choose and gives each one an on/off switch that mutes or bypasses every node
// in that group. It talks to the group system ONLY through the
// window.PixaromaPixGroup bridge (js/pixgroup), reading the LIVE group state so
// it stays in sync with the group's own header buttons and with other switches.
//
// • The node body is just the switches (small). Everything else (Mute vs
//   Bypass, which groups, the switching rule) lives in a floating settings
//   panel opened from the gear or the node's right-click menu.
// • State is stored on node.properties.groupSwitchState — serialized natively
//   into the workflow, restored on load. The node never executes in Python.

const BRAND = "#f66744";
const NODE_NAME = "PixaromaGroupSwitch";
const STATE_PROP = "groupSwitchState";
const NODE_W = 250;        // default body width (resizable; long names ellipsis-clip)
const MIN_BODY = 44;       // floor so an unmeasured/empty body never collapses

const DEFAULT_STATE = {
  version: 1,
  action: "mute",          // "mute" | "bypass"
  scope: "all",            // "all" | "pick"
  picked: [],              // group ids (scope === "pick")
  sort: "position",        // "position" | "name" | "color"
  restriction: "any",      // "any" | "one" | "always"
};

// ── tiny inline icons (currentColor) ──────────────────────────────────────
const GEAR_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>';
const LOC_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"></circle><line x1="12" y1="2" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="22"></line><line x1="2" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="22" y2="12"></line></svg>';

// ── DOM helpers ───────────────────────────────────────────────────────────
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function bridge() { return window.PixaromaPixGroup || null; }

// ── state ─────────────────────────────────────────────────────────────────
function readState(node) {
  const s = node.properties && node.properties[STATE_PROP];
  return { ...DEFAULT_STATE, ...(s && typeof s === "object" ? s : {}) };
}
function writeState(node, patch) {
  const next = { ...readState(node), ...patch };
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = next;
  return next;
}

// ── group resolution (decorate with dup-name numbers, sort, scope) ─────────
// Numbering is computed in the BASE (canvas/position) order so a group's number
// is stable no matter how the list is sorted.
function decoratedGroups(node) {
  const b = bridge();
  if (!b || !b.listGroups) return [];
  const st = readState(node);
  let groups = b.listGroups() || [];
  const nameCount = {};
  for (const g of groups) nameCount[g.title] = (nameCount[g.title] || 0) + 1;
  const seen = {};
  groups = groups.map((g) => {
    let num = 0;
    if (nameCount[g.title] > 1) { seen[g.title] = (seen[g.title] || 0) + 1; num = seen[g.title]; }
    return { id: g.id, title: g.title, color: g.color, num, label: num ? g.title + " " + num : g.title };
  });
  if (st.sort === "name") groups.sort((a, b2) => a.label.localeCompare(b2.label));
  else if (st.sort === "color") groups.sort((a, b2) => (a.color || "").localeCompare(b2.color || "") || a.label.localeCompare(b2.label));
  return groups;
}
function visibleGroups(node) {
  const st = readState(node);
  const all = decoratedGroups(node);
  if (st.scope !== "pick") return all;
  const set = new Set(st.picked || []);
  return all.filter((g) => set.has(g.id));
}

// Is a group "on" for this switch's action? (on = NOT muted, or NOT bypassed).
function isOn(node, g) {
  const st = readState(node);
  const state = bridge() && bridge().getGroupState ? bridge().getGroupState(g.id) : null;
  if (!state) return true;
  return st.action === "bypass" ? !state.bypassed : !state.muted;
}

// Flip a group, honoring the switching rule across the groups this switch owns.
function toggleGroup(node, g) {
  const b = bridge();
  if (!b || !b.setGroupSwitch) return;
  const st = readState(node);
  const willOn = !isOn(node, g);
  if (st.restriction === "any") {
    b.setGroupSwitch(g.id, willOn, st.action);
  } else if (willOn) {
    // one / always → turning one on turns every other controlled group off
    for (const o of visibleGroups(node)) b.setGroupSwitch(o.id, o.id === g.id, st.action);
  } else {
    if (st.restriction === "always") {
      const onCount = visibleGroups(node).filter((o) => isOn(node, o)).length;
      if (onCount <= 1) return; // keep at least one on
    }
    b.setGroupSwitch(g.id, false, st.action);
  }
  renderNode(node);
}

// When the rule changes to one/always, normalize the current on-set once.
function enforceRestriction(node) {
  const st = readState(node);
  if (st.restriction === "any") return;
  const b = bridge();
  if (!b || !b.setGroupSwitch) return;
  const groups = visibleGroups(node);
  const onGroups = groups.filter((g) => isOn(node, g));
  if (onGroups.length > 1) for (let i = 1; i < onGroups.length; i++) b.setGroupSwitch(onGroups[i].id, false, st.action);
  else if (st.restriction === "always" && onGroups.length === 0 && groups.length) b.setGroupSwitch(groups[0].id, true, st.action);
}

// ── node body render (just the switches) ───────────────────────────────────
function measureGsHeight(root) {
  return Math.max(MIN_BODY, Math.round(measureRootContent(root) / 4) * 4);
}
function refreshNodeSize(node) {
  if (isVueNodes()) return;       // Vue sizes via computeLayoutSize
  if (isGraphLoading()) return;   // never resize on the load path (dirty-on-load, Vue Compat #18)
  requestAnimationFrame(() => {
    try { if (!isGraphLoading() && typeof node.setSize === "function") node.setSize([node.size[0], node.computeSize()[1]]); } catch (_e) {}
  });
}

function rowEl(node, g) {
  const row = el("div", "pix-gs-row");
  const dot = el("span", "pix-gs-dot"); dot.style.background = g.color || "#888";
  const name = el("span", "pix-gs-name"); name.textContent = g.title; name.title = g.label;
  row.appendChild(dot); row.appendChild(name);
  if (g.num) { const num = el("span", "pix-gs-num"); num.textContent = String(g.num); row.appendChild(num); }
  const on = isOn(node, g);
  const tog = el("span", "pix-gs-tog" + (on ? " on" : ""));
  tog.appendChild(el("span", "k"));
  tog.onpointerdown = (e) => e.stopPropagation();
  tog.onclick = (e) => { e.stopPropagation(); toggleGroup(node, g); };
  row.appendChild(tog);
  return row;
}

function renderNode(node) {
  const root = node._pixGsRoot;
  if (!root) return;
  const st = readState(node);
  const groups = visibleGroups(node);
  // Skip a rebuild when nothing the body shows has changed — keeps the 350ms
  // sync poll from churning the DOM (flicker + lost hover) every tick.
  const sig = JSON.stringify({
    a: st.action, sc: st.scope, so: st.sort, r: st.restriction,
    has: !!(bridge() && bridge().listGroups),
    g: groups.map((g) => [g.id, g.label, g.color, isOn(node, g) ? 1 : 0]),
  });
  if (root._pixGsSig === sig) return;
  root._pixGsSig = sig;
  root.innerHTML = "";

  const top = el("div", "pix-gs-top");
  const tag = el("div", "pix-gs-tag"); tag.textContent = st.action === "bypass" ? "Bypass" : "Mute";
  const gear = el("button", "pix-gs-gear"); gear.innerHTML = GEAR_SVG; gear.title = "Settings";
  gear.onpointerdown = (e) => e.stopPropagation();
  gear.onclick = (e) => { e.stopPropagation(); openPanel(node, e); };
  top.appendChild(tag); top.appendChild(gear);
  root.appendChild(top);

  const list = el("div", "pix-gs-list");
  if (!bridge() || !bridge().listGroups) {
    const h = el("div", "pix-gs-hint"); h.textContent = "Pixaroma groups are not available.";
    list.appendChild(h);
  } else if (!groups.length) {
    const all = decoratedGroups(node);
    const h = el("div", "pix-gs-hint");
    h.textContent = all.length ? "No groups picked. Open settings to choose." : "No Pixaroma groups yet. Add one on the canvas.";
    list.appendChild(h);
  } else {
    for (const g of groups) list.appendChild(rowEl(node, g));
  }
  root.appendChild(list);
  refreshNodeSize(node);
}

// ── settings panel (floating, draggable) ───────────────────────────────────
let _panel = null, _panelNode = null;

function section(title) {
  const s = el("div", "pix-gs-sect");
  const h = el("div", "pix-gs-sh"); h.textContent = title; s.appendChild(h);
  return s;
}
function segmented(options, current, onPick) {
  const seg = el("div", "pix-gs-seg");
  for (const o of options) {
    const b = el("div", "pix-gs-sg" + (o.v === current ? " on" : ""));
    b.textContent = o.label;
    b.onclick = () => { if (o.v !== current) onPick(o.v); };
    seg.appendChild(b);
  }
  return seg;
}
function radio(label, on, onPick) {
  const r = el("label", "pix-gs-radio" + (on ? " on" : ""));
  const rc = el("span", "pix-gs-rc"); rc.appendChild(el("span", "ri"));
  const t = el("span"); t.textContent = label;
  r.appendChild(rc); r.appendChild(t);
  r.onclick = onPick;
  return r;
}

function buildPickArea(node, body) {
  const wrap = el("div", "pix-gs-pickwrap");
  const st = readState(node);

  const search = el("div", "pix-gs-search");
  const sicon = el("span", "pix-gs-sicon"); sicon.innerHTML = SEARCH_SVG; search.appendChild(sicon);
  const inp = el("input"); inp.placeholder = "Search groups..."; inp.value = node._pixGsQuery || "";
  inp.addEventListener("keydown", (e) => e.stopPropagation());
  search.appendChild(inp);
  wrap.appendChild(search);

  const sortRow = el("div", "pix-gs-sortrow");
  const lab = el("span", "pix-gs-sortlab"); lab.textContent = "Sort";
  const chip = el("button", "pix-gs-sortchip");
  const SORTLBL = { position: "Position", name: "Name", color: "Color" };
  chip.textContent = SORTLBL[st.sort] || "Position";
  chip.onclick = () => {
    const order = ["position", "name", "color"];
    writeState(node, { sort: order[(order.indexOf(readState(node).sort) + 1) % order.length] });
    renderNode(node); renderPanelBody(node, body);
  };
  sortRow.appendChild(lab); sortRow.appendChild(chip);
  wrap.appendChild(sortRow);

  const listEl = el("div", "pix-gs-picklist");
  wrap.appendChild(listEl);
  const renderList = () => {
    listEl.innerHTML = "";
    const q = (node._pixGsQuery || "").toLowerCase();
    const all = decoratedGroups(node);
    const picked = new Set(readState(node).picked || []);
    const shown = all.filter((g) => !q || g.label.toLowerCase().indexOf(q) >= 0);
    if (!shown.length) {
      const h = el("div", "pix-gs-phint"); h.textContent = all.length ? "No groups match." : "No Pixaroma groups yet.";
      listEl.appendChild(h); return;
    }
    for (const g of shown) {
      const ck = el("label", "pix-gs-ck");
      const box = el("span", "pix-gs-cbx" + (picked.has(g.id) ? " tk" : ""));
      if (picked.has(g.id)) box.textContent = "✓";
      const nm = el("span", "pix-gs-cnm"); nm.textContent = g.title; nm.title = g.label;
      ck.appendChild(box); ck.appendChild(nm);
      if (g.num) { const num = el("span", "pix-gs-num"); num.textContent = String(g.num); ck.appendChild(num); }
      const loc = el("span", "pix-gs-loc"); loc.innerHTML = LOC_SVG; loc.title = "Show on canvas";
      loc.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (bridge() && bridge().revealGroup) bridge().revealGroup(g.id); };
      ck.appendChild(loc);
      const dot = el("span", "pix-gs-dot"); dot.style.background = g.color || "#888";
      ck.appendChild(dot);
      ck.onclick = (e) => {
        if (e.target === loc || loc.contains(e.target)) return;
        const set = new Set(readState(node).picked || []);
        if (set.has(g.id)) set.delete(g.id); else set.add(g.id);
        writeState(node, { picked: [...set] });
        renderNode(node); renderList();
      };
      listEl.appendChild(ck);
    }
  };
  inp.addEventListener("input", () => { node._pixGsQuery = inp.value; renderList(); });
  renderList();
  return wrap;
}

function renderPanelBody(node, body) {
  body.innerHTML = "";
  const st = readState(node);

  const aSec = section("Action");
  aSec.appendChild(segmented(
    [{ v: "mute", label: "Mute" }, { v: "bypass", label: "Bypass" }],
    st.action,
    (v) => { writeState(node, { action: v }); renderNode(node); renderPanelBody(node, body); }
  ));
  body.appendChild(aSec);

  const gSec = section("Groups in this switch");
  gSec.appendChild(segmented(
    [{ v: "all", label: "All" }, { v: "pick", label: "Pick" }],
    st.scope,
    (v) => { writeState(node, { scope: v }); renderNode(node); renderPanelBody(node, body); }
  ));
  if (st.scope === "pick") {
    gSec.appendChild(buildPickArea(node, body));
  } else {
    const hint = el("div", "pix-gs-phint"); hint.textContent = "Every Pixaroma group. New groups join automatically.";
    gSec.appendChild(hint);
  }
  body.appendChild(gSec);

  const sSec = section("Switching");
  const rules = [
    { v: "any", label: "Any number on" },
    { v: "one", label: "Only one on at a time" },
    { v: "always", label: "Always keep one on" },
  ];
  for (const r of rules) {
    sSec.appendChild(radio(r.label, st.restriction === r.v, () => {
      writeState(node, { restriction: r.v });
      enforceRestriction(node);
      renderNode(node); renderPanelBody(node, body);
    }));
  }
  body.appendChild(sSec);
}

function positionPanel(panel, ev) {
  const pad = 10, w = panel.offsetWidth, h = panel.offsetHeight;
  let x = (ev && ev.clientX != null ? ev.clientX + 14 : window.innerWidth / 2 - w / 2);
  let y = (ev && ev.clientY != null ? ev.clientY - 8 : 90);
  x = Math.max(pad, Math.min(x, window.innerWidth - w - pad));
  y = Math.max(pad, Math.min(y, window.innerHeight - h - pad));
  panel.style.left = x + "px";
  panel.style.top = y + "px";
}
function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pix-gs-px")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
}
function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest && e.target.closest(".pix-gs-gear")) return; // gear toggles its own panel
  closePanel();
}
function escClose(e) { if (e.key === "Escape" && _panel) { e.stopPropagation(); closePanel(); } }
function closePanel() {
  if (_panel) { try { _panel.remove(); } catch (_e) {} }
  _panel = null; _panelNode = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}
function openPanel(node, ev) {
  closePanel();
  injectCSS();
  const panel = el("div", "pix-gs-panel");
  _panel = panel; _panelNode = node;
  const head = el("div", "pix-gs-phead");
  const ttl = el("span"); ttl.textContent = "Group Switch — settings";
  const x = el("button", "pix-gs-px"); x.textContent = "✕"; x.onclick = closePanel;
  head.appendChild(ttl); head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head);
  const body = el("div", "pix-gs-pbody");
  panel.appendChild(body);
  renderPanelBody(node, body);
  document.body.appendChild(panel);
  positionPanel(panel, ev);
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
}

// ── CSS (no backticks inside this template literal — convention) ───────────
let _cssDone = false;
function injectCSS() {
  if (_cssDone || document.getElementById("pix-gs-css")) { _cssDone = true; return; }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-gs-css";
  s.textContent = [
    ".pix-gs-root{font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;padding:2px 0;box-sizing:border-box;}",
    ".pix-gs-top{display:flex;align-items:center;gap:8px;padding:4px 8px 6px;}",
    ".pix-gs-tag{font-size:11px;padding:2px 8px;border-radius:5px;background:rgba(246,103,68,0.18);color:#f99877;}",
    ".pix-gs-gear{margin-left:auto;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;background:transparent;color:rgba(255,255,255,0.5);cursor:pointer;border-radius:5px;padding:0;}",
    ".pix-gs-gear:hover{color:#f66744;background:rgba(255,255,255,0.06);}",
    ".pix-gs-list{display:flex;flex-direction:column;gap:1px;padding:0 5px 4px;}",
    ".pix-gs-row{display:flex;align-items:center;gap:9px;padding:6px 7px;border-radius:6px;}",
    ".pix-gs-row:hover{background:rgba(255,255,255,0.04);}",
    ".pix-gs-dot{width:9px;height:9px;border-radius:50%;flex:none;}",
    ".pix-gs-name{flex:1;font-size:13px;color:#dadada;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".pix-gs-num{font-size:10.5px;color:rgba(255,255,255,0.5);background:rgba(255,255,255,0.08);border-radius:4px;padding:1px 5px;flex:none;}",
    ".pix-gs-tog{width:34px;height:18px;border-radius:9px;background:rgba(255,255,255,0.16);position:relative;cursor:pointer;flex:none;transition:background .15s;}",
    ".pix-gs-tog .k{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#c8c8c8;transition:left .15s,background .15s;}",
    ".pix-gs-tog.on{background:#f66744;}",
    ".pix-gs-tog.on .k{left:18px;background:#fff;}",
    ".pix-gs-hint{font-size:11.5px;color:rgba(255,255,255,0.42);padding:8px;line-height:1.5;text-align:center;}",
    ".pix-gs-panel{position:fixed;z-index:10010;width:320px;max-width:94vw;background:#232325;border:1px solid rgba(255,255,255,0.14);border-radius:11px;box-shadow:0 10px 34px rgba(0,0,0,0.5);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;}",
    ".pix-gs-phead{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid rgba(255,255,255,0.08);color:#fff;font-size:13px;font-weight:500;cursor:move;}",
    ".pix-gs-px{border:0;background:transparent;color:rgba(255,255,255,0.5);font-size:13px;cursor:pointer;padding:2px 7px;border-radius:5px;}",
    ".pix-gs-px:hover{color:#fff;background:rgba(255,255,255,0.08);}",
    ".pix-gs-pbody{max-height:70vh;overflow-y:auto;}",
    ".pix-gs-sect{padding:12px 13px;border-bottom:1px solid rgba(255,255,255,0.06);}",
    ".pix-gs-sect:last-child{border-bottom:0;}",
    ".pix-gs-sh{font-size:11px;color:rgba(255,255,255,0.42);margin-bottom:8px;}",
    ".pix-gs-seg{display:flex;background:rgba(0,0,0,0.3);border-radius:7px;padding:2px;}",
    ".pix-gs-sg{flex:1;text-align:center;color:rgba(255,255,255,0.66);font-size:12px;padding:6px 0;border-radius:5px;cursor:pointer;user-select:none;}",
    ".pix-gs-sg.on{background:#f66744;color:#fff;}",
    ".pix-gs-phint{font-size:11.5px;color:rgba(255,255,255,0.42);margin-top:8px;line-height:1.5;}",
    ".pix-gs-search{display:flex;align-items:center;gap:7px;background:#1c1c1e;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:7px 9px;margin:9px 0 8px;}",
    ".pix-gs-sicon{color:rgba(255,255,255,0.35);display:flex;}",
    ".pix-gs-search input{flex:1;background:transparent;border:0;outline:0;color:#e6e6e6;font-size:12.5px;font-family:inherit;min-width:0;padding:0;}",
    ".pix-gs-search input::placeholder{color:rgba(255,255,255,0.32);}",
    ".pix-gs-sortrow{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;}",
    ".pix-gs-sortlab{font-size:11px;color:rgba(255,255,255,0.4);}",
    ".pix-gs-sortchip{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:#dcdcdc;font-size:11.5px;padding:4px 10px;border-radius:6px;cursor:pointer;}",
    ".pix-gs-sortchip:hover{border-color:#f66744;}",
    ".pix-gs-picklist{max-height:168px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;}",
    ".pix-gs-ck{display:flex;align-items:center;gap:9px;padding:6px 4px;font-size:12.5px;color:#d3d3d3;cursor:pointer;border-radius:5px;}",
    ".pix-gs-ck:hover{background:rgba(255,255,255,0.04);}",
    ".pix-gs-cbx{width:14px;height:14px;border-radius:4px;border:1px solid rgba(255,255,255,0.3);flex:none;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;}",
    ".pix-gs-cbx.tk{background:#f66744;border-color:#f66744;}",
    ".pix-gs-cnm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".pix-gs-loc{color:rgba(255,255,255,0);cursor:pointer;display:flex;transition:color .12s;}",
    ".pix-gs-ck:hover .pix-gs-loc{color:rgba(255,255,255,0.4);}",
    ".pix-gs-loc:hover{color:#f66744;}",
    ".pix-gs-radio{display:flex;align-items:center;gap:9px;padding:6px 2px;font-size:12.5px;color:#d5d5d5;cursor:pointer;user-select:none;}",
    ".pix-gs-rc{width:15px;height:15px;border-radius:50%;border:1px solid rgba(255,255,255,0.32);flex:none;display:flex;align-items:center;justify-content:center;}",
    ".pix-gs-rc .ri{width:7px;height:7px;border-radius:50%;background:#f66744;display:none;}",
    ".pix-gs-radio.on .pix-gs-rc{border-color:#f66744;}",
    ".pix-gs-radio.on .pix-gs-rc .ri{display:block;}",
  ].join("\n");
  (document.head || document.documentElement).appendChild(s);
}

// ── live sync: re-render every Group Switch from the live group state ──────
let _pollStarted = false;
function startPoll() {
  if (_pollStarted) return;
  _pollStarted = true;
  setInterval(() => {
    try {
      const nodes = app.graph && app.graph._nodes ? app.graph._nodes : [];
      for (const n of nodes) {
        if ((n.comfyClass === NODE_NAME || n.type === NODE_NAME) && n._pixGsRoot) renderNode(n);
      }
    } catch (_e) {}
  }, 350);
}

// ── node lifecycle ─────────────────────────────────────────────────────────
function setupNode(node) {
  injectCSS();
  const root = el("div", "pix-gs-root");
  const widget = node.addDOMWidget("group_switch_ui", "pixaroma_group_switch", root, {
    getValue: () => readState(node),
    setValue: () => {},
    getMinHeight: () => measureGsHeight(root),
    serialize: false, // state lives on node.properties
  });
  applyAdaptiveCanvasOnly(widget);
  widget.computeLayoutSize = () => ({ minHeight: measureGsHeight(root), minWidth: 1 });
  node._pixGsRoot = root;
  node._pixGsFloorOff = installResizeFloor(root, (r) => measureRootContent(r));
  if (Array.isArray(node.size)) { if (node.size[0] < NODE_W) node.size[0] = NODE_W; }
  else node.size = [NODE_W, 120];
  // nodeCreated fires BEFORE configure() restores node.properties (Vue Compat #8) —
  // defer the first render so a saved switch shows its restored state, not defaults.
  queueMicrotask(() => renderNode(node));
  startPoll();
}

const HELP = {
  title: "Group Switch Pixaroma",
  tagline: "On/off switches for your Pixaroma Groups, in one small panel.",
  sections: [
    { heading: "What it does", body: "Each switch turns a whole Pixaroma Group on or off by muting or bypassing every node inside it. Flip a switch and that section of your workflow stops running, without unplugging a single wire." },
    { heading: "The switches", body: "The node body is just the switches. A small tag in the corner shows whether this one mutes or bypasses. The colored dot and name (plus a number when two groups share a name) tell the groups apart." },
    { heading: "Settings (the gear, or right-click)", defs: [
      ["Action", "Make this switch a Mute or a Bypass. For both, drop two switches."],
      ["Groups", "Control all groups, or Pick a hand-picked set. Search and sort (by canvas position, name, or color) to find them. The locate icon flashes a group on the canvas."],
      ["Switching", "Any number on, only one on at a time, or always keep one on."],
    ]},
    { heading: "Stays in sync", body: "Switches read and set the live group state, so this node, a second copy, and the group's own header Mute/Bypass button always agree." },
  ],
};

app.registerExtension({
  name: "Pixaroma.GroupSwitch",

  getNodeMenuItems(node) {
    if (!node || node.comfyClass !== NODE_NAME) return [];
    return [null, { content: "⚙ Group Switch settings", callback: () => openPanel(node, null) }];
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure ? _origConfigure.apply(this, arguments) : undefined;
      if (this._pixGsRoot) { this._pixGsRoot._pixGsSig = null; renderNode(this); }
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try { if (this._pixGsFloorOff) this._pixGsFloorOff(); } catch (_e) {}
      this._pixGsFloorOff = null;
      if (_panelNode === this) closePanel();
      if (_origRemoved) return _origRemoved.apply(this, arguments);
    };
    // No onResize override: the body height is content-driven via getMinHeight /
    // computeLayoutSize, and width is freely resizable for long group names.
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_NAME) return;
    setupNode(node);
  },
});

registerNodeHelp(NODE_NAME, HELP);
