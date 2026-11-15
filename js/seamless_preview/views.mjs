// Seamless Preview Pixaroma - how each view lays the picture out, as CSS background
// layers on ONE element (no canvas, no <img> grid). The browser repeats a background
// itself, so the face never draws a hairline between two tiles that is not in the
// picture: a preview whose whole job is to show a seam must not invent one.
//
// Mirrors nodes/_seamless_helpers.py tile_view (the `tiled` output). Same shapes:
//   Tile 1x1, 2x2, 3x3, Offset 1x1 moved by half both ways, Half-drop 3 columns x 2 rows
//   with the middle column moved DOWN by half, Half-brick 2 columns x 3 rows with the
//   middle row moved RIGHT by half. Parity: D:\Claude Tests\_seamless\views_parity.mjs.

export const VIEWS = ["Tile", "2x2", "3x3", "Offset", "Half-drop", "Half-brick"];

// The window the face shows, in tiles, and the background layers that fill it.
// Each layer: x / y = where one of its tiles starts (in tiles), repeat = CSS repeat.
export function viewLayout(view) {
  switch (view) {
    case "2x2": return { cols: 2, rows: 2, layers: [{ x: 0, y: 0, repeat: "repeat" }] };
    case "3x3": return { cols: 3, rows: 3, layers: [{ x: 0, y: 0, repeat: "repeat" }] };
    case "Offset": return { cols: 1, rows: 1, layers: [{ x: 0.5, y: 0.5, repeat: "repeat" }] };
    case "Half-drop":
      return {
        cols: 3, rows: 2,
        layers: [0, 1, 2].map((c) => ({ x: c, y: c % 2 ? 0.5 : 0, repeat: "repeat-y", strip: true })),
      };
    case "Half-brick":
      return {
        cols: 2, rows: 3,
        layers: [0, 1, 2].map((r) => ({ x: r % 2 ? 0.5 : 0, y: r, repeat: "repeat-x", strip: true })),
      };
    default: return { cols: 1, rows: 1, layers: [{ x: 0, y: 0, repeat: "no-repeat" }] };
  }
}

// The largest whole-pixel tile that fits the box, so tile edges land on whole CSS px.
export function fitTile(availW, availH, imgW, imgH, cols, rows) {
  if (!(availW > 0 && availH > 0 && imgW > 0 && imgH > 0)) return null;
  const aspect = imgW / imgH;
  let tw = Math.min(availW / cols, (availH / rows) * aspect);
  tw = Math.max(1, Math.floor(tw));
  const th = Math.max(1, Math.round(tw / aspect));
  return { tw, th, w: tw * cols, h: th * rows };
}

// CSS for one element: background-image / -size / -position / -repeat, every layer the
// same picture. A strip layer (Half-drop / Half-brick) repeats along ONE axis only, so
// it must not spill into its neighbours: its position is exact and its repeat is 1D.
// `guides` adds two thin lines per tile (its left and top edge) on top, same layout.
export function layerCss(url, layout, fit, guides, lineColour) {
  const imgs = [], sizes = [], pos = [], reps = [];
  const add = (img, l) => {
    imgs.push(img);
    sizes.push(`${fit.tw}px ${fit.th}px`);
    // floor, like Python's h // 2: an odd tile moves by the same whole pixel in both.
    pos.push(`${Math.floor(l.x * fit.tw)}px ${Math.floor(l.y * fit.th)}px`);
    reps.push(l.repeat);
  };
  if (guides) {
    const left = `linear-gradient(to right, ${lineColour} 1px, transparent 1px)`;
    const top = `linear-gradient(to bottom, ${lineColour} 1px, transparent 1px)`;
    for (const l of layout.layers) { add(left, l); add(top, l); }
  }
  const pic = `url("${url.replace(/"/g, "%22")}")`;
  for (const l of layout.layers) add(pic, l);
  return {
    backgroundImage: imgs.join(", "),
    backgroundSize: sizes.join(", "),
    backgroundPosition: pos.join(", "),
    backgroundRepeat: reps.join(", "),
  };
}
