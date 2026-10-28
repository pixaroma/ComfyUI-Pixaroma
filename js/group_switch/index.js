import { app } from "../../../scripts/app.js";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { passComfyShortcut } from "../shared/text_shortcuts.mjs";
import {
  registerNodeSettings, createAccentSection, applyAccent, installNodeAccent,
} from "../shared/node_settings.mjs";
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
const NODE_W = 250;        // default body width on a fresh drop
const MIN_W = 120;         // resize floor — width shrinks to here (names then ellipsis-clip)
const MIN_BODY = 44;       // floor so an empty body never collapses

// Deterministic body-height constants — MUST match the CSS row metrics below.
// Computing the height from the ROW COUNT (known synchronously) instead of
// measuring the DOM keeps the node TIGHT (no extra space), byte-stable across
// save/load (no dirty-on-load), and free of the 1-frame "a row overflows the
// node" lag that a measure-then-rAF snap has.
const ROW_H = 30;          // .pix-gs-row total height
const ROW_GAP = 1;         // .pix-gs-list row gap
const TOP_H = 32;          // .pix-gs-top strip (mute tag + gear) — measured
const LIST_PAD = 6;        // .pix-gs-list bottom padding + a 2px hair
const ROOT_PAD = 4;        // .pix-gs-root vertical padding (2 + 2)
const HINT_H = 60;         // empty / "no groups" hint (2 lines + 10px pad + list pad)
const VUE_CHROME = 52;     // Nodes 2.0 only: node.size[1] = bodyHeight + footer
                           // chip + borders (~52, measured 248 - 196) — used to
                           // shrink-fit the node (Vue never auto-shrinks).

const DEFAULT_STATE = {
  version: 1,
  action: "bypass",        // "mute" | "bypass" — Bypass default (more common per user feedback)
  scope: "all",            // "all" | "pick"
  picked: [],              // group ids (scope === "pick")
  sort: "position",        // "position" | "name" | "color"
  restriction: "any",      // "any" | "one" | "always"
};

// ── tiny inline icons (currentColor) ──────────────────────────────────────
const GEAR_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>';
// The jump arrow, drawn by the user. Solid rather than stroked: at 13px on a node
// row a stroked arrow thins out, and the rest of assets/icons/ui is solid too.
// currentColor, so one string covers rest / hover / a switched-off row.
const JUMP_SVG = '<svg viewBox="0 0 64 64" width="13" height="13" fill="currentColor">'
  + '<path transform="translate(1.3 8.505)" d="M25.87,35.5H4.48C2.16,35.49,0,33.74,0,31.31v-14.17c0-1.98,1.9-4.24,4.01-4.25h27.57l.13-7.21c.07-3.8,3.66-6.19,7.26-5.58,2.06.35,3.27,1.61,4.66,3.02l15.97,16.25c3.13,3.18,1.8,7.7-1.13,10.45l-16.88,15.88c-1.68,1.58-4.36,1.58-6.33.71-1.73-.76-3.44-2.71-3.57-4.93-.12-1.96-.07-3.87-.09-5.86l-5.73-.1Z"/></svg>';
// Also saved as assets/icons/ui/arrow-right.svg for anything else that wants it.


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
  if (!b || typeof b.listGroups !== "function") return [];
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
  const b = bridge();
  const state = b && typeof b.getGroupState === "function" ? b.getGroupState(g.id) : null;
  if (!state) return true;
  return st.action === "bypass" ? !state.bypassed : !state.muted;
}

