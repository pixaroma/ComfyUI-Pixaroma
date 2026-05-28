// Run with: node scripts/mute_switch_test.mjs
// Tests the v2 pure-function helpers (cascadeMuteSet + resolveAllMutes)
// against synthetic graph fixtures. No browser, no ComfyUI dependency.

import assert from "node:assert/strict";
import {
  getUpstreamNode,
  cascadeMuteSet,
  resolveAllMutes,
} from "../js/mute_switch/upstream.mjs";

function node(id, opts = {}) {
  const { inputLinks = [], type = "GenericNode", state = null } = opts;
  const n = {
    id,
    type,
    inputs: inputLinks.map((linkId) => ({ link: linkId })),
    outputs: [],
    properties: {},
  };
  if (state) n.properties.muteSwitchState = state;
  return n;
}

function link(id, originId) {
  return { id, origin_id: originId };
}

function muteSwitch(id, rows, opts = {}) {
  // rows: array of { enabled: boolean, link: number-or-null }
  const inputLinks = rows.map((r) => (r.link == null ? null : r.link));
  const stateRows = rows.map((r) => ({ enabled: r.enabled, label: null }));
  const n = node(id, {
    type: "PixaromaMuteSwitch",
    inputLinks,
    state: {
      version: 1,
      selectMode: "multi",
      muteMode: opts.muteMode || "mute",
      rows: stateRows,
    },
  });
  return n;
}

const isMuteSwitch = (n) => n && n.type === "PixaromaMuteSwitch";

// ── Test 1: direct-only mute (no inner switch) ─────────────────────────
{
  const X1 = node("X1");
  const SW = muteSwitch("SW", [
    { enabled: false, link: 1 }, // row 1 OFF, wired to X1
  ]);
  const links = { 1: link(1, "X1") };
  const nodesById = { X1, SW };
  const set = cascadeMuteSet(SW, nodesById, links, isMuteSwitch);
  assert.deepEqual([...set], ["X1"], "Test 1: direct mute");
  console.log("PASS Test 1: row OFF mutes ONLY the wired upstream node");
}

// ── Test 2: row ON contributes nothing ─────────────────────────────────
{
  const X1 = node("X1");
  const X2 = node("X2");
  const SW = muteSwitch("SW", [
    { enabled: true, link: 1 },   // ON
    { enabled: false, link: 2 },  // OFF
  ]);
  const links = { 1: link(1, "X1"), 2: link(2, "X2") };
  const nodesById = { X1, X2, SW };
  const set = cascadeMuteSet(SW, nodesById, links, isMuteSwitch);
  assert.deepEqual([...set], ["X2"], "Test 2: only OFF rows contribute");
  console.log("PASS Test 2: ON rows do NOT contribute to want-muted");
}

// ── Test 3: cascade through inner Mute Switch ──────────────────────────
{
  const X1 = node("X1");
  const X2 = node("X2");
  // Inner switch A wires X1 and X2
  const A = muteSwitch("A", [
    { enabled: true, link: 1 },
    { enabled: true, link: 2 },
  ]);
  // Outer switch C wires A
  const C = muteSwitch("C", [
    { enabled: false, link: 3 },  // OFF -> cascade into A
  ]);
  const links = {
    1: link(1, "X1"),
    2: link(2, "X2"),
    3: link(3, "A"),
  };
  const nodesById = { X1, X2, A, C };
  const set = cascadeMuteSet(C, nodesById, links, isMuteSwitch);
  // C wants A AND everything wired into A (X1, X2) muted.
  assert.deepEqual([...set].sort(), ["A", "X1", "X2"], "Test 3: cascade");
  console.log("PASS Test 3: OFF row cascades through inner Mute Switch");
}

// ── Test 4: cascade respects inner switch's own OFF rows ───────────────
// If C row B is OFF, cascade through B mutes everything B is wired to
// regardless of B's own row state (we're overriding B's choices).
{
  const Y1 = node("Y1");
  const Y2 = node("Y2");
  const B = muteSwitch("B", [
    { enabled: false, link: 1 },  // B's own row 1 OFF
    { enabled: true, link: 2 },   // B's own row 2 ON
  ]);
  const C = muteSwitch("C", [
    { enabled: false, link: 3 },  // C's row B is OFF
  ]);
  const links = {
    1: link(1, "Y1"),
    2: link(2, "Y2"),
    3: link(3, "B"),
  };
  const nodesById = { Y1, Y2, B, C };
  const set = cascadeMuteSet(C, nodesById, links, isMuteSwitch);
  // C overrides B: even Y2 (which B wants enabled) gets muted via cascade.
  assert.deepEqual([...set].sort(), ["B", "Y1", "Y2"], "Test 4: cascade override");
  console.log("PASS Test 4: outer OFF overrides inner ON via cascade");
}

