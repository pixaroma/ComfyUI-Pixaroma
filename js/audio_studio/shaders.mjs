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
uniform float u_t;
uniform float u_aspect;
uniform vec2  u_resolution;

float read_band(vec4 sample, int idx) {
    if (idx == 0) return sample.r;
    if (idx == 1) return sample.g;
    if (idx == 2) return sample.b;
    return sample.a;
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
    vec2 uv = v_uv - vec2(dxRaw * amp, dyRaw * amp);
    fragColor = sample_image(uv);
}
`,

  // §6.4: slow Ken Burns circular pan, audio amplifies the drift amount
  drift: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float sway = sin(6.28318530718 * u_motion_speed * u_t);
    float bob  = cos(6.28318530718 * u_motion_speed * u_t);
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
    float angle = sway * env_t * u_intensity * (3.14159265359 / 12.0);
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
    float k = 6.0 * 3.14159265359;
    float omega = 6.28318530718 * max(u_motion_speed * 4.0, 0.5);
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
    float twist = env_t * u_intensity * (3.14159265359 / 2.0) * max(0.0, 1.0 - r);
    float thp = theta + twist;
    float nx = r * cos(thp) / u_aspect;
    float ny = r * sin(thp);
    vec2 uv = vec2(nx, ny) * 0.5 + 0.5;
    fragColor = sample_image(uv);
}
`,

  // §6.8: rows time-displaced by audio envelope (per-row sine wave). Cheaper
  // approximation of the spec's frame-buffer-pull idea; visually equivalent.
  slit_scan: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float yn = (v_uv.y - 0.5) * 2.0;       // y in [-1,1]
    float k = 4.0 * 3.14159265359;
    float omega = 6.28318530718 * max(u_motion_speed * 2.0, 0.4);
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

void main() {
    // Pass-through stub. Real overlays land in Task E10.
    fragColor = texture(u_intermediate, v_uv);
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
