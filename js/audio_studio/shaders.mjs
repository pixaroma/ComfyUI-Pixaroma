// js/audio_studio/shaders.mjs
"use strict";

/* All shaders use:
 *   uniform sampler2D u_image;       — source image (RGBA8 or RGB8)
 *   uniform sampler2D u_envelope;    — RGBA32F texture, 1×N, R/G/B/A = full/bass/mids/treble
 *   uniform sampler2D u_onset;       — RGBA32F texture, same shape as envelope
 *   uniform int   u_total_frames;    — size of the envelope/onset texture
 *   uniform int   u_frame_index;     — current frame [0, u_total_frames)
 *   uniform int   u_audio_band_idx;  — 0=full, 1=bass, 2=mids, 3=treble
 *   uniform float u_intensity;
 *   uniform float u_motion_speed;
 *   uniform float u_t;               — current frame_index / fps
 *   uniform float u_aspect;          — W / H
 *   uniform vec2  u_resolution;      — (W, H) in pixels
 */

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;     // [-1,1] → [0,1]
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const COMMON_PRELUDE = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
uniform sampler2D u_envelope;
uniform sampler2D u_onset;
uniform int   u_total_frames;
uniform int   u_frame_index;
uniform int   u_audio_band_idx;
uniform float u_intensity;
uniform float u_motion_speed;
uniform float u_motion_direction;   // +1 default, -1 reverses rotational/wave axis
uniform float u_t;
uniform float u_aspect;
uniform vec2  u_resolution;

// Per-mode params — declared globally so each shader can opt in. Unused
// uniforms get optimized out of programs that don't reference them.
uniform int   u_shake_axis;          // 0=both, 1=x-only, 2=y-only
uniform float u_ripple_density;       // multiplier on ripple's k (default 1.0)
uniform float u_slit_density;         // multiplier on slit_scan's k (default 1.0)
uniform float u_glitch_bands;         // motion glitch — number of horizontal bands
uniform float u_wave_density;         // multiplier on wave's k (default 1.0)
uniform float u_pixelate_blocks;      // motion pixelate — block count at peak
uniform int   u_squeeze_axis;         // 0=x, 1=y

// NOTE: parameter is named 'tex' not 'sample' — 'sample' is a reserved
// word in GLSL ES 3.00 (sample-rate qualifier).
float read_band(vec4 tex, int idx) {
    if (idx == 0) return tex.r;
    if (idx == 1) return tex.g;
    if (idx == 2) return tex.b;
    return tex.a;
}

float env_at(int frame_idx) {
    float u = (float(frame_idx) + 0.5) / float(u_total_frames);
    return read_band(texture(u_envelope, vec2(u, 0.5)), u_audio_band_idx);
}

float onset_at(int frame_idx) {
    float u = (float(frame_idx) + 0.5) / float(u_total_frames);
    return read_band(texture(u_onset, vec2(u, 0.5)), u_audio_band_idx);
}

