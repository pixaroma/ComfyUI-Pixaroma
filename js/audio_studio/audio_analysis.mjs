// js/audio_studio/audio_analysis.mjs
"use strict";

// ----- Web Audio API decode --------------------------------------------

let _audioCtx = null;

export function getAudioContext() {
  if (_audioCtx) return _audioCtx;
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

/** Decode any supported audio format to AudioBuffer. */
export async function decodeAudio(arrayBuffer) {
  const ctx = getAudioContext();
  return await ctx.decodeAudioData(arrayBuffer.slice(0));   // .slice is required per spec on some browsers
}

// ----- Real FFT (Cooley-Tukey radix-2, in-place, complex) ---------------

/** In-place complex FFT. re, im are Float32Array of length n (power of 2). */
function fftComplex(re, im, inverse = false) {
  const n = re.length;
  // Bit reversal permute
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (inverse ? 2 : -2) * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1.0, curIm = 0.0;
      for (let k = 0; k < half; k++) {
        const idx2 = i + k + half;
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[idx2] * curRe - im[idx2] * curIm;
        const bIm = re[idx2] * curIm + im[idx2] * curRe;
        re[i + k]   = aRe + bRe;
        im[i + k]   = aIm + bIm;
        re[idx2]    = aRe - bRe;
        im[idx2]    = aIm - bIm;
        const tRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = tRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

/** Bandpass on a real-valued waveform via FFT. lowHz/highHz can be null. */
export function bandpass(real, sampleRate, lowHz, highHz) {
  // Pad to next power of 2
  const origLen = real.length;
  let n = 1; while (n < origLen) n <<= 1;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  re.set(real);
  fftComplex(re, im, false);
  // Mask
  for (let k = 0; k < n; k++) {
    const f = k <= n / 2 ? (k * sampleRate / n) : ((n - k) * sampleRate / n);
    const inLow  = lowHz  == null || f >= lowHz;
    const inHigh = highHz == null || f <= highHz;
    if (!(inLow && inHigh)) { re[k] = 0; im[k] = 0; }
  }
  fftComplex(re, im, true);
  return re.subarray(0, origLen);
}

const BANDS = {
  full:   [null, null],
  bass:   [20, 250],
  mids:   [250, 4000],
  treble: [4000, 20000],
};

// ----- Envelope + onset (mirrors Python math doc §1, §2) ---------------

/** Per-frame RMS → moving-average smooth → peak-normalize. */
function envelopeOneBand(monoWave, sampleRate, fps, smoothing) {
  const totalSamples = monoWave.length;
  const totalFrames = Math.floor((totalSamples / sampleRate) * fps);
  if (totalFrames <= 0) return new Float32Array(0);
  const samplesPerFrame = Math.max(1, Math.floor(sampleRate / fps));
  const required = totalFrames * samplesPerFrame;
  const buf = new Float32Array(required);
  // Repeat-pad if waveform is shorter than required
  for (let i = 0; i < required; i++) buf[i] = monoWave[i % totalSamples];

  const rms = new Float32Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    let sum = 0;
    const off = f * samplesPerFrame;
    for (let i = 0; i < samplesPerFrame; i++) {
      const v = buf[off + i];
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / samplesPerFrame);
  }

  // Min-max normalize
  let lo = +Infinity, hi = -Infinity;
  for (const v of rms) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi > lo) {
    for (let i = 0; i < totalFrames; i++) rms[i] = (rms[i] - lo) / (hi - lo);
  } else {
    rms.fill(0);
  }

  // Moving-average smooth — kernel of `smoothing` rounded up to odd
  let sw = Math.max(1, smoothing | 0);
  if (sw % 2 === 0) sw += 1;
  if (sw === 1) return rms;
  const half = sw >> 1;
  const out = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    let acc = 0, cnt = 0;
    for (let k = -half; k <= half; k++) {
      const idx = Math.min(totalFrames - 1, Math.max(0, i + k));   // replicate-pad
      acc += rms[idx]; cnt++;
    }
    out[i] = acc / cnt;
  }
  return out;
}