// ── Test 5: cycle through chained switches doesn't infinite-loop ──────
{
  const X = node("X");
  const A = muteSwitch("A", [
    { enabled: false, link: 1 },
    { enabled: false, link: 2 },  // wires back to C - cycle
  ]);
  const C = muteSwitch("C", [
    { enabled: false, link: 3 },  // wires to A
  ]);
  const links = {
    1: link(1, "X"),
    2: link(2, "C"),  // A -> C (cycle)
    3: link(3, "A"),  // C -> A
  };
  const nodesById = { X, A, C };
  const set = cascadeMuteSet(C, nodesById, links, isMuteSwitch);
  // Cascade from C: A (visit), then through A's inputs: X (visit), C (already visited).
  // C itself is NEVER added (it's the caller).
  assert.deepEqual([...set].sort(), ["A", "X"], "Test 5: cycle terminates");
  console.log("PASS Test 5: cycle through chained switches terminates");
}

// ── Test 6: resolveAllMutes unions multiple switches ───────────────────
{
  const A = node("A");
  const B = node("B");
  const SW1 = muteSwitch("SW1", [{ enabled: false, link: 1 }]);
  const SW2 = muteSwitch("SW2", [{ enabled: false, link: 2 }]);
  const links = { 1: link(1, "A"), 2: link(2, "B") };
  const nodesById = { A, B, SW1, SW2 };
  const m = resolveAllMutes([SW1, SW2], nodesById, links, isMuteSwitch);
  assert.deepEqual([...m.keys()].sort(), ["A", "B"], "Test 6: union of two switches");
  console.log("PASS Test 6: resolveAllMutes unions across switches");
}

// ── Test 7: resolveAllMutes - bypass mode wins per-switch ─────────────
{
  const X = node("X");
  const SW = muteSwitch("SW", [{ enabled: false, link: 1 }], { muteMode: "bypass" });
  const links = { 1: link(1, "X") };
  const nodesById = { X, SW };
  const m = resolveAllMutes([SW], nodesById, links, isMuteSwitch);
  assert.equal(m.get("X"), 4, "Test 7: bypass mode -> targetMode 4");
  console.log("PASS Test 7: muteMode=bypass produces targetMode 4");
}

// ── Test 8: graph.links as Map (Vue Compat #3) ─────────────────────────
{
  const X = node("X");
  const SW = muteSwitch("SW", [{ enabled: false, link: 1 }]);
  const linksMap = new Map();
  linksMap.set(1, link(1, "X"));
  const nodesById = { X, SW };
  const set = cascadeMuteSet(SW, nodesById, linksMap, isMuteSwitch);
  assert.deepEqual([...set], ["X"], "Test 8: links as Map");
  console.log("PASS Test 8: graph.links as Map works");
}

// ── Test 9: getUpstreamNode helper ─────────────────────────────────────
{
  const X = node("X");
  const A = node("A", { inputLinks: [1] });
  const links = { 1: link(1, "X") };
  const nodesById = { X, A };
  assert.equal(getUpstreamNode(A.inputs[0], nodesById, links), X, "Test 9: getUpstreamNode");
  assert.equal(getUpstreamNode({ link: null }, nodesById, links), null, "Test 9: null link");
  console.log("PASS Test 9: getUpstreamNode resolves correctly");
}

// ── Test 10: disconnected row contributes nothing ──────────────────────
{
  const X = node("X");
  const SW = muteSwitch("SW", [
    { enabled: false, link: null },  // OFF but disconnected
    { enabled: false, link: 1 },     // OFF and wired
  ]);
  const links = { 1: link(1, "X") };
  const nodesById = { X, SW };
  const set = cascadeMuteSet(SW, nodesById, links, isMuteSwitch);
  assert.deepEqual([...set], ["X"], "Test 10: disconnected OFF row is no-op");
  console.log("PASS Test 10: disconnected OFF row contributes nothing");
}

