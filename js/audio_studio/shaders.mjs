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
