export class PixaromaLayers {
  static getTransformedPoints(layer) {
    // FX/adjustment layers have no image and no canvas geometry — return an
    // empty point list so hit-test / handle-drawing callers no-op for them.
    if (!layer || !layer.img) return [];
    const w = layer.img.width * layer.scaleX;
    const h = layer.img.height * layer.scaleY;
    const rad = (layer.rotation * Math.PI) / 180;

    const ptsIdentity = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
      { x: -w / 2, y: 0 },
      { x: w / 2, y: 0 },
      { x: 0, y: -h / 2 },
      { x: 0, y: h / 2 },
      { x: 0, y: -h / 2 - 30 },
    ];

    return ptsIdentity.map((p) => {
      const mx = p.x * (layer.flippedX ? -1 : 1);
      const my = p.y * (layer.flippedY ? -1 : 1);
      return {
        x: mx * Math.cos(rad) - my * Math.sin(rad) + layer.cx,
        y: mx * Math.sin(rad) + my * Math.cos(rad) + layer.cy,
      };
    });
  }

  static isPointInLayer(px, py, layer) {
    // FX/adjustment layers aren't clickable on the canvas (no geometry).
    if (!layer || !layer.img) return false;
    const w = layer.img.width * layer.scaleX;
    const h = layer.img.height * layer.scaleY;
    const rad = (layer.rotation * Math.PI) / 180;
    const dx = px - layer.cx;
    const dy = py - layer.cy;
    const unx = dx * Math.cos(-rad) - dy * Math.sin(-rad);
    const uny = dx * Math.sin(-rad) + dy * Math.cos(-rad);
    return unx >= -w / 2 && unx <= w / 2 && uny >= -h / 2 && uny <= h / 2;
  }

  static fitLayerToCanvas(layer, docWidth, docHeight, mode = "width") {
    let rad = (layer.rotation * Math.PI) / 180;
    let w = layer.img.width;
    let h = layer.img.height;
    let visualWidth = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    let visualHeight =
      Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));

    let scale = 1;
    if (mode === "width") scale = docWidth / visualWidth;
    if (mode === "height") scale = docHeight / visualHeight;

    layer.scaleX = scale;
    layer.scaleY = scale;
    layer.cx = docWidth / 2;
    layer.cy = docHeight / 2;
  }

  static captureState(layers) {
    return layers.map((l) => {
      const copy = { ...l };
      // Deep-copy cropRect so undo/redo snapshots are independent (the live
      // layer always assigns a NEW cropRect object, but be safe).
      if (l.cropRect) copy.cropRect = { ...l.cropRect };
      // Deep-copy FX adjustments so undo/redo snapshots don't alias the live
      // layer's adjustments object.
      if (l.adjustments) copy.adjustments = { ...l.adjustments };
      // Deep-copy text layer state so undo/redo snapshots are independent.
      if (l.textState) copy.textState = { ...l.textState };
      // Deep-copy eraser mask canvas so undo/redo restores mask state.
      // Clone whenever the canvas exists (NOT gated on hasMask_internal): a
      // snapshot taken after entering eraser but before the first stroke would
      // otherwise shallow-share the live canvas, so a later stroke would bleed
      // into the snapshot and undo wouldn't clear it.
      if (l.eraserMaskCanvas_internal) {
        const cloneCvs = document.createElement("canvas");
        cloneCvs.width = l.eraserMaskCanvas_internal.width;
        cloneCvs.height = l.eraserMaskCanvas_internal.height;
        const cloneCtx = cloneCvs.getContext("2d");
        cloneCtx.drawImage(l.eraserMaskCanvas_internal, 0, 0);
        copy.eraserMaskCanvas_internal = cloneCvs;
        copy.eraserMaskCtx_internal = cloneCtx;
      }
      return copy;
    });
  }
}
