import { app } from "/scripts/app.js";

export function injectComposerStyles() {
  if (document.getElementById("pixaroma-styles-v14")) return;
  const style = document.createElement("style");
  style.id = "pixaroma-styles-v14";
  style.innerHTML = `
        .pix-sidebar-left { width: 310px; background: #242628; display: flex; flex-direction: column; border-right: 1px solid #3a3d40; padding: 15px; box-sizing: border-box; overflow-y: auto; z-index: 2; }
        .pix-sidebar-right { width: 300px; background: #242628; display: flex; flex-direction: column; border-left: 1px solid #3a3d40; padding: 15px; box-sizing: border-box; overflow-y: auto; z-index: 2; gap: 10px; }
        .pix-workspace { flex: 1; position: relative; overflow: hidden; background: #1a1c1d; cursor: default; }
        .pix-workspace.panning { cursor: grabbing !important; }
        .pix-canvas-container { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(1); transform-origin: center center; box-shadow: 0 10px 50px rgba(0,0,0,0.8); overflow: visible; }
        .pix-canvas { width: 100%; height: 100%; display: block; background-color: #1e1e1e; }
        .pix-align-bar { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; background: rgba(36,38,40,0.9); padding: 8px 15px; border-radius: 8px; border: 1px solid #3a3d40; z-index: 10; box-shadow: 0 4px 15px rgba(0,0,0,0.5); backdrop-filter: blur(5px); align-items: center; }
        .pix-view-controls { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; background: rgba(36,38,40,0.9); padding: 8px 15px; border-radius: 8px; border: 1px solid #3a3d40; z-index: 10; box-shadow: 0 4px 15px rgba(0,0,0,0.5); backdrop-filter: blur(5px); }
        .pix-view-btn { background: transparent; border: none; color: white; cursor: pointer; font-size: 16px; padding: 5px 10px; border-radius: 4px; transition: 0.2s; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 5px; }
        .pix-view-btn:hover { background: #3a3d40; color: #f66744; }
        .pix-view-btn:disabled { opacity: 0.3 !important; cursor: not-allowed; }
        .pix-panel { background: #1a1c1d; border: 1px solid #3a3d40; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
        .pix-panel-title { font-size: 12px; text-transform: uppercase; color: #888; font-weight: bold; margin-bottom: 12px; letter-spacing: 0.5px; }
        .pix-row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; width: 100%; }
        .pix-col { display: flex; flex-direction: column; flex: 1; }
        .pix-label { font-size: 11px; color: #aaa; margin-bottom: 4px; }
        .pix-input { background: #131415; border: 1px solid #3a3d40; color: white; padding: 8px; border-radius: 4px; width: 100%; box-sizing: border-box; outline: none; font-size: 12px; }
        .pix-input:focus { border-color: #f66744; }
        .pix-input-num { width: 55px; text-align: center; font-size: 11px; padding: 6px; }
        .pix-btn { background: #3a3d40; border: none; color: white; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s; display: flex; justify-content: center; align-items: center; box-sizing: border-box; flex: 1; }
        .pix-btn:hover { background: #4a4d50; }
        .pix-btn-active { background: #f66744 !important; color: white; }
        .pix-btn-active:hover { background: #e05535 !important; }
        .pix-btn-accent { background: #f66744; color: #fff; width: 100%; font-size: 14px; padding: 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s; }
        .pix-btn-accent:hover { background: #e05535; }
        .pix-btn-danger { background: #dc2626; color: white; border: none; }
        .pix-btn-danger:hover { background: #b91c1c; }
        input[type=range] { -webkit-appearance: none; width: 100%; background: transparent; flex: 1; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 16px; width: 16px; border-radius: 50%; background: #f66744; cursor: pointer; margin-top: -6px; }
        input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 4px; cursor: pointer; background: #3a3d40; border-radius: 2px; }
        .pix-layers-list { display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; padding-right: 5px; }
        .pix-layer-item { display: flex; align-items: center; gap: 4px; padding: 4px 5px; border-radius: 3px; cursor: pointer; border: 1px solid transparent; transition: all .1s; }
        .pix-layer-item:hover { background: #222426; }
        .pix-layer-item.active { background: #2a1800; border-color: #f66744; }
        .pix-layer-item.multi-selected { background: #0a1a2a; border-color: #0ea5e9; }
        .pix-layer-item.pix-drag-over-top { border-top: 2px solid #f66744 !important; }
        .pix-layer-item.pix-drag-over-bottom { border-bottom: 2px solid #f66744 !important; }
        .pix-layer-item.pix-dragging { opacity: 0.35; }
        .pix-layer-vis { cursor: pointer; font-size: 12px; color: #666; flex-shrink: 0; width: 16px; text-align: center; }
        .pix-layer-vis.on { color: #ccc; }
        .pix-layer-thumb { width: 26px; height: 26px; flex-shrink: 0; border-radius: 2px; border: 1px solid #333; overflow: hidden; background: repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 0 0/8px 8px; }
        .pix-layer-name { flex: 1; font-size: 10px; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; cursor: default; }
        .pix-layer-lock { font-size: 11px; color: #666; cursor: pointer; flex-shrink: 0; }
        .pix-layer-lock.locked { color: #f66744; }
        .pix-layer-item.locked .pix-layer-name { color: #888; }
        .pix-layer-rename-input { flex: 1; background: #111; color: #e0e0e0; border: 1px solid #f66744; border-radius: 3px; padding: 2px 4px; font-size: 10px; min-width: 0; outline: none; }
        .pix-layer-actions { display: flex; gap: 4px; padding: 5px 0; border-top: 1px solid #2a2c2e; flex-shrink: 0; flex-wrap: wrap; }
        .pix-layer-actions .pix-btn { font-size: 12px; padding: 4px 8px; min-width: 28px; flex: 0 0 auto; }
        .pix-eraser-divider { height: 1px; background: #3a3d40; margin: 10px 0; }
        .pix-hint { font-size: 10px; color: #666; margin-top: 4px; }
    `;
  document.head.appendChild(style);
}

export class PixaromaUI {
  constructor(core) {
    this.core = core;
  }

