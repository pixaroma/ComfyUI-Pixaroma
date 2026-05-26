# Composer FX - adjustment math (single source of truth)

All math runs on sRGB values in float **0..1**, per channel `c = (r,g,b)`, unless noted
"spatial" (reads neighbours) or "coord" (uses pixel x,y). Luma weights are Rec.709:
`L = 0.2126*r + 0.7152*g + 0.0722*b`. NO intermediate clamping - the processed result is
clamped to 0..1 once, just before the Amount blend. Pipeline order is fixed regardless of UI
order.

Implemented identically by `js/composer/fx_engine.mjs` (preview) and
`nodes/_fx_adjust_engine.py` (final render). Verify with `python scripts/fx_parity_check.py`.

## Pipeline order
Tone -> Color -> Detail (clarity, sharpness, grain) -> Effects (vignette, fade) -> Amount blend.

### Pass A - Tone (steps 1-7): applied to LUMINANCE as a ratio-preserving gain
Tone ops do NOT run per-channel. Compute luma `L`, run the curve on the SCALAR
luma to get `Lt`, then scale every channel by ONE gain. Skip the whole block if
all seven are 0.
```
Lt = L
1. exposure E:    Lt *= 2 ** (E/100)
2. brightness B:  Lt += B/200
3. contrast K:    Lt = (Lt-0.5)*(1+K/100) + 0.5
4. blacks  Bl:    Lt += (Bl/100)*0.5*clamp(1-2*Lt, 0, 1)
5. shadows Sh:    Lt += (Sh/100)*0.5*(1-Lt)^2
6. highlights Hi: Lt += (Hi/100)*0.5*Lt^2
7. whites  Wh:    Lt += (Wh/100)*0.5*clamp(2*Lt-1, 0, 1)
gain:             c *= clamp(Lt / max(L, 1e-4), 0, 4)
```
WHY luma-gain, not per-channel: per-channel tone + a final-only clamp can drive
one noisy shadow channel positive while the other two clamp to black, ISOLATING
it into a fully-saturated speckle dot (sparse JPEG/AI source noise becomes green/
blue/red confetti). A single luma gain preserves the R:G:B ratio and cannot
isolate a channel, so noise stays neutral. This is exactly why a multiplicative
exposure stays clean while an additive per-channel brightness does not.

### Pass A - Color (steps 8-12), per-channel, in this order
8. temperature T: `r += T/100*0.10;  b -= T/100*0.10`
9. tint Ti:       `g += Ti/100*0.10`
10. saturation S: `c = L + (c-L)*(1+S/100)`
11. vibrance V:   `mx=max(r,g,b); mn=min(r,g,b); sat = mx<=0 ? 0 : (mx-mn)/mx;
                   amt = (V/100)*(1-sat);  c = L + (c-L)*(1+amt)`
12. hue Hd (deg): rotate (r,g,b) by matrix M(Hd) below.
13. clarity Cl (midtone contrast, ALSO a ratio-preserving luma gain so it cannot
    speckle; NON-spatial approximation in v1):
    `m = 1 - abs(2L-1);  Lt = (L-0.5)*(1 + (Cl/100)*0.5*m) + 0.5;
     c *= clamp(Lt / max(L, 1e-4), 0, 4)`

Hue matrix M(a), a in radians = Hd*pi/180 (luminance-preserving YIQ-style):
```
cosA=cos(a); sinA=sin(a)
M = [[0.213+cosA*0.787-sinA*0.213, 0.715-cosA*0.715-sinA*0.715, 0.072-cosA*0.072+sinA*0.928],
     [0.213-cosA*0.213+sinA*0.143, 0.715+cosA*0.285+sinA*0.140, 0.072-cosA*0.072-sinA*0.283],
     [0.213-cosA*0.213-sinA*0.787, 0.715-cosA*0.715+sinA*0.715, 0.072+cosA*0.928+sinA*0.072]]
r' = M[0][0]*r+M[0][1]*g+M[0][2]*b   (etc.)
```

### Spatial pass B - sharpness Sp (reads pass-A result)
`blur = 3x3 box blur (each neighbour weight 1/9), edges replicate (clamp coords)`
`out = c + (Sp/100) * (c - blur)`   (unsharp mask, per channel)

### Per-pixel pass C (coord), on pass-B result, in this order
- grain G (coord, seeded - APPROXIMATE PREVIEW, see carve-out):
  `n = hash01(x,y,seed) - 0.5;  c += n * (G/100)*0.2`
  `hash01 = fract(sin(x*12.9898 + y*78.233 + seed*37.719) * 43758.5453)`
  Pixel pattern may differ between JS/Python; amount & character match. Exempt from
  pixel-exact parity.
- vignette Vg (coord):
  `dx=(x+0.5)/W-0.5; dy=(y+0.5)/H-0.5; rr = sqrt(dx*dx+dy*dy)/0.70710678;
   v = clamp((rr-0.5)/0.5, 0, 1);  c *= 1 - (Vg/100)*v*v`
- fade Fd:  `c = c*(1 - (Fd/100)*0.15) + (Fd/100)*0.10`

### Amount blend (clamp processed FIRST, then blend)
Keep the ORIGINAL below-pixels `orig` (already 0..1). Clamp the processed result to 0..1,
then `out = orig*(1-amount01) + processed_clamped*amount01`, then clamp 0..1 (safety),
*255, round half-up. `amount01 = layer.opacity` (0..1).

## Presets (name -> non-zero fields; all others 0)
15 cinematic looks (Original + 14), listed in grid order (5 across x 3 down).
- Original:  {}
- Cinema:    {contrast:22, saturation:8, vibrance:14, temperature:-10, tint:4, clarity:8, blacks:8}
- Vivid:     {saturation:30, vibrance:22, contrast:14, clarity:8}
- Teal:      {temperature:-30, tint:6, saturation:14, vibrance:12, contrast:8}
- Amber:     {temperature:30, contrast:14, saturation:6, highlights:-8, grain:22, fade:8}
- Sienna:    {temperature:26, saturation:-6, contrast:6, fade:24, blacks:10, highlights:-10}
- Safari:    {temperature:18, contrast:16, saturation:8, vibrance:8, clarity:12}
- Tropic:    {temperature:-8, saturation:24, vibrance:18, contrast:12, clarity:6, exposure:3}
- Bloom:     {temperature:8, saturation:18, vibrance:16, contrast:10, clarity:6}
- Forest:    {contrast:24, blacks:18, shadows:-10, saturation:-16, tint:8, temperature:-6, vignette:22, clarity:8}
- Emerald:   {contrast:14, saturation:-10, tint:14, temperature:-6, blacks:10, fade:8}
- Nordic:    {contrast:10, saturation:-8, temperature:-12, tint:10, fade:16, blacks:8, highlights:-6}
- Airy:      {exposure:6, brightness:8, contrast:-8, fade:18, blacks:12, highlights:-8, saturation:-4}
- Crisp:     {contrast:16, clarity:16, sharpness:12, saturation:10, vibrance:8}
- Street:    {contrast:26, blacks:20, saturation:-14, clarity:12, sharpness:8, vignette:14}

## Parity & carve-out
JS and Python MUST produce identical output (within rounding, tolerance 1/255) for every
adjustment and preset EXCEPT grain (different RNGs). When changing any formula: update THIS
doc first, then both engines, then re-run `python scripts/fx_parity_check.py`.