/** Onset track (math doc §2). */
export function computeOnsetTrack(envelope) {
  const n = envelope.length;
  if (n === 0) return new Float32Array(0);
  const diff = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const d = envelope[i] - envelope[i - 1];
    diff[i] = d > 0 ? d : 0;
  }
  // Quantile 0.75
  const sorted = Float32Array.from(diff).sort();
  const q75 = sorted[Math.floor((n - 1) * 0.75)];
  const thresh = Math.max(0.05, q75);
  const spikes = new Float32Array(n);
  for (let i = 0; i < n; i++) spikes[i] = diff[i] > thresh ? diff[i] : 0;
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev = Math.max(spikes[i], prev * 0.85);
    out[i] = prev;
  }
  let mx = 0;
  for (const v of out) if (v > mx) mx = v;
  if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
  return out;
}

/**
 * Compute per-frame envelopes for ALL 4 audio bands at once + onset for
 * each. Returns arrays packed into RGBA32F texture order:
 *   envelope: Float32Array(totalFrames * 4)  — R=full, G=bass, B=mids, A=treble
 *   onset:    Float32Array(totalFrames * 4)
 *   totalFrames: int
 *
 * @param {AudioBuffer} audioBuffer
 * @param {number} fps
 * @param {number} smoothing
 * @param {boolean} loopSafe
 * @returns {{envelope: Float32Array, onset: Float32Array, totalFrames: number}}
 */
export function computeAll(audioBuffer, fps, smoothing, loopSafe) {
  const sampleRate = audioBuffer.sampleRate;
  // Mono-mix
  const ch = audioBuffer.numberOfChannels;
  const N = audioBuffer.length;
  const mono = new Float32Array(N);
  for (let c = 0; c < ch; c++) {
    const arr = audioBuffer.getChannelData(c);
    for (let i = 0; i < N; i++) mono[i] += arr[i] / ch;
  }

  const totalFrames = Math.floor((N / sampleRate) * fps);
  if (totalFrames <= 0) {
    return { envelope: new Float32Array(0), onset: new Float32Array(0), totalFrames: 0 };
  }

  const envelope = new Float32Array(totalFrames * 4);
  const onset    = new Float32Array(totalFrames * 4);
  const bandKeys = ["full", "bass", "mids", "treble"];

  for (let b = 0; b < 4; b++) {
    const [lo, hi] = BANDS[bandKeys[b]];
    const filtered = (lo == null && hi == null) ? mono : bandpass(mono, sampleRate, lo, hi);
    let env = envelopeOneBand(filtered, sampleRate, fps, smoothing);
    if (loopSafe && totalFrames >= 4) {
      const fadeN = Math.max(2, Math.min(Math.floor(fps * 0.5), Math.floor(totalFrames / 2)));
      // start ramp 0..1
      for (let i = 0; i < fadeN; i++) env[i] *= i / (fadeN - 1);
      // end ramp 1..0
      for (let i = 0; i < fadeN; i++) env[totalFrames - 1 - i] *= i / (fadeN - 1);
    }
    const ons = computeOnsetTrack(env);
    for (let i = 0; i < totalFrames; i++) {
      envelope[i * 4 + b] = env[i];
      onset   [i * 4 + b] = ons[i];
    }
  }

  return { envelope, onset, totalFrames };
}

// ----- WAV writer (16-bit PCM, used by source upload conversion) -------

/**
 * Encode an AudioBuffer to a WAV blob (16-bit PCM, mono or stereo).
 * Used by the editor to convert decoded audio (any format) to WAV before
 * uploading — server only accepts WAV (Python decode via stdlib `wave`).
 */
export function encodeWav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sr * blockAlign;
  const dataLen = len * blockAlign;

  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  let p = 0;
  function writeStr(s) { for (const c of s) view.setUint8(p++, c.charCodeAt(0)); }
  function u32(v) { view.setUint32(p, v, true); p += 4; }
  function u16(v) { view.setUint16(p, v, true); p += 2; }
  // RIFF header
  writeStr("RIFF"); u32(36 + dataLen); writeStr("WAVE");
  // fmt chunk
  writeStr("fmt "); u32(16); u16(1); u16(numCh); u32(sr); u32(byteRate); u16(blockAlign); u16(16);
  // data chunk
  writeStr("data"); u32(dataLen);

  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(audioBuffer.getChannelData(c));
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      p += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}
