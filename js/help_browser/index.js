// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help - the orange ? in the top toolbar              ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// One button beside Align that opens a floating help window covering every
// Pixaroma node, every canvas feature, and four short guides.
//
// There is deliberately NO "Help Pixaroma" node. A node would be saved into the
// workflow file, so sharing a workflow would spread a stray Help node to
// everyone who opened it, and it could not help someone staring at an empty
// canvas. Help belongs to the app, not to a graph.
//
// Three ways in, none of which touch the graph:
//   - the toolbar button (primary)
//   - "Open the full help" at the bottom of a node's own ? popup
//   - a right-click on empty canvas
//
// The toolbar mount is the same one Align uses (js/align/index.js):
// app.menu.settingsGroup.element.before(group), with the same retry loop for
// when the menu is not up yet, and the same silent give-up.

import { app } from "../../../scripts/app.js";
import { nodeSetting, setNodeSetting } from "../shared/index.mjs";
import { createHelpWindow, el } from "./window.mjs";
import { versionParts } from "../shared/version.mjs";
import { injectHelpBrowserCSS } from "./css.mjs";
import {
  buildIndex, groupByCategory, renderNav, renderArticle, buildCard, pixaromaOnCanvas,
} from "./content.mjs";
import { buildSearchIndex, searchIndex, highlight } from "./search.mjs";
import {
  toast, flash, createNodeAt, graphPointFromClient,
  copyText, versionLine, helpAsText, openExternal, LINKS, escText,
} from "./actions.mjs";

const PINS_SETTING = "Pixaroma.Help.Pins";
const LAST_SETTING = "Pixaroma.Help.Last";
const CMD_ID = "Pixaroma.OpenHelpBrowser";

// ── state ────────────────────────────────────────────────────
const S = {
  win: null,
  index: [],
  records: [],
  pins: new Set(),
  hist: [],
  hi: -1,
  filterCat: null,
  toolbarBtn: null,
};