vec4 sample_image(vec2 uv) {
    return texture(u_image, clamp(uv, 0.0, 1.0));
}
`;

// --- Motion shaders -----------------------------------------------------

export const MOTION_SHADERS = {
  // §6.1 of math doc: grid' = grid * (1 - env_t * intensity * 0.15)
  // In UV space (0..1), zoom-in is: uv' = (uv - 0.5) * (1 - s) + 0.5
  scale_pulse: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float s = env_t * u_intensity * 0.15;
    vec2 centered = v_uv - 0.5;
    vec2 uv = centered * (1.0 - s) + 0.5;
    fragColor = sample_image(uv);
}
`,

  // §6.2: same shape as scale_pulse but driven by onset spikes, ×2 amplitude
  zoom_punch: COMMON_PRELUDE + `
void main() {
    float onset_t = onset_at(u_frame_index);
    float s = onset_t * u_intensity * 0.30;
    vec2 centered = v_uv - 0.5;
    vec2 uv = centered * (1.0 - s) + 0.5;
    fragColor = sample_image(uv);
}
`,

  // §9: approximate preview — hash-based deterministic noise stand-in for
  // torch.Generator(seed=0). Final MP4 (Python) is the authoritative cumulative
  // walk; preview is visually similar at a glance.
  shake: COMMON_PRELUDE + `
float hash11(float x) {
    x = fract(x * 0.1031);
    x *= x + 33.33;
    x *= x + x;
    return fract(x);
}
void main() {
    float onset_t = onset_at(u_frame_index);
    float fi = float(u_frame_index) + 1.0;
    float dxRaw = (hash11(fi * 7.0 + 1.0) - 0.5) * 2.0 * onset_t;
    float dyRaw = (hash11(fi * 7.0 + 2.0) - 0.5) * 2.0 * onset_t;
    float amp = u_intensity * 0.04;
    // u_shake_axis: 0=both, 1=x-only, 2=y-only. Locking an axis zeros its delta.
    float xMul = (u_shake_axis == 2) ? 0.0 : 1.0;
    float yMul = (u_shake_axis == 1) ? 0.0 : 1.0;
    vec2 uv = v_uv - vec2(dxRaw * amp * xMul, dyRaw * amp * yMul);
    fragColor = sample_image(uv);
}
`,

  // §6.4: slow Ken Burns circular pan, audio amplifies the drift amount
  drift: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float phase = 6.28318530718 * u_motion_speed * u_t * u_motion_direction;
    float sway = sin(phase);
    float bob  = cos(phase);
    float amp = env_t * u_intensity * 0.04;
    vec2 uv = v_uv - vec2(sway * amp, bob * amp);
    fragColor = sample_image(uv);
}
`,

  // §6.5: rocking rotation around image center. Math doc uses grid in [-1,1]
  // — we convert v_uv from [0,1] before/after, with aspect correction so the
  // rotation is visually circular on non-square images.
  rotate_pulse: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float sway = sin(6.28318530718 * u_motion_speed * u_t);
    float angle = sway * env_t * u_intensity * (3.14159265359 / 12.0) * u_motion_direction;
    float c = cos(angle), s = sin(angle);
    vec2 p = (v_uv - 0.5);
    float xs = p.x * u_aspect;
    float ys = p.y;
    float nx = (xs * c - ys * s) / u_aspect;
    float ny = xs * s + ys * c;
    vec2 uv = vec2(nx, ny) + 0.5;
    fragColor = sample_image(uv);
}
`,

  // §6.7: concentric ripples expanding from center, audio drives amplitude
  ripple: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    vec2 p = (v_uv - 0.5) * 2.0;     // [-1,1]
    float xs = p.x * u_aspect;
    float ys = p.y;
    float r = sqrt(xs*xs + ys*ys);
    float k = 6.0 * 3.14159265359 * u_ripple_density;
    float omega = 6.28318530718 * max(u_motion_speed * 4.0, 0.5) * u_motion_direction;
    float A = env_t * u_intensity * 0.015 * 2.0;
    float dr = A * sin(k * r - omega * u_t);
    float r_safe = max(r, 1e-3);
    float dx = dr * (xs) / r_safe / u_aspect;
    float dy = dr * (ys) / r_safe;
    vec2 uv = v_uv + vec2(dx, dy) * 0.5;   // /2 to convert back to [0,1] half-range
    fragColor = sample_image(uv);
}
`,

  // §6.6: polar twist, image looks pulled into a vortex at center. Twist
  // strength fades with radius — center is twisted hardest, edges untouched.
  swirl: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    vec2 p = (v_uv - 0.5) * 2.0;
    float xs = p.x * u_aspect;
    float ys = p.y;
    float r = sqrt(xs*xs + ys*ys);
    float theta = atan(ys, xs);
    float twist = env_t * u_intensity * (3.14159265359 / 2.0) * max(0.0, 1.0 - r) * u_motion_direction;
    float thp = theta + twist;
    float nx = r * cos(thp) / u_aspect;
    float ny = r * sin(thp);
    vec2 uv = vec2(nx, ny) * 0.5 + 0.5;
    fragColor = sample_image(uv);
}
`,

  // Pinch (direction=-1) / Bulge (direction=+1) — radial squeeze with
  // linear falloff. Center is most affected, edges are unchanged.
  pinch: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    vec2 p = (v_uv - 0.5) * 2.0;
    p.x *= u_aspect;
    float r = length(p);
    float falloff = clamp(1.0 - r, 0.0, 1.0);
    float s = env_t * u_intensity * 0.30 * u_motion_direction;
    float factor = 1.0 - s * falloff;
    vec2 q = p * factor;
    q.x /= u_aspect;
    vec2 uv = q * 0.5 + 0.5;
    fragColor = sample_image(uv);
}
`,

  // Wave — horizontal sine displacement that travels vertically. Like a flag.
  wave: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float yn = (v_uv.y - 0.5) * 2.0;
    float k = 4.0 * 3.14159265359 * u_wave_density;
    float omega = 6.28318530718 * max(u_motion_speed * 2.0, 0.4) * u_motion_direction;
    float A = env_t * u_intensity * 0.05;
    float dx = A * sin(k * yn - omega * u_t);
    vec2 uv = v_uv + vec2(dx * 0.5, 0.0);
    fragColor = sample_image(uv);
}
`,

  // Tilt — Dutch-angle pulse. y-dependent x-skew (top tilts one way,
  // bottom the other), driven by sway × env. Direction flips lean side.
  tilt: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float sway = sin(6.28318530718 * u_motion_speed * u_t);
    float skew = sway * env_t * u_intensity * 0.20 * u_motion_direction;
    vec2 p = (v_uv - 0.5) * 2.0;
    p.x = p.x + skew * p.y;
    vec2 uv = p * 0.5 + 0.5;
    fragColor = sample_image(uv);
}
`,

  // Pixelate — UV quantization to N×N blocks, gated by onset spike. Image
  // is pristine at rest, snaps to chunky pixels on beat.
  pixelate: COMMON_PRELUDE + `