// Flip a group, honoring the switching rule across the groups this switch owns.
function toggleGroup(node, g) {
  const b = bridge();
  if (!b || typeof b.setGroupSwitch !== "function") return;
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

// ── All on / All off ───────────────────────────────────────────────────────
// Flip every group this switch OWNS (the rows it shows - so scope "pick" only
// touches the picked ones) in one click. Requested on Discord: a workflow whose
// layout can't put every group inside one parent group had no way to kill them
// all at once.
//
// The switching rule can make one of these impossible, and we must not silently
// produce a state the rule forbids:
//   any    - "any number on"        -> both make sense.
//   one    - "only one on at a time" -> All off is fine (zero is allowed by this
//            rule); All on would leave N on, so it is refused.
//   always - "always keep one on"   -> All off is refused (zero is exactly what
//            it forbids), and All on would leave N on, so that is refused too.
// A single group is a trivial case where both are always legal.
function canSetAll(node, on) {
  const b = bridge();
  if (!b || typeof b.setGroupSwitch !== "function") return false;
  const groups = visibleGroups(node);
  if (!groups.length) return false;
  if (groups.length <= 1) return true;
  const r = readState(node).restriction;
  return on ? r === "any" : r !== "always";
}

// Why a button is greyed out - shown as its tooltip, so the rule is discoverable
// instead of the button just looking broken.
function whyCannotSetAll(node, on) {
  const b = bridge();
  if (!b || typeof b.setGroupSwitch !== "function") return "Pixaroma groups are not available.";
  if (!visibleGroups(node).length) return "There are no groups to switch.";
  return on
    ? "The switching rule keeps only one group on at a time, so they cannot all be on. Change it under Switching in the settings."
    : "The switching rule always keeps one group on, so they cannot all be off. Change it under Switching in the settings.";
}

function setAllGroups(node, on) {
  if (!canSetAll(node, on)) return;
  const b = bridge();
  const st = readState(node);
  for (const g of visibleGroups(node)) b.setGroupSwitch(g.id, on, st.action);
  renderNode(node);
}

// When the rule changes to one/always, normalize the current on-set once.
function enforceRestriction(node) {
  const st = readState(node);
  if (st.restriction === "any") return;
  const b = bridge();
  if (!b || typeof b.setGroupSwitch !== "function") return;
  const groups = visibleGroups(node);
  const onGroups = groups.filter((g) => isOn(node, g));
  if (onGroups.length > 1) for (let i = 1; i < onGroups.length; i++) b.setGroupSwitch(onGroups[i].id, false, st.action);
  else if (st.restriction === "always" && onGroups.length === 0 && groups.length) b.setGroupSwitch(groups[0].id, true, st.action);
}

// ── node body render (just the switches) ───────────────────────────────────
function heightForRows(rows, hasBridge) {
  let h = ROOT_PAD + TOP_H;
  if (!hasBridge || rows === 0) h += HINT_H;
  else h += rows * ROW_H + Math.max(0, rows - 1) * ROW_GAP + LIST_PAD;
  return Math.max(MIN_BODY, h);
}

// ⚠️ THIS IS A PER-FRAME HOT PATH. It is what `node.computeSize` (Classic),
// `getMinHeight` and `computeLayoutSize` all return, and the renderer calls
// those while DRAWING - MEASURED at 2 calls per painted frame while the node is
// on screen, 0 when it is scrolled off or collapsed.
//
// It used to walk the groups on every one of those calls: `visibleGroups` ->
// `decoratedGroups` -> the bridge's `listGroups`, which builds an object for
// every Pixaroma AND native group, then another object each, then SORTS. At
// 60fps with 12 groups that is 120 walks and ~2900 allocations a second, for a
// number that changes only when a group is added or removed. Reported on
// Discord 2026-09-18 as "10% extra bus interface bandwidth and reduced
// generation speed, only while it is visible on screen; collapsing, removing or
// moving it off screen fixes it" - which is exactly the visible/off-screen
// split above.
//
// So it now answers from a count `renderNode` caches. That costs NOTHING in
// freshness: `refreshNodeSize` is only ever called FROM `renderNode`, so the
// node's height already moved at the 350ms poll's pace and no faster. The
// uncached walk stays as the first-call fallback, before any render has run.
function bodyHeight(node) {
  if (node && typeof node._pixGsRows === "number") {
    return heightForRows(node._pixGsRows, node._pixGsHasBridge !== false);
  }
  const b = bridge();
  const hasBridge = !!(b && typeof b.listGroups === "function");
  const rows = hasBridge ? visibleGroups(node).length : 0;
  if (node) { node._pixGsRows = rows; node._pixGsHasBridge = hasBridge; }
  return heightForRows(rows, hasBridge);
}
// The DOM widget's own minimum: the body minus where core starts it.
// ⚠️ Classic: core's _arrangeWidgets starts the widget 2px down (its `+ 2` on a
// dot-less node) and GROWS the node on EVERY draw when 2 + widget > node height.
// Asking for the whole body grew it 96 -> 98, onResize locked it back to 96, and
// the setSize queued the next frame: a resize loop at the frame rate while the
// node was on screen (found 2026-10-28 by the sweep for the Number Pick CPU
// report). Nodes 2.0 skips that grow, so it keeps the whole body.
const CLASSIC_START_Y = 2;
function widgetMinHeight(node) {
  return bodyHeight(node) - (isVueNodes() ? 0 : CLASSIC_START_Y);
}
// Snap the node to hug the body EXACTLY and SYNCHRONOUSLY (no rAF), in BOTH
// renderers. Classic: node.computeSize is overridden in setupNode to return the
// exact body height (the stock one reserves a phantom slot row + per-widget
// spacing, ~38px of dead space on this dot-less node). Nodes 2.0: the node
// auto-GROWS to content but never auto-SHRINKS, so removing groups left it tall
// with a gap above the footer — re-assert node.size = body + fixed chrome so it
// hugs on add AND remove. Never on the load path (dirty-on-load); the signature
// gate in renderNode means this only runs when the group set actually changes.
//
// A height the USER dragged is kept (Discord 2026-10-20: "doesn't remember the
// size of the node"; in Nodes 2.0 a taller drag stuck until the next switch flip
// re-ran this and snapped it back). It is stored in BODY pixels as
// `groupSwitchState.height` (0 / absent = hug the rows), so it means the same in
// both renderers. The node is never auto-sized below it: more groups still grow
// the node, fewer shrink it down to that height, not below.
function userBody(node) {
  const h = Number(readState(node).height);
  return h > 0 ? h : 0;
}
function refreshNodeSize(node) {
  if (isGraphLoading()) return;
  try {
    if (typeof node.setSize !== "function") return;
    const inner = Math.max(bodyHeight(node), userBody(node));
    const target = isVueNodes() ? inner + VUE_CHROME : inner;
    if (Math.abs((node.size[1] || 0) - target) > 1) {
      // our own resize: noteUserHeight (via onResize) must not take it for a drag
      node._pixGsSizing = true;
      try { node.setSize([node.size[0], target]); } finally { node._pixGsSizing = false; }
    }
  } catch (_e) {}
}
// Called from onResize. In Classic that fires during a corner drag; in Nodes 2.0
// core's notifyLayoutChanges calls it after a Vue-side resize (the corner handle).
// Our own setSize is flagged above and the load path is skipped (no dirty-on-load).
// A height at or below the rows means "hug" again, so dragging it back clears it.
function noteUserHeight(node) {
  if (node._pixGsSizing || isGraphLoading() || !node.graph) return;
  const body = bodyHeight(node);
  const h = Math.round((node.size?.[1] || 0) - (isVueNodes() ? VUE_CHROME : 0));
  const want = h > body + 2 ? h : 0;
  if (userBody(node) !== want) {
    writeState(node, { height: want });
    notifyGraphChanged();   // the drag's own capture may run before this write (convention #31)
  }
}

function rowEl(node, g) {
  const on = isOn(node, g);
  // The "on" class drives the name brightness (bright = enabled, dim = off) so the
  // state reads clearly without relying on the toggle colour alone (user feedback).
  const row = el("div", "pix-gs-row" + (on ? " on" : ""));
  const dot = el("span", "pix-gs-dot"); dot.style.background = g.color || "#888";
  const name = el("span", "pix-gs-name"); name.textContent = g.title; name.title = g.label;
  row.appendChild(dot); row.appendChild(name);
  if (g.num) { const num = el("span", "pix-gs-num"); num.textContent = String(g.num); row.appendChild(num); }
  // Jump to the group on the canvas. BEFORE the switch on purpose: the switch keeps
  // the position people already aim at, and a mis-hit here only moves the view, while
  // a mis-hit on the switch would mute part of the workflow.
  // It is NOT dimmed on a switched-off row and is NOT disabled there: going to look at
  // a group you just muted is a normal thing to do, and a dimmed control would read as
  // disabled and be lying.
  const jump = el("span", "pix-gs-jump");
  jump.innerHTML = JUMP_SVG;
  jump.title = "Show this group on the canvas";
  jump.onpointerdown = (e) => e.stopPropagation();
  jump.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();   // the whole row toggles; this must not
    const b = bridge();
    if (b && typeof b.revealGroup === "function") b.revealGroup(g.id);
  };
  row.appendChild(jump);
  const tog = el("span", "pix-gs-tog" + (on ? " on" : ""));
  tog.appendChild(el("span", "k"));
  tog.onpointerdown = (e) => e.stopPropagation();
  tog.onclick = (e) => { e.stopPropagation(); toggleGroup(node, g); };
  row.appendChild(tog);
  // Click ANYWHERE on the row toggles (not just the small switch) — a bigger target,
  // matches rgthree. The toggle's own onclick stopPropagation prevents a double fire.
  row.onpointerdown = (e) => e.stopPropagation(); // don't start a node drag from the row
  row.onclick = () => toggleGroup(node, g);
  return row;
}

