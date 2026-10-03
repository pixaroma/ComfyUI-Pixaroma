// The volume control shared by every Pixaroma in-node video player.
//
// Asked for by Xeromia_TV on Discord 2026-09-11: "I'm missing the volume
// control in the Pixaroma Video Save node, and it would be great to have a
// preset - since everything is actually always played back at 100%".
//
// Both halves of that are here. The CONTROL is a speaker in the player's bar
// with a slider that slides out when you point at it. The PRESET is that the
// level is remembered and applied to every Pixaroma video player from then on,
// so it is set once rather than per node.
//
// WHERE THE LEVEL LIVES, and why it is not node state. It is an UNREGISTERED
// ComfyUI setting (Vue Compat #20: an id that is in no extension's settings[]
// still persists), NOT `node.properties`:
//   * it is a preference of the PERSON, not of the workflow - sharing a
//     workflow should not carry your volume to someone else's ears;
//   * node.properties is serialized, so writing it from a control would mark
//     the workflow modified (Vue Compat #18) every time somebody nudged the
//     slider, and would put a volume into every saved file;
//   * it is deliberately NOT registered, so it adds no row to the Settings
//     panel - the slider IS the control (CLAUDE.md's "a setting reachable from
//     a node does not belong in the global panel").
// It is read through `nodeSetting(id, fallback)` because an unregistered id
// reads back `undefined` until it is first written.
//
// The DEFAULT stays 100, on purpose: every existing install plays at 100 today,
// and quietly turning everyone's sound down is not what was asked for. The
// moment the slider is moved, that level becomes the preset everywhere.

import { pixAsset } from "./api_url.mjs";
import { nodeSetting, setNodeSetting } from "./node_settings.mjs";

const VOL_ID = "Pixaroma.Video.Volume"; // 0..100
const MUTE_ID = "Pixaroma.Video.Muted"; // boolean
const UI_ICON = "icons/ui/";
const CSS_FLAG = "__pixVolCssInstalled";

// Every live control, so moving one slider moves them all: the level is one
// shared preference, and a second player still sitting at the old volume would
// make it look like the setting had not taken.
//
// Entries are pruned by checking `isConnected`, NOT by an unmount callback, so
// neither node has to remember to clean up and a Vue rebuild cannot leak. A
// detached element is unreachable anyway, so this cannot hold a node alive
// beyond its DOM.
const LIVE = new Set();

/** The stored preference, clamped, with the defaults an unwritten id needs. */
export function readVideoVolume() {
  let vol = Number(nodeSetting(VOL_ID, 100));
  if (!Number.isFinite(vol)) vol = 100;
  vol = Math.max(0, Math.min(100, Math.round(vol)));
  return { vol, muted: !!nodeSetting(MUTE_ID, false) };
}

function writeVideoVolume(vol, muted) {
  // Fire and forget: a failed write costs this session's preference, never the
  // playback the user is doing right now.
  try {
    setNodeSetting(VOL_ID, vol);
    setNodeSetting(MUTE_ID, !!muted);
  } catch {}
}

/**
 * Put the stored level onto a media element. Safe to call as often as you like
 * - it is what keeps a freshly loaded clip from starting at full blast.
 */
export function applyVideoVolume(video) {
  if (!video) return;
  const { vol, muted } = readVideoVolume();
  try {
    video.volume = vol / 100;
    // vol 0 is silent without being "muted": the speaker icon shows the same
    // thing either way, but keeping them apart means un-muting restores the
    // level the user chose instead of jumping to full.
    video.muted = muted || vol === 0;
  } catch {}
}