void main() {
    float onset_t = onset_at(u_frame_index);
    float spike = clamp(onset_t * u_intensity, 0.0, 1.0);
    if (spike < 0.01) {
        fragColor = sample_image(v_uv);
        return;
    }
    float blocks = max(2.0, u_pixelate_blocks);
    vec2 q = (floor(v_uv * blocks) + 0.5) / blocks;
    vec2 uv = mix(v_uv, q, spike);
    fragColor = sample_image(uv);
}
`,

  // RGB Split — geometric chromatic aberration. R sampled with positive
  // x offset, G center, B negative offset. env_t drives offset distance.
  rgb_split: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float offset = env_t * u_intensity * 0.025;
    float r = sample_image(v_uv + vec2(offset, 0.0)).r;
    float g = sample_image(v_uv).g;
    float b = sample_image(v_uv - vec2(offset, 0.0)).b;
    fragColor = vec4(r, g, b, 1.0);
}
`,

  // Squeeze — 1-D scale on the chosen axis. squeeze_axis: 0=x, 1=y.
  // direction +1 zooms in (image stretches across the axis), -1 zooms out.
  squeeze: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float s = env_t * u_intensity * 0.30 * u_motion_direction;
    vec2 p = (v_uv - 0.5) * 2.0;
    if (u_squeeze_axis == 1) {
        p.y = p.y * (1.0 - s);
    } else {
        p.x = p.x * (1.0 - s);
    }
    vec2 uv = p * 0.5 + 0.5;
    fragColor = sample_image(uv);
}
`,

  // Audio-reactive band displacement — see motion_glitch() docstring in
  // _audio_react_engine.py. Sparsity gate + magnitude curve + 2-frame
  // stutter make this read as "broken signal" rather than uniform
  // scanlines. Three tricks must stay in sync with the Python engine.
  glitch: COMMON_PRELUDE + `