function loadPins() {
  const raw = nodeSetting(PINS_SETTING, null);
  const arr = Array.isArray(raw) ? raw : (typeof raw === "string" ? safeParse(raw) : null);
  S.pins = new Set(Array.isArray(arr) ? arr : []);
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function savePins() {
  try { setNodeSetting(PINS_SETTING, [...S.pins]); } catch { /* a lost pin is not worth an error */ }
}

// ── navigation ───────────────────────────────────────────────
function navigate(entry, push = true) {
  if (push) { S.hist.splice(S.hi + 1); S.hist.push(entry); S.hi = S.hist.length - 1; }
  updateNavButtons();
  rememberPage(entry === "home" ? "home" : entry.key);
  renderNav(S.win.side, S.index, entry, (e) => navigate(e));
  if (entry === "home") renderHome();
  else renderArticle(S.win.main, entry, (e) => navigate(e), articleCtx());
}
// Debounced: navigate() runs on every page view including Back and Forward, and
// each setNodeSetting POSTs to the server. Clicking through twenty pages should
// not be twenty requests. The rect save next door is debounced for the same
// reason.
let _rememberTimer = null;
function rememberPage(key) {
  clearTimeout(_rememberTimer);
  _rememberTimer = setTimeout(() => {
    try { setNodeSetting(LAST_SETTING, key); } catch { /* remembering the page is a nicety */ }
  }, 400);
}

function updateNavButtons() {
  if (S.back) S.back.disabled = S.hi <= 0;
  if (S.fwd) S.fwd.disabled = S.hi >= S.hist.length - 1;
}

// ── the actions on an article ────────────────────────────────
function articleCtx() {
  return {
    index: S.index,
    buildActions(entry) {
      const row = el("div", "pixhb-acts");
      if (entry.kind === "node") {
        const add = el("button", "pixhb-btn2 pixhb-primary", "+ Add to canvas");
        add.type = "button";
        add.title = "Drops it in the middle of your view";
        add.addEventListener("click", () => {
          const n = createNodeAt(entry.cls);
          if (n) { flash(add, "Added"); toast(S.win.el, `<b>${escText(entry.title)}</b> added to your canvas.`); }
          else toast(S.win.el, "Could not create that node here.");
        });
        row.appendChild(add);
      }

      // Two buttons, deliberately. "Add wired" and "Ask about this" were both
      // removed on request: a support button on EVERY node page reads as an
      // offer of one-to-one help with anything, which is not what is on offer.
      // Where to ask is covered once, properly, on the Need help? page, and the
      // Discord button in the footer is on every page anyway.
      const copy = el("button", "pixhb-btn2", "Copy as text");
      copy.type = "button";
      copy.title = "Ready to paste into a question";
      copy.addEventListener("click", async () => {
        const ok = await copyText(helpAsText(entry));
        ok ? flash(copy, "Copied") : toast(S.win.el, "Could not reach the clipboard.");
      });
      row.appendChild(copy);
      return row;
    },
  };
}

// ── dragging a card onto the canvas ──────────────────────────
function makeDraggable(cardEl, entry) {
  if (entry.kind !== "node") return;
  cardEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".pixhb-star")) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null;
    const move = (ev) => {
      // Same lost-pointerup guard as the window drag. A move with no button
      // held means the release was missed, so this is a CANCEL, not a drop.
      if (!(ev.buttons & 1)) { end(ev, true); return; }
      if (!ghost && (Math.abs(ev.clientX - sx) > 6 || Math.abs(ev.clientY - sy) > 6)) {
        ghost = el("div", "pixhb-dragghost", entry.title);
        document.body.appendChild(ghost);
        cardEl.style.opacity = ".4";
      }
      if (ghost) { ghost.style.left = (ev.clientX + 12) + "px"; ghost.style.top = (ev.clientY + 12) + "px"; }
    };
    let done = false;
    // `cancelled` is the whole point of the split below. A drag can end two
    // ways: the user RELEASED (drop, place the node) or the release went
    // MISSING (pointer left the window, something else took capture). Those
    // must not share a code path: routing a missed release into the drop path
    // silently added a node to the workflow at wherever the pointer happened
    // to re-enter the page, with the user never having dropped anything.
    const end = (ev, cancelled) => {
      if (done) return;
      done = true;
      cardEl.removeEventListener("pointermove", move);
      cardEl.removeEventListener("pointerup", onUp);
      cardEl.removeEventListener("pointercancel", onCancel);
      cardEl.removeEventListener("lostpointercapture", onCancel);
      try { cardEl.releasePointerCapture(pointerId); } catch { /* already gone */ }
      cardEl.style.opacity = "";
      if (!ghost) return;
      ghost.remove();
      // Swallow the click that follows this drag, or the card would also open.
      cardEl._pixSkipClick = true;
      setTimeout(() => { cardEl._pixSkipClick = false; }, 80);
      if (cancelled) return;                       // never place a node on a lost release
      // Dropped back on the window itself? Do nothing rather than place a node
      // somewhere the user cannot see.
      if (S.win.el.contains(document.elementFromPoint?.(ev.clientX, ev.clientY) || null)) {
        toast(S.win.el, "Drop it on the canvas to place it there.");
        return;
      }
      const n = createNodeAt(entry.cls, graphPointFromClient(ev.clientX, ev.clientY));
      toast(S.win.el, n ? `<b>${escText(entry.title)}</b> dropped where you let go.` : "Could not create that node here.");
    };
    const onUp = (ev) => end(ev, false);
    const onCancel = (ev) => end(ev, true);
    // Pointer capture keeps the events coming to THIS element even when the
    // pointer leaves the window, which is what makes a real release reliable.
    const pointerId = e.pointerId;
    try { cardEl.setPointerCapture(pointerId); } catch { /* older build: the guard still covers us */ }
    cardEl.addEventListener("pointermove", move);
    cardEl.addEventListener("pointerup", onUp);
    cardEl.addEventListener("pointercancel", onCancel);
    cardEl.addEventListener("lostpointercapture", onCancel);
  });
}