  updateHistoryUI() {
    const core = this.core;
    if (core.btnUndo) core.btnUndo.style.opacity = core.historyIndex > 0 ? "1" : "0.3";
    if (core.btnRedo) core.btnRedo.style.opacity = core.historyIndex < core.history.length - 1 ? "1" : "0.3";
  }

  updateActiveLayerUI() {
    const core = this.core;

    // --- Align bar: only usable with multi-selection ---
    const alignBtns = core.workspace.querySelectorAll(".pix-align-bar .pix-view-btn");
    if (core.selectedLayerIds.size > 1) {
      alignBtns.forEach((btn) => {
        btn.disabled = false;
      });
      core.workspace.querySelector(".pix-align-bar").style.opacity = "1";
    } else {
      alignBtns.forEach((btn) => {
        btn.disabled = true;
      });
      core.workspace.querySelector(".pix-align-bar").style.opacity = "0.3";
    }

    if (core.selectedLayerIds.size === 0) {
      // Dim all selection-dependent panels
      core.toolsPanel.style.opacity = "0.3";
      core.toolsPanel.style.pointerEvents = "none";
      core.btnDelLayer.style.opacity = "0.3";
      core.btnDupLayer.style.opacity = "0.3";
      core.removeBgBtn.style.opacity = "0.3";
      core.removeBgBtn.style.pointerEvents = "none";

      // Dim eraser panel and force eraser off
      if (core.eraserPanel) {
        core.eraserPanel.style.opacity = "0.3";
        core.eraserPanel.style.pointerEvents = "none";
      }
      if (core.activeMode === "eraser") core.setMode(null);
    } else {
      core.toolsPanel.style.opacity = "1";
      core.toolsPanel.style.pointerEvents = "auto";
      core.btnDelLayer.style.opacity = "1";
      core.btnDupLayer.style.opacity = "1";
      core.removeBgBtn.style.opacity = "1";
      core.removeBgBtn.style.pointerEvents = "auto";

      if (core.eraserPanel) {
        core.eraserPanel.style.opacity = "1";
        core.eraserPanel.style.pointerEvents = "auto";
      }

      // Sync transform sliders to the first selected layer
      const firstId = Array.from(core.selectedLayerIds)[0];
      const layer = core.layers.find((l) => l.id === firstId);
      if (layer) {
        core.opacitySlider.value = Math.round(layer.opacity * 100);
        core.opacityNum.value = Math.round(layer.opacity * 100);
        core.rotateSlider.value = layer.rotation;
        core.rotateNum.value = layer.rotation;
        core.scaleSlider.value = Math.round(layer.scaleX * 100);
        core.scaleNum.value = Math.round(layer.scaleX * 100);
        core.stretchHSlider.value = Math.round(layer.scaleX * 100);
        core.stretchHNum.value = Math.round(layer.scaleX * 100);
        core.stretchVSlider.value = Math.round(layer.scaleY * 100);
        core.stretchVNum.value = Math.round(layer.scaleY * 100);

        // Reset Mask button: enabled when ANY selected layer has a mask
        if (core.btnResetEraser) {
          const anyMask = [...core.selectedLayerIds].some((id) => {
            const l = core.layers.find((ly) => ly.id === id);
            return l && l.hasMask_internal;
          });
          core.btnResetEraser.style.opacity = anyMask ? "1" : "0.3";
          core.btnResetEraser.disabled = !anyMask;
        }
      }
    }
    this.refreshLayersPanel();
  }