function renderNode(node) {
  const root = node._pixGsRoot;
  if (!root) return;
  const st = readState(node);
  const b = bridge();
  const hasBridge = !!(b && typeof b.listGroups === "function");
  const groups = visibleGroups(node);
  // Feed bodyHeight's cache. Set BEFORE the signature early-return below, so the
  // count stays right even on a tick where nothing else changed - this is the
  // one place that already has the fresh number, and bodyHeight is called ~2x
  // per painted frame and must never walk the groups itself. See bodyHeight.
  node._pixGsRows = groups.length;
  node._pixGsHasBridge = hasBridge;
  // Skip a rebuild when nothing the body shows has changed — keeps the 350ms
  // sync poll from churning the DOM (flicker + lost hover) every tick.
  const sig = JSON.stringify({
    a: st.action, sc: st.scope, so: st.sort, r: st.restriction,
    has: hasBridge,
    g: groups.map((g) => [g.id, g.label, g.color, isOn(node, g) ? 1 : 0]),
  });
  if (root._pixGsSig === sig) return;
  root._pixGsSig = sig;
  root.innerHTML = "";

  const top = el("div", "pix-gs-top");
  const tag = el("div", "pix-gs-tag"); tag.textContent = st.action === "bypass" ? "Bypass" : "Mute";

  // All on / All off. Always PRESENT (greyed + explained when the switching rule
  // forbids them) rather than appearing and vanishing, so the strip never reflows
  // and the rule stays discoverable. TOP_H stays 32 - the buttons are the same
  // height as the gear, so bodyHeight() is unchanged.
  const bulk = el("div", "pix-gs-bulk");
  const mkBulk = (label, on) => {
    const ok = canSetAll(node, on);
    const btn = el("button", "pix-gs-bulkbtn" + (ok ? "" : " off"));
    btn.textContent = label;
    btn.title = ok
      ? (on ? "Turn every group in this list on." : "Turn every group in this list off.")
      : whyCannotSetAll(node, on);
    btn.disabled = !ok;
    btn.onpointerdown = (e) => e.stopPropagation();  // don't start a node drag
    btn.onclick = (e) => { e.stopPropagation(); setAllGroups(node, on); };
    return btn;
  };
  bulk.appendChild(mkBulk("All on", true));
  bulk.appendChild(mkBulk("All off", false));

  const gear = el("button", "pix-gs-gear"); gear.innerHTML = GEAR_SVG; gear.title = "Settings";
  gear.onpointerdown = (e) => e.stopPropagation();
  gear.onclick = (e) => { e.stopPropagation(); openPanel(node, e); };
  top.appendChild(tag); top.appendChild(bulk); top.appendChild(gear);
  root.appendChild(top);

  const list = el("div", "pix-gs-list");
  if (!hasBridge) {
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
  // The settings panel is a DOM overlay, so changes made in it never reach the
  // LiteGraph canvas — without an explicit repaint the node frame stays on its
  // last-painted (stale) size until a key press or canvas mouse-move. Mark the
  // canvas dirty so the frame redraws to match the new body right away.
  try { node.setDirtyCanvas(true, true); } catch (_e) {}
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
  // ComfyUI's save / run go on (UI#44); everything else stays in the search box
  inp.addEventListener("keydown", (e) => { if (passComfyShortcut(e, inp)) return; e.stopPropagation(); });
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
      const loc = el("span", "pix-gs-loc"); loc.innerHTML = JUMP_SVG; loc.title = "Show on canvas";
      loc.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const b = bridge(); if (b && typeof b.revealGroup === "function") b.revealGroup(g.id); };
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
    (v) => { writeState(node, { action: v }); enforceRestriction(node); renderNode(node); renderPanelBody(node, body); }
  ));
  body.appendChild(aSec);

  const gSec = section("Groups in this switch");
  gSec.appendChild(segmented(
    [{ v: "all", label: "All" }, { v: "pick", label: "Pick" }],
    st.scope,
    (v) => { writeState(node, { scope: v }); enforceRestriction(node); renderNode(node); renderPanelBody(node, body); }
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
  // Inside the section, not a bare sibling of it: .pix-gs-pbody has no padding
  // of its own (the sections carry it), so a sibling would sit flush against
  // the panel's edges.
  sSec.appendChild(createAccentSection(node, {
    onChange: () => { applyAccent(_panel, node); renderNode(node); },
  }));

  body.appendChild(sSec);

  // Keep the (possibly taller) panel fully on-screen after a structural change.
  requestAnimationFrame(reclampPanel);
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
// Re-clamp the panel's TOP after its body grows (switching to Pick adds the
// search + list) so the bottom never runs off-screen — no more dragging it up.
// Taller than the viewport: pin to the top and let the body scroll.
function reclampPanel() {
  if (!_panel) return;
  const pad = 10;
  const h = _panel.offsetHeight;
  let top = parseFloat(_panel.style.top) || pad;
  if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
  if (top < pad) top = pad;
  _panel.style.top = top + "px";
}
function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pix-gs-px")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    // Both defences against a LOST pointerup (convention #20, the same pair as
    // js/shared/node_panel.mjs): when the release never arrives (pointer left
    // the window, capture taken) the panel followed the cursor until a click.
    try { handle.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    let done = false;
    const move = (ev) => {
      if (!panel.isConnected) return up();
      if (!(ev.buttons & 1)) return up(); // we missed the release
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => {
      if (done) return; // idempotent: the guard above can call this too
      done = true;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      handle.removeEventListener("lostpointercapture", up);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    handle.addEventListener("lostpointercapture", up);
  });
}
function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest && e.target.closest(".pix-gs-gear")) return; // gear toggles its own panel
  if (e.target.closest && e.target.closest(".pix-cp-popup, .pix-cp-modal-backdrop")) return; // the colour picker
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
  applyAccent(panel, node);   // the panel's own toggles/chips follow the accent
  const head = el("div", "pix-gs-phead");
  const ttl = el("span"); ttl.textContent = "Group Switch settings";
  const x = el("button", "pix-gs-px"); x.textContent = "✕"; x.onclick = closePanel;
  head.appendChild(ttl); head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head);
  const body = el("div", "pix-gs-pbody");
  panel.appendChild(body);
  renderPanelBody(node, body);
  document.body.appendChild(panel);
  positionPanel(panel, ev);
  // offsetHeight can be 0 before the first layout flush, so re-clamp once the
  // panel has a real height (otherwise a tall panel can open off the bottom edge).
  requestAnimationFrame(reclampPanel);
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
    ".pix-gs-top{display:flex;align-items:center;gap:6px;padding:4px 8px 6px;}",
    // min-width:0 + ellipsis so a hand-narrowed node clips the TAG rather than
    // pushing the buttons out of the node frame.
    ".pix-gs-tag{font-size:11px;padding:2px 8px;border-radius:5px;background:color-mix(in srgb, var(--pix-acc,#f66744) 18%, transparent);color:#f99877;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    // The All on / All off pair carries the margin-left:auto (it used to be on the
    // gear), so the whole control cluster sits together on the right. The default
    // node (250) fits the strip comfortably; MIN_W stays 120, so a hand-narrowed
    // node degrades by ellipsis (tag first, then the labels) instead of pushing
    // anything outside the node frame. Raising MIN_W instead would re-widen a node
    // someone had deliberately narrowed, and could dirty their saved workflow.
    ".pix-gs-bulk{margin-left:auto;display:flex;align-items:center;gap:4px;flex:0 1 auto;min-width:0;}",
    // Adaptive surface (white overlay, never opaque dark) so it reads correctly on
    // any node colour - Pixaroma node UI convention #1. Height 22 = the gear's, so
    // the strip stays TOP_H (32) tall and bodyHeight() is unaffected.
    ".pix-gs-bulkbtn{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;height:22px;box-sizing:border-box;padding:0 7px;font:11px 'Segoe UI',system-ui,sans-serif;border-radius:5px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.72);cursor:pointer;white-space:nowrap;}",
    ".pix-gs-bulkbtn:hover{border-color:var(--pix-acc,#f66744);background:var(--pix-acc,#f66744);color:#fff;}",
    // Greyed, not hidden - the tooltip says WHY (the switching rule forbids it).
    ".pix-gs-bulkbtn.off,.pix-gs-bulkbtn.off:hover{opacity:0.35;cursor:default;border-color:rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.72);}",
    ".pix-gs-gear{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;background:transparent;color:rgba(255,255,255,0.5);cursor:pointer;border-radius:5px;padding:0;flex:0 0 auto;}",
    ".pix-gs-gear:hover{color:var(--pix-acc,#f66744);background:rgba(255,255,255,0.06);}",
    ".pix-gs-list{display:flex;flex-direction:column;gap:1px;padding:0 5px 4px;}",
    ".pix-gs-row{display:flex;align-items:center;gap:9px;padding:6px 7px;border-radius:6px;cursor:pointer;}",
    ".pix-gs-row:hover{background:rgba(255,255,255,0.04);}",
    ".pix-gs-dot{width:9px;height:9px;border-radius:50%;flex:none;}",
    ".pix-gs-name{flex:1;font-size:13px;color:#8a8a8a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".pix-gs-row.on .pix-gs-name{color:#fff;}",
    ".pix-gs-num{font-size:10.5px;color:rgba(255,255,255,0.5);background:rgba(255,255,255,0.08);border-radius:4px;padding:1px 5px;flex:none;}",
    ".pix-gs-tog{width:34px;height:18px;border-radius:9px;background:rgba(255,255,255,0.16);position:relative;cursor:pointer;flex:none;transition:background .15s;}",
    ".pix-gs-tog .k{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#c8c8c8;transition:left .15s,background .15s;}",
    ".pix-gs-tog.on{background:var(--pix-acc,#f66744);}",
    ".pix-gs-tog.on .k{left:18px;background:#fff;}",
    ".pix-gs-hint{font-size:11.5px;color:rgba(255,255,255,0.42);padding:10px 16px;line-height:1.5;text-align:center;}",
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
    ".pix-gs-sg.on{background:var(--pix-acc,#f66744);color:#fff;}",
    ".pix-gs-phint{font-size:11.5px;color:rgba(255,255,255,0.42);margin-top:8px;line-height:1.5;}",
    ".pix-gs-search{display:flex;align-items:center;gap:7px;background:#1c1c1e;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:7px 9px;margin:9px 0 8px;}",
    ".pix-gs-sicon{color:rgba(255,255,255,0.35);display:flex;}",
    ".pix-gs-search input{flex:1;background:transparent;border:0;outline:0;color:#e6e6e6;font-size:12.5px;font-family:inherit;min-width:0;padding:0;}",
    ".pix-gs-search input::placeholder{color:rgba(255,255,255,0.32);}",
    ".pix-gs-sortrow{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;}",
    ".pix-gs-sortlab{font-size:11px;color:rgba(255,255,255,0.4);}",
    ".pix-gs-sortchip{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:#dcdcdc;font-size:11.5px;padding:4px 10px;border-radius:6px;cursor:pointer;}",
    ".pix-gs-sortchip:hover{border-color:var(--pix-acc,#f66744);}",
    ".pix-gs-picklist{max-height:168px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;}",
    ".pix-gs-ck{display:flex;align-items:center;gap:9px;padding:6px 4px;font-size:12.5px;color:#d3d3d3;cursor:pointer;border-radius:5px;}",
    ".pix-gs-ck:hover{background:rgba(255,255,255,0.04);}",
    ".pix-gs-cbx{width:14px;height:14px;border-radius:4px;border:1px solid rgba(255,255,255,0.3);flex:none;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;}",
    ".pix-gs-cbx.tk{background:var(--pix-acc,#f66744);border-color:var(--pix-acc,#f66744);}",
    ".pix-gs-cnm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".pix-gs-jump{color:#9a9a9a;cursor:pointer;display:flex;align-items:center;flex:none;transition:color .12s;}",
    // deliberately NOT dimmed by .pix-gs-row.off - see rowEl
    ".pix-gs-jump:hover{color:var(--pix-acc,#f66744);}",
    ".pix-gs-loc{color:rgba(255,255,255,0);cursor:pointer;display:flex;transition:color .12s;}",
    ".pix-gs-ck:hover .pix-gs-loc{color:rgba(255,255,255,0.4);}",
    ".pix-gs-loc:hover{color:var(--pix-acc,#f66744);}",
    ".pix-gs-radio{display:flex;align-items:center;gap:9px;padding:6px 2px;font-size:12.5px;color:#d5d5d5;cursor:pointer;user-select:none;}",
    ".pix-gs-rc{width:15px;height:15px;border-radius:50%;border:1px solid rgba(255,255,255,0.32);flex:none;display:flex;align-items:center;justify-content:center;}",
    ".pix-gs-rc .ri{width:7px;height:7px;border-radius:50%;background:var(--pix-acc,#f66744);display:none;}",
    ".pix-gs-radio.on .pix-gs-rc{border-color:var(--pix-acc,#f66744);}",
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
      const nodes = (app.graph && (app.graph._nodes || app.graph.nodes)) || [];
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
  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root);   // the switches follow this node's accent colour
  const widget = node.addDOMWidget("group_switch_ui", "pixaroma_group_switch", root, {
    getValue: () => readState(node),
    setValue: () => {},
    getMinHeight: () => widgetMinHeight(node),
    margin: 2,
    serialize: false, // state lives on node.properties
  });
  applyAdaptiveCanvasOnly(widget);
  widget.computeLayoutSize = () => ({ minHeight: widgetMinHeight(node), minWidth: 1 });
  node._pixGsRoot = root;
  node._pixGsFloorOff = installResizeFloor(root, () => bodyHeight(node));
  // Classic: hug the body. The stock node.computeSize reserves a phantom slot
  // row (a = max(inputs, outputs, 1) * NODE_SLOT_HEIGHT) plus per-widget spacing,
  // which left ~38px of dead space under the switches on this dot-less node.
  // Return the exact body height so the frame matches the switches. The DOM
  // widget is positioned at y=2 (NOT after a phantom row), so dropping the row
  // from sizing never pushes content out of the frame. Vue uses computeLayoutSize.
  // WIDTH = MIN_W (NOT this.size[0]): computeSize()[0] is the corner-drag MINIMUM,
  // so returning the current width pinned the floor at the current width => the
  // node could only GROW, never shrink (issue #10). MIN_W lets it shrink; the live
  // width stays node.size[0] (computeSize is only the floor, not the actual size).
  if (!isVueNodes()) {
    node.computeSize = function () { return [MIN_W, bodyHeight(this)]; };
  }
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
    { heading: "The switches", body: "The node body is just the switches. Click anywhere on a row to flip that group on or off - not only the small switch. An enabled row shows bright white text; a switched-off row is dimmed, so you can read the state at a glance. A small tag in the corner shows whether this one mutes or bypasses, and the colored dot and name (plus a number when two groups share a name) tell the groups apart.\n\nDrag the corner to make the node wider or taller: it keeps that size when you flip switches, change tabs or reopen the workflow, and still grows by itself when more groups need room. Drag it back up to the switches to make it fit them again." },
    { heading: "Finding a group on the canvas", body: "Each row has a small arrow next to its switch. Click it and the canvas jumps to that group, which saves hunting for it in a big workflow. It works whether the group is switched on or off, so you can turn a section off and then go and look at it. Clicking the arrow only moves the view; it never flips the switch." },
    { heading: "All on / All off", body: "The two buttons at the top flip every group in the list at once, so you can kill a whole set of sections (or bring them all back) in one click instead of clicking each switch. They only touch the groups this switch lists, so if you set it to a hand-picked set, the rest are left alone.\n\nIf you have chosen a switching rule that only allows one group on at a time, turning them all on is impossible, so that button is greyed out - and hovering it tells you why. The same goes for All off when the rule always keeps one group on." },
    { heading: "Settings (the gear, or right-click)", defs: [
      ["Action", "Make this switch a Mute or a Bypass. New switches default to Bypass. For both at once, drop two switches."],
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
    if (nodeType.prototype._pixGsPatched) return; // hot-reload: don't double-wrap
    nodeType.prototype._pixGsPatched = true;

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
    // Classic: width floored at MIN_W. Height: during a real corner drag
    // (resizing_node) only floored at the rows, so a taller drag is kept (since
    // 2026-10-20, see refreshNodeSize); any other resize is LOCKED, as it always
    // was, to the rows or the stored user height, so core's own small size
    // nudges never change the node. (The 96 -> 98 one was core's per-frame
    // widget grow, gone since widgetMinHeight.)
    // Both renderers: remember a height the user dragged. Vue's own floor is
    // computeLayoutSize / installResizeFloor.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        const body = bodyHeight(this);
        if (app.canvas?.resizing_node === this) {
          if (this.size[1] < body) this.size[1] = body;
        } else {
          this.size[1] = Math.max(body, userBody(this));
        }
      }
      noteUserHeight(this);
      if (_origResize) return _origResize.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_NAME) return;
    setupNode(node);
  },
});

registerNodeHelp(NODE_NAME, HELP);

// The gear button in the node selection toolbar opens the same panel the
// right-click entry does. ownMenuItem: this node already adds its own line.
registerNodeSettings(NODE_NAME, {
  title: "Group Switch",
  ownMenuItem: true,
  open: (node) => openPanel(node, null),
});