float hashG(float a, float b) {
    return fract(sin((a + b * 31.0) * 12.9898) * 43758.5453);
}
void main() {
    float onset_t = onset_at(u_frame_index);
    float bands = max(2.0, u_glitch_bands);
    float band = floor(v_uv.y * bands);

    // Stutter: refresh every 2 frames. Without this, every frame randomizes
    // and the result looks like smooth jitter instead of discrete glitch.
    float frameStep = floor(float(u_frame_index) / 2.0);

    // Gate ~30% of bands per step — sparsity is what sells the "corruption"
    // look. Most rows stay clean, only a few are displaced.
    // (Local var name avoids 'active' which is reserved in GLSL ES 3.00.)
    float gh = hashG(band * 17.0, frameStep * 23.0);
    float gateOn = step(0.7, gh);

    // Per-band signed offset with magnitude curve. abs()^1.5 keeps small
    // slips small and lets a few rare large jumps through.
    float h = hashG(band * 31.0, frameStep * 13.0);
    float perRow = (h - 0.5) * 2.0;
    perRow = sign(perRow) * pow(abs(perRow), 1.5);

    float amp = onset_t * u_intensity * 0.10;
    vec2 uv = v_uv + vec2(perRow * amp * gateOn, 0.0);
    fragColor = sample_image(uv);
}
`,

  // §6.8: rows time-displaced by audio envelope (per-row sine wave). Cheaper
  // approximation of the spec's frame-buffer-pull idea; visually equivalent.
  slit_scan: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float yn = (v_uv.y - 0.5) * 2.0;       // y in [-1,1]
    float k = 4.0 * 3.14159265359 * u_slit_density;
    float omega = 6.28318530718 * max(u_motion_speed * 2.0, 0.4) * u_motion_direction;
    float A = env_t * u_intensity * 0.04;
    float dy = A * sin(k * yn - omega * u_t);
    float dx = A * 0.5 * cos(k * yn - omega * u_t);
    vec2 uv = v_uv + vec2(dx, dy) * 0.5;
    fragColor = sample_image(uv);
}
`,
};

// --- Overlay shader (pass-through stub for now) -------------------------