  refreshLayersPanel() {
    const core = this.core;
    core.layersList.innerHTML = "";
    // Display layers top-to-bottom (reversed from array order, since last = top)
    [...core.layers].reverse().forEach((layer, visualIndex) => {
      const actualIndex = core.layers.length - 1 - visualIndex;
      const item = document.createElement("div");
      const isSelected = core.selectedLayerIds.has(layer.id);
      const isFirst = core.selectedLayerIds.size > 0 && Array.from(core.selectedLayerIds)[0] === layer.id;
      item.className = `pix-layer-item${isFirst ? " active" : ""}${isSelected && !isFirst ? " multi-selected" : ""}${
        layer.locked ? " locked" : ""
      }`;
      item.dataset.idx = visualIndex;
      item.title = layer.name;

      // --- Visibility toggle ---
      const vis = document.createElement("div");
      vis.className = `pix-layer-vis${layer.visible ? " on" : ""}`;
      vis.textContent = layer.visible ? "\ud83d\udc41" : "\u25cc";
      vis.title = "Toggle visibility";
      vis.addEventListener("click", (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        vis.textContent = layer.visible ? "\ud83d\udc41" : "\u25cc";
        vis.classList.toggle("on", layer.visible);
        core.pushHistory();
        core.draw();
      });

      // --- Thumbnail ---
      const thumb = document.createElement("div");
      thumb.className = "pix-layer-thumb";
      const tCvs = document.createElement("canvas");
      tCvs.width = 26;
      tCvs.height = 26;
      if (layer.img) {
        const tCtx = tCvs.getContext("2d");
        const iw = layer.img.naturalWidth || layer.img.width;
        const ih = layer.img.naturalHeight || layer.img.height;
        if (iw && ih) {
          const scale = Math.min(26 / iw, 26 / ih);
          const dw = iw * scale,
            dh = ih * scale;
          tCtx.drawImage(layer.img, (26 - dw) / 2, (26 - dh) / 2, dw, dh);
        }
      }
      thumb.appendChild(tCvs);

      // --- Name (double-click to rename) ---
      const name = document.createElement("div");
      name.className = "pix-layer-name";
      name.textContent = layer.name;
      name.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const inp = document.createElement("input");
        inp.className = "pix-layer-rename-input";
        inp.value = layer.name;
        name.replaceWith(inp);
        inp.focus();
        inp.select();
        const finish = () => {
          layer.name = inp.value.trim() || layer.name;
          inp.replaceWith(name);
          name.textContent = layer.name;
          core.pushHistory();
        };
        inp.addEventListener("blur", finish);
        inp.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === "Escape") finish();
        });
      });

      // --- Lock toggle ---
      const lock = document.createElement("div");
      lock.className = `pix-layer-lock${layer.locked ? " locked" : ""}`;
      lock.textContent = layer.locked ? "\ud83d\udd12" : "\ud83d\udd13";
      lock.title = layer.locked ? "Unlock" : "Lock layer";
      lock.addEventListener("click", (e) => {
        e.stopPropagation();
        layer.locked = !layer.locked;
        lock.textContent = layer.locked ? "\ud83d\udd12" : "\ud83d\udd13";
        lock.classList.toggle("locked", layer.locked);
        core.pushHistory();
        core.draw();
      });

      item.append(vis, thumb, name, lock);

      // --- Click to select ---
      item.addEventListener("click", (e) => {
        if (e.detail > 1) return; // let dblclick handle
        if (
          e.target.classList.contains("pix-layer-vis") ||
          e.target.classList.contains("pix-layer-lock") ||
          e.target.tagName === "INPUT"
        )
          return;
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          if (core.selectedLayerIds.has(layer.id)) core.selectedLayerIds.delete(layer.id);
          else core.selectedLayerIds.add(layer.id);
        } else {
          core.selectedLayerIds.clear();
          core.selectedLayerIds.add(layer.id);
        }
        core.syncActiveLayerIndex();
        this.updateActiveLayerUI();
        core.draw();
      });

      // --- Drag & drop reordering (smart before/after like Paint) ---
      item.draggable = true;
      item.addEventListener("dragstart", (e) => {
        this._dragFromVisual = visualIndex;
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => item.classList.add("pix-dragging"), 0);
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("pix-dragging");
      });
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const mid = item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
        core.layersList.querySelectorAll(".pix-layer-item").forEach((it) => {
          it.classList.remove("pix-drag-over-top", "pix-drag-over-bottom");
        });
        item.classList.add(e.clientY < mid ? "pix-drag-over-top" : "pix-drag-over-bottom");
      });
      item.addEventListener("dragleave", () => {
        item.classList.remove("pix-drag-over-top", "pix-drag-over-bottom");
      });
      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("pix-drag-over-top", "pix-drag-over-bottom");
        const fromVisual = this._dragFromVisual;
        if (fromVisual === null || fromVisual === undefined || fromVisual === visualIndex) return;
        const mid = item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
        const insertBefore = e.clientY < mid;
        // Convert visual indices to actual array indices (reversed)
        const fromActual = core.layers.length - 1 - fromVisual;
        let toVisual = insertBefore ? visualIndex : visualIndex + 1;
        if (fromVisual < visualIndex) toVisual--;
        const toActual = core.layers.length - 1 - toVisual;
        const movedLayer = core.layers.splice(fromActual, 1)[0];
        core.layers.splice(Math.max(0, toActual), 0, movedLayer);
        this._dragFromVisual = null;
        core.pushHistory();
        core.syncActiveLayerIndex();
        this.updateActiveLayerUI();
        core.draw();
      });

      core.layersList.appendChild(item);
    });
  }

  moveLayer(dir) {
    const core = this.core;
    if (core.selectedLayerIds.size === 0) return;
    const firstId = Array.from(core.selectedLayerIds)[0];
    const idx = core.layers.findIndex((l) => l.id === firstId);
    if (idx < 0) return;
    // dir: -1 = move down in array (visually up), +1 = move up in array (visually down)
    // Since layers are reversed in display, "up" visually = higher index in array
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= core.layers.length) return;
    [core.layers[idx], core.layers[newIdx]] = [core.layers[newIdx], core.layers[idx]];
    core.pushHistory();
    core.syncActiveLayerIndex();
    this.updateActiveLayerUI();
    core.draw();
  }

  // build() removed — UI construction is now handled by PixaromaEditor hook methods.
  _removed_build() {
    const core = this.core;
    const existingEditor = document.getElementById("pixaroma-editor-instance");
    if (existingEditor) document.body.removeChild(existingEditor);

    if (!document.getElementById("pixaroma-styles-v14")) {
      const style = document.createElement("style");
      style.id = "pixaroma-styles-v14";
      style.innerHTML = `
                .pix-editor { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #131415; z-index: 10000; display: flex; flex-direction: row; font-family: sans-serif; color: #ececec; user-select: none; pointer-events: auto; }
                .pix-sidebar-left { width: 310px; background: #242628; display: flex; flex-direction: column; border-right: 1px solid #3a3d40; padding: 15px; box-sizing: border-box; overflow-y: auto; z-index: 2; }
                .pix-sidebar-right { width: 300px; background: #242628; display: flex; flex-direction: column; border-left: 1px solid #3a3d40; padding: 15px; box-sizing: border-box; overflow-y: auto; z-index: 2; gap: 10px; }
                .pix-workspace { flex: 1; position: relative; overflow: hidden; background: #1a1c1d; cursor: default; }
                .pix-workspace.panning { cursor: grabbing !important; }
                .pix-canvas-container { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(1); transform-origin: center center; box-shadow: 0 10px 50px rgba(0,0,0,0.8); overflow: visible; }
                .pix-canvas { width: 100%; height: 100%; display: block; background-color: #1e1e1e; }
                .pix-top-bar { position: absolute; top: 20px; right: 20px; display: flex; gap: 10px; z-index: 10; }
                .pix-align-bar { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; background: rgba(36,38,40,0.9); padding: 8px 15px; border-radius: 8px; border: 1px solid #3a3d40; z-index: 10; box-shadow: 0 4px 15px rgba(0,0,0,0.5); backdrop-filter: blur(5px); align-items: center; }
                .pix-view-controls { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; background: rgba(36,38,40,0.9); padding: 8px 15px; border-radius: 8px; border: 1px solid #3a3d40; z-index: 10; box-shadow: 0 4px 15px rgba(0,0,0,0.5); backdrop-filter: blur(5px); }
                .pix-view-btn { background: transparent; border: none; color: white; cursor: pointer; font-size: 16px; padding: 5px 10px; border-radius: 4px; transition: 0.2s; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 5px; }
                .pix-view-btn:hover { background: #3a3d40; color: #f66744; }
                .pix-view-btn:disabled { opacity: 0.3 !important; cursor: not-allowed; }
                .pix-header { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #3a3d40; }
                .pix-logo-text { font-size: 18px; font-weight: 900; color: #fff; letter-spacing: 0.5px; }
                .pix-logo-accent { color: #f66744; }
                .pix-panel { background: #1a1c1d; border: 1px solid #3a3d40; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
                .pix-panel-title { font-size: 12px; text-transform: uppercase; color: #888; font-weight: bold; margin-bottom: 12px; letter-spacing: 0.5px; }
                .pix-row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; width: 100%; }
                .pix-col { display: flex; flex-direction: column; flex: 1; }
                .pix-label { font-size: 11px; color: #aaa; margin-bottom: 4px; }
                .pix-input { background: #131415; border: 1px solid #3a3d40; color: white; padding: 8px; border-radius: 4px; width: 100%; box-sizing: border-box; outline: none; font-size: 12px; }
                .pix-input:focus { border-color: #f66744; }
                .pix-input-num { width: 55px; text-align: center; font-size: 11px; padding: 6px; }
                .pix-btn { background: #3a3d40; border: none; color: white; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s; display: flex; justify-content: center; align-items: center; box-sizing: border-box; flex: 1; }
                .pix-btn:hover { background: #4a4d50; }
                .pix-btn-active { background: #f66744 !important; color: white; }
                .pix-btn-active:hover { background: #e05535 !important; }
                .pix-btn-accent { background: #f66744; color: #fff; width: 100%; font-size: 14px; padding: 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s; }
                .pix-btn-accent:hover { background: #e05535; }
                .pix-btn-danger { background: #dc2626; color: white; border: none; }
                .pix-btn-danger:hover { background: #b91c1c; }
                input[type=range] { -webkit-appearance: none; width: 100%; background: transparent; flex: 1; }
                input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 16px; width: 16px; border-radius: 50%; background: #f66744; cursor: pointer; margin-top: -6px; }
                input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 4px; cursor: pointer; background: #3a3d40; border-radius: 2px; }
                .pix-layers-list { display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; padding-right: 5px; }
                .pix-layer-item { display: flex; align-items: center; gap: 4px; padding: 4px 5px; border-radius: 3px; cursor: pointer; border: 1px solid transparent; transition: all .1s; }
                .pix-layer-item:hover { background: #222426; }
                .pix-layer-item.active { background: #2a1800; border-color: #f66744; }
                .pix-layer-item.multi-selected { background: #0a1a2a; border-color: #0ea5e9; }
                .pix-layer-item.pix-drag-over-top { border-top: 2px solid #f66744 !important; }
                .pix-layer-item.pix-drag-over-bottom { border-bottom: 2px solid #f66744 !important; }
                .pix-layer-item.pix-dragging { opacity: 0.35; }
                .pix-layer-vis { cursor: pointer; font-size: 12px; color: #666; flex-shrink: 0; width: 16px; text-align: center; }
                .pix-layer-vis.on { color: #ccc; }
                .pix-layer-thumb { width: 26px; height: 26px; flex-shrink: 0; border-radius: 2px; border: 1px solid #333; overflow: hidden; background: repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 0 0/8px 8px; }
                .pix-layer-name { flex: 1; font-size: 10px; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; cursor: default; }
                .pix-layer-lock { font-size: 11px; color: #666; cursor: pointer; flex-shrink: 0; }
                .pix-layer-lock.locked { color: #f66744; }
                .pix-layer-item.locked .pix-layer-name { color: #888; }
                .pix-layer-rename-input { flex: 1; background: #111; color: #e0e0e0; border: 1px solid #f66744; border-radius: 3px; padding: 2px 4px; font-size: 10px; min-width: 0; outline: none; }
                .pix-layer-actions { display: flex; gap: 4px; padding: 5px 0; border-top: 1px solid #2a2c2e; flex-shrink: 0; flex-wrap: wrap; }
                .pix-layer-actions .pix-btn { font-size: 12px; padding: 4px 8px; min-width: 28px; flex: 0 0 auto; }
                .pix-eraser-divider { height: 1px; background: #3a3d40; margin: 10px 0; }
                .pix-hint { font-size: 10px; color: #666; margin-top: 4px; }
            `;
      document.head.appendChild(style);
    }

    core.overlay = document.createElement("div");
    core.overlay.className = "pix-editor";
    core.overlay.id = "pixaroma-editor-instance";
    core.overlay.addEventListener("contextmenu", (e) => e.preventDefault());

    // =====================================================================
    // LEFT SIDEBAR
    // =====================================================================
    const sidebarLeft = document.createElement("div");
    sidebarLeft.className = "pix-sidebar-left";
    sidebarLeft.innerHTML = `<div class="pix-header"><div class="pix-logo-text"><img src="/pixaroma/assets/pixaroma_logo.svg" style="width:20px;height:20px;vertical-align:middle;margin-right:6px;">Image Composer <span class="pix-logo-accent">Pixaroma</span></div></div>`;

    // --- 1. Document Setup (first, most important) ---
    const docPanel = document.createElement("div");
    docPanel.className = "pix-panel";
    docPanel.innerHTML = `<div class="pix-panel-title">Document Setup</div>`;

    const ratioRow = document.createElement("div");
    ratioRow.className = "pix-row";
    core.ratioSelect = document.createElement("select");
    core.ratioSelect.className = "pix-input";
    core.ratioSelect.innerHTML = `
            <option value="custom">Custom (Free)</option>
            <option value="1:1">1:1 Square</option>
            <option value="16:9">16:9 Landscape</option>
            <option value="9:16">9:16 Portrait</option>
            <option value="3:2">3:2 Photo</option>
            <option value="2:3">2:3 Poster</option>`;
    ratioRow.appendChild(core.ratioSelect);

    const docRow = document.createElement("div");
    docRow.className = "pix-row";
    const colW = document.createElement("div");
    colW.className = "pix-col";
    colW.innerHTML = `<div class="pix-label">Width (px)</div>`;
    core.docWInput = document.createElement("input");
    core.docWInput.type = "number";
    core.docWInput.className = "pix-input";
    core.docWInput.value = core.docWidth;
    colW.appendChild(core.docWInput);
    const colH = document.createElement("div");
    colH.className = "pix-col";
    colH.innerHTML = `<div class="pix-label">Height (px)</div>`;
    core.docHInput = document.createElement("input");
    core.docHInput.type = "number";
    core.docHInput.className = "pix-input";
    core.docHInput.value = core.docHeight;
    colH.appendChild(core.docHInput);
    docRow.append(colW, colH);
    docPanel.append(ratioRow, docRow);
    sidebarLeft.appendChild(docPanel);

    // --- 2. Workspace Content (add images) ---
    const addPanel = document.createElement("div");
    addPanel.className = "pix-panel";
    addPanel.innerHTML = `<div class="pix-panel-title">Workspace Content</div>`;
    core.uploadBtn = document.createElement("input");
    core.uploadBtn.type = "file";
    core.uploadBtn.accept = "image/*";
    core.uploadBtn.style.display = "none";
    const uploadTrigger = document.createElement("button");
    uploadTrigger.className = "pix-btn";
    uploadTrigger.style.width = "100%";
    uploadTrigger.innerHTML = `🖼️ Add Image Layer`;
    uploadTrigger.onclick = () => core.uploadBtn.click();
    const clearBtn = document.createElement("button");
    clearBtn.className = "pix-btn";
    clearBtn.style.width = "100%";
    clearBtn.style.marginTop = "8px";
    clearBtn.innerHTML = `🗑️ Clear Canvas`;
    clearBtn.onclick = () => {
      core.layers = [];
      core.selectedLayerIds.clear();
      core.syncActiveLayerIndex();
      this.updateActiveLayerUI();
      core.draw();
      core.pushHistory();
    };
    addPanel.append(core.uploadBtn, uploadTrigger, clearBtn);
    sidebarLeft.appendChild(addPanel);

    // --- 3. Transform Properties (visible only when a layer is selected) ---
    core.toolsPanel = document.createElement("div");
    core.toolsPanel.className = "pix-panel";
    core.toolsPanel.style.opacity = "0.3";
    core.toolsPanel.style.pointerEvents = "none";
    core.toolsPanel.innerHTML = `<div class="pix-panel-title">Transform Properties</div>`;

    const fitRow = document.createElement("div");
    fitRow.className = "pix-row";
    core.btnFitW = document.createElement("button");
    core.btnFitW.className = "pix-btn";
    core.btnFitW.innerText = "↔ Fit Width";
    core.btnFitH = document.createElement("button");
    core.btnFitH.className = "pix-btn";
    core.btnFitH.innerText = "↕ Fit Height";
    fitRow.append(core.btnFitW, core.btnFitH);

    const flipRow = document.createElement("div");
    flipRow.className = "pix-row";
    core.btnFlipH = document.createElement("button");
    core.btnFlipH.className = "pix-btn";
    core.btnFlipH.innerText = "◧ Flip H";
    core.btnFlipV = document.createElement("button");
    core.btnFlipV.className = "pix-btn";
    core.btnFlipV.innerText = "⬒ Flip V";
    flipRow.append(core.btnFlipH, core.btnFlipV);

    const rotRow = document.createElement("div");
    rotRow.className = "pix-row";
    core.btnRotLeft = document.createElement("button");
    core.btnRotLeft.className = "pix-btn";
    core.btnRotLeft.innerText = "↺ -90°";
    core.btnRotRight = document.createElement("button");
    core.btnRotRight.className = "pix-btn";
    core.btnRotRight.innerText = "↻ +90°";
    rotRow.append(core.btnRotLeft, core.btnRotRight);

    core.btnReset = document.createElement("button");
    core.btnReset.className = "pix-btn";
    core.btnReset.innerText = "🔄 Reset Transform";
    core.btnReset.style.width = "100%";
    core.btnReset.style.marginBottom = "15px";

    const rangeRow = document.createElement("div");
    rangeRow.className = "pix-panel";
    rangeRow.style.padding = "10px";
    rangeRow.style.background = "#131415";

    const rotateLabel = document.createElement("div");
    rotateLabel.className = "pix-label";
    rotateLabel.innerText = "Rotate (degrees)";
    const rotWrap = document.createElement("div");
    rotWrap.className = "pix-row";
    core.rotateSlider = document.createElement("input");
    core.rotateSlider.type = "range";
    core.rotateSlider.min = "0";
    core.rotateSlider.max = "360";
    core.rotateSlider.step = "1";
    core.rotateSlider.value = "0";
    core.rotateNum = document.createElement("input");
    core.rotateNum.type = "number";
    core.rotateNum.className = "pix-input pix-input-num";
    core.rotateNum.min = "0";
    core.rotateNum.max = "360";
    rotWrap.append(core.rotateSlider, core.rotateNum);

    const scaleLabel = document.createElement("div");
    scaleLabel.className = "pix-label";
    scaleLabel.innerText = "Uniform Scale (%)";
    scaleLabel.style.marginTop = "10px";
    const scaleWrap = document.createElement("div");
    scaleWrap.className = "pix-row";
    core.scaleSlider = document.createElement("input");
    core.scaleSlider.type = "range";
    core.scaleSlider.min = "5";
    core.scaleSlider.max = "300";
    core.scaleSlider.step = "1";
    core.scaleSlider.value = "100";
    core.scaleNum = document.createElement("input");
    core.scaleNum.type = "number";
    core.scaleNum.className = "pix-input pix-input-num";
    core.scaleNum.min = "5";
    core.scaleNum.max = "300";
    scaleWrap.append(core.scaleSlider, core.scaleNum);

    const stretchRow = document.createElement("div");
    stretchRow.className = "pix-row";
    stretchRow.style.marginTop = "10px";
    stretchRow.style.borderTop = "1px solid #3a3d40";
    stretchRow.style.paddingTop = "10px";
    const colSH = document.createElement("div");
    colSH.className = "pix-col";
    colSH.innerHTML = `<div class="pix-label">Stretch Horiz (%)</div>`;
    const wrapSH = document.createElement("div");
    wrapSH.className = "pix-row";
    core.stretchHSlider = document.createElement("input");
    core.stretchHSlider.type = "range";
    core.stretchHSlider.min = "5";
    core.stretchHSlider.max = "300";
    core.stretchHSlider.step = "1";
    core.stretchHSlider.value = "100";
    core.stretchHNum = document.createElement("input");
    core.stretchHNum.type = "number";
    core.stretchHNum.className = "pix-input pix-input-num";
    core.stretchHNum.value = "100";
    wrapSH.append(core.stretchHSlider, core.stretchHNum);
    colSH.appendChild(wrapSH);
    stretchRow.append(colSH);

    const stretchRowV = document.createElement("div");
    stretchRowV.className = "pix-row";
    const colSV = document.createElement("div");
    colSV.className = "pix-col";
    colSV.innerHTML = `<div class="pix-label">Stretch Vert (%)</div>`;
    const wrapSV = document.createElement("div");
    wrapSV.className = "pix-row";
    core.stretchVSlider = document.createElement("input");
    core.stretchVSlider.type = "range";
    core.stretchVSlider.min = "5";
    core.stretchVSlider.max = "300";
    core.stretchVSlider.step = "1";
    core.stretchVSlider.value = "100";
    core.stretchVNum = document.createElement("input");
    core.stretchVNum.type = "number";
    core.stretchVNum.className = "pix-input pix-input-num";
    core.stretchVNum.value = "100";
    wrapSV.append(core.stretchVSlider, core.stretchVNum);
    colSV.appendChild(wrapSV);
    stretchRowV.append(colSV);

    const opacityLabel = document.createElement("div");
    opacityLabel.className = "pix-label";
    opacityLabel.innerText = "Opacity (%)";
    opacityLabel.style.marginTop = "10px";
    const opWrap = document.createElement("div");
    opWrap.className = "pix-row";
    core.opacitySlider = document.createElement("input");
    core.opacitySlider.type = "range";
    core.opacitySlider.min = "0";
    core.opacitySlider.max = "100";
    core.opacitySlider.step = "1";
    core.opacitySlider.value = "100";
    core.opacityNum = document.createElement("input");
    core.opacityNum.type = "number";
    core.opacityNum.className = "pix-input pix-input-num";
    core.opacityNum.min = "0";
    core.opacityNum.max = "100";
    opWrap.append(core.opacitySlider, core.opacityNum);

    rangeRow.append(rotateLabel, rotWrap, scaleLabel, scaleWrap, stretchRow, stretchRowV, opacityLabel, opWrap);
    core.toolsPanel.append(fitRow, flipRow, rotRow, core.btnReset, rangeRow);
    sidebarLeft.appendChild(core.toolsPanel);

    // Status bar (bottom of left sidebar)
    core.statusText = document.createElement("div");
    core.statusText.style.cssText =
      "font-size:11px; color:#888; padding:10px 4px 4px 4px; text-align:center; margin-top:auto; border-top:1px solid #3a3d40;";
    core.statusText.innerText = "Ready.";
    sidebarLeft.appendChild(core.statusText);

    // =====================================================================
    // CANVAS / WORKSPACE
    // =====================================================================
    core.workspace = document.createElement("div");
    core.workspace.className = "pix-workspace";
    core.canvasContainer = document.createElement("div");
    core.canvasContainer.className = "pix-canvas-container";
    core.canvasContainer.style.width = core.docWidth + "px";
    core.canvasContainer.style.height = core.docHeight + "px";
    core.canvas = document.createElement("canvas");
    core.canvas.className = "pix-canvas";
    core.canvas.width = core.docWidth;
    core.canvas.height = core.docHeight;
    core.ctx = core.canvas.getContext("2d");
    core.canvasContainer.appendChild(core.canvas);
    core.workspace.appendChild(core.canvasContainer);

    // Align bar (top-center of workspace)
    const alignBar = document.createElement("div");
    alignBar.className = "pix-align-bar";
    alignBar.innerHTML = `
            <span class="pix-label" style="margin:0 10px 0 0; color:#fff;">Align:</span>
            <button class="pix-view-btn" id="btnAlignL" title="Align Left">⇤</button>
            <button class="pix-view-btn" id="btnAlignCH" title="Align Center Horizontally">⬌</button>
            <button class="pix-view-btn" id="btnAlignR" title="Align Right">⇥</button>
            <div style="width:1px; height:20px; background:#3a3d40; margin:0 5px;"></div>
            <button class="pix-view-btn" id="btnAlignT" title="Align Top">⤒</button>
            <button class="pix-view-btn" id="btnAlignCV" title="Align Center Vertically">⬍</button>
            <button class="pix-view-btn" id="btnAlignB" title="Align Bottom">⤓</button>
            <div style="width:1px; height:20px; background:#3a3d40; margin:0 5px;"></div>
            <button class="pix-view-btn" id="btnDistH" title="Distribute Horizontally" style="font-size:11px; letter-spacing:2px; font-weight:900;">|||</button>
            <button class="pix-view-btn" id="btnDistV" title="Distribute Vertically" style="font-size:16px; font-weight:900;">☰</button>
        `;
    core.workspace.appendChild(alignBar);

    // Undo / Redo / Help (top-right of workspace)
    const topBar = document.createElement("div");
    topBar.className = "pix-top-bar";
    core.btnUndo = document.createElement("button");
    core.btnUndo.className = "pix-view-btn";
    core.btnUndo.innerHTML = "↩ Undo";
    core.btnUndo.style.background = "rgba(36,38,40,0.9)";
    core.btnRedo = document.createElement("button");
    core.btnRedo.className = "pix-view-btn";
    core.btnRedo.innerHTML = "↪ Redo";
    core.btnRedo.style.background = "rgba(36,38,40,0.9)";
    core.btnHelp = document.createElement("button");
    core.btnHelp.className = "pix-view-btn";
    core.btnHelp.innerHTML = "❓ Help";
    core.btnHelp.style.background = "rgba(36,38,40,0.9)";
    core.btnUndo.onclick = () => core.undo();
    core.btnRedo.onclick = () => core.redo();
    topBar.append(core.btnUndo, core.btnRedo, core.btnHelp);
    core.workspace.appendChild(topBar);

    // Help panel
    core.helpPanel = document.createElement("div");
    core.helpPanel.style.cssText =
      "display: none; position: absolute; top: 65px; right: 20px; width: 300px; background: rgba(36,38,40,0.95); border: 1px solid #3a3d40; border-radius: 8px; padding: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 100; backdrop-filter: blur(5px);";
    core.helpPanel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #555; padding-bottom:5px;">
                <strong style="color:#f66744; font-size:14px;">Editor Guide & Shortcuts</strong>
                <button id="pix-close-help" style="background:none; border:none; color:#aaa; cursor:pointer; font-size:14px;">✖</button>
            </div>
            <div style="font-size:12px; line-height:1.6; color:#ececec;">
                <b>🖱️ Canvas Navigation</b><br>
                • <b>Space + Drag</b> or <b>Middle-Click</b> to Pan.<br>
                • <b>Scroll Wheel</b> to Zoom In/Out.<br><br>
                <b>🔲 Selection</b><br>
                • Click any layer on canvas or in the Layers panel to select it.<br>
                • <b>Shift / Ctrl + Click</b> to multi-select.<br>
                • <b>Alt + Drag</b> to duplicate a layer.<br>
                • <b>Drag Corners</b> to scale uniformly.<br><br>
                <b>✖️ Eraser</b><br>
                • Select a layer first, then click <b>Enable Eraser</b> (or press <b>E</b>).<br>
                • Press <b>E</b> again (or click the button) to switch back to Select.<br>
                • <b>Reset Mask</b> fully restores the layer's original pixels.<br><br>
                <b>⌨️ Keyboard Shortcuts</b><br>
                • <b>E</b>: Toggle Eraser on/off<br>
                • <b>V</b>: Return to Select mode<br>
                • <b>Ctrl + Z / Ctrl + Y</b>: Undo / Redo<br>
                • <b>Delete</b>: Remove selected layer(s)<br><br>
                <b>📑 Layers Panel</b><br>
                • Click to select, <b>Ctrl+Click</b> for multi-select.<br>
                • <b>Double-click</b> name to rename.<br>
                • <b>Drag</b> to reorder layers.<br>
                • Use <b>▲/▼</b> buttons to move up/down.
            </div>
        `;
    core.workspace.appendChild(core.helpPanel);
    core.btnHelp.onclick = () => {
      core.helpPanel.style.display = core.helpPanel.style.display === "none" ? "block" : "none";
    };
    core.helpPanel.querySelector("#pix-close-help").onclick = () => {
      core.helpPanel.style.display = "none";
    };

    // Zoom controls (bottom-center of workspace)
    const viewControls = document.createElement("div");
    viewControls.className = "pix-view-controls";
    const btnZoomOut = document.createElement("button");
    btnZoomOut.className = "pix-view-btn";
    btnZoomOut.innerHTML = "➖";
    btnZoomOut.title = "Zoom Out";
    const btnZoomFit = document.createElement("button");
    btnZoomFit.className = "pix-view-btn";
    btnZoomFit.innerHTML = "🔲 Fit View";
    btnZoomFit.title = "Fit to Screen";
    const btnZoomIn = document.createElement("button");
    btnZoomIn.className = "pix-view-btn";
    btnZoomIn.innerHTML = "➕";
    btnZoomIn.title = "Zoom In";
    btnZoomOut.onclick = () => {
      core.viewZoom *= 0.8;
      core.updateViewTransform();
    };
    btnZoomIn.onclick = () => {
      core.viewZoom *= 1.2;
      core.updateViewTransform();
    };
    btnZoomFit.onclick = () => core.fitViewToWorkspace();
    viewControls.append(btnZoomOut, btnZoomFit, btnZoomIn);
    core.workspace.appendChild(viewControls);

    // =====================================================================
    // RIGHT SIDEBAR
    // =====================================================================
    const sidebarRight = document.createElement("div");
    sidebarRight.className = "pix-sidebar-right";

    // --- 1. Layers Stack ---
    core.layersListPanel = document.createElement("div");
    core.layersListPanel.className = "pix-panel";
    core.layersListPanel.style.flex = "1";
    core.layersListPanel.style.display = "flex";
    core.layersListPanel.style.flexDirection = "column";
    core.layersListPanel.innerHTML = `<div class="pix-panel-title">Layers</div>`;
    core.layersList = document.createElement("div");
    core.layersList.className = "pix-layers-list";
    core.layersListPanel.appendChild(core.layersList);

    // Layer action buttons row (like Paint node)
    const actRow = document.createElement("div");
    actRow.className = "pix-layer-actions";
    const mkBtn = (label, fn, cls) => {
      const b = document.createElement("button");
      b.className = cls || "pix-btn";
      b.innerHTML = label;
      b.addEventListener("click", fn);
      return b;
    };
    const addBtn = mkBtn("+", () => core.uploadBtn.click());
    addBtn.title = "Add image layer";
    core.btnDupLayer = mkBtn("\u2398", () => {});
    core.btnDupLayer.title = "Duplicate layer";
    core.btnDupLayer.style.opacity = "0.3";
    core.btnDelLayer = mkBtn("\ud83d\uddd1", () => {}, "pix-btn pix-btn-danger");
    core.btnDelLayer.title = "Delete layer";
    core.btnDelLayer.style.opacity = "0.3";
    const upBtn = mkBtn("\u25b2", () => this.moveLayer(1));
    upBtn.title = "Move layer up";
    const dnBtn = mkBtn("\u25bc", () => this.moveLayer(-1));
    dnBtn.title = "Move layer down";
    actRow.append(addBtn, core.btnDupLayer, core.btnDelLayer, upBtn, dnBtn);
    core.layersListPanel.appendChild(actRow);
    sidebarRight.appendChild(core.layersListPanel);

    // --- 3. Eraser Panel (contextual — dimmed until a layer is selected) ---
    core.eraserPanel = document.createElement("div");
    core.eraserPanel.className = "pix-panel";
    core.eraserPanel.style.opacity = "0.3";
    core.eraserPanel.style.pointerEvents = "none";
    core.eraserPanel.style.marginBottom = "0";

    const eraserTitleRow = document.createElement("div");
    eraserTitleRow.style.display = "flex";
    eraserTitleRow.style.justifyContent = "space-between";
    eraserTitleRow.style.alignItems = "center";
    eraserTitleRow.style.marginBottom = "12px";
    const eraserTitle = document.createElement("div");
    eraserTitle.className = "pix-panel-title";
    eraserTitle.style.margin = "0";
    eraserTitle.innerText = "ERASER";

    // Toggle eraser on/off — replaces the old tool tab
    core.btnEraserToggle = document.createElement("button");
    core.btnEraserToggle.className = "pix-btn";
    core.btnEraserToggle.style.flex = "0 0 auto";
    core.btnEraserToggle.style.fontSize = "11px";
    core.btnEraserToggle.style.padding = "4px 10px";
    core.btnEraserToggle.innerText = "Enable  [E]";
    core.btnEraserToggle.onclick = () => {
      if (core.activeMode === "eraser") {
        core.setMode(null);
      } else {
        core.setMode("eraser");
      }
    };
    eraserTitleRow.append(eraserTitle, core.btnEraserToggle);
    core.eraserPanel.appendChild(eraserTitleRow);

    // Brush Size
    const sizeLabel = document.createElement("div");
    sizeLabel.className = "pix-label";
    sizeLabel.innerText = "Brush Size";
    const sizeWrap = document.createElement("div");
    sizeWrap.className = "pix-row";
    sizeWrap.style.marginBottom = "10px";
    core.brushSizeSlider = document.createElement("input");
    core.brushSizeSlider.type = "range";
    core.brushSizeSlider.min = "1";
    core.brushSizeSlider.max = "200";
    core.brushSizeSlider.value = core.brushSize;
    core.brushSizeNum = document.createElement("input");
    core.brushSizeNum.type = "number";
    core.brushSizeNum.className = "pix-input pix-input-num";
    core.brushSizeNum.value = core.brushSize;
    sizeWrap.append(core.brushSizeSlider, core.brushSizeNum);

    // Brush Hardness
    const hardLabel = document.createElement("div");
    hardLabel.className = "pix-label";
    hardLabel.innerText = "Hardness";
    const hardnessWrap = document.createElement("div");
    hardnessWrap.className = "pix-row";
    hardnessWrap.style.marginBottom = "10px";
    core.brushHardnessSlider = document.createElement("input");
    core.brushHardnessSlider.type = "range";
    core.brushHardnessSlider.min = "0";
    core.brushHardnessSlider.max = "100";
    core.brushHardnessSlider.value = Math.round(core.brushHardness * 100);
    core.brushHardnessNum = document.createElement("input");
    core.brushHardnessNum.type = "number";
    core.brushHardnessNum.className = "pix-input pix-input-num";
    core.brushHardnessNum.value = Math.round(core.brushHardness * 100);
    hardnessWrap.append(core.brushHardnessSlider, core.brushHardnessNum);

    // Reset Eraser Mask
    const eraserDivider = document.createElement("div");
    eraserDivider.className = "pix-eraser-divider";
    core.btnResetEraser = document.createElement("button");
    core.btnResetEraser.className = "pix-btn";
    core.btnResetEraser.innerText = "🔄 Reset Eraser Mask";
    core.btnResetEraser.style.width = "100%";
    core.btnResetEraser.style.marginTop = "2px";
    core.btnResetEraser.style.opacity = "0.3";
    core.btnResetEraser.disabled = true;
    core.btnResetEraser.title = "Restore all erased pixels on this layer";
    core.btnResetEraser.onclick = () => {
      if (core.selectedLayerIds.size === 0) return;
      // Only reset mask on the selected layer(s), not all
      let cleared = false;
      for (const id of core.selectedLayerIds) {
        const layer = core.layers.find((l) => l.id === id);
        if (layer && layer.hasMask_internal) {
          core.clearEraserMask(layer, true);
          cleared = true;
        }
      }
      if (cleared) {
        this.updateActiveLayerUI();
        core.draw();
        core.pushHistory();
      }
    };

    core.eraserPanel.append(sizeLabel, sizeWrap, hardLabel, hardnessWrap, eraserDivider, core.btnResetEraser);
    sidebarRight.appendChild(core.eraserPanel);

    // --- 4. AI Remove Background ---
    core.removeBgBtn = document.createElement("button");
    core.removeBgBtn.className = "pix-btn-accent";
    core.removeBgBtn.style.opacity = "0.3";
    core.removeBgBtn.style.pointerEvents = "none";
    core.removeBgBtn.innerText = "✨ AI Remove Background";
    sidebarRight.appendChild(core.removeBgBtn);

    // --- 5. Save / Close ---
    const saveGroup = document.createElement("div");
    saveGroup.style.display = "flex";
    saveGroup.style.flexDirection = "column";
    saveGroup.style.gap = "8px";
    core.saveBtn = document.createElement("button");
    core.saveBtn.className = "pix-btn-accent";
    core.saveBtn.innerText = "💾 Save to Node";
    const closeBtn = document.createElement("button");
    closeBtn.className = "pix-btn";
    closeBtn.innerText = "✖ Close Editor";
    closeBtn.style.background = "#3a3d40";
    closeBtn.onclick = () => {
      if (core._cleanupKeys) core._cleanupKeys();
      document.body.removeChild(core.overlay);
      if (app.graph) app.graph.setDirtyCanvas(true, true);
    };
    saveGroup.append(core.saveBtn, closeBtn);
    sidebarRight.appendChild(saveGroup);

    // =====================================================================
    // ASSEMBLE
    // =====================================================================
    core.overlay.appendChild(sidebarLeft);
    core.overlay.appendChild(core.workspace);
    core.overlay.appendChild(sidebarRight);
    document.body.appendChild(core.overlay);

    // Keep brushPanel alias so core.js setMode() references still work
    core.brushPanel = core.eraserPanel;

    setTimeout(() => {
      core.fitViewToWorkspace();
      core.pushHistory();
    }, 100);
  }
}