// ── the home screen ──────────────────────────────────────────
function renderHome() {
  const main = S.win.main;
  main.innerHTML = "";
  const pad = el("div", "pixhb-pad");
  const onCanvas = pixaromaOnCanvas();
  const ctx = { pins: S.pins, onCanvas, makeDraggable, togglePin: (k) => {
    S.pins.has(k) ? S.pins.delete(k) : S.pins.add(k);
    savePins();
    renderHome();
  } };

  // What is already on their canvas: usually the thing they need help with.
  const here = S.index.filter((e) => e.kind === "node" && onCanvas.has(e.cls));
  if (here.length) {
    pad.appendChild(el("p", "pixhb-h", "On your canvas right now"));
    const strip = el("div", "pixhb-strip");
    for (const e of here) {
      const m = el("button", "pixhb-mini");
      m.type = "button";
      m.innerHTML = `<span>${e.icon}</span><span></span>`;
      m.lastChild.textContent = e.title;
      m.addEventListener("click", () => navigate(e));
      strip.appendChild(m);
    }
    pad.appendChild(strip);
  }

  // Start here.
  const guides = S.index.filter((e) => e.kind === "guide");
  if (guides.length) {
    const hero = el("div", "pixhb-hero");
    const h3 = el("h3", null, "Start here");
    const p = el("p", null, "Keeping the nodes up to date, opening a downloaded workflow, the fix for most “it looks broken” reports, and where to ask when none of that helps.");
    hero.append(h3, p);
    const grid = el("div", "pixhb-startgrid");
    for (const g of guides) {
      const c = el("button", "pixhb-startcard");
      c.type = "button";
      const ic = el("span", null, g.icon);
      ic.style.fontSize = "15px";
      const txt = el("span");
      txt.append(el("span", "pixhb-sc-n", g.title), document.createElement("br"), el("span", "pixhb-sc-d", g.tagline));
      c.append(ic, txt);
      c.addEventListener("click", () => navigate(g));
      grid.appendChild(c);
    }
    hero.appendChild(grid);
    pad.appendChild(hero);
  }

  // Pinned.
  const pinned = S.index.filter((e) => S.pins.has(e.key));
  if (pinned.length) {
    const rh = el("div", "pixhb-rowhead");
    rh.append(el("p", "pixhb-h", "Pinned"), el("span", "pixhb-hint", "the ones you keep coming back to"));
    pad.appendChild(rh);
    const grid = el("div", "pixhb-grid");
    for (const e of pinned) grid.appendChild(buildCard(e, (x) => navigate(x), ctx));
    pad.appendChild(grid);
  }

  // Everything, with category filters.
  const rh = el("div", "pixhb-rowhead");
  // "node card" on purpose: the Canvas tools cards in this same grid are not
  // nodes and cannot be dropped (makeDraggable returns early for them), so the
  // unqualified "card" promised something six of them do not do.
  rh.append(el("p", "pixhb-h", "Browse everything"), el("span", "pixhb-hint", "drag a node card onto the canvas to place it"));
  pad.appendChild(rh);

  const browsable = S.index.filter((e) => e.kind !== "guide");
  const chips = el("div", "pixhb-chips");
  const mkChip = (id, label) => {
    const c = el("button", "pixhb-chip" + ((S.filterCat === id) || (id === null && !S.filterCat) ? " pixhb-on" : ""), label);
    c.type = "button";
    c.addEventListener("click", () => { S.filterCat = id; renderHome(); });
    return c;
  };
  chips.appendChild(mkChip(null, "All " + browsable.length));
  for (const g of groupByCategory(browsable)) chips.appendChild(mkChip(g.name, `${g.icon} ${g.items.length}`));
  pad.appendChild(chips);

  const grid = el("div", "pixhb-grid");
  const shown = browsable.filter((e) => !S.filterCat || e.cat === S.filterCat);
  if (!shown.length) grid.appendChild(el("div", "pixhb-empty", "Nothing in this section yet."));
  for (const e of shown) grid.appendChild(buildCard(e, (x) => navigate(x), ctx));
  pad.appendChild(grid);

  main.appendChild(pad);
  main.scrollTop = 0;
}

