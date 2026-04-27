// js/audio_studio/core.mjs
// Minimal stub class — Milestone D2 lands the real editor shell with
// fullscreen overlay, header, sidebar, transport, etc.
export class AudioStudioEditor {
  constructor(node, cfg) {
    this.node = node;
    this.cfg = JSON.parse(JSON.stringify(cfg));
    this.overlay = null;
    this.onSave = null;
    this.onClose = null;
  }

  open() {
    console.log("[Pixaroma] AudioStudio: open() — D1 stub. Real editor lands in D2.");
  }

  forceClose() {
    /* no-op until D2 */
  }
}
