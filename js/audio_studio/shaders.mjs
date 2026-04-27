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