// ── the footer bar ───────────────────────────────────────────
// Where to ask, and which version you are on. Built ONCE into the window frame
// rather than into the home screen, so it is on every page: a guide that tells
// someone to include their version should not then send them to a different
// screen to find it.
function buildFooter(foot) {
  const mkLink = (cls, label, url, tip) => {
    const b = el("button", "pixhb-flink " + cls, label);
    b.type = "button";
    b.title = tip || url;
    b.addEventListener("click", () => openExternal(url));
    return b;
  };
  foot.append(
    mkLink("pixhb-discord", "💬 Discord", LINKS.DISCORD_URL,
      "#pixaroma-nodes for the nodes, #comfyui for ComfyUI itself"),
    mkLink("pixhb-yt", "▶️ YouTube", LINKS.YOUTUBE_URL, "The tutorial episodes"),
    mkLink("", "🌐 Workflows", LINKS.SITE_URL, "The Pixaroma workflows site"),
  );
  foot.appendChild(el("div", "pixhb-fsp"));
  // beside the version chip, so "mine" and "the newest" sit side by side
  foot.appendChild(mkLink("", "🆕 Latest version", LINKS.LATEST_URL, "The newest Pixaroma version and what is new in it"));

  // The version, spelled out rather than hidden behind a button. The short form
  // is what people are asked for; the click copies the FULL line (frontend
  // version, renderer, platform) which is what actually answers a support
  // question.
  const ver = el("button", "pixhb-ver");
  const vp = versionParts();
  ver.append(el("span", "pixhb-vername", vp.name), document.createTextNode(" " + vp.number));
  ver.type = "button";
  // Also on hover, not just on open: the renderer can be switched while this
  // window stays open, and the tooltip names the renderer.
  ver.addEventListener("pointerenter", refreshFooter);
  ver.addEventListener("click", async () => {
    const ok = await copyText(versionLine());
    toast(S.win.el, ok ? "Version details copied. Paste them with your question." : "Could not reach the clipboard.");
  });
  foot.appendChild(ver);
  S.verBtn = ver;
  refreshFooter();
}

// The renderer can be switched without reloading the page, so the full line is
// re-read on every open rather than baked in when the window was built.
function refreshFooter() {
  if (!S.verBtn) return;
  S.verBtn.title = versionLine() + "  ·  click to copy";
}

// ── search ───────────────────────────────────────────────────
function renderResults(query) {
  const main = S.win.main;
  main.innerHTML = "";
  const pad = el("div", "pixhb-pad");
  const hits = searchIndex(S.records, query, 40);

  if (!hits.length) {
    const e = el("div", "pixhb-empty");
    e.innerHTML = `Nothing matches <b>${highlight(query, "")}</b>.<br>` +
      `<span style="font-size:11px">Try a plainer word. The search reads the whole help text, not just node names.</span><br>`;
    // Routes to the Need help? page rather than straight into Discord. A dead
    // end in the search is the one place the help genuinely has nothing to
    // offer, so it should point somewhere - but at the page that explains WHICH
    // channel to use, not at a door marked "ask me anything".
    const ask = el("button", "pixhb-btn2", "Where to ask");
    ask.type = "button";
    ask.style.marginTop = "10px";
    ask.addEventListener("click", () => {
      const help = S.index.find((x) => x.key === "guide:help");
      if (help) navigate(help);
      else openExternal(LINKS.DISCORD_URL);
    });
    e.appendChild(ask);
    pad.appendChild(e);
    main.appendChild(pad);
    return;
  }

  pad.appendChild(el("p", "pixhb-h", `${hits.length} result${hits.length === 1 ? "" : "s"}`));
  for (const { entry } of hits) {
    const r = el("div", "pixhb-res");
    r.appendChild(el("span", "pixhb-card-ic", entry.icon));
    const t = el("div", "pixhb-res-t");
    const n = el("div", "pixhb-rn");
    n.innerHTML = highlight(entry.title, query);
    const d = el("div", "pixhb-rd");
    d.innerHTML = highlight(entry.tagline || entry.cat, query);
    t.append(n, d);
    r.appendChild(t);
    r.addEventListener("click", () => navigate(entry));
    pad.appendChild(r);
  }
  main.appendChild(pad);
  main.scrollTop = 0;
}

// ── build the window once, on first open ─────────────────────
function ensureWindow() {
  if (S.win) return S.win;
  S.win = createHelpWindow({ onRender: refresh, onClose: syncToolbarButton });

  const back = el("button", "pixhb-nav", "‹");
  back.type = "button"; back.title = "Back";
  const fwd = el("button", "pixhb-nav", "›");
  fwd.type = "button"; fwd.title = "Forward";
  S.back = back; S.fwd = fwd;
  back.addEventListener("click", () => { if (S.hi > 0) { S.hi--; navigate(S.hist[S.hi], false); } });
  fwd.addEventListener("click", () => { if (S.hi < S.hist.length - 1) { S.hi++; navigate(S.hist[S.hi], false); } });

  const search = el("div", "pixhb-search");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search nodes, topics, or a problem";
  search.appendChild(input);
  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (q) renderResults(q);
    else navigate("home");
  });

  const homeBtn = el("button", "pixhb-btn2", "Home");
  homeBtn.type = "button";
  homeBtn.addEventListener("click", () => { input.value = ""; navigate("home"); });

  S.win.bar.append(back, fwd, search, homeBtn);
  buildFooter(S.win.foot);
  return S.win;
}