export const OVERLAY_SHADER = COMMON_PRELUDE + `
uniform sampler2D u_intermediate;
uniform float u_glitch_strength;
uniform float u_bloom_strength;
uniform float u_vignette_strength;
uniform float u_hue_shift_strength;
uniform float u_grade_strength;     // teal/orange color grade
uniform float u_letterbox_strength; // top/bottom black bars
uniform float u_scanline_strength;
uniform float u_grain_strength;
uniform float u_loop_factor;        // 0..1 ramp at boundaries when loop_safe is on, else 1.0

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 hueRotate(vec3 c, float angleRad) {
    float co = cos(angleRad), si = sin(angleRad);
    mat3 m = mat3(
        0.299 + 0.701*co + 0.168*si,  0.299 - 0.299*co - 0.328*si,  0.299 - 0.299*co + 1.250*si,
        0.587 - 0.587*co + 0.330*si,  0.587 + 0.413*co + 0.035*si,  0.587 - 0.587*co - 1.050*si,
        0.114 - 0.114*co - 0.497*si,  0.114 - 0.114*co + 0.292*si,  0.114 + 0.886*co - 0.203*si
    );
    // GLSL mat3 is column-major; m * c expands the same way as Python frame @ m.T
    return clamp(m * c, 0.0, 1.0);
}

void main() {
    float env_t = env_at(u_frame_index);
    float onset_t = onset_at(u_frame_index);

    // ----- GLITCH (math doc §7.1) -----
    vec2 uvR = v_uv, uvG = v_uv, uvB = v_uv;
    if (u_glitch_strength > 0.0 && onset_t > 0.001) {
        float maxPx = max(1.0, onset_t * u_glitch_strength * 0.012 * min(u_resolution.x, u_resolution.y));
        float seed = floor(onset_t * 1e6);
        float sR = (hash12(vec2(seed, 1.0)) > 0.5 ? 1.0 : -1.0);
        float sG = (hash12(vec2(seed, 2.0)) > 0.5 ? 1.0 : -1.0);
        float sB = (hash12(vec2(seed, 3.0)) > 0.5 ? 1.0 : -1.0);
        float dx = maxPx / u_resolution.x;
        uvR.x += sR * dx;
        uvG.x += sG * dx;
        uvB.x += sB * dx;
        // Scanline tear when onset_t * strength > 0.7
        if (onset_t * u_glitch_strength > 0.7) {
            float row = floor(v_uv.y * u_resolution.y);
            // Random 5% of rows snap to neighbor — simulates tear
            if (hash12(vec2(seed, row)) < 0.05) {
                float dy = 1.0 / u_resolution.y;
                uvR.y += dy; uvG.y += dy; uvB.y += dy;
            }
        }
    }
    vec4 base = vec4(
        texture(u_intermediate, clamp(uvR, 0.0, 1.0)).r,
        texture(u_intermediate, clamp(uvG, 0.0, 1.0)).g,
        texture(u_intermediate, clamp(uvB, 0.0, 1.0)).b,
        1.0
    );
    vec3 col = base.rgb;

    // ----- BLOOM (math doc §7.2; approximate per §9) -----
    if (u_bloom_strength > 0.0 && env_t > 0.001) {
        float weight = env_t * u_bloom_strength * 0.6;
        // 9-tap radial blur as cheap stand-in for separable Gaussian
        vec3 acc = vec3(0.0);
        const float OFF = 0.004;
        for (int dx = -1; dx <= 1; dx++) {
            for (int dy = -1; dy <= 1; dy++) {
                vec2 o = vec2(float(dx), float(dy)) * OFF;
                acc += texture(u_intermediate, clamp(v_uv + o, 0.0, 1.0)).rgb;
            }
        }
        acc /= 9.0;
        vec3 bloomLayer = clamp(acc * weight, 0.0, 1.0);
        col = 1.0 - (1.0 - col) * (1.0 - bloomLayer);
        col = clamp(col, 0.0, 1.0);
    }

    // ----- VIGNETTE (math doc §7.3) -----
    if (u_vignette_strength > 0.0 && env_t > 0.001) {
        vec2 p = (v_uv - 0.5) * 2.0;
        float r = clamp(length(p), 0.0, 1.4);
        float v = clamp(r / 1.4142135, 0.0, 1.0);
        float mask = 1.0 - v * env_t * u_vignette_strength * 0.5;
        col *= mask;
    }

    // ----- HUE_SHIFT (math doc §7.4) -----
    if (u_hue_shift_strength > 0.0 && env_t > 0.001) {
        float angle = env_t * u_hue_shift_strength * (30.0 * 3.14159265359 / 180.0);
        col = hueRotate(col, angle);
    }

    // ----- SCANLINES — steady CRT stripes that drift slowly downward -----
    // Not audio-reactive. loop_factor fades the lines out at the loop
    // seam so the drift phase discontinuity doesn't pop.
    float scanlineEff = u_scanline_strength * u_loop_factor;
    if (scanlineEff > 0.0) {
        float drift = u_t * 0.05;
        float line = sin((v_uv.y + drift) * 200.0 * 3.14159265359);
        line = clamp((line - 0.7) / 0.3, 0.0, 1.0);
        float darkness = line * scanlineEff * 0.4;
        col *= 1.0 - darkness;
    }

    // ----- FILM GRAIN — steady per-pixel noise (not audio-reactive) -----
    // loop_factor fades the noise out at the seam so the per-frame
    // hash-pattern jump is masked.
    float grainEff = u_grain_strength * u_loop_factor;
    if (grainEff > 0.0) {
        float n = hash12(v_uv * u_resolution + float(u_frame_index)) - 0.5;
        col += vec3(n * grainEff * 0.20);
    }

    // ----- COLOR GRADE — cinematic teal/orange tint -----
    // Steady (not env-gated). Independent of letterbox so users can grade
    // without bars or vice versa.
    if (u_grade_strength > 0.0) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 highlightTint = vec3(1.20, 1.00, 0.85);
        vec3 shadowTint    = vec3(0.85, 1.00, 1.15);
        vec3 tinted = clamp(col * mix(shadowTint, highlightTint, lum), 0.0, 1.0);
        col = mix(col, tinted, u_grade_strength);
    }

    // ----- LETTERBOX — top/bottom black bars -----
    // Applied AFTER grade so bars stay pure black, never tinted.
    if (u_letterbox_strength > 0.0) {
        float bar = 0.10 * u_letterbox_strength;
        if (v_uv.y < bar || v_uv.y > 1.0 - bar) {
            col = vec3(0.0);
        }
    }

    fragColor = vec4(col, 1.0);
}
`;

// --- Compile + cache ----------------------------------------------------

const _programCache = new WeakMap();   // gl → {[key: program]}

export function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}\n--- src ---\n${src}`);
  }
  return sh;
}

export function compileProgram(gl, vsSrc, fsSrc, key) {
  let cache = _programCache.get(gl);
  if (!cache) { cache = {}; _programCache.set(gl, cache); }
  if (key && cache[key]) return cache[key];

  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program link failed: ${log}`);
  }
  if (key) cache[key] = prog;
  return prog;
}