function installCss() {
  if (window[CSS_FLAG]) return;
  window[CSS_FLAG] = true;
  const st = document.createElement("style");
  // Sized to match .pix-sv-btn / .pix-mp4-btn exactly (24x24 button, 15x15
  // icon), so the speaker cannot look like a visitor in either bar. Both bars
  // grey the whole row with .is-disabled, which covers this control for free.
  st.textContent = [
    ".pix-vol-grp{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;}",
    ".pix-vol-btn{width:24px;height:24px;flex:0 0 auto;display:inline-flex;align-items:center;",
    "justify-content:center;padding:0;border:none;border-radius:4px;background:transparent;cursor:pointer;}",
    ".pix-vol-btn:hover{background:rgba(255,255,255,.10);}",
    ".pix-vol-ico{width:15px;height:15px;pointer-events:none;background-color:rgba(255,255,255,.85);",
    "-webkit-mask:var(--ico) center/contain no-repeat;mask:var(--ico) center/contain no-repeat;}",
    ".pix-vol-btn:hover .pix-vol-ico{background-color:#fff;}",
    // Hidden until pointed at, so a narrow node is not crowded by a control
    // most people set once. width+opacity (not display) so it can animate and
    // so :hover on the group keeps working while the pointer is on the slider.
    ".pix-vol-rng{-webkit-appearance:none;appearance:none;width:0;opacity:0;height:4px;border-radius:2px;",
    "outline:none;cursor:pointer;padding:0;margin:0;flex:0 0 auto;transition:width .16s ease,opacity .16s ease;",
    "background:linear-gradient(to right,var(--pix-acc,#f66744) var(--pix-vol-fill,100%),#3a3a3a var(--pix-vol-fill,100%));}",
    ".pix-vol-grp:hover .pix-vol-rng,.pix-vol-grp:focus-within .pix-vol-rng{width:54px;opacity:1;}",
    ".pix-vol-rng::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;",
    "border-radius:50%;background:var(--pix-acc,#f66744);border:2px solid #1a1a1a;cursor:pointer;}",
    ".pix-vol-rng::-moz-range-thumb{width:11px;height:11px;border-radius:50%;background:var(--pix-acc,#f66744);",
    "border:2px solid #1a1a1a;cursor:pointer;}",
    ".pix-vol-rng::-moz-range-track{height:4px;border-radius:2px;background:transparent;}",
  ].join("");
  document.head.appendChild(st);
}

function paint(entry) {
  const { grp, ico, rng, video } = entry;
  const { vol, muted } = readVideoVolume();
  const silent = muted || vol === 0;
  ico.style.setProperty("--ico", `url(${pixAsset(UI_ICON + (silent ? "volume-off.svg" : "volume.svg"))})`);
  // A muted speaker is dimmed, an audible one is not - the same "you can see
  // why it is quiet" treatment Run Timer's mute button uses.
  ico.style.backgroundColor = silent ? "rgba(255,255,255,.45)" : "";
  if (document.activeElement !== rng) rng.value = String(vol);
  rng.style.setProperty("--pix-vol-fill", (silent ? 0 : vol) + "%");
  grp.title = silent ? "Sound is off. Click to turn it on." : `Volume ${vol}%`;
  rng.setAttribute("aria-label", `Volume ${vol}%`);
  // The speaker is an icon only: name the button by what a click will do.
  if (entry.btn) entry.btn.setAttribute("aria-label", silent ? "Turn the sound on" : "Mute");
  if (video) applyVideoVolume(video);
}

function broadcast() {
  for (const e of [...LIVE]) {
    if (!e.grp.isConnected) {
      LIVE.delete(e); // self-pruning: no node has to remember to clean up
      continue;
    }
    paint(e);
  }
}

/**
 * Build the speaker + slider for one player.
 *
 * @param {HTMLVideoElement} video the element it controls
 * @returns {{group: HTMLElement, sync: () => void}} `group` goes in the control
 *   bar; call `sync()` after the element is replaced or a clip loads.
 */
export function buildVolumeControl(video) {
  installCss();

  const grp = document.createElement("span");
  grp.className = "pix-vol-grp";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pix-vol-btn";
  const ico = document.createElement("span");
  ico.className = "pix-vol-ico";
  btn.appendChild(ico);

  const rng = document.createElement("input");
  rng.className = "pix-vol-rng";
  rng.type = "range";
  rng.min = "0";
  rng.max = "100";
  rng.step = "1";

  grp.appendChild(btn);
  grp.appendChild(rng);

  const entry = { grp, btn, ico, rng, video };
  LIVE.add(entry);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const { vol, muted } = readVideoVolume();
    if (muted || vol === 0) {
      // Turning the sound back on when it is all the way down has to land
      // somewhere audible, or the click looks broken.
      writeVideoVolume(vol === 0 ? 100 : vol, false);
    } else {
      writeVideoVolume(vol, true);
    }
    broadcast();
  });

  rng.addEventListener("input", () => {
    const v = Math.max(0, Math.min(100, parseInt(rng.value, 10) || 0));
    // Moving the slider up is itself an un-mute: leaving `muted` set would give
    // a slider that visibly moves and changes nothing.
    writeVideoVolume(v, v === 0 ? readVideoVolume().muted : false);
    broadcast();
  });

  // Keep a press on the control from dragging the NODE. stopPropagation only -
  // preventDefault here would kill the range's own native drag.
  for (const ev of ["mousedown", "pointerdown"]) {
    grp.addEventListener(ev, (e) => e.stopPropagation());
  }

  paint(entry);
  return {
    group: grp,
    sync: (nextVideo) => {
      if (nextVideo) entry.video = nextVideo;
      paint(entry);
    },
  };
}