// Rebuild the index every open: nodes can register late, and the graph changes
// under us because the window stays open across workflow switches.
function refresh() {
  S.index = buildIndex();
  S.records = buildSearchIndex(S.index);
  refreshFooter();
  if (S.hi < 0) {
    const last = nodeSetting(LAST_SETTING, "home");
    const found = last && last !== "home" ? S.index.find((e) => e.key === last) : null;
    navigate(found || "home");
  } else {
    // Re-resolve the current entry against the fresh index so a reopened window
    // never renders a stale object.
    // Re-resolve EVERY history slot against the fresh index, not just the
    // current one: the arrows replay the others, and an entry from a previous
    // index renders stale text and fails the identity check the sidebar uses
    // to highlight the current page.
    S.hist = S.hist.map((cur) =>
      cur === "home" ? "home" : (S.index.find((e) => e.key === cur.key) || "home"));
    navigate(S.hist[S.hi], false);
  }
}

// `target` may be a node's comfyClass ("PixaromaOutpaint") or a page key
// ("canvas:colors"), so the canvas features can link here too.
export function openHelpBrowser(target) {
  loadPins();
  const w = ensureWindow();
  w.open();
  syncToolbarButton();
  if (target) {
    const hit = S.index.find((e) => e.cls === target || e.key === target);
    if (hit) navigate(hit);
  }
}
export function toggleHelpBrowser() {
  if (S.win?.isOpen()) closeHelpBrowser();
  else openHelpBrowser();
}
export function closeHelpBrowser() {
  S.win?.close();
  syncToolbarButton();
}
// The toolbar button shows whether the window is open, so it reads as a toggle
// rather than a button that sometimes seems to do nothing. Called from every
// path that opens or closes, including the window's own X.
function syncToolbarButton() {
  S.toolbarBtn?.classList.toggle("pixhb-btn-open", !!S.win?.isOpen());
}

// ── the toolbar button ───────────────────────────────────────
function mountToolbarButton() {
  if (S.toolbarBtn?.isConnected) return;
  const settingsGroupEl = app.menu?.settingsGroup?.element;
  if (!settingsGroupEl) {
    if (mountToolbarButton._tries == null) mountToolbarButton._tries = 0;
    if (++mountToolbarButton._tries > 20) {
      console.warn("[Pixaroma.Help] toolbar mount: app.menu.settingsGroup never appeared");
      return;
    }
    setTimeout(mountToolbarButton, 250);
    return;
  }
  injectHelpBrowserCSS();

  const btn = document.createElement("button");
  btn.className = "comfyui-button pixhb-btn";
  btn.title = "Pixaroma Help: every node, the canvas tools, and the guides";
  btn.innerHTML = `<span class="pixhb-btn-icon"></span>`;
  btn.addEventListener("click", toggleHelpBrowser);

  const group = document.createElement("div");
  // pixhb-group-btn is load-bearing: js/toolbar_visibility hides this group
  // when the user turns the button off. Do not drop it.
  group.className = "comfyui-button-group pixhb-group-btn";
  group.appendChild(btn);

  settingsGroupEl.before(group);
  S.toolbarBtn = btn;
}

app.registerExtension({
  name: "Pixaroma.HelpBrowser",
  commands: [
    {
      id: CMD_ID,
      label: "Pixaroma Help",
      icon: "pixhb-cmd-icon",
      function: toggleHelpBrowser,
    },
  ],
  // Registered through the official API rather than a raw keydown listener, so
  // ComfyUI owns the binding and the user can rebind it.
  keybindings: [{ combo: { key: "h", alt: true }, commandId: CMD_ID }],

  // Right-click on empty canvas. New context-menu API, never the deprecated
  // getCanvasMenuOptions monkey-patch.
  getCanvasMenuItems() {
    return [null, { content: "👑 Pixaroma Help", callback: () => openHelpBrowser() }];
  },

  setup() {
    loadPins();
    mountToolbarButton();
    // So the per-node ? popup can link through to the full page.
    try { window.PixaromaHelpBrowser = { open: openHelpBrowser, toggle: toggleHelpBrowser, close: closeHelpBrowser, isOpen: () => !!S.win?.isOpen() }; } catch { /* optional */ }
  },
});