// ── Test 11: 3-level chain cascades all the way down ──────────────────
// Layout: Texts -> Inner A/B -> Middle -> Outer
// Outer row 1 OFF should cascade: Middle muted, Inner A & B muted, all
// their Texts muted.
{
  const tA1 = node("tA1");
  const tA2 = node("tA2");
  const tB1 = node("tB1");
  const tB2 = node("tB2");
  // Inner switch A wires tA1, tA2
  const innerA = muteSwitch("innerA", [
    { enabled: true, link: 1 },
    { enabled: true, link: 2 },
  ]);
  // Inner switch B wires tB1, tB2
  const innerB = muteSwitch("innerB", [
    { enabled: true, link: 3 },
    { enabled: true, link: 4 },
  ]);
  // Middle switch wires innerA, innerB
  const middle = muteSwitch("middle", [
    { enabled: true, link: 5 },
    { enabled: true, link: 6 },
  ]);
  // Outer switch wires middle. Row 1 OFF.
  const outer = muteSwitch("outer", [
    { enabled: false, link: 7 },
  ]);
  const links = {
    1: link(1, "tA1"),
    2: link(2, "tA2"),
    3: link(3, "tB1"),
    4: link(4, "tB2"),
    5: link(5, "innerA"),
    6: link(6, "innerB"),
    7: link(7, "middle"),
  };
  const nodesById = { tA1, tA2, tB1, tB2, innerA, innerB, middle, outer };

  const set = cascadeMuteSet(outer, nodesById, links, isMuteSwitch);
  assert.deepEqual([...set].sort(),
    ["innerA", "innerB", "middle", "tA1", "tA2", "tB1", "tB2"],
    "Test 11: 3-level cascade");
  console.log("PASS Test 11: outer OFF cascades down through 3 levels of switches");
}

// ── Test 12: one switch with multiple consumers - any OFF wins ────────
// Middle switch is wired into BOTH TopRight and BotRight.
// TopRight row 1 OFF (wants middle muted).
// BotRight row 1 ON (doesn't say anything about middle).
// Middle should get muted by TR's request; BR loses access too.
{
  const X = node("X");
  const middle = muteSwitch("middle", [
    { enabled: true, link: 1 },
  ]);
  const topRight = muteSwitch("TR", [
    { enabled: false, link: 2 },
  ]);
  const botRight = muteSwitch("BR", [
    { enabled: true, link: 3 },
  ]);
  const links = {
    1: link(1, "X"),
    2: link(2, "middle"),  // middle -> TR
    3: link(3, "middle"),  // middle -> BR
  };
  const nodesById = { X, middle, topRight, botRight };

  // Resolve all three switches together
  const all = resolveAllMutes(
    [middle, topRight, botRight],
    nodesById,
    links,
    isMuteSwitch,
  );
  // Middle's own rows are ON -> contributes nothing.
  // TR's row 1 is OFF, wired to middle -> cascade: mute middle + X.
  // BR's rows are ON -> contributes nothing.
  // Union: {middle, X}
  assert.deepEqual([...all.keys()].sort(), ["X", "middle"],
    "Test 12: one consumer OFF mutes the shared upstream");
  console.log("PASS Test 12: shared producer muted when ANY consumer wants it OFF");
}

// ── Test 13: same switch wired to two consumers, BOTH on - producer stays ──
{
  const X = node("X");
  const middle = muteSwitch("middle", [
    { enabled: true, link: 1 },
  ]);
  const topRight = muteSwitch("TR", [
    { enabled: true, link: 2 },
  ]);
  const botRight = muteSwitch("BR", [
    { enabled: true, link: 3 },
  ]);
  const links = {
    1: link(1, "X"),
    2: link(2, "middle"),
    3: link(3, "middle"),
  };
  const nodesById = { X, middle, topRight, botRight };
  const all = resolveAllMutes(
    [middle, topRight, botRight],
    nodesById,
    links,
    isMuteSwitch,
  );
  assert.equal(all.size, 0, "Test 13: nothing muted when all rows ON");
  console.log("PASS Test 13: no consumer wants OFF -> shared producer stays alive");
}

console.log("\nAll mute_switch v2 tests passed.");
